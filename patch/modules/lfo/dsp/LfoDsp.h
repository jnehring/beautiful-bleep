// SPDX-License-Identifier: MIT
// LFO core (doc/specs/modules/lfo.md): fixed waveforms, free or phase-locked to
// the song position, seeded random waves and a fade-in. Random values are a
// pure function of (seed, cycle), so synced renders repeat exactly. The waves
// and the phase accumulator are the shared ones in dsp/Waves.h.
#pragma once

#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"
#include "dsp/Waves.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum LfoWave {
    LfoSine = dsp::WaveSine,
    LfoTriangle = dsp::WaveTriangle,
    LfoSawUp = dsp::WaveSawUp,
    LfoSawDown = dsp::WaveSawDown,
    LfoSquare = dsp::WaveSquare,
    LfoRandomStep = dsp::WaveRandomStep,
    LfoRandomSmooth = dsp::WaveRandomSmooth,
    kLfoWaves = dsp::kWaveShapes
};

struct LfoParams {
    float rateHz = 1.0f;
    int sync = 0;              ///< dsp::syncNames() index; 0 = free
    float phase = 0.0f;        ///< 0..1 offset
    float pulseWidth = 0.5f;
    float fade = 0.0f;         ///< seconds
    int wave = LfoSine;
    bool unipolar = false;
    uint32_t seed = 1;
};

struct LfoTime {
    bool running = false;      ///< transport playing with a valid position
    bool started = false;      ///< first sample after the transport started
    double bpm = 120.0;
    double ppq = 0.0;
};

struct LfoFrame {
    float out = 0.0f, sine = 0.0f, triangle = 0.0f, saw = 0.0f, square = 0.0f, random = 0.0f, cycle = 0.0f;
};

class LfoDsp {
public:
    static constexpr double kTwoPi = dsp::waves::kTwoPi;

    /// Seeded random value for a cycle, in −1..+1.
    static float randomAt(uint32_t seed, int64_t cycle) noexcept { return dsp::waves::randomAt(seed, cycle); }
    static float triangle(double p) noexcept { return dsp::waves::triangle(p); }
    /// Bipolar value of `wave` at phase p (0..1) in cycle `cycle`.
    static float value(int wave, double p, float pulseWidth, uint32_t seed, int64_t cycle) noexcept {
        return dsp::waves::value(wave, p, pulseWidth, seed, cycle);
    }

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        reset_.reset();
        phasor_.reset();
        started_ = false;
        fadeGain_ = 1.0f;
    }

    /// Phase within the cycle (0..1, before the Phase offset).
    double phase() const noexcept { return phasor_.phase(); }

    void tick(const LfoParams& p, float resetIn, const LfoTime& t, LfoFrame& f) noexcept {
        f.cycle = 0.0f;
        const bool resetEdge = reset_.process(resetIn) > 0;
        if (resetEdge || t.started) fadeGain_ = 0.0f;
        const double beats = dsp::syncBeats(p.sync);
        if (beats > 0.0 && t.running) {
            if (phasor_.lock(t.ppq, beats, t.bpm, sampleRate_, started_)) f.cycle = 1.0f;
        } else {
            const double hz = beats > 0.0 ? dsp::syncedHz(t.bpm, beats) : (double)p.rateHz;
            if (resetEdge || !started_) {
                if (started_) phasor_.restart();
                else phasor_.reset(0.0, phasor_.cycle());
                f.cycle = 1.0f;
            } else if (phasor_.advance(hz / sampleRate_)) {
                f.cycle = 1.0f;
            }
        }
        started_ = true;
        if (p.fade > 0.0f) fadeGain_ = std::min(1.0f, fadeGain_ + (float)(1.0 / (p.fade * sampleRate_)));
        else fadeGain_ = 1.0f;

        const dsp::CyclePhase at = dsp::offsetPhase(phasor_.phase(), phasor_.cycle(), (double)std::clamp(p.phase, 0.0f, 1.0f));
        const int64_t cycle = at.cycle;
        const double ph = at.phase;
        auto out = [&](float v) { return (p.unipolar ? 0.5f + 0.5f * v : v) * fadeGain_; };
        f.sine = out(value(LfoSine, ph, p.pulseWidth, p.seed, cycle));
        f.triangle = out(value(LfoTriangle, ph, p.pulseWidth, p.seed, cycle));
        f.saw = out(value(LfoSawUp, ph, p.pulseWidth, p.seed, cycle));
        f.square = out(value(LfoSquare, ph, p.pulseWidth, p.seed, cycle));
        f.random = out(value(LfoRandomStep, ph, p.pulseWidth, p.seed, cycle));
        f.out = p.wave == LfoRandomSmooth ? out(value(LfoRandomSmooth, ph, p.pulseWidth, p.seed, cycle))
                : p.wave == LfoSawDown    ? out(value(LfoSawDown, ph, p.pulseWidth, p.seed, cycle))
                : p.wave == LfoTriangle   ? f.triangle
                : p.wave == LfoSawUp      ? f.saw
                : p.wave == LfoSquare     ? f.square
                : p.wave == LfoRandomStep ? f.random
                                          : f.sine;
    }

private:
    double sampleRate_ = 48000.0;
    dsp::GateEdge reset_;
    dsp::Phasor phasor_;
    bool started_ = false;
    float fadeGain_ = 1.0f;
};

}  // namespace bleep::patch
