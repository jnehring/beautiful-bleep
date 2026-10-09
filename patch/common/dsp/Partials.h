// SPDX-License-Identifier: MIT
// An additive bank of up to 64 sine partials, for the Additive Osc
// (doc/specs/modules/additive-oscillator.md), the Macro Osc's Harmonic model and
// the Swarm. Each partial has a float phase (re-wrapped every sample) and a
// polynomial sine, so a sample costs a few multiply-adds per partial and the
// loop vectorises; no std::sin in the audio path.
//
// Split of work:
// - control rate (every sub-block, e.g. 32 samples): setPartials() takes the
//   ratios and levels (build them with the helpers below: base shape, tilt,
//   odd/even, count, stretch), applies the seeded chorus detune, fades partials
//   out between 0.40 and 0.45 × fs (and below 0 Hz) and drops silent ones;
// - audio rate: process*(f0) advances every active partial at f0 × ratio +
//   shift, so pitch FM is exact for harmonic spectra. Levels are smoothed
//   (2 ms one-pole), so they can be changed every sub-block without zipper.
#pragma once

#include "OscCore.h"
#include "Random.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

namespace partials {

constexpr int kMax = 64;

/// sin(2π p) for p in [0, 1): folded to a quarter wave, then an odd Taylor
/// polynomial to x¹¹ (|error| < 1e-6, about −120 dB).
inline float sin2pi(float p) noexcept {
    const float t = p - 0.5f;  // sin(2π p) = −sin(2π t), t in [−0.5, 0.5)
    const float a = std::fabs(t);
    const float u = std::copysign(std::min(a, 0.5f - a), t);
    const float x = 6.28318530717958647692f * u, x2 = x * x;
    const float s = x * (1.0f + x2 * (-1.0f / 6.0f + x2 * (1.0f / 120.0f + x2 * (-1.0f / 5040.0f +
                                                                                   x2 * (1.0f / 362880.0f + x2 * (-1.0f / 39916800.0f))))));
    return -s;
}

enum class Base {
    Saw,     ///< 1/n
    Square,  ///< 1/n, odd n only
    Flat,    ///< 1/√n: even energy per octave
};

/// Level of partial n (1-based) for a base shape.
inline float baseLevel(Base base, int n) noexcept {
    switch (base) {
        case Base::Square: return n % 2 ? 1.0f / (float)n : 0.0f;
        case Base::Flat: return 1.0f / std::sqrt((float)n);
        case Base::Saw:
        default: return 1.0f / (float)n;
    }
}

/// Spectral tilt in dB per octave of partial number: 10^(tilt·log2 n / 20).
inline float tiltGain(int n, float dbPerOctave) noexcept {
    return std::pow(10.0f, dbPerOctave * std::log2((float)n) / 20.0f);
}

/// Odd/even balance, −1 odd only … 0 all … +1 even only (the fundamental stays).
inline float oddEvenGain(int n, float balance) noexcept {
    if (n == 1) return 1.0f;
    return n % 2 == 0 ? std::clamp(1.0f + balance, 0.0f, 1.0f) : std::clamp(1.0f - balance, 0.0f, 1.0f);
}

/// Fractional partial count: 1 up to floor(count), the fraction for the next.
inline float countGain(int n, float count) noexcept { return std::clamp(count - (float)(n - 1), 0.0f, 1.0f); }

/// Inharmonic stretch, s in −1..+1: s ≥ 0 stiff-string n·√(1 + B n²) with
/// B = 0.0005·s², s < 0 compressed n^(1 + 0.3 s). Partial 1 stays at 1.
inline float stretchRatio(int n, float s) noexcept {
    if (s >= 0.0f) {
        const float b = 0.0005f * s * s;
        const float r = (float)n * std::sqrt(1.0f + b * (float)(n * n));
        return r / std::sqrt(1.0f + b);  // keep partial 1 at the fundamental
    }
    return std::pow((float)n, 1.0f + 0.3f * s);
}

/// Band-limit gain for a partial at `hz`: 1 below 0.40 fs, raised-cosine fade
/// to 0 at 0.45 fs, 0 above; also fades out over its last 20 Hz above 0 Hz.
inline float bandLimitGain(double hz, double sampleRate) noexcept {
    if (hz <= 0.0) return 0.0f;
    const double lo = 0.40 * sampleRate, hi = 0.45 * sampleRate;
    double g = hz <= lo ? 1.0 : hz >= hi ? 0.0 : 0.5 + 0.5 * std::cos(3.14159265358979323846 * (hz - lo) / (hi - lo));
    if (hz < 20.0) g *= hz / 20.0;
    return (float)g;
}

}  // namespace partials

