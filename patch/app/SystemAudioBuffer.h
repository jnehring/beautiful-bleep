// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// SystemAudioBuffer — the platform-independent half of System Audio capture (doc/specs/system-audio.md §5):
//
//   StereoRing          a lock-free single-producer single-consumer ring of stereo frames. The capture thread of the
//                       platform backend writes into it at the capture clock.
//   SystemAudioReader   the audio callback's side: reads blocks at the audio device's clock. The two clocks are never
//                       exactly equal (and may be 44.1 and 48 kHz), so it resamples with a ratio that a slow control
//                       loop steers to keep the ring at a constant fill.
//
// No JUCE, no platform code: pure C++ (tests/system_audio_test.cpp).
#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace bleep::app {

class StereoRing {
public:
    /// `capacityFrames` is rounded up to a power of two.
    explicit StereoRing(size_t capacityFrames = 1u << 17) {
        size_t c = 1024;
        while (c < capacityFrames) c <<= 1;
        l_.assign(c, 0.0f);
        r_.assign(c, 0.0f);
        mask_ = c - 1;
    }

    size_t capacity() const noexcept { return mask_ + 1; }

    // ---- producer (the capture thread) ----------------------------------------------------------

    /// `channels` interleaved channels. One channel is copied to both sides; with more than two, the first two are used.
    void writeInterleaved(const float* data, int frames, int channels) noexcept {
        if (frames <= 0 || channels <= 0 || !data) return;
        uint64_t h = head_.load(std::memory_order_relaxed);
        float peak = 0.0f;
        for (int i = 0; i < frames; ++i, data += channels) {
            const float a = data[0], b = channels > 1 ? data[1] : data[0];
            l_[h & mask_] = a;
            r_[h & mask_] = b;
            ++h;
            peak = std::max(peak, std::max(std::fabs(a), std::fabs(b)));
        }
        publish(h, peak);
    }

    /// `channels` separate buffers of `frames` samples each.
    void writePlanar(const float* const* data, int channels, int frames) noexcept {
        if (frames <= 0 || channels <= 0 || !data || !data[0]) return;
        const float* a = data[0];
        const float* b = channels > 1 && data[1] ? data[1] : data[0];
        uint64_t h = head_.load(std::memory_order_relaxed);
        float peak = 0.0f;
        for (int i = 0; i < frames; ++i) {
            l_[h & mask_] = a[i];
            r_[h & mask_] = b[i];
            ++h;
            peak = std::max(peak, std::max(std::fabs(a[i]), std::fabs(b[i])));
        }
        publish(h, peak);
    }

    void writeSilence(int frames) noexcept {
        if (frames <= 0) return;
        uint64_t h = head_.load(std::memory_order_relaxed);
        for (int i = 0; i < frames; ++i, ++h) {
            l_[h & mask_] = 0.0f;
            r_[h & mask_] = 0.0f;
        }
        publish(h, 0.0f);
    }

    // ---- consumer (the audio callback) ----------------------------------------------------------

    uint64_t head() const noexcept { return head_.load(std::memory_order_acquire); }
    float left(uint64_t index) const noexcept { return l_[index & mask_]; }
    float right(uint64_t index) const noexcept { return r_[index & mask_]; }

    /// The highest sample magnitude written since the last call (the signal indicator in Settings).
    float takePeak() noexcept { return peak_.exchange(0.0f, std::memory_order_relaxed); }

private:
    void publish(uint64_t h, float peak) noexcept {
        if (peak > peak_.load(std::memory_order_relaxed)) peak_.store(peak, std::memory_order_relaxed);
        head_.store(h, std::memory_order_release);
    }

    std::vector<float> l_, r_;
    size_t mask_ = 0;
    std::atomic<uint64_t> head_{0};
    std::atomic<float> peak_{0.0f};
};

class SystemAudioReader {
public:
    /// `inRate`: the capture's sample rate; `outRate`: the audio device's; `block`: the device's buffer size.
    void prepare(double inRate, double outRate, int block, double targetMs = 30.0) noexcept {
        inRate_ = inRate > 0.0 ? inRate : 48000.0;
        outRate_ = outRate > 0.0 ? outRate : 48000.0;
        nominal_ = inRate_ / outRate_;
        ratio_ = nominal_;
        // The target fill covers the capture's burstiness and a few device blocks; more latency, fewer dropouts.
        target_ = std::max(targetMs * 0.001 * inRate_, 3.0 * std::max(block, 1) * nominal_);
        primed_ = started_ = false;
        underruns_ = overruns_ = 0;
    }

    /// Writes `n` frames. Silence while the ring fills up after the start, or when it ran dry.
    void process(StereoRing& ring, float* l, float* r, int n) noexcept {
        const uint64_t head = ring.head();
        if (!started_) {  // what was captured before the first block is old: wait for new frames
            started_ = true;
            base_ = head;
            frac_ = 0.0;
        }
        double fill = (double)head - (double)base_ - frac_;  // frames waiting, from the read position on
        if (!primed_) {
            if (fill < target_) return silence(l, r, n);
            primed_ = true;  // the target has accumulated: play from `target_` frames behind the newest one
            if (fill > target_) {
                base_ = head - (uint64_t)target_;
                frac_ = 0.0;
                fill = target_;
            }
            smoothed_ = fill;
        } else if (fill > std::min(4.0 * target_, (double)ring.capacity() * 0.5) || head < base_) {
            ++overruns_;  // the device stood still for a while, or the capture restarted: skip to the target
            base_ = head > (uint64_t)target_ ? head - (uint64_t)target_ : 0;
            frac_ = 0.0;
            smoothed_ = target_;
            fill = target_;
        }

        // A slow loop: the fill (smoothed over ~0.5 s) above the target speeds the reading up, below slows it down.
        const double alpha = std::min(1.0, (double)n / outRate_ / 0.5);
        smoothed_ += (fill - smoothed_) * alpha;
        const double error = (smoothed_ - target_) / target_;
        ratio_ = nominal_ * (1.0 + std::clamp(error * 0.05, -0.005, 0.005));

        for (int i = 0; i < n; ++i) {
            if (base_ + 1 >= head) {  // ran dry: the rest of the block is silence, and the ring is refilled first
                ++underruns_;
                primed_ = false;
                for (; i < n; ++i) l[i] = r[i] = 0.0f;
                return;
            }
            const float f = (float)frac_;
            l[i] = ring.left(base_) * (1.0f - f) + ring.left(base_ + 1) * f;
            r[i] = ring.right(base_) * (1.0f - f) + ring.right(base_ + 1) * f;
            frac_ += ratio_;
            const double whole = std::floor(frac_);
            base_ += (uint64_t)whole;
            frac_ -= whole;
        }
    }

    uint32_t underruns() const noexcept { return underruns_; }
    uint32_t overruns() const noexcept { return overruns_; }
    double ratio() const noexcept { return ratio_; }
    /// Frames of delay the reader adds (the ring's target fill), in the capture's sample rate.
    double latencyFrames() const noexcept { return target_; }

private:
    static void silence(float* l, float* r, int n) noexcept {
        for (int i = 0; i < n; ++i) l[i] = r[i] = 0.0f;
    }

    double inRate_ = 48000.0, outRate_ = 48000.0, nominal_ = 1.0, ratio_ = 1.0, target_ = 1440.0;
    double smoothed_ = 0.0, frac_ = 0.0;
    uint64_t base_ = 0;
    bool primed_ = false, started_ = false;
    uint32_t underruns_ = 0, overruns_ = 0;
};

}  // namespace bleep::app
