// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// AudioLink — the jitter buffer of one web audio channel (doc/specs/bridges.md §10.4). One thread pushes
// packets as they arrive, the audio thread pulls blocks. The two clocks drift apart, so the pull side
// reads a little faster or slower to keep the buffer at its target fill, and converts between the two
// sample rates in the same step. The JavaScript side (patch/web/js/bridge-ring.js) follows the same rule.
#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

namespace bleep::hub {

class AudioLink {
public:
    static constexpr double kMaxNudge = 0.005;   ///< ± 0.5 % of speed
    static constexpr double kGain = 0.02;        ///< nudge per unit of relative fill error
    static constexpr double kSmoothSeconds = 0.5;
    static constexpr double kPacketFrames = 128.0;   ///< the web sends one render quantum at a time
    static constexpr double kMaxBlock = 2048.0;

    /// [not real time, while nothing pushes or pulls] `sourceRate`: the rate of the pushed audio;
    /// `sinkRate`: the rate pulled at; `targetMs`: the fill the buffer is held at (the channel's latency).
    void configure(double sourceRate, double sinkRate, double targetMs) {
        sourceRate_ = sourceRate > 0.0 ? sourceRate : 48000.0;
        sinkRate_ = sinkRate > 0.0 ? sinkRate : 48000.0;
        configured_ = std::max(64.0, targetMs * 0.001 * sourceRate_);
        target_.store(configured_);
        // Room for a target that has grown to a large consumer block (see pull()).
        size_t cap = 1024;
        while (cap < (size_t)(std::max(configured_, 3.0 * kMaxBlock) * 8.0) + 4096) cap <<= 1;
        for (auto& c : ring_) c.assign(cap, 0.0f);
        mask_ = cap - 1;
        reset();
    }

    void reset() {
        written_.store(0);
        readPos_ = 0.0;
        ratio_ = sourceRate_ / sinkRate_;
        primed_ = false;
    }

    /// Frames of source audio the buffer holds at rest.
    double targetFrames() const noexcept { return target_.load(std::memory_order_relaxed); }
    double targetMs() const noexcept { return targetFrames() / sourceRate_ * 1000.0; }

    /// [producer thread] Appends `n` frames. `r` may equal `l` (mono).
    void push(const float* l, const float* r, int n) noexcept {
        uint64_t w = written_.load(std::memory_order_relaxed);
        for (int i = 0; i < n; ++i, ++w) {
            ring_[0][w & mask_] = l[i];
            ring_[1][w & mask_] = r[i];
        }
        written_.store(w, std::memory_order_release);
    }

    /// [consumer thread, real time] Fills `n` frames. Underrun: silence, and the buffer fills up to the target
    /// again before audio resumes. Returns true if the block carries audio.
    bool pull(float* l, float* r, int n) noexcept {
        // The buffer must hold more than one block of the consumer plus a few packets of the producer, or it runs dry
        // between two pulls whatever the clocks do. The target grows to fit the largest block seen, and never shrinks.
        const double base0 = sourceRate_ / sinkRate_;
        double target = target_.load(std::memory_order_relaxed);
        const double need = 1.5 * (double)n * base0 + 3.0 * kPacketFrames;
        if (need > target) {
            target = std::min(need, 3.0 * kMaxBlock);
            target_.store(target, std::memory_order_relaxed);
        }
        const uint64_t w = written_.load(std::memory_order_acquire);
        double fill = (double)w - readPos_;
        if (!primed_) {
            if (fill < target) {
                std::fill_n(l, n, 0.0f);
                std::fill_n(r, n, 0.0f);
                return false;
            }
            primed_ = true;
        }
        if (fill > 4.0 * target) {  // far ahead: drop the oldest down to the target
            readPos_ = (double)w - target;
            fill = target;
            overruns_.fetch_add(1, std::memory_order_relaxed);
        }
        const double base = sourceRate_ / sinkRate_;
        const double err = (fill - target) / target;
        const double want = base * (1.0 + std::clamp(kGain * err, -kMaxNudge, kMaxNudge));
        ratio_ += (want - ratio_) * (1.0 - std::exp(-(double)n / (kSmoothSeconds * sinkRate_)));
        const double needed = (double)n * ratio_ + 2.0;
        if (fill < needed) {
            primed_ = false;
            underruns_.fetch_add(1, std::memory_order_relaxed);
            std::fill_n(l, n, 0.0f);
            std::fill_n(r, n, 0.0f);
            return false;
        }
        for (int i = 0; i < n; ++i) {
            const uint64_t i0 = (uint64_t)readPos_;
            const float f = (float)(readPos_ - (double)i0);
            const size_t a = i0 & mask_, b = (i0 + 1) & mask_;
            l[i] = ring_[0][a] + (ring_[0][b] - ring_[0][a]) * f;
            r[i] = ring_[1][a] + (ring_[1][b] - ring_[1][a]) * f;
            readPos_ += ratio_;
        }
        lastFill_.store(fill, std::memory_order_relaxed);
        return true;
    }

    double fill() const noexcept { return lastFill_.load(std::memory_order_relaxed); }
    uint32_t underruns() const noexcept { return underruns_.load(std::memory_order_relaxed); }
    uint32_t overruns() const noexcept { return overruns_.load(std::memory_order_relaxed); }
    bool primed() const noexcept { return primed_; }

private:
    std::vector<float> ring_[2];
    size_t mask_ = 0;
    double sourceRate_ = 48000.0, sinkRate_ = 48000.0, configured_ = 768.0;
    std::atomic<double> target_{768.0};
    std::atomic<uint64_t> written_{0};
    double readPos_ = 0.0;   // consumer only
    double ratio_ = 1.0;     // consumer only
    bool primed_ = false;    // consumer only
    std::atomic<double> lastFill_{0.0};
    std::atomic<uint32_t> underruns_{0}, overruns_{0};
};

}  // namespace bleep::hub