class PartialBank {
public:
    static constexpr int kMax = partials::kMax;

    enum class PhaseMode {
        Aligned,  ///< all partials start at sine phase 0: the sharp, true saw shape
        Random,   ///< seeded start phases: low crest factor
    };

    PartialBank() noexcept {
        for (int i = 0; i < kMax; ++i) setPan(i, 0.0f);
        prepare(48000.0);
        reset();
    }

    void prepare(double sampleRate, float smoothMs = 2.0f) noexcept {
        sampleRate_ = sampleRate;
        smooth_ = 1.0f - (float)std::exp(-1.0 / (std::max(smoothMs, 0.01f) * 1e-3 * sampleRate));
        for (auto& d : drift_) d.prepare(sampleRate, chorusRate_);
    }

    /// Clears levels, sets the start phases and rewinds the chorus walks.
    /// `seed`/`voice` make the random phases and the chorus repeatable.
    void reset(PhaseMode mode = PhaseMode::Aligned, uint64_t seed = 0, uint64_t voice = 0) noexcept {
        mode_ = mode;
        seed_ = seed;
        voice_ = voice;
        for (int i = 0; i < kMax; ++i) {
            amp_[i] = target_[i] = 0.0f;
            ratio_[i] = baseRatio_[i] = (float)(i + 1);
            drift_[(size_t)i].reset(seed, voice * 1024 + (uint64_t)i);
        }
        active_ = 0;
        sinceUpdate_ = 0;
        retrigger();
    }
    /// Phases back to their start values (a Trigger).
    void retrigger() noexcept {
        for (int i = 0; i < kMax; ++i)
            phase_[i] = mode_ == PhaseMode::Aligned ? 0.0f : (float)uniform01(seed_, (uint64_t)i, 0x9a5e0000ull + voice_);
    }

    /// Chorus: a slow seeded random detune per partial, ±depthCents (the
    /// fundamental gets half), wandering at about rateHz.
    void setChorus(float depthCents, float rateHz) noexcept {
        chorusCents_ = std::max(depthCents, 0.0f);
        if (rateHz < chorusRate_ || rateHz > chorusRate_) {
            chorusRate_ = rateHz;
            for (auto& d : drift_) d.setRate(rateHz);
        }
    }

    /// Constant-power pan per partial, −1 (left) … +1 (right), for processStereo.
    void setPan(int i, float pan) noexcept {
        if (i < 0 || i >= kMax) return;
        const float a = (std::clamp(pan, -1.0f, 1.0f) + 1.0f) * 0.25f * 3.14159265358979f;
        panL_[i] = std::cos(a) * 1.41421356f;
        panR_[i] = std::sin(a) * 1.41421356f;
    }

