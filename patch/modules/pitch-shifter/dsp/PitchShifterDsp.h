// SPDX-License-Identifier: MIT
// Time-domain pitch shifter: the algorithm and the Fun (random drift) of DaisySP's
// PitchShifter (Copyright (c) 2020 Electrosmith, Corp, MIT, see ../LICENSE), rewritten
// as a mono sample processor on our delay line with a smoothed window size and a
// feedback path. Two read heads sweep through a delay line at the speed that gives
// the pitch ratio; each fades in and out with a sine window, half a cycle apart, so
// one is always at full level while the other jumps back.
#pragma once

#include "dsp/Delay.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

struct PitchShifterParams {
    float semitones = 0.0f;   ///< transposition, -24 … +24 (fractions allowed)
    float windowMs = 80.0f;   ///< delay window: shorter = tighter, more graininess; longer = smoother, more echo
    float drift = 0.0f;       ///< 0 … 1, random wandering of the heads (tape flutter)
    float feedback = 0.0f;    ///< 0 … 1, the shifted signal back into the input (climbing or falling spirals)
};

class PitchShifterDsp {
public:
    static constexpr double kMaxWindowSeconds = 0.35;

    /// `seed` makes the drift of two channels different; the same seed renders the same audio.
    void prepare(double sampleRate, uint32_t seed = 1) {
        sr_ = sampleRate;
        seed_ = seed ? seed : 1u;
        maxWindow_ = (float)(kMaxWindowSeconds * sr_);
        line_.resize((int)(maxWindow_ * 1.5f) + 8);  // the window plus the largest drift (half a window)
        sizeSlew_ = 1.0f - (float)std::exp(-1.0 / (0.05 * sr_));
        reset();
    }
    void reset() {
        line_.clear();
        rng_ = seed_;
        phase_[0] = 0.0f;
        phase_[1] = 0.5f;
        modAmt_[0] = modAmt_[1] = slewed_[0] = slewed_[1] = 0.0f;
        modCoeff_[0] = modCoeff_[1] = 0.0005f;
        size_ = 0.0f;
        lastSemitones_ = 1e9f;
        fbState_ = 0.0f;
    }

    float tick(float in, const PitchShifterParams& p) noexcept {
        const float target = std::clamp(p.windowMs * 0.001f * (float)sr_, 64.0f, maxWindow_);
        size_ = size_ == 0.0f ? target : size_ + sizeSlew_ * (target - size_);
        if (p.semitones != lastSemitones_) {
            lastSemitones_ = p.semitones;
            ratio_ = std::exp2(p.semitones / 12.0f);
        }
        const float inc = (ratio_ - 1.0f) / size_;  // cycles of the sweep per sample

        // Randomly re-roll the drift while not transposing, so Drift still does something at 0 semitones.
        const bool reroll = std::fabs(p.semitones) < 0.25f && p.drift > 0.0f && (rand() % 65536u) < 4u;
        for (int k = 0; k < 2; ++k) {
            phase_[k] += inc;
            bool wrapped = false;
            if (phase_[k] >= 1.0f) { phase_[k] -= 1.0f; wrapped = true; }
            else if (phase_[k] < 0.0f) { phase_[k] += 1.0f; wrapped = true; }
            if (wrapped || reroll) {
                modAmt_[k] = p.drift * ((float)(rand() % 255u) / 255.0f) * size_ * 0.5f;
                modCoeff_[k] = 0.0002f + ((float)(rand() % 255u) / 255.0f) * 0.001f;
            }
            slewed_[k] += modCoeff_[k] * (modAmt_[k] - slewed_[k]);
        }

        const float x = in + softClip(p.feedback * 0.95f * fbState_);
        line_.write(x);
        float out = 0.0f;
        for (int k = 0; k < 2; ++k) {
            const float fade = 1.0f - phase_[k];
            const float gain = std::sin(fade * 3.14159265f);
            out += line_.readHermite((double)(fade * (size_ - 1.0f) + slewed_[k])) * gain;
        }
        fbState_ = out;
        return out;
    }

    /// The least delay the heads read at, and the most: the latency range of the shifter, in samples.
    float windowSamples() const noexcept { return size_; }

private:
    static float softClip(float x) noexcept {  // bounds the feedback loop at about ±1
        return x < -3.0f ? -1.0f : x > 3.0f ? 1.0f : x * (27.0f + x * x) / (27.0f + 9.0f * x * x);
    }
    uint32_t rand() noexcept {  // xorshift32, as in DaisySP's hash_xs32
        rng_ ^= rng_ << 13;
        rng_ ^= rng_ >> 17;
        rng_ ^= rng_ << 5;
        return rng_;
    }

    double sr_ = 48000.0;
    float maxWindow_ = 16384.0f, sizeSlew_ = 0.001f, size_ = 0.0f;
    dsp::RingDelay line_;
    uint32_t seed_ = 1, rng_ = 1;
    float phase_[2]{0.0f, 0.5f}, modAmt_[2]{}, slewed_[2]{}, modCoeff_[2]{0.0005f, 0.0005f};
    float lastSemitones_ = 1e9f, ratio_ = 1.0f, fbState_ = 0.0f;
};

}  // namespace bleep::patch
