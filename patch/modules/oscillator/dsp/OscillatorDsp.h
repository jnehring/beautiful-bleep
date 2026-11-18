// SPDX-License-Identifier: GPL-3.0-only
// Oscillator: a triangle-core oscillator with a primary and a secondary waveform
// (Morph crossfades between them), linear FM (through zero or clamped at 0 Hz)
// or exponential FM, and hard sync. Saw and square are band-limited (polyBLEP).
// Through-zero FM: the phase runs backwards when the instantaneous frequency
// goes negative, so deep linear FM stays in tune. The core itself is the
// shared dsp::OscCore (common/dsp/OscCore.h).
#pragma once

#include "dsp/OscCore.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

/// The waveforms the Oscillator offers, in the order of its Waveform choices.
enum class OscWave { Sine, Triangle, Saw, Square };

struct OscillatorParams {
    float pitch = 0.0f;              ///< octaves relative to C4 (1 V/oct): octave + semitones + cents + input
    OscWave wave = OscWave::Saw;     ///< primary waveform (Morph 0)
    OscWave wave2 = OscWave::Square; ///< secondary waveform (Morph 1)
    float morph = 0.0f;              ///< 0..1: crossfade from wave to wave2
    float pulseWidth = 0.5f;         ///< 0.05..0.95, for the square
    float fmDepth = 0.0f;            ///< 0..1: linear FM index (×4), or ±4 octaves exponential
    bool expFm = false;              ///< exponential FM (in octaves, never below 0 Hz) instead of linear
    bool throughZero = true;         ///< linear FM: negative frequencies run the phase backwards; off: clamped at 0 Hz
    bool hardSync = true;            ///< rising edges at Sync restart the cycle
};

class OscillatorDsp {
public:
    static constexpr double kC4 = dsp::osc::kC4Hz;

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        core_.reset();
        lastSync_ = false;
    }

    static float frequency(float pitchOctaves) noexcept { return (float)dsp::osc::pitchToHz((double)pitchOctaves); }

    static float pick(const dsp::OscWaves& w, OscWave wave) noexcept {
        switch (wave) {
            case OscWave::Sine: return w.sine;
            case OscWave::Triangle: return w.triangle;
            case OscWave::Saw: return w.saw;
            case OscWave::Square: return w.square;
        }
        return w.saw;
    }

    /// The old single Shape knob (0 sine, 1/3 triangle, 2/3 saw, 1 square, neighbours crossfaded) as a
    /// Waveform / Secondary / Morph setting that sounds the same.
    static void setShape(OscillatorParams& p, float shape) noexcept {
        const float m = std::clamp(shape, 0.0f, 1.0f) * 3.0f;
        const int i = std::min((int)m, 2);
        p.wave = (OscWave)i;
        p.wave2 = (OscWave)(i + 1);
        p.morph = m - (float)i;
    }

    /// One sample. `fm` is the FM input (audio, ±1), `sync` the sync input (gate).
    float tick(const OscillatorParams& p, float fm, float sync) noexcept {
        const bool syncHigh = sync >= 0.5f;
        if (p.hardSync && syncHigh && !lastSync_) core_.hardSync();
        lastSync_ = syncHigh;

        const double f0 = frequency(p.pitch);
        double f;
        if (p.expFm) {
            f = dsp::osc::expFm(f0, (double)p.fmDepth, (double)fm);   // ±4 octaves at depth 1: always positive
        } else {
            f = dsp::osc::linearFm(f0, (double)p.fmDepth, (double)fm);  // through zero when negative
            if (!p.throughZero) f = std::max(f, 0.0);
        }
        const double dt = std::clamp(f / sampleRate_, -0.49, 0.49);

        const dsp::OscWaves w = core_.waves(dt, p.pulseWidth);
        core_.advance(dt);
        const float a = pick(w, p.wave), m = std::clamp(p.morph, 0.0f, 1.0f);
        if (m <= 0.0f || p.wave == p.wave2) return a;
        return a + m * (pick(w, p.wave2) - a);
    }

private:
    double sampleRate_ = 48000.0;
    dsp::OscCore core_;
    bool lastSync_ = false;
};

}  // namespace bleep::patch
