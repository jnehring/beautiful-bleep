// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// The Live Params node's mailbox and the sender's logic, without the engine: the mailbox through which the audio thread hands the
// values of the node's rows to the bridge, which sends them on to the Bleep Live Link device in Live
// (Max for Live, live.remote~). One mailbox per process, like HostControl. Each node owns the four rows of its channel;
// two nodes on one channel: the last one to run wins.
//
// A value is the position the row asks of the Live parameter, 0..1 within the parameter's own range (a discrete parameter:
// 0 is its first item, 1 its last). It is absolute: the node adds a row's knob and the cables that feed it (the board's usual
// model), and scales it into the row's Min..Max for a continuous parameter. kReleased (-1) means the board no longer drives
// the row: the device lets the parameter go.
#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <mutex>
#include <string>

namespace bleep::patch {

constexpr int kRowsPerChannel = 4;   ///< a Bleep Live Link device has 4 rows, and a Live Params node 4 rows
constexpr int kNumChannels = 8;      ///< one device and one node per channel; row k is row k % 4 of channel k / 4 + 1
constexpr int kNumLiveParams = kRowsPerChannel * kNumChannels;
static_assert(kNumLiveParams <= 32, "the masks are 32 bits");
constexpr float kReleased = -1.0f;   ///< sent instead of a value when no node drives the row any more

/// Audio thread writes, bridge thread reads.
struct LiveParamsMailbox {
    std::atomic<float> value[kNumLiveParams] = {};
    std::atomic<uint32_t> present{0};    ///< bit k: a node drives row k
    std::atomic<uint32_t> discrete{0};   ///< bit k: the device says row k is mapped to a discrete parameter (set by the engine)

    /// [RT] One block of row k: its value, clamped to 0..1 (NaN is 0).
    void publish(int k, float v) noexcept {
        value[k].store(std::isfinite(v) ? std::clamp(v, 0.0f, 1.0f) : 0.0f, std::memory_order_relaxed);
        present.fetch_or(1u << k, std::memory_order_relaxed);
    }
    /// A node left its channel (deleted, or its Channel setting changed): its four rows are no longer driven.
    void clearChannel(int channel) noexcept {
        if (channel < 1 || channel > kNumChannels) return;
        const uint32_t rows = ((1u << kRowsPerChannel) - 1u) << ((channel - 1) * kRowsPerChannel);
        present.fetch_and(~rows, std::memory_order_relaxed);
    }
    void setDiscrete(int k, bool d) noexcept {
        if (k < 0 || k >= kNumLiveParams) return;
        if (d) discrete.fetch_or(1u << k, std::memory_order_relaxed);
        else discrete.fetch_and(~(1u << k), std::memory_order_relaxed);
    }
    bool isDiscrete(int k) const noexcept { return (discrete.load(std::memory_order_relaxed) >> k) & 1u; }
};

inline LiveParamsMailbox& liveParams() noexcept {
    static LiveParamsMailbox mailbox;
    return mailbox;
}

/// What the Bleep Live Link devices report about their rows (name, kind, items), as one JSON object per row, for the Live Params
/// view. Written when a device reports (message thread), read when the view asks (message thread); a lock keeps it simple.
class LiveRowInfoStore {
public:
    void set(int k, std::string json) {
        if (k < 0 || k >= kNumLiveParams) return;
        const std::lock_guard<std::mutex> lock(m_);
        json_[k] = std::move(json);
    }
    std::string get(int k) const {
        if (k < 0 || k >= kNumLiveParams) return {};
        const std::lock_guard<std::mutex> lock(m_);
        return json_[k];
    }

private:
    mutable std::mutex m_;
    std::string json_[kNumLiveParams];
};

inline LiveRowInfoStore& liveRowInfo() noexcept {
    static LiveRowInfoStore store;
    return store;
}

/// A continuous row's value scaled into its Min..Max (positions in the parameter's range; Max below Min turns it round).
inline float scaleIntoRange(float v, float lo, float hi) noexcept {
    return lo + std::clamp(v, 0.0f, 1.0f) * (hi - lo);
}

/// Bridge thread: works out which values are worth sending. A row that moved by less than `deadband` is not sent again;
/// one that no node drives any more is sent once as kReleased, so the device lets its parameter go.
class LiveParamsSender {
public:
    explicit LiveParamsSender(float deadband = 0.0005f) : deadband_(deadband) {}

    /// Calls send(k, value) for each row that needs a message.
    template <class F>
    void poll(const LiveParamsMailbox& box, F&& send) {
        const uint32_t present = box.present.load(std::memory_order_relaxed);
        for (int k = 0; k < kNumLiveParams; ++k) {
            const bool on = (present >> k) & 1u;
            if (!on) {
                if (sentOn_[k]) {
                    sentOn_[k] = false;
                    send(k, kReleased);
                }
                continue;
            }
            const float v = box.value[k].load(std::memory_order_relaxed);
            if (!sentOn_[k] || std::fabs(v - sent_[k]) >= deadband_) {
                sentOn_[k] = true;
                sent_[k] = v;
                send(k, v);
            }
        }
    }
    /// A device (re)connected: everything is sent again.
    void resendAll() noexcept { std::fill(std::begin(sentOn_), std::end(sentOn_), false); }
    /// The device of channel `channel` (1-based) (re)connected: its rows are sent again.
    void resendChannel(int channel) noexcept {
        for (int k = (channel - 1) * kRowsPerChannel; k < channel * kRowsPerChannel; ++k)
            if (k >= 0 && k < kNumLiveParams) sentOn_[k] = false;
    }

private:
    float deadband_;
    float sent_[kNumLiveParams] = {};
    bool sentOn_[kNumLiveParams] = {};
};

}  // namespace bleep::patch