    /// Control-rate update: `count` partials with frequency ratios (to f0) and
    /// linear levels. f0Hz is the fundamental the band limit is checked
    /// against, shiftHz is added to every partial (inharmonic shift).
    void setPartials(const float* ratios, const float* levels, int count, double f0Hz, double shiftHz = 0.0) noexcept {
        count = std::clamp(count, 0, kMax);
        shiftInc_ = (float)(shiftHz / sampleRate_);
        const int elapsed = std::max(sinceUpdate_, 1);
        sinceUpdate_ = 0;
        int active = 0;
        for (int i = 0; i < kMax; ++i) {
            float target = 0.0f;
            if (i < count) {
                baseRatio_[i] = ratios[i];
                float r = ratios[i];
                const float d = drift_[(size_t)i].advance(elapsed);
                if (chorusCents_ > 0.0f) r *= std::exp2((i == 0 ? 0.5f : 1.0f) * chorusCents_ * d / 1200.0f);
                ratio_[i] = r;
                const double hz = std::fabs(f0Hz) * r + shiftHz;
                target = levels[i] * partials::bandLimitGain(hz, sampleRate_);
                if (hz >= 0.5 * sampleRate_) amp_[i] = 0.0f;  // jumped past Nyquist: drop at once
            }
            target_[i] = target;
            if (target > 0.0f || std::fabs(amp_[i]) > 1e-6f) active = i + 1;
            else amp_[i] = 0.0f;
        }
        active_ = active;
    }

    /// Partials currently computed (the rest cost nothing).
    int activeCount() const noexcept { return active_; }
    /// Current (smoothed) level of partial i.
    float level(int i) const noexcept { return i >= 0 && i < kMax ? amp_[i] : 0.0f; }
    /// Frequency ratio in use for partial i, chorus included.
    float ratio(int i) const noexcept { return i >= 0 && i < kMax ? ratio_[i] : 0.0f; }

    /// One mono sample at fundamental f0Hz.
    float process(double f0Hz) noexcept {
        const float inc0 = (float)(f0Hz / sampleRate_);
        float sum = 0.0f;
        for (int i = 0; i < active_; ++i) sum += step(i, inc0);
        ++sinceUpdate_;
        return sum;
    }
    /// One sample panned per partial (setPan).
    void processStereo(double f0Hz, float& left, float& right) noexcept {
        const float inc0 = (float)(f0Hz / sampleRate_);
        float l = 0.0f, r = 0.0f;
        for (int i = 0; i < active_; ++i) {
            const float y = step(i, inc0);
            l += panL_[i] * y;
            r += panR_[i] * y;
        }
        ++sinceUpdate_;
        left = l, right = r;
    }
    /// One sample split into odd (1, 3, 5 …) and even (2, 4 …) partials.
    void processOddEven(double f0Hz, float& odd, float& even) noexcept {
        const float inc0 = (float)(f0Hz / sampleRate_);
        float o = 0.0f, e = 0.0f;
        for (int i = 0; i < active_; ++i) (i % 2 == 0 ? o : e) += step(i, inc0);
        ++sinceUpdate_;
        odd = o, even = e;
    }

    /// √(Σ level²) of a level array: divide by it to normalise loudness.
    static float norm(const float* levels, int count) noexcept {
        float s = 0.0f;
        for (int i = 0; i < count; ++i) s += levels[i] * levels[i];
        return std::sqrt(s);
    }

private:
    /// Partial i at its current phase, then advanced.
    float step(int i, float inc0) noexcept {
        const float p = phase_[i];
        amp_[i] += (target_[i] - amp_[i]) * smooth_;
        const float y = amp_[i] * partials::sin2pi(p);
        const float next = p + inc0 * ratio_[i] + shiftInc_;
        phase_[i] = next - std::floor(next);
        return y;
    }

    double sampleRate_ = 48000.0;
    float smooth_ = 0.01f, shiftInc_ = 0.0f, chorusCents_ = 0.0f, chorusRate_ = 0.5f;
    PhaseMode mode_ = PhaseMode::Aligned;
    uint64_t seed_ = 0, voice_ = 0;
    int active_ = 0, sinceUpdate_ = 0;
    float phase_[kMax] = {}, amp_[kMax] = {}, target_[kMax] = {}, ratio_[kMax] = {}, baseRatio_[kMax] = {};
    float panL_[kMax] = {}, panR_[kMax] = {};
    OscDrift drift_[kMax];
};

}  // namespace bleep::dsp
