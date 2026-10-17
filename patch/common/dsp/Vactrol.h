// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// A photoresistive cell ("vactrol") and the low-pass gate built on it
// (doc/specs/modules/low-pass-gate.md). Light opens the cell almost at once; in
// the dark it recovers slowly, more slowly the darker it gets, and more
// slowly still after it has been lit long and bright. That is the organic,
// bright-then-dark decay of struck and plucked sounds.
//
// Two states:
//   c  (openness)  rises with τ_rise; falls with τ_fall = τ₀ · (1 + k (1 − c)²) · (1 + M · m)
//   m  (memory)    follows the light slowly (τ_mem rise / fall), so a short
//                  ping barely charges it while a long gate fills it and
//                  stretches the next fall by up to (1 + M)×.
// All times scale with setResponse() (0.25× … 4× from the LPG's knob).
// With the Classic cell at 1×: a 2 ms full flash opens c to ≈ 0.5 within
// 3 ms, and c^1.2 (the gain of the LPG's Both mode) falls 60 dB in ≈ 0.7 s.
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::dsp {

enum class VactrolCell { Fast, Classic, SlowMemory };

class Vactrol {
public:
    struct Times {
        float rise;      ///< τ_rise, seconds
        float fall;      ///< τ₀, seconds
        float darkSlow;  ///< k: how much slower the fall gets in the dark
        float memRise;   ///< seconds
        float memFall;   ///< seconds
        float memory;    ///< M: fall stretch after a long bright gate
    };
    static constexpr Times times(VactrolCell cell) noexcept {
        switch (cell) {
            case VactrolCell::Fast: return {0.001f, 0.012f, 3.0f, 0.15f, 0.5f, 1.0f};
            case VactrolCell::SlowMemory: return {0.006f, 0.060f, 5.0f, 0.6f, 3.0f, 3.0f};
            case VactrolCell::Classic:
            default: return {0.003f, 0.028f, 4.0f, 0.3f, 1.0f, 1.5f};
        }
    }
    /// The LPG's Response knob 0..1 → time scale 0.25 · 16^knob (0.5 = 1×).
    static float responseScale(float knob) noexcept {
        return 0.25f * std::exp2(4.0f * std::clamp(knob, 0.0f, 1.0f));
    }

    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        update();
    }
    void reset() noexcept { c_ = m_ = 0.0f; }
    void setCell(VactrolCell cell) noexcept {
        cell_ = cell;
        update();
    }
    /// Multiplies every time constant (1 = the cell's own speed).
    void setResponse(float scale) noexcept {
        scale_ = std::max(scale, 0.01f);
        update();
    }

    /// One sample of light (0..1.2, clamped) → openness c (0..1.2).
    float process(float light) noexcept {
        const float L = std::clamp(light, 0.0f, 1.2f);
        // Memory state.
        m_ += (L - m_) * (L > m_ ? memRiseA_ : memFallA_);
        // Openness.
        if (L > c_) {
            c_ += (L - c_) * riseA_;
        } else {
            const float dark = 1.0f - std::min(c_, 1.0f);
            const float tau = fallTau_ * (1.0f + k_ * dark * dark) * (1.0f + memory_ * m_);
            // 1 − exp(−x) by a Padé approximant: x ≤ 1/(τ₀ fs) is small here.
            const float x = 1.0f / tau;
            c_ += (L - c_) * (2.0f * x / (2.0f + x));
        }
        if (c_ < 1e-6f) c_ = 0.0f;
        if (m_ < 1e-6f) m_ = 0.0f;
        return c_;
    }
    float value() const noexcept { return c_; }
    float memory() const noexcept { return m_; }

private:
    void update() noexcept {
        const Times t = times(cell_);
        const double fs = sr_;
        auto coef = [&](float seconds) { return (float)(1.0 - std::exp(-1.0 / (seconds * scale_ * fs))); };
        riseA_ = coef(t.rise);
        memRiseA_ = coef(t.memRise);
        memFallA_ = coef(t.memFall);
        fallTau_ = (float)(t.fall * scale_ * fs);  // in samples
        k_ = t.darkSlow;
        memory_ = t.memory;
    }

    double sr_ = 48000.0;
    VactrolCell cell_ = VactrolCell::Classic;
    float scale_ = 1.0f;
    float riseA_ = 0.0f, memRiseA_ = 0.0f, memFallA_ = 0.0f, fallTau_ = 1000.0f, k_ = 4.0f, memory_ = 1.5f;
    float c_ = 0.0f, m_ = 0.0f;
};

enum class LpgMode { LP, VCA, Both };

