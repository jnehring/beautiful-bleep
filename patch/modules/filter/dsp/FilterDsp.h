// SPDX-License-Identifier: GPL-3.0-only
// Filter: stereo multimode filter with the algorithms of "The Art of VA
// Filter Design" (see VaFilters.h), drive, key tracking and an envelope
// follower that is published back to the bus. Drive is each algorithm's own
// (va::driveSpec()). Drive and filter run at 4× the host rate, so the
// saturators alias less; the dry signal is delayed to match the wet one.
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
    float drive = 0.0f;     ///< 0..1, per algorithm (va::driveSpec())
    float analog = 0.0f;    ///< 0..1: tolerances, drift, noise floor, mismatch (VaFilters.h)
    float morph = 0.0f;     ///< 0 LP, 1/3 BP, 2/3 HP, 1 notch (meaning per algorithm)
    float gain = 0.0f;      ///< shelf gain in dB, −24..+24
    float mix = 1.0f;       ///< dry/wet
    float keyTrack = 0.0f;  ///< 0..1: octaves of cutoff per octave of pitch
    float vowel = 0.0f;     ///< 0..1: A, E, I, O, U (Vowel type)
    float damping = 0.0f;   ///< 0..1: loop damping of the comb types
    int slope = 4;          ///< 1..8 sections of 6 dB (staircase types)
    int type = 0;           ///< FilterType
};

