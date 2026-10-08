// SPDX-License-Identifier: MIT
// Filter: stereo multimode filter with the algorithms of "The Art of VA
// Filter Design" (see VaFilters.h), drive, key tracking and an envelope
// follower that is published back to the bus.
#pragma once

#include "VaFilters.h"
#include "dsp/Smoothing.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::patch {

using va::FilterType;

struct FilterParams {
    float cutoff = 0.6f;    ///< normalised 0..1, exponential: 20 Hz · 1000^x (≈ 10 octaves)
    float resonance = 0.2f; ///< 0..1 → Q 0.5..25, or the algorithm's feedback amount
    float drive = 0.0f;     ///< 0..1
    float morph = 0.0f;     ///< 0 LP, 1/3 BP, 2/3 HP, 1 notch (meaning per algorithm)
    float gain = 0.0f;      ///< shelf gain in dB, −24..+24
    float mix = 1.0f;       ///< dry/wet
    float keyTrack = 0.0f;  ///< 0..1: octaves of cutoff per octave of pitch
    int type = 0;           ///< FilterType
};

class FilterDsp {
public:
    static constexpr int kMaxChannels = 2;

    /// Cutoff in Hz for a normalised value plus a pitch offset in octaves.
    static float cutoffHz(float normalised, float octaves) noexcept {
        return 20.0f * std::pow(1000.0f, std::clamp(normalised, 0.0f, 1.0f)) * std::exp2(octaves);
    }
    static float q(float resonance) noexcept { return 0.5f * std::pow(50.0f, std::clamp(resonance, 0.0f, 1.0f)); }

    void prepare(double sampleRate) {
        sampleRate_ = sampleRate;
        env_.prepare(sampleRate, 0.005f, 0.12f);
        for (auto& v : voices_) v.prepare(sampleRate);
        reset();
    }

    void reset() noexcept {
        for (auto& v : voices_) v.reset();
        env_.reset();
        last_ = {};
        last_.cutoff = -1.0f;
    }

    /// Processes one sample frame in place. Returns the envelope (0..1).
    float tick(const FilterParams& p, float pitch, float* frame, int numChannels) noexcept {
        const int type = std::clamp(p.type, 0, va::kNumTypes - 1);
        if (type != last_.type) {
            for (auto& v : voices_) v.reset();  // another algorithm: start from silence
            last_.cutoff = -1.0f;
        }
        const float hz = cutoffHz(p.cutoff, p.keyTrack * pitch);
        const auto changed = [](float a, float b) { return std::fabs(a - b) > 0.0f; };
        if (changed(hz, last_.cutoff) || changed(p.resonance, last_.resonance) || changed(p.morph, last_.morph) ||
            changed(p.gain, last_.gain) || type != last_.type) {
            coeffs_ = va::makeCoeffs((FilterType)type, hz, p.resonance, p.morph, p.gain, sampleRate_);
            last_ = p;
            last_.cutoff = hz;
            last_.type = type;
        }
        const bool rough = (FilterType)type == FilterType::SvfSaturating;
        const float gain = 1.0f + (rough ? 12.0f : 7.0f) * p.drive;
        float sum = 0.0f;
        const int channels = std::min(numChannels, kMaxChannels);
        for (int ch = 0; ch < channels; ++ch) {
            const float dry = frame[ch];
            const float driven = dry + p.drive * (std::tanh(dry * gain) - dry);
            const float wet = voices_[(size_t)ch].process(coeffs_, driven, sampleRate_);
            frame[ch] = dry + p.mix * (wet - dry);
            sum += frame[ch];
        }
        return std::min(1.0f, 2.0f * env_.process(sum / (float)std::max(1, channels)));
    }

private:
    double sampleRate_ = 48000.0;
    std::array<va::FilterVoice, kMaxChannels> voices_{};
    va::Coeffs coeffs_{};
    FilterParams last_{};  ///< the settings coeffs_ was made for (cutoff in Hz)
    dsp::EnvelopeFollower env_;
};

}  // namespace bleep::patch
