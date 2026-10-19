// SPDX-License-Identifier: GPL-3.0-or-later
// OSC Bridge core (doc/specs/modules/osc-bridge.md §4): lanes that turn the arguments of
// incoming messages into control signals, gates and triggers, and lanes that turn control
// signals into messages to send. Pure signal handling: sockets are the module's business.
#pragma once

#include "Osc.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstring>

namespace bleep::patch {

constexpr int kOscLanes = 6;  ///< receive lanes and send lanes, each

enum OscReceiveMode { OscReceiveValue = 0, OscReceiveGate, OscReceiveTrigger };
enum OscSendMode { OscSendValue = 0, OscSendGate, OscSendTrigger };

struct OscReceiveLane {
    char pattern[osc::kMaxAddress] = {};  ///< OSC address pattern; empty = lane off
    int arg = 0;                          ///< which argument (0..3)
    int mode = OscReceiveValue;
    float lo = 0.0f, hi = 1.0f;           ///< the argument range that maps to the signal's range
    bool bipolar = false;                 ///< the range maps to -1..+1 instead of 0..1
    float smooth = 0.01f;                 ///< seconds
};

struct OscSendLane {
    char address[osc::kMaxAddress] = {};  ///< empty = lane off
    int mode = OscSendValue;
    float lo = 0.0f, hi = 1.0f;           ///< the range of the argument that is sent
    bool bipolar = false;                 ///< the cable is -1..+1 (else 0..1)
    float rate = 50.0f;                   ///< messages per second at most
};

struct OscBridgeConfig {
    std::array<OscReceiveLane, kOscLanes> receive;
    std::array<OscSendLane, kOscLanes> send;
};

/// A message to send, as the audio thread queues it for the network thread.
struct OscOutgoing {
    char address[osc::kMaxAddress] = {};
    float value = 0.0f;
};

/// A single-producer, single-consumer queue of outgoing messages.
class OscOutQueue {
public:
    static constexpr uint32_t kSize = 128;
    bool push(const OscOutgoing& m) noexcept {
        const uint32_t w = write_.load(std::memory_order_relaxed);
        if (w - read_.load(std::memory_order_acquire) >= kSize) return false;
        items_[w % kSize] = m;
        write_.store(w + 1, std::memory_order_release);
        return true;
    }
    bool pop(OscOutgoing& m) noexcept {
        const uint32_t r = read_.load(std::memory_order_relaxed);
        if (r == write_.load(std::memory_order_acquire)) return false;
        m = items_[r % kSize];
        read_.store(r + 1, std::memory_order_release);
        return true;
    }

private:
    std::array<OscOutgoing, kSize> items_{};
    std::atomic<uint32_t> write_{0}, read_{0};
};

class OscBridgeDsp {
public:
    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        pulse_ = std::max(1, (int)(0.002 * sampleRate));
        shortGate_ = std::max(1, (int)(0.01 * sampleRate));
        reset();
    }
    void reset() noexcept {
        for (auto& l : in_) l = {};
        for (auto& l : out_) l = {};
        samplesSince_ = 0;
    }

    /// A message from the network. `cfg` is the current lane set.
    void onMessage(const OscBridgeConfig& cfg, const osc::Message& m) noexcept {
        ++received_;
        for (int i = 0; i < kOscLanes; ++i) {
            const OscReceiveLane& c = cfg.receive[(size_t)i];
            if (c.pattern[0] == 0 || !osc::match(c.pattern, m.address)) continue;
            InState& s = in_[(size_t)i];
            const bool has = c.arg < m.argc;
            const float a = has ? m.args[c.arg] : 0.0f;
            switch (c.mode) {
                case OscReceiveTrigger: s.pulseLeft = pulse_; break;
                case OscReceiveGate:
                    if (has) { s.gate = a >= 0.5f; s.holdLeft = 0; }
                    else { s.gate = true; s.holdLeft = shortGate_; }  // a message without arguments is a short gate
                    break;
                default:
                    if (has) {
                        const float span = c.hi - c.lo;
                        const float x = span != 0.0f ? std::clamp((a - c.lo) / span, 0.0f, 1.0f) : 0.0f;
                        s.target = c.bipolar ? 2.0f * x - 1.0f : x;
                    }
            }
        }
    }

    /// The signal of receive lane `i` for the next sample.
    float receive(const OscBridgeConfig& cfg, int i) noexcept {
        const OscReceiveLane& c = cfg.receive[(size_t)i];
        InState& s = in_[(size_t)i];
        switch (c.mode) {
            case OscReceiveTrigger: {
                const float v = s.pulseLeft > 0 ? 1.0f : 0.0f;
                if (s.pulseLeft > 0) --s.pulseLeft;
                return v;
            }
            case OscReceiveGate:
                if (s.holdLeft > 0 && --s.holdLeft == 0) s.gate = false;
                return s.gate ? 1.0f : 0.0f;
            default: {
                const float k = c.smooth <= 0.0f ? 1.0f : 1.0f - std::exp(-1.0f / (c.smooth * (float)sr_));
                s.value += (s.target - s.value) * k;
                return s.value;
            }
        }
    }

    /// Looks at the signal on send lane `i` for this sample and queues a message when one is due.
    void send(const OscBridgeConfig& cfg, int i, float cv, OscOutQueue& q) noexcept {
        const OscSendLane& c = cfg.send[(size_t)i];
        OutState& s = out_[(size_t)i];
        ++s.since;
        if (c.address[0] == 0) { s.armed = false; return; }
        auto emit = [&](float v) {
            OscOutgoing m;
            std::memcpy(m.address, c.address, sizeof m.address);
            m.value = v;
            if (q.push(m)) s.since = 0;
        };
        const bool high = cv >= 0.5f;
        switch (c.mode) {
            case OscSendGate:
                if (s.armed && high != s.high) emit(high ? c.hi : c.lo);
                s.high = high;
                break;
            case OscSendTrigger:
                if (s.armed && high && !s.high) emit(c.hi);
                s.high = high;
                break;
            default: {
                const float x = std::clamp(c.bipolar ? 0.5f * (cv + 1.0f) : cv, 0.0f, 1.0f);
                const float v = c.lo + x * (c.hi - c.lo);
                const bool due = (float)s.since >= (float)sr_ / std::max(c.rate, 0.1f);
                // First value after arming goes out at once; later ones when they changed enough and the rate allows.
                if (!s.armed || (std::fabs(x - s.lastX) > 0.002f && due) || (s.pending && due)) {
                    emit(v);
                    s.lastX = x;
                    s.pending = false;
                } else if (std::fabs(x - s.lastX) > 0.002f) {
                    s.pending = true;
                }
            }
        }
        s.armed = true;
    }

    uint32_t received() const noexcept { return received_; }

private:
    struct InState {
        float target = 0.0f, value = 0.0f;
        bool gate = false;
        int pulseLeft = 0, holdLeft = 0;
    };
    struct OutState {
        float lastX = 0.0f;
        bool armed = false, high = false, pending = false;
        int since = 1 << 20;
    };
    double sr_ = 48000.0;
    int pulse_ = 96, shortGate_ = 480;
    std::array<InState, kOscLanes> in_{};
    std::array<OutState, kOscLanes> out_{};
    int samplesSince_ = 0;
    uint32_t received_ = 0;
};

}  // namespace bleep::patch
