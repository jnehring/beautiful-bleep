// SPDX-License-Identifier: GPL-3.0-only
// Additive Osc (doc/specs/modules/additive-oscillator.md): up to 64 sine partials
// shaped by a few spectral knobs (base shape, tilt, odd/even, count, comb),
// bent by stretch and shift, detuned by a seeded chorus, with a per-partial
// decay for struck sounds. Partials above the band limit are dropped, so it
// never aliases.
//
// The partials run in three dsp::PartialBank (common/dsp/Partials.h): the
// fundamental, the odd partials 3 … 63 and the even partials 2 … 64. That
// gives the Fundamental, Odd and Even outputs from one pass, and the stereo
// image pans odd partials left and even partials right. Levels, ratios and
// the band limit are recomputed every 32 samples (and at once on a trigger);
// the banks smooth the levels over 2 ms and follow the Pitch per sample.
#pragma once

#include "dsp/OscCore.h"
#include "dsp/Partials.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kAdditivePartials = dsp::partials::kMax;  ///< 64

/// Drawn levels (Base Drawn), 0..1 per partial.
using AdditiveDrawn = std::array<float, kAdditivePartials>;

/// The default drawn spectrum (and padding for short arrays): 1/n.
inline AdditiveDrawn additiveDefaultDrawn() noexcept {
    AdditiveDrawn d{};
    for (int n = 1; n <= kAdditivePartials; ++n) d[(size_t)n - 1] = 1.0f / (float)n;
    return d;
}

struct AdditiveOscParams {
    float pitch = 0.0f;        ///< octaves from C4: Octave + Coarse + Fine + Pitch
    float partials = 32.0f;    ///< 1…64, fractional
    float tilt = 0.0f;         ///< dB per octave of partial number, −24…+12
    float oddEven = 0.0f;      ///< −1 odd only … +1 even only
    float stretch = 0.0f;      ///< −1…+1
    float shift = 0.0f;        ///< −1…+1 × f0, added to every partial
    float comb = 0.0f;         ///< 0..1 notch depth
    float combSpacing = 4.0f;  ///< 2…16 partials between notches
    float combPhase = 0.0f;    ///< 0..1 (wraps)
    float chorus = 0.0f;       ///< 0…50 cents
    float chorusRate = 0.3f;   ///< Hz
    float width = 0.0f;        ///< 0..1
    float decay = 20.0f;       ///< seconds; ≥ kSustain = ∞
    float damp = 0.5f;         ///< 0..1
    int base = 0;              ///< 0 Saw, 1 Square, 2 Flat, 3 Drawn
    bool normalise = true;
};

struct AdditiveOscFrame {
    float outL = 0.0f, outR = 0.0f, odd = 0.0f, even = 0.0f, fundamental = 0.0f;
};

class AdditiveOscDsp {
public:
    static constexpr int kMax = kAdditivePartials;
    static constexpr int kBlock = 32;           ///< control-rate period (samples)
    static constexpr float kSustain = 20.0f;    ///< Decay at or above this: ∞
    static constexpr float kNormRms = 0.3f;     ///< Normalise On: output RMS
    static constexpr float kRawScale = 0.63661977f;  ///< Normalise Off: 2/π, a 1/n saw spans ±1
    static constexpr float kPan = 0.7f;         ///< pan of odd/even partials at Width 100 %
    enum Bank { Fund, Odd, Even };

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        for (auto& b : banks_) b.prepare(sampleRate);
        normSmooth_ = (float)(1.0 - std::exp(-(double)kBlock / (0.02 * sampleRate)));
        reset();
    }
    /// Phases to their seeded start values, chorus walks rewound, decay idle.
    void reset() noexcept {
        for (int b = 0; b < 3; ++b)
            banks_[b].reset(random_ ? dsp::PartialBank::PhaseMode::Random : dsp::PartialBank::PhaseMode::Aligned, seed_,
                            (uint64_t)b);
        counter_ = 0;
        struck_ = false;
        sinceStrike_ = 0.0;
        norm_ = -1.0f;
    }
    /// Phases (Random/Aligned) and Seed; a change resets.
    void setPhases(bool random, uint32_t seed) noexcept {
        if (random == random_ && seed == seed_) return;
        random_ = random;
        seed_ = seed;
        reset();
    }
    /// The drawn spectrum (Base Drawn); the array must stay valid while used.
    void setDrawn(const AdditiveDrawn* drawn) noexcept { drawn_ = drawn; }
    /// Trigger: phases restart, the per-partial decay strikes.
    void trigger() noexcept {
        for (auto& b : banks_) b.retrigger();
        struck_ = true;
        sinceStrike_ = 0.0;
        counter_ = 0;  // update the levels now
    }

    AdditiveOscFrame process(const AdditiveOscParams& p) noexcept {
        const double f0 = std::clamp(dsp::osc::pitchToHz((double)p.pitch), 1.0, 20000.0);
        if (counter_ <= 0) {
            update(p, f0);
            counter_ = kBlock;
        }
        --counter_;
        if (struck_) sinceStrike_ += 1.0 / sampleRate_;

        const float f = banks_[Fund].process(f0), o = banks_[Odd].process(f0), e = banks_[Even].process(f0);
        AdditiveOscFrame r;
        const float s = p.normalise ? 1.0f : kRawScale;
        r.fundamental = s * f;
        r.odd = s * (f + o);
        r.even = s * e;
        r.outL = s * (f + panL_ * o + panR_ * e);
        r.outR = s * (f + panR_ * o + panL_ * e);
        if (!p.normalise) {
            r.outL = safety(r.outL), r.outR = safety(r.outR);
            r.odd = safety(r.odd), r.even = safety(r.even);
        }
        return r;
    }

    /// For the view: partial n's final level (normalised, enveloped, band
    /// limited) and frequency (Hz), as of the last control update.
    float displayLevel(int i) const noexcept { return i >= 0 && i < kMax ? shownLevel_[(size_t)i] : 0.0f; }
    float displayHz(int i) const noexcept { return i >= 0 && i < kMax ? shownHz_[(size_t)i] : 0.0f; }

    /// Level of partial n (1-based) before the decay, normalisation and band limit.
    static float shapeLevel(const AdditiveOscParams& p, int n, const AdditiveDrawn* drawn) noexcept {
        float a;
        if (p.base == 3) a = drawn ? std::clamp((*drawn)[(size_t)n - 1], 0.0f, 1.0f) : 1.0f / (float)n;
        else a = dsp::partials::baseLevel(p.base == 1 ? dsp::partials::Base::Square
                                          : p.base == 2 ? dsp::partials::Base::Flat
                                                        : dsp::partials::Base::Saw, n);
        if (a <= 0.0f) return 0.0f;
        a *= dsp::partials::tiltGain(n, p.tilt);
        a *= dsp::partials::oddEvenGain(n, p.oddEven);
        a *= dsp::partials::countGain(n, std::clamp(p.partials, 1.0f, (float)kMax));
        const float spacing = std::clamp(p.combSpacing, 2.0f, 16.0f);
        a *= 1.0f - std::clamp(p.comb, 0.0f, 1.0f) * 0.5f *
                        (1.0f + std::cos(6.28318530717958647692f * ((float)n / spacing + p.combPhase)));
        return a;
    }

    /// Frequency ratio of partial n (1-based) for a Stretch value.
    static float ratio(int n, float stretch) noexcept { return dsp::partials::stretchRatio(n, std::clamp(stretch, -1.0f, 1.0f)); }

