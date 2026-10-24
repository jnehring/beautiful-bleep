// SPDX-License-Identifier: GPL-3.0-only
// Macro Osc (doc/specs/modules/macro-oscillator.md): what every model sees. The
// engine (MacroOscDsp.h) fills a MacroIn per sample; a model returns its Out
// and Aux. Models are plain structs with
//
//     void prepare(double sampleRate);   // may allocate
//     void reset();                      // clears state (not RT-critical)
//     void activate();                   // selected again: clear what would click
//     void control(const MacroIn&);      // every kControl samples, on activation and strikes
//     MacroOut tick(const MacroIn&);     // one sample
//
// and, where they use noise, reseed(seed) (a pure function of Seed and voice).
#pragma once

#include "dsp/OscCore.h"
#include "dsp/Partials.h"
#include "dsp/Vactrol.h"
#include "dsp/Random.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch::macro {

constexpr int kModels = 16;
constexpr int kControl = 16;  ///< samples between control updates

enum Model : int {
    VaPair = 0, Fold, Fm, PhaseWarp, Grain, Harmonic, Table, Chord, Vowel,  // pitched
    NoiseBand, Dust,                                                         // noise
    Pluck, Modal, Kick, Snare, Metal,                                        // struck
};

/// Models whose *f* is a playable pitch that FM modulates (the rest use FM as Tone modulation).
constexpr bool usesFm(int m) noexcept { return m <= Vowel || m == Pluck || m == Modal; }
/// Struck models: excited by Trigger, their own decays shape them (no low-pass gate).
constexpr bool isStruck(int m) noexcept { return m >= Pluck; }
/// Drum models: silent without a trigger; Tone is latched at each strike.
constexpr bool isDrum(int m) noexcept { return m >= Kick; }
/// Models whose Out is periodic at f (the scope triggers on its rising zero crossing).
constexpr bool isPeriodic(int m) noexcept { return m <= Vowel || m == Pluck || m == Modal; }

struct MacroIn {
    double hz = dsp::osc::kC4Hz;      ///< signed frequency with FM (pitched models)
    double baseHz = dsp::osc::kC4Hz;  ///< frequency without FM, > 0
    double sampleRate = 48000.0;
    float tone = 0.5f, shape = 0.5f, blend = 0.0f;  ///< 0..1 (Tone includes FM for unpitched models)
    float decay = 0.4f;   ///< seconds (T60)
    float accent = 1.0f;  ///< strike strength, 0..1
    bool strike = false;  ///< Trigger fired at this sample
    bool gated = false;   ///< Trigger is patched
    bool wantAux = true;  ///< something reads Aux
    int os = 2;           ///< oversampling factor 1, 2, 4 (Quality)
    int modes = 16;       ///< Modal: 8, 16, 24 (Quality)
};

struct MacroOut {
    float out = 0.0f, aux = 0.0f;
};

/// Per-sample multiplier that falls by 60 dB in t60 seconds.
inline float t60Coef(float t60, double sampleRate) noexcept {
    return (float)std::exp(-6.907755278982137 / (std::max((double)t60, 1e-4) * sampleRate));
}

/// sin(2π p) for any p (the Partials polynomial after wrapping, |error| < 1e-6).
inline float sin2pi(double p) noexcept { return dsp::partials::sin2pi((float)(p - std::floor(p))); }

/// Smoothstep of x over [a, b].
inline float smooth(float x, float a, float b) noexcept {
    const float t = std::clamp((x - a) / (b - a), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

/// A seeded xorshift32 stream for one model (repeats for a given Seed and voice).
class Rng {
public:
    void seed(uint64_t s) noexcept { s_ = (uint32_t)(dsp::mix64(s) >> 16) | 1u; }
    float bipolar() noexcept {  // [−1, 1)
        s_ ^= s_ << 13;
        s_ ^= s_ >> 17;
        s_ ^= s_ << 5;
        return (float)(int32_t)s_ * (1.0f / 2147483648.0f);
    }
    float unit() noexcept { return 0.5f * bipolar() + 0.5f; }  // [0, 1)

private:
    uint32_t s_ = 0x1234567u;
};

/// A zero-delay-feedback 2-pole low-pass with a cheap per-sample cutoff
/// (Padé tan), for the low-pass gate; two channels share coefficients.
class GateFilter {
public:
    void reset() noexcept { s1_[0] = s2_[0] = s1_[1] = s2_[1] = 0.0f; }
    void set(float hz, double sampleRate, float q = 0.7f) noexcept {
        g_ = dsp::LowPassGate::fastTan(3.14159265f * std::clamp(hz, 10.0f, 0.45f * (float)sampleRate) / (float)sampleRate);
        k_ = 1.0f / q;
        a1_ = 1.0f / (1.0f + g_ * (g_ + k_));
        a2_ = g_ * a1_;
        a3_ = g_ * a2_;
    }
    float process(float x, int ch) noexcept {
        const float v3 = x - s2_[ch];
        const float v1 = a1_ * s1_[ch] + a2_ * v3;
        const float v2 = s2_[ch] + a2_ * s1_[ch] + a3_ * v3;
        s1_[ch] = 2.0f * v1 - s1_[ch];
        s2_[ch] = 2.0f * v2 - s2_[ch];
        return v2;
    }

private:
    float g_ = 1.0f, k_ = 1.4f, a1_ = 0.0f, a2_ = 0.0f, a3_ = 0.0f;
    float s1_[2] = {}, s2_[2] = {};
};

}  // namespace bleep::patch::macro
