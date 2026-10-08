// SPDX-License-Identifier: MIT
// Oscillator: a triangle-core oscillator with waveform morph, through-zero FM,
// hard sync and a sub octave. Saw and square are band-limited (polyBLEP).
// Through-zero FM: the phase runs backwards when the instantaneous frequency
// goes negative, so deep linear FM stays in tune.
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::patch {

struct OscillatorParams {
    float pitch = 0.0f;      ///< octaves relative to C4 (1 V/oct): octave + semitones + cents + input
    float shape = 0.5f;      ///< morph: 0 sine, 1/3 triangle, 2/3 saw, 1 square
    float pulseWidth = 0.5f; ///< 0.05..0.95, for the square
    float fmDepth = 0.0f;    ///< 0..1: linear through-zero FM index (×4)
};

struct OscillatorFrame {
    float out, sine, triangle, saw, square, sub;
};

class OscillatorDsp {
public:
    static constexpr double kC4 = 261.6255653005986;

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        phase_ = 0.0;
        sub_ = 1.0f;
        lastSync_ = false;
    }

    static float frequency(float pitchOctaves) noexcept { return (float)(kC4 * std::exp2((double)pitchOctaves)); }

    /// One sample. `fm` is the FM input (audio, ±1), `sync` the sync input (gate).
    OscillatorFrame tick(const OscillatorParams& p, float fm, float sync) noexcept {
        const bool syncHigh = sync >= 0.5f;
        if (syncHigh && !lastSync_) phase_ = 0.0;
        lastSync_ = syncHigh;

        const double f0 = frequency(p.pitch);
        const double f = f0 * (1.0 + 4.0 * (double)p.fmDepth * (double)fm);  // through zero when negative
        const double dt = std::clamp(f / sampleRate_, -0.49, 0.49);
        const double adt = std::max(std::fabs(dt), 1e-9);

        const double ph = phase_;
        const float pw = std::clamp(p.pulseWidth, 0.05f, 0.95f);
        OscillatorFrame o;
        o.sine = (float)std::sin(2.0 * 3.14159265358979323846 * ph);
        o.triangle = (float)(ph < 0.5 ? 4.0 * ph - 1.0 : 3.0 - 4.0 * ph);
        o.saw = (float)(2.0 * ph - 1.0 - blep(ph, adt));
        double sq = ph < pw ? 1.0 : -1.0;
        sq += blep(ph, adt);
        sq -= blep(wrap(ph - pw), adt);
        o.square = (float)sq;
        o.sub = sub_;

        const float m = std::clamp(p.shape, 0.0f, 1.0f) * 3.0f;
        const float waves[4] = {o.sine, o.triangle, o.saw, o.square};
        const int i = std::min((int)m, 2);
        const float t = m - (float)i;
        o.out = waves[i] + t * (waves[i + 1] - waves[i]);

        // Advance; the sub flips every time the core wraps forwards.
        double next = ph + dt;
        if (next >= 1.0) {
            next -= 1.0;
            sub_ = -sub_;
        } else if (next < 0.0) {
            next += 1.0;
        }
        phase_ = next;
        return o;
    }

private:
    static double wrap(double x) noexcept { return x - std::floor(x); }
    /// polyBLEP residual for a discontinuity at phase 0.
    static double blep(double t, double dt) noexcept {
        if (t < dt) {
            t /= dt;
            return t + t - t * t - 1.0;
        }
        if (t > 1.0 - dt) {
            t = (t - 1.0) / dt;
            return t * t + t + t + 1.0;
        }
        return 0.0;
    }

    double sampleRate_ = 48000.0;
    double phase_ = 0.0;
    float sub_ = 1.0f;
    bool lastSync_ = false;
};

}  // namespace bleep::patch