private:
    /// Linear up to ±1.2, then a smooth knee into ±1.5 (Normalise Off only).
    static float safety(float x) noexcept {
        const float a = std::fabs(x);
        if (a <= 1.2f) return x;
        return std::copysign(1.2f + 0.3f * std::tanh((a - 1.2f) / 0.3f), x);
    }

    void update(const AdditiveOscParams& p, double f0) noexcept {
        float shape[kMax], level[kMax], rat[kMax];
        float sum = 0.0f;
        const bool decays = struck_ && p.decay < kSustain;
        const double tau = std::max((double)p.decay, 0.001) / 6.9;
        const float damp = std::clamp(p.damp, 0.0f, 1.0f);
        for (int i = 0; i < kMax; ++i) {
            const int n = i + 1;
            shape[i] = shapeLevel(p, n, drawn_);
            sum += shape[i] * shape[i];
            float env = 1.0f;
            if (decays) env = (float)std::exp(-sinceStrike_ / (tau * std::pow((double)n, -2.0 * damp)));
            level[i] = shape[i] * env;
            rat[i] = ratio(n, p.stretch);
        }
        float gain = 1.0f;
        if (p.normalise) {
            const float target = sum > 1e-12f ? kNormRms * 1.41421356f / std::sqrt(sum) : 0.0f;
            if (norm_ < 0.0f) norm_ = target;
            norm_ += (target - norm_) * normSmooth_;
            gain = norm_;
        } else {
            norm_ = -1.0f;
        }
        const double shiftHz = std::clamp(p.shift, -1.0f, 1.0f) * f0;

        // The three banks: fundamental, odd 3 … 63, even 2 … 64.
        float r[3][kMax / 2], l[3][kMax / 2];
        int count[3] = {1, 0, 0};
        r[Fund][0] = rat[0], l[Fund][0] = level[0] * gain;
        for (int n = 2; n <= kMax; ++n) {
            const int b = n % 2 ? Odd : Even;
            r[b][count[b]] = rat[n - 1];
            l[b][count[b]] = level[n - 1] * gain;
            ++count[b];
        }
        const float cents = std::clamp(p.chorus, 0.0f, 50.0f), rate = std::clamp(p.chorusRate, 0.01f, 5.0f);
        for (int b = 0; b < 3; ++b) {
            banks_[b].setChorus(cents, rate);
            banks_[b].setPartials(r[b], l[b], count[b], f0, shiftHz);
        }
        const float pan = kPan * std::clamp(p.width, 0.0f, 1.0f);
        const float a = (1.0f - pan) * 0.25f * 3.14159265358979f;  // odd partials: pan −pan
        panL_ = std::cos(a) * 1.41421356f;
        panR_ = std::sin(a) * 1.41421356f;

        for (int i = 0; i < kMax; ++i) {
            const double hz = f0 * rat[i] + shiftHz;
            shownHz_[(size_t)i] = (float)hz;
            shownLevel_[(size_t)i] = level[i] * gain * (p.normalise ? 1.0f : kRawScale) * dsp::partials::bandLimitGain(hz, sampleRate_);
        }
    }

    double sampleRate_ = 48000.0, sinceStrike_ = 0.0;
    dsp::PartialBank banks_[3];
    const AdditiveDrawn* drawn_ = nullptr;
    float norm_ = -1.0f, normSmooth_ = 0.03f, panL_ = 1.0f, panR_ = 1.0f;
    int counter_ = 0;
    uint32_t seed_ = 1;
    bool random_ = true, struck_ = false;
    std::array<float, kMax> shownLevel_{}, shownHz_{};
};

}  // namespace bleep::patch
