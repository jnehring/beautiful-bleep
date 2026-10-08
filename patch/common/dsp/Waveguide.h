// SPDX-License-Identifier: MIT
// Plucked and struck strings in the Karplus-Strong family, and a set of
// sympathetic strings (specs/modules/resonator.md 4.3 and 4.4, the Macro
// Osc's Pluck). One delay line closed by a loop of: a first-order allpass
// for the fractional delay, a one-pole low-pass (brightness), four
// first-order allpasses (dispersion / stiffness) and a DC blocker. The phase
// delay of the whole loop at f0 is computed exactly and subtracted, and the
// fractional allpass is solved exactly at f0, so the string is in tune to a
// fraction of a cent up to several kHz. The loop gain is compensated for the
// filter's loss at f0, so the T60 asked for is the T60 you get.
//
// Memory is allocated in prepare(); process() never allocates.
#pragma once

#include "Random.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdint>
#include <vector>

namespace bleep::dsp {

/// Circular delay line with integer, linear and 4-point Lagrange reads.
/// read(d) with d = 1 is the most recently written sample.
class DelayLine {
public:
    /// Allocates room for delays up to maxDelay samples (not RT-safe).
    void prepare(int maxDelay) {
        size_t n = 8;
        while (n < (size_t)maxDelay + 8) n <<= 1;
        buf_.assign(n, 0.0f);
        mask_ = n - 1;
        pos_ = 0;
    }
    void reset() noexcept { std::fill(buf_.begin(), buf_.end(), 0.0f); }
    int maxDelay() const noexcept { return (int)buf_.size() - 8; }

    void write(float x) noexcept {
        buf_[pos_] = x;
        pos_ = (pos_ + 1) & mask_;
    }
    float read(int d) const noexcept { return buf_[(pos_ - (size_t)d) & mask_]; }
    float readLinear(float d) const noexcept {
        const int i = (int)d;
        const float t = d - (float)i;
        const float a = read(i), b = read(i + 1);
        return a + t * (b - a);
    }
    /// Third-order Lagrange; d ≥ 1.
    float readLagrange(float d) const noexcept {
        const int i = std::max((int)d - 1, 0);
        const float t = d - (float)i;  // 0..2 typically 1..2, points at i … i+3
        const float x0 = read(i), x1 = read(i + 1), x2 = read(i + 2), x3 = read(i + 3);
        const float d0 = t, d1 = t - 1.0f, d2 = t - 2.0f, d3 = t - 3.0f;
        return -x0 * d1 * d2 * d3 * (1.0f / 6.0f) + x1 * d0 * d2 * d3 * 0.5f - x2 * d0 * d1 * d3 * 0.5f +
               x3 * d0 * d1 * d2 * (1.0f / 6.0f);
    }

private:
    std::vector<float> buf_;
    size_t mask_ = 0, pos_ = 0;
};

namespace waveguide {

constexpr double kPi = 3.14159265358979323846;

/// First-order allpass (a + z⁻¹) / (1 + a z⁻¹), one state.
struct Allpass1 {
    float s = 0.0f;
    float process(float x, float a) noexcept {
        const float y = a * x + s;
        s = x - a * y;
        return y;
    }
};

/// Phase delay (samples) of Allpass1 with coefficient a at w rad/sample.
inline double allpassDelay(double a, double w) noexcept {
    return 1.0 - 2.0 * std::atan2(a * std::sin(w), 1.0 + a * std::cos(w)) / w;
}

/// Coefficient of Allpass1 whose phase delay at w is exactly d samples
/// (0 < d, w · (1 + d) < 2π). For d near 1 it is close to Thiran's (1−d)/(1+d).
inline double allpassForDelay(double d, double w) noexcept {
    return std::sin(0.5 * w * (1.0 - d)) / std::sin(0.5 * w * (1.0 + d));
}

}  // namespace waveguide

struct StringParams {
    float hz = 220.0f;
    float t60 = 2.0f;          ///< seconds, decay of the fundamental
    float brightness = 0.6f;   ///< 0..1: loop low-pass from 2 · f0 to open
    float dispersion = 0.0f;   ///< 0..1: stiffness (piano wire … metal bar)
    float position = 0.3f;     ///< 0..1: pluck / pickup point (0.5 cancels even harmonics)
};

/// One plucked string. process(excite) adds the excitation (combed by the
/// position) into the loop and returns the string's output.
class WaveguideString {
public:
    /// Allocates for pitches down to minHz (not RT-safe). positionComb
    /// false skips the excitation comb and its memory (sympathetic strings).
    void prepare(double sampleRate, float minHz = 16.0f, bool positionComb = true) {
        sr_ = sampleRate;
        minHz_ = std::max(minHz, 1.0f);
        const int maxDelay = (int)std::ceil(sr_ / minHz_) + 8;
        line_.prepare(maxDelay);
        comb_ = positionComb;
        if (comb_) input_.prepare(maxDelay);
        dcR_ = (float)(1.0 - 2.0 * waveguide::kPi * 5.0 / sr_);
        hz_ = -1.0f;
        reset();
    }
    void reset() noexcept {
        line_.reset();
        if (comb_) input_.reset();
        frac_.s = lpZ_ = dcX_ = dcY_ = out_ = 0.0f;
        for (auto& d : disp_) d.s = 0.0f;
    }

