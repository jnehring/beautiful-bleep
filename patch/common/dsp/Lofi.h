// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Lo-fi corruption stages: bit-depth reduction, sample-rate decimation
// (sample & hold, optionally anti-aliased), seeded dropouts, a short
// averaging "smear" and a wavefolding "fold". Used by Bender's corrupt modes
// (doc/specs/modules/bender.md §4.5), the delays' lo-fi characters and the drum
// Crusher.
#pragma once

#include "Random.h"
#include "Svf.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

/// Quantizer steps per unit for a bit depth (sign included): 16 bits → 32768.
inline float bitSteps(float bits) noexcept { return std::exp2(std::clamp(bits, 1.0f, 24.0f) - 1.0f); }
/// Rounds x to a grid of 1/steps (2·steps + 1 levels across −1 … +1).
inline float quantizeSteps(float x, float steps) noexcept { return std::round(x * steps) / steps; }
/// Bit-depth reduction; bits may be fractional (smooth modulation of the grid).
inline float quantizeBits(float x, float bits) noexcept { return quantizeSteps(x, bitSteps(bits)); }

/// Sample-rate reduction by sample & hold at a (fractional) lower rate.
/// No filtering by default (the aliasing is the sound); with anti-alias on,
/// a 4-pole low-pass at 0.45 × the target rate runs first.
class Decimator {
public:
    void reset() noexcept {
        held_ = 0.0f;
        ph_ = 1.0;  // the first call samples
        lp1_.reset();
        lp2_.reset();
    }
    /// Advances the hold clock by inc (= target rate / sample rate); true when
    /// a new value should be taken this sample.
    bool advance(double inc) noexcept {
        ph_ += inc;
        if (ph_ < 1.0) return false;
        ph_ -= std::floor(ph_);
        return true;
    }
    float process(float x, double targetHz, double sampleRate, bool antiAlias = false) noexcept {
        if (antiAlias) {
            const float fc = (float)std::min(0.45 * targetHz, 0.45 * sampleRate);
            if (fc < aaHz_ || fc > aaHz_) {
                aaHz_ = fc;
                lp1_.set(fc, 0.5412f, sampleRate);  // Butterworth 4-pole pair
                lp2_.set(fc, 1.3066f, sampleRate);
            }
            x = lp2_.process(lp1_.process(x).lp).lp;
        }
        if (advance(std::clamp(targetHz / sampleRate, 0.0, 1.0))) held_ = x;
        return held_;
    }
    float held() const noexcept { return held_; }

private:
    float held_ = 0.0f, aaHz_ = -1.0f;
    double ph_ = 1.0;
    Svf lp1_, lp2_;
};

/// Bender's Crush: sample rate 48 kHz → 1 kHz and 16 → 3 bits together as
/// amount goes 0 → 1 (exponential rate), no anti-aliasing. 0 is clean.
class Crush {
public:
    void reset() noexcept { dec_.reset(); }
    float process(float x, float amount, double sampleRate) noexcept {
        if (amount <= 0.0f) return x;
        const float a = std::min(amount, 1.0f);
        const double hz = 48000.0 * std::pow(1.0 / 48.0, (double)a);
        if (dec_.advance(std::min(hz / sampleRate, 1.0))) held_ = quantizeBits(x, 16.0f - 13.0f * a);
        return held_;
    }

private:
    Decimator dec_;
    float held_ = 0.0f;
};

/// Seeded gaps: time is cut into cells; cell k is silent when
/// uniform01(seed, k, stream) < amount, so raising the amount only adds gaps.
/// Gain changes ramp over fadeSamples (1 = snap).
class Dropout {
public:
    static bool dropped(uint64_t seed, uint64_t cell, float amount, uint64_t stream = 0x64726f70) noexcept {
        return uniform01(seed, cell, stream) < (double)amount;
    }
    void reset(uint64_t seed) noexcept {
        seed_ = seed;
        cell_ = 0;
        pos_ = 0;
        gain_ = 1.0f;
    }
    /// Restart the cell count (e.g. at each repetition).
    void restart(uint64_t firstCell = 0) noexcept {
        cell_ = firstCell;
        pos_ = 0;
    }
    float process(float x, float amount, int cellSamples, int fadeSamples) noexcept {
        const float target = dropped(seed_, cell_, amount) ? 0.0f : 1.0f;
        const float step = 1.0f / (float)std::max(fadeSamples, 1);
        gain_ += std::clamp(target - gain_, -step, step);
        if (++pos_ >= std::max(cellSamples, 1)) {
            pos_ = 0;
            ++cell_;
        }
        return x * gain_;
    }

private:
    uint64_t seed_ = 0, cell_ = 0;
    int pos_ = 0;
    float gain_ = 1.0f;
};

/// Short moving average (box filter) of a variable length up to kMax
/// samples: softens and smears transients. The length moves by at most 8
/// samples per sample, so modulation doesn't click. No allocation.
class Smear {
public:
    static constexpr int kMax = 4096;
    void reset() noexcept {
        buf_.fill(0.0f);
        sum_ = 0.0;
        w_ = 0;
        len_ = 1;
    }
    /// lengthSamples: 1 = bypass … kMax.
    float process(float x, float lengthSamples) noexcept {
        const int target = std::clamp((int)std::lround(lengthSamples), 1, kMax - 1);
        buf_[(size_t)w_] = x;
        sum_ += x;  // window now holds len_ + 1 samples
        for (int n = 0; n < 8 && len_ < target; ++n) {  // grow: keep older samples
            ++len_;
            sum_ += at(len_);
        }
        sum_ -= at(len_);  // drop the sample that left the window
        for (int n = 0; n < 8 && len_ > target; ++n) {  // shrink: drop the oldest
            --len_;
            sum_ -= at(len_);
        }
        w_ = (w_ + 1) & (kMax - 1);
        return (float)(sum_ / len_);
    }

private:
    float at(int d) const noexcept { return buf_[(size_t)((w_ - d) & (kMax - 1))]; }
    std::array<float, kMax> buf_{};
    double sum_ = 0.0;
    int w_ = 0, len_ = 1;
};

/// Fold corruption: up to +24 dB into a sine wavefolder, then a hard clip.
/// amount 0 is clean; it blends into the folder over the first quarter.
inline float foldCorrupt(float x, float amount) noexcept {
    if (amount <= 0.0f) return x;
    const float a = std::min(amount, 1.0f);
    const float g = std::exp2(a * 3.986f);  // 0 … +24 dB
    const float folded = std::clamp(std::sin(1.5707963f * g * x), -1.0f, 1.0f);
    const float m = std::min(a * 4.0f, 1.0f);
    return std::clamp(x + m * (folded - x), -1.0f, 1.0f);
}

}  // namespace bleep::dsp