/// Filter + VCA of a low-pass gate, both following the cell's openness c:
///
///   mode   gain              low-pass cutoff
///   LP     1                 f(c)
///   VCA    c^1.4             none
///   Both   c^1.2             f(c)
///
/// f(c) = fLow · (fMax / fLow)^(c^0.7), fLow = 30 Hz (up to 300 Hz with
/// bleed). Bleed adds 0.063 · bleed to the gain (−24 dB at full). The gain
/// never exceeds 1. The filter is a 2-pole TPT state-variable low-pass, Q
/// 0.5 … 6 from resonance, its cutoff updated every sample (a Padé tan,
/// accurate to 0.003 % below 0.45 fs). Stereo channels share coefficients.
class LowPassGate {
public:
    struct Params {
        LpgMode mode = LpgMode::Both;
        float resonance = 0.0f;   ///< 0..1
        float maxHz = 8000.0f;    ///< cutoff when fully open (Brightness: 1 k … 20 k)
        float bleed = 0.0f;       ///< 0..1
    };

    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        piOverFs_ = (float)(3.14159265358979323846 / sampleRate);
        reset();
    }
    void reset() noexcept {
        for (auto& s : s_) s[0] = s[1] = 0.0f;
    }
    void set(const Params& p) noexcept {
        p_ = p;
        const float r = std::clamp(p.resonance, 0.0f, 1.0f);
        k_ = 1.0f / (0.5f + 5.5f * r * r);
        comp_ = p.mode == LpgMode::Both ? 1.0f / (1.0f + 0.3f * r) : 1.0f;
        fLow_ = 30.0f + 270.0f * std::clamp(p.bleed, 0.0f, 1.0f);
        ratio_ = std::max(p.maxHz, fLow_) / fLow_;
        logRatio_ = std::log(ratio_);
    }

    float gain(float c) const noexcept {
        c = std::clamp(c, 0.0f, 1.0f);
        float g = 1.0f;
        if (p_.mode == LpgMode::VCA) g = std::pow(c, 1.4f);
        else if (p_.mode == LpgMode::Both) g = std::pow(c, 1.2f);
        if (p_.mode != LpgMode::LP) g += 0.063f * std::clamp(p_.bleed, 0.0f, 1.0f);
        return std::min(g, 1.0f) * comp_;
    }
    float cutoffHz(float c) const noexcept {
        c = std::clamp(c, 0.0f, 1.0f);
        return std::min(fLow_ * std::exp(logRatio_ * std::pow(c, 0.7f)), 0.45f * (float)sr_);
    }

    /// Mono: one sample through the gate at openness c.
    float process(float x, float c) noexcept {
        float l = x, r = 0.0f;
        run(&l, &r, 1, c);
        return l;
    }
    /// Stereo, in place.
    void process(float& l, float& r, float c) noexcept { run(&l, &r, 2, c); }

    /// Padé (5,4) approximation of tan, for 0 ≤ x < 1.42 (0.45 fs).
    static float fastTan(float x) noexcept {
        const float x2 = x * x;
        return x * (945.0f - 105.0f * x2 + x2 * x2) / (945.0f - 420.0f * x2 + 15.0f * x2 * x2);
    }

private:
    void run(float* l, float* r, int channels, float c) noexcept {
        const float g = gain(c);
        if (p_.mode == LpgMode::VCA) {
            *l *= g;
            *r *= g;
            return;
        }
        if (g <= 0.0f) {
            *l = *r = 0.0f;
            reset();
            return;
        }
        const float t = fastTan(cutoffHz(c) * piOverFs_);
        const float a1 = 1.0f / (1.0f + t * (t + k_));
        const float a2 = t * a1, a3 = t * a2;
        float* io[2] = {l, r};
        for (int ch = 0; ch < channels; ++ch) {
            float& ic1 = s_[ch][0];
            float& ic2 = s_[ch][1];
            const float v0 = *io[ch];
            const float v3 = v0 - ic2;
            const float v1 = a1 * ic1 + a2 * v3;
            const float v2 = ic2 + a2 * ic1 + a3 * v3;
            ic1 = 2.0f * v1 - ic1;
            ic2 = 2.0f * v2 - ic2;
            if (std::fabs(ic1) + std::fabs(ic2) < 1e-15f) ic1 = ic2 = 0.0f;
            *io[ch] = v2 * g;
        }
    }

    double sr_ = 48000.0;
    float piOverFs_ = 0.0f;
    Params p_;
    float k_ = 2.0f, comp_ = 1.0f, fLow_ = 30.0f, ratio_ = 266.0f, logRatio_ = 5.58f;
    float s_[2][2] = {};
};

}  // namespace bleep::dsp
