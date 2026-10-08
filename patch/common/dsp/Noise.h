// SPDX-License-Identifier: MIT
// Noise sources: white, pink, brown, blue and violet, each at about the same
// loudness (RMS ≈ 0.3). Cheap enough to run one per drum voice.
#pragma once

#include "Random.h"

#include <atomic>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

/// A different seed for every caller, so two noise sources never correlate
/// (e.g. the voices of a Voice Cell). Noise doesn't need to be reproducible.
inline uint32_t freshNoiseSeed() noexcept {
    static std::atomic<uint64_t> counter{0};
    return (uint32_t)mix64(counter.fetch_add(1, std::memory_order_relaxed) + 0x5eedull) | 1u;
}

/// Uniform white noise in [−1, 1) (xorshift32).
class WhiteNoise {
public:
    explicit WhiteNoise(uint32_t seed = freshNoiseSeed()) noexcept : s_(seed | 1u) {}
    float next() noexcept {
        s_ ^= s_ << 13;
        s_ ^= s_ >> 17;
        s_ ^= s_ << 5;
        return (float)(int32_t)s_ * (1.0f / 2147483648.0f);
    }

private:
    uint32_t s_;
};

/// All colours from one white source.
class ColouredNoise {
public:
    struct Frame {
        float white, pink, brown, blue, violet;
    };

    void prepare(double sampleRate) noexcept {
        brownLeak_ = (float)std::exp(-2.0 * 3.14159265358979323846 * 16.0 / sampleRate);  // 16 Hz floor
        brownGain_ = 0.3f * std::sqrt(1.0f - brownLeak_ * brownLeak_) / kWhiteRms;
    }
    void reset() noexcept {
        for (float& b : b_) b = 0.0f;
        brown_ = 0.0f;
        lastPink_ = 0.0f;
        lastWhite_ = 0.0f;
    }

    Frame next() noexcept {
        const float w = white_.next();
        // Pink: a sum of one-pole low-passes approximating −3 dB/oct.
        b_[0] = 0.99886f * b_[0] + w * 0.0555179f;
        b_[1] = 0.99332f * b_[1] + w * 0.0750759f;
        b_[2] = 0.96900f * b_[2] + w * 0.1538520f;
        b_[3] = 0.86650f * b_[3] + w * 0.3104856f;
        b_[4] = 0.55000f * b_[4] + w * 0.5329522f;
        b_[5] = -0.7616f * b_[5] - w * 0.0168980f;
        const float pink = (b_[0] + b_[1] + b_[2] + b_[3] + b_[4] + b_[5] + b_[6] + w * 0.5362f) * kPinkGain;
        b_[6] = w * 0.115926f;
        // Brown: leaky integrator, −6 dB/oct above 16 Hz.
        brown_ = brownLeak_ * brown_ + w;
        // Blue: the slope of pink, +3 dB/oct.
        const float blue = (pink - lastPink_) * kBlueGain;
        lastPink_ = pink;
        // Violet: the slope of white, +6 dB/oct.
        const float violet = (w - lastWhite_) * (0.3f / kWhiteRms / 1.41421356f);
        lastWhite_ = w;
        return {w * (0.3f / kWhiteRms), pink, brown_ * brownGain_, blue, violet};
    }

private:
    static constexpr float kWhiteRms = 0.57735f;  // uniform ±1
    static constexpr float kPinkGain = 0.1695f;
    static constexpr float kBlueGain = 1.676f;
    WhiteNoise white_;
    float b_[7] = {};
    float brown_ = 0.0f, brownLeak_ = 0.999f, brownGain_ = 0.01f;
    float lastPink_ = 0.0f, lastWhite_ = 0.0f;
};

}  // namespace bleep::dsp
