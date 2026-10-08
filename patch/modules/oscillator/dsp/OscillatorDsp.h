// SPDX-License-Identifier: MIT
// Oscillator: a triangle-core oscillator with waveform morph, through-zero FM,
// hard sync and a sub octave. Saw and square are band-limited (polyBLEP).
// Through-zero FM: the phase runs backwards when the instantaneous frequency
// goes negative, so deep linear FM stays in tune. The core itself is the
// shared dsp::OscCore (common/dsp/OscCore.h).
#pragma once

#include "dsp/OscCore.h"

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
    static constexpr double kC4 = dsp::osc::kC4Hz;

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        core_.reset();
        lastSync_ = false;
    }

    static float frequency(float pitchOctaves) noexcept { return (float)dsp::osc::pitchToHz((double)pitchOctaves); }

    /// One sample. `fm` is the FM input (audio, ±1), `sync` the sync input (gate).
    OscillatorFrame tick(const OscillatorParams& p, float fm, float sync) noexcept {
        const bool syncHigh = sync >= 0.5f;
        if (syncHigh && !lastSync_) core_.hardSync();
        lastSync_ = syncHigh;

        const double f0 = frequency(p.pitch);
        const double f = dsp::osc::linearFm(f0, (double)p.fmDepth, (double)fm);  // through zero when negative
        const double dt = std::clamp(f / sampleRate_, -0.49, 0.49);

        const dsp::OscWaves w = core_.waves(dt, p.pulseWidth);
        core_.advance(dt);
        return {dsp::OscCore::morph(w, p.shape), w.sine, w.triangle, w.saw, w.square, w.sub};
    }

private:
    double sampleRate_ = 48000.0;
    dsp::OscCore core_;
    bool lastSync_ = false;
};

}  // namespace bleep::patch