    /// Recomputes the loop. A handful of trig calls: once per sub-block is
    /// plenty, per sample works too.
    void set(const StringParams& p) noexcept {
        if (!(differs(p.hz, hz_) || differs(p.t60, t60_) || differs(p.brightness, bright_) ||
              differs(p.dispersion, disp_amt_) || differs(p.position, pos_)))
            return;
        hz_ = p.hz;
        t60_ = p.t60;
        bright_ = p.brightness;
        disp_amt_ = p.dispersion;
        pos_ = std::clamp(p.position, 0.0f, 1.0f);

        const double f0 = std::clamp((double)hz_, (double)minHz_, 0.45 * sr_);
        const double w = 2.0 * waveguide::kPi * f0 / sr_;
        const double period = sr_ / f0;
        period_ = (float)period;

        // DC blocker, normalised to unit gain at Nyquist.
        const double R = dcR_;
        const double dcNorm = 0.5 * (1.0 + R);
        const std::complex<double> zi = std::polar(1.0, -w);  // z⁻¹ at w
        const std::complex<double> hDc = dcNorm * (1.0 - zi) / (1.0 - R * zi);

        // Loop gain for the asked T60, then the darkest low-pass that
        // still allows it (a long T60 can't be darker than its own loss).
        const double gT = std::pow(10.0, -3.0 / (std::max((double)t60_, 1e-3) * f0));
        const double gMax = 0.99999;
        const double b = std::clamp((double)bright_, 0.0, 1.0);
        const double fc = std::min(2.0 * f0 * std::pow(0.5 * sr_ / (2.0 * f0), b), 0.5 * sr_);
        double pole = std::exp(-2.0 * waveguide::kPi * fc / sr_) * (1.0 - b * b * b);
        const double hNeed = std::min(gT / gMax / std::abs(hDc), 1.0);
        if (hNeed < 1.0) {
            const double h2 = hNeed * hNeed, c = std::cos(w);
            const double B = 1.0 - h2 * c, A = 1.0 - h2;
            const double pMax = (B - std::sqrt(std::max(B * B - A * A, 0.0))) / A;
            pole = std::min(pole, pMax);
        } else {
            pole = 0.0;
        }
        lpP_ = (float)pole;
        const std::complex<double> hLp = (1.0 - pole) / (1.0 - pole * zi);
        g_ = (float)std::min(gT / std::abs(hLp * hDc), gMax);

        // Phase delay of the fixed part of the loop at f0.
        const double fixedDelay = -std::arg(hLp * hDc) / w;
        // Dispersion: four allpasses with a negative coefficient delay low
        // frequencies more than high ones, so upper partials go sharp. Back
        // off if their delay doesn't fit in the period.
        double a = -0.92 * std::pow(std::clamp((double)disp_amt_, 0.0, 1.0), 0.7);
        double dispDelay = 0.0;
        for (int tries = 0; tries < 12; ++tries) {
            dispDelay = a < 0.0 ? 4.0 * waveguide::allpassDelay(a, w) : 0.0;
            if (period - fixedDelay - dispDelay >= 2.0) break;
            a *= 0.6;
            if (tries == 11) a = 0.0, dispDelay = 0.0;
        }
        dispA_ = (float)a;
        const double rest = std::max(period - fixedDelay - dispDelay, 1.5);
        const double n = std::floor(rest - 0.5);
        n_ = std::max((int)n, 1);
        const double d = rest - (double)n_;
        fracA_ = (float)waveguide::allpassForDelay(d, w);
        combDelay_ = std::max(pos_ * period_, 1.0f);
    }