class FilterDsp {
public:
    static constexpr int kMaxChannels = 2;
    static constexpr float kChannelTolerance = 0.06f;  ///< Analog 100 %: the channels' cutoffs differ up to ±6 %
    static constexpr float kDrift = 0.06f;             ///< Analog 100 %: the cutoff wanders up to ±6 %
    static constexpr float kWarmthKnee = 0.8f;  ///< make-up of the warmth alone: loud and quiet signals keep about their level
    static constexpr float kWarmth = 0.4f;             ///< Analog 100 %: the type's own saturation, as at least this much Drive
    static constexpr int kOversampling = 4;
    static constexpr float kRunaway = 1.0e4f;  ///< |output| from which (or NaN) a voice counts as blown up
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
        hostRate_ = sampleRate;
        driftFollow_ = 1.0f - (float)std::exp(-3.0 / sampleRate);  // the drift follows its target over ~0.3 s
        env_.prepare(sampleRate, 0.005f, 0.12f);
        // This instance's components: a spread per channel and per ladder stage, and its own noise.
        uint32_t seed = 0x2545f491u * (uint32_t)(++instances()) + 0x9e3779b9u;
        auto next = [&seed]() {
            seed ^= seed << 13, seed ^= seed >> 17, seed ^= seed << 5;
            return (float)seed * (2.0f / 4294967295.0f) - 1.0f;
        };
        for (size_t ch = 0; ch < (size_t)kMaxChannels; ++ch) {
            channelTol_[ch] = next();
            voices_[ch].setVariation({next(), next(), next(), next()});
            voices_[ch].seedNoise(seed + (uint32_t)ch * 7919u);
            driftSeed_[ch] = seed ^ (0x85ebca6bu * (uint32_t)(ch + 1));
        }
        dcPole_ = (float)std::exp(-2.0 * 3.14159265358979 * 8.0 / sampleRate);  // DC blocker at 8 Hz
        for (auto& v : voices_) v.prepare(sampleRate_);
        reset();
    }

    void reset() noexcept {
        for (auto& v : voices_) v.reset();
        for (auto& u : up_) u.reset();
        for (auto& d : down_) d.reset();
        for (auto& d : dry_) d.fill(0.0f);
        for (auto& d : pad_) d.fill(0.0f);
        dcIn_.fill(0.0f);
        dcOut_.fill(0.0f);
        dryPos_ = padPos_ = 0;
        env_.reset();
        last_ = {};
        lastHz_.fill(-1.0f);
        drift_.fill(0.0f);
        driftTarget_.fill(0.0f);
        driftCount_ = 0;
    }

    /// Processes one sample frame in place. Returns the envelope (0..1).
    float tick(const FilterParams& p, float pitch, float* frame, int numChannels) noexcept {
        const int type = std::clamp(p.type, 0, va::kNumTypes - 1);
        // The two digital types have no Analog (the knob is hidden there, its value may not be 0).
        const bool digital = (FilterType)type == FilterType::NaiveOnePole || (FilterType)type == FilterType::Biquad;
        const float analog = digital ? 0.0f : std::clamp(p.analog, 0.0f, 1.0f);
        // Analog: a circuit is never quite linear; its own saturation always works a little (warmth).
        const float drive = std::max(p.drive, kWarmth * analog);
        if (type != last_.type) {
            for (auto& v : voices_) v.reset();  // another algorithm: start from silence
            lastHz_.fill(-1.0f);
        }
        // Analog: drift, a new random target every 32 samples, followed over about a third of a second.
        if (analog > 0.0f && ++driftCount_ >= 32) {
            driftCount_ = 0;
            for (size_t ch = 0; ch < (size_t)kMaxChannels; ++ch) {
                uint32_t& r = driftSeed_[ch];
                r ^= r << 13, r ^= r >> 17, r ^= r << 5;
                const float step = (float)r * (2.0f / 4294967295.0f) - 1.0f;
                driftTarget_[ch] = std::clamp(driftTarget_[ch] + 0.25f * step, -1.0f, 1.0f);
            }
        }
        if (analog > 0.0f)
            for (size_t ch = 0; ch < (size_t)kMaxChannels; ++ch) drift_[ch] += driftFollow_ * (driftTarget_[ch] - drift_[ch]);
        const float hz = cutoffHz(p.cutoff, p.keyTrack * pitch);
        const auto changed = [](float a, float b) { return std::fabs(a - b) > 0.0f; };
        const bool settings = changed(p.resonance, last_.resonance) || changed(p.morph, last_.morph) ||
                              changed(p.gain, last_.gain) || changed(p.vowel, last_.vowel) || changed(p.damping, last_.damping) ||
                              changed(drive, last_.drive) || changed(analog, last_.analog) || p.slope != last_.slope ||
                              type != last_.type;
        const int channelsUsed = std::min(numChannels, kMaxChannels);
        for (size_t ch = 0; ch < (size_t)channelsUsed; ++ch) {
            // Each channel's cutoff: its tolerance and drift, both with Analog; quantised to
            // steps of 0.01 % so a drifting cutoff does not recompute every sample.
            float chHz = hz;
            if (analog > 0.0f) {
                const float dev = analog * (kChannelTolerance * channelTol_[ch] + kDrift * drift_[ch]);
                chHz = hz * (1.0f + std::round(dev * 1e4f) * 1e-4f);
            }
            if (settings || changed(chHz, lastHz_[ch])) {
                coeffs_[ch] = va::makeCoeffs((FilterType)type, chHz, p.resonance, p.morph, p.gain, sampleRate_, p.vowel,
                                             p.damping, p.slope, drive, analog);
                coeffs_[ch].warmthOnly = p.drive < drive;  // the ladders take the light path for Analog's warmth
                if (coeffs_[ch].warmthOnly) {
                    // Warmth alone: no output stage, and quiet signals keep their level exactly (only loud ones are
                    // rounded off), so Analog changes the colour, not the loudness.
                    coeffs_[ch].postGain = coeffs_[ch].postMul = 1.0f;
                    coeffs_[ch].outGain = va::driveMakeup(coeffs_[ch].inGain, kWarmthKnee);
                }
                lastHz_[ch] = chHz;
            }
        }
        if (settings) {
            last_ = p;
            last_.drive = drive;
            last_.analog = analog;
            last_.type = type;
        }
        float sum = 0.0f;
        const int channels = std::min(numChannels, kMaxChannels);
        for (int ch = 0; ch < channels; ++ch) {
            const auto c = (size_t)ch;
            // A non-finite input would sit in the half-band history and the filter state for good.
            if (!std::isfinite(frame[ch])) frame[ch] = 0.0f;
            float x[kOversampling];
            up_[c].process(frame[ch], kOversampling, x);
            for (float& s : x) {
                float wet = voices_[c].process(coeffs_[c], s, sampleRate_);
                if (!(std::fabs(wet) < kRunaway)) {  // a resonant feedback loop blew up: start the voice from silence
                    voices_[c].reset();
                    wet = 0.0f;
                }
                if (kPad == 0) {
                    s = wet;
                    continue;
                }
                s = pad_[c][(size_t)padPos_];
                pad_[c][(size_t)padPos_] = wet;
                padPos_ = (padPos_ + 1) % kPad;
            }
            float wet = down_[c].process(x, kOversampling);
            // The asymmetric curves leave a DC offset: block it while Drive or Analog is up (the blocker always runs,
            // so turning them up does not start it from cold).
            const float blocked = wet - dcIn_[c] + dcPole_ * dcOut_[c];
            dcIn_[c] = wet;
            dcOut_[c] = blocked;
            if (drive > 0.0f || analog > 0.0f || (FilterType)type == FilterType::CmosSvf) wet = blocked;  // CMOS: offsets of its own
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
    std::array<float, kMaxChannels> dcIn_{}, dcOut_{};  ///< DC blocker state, per channel
    float dcPole_ = 0.999f;
    std::array<va::Coeffs, kMaxChannels> coeffs_{};  ///< per channel: the cutoffs differ with Analog
    FilterParams last_{};  ///< the settings coeffs_ was made for
    std::array<float, kMaxChannels> lastHz_{};  ///< the cutoff each channel's coeffs_ was made for
    double hostRate_ = 48000.0;
    float driftFollow_ = 0.0f;
    std::array<float, kMaxChannels> channelTol_{}, drift_{}, driftTarget_{};
    std::array<uint32_t, kMaxChannels> driftSeed_{};
    int driftCount_ = 0;
    static int& instances() noexcept {  // seeds each instance's components differently, but the same on every run
        static int n = 0;
        return n;
    }
    dsp::EnvelopeFollower env_;
};

}  // namespace bleep::patch
