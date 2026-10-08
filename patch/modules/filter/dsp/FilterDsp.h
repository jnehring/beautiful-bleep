// SPDX-License-Identifier: MIT
// Filter: stereo zero-delay-feedback SVF with LP/BP/HP/notch morph, drive,
// key tracking and an envelope follower that is published back to the bus.
#pragma once

#include "dsp/Smoothing.h"
#include "dsp/Svf.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::patch {

struct FilterParams {
    float cutoff = 0.6f;    ///< normalised 0..1, exponential: 20 Hz · 1000^x (≈ 10 octaves)
    float resonance = 0.2f; ///< 0..1 → Q 0.5..25
    float drive = 0.0f;     ///< 0..1
    float morph = 0.0f;     ///< 0 LP, 1/3 BP, 2/3 HP, 1 notch
    float mix = 1.0f;       ///< dry/wet
    float keyTrack = 0.0f;  ///< 0..1: octaves of cutoff per octave of pitch
    int type = 0;           ///< 0 Clean (ZDF SVF), 1 Rough (saturating 12 dB)
};

class FilterDsp {
public:
    static constexpr int kMaxChannels = 2;

    /// Cutoff in Hz for a normalised value plus a pitch offset in octaves.
    static float cutoffHz(float normalised, float octaves) noexcept {
        return 20.0f * std::pow(1000.0f, std::clamp(normalised, 0.0f, 1.0f)) * std::exp2(octaves);
    }
    static float q(float resonance) noexcept { return 0.5f * std::pow(50.0f, std::clamp(resonance, 0.0f, 1.0f)); }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        env_.prepare(sampleRate, 0.005f, 0.12f);
        reset();
    }

    void reset() noexcept {
        for (auto& f : svf_) f.reset();
        for (auto& f : rough_) f.reset();
        env_.reset();
        lastHz_ = lastQ_ = -1.0f;
    }

    /// Processes one sample frame in place. Returns the envelope (0..1).
    float tick(const FilterParams& p, float pitch, float* frame, int numChannels) noexcept {
        const float hz = cutoffHz(p.cutoff, p.keyTrack * pitch);
        const float qq = q(p.resonance);
        const bool rough = p.type == 1;
        if (std::fabs(hz - lastHz_) > 0.0f || std::fabs(qq - lastQ_) > 0.0f || rough != lastRough_) { // changed
            if (rough) for (auto& f : rough_) f.set(hz, qq, sampleRate_);
            else for (auto& f : svf_) f.set(hz, qq, sampleRate_);
            lastHz_ = hz;
            lastQ_ = qq;
            lastRough_ = rough;
        }
        const float gain = 1.0f + (rough ? 12.0f : 7.0f) * p.drive;
        float sum = 0.0f;
        for (int ch = 0; ch < std::min(numChannels, kMaxChannels); ++ch) {
            const float dry = frame[ch];
            const float driven = dry + p.drive * (std::tanh(dry * gain) - dry);
            const float wet = rough ? dsp::morphSvf(rough_[(size_t)ch].process(driven), p.morph)
                                    : dsp::morphSvf(svf_[(size_t)ch].process(driven), p.morph);
            frame[ch] = dry + p.mix * (wet - dry);
            sum += frame[ch];
        }
        return std::min(1.0f, 2.0f * env_.process(sum / (float)std::max(1, std::min(numChannels, kMaxChannels))));
    }

private:
    double sampleRate_ = 48000.0;
    std::array<dsp::Svf, kMaxChannels> svf_{};
    std::array<dsp::RoughSvf, kMaxChannels> rough_{};
    bool lastRough_ = false;
    dsp::EnvelopeFollower env_;
    float lastHz_ = -1.0f, lastQ_ = -1.0f;
};

}  // namespace bleep::patch