    /// One sample: `excite` is added to the loop (after the position comb).
    float process(float excite) noexcept {
        float x = excite;
        if (comb_) {
            input_.write(excite);
            x = excite - input_.readLinear(combDelay_ + 1.0f) * kCombDepth;
        }
        float v = line_.read(n_);
        v = frac_.process(v, fracA_);
        v = (1.0f - lpP_) * v + lpP_ * lpZ_;
        lpZ_ = v;
        if (dispA_ < 0.0f)
            for (auto& d : disp_) v = d.process(v, dispA_);
        const float y = dcNorm() * (v - dcX_) + dcR_ * dcY_;
        dcX_ = v;
        dcY_ = y;
        float s = g_ * y + x;
        if (std::fabs(s) < 1e-18f) s = 0.0f;
        line_.write(s);
        out_ = s;
        return s;
    }

    /// Two pickups at position · period and (1 − position) · period behind
    /// the excitation point; different phases of the same string, for a
    /// wide stereo pair.
    void pickups(float& a, float& b) const noexcept {
        a = line_.readLagrange(std::max(pos_ * period_, 1.0f));
        b = line_.readLagrange(std::max((1.0f - pos_) * period_, 1.0f));
    }
    float output() const noexcept { return out_; }
    /// Loop gain per round trip at f0 (for input normalisation).
    float loopGain() const noexcept { return std::pow(10.0f, -3.0f / (std::max(t60_, 1e-3f) * hz_)); }
    float periodSamples() const noexcept { return period_; }

private:
    static constexpr float kCombDepth = 0.95f;
    static bool differs(float a, float b) noexcept { return a < b || a > b; }
    float dcNorm() const noexcept { return 0.5f * (1.0f + dcR_); }

    double sr_ = 48000.0;
    float minHz_ = 16.0f;
    bool comb_ = true;
    DelayLine line_, input_;
    waveguide::Allpass1 frac_;
    waveguide::Allpass1 disp_[4];
    float hz_ = -1.0f, t60_ = 0.0f, bright_ = 0.0f, disp_amt_ = 0.0f, pos_ = 0.0f;
    float period_ = 100.0f, combDelay_ = 1.0f;
    int n_ = 1;
    float fracA_ = 0.0f, lpP_ = 0.0f, dispA_ = 0.0f, g_ = 0.0f, dcR_ = 0.9993f;
    float lpZ_ = 0.0f, dcX_ = 0.0f, dcY_ = 0.0f, out_ = 0.0f;
};

/// Tunings of the sympathetic set (intervals above f0, semitones).
enum class StringTuning { Octaves, Fifths, Major, Minor, Sus, Add9, Unison, Inharmonic, Harmonic };

/// Eight intervals in semitones for a tuning. Inharmonic uses the seed.
inline void stringTuning(StringTuning t, uint64_t seed, float out[8]) noexcept {
    static constexpr float tables[][8] = {
        {0, 12, 24, 36, 0.03f, 12.03f, 24.03f, 36.03f},  // octaves, second four +3 cents
        {0, 7, 12, 19, 24, 31, 36, 43},                   // fifths
        {0, 4, 7, 12, 16, 19, 24, 28},                    // major
        {0, 3, 7, 12, 15, 19, 24, 27},                    // minor
        {0, 5, 7, 10, 12, 17, 19, 22},                    // sus / quartal
        {0, 7, 14, 16, 19, 23, 26, 28},                   // add9 spread
        {0, 0.04f, -0.04f, 0.08f, -0.08f, 0.12f, -0.12f, 0.16f},  // detuned unisons
    };
    switch (t) {
        case StringTuning::Inharmonic:
            out[0] = 0.0f;
            for (int i = 1; i < 8; ++i)
                out[i] = 12.0f * std::log2(1.1f + 4.9f * (float)uniform01(seed, (uint64_t)i, 7));
            return;
        case StringTuning::Harmonic:
            for (int i = 0; i < 8; ++i) out[i] = 12.0f * std::log2((float)(i + 1));
            return;
        default:
            for (int i = 0; i < 8; ++i) out[i] = tables[(int)t][i];
    }
}

/// Up to eight strings with no excitation of their own, fed by an input
/// through a gentle 300 Hz high-pass so they ring in sympathy with whatever
/// matches their tuning. Odd strings (1, 3, …) go to `odd`, even to `even`.
class SympatheticStrings {
public:
    static constexpr int kMaxStrings = 8;
    struct Out {
        float odd, even;
        float mix() const noexcept { return odd + even; }
    };

