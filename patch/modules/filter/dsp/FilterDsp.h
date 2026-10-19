// SPDX-License-Identifier: GPL-3.0-or-later
// Filter: stereo multimode filter with the algorithms of "The Art of VA
// Filter Design" (see VaFilters.h), drive, key tracking and an envelope
// follower that is published back to the bus. Drive and filter run at 4×
// the host rate, so the saturators alias less; the dry signal is delayed to
// match the wet one.
#pragma once

#include "VaFilters.h"
#include "dsp/Oversampler.h"
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
    static constexpr int kOversampling = 4;
    /// Half-band delay per FIR at its own rate; the 4× stages add half a host
    /// sample, padded to a whole one so the dry path can match it.
    static constexpr int kStageDelay = (dsp::HalfbandFir::kTaps - 1) / 2;
    static constexpr int kPad = kStageDelay % 2 ? 2 : 0;  ///< samples at 4×
    /// Delay of the output in host samples.
    static constexpr int kLatency = kStageDelay + (2 * kStageDelay + kPad) / 4;

    /// Cutoff in Hz for a normalised value plus a pitch offset in octaves.
    static float cutoffHz(float normalised, float octaves) noexcept {
        return 20.0f * std::pow(1000.0f, std::clamp(normalised, 0.0f, 1.0f)) * std::exp2(octaves);
    }
    static float q(float resonance) noexcept { return 0.5f * std::pow(50.0f, std::clamp(resonance, 0.0f, 1.0f)); }

    void prepare(double sampleRate) {
        sampleRate_ = sampleRate * kOversampling;
        env_.prepare(sampleRate, 0.005f, 0.12f);
        for (auto& v : voices_) v.prepare(sampleRate_);
        reset();
    }

    void reset() noexcept {
        for (auto& v : voices_) v.reset();
        for (auto& u : up_) u.reset();
        for (auto& d : down_) d.reset();
        for (auto& d : dry_) d.fill(0.0f);
        for (auto& d : pad_) d.fill(0.0f);
        dryPos_ = padPos_ = 0;
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
            const auto c = (size_t)ch;
            float x[kOversampling];
            up_[c].process(frame[ch], kOversampling, x);
            for (float& s : x) {
                const float driven = s + p.drive * (std::tanh(s * gain) - s);
                const float wet = voices_[c].process(coeffs_, driven, sampleRate_);
                if (kPad == 0) {
                    s = wet;
                    continue;
                }
                s = pad_[c][(size_t)padPos_];
                pad_[c][(size_t)padPos_] = wet;
                padPos_ = (padPos_ + 1) % kPad;
            }
            const float wet = down_[c].process(x, kOversampling);
            const float dry = dry_[c][(size_t)dryPos_];
            dry_[c][(size_t)dryPos_] = frame[ch];
            frame[ch] = dry + p.mix * (wet - dry);
            sum += frame[ch];
        }
        if (++dryPos_ == kLatency) dryPos_ = 0;
        return std::min(1.0f, 2.0f * env_.process(sum / (float)std::max(1, channels)));
    }

private:
    double sampleRate_ = 192000.0;  ///< the oversampled rate the voices run at
    std::array<va::FilterVoice, kMaxChannels> voices_{};
    std::array<dsp::Upsampler, kMaxChannels> up_{};
    std::array<dsp::Downsampler, kMaxChannels> down_{};
    std::array<std::array<float, kLatency>, kMaxChannels> dry_{};  ///< dry delay to match the wet path
    std::array<std::array<float, std::max(1, kPad)>, kMaxChannels> pad_{};  ///< wet delay to a whole host sample
    int dryPos_ = 0, padPos_ = 0;
    va::Coeffs coeffs_{};
    FilterParams last_{};  ///< the settings coeffs_ was made for (cutoff in Hz)
    dsp::EnvelopeFollower env_;
};

}  // namespace bleep::patch