    /// Allocates (not RT-safe).
    void prepare(double sampleRate, float minHz = 16.0f) {
        sr_ = sampleRate;
        for (auto& s : strings_) s.prepare(sampleRate, minHz, false);
        hpA_ = (float)std::exp(-2.0 * waveguide::kPi * 300.0 / sampleRate);
        reset();
    }
    void reset() noexcept {
        for (auto& s : strings_) s.reset();
        hpX_ = hpY_ = 0.0f;
    }
    void setCount(int n) noexcept { count_ = std::clamp(n, 1, kMaxStrings); }
    void setTuning(StringTuning t, uint64_t seed = 1) noexcept { stringTuning(t, seed, semis_); }
    /// Custom intervals (semitones above f0), up to eight.
    void setIntervals(const float* semis, int n) noexcept {
        count_ = std::clamp(n, 1, kMaxStrings);
        for (int i = 0; i < count_; ++i) semis_[i] = semis[i];
    }

    /// f0, decay, brightness and pickup position shared by all strings.
    /// Each string's input is scaled by (1 − loop gain), so a steady sine in
    /// tune with a string comes out of it at about the input level.
    void set(float f0Hz, float t60, float brightness, float position) noexcept {
        for (int i = 0; i < count_; ++i) {
            StringParams p;
            p.hz = std::min(f0Hz * std::exp2(semis_[i] / 12.0f), 0.45f * (float)sr_);
            p.t60 = t60;
            p.brightness = brightness;
            p.position = position;
            strings_[i].set(p);
            inGain_[i] = 1.0f - strings_[i].loopGain();
        }
    }

    Out process(float in) noexcept {
        // One-pole high-pass at 300 Hz.
        const float hp = 0.5f * (1.0f + hpA_) * (in - hpX_) + hpA_ * hpY_;
        hpX_ = in;
        hpY_ = hp;
        float odd = 0.0f, even = 0.0f;
        for (int i = 0; i < count_; ++i) {
            const float y = strings_[i].process(hp * inGain_[i]);
            if (i % 2 == 0) odd += y;
            else even += y;
        }
        return {odd, even};
    }
    const WaveguideString& string(int i) const noexcept { return strings_[i]; }

private:
    double sr_ = 48000.0;
    WaveguideString strings_[kMaxStrings];
    float semis_[kMaxStrings] = {0, 12, 24, 36, 0.03f, 12.03f, 24.03f, 36.03f};
    float inGain_[kMaxStrings] = {};
    int count_ = kMaxStrings;
    float hpA_ = 0.96f, hpX_ = 0.0f, hpY_ = 0.0f;
};

}  // namespace bleep::dsp
