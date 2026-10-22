// SPDX-License-Identifier: GPL-3.0-or-later
// LFO core (doc/specs/modules/lfo.md): fixed waveforms bent by Morph, free, following
// a clock or phase-locked to the song position, seeded random waves and a fade-in. Random values are a
// pure function of (seed, cycle), so synced renders repeat exactly. The waves
// and the phase accumulator are the shared ones in dsp/Waves.h.
#pragma once

#include "dsp/Slope.h"
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

/// How the cycle is timed.
enum LfoSync { LfoFree = 0, LfoClock = 1, LfoTempo = 2 };

/// A clock pulse is one 1/16 step, as for the sequencers.
constexpr double kLfoPulseBeats = 0.25;

struct LfoParams {
    float rateHz = 1.0f;       ///< Free
    int sync = LfoFree;        ///< LfoSync
    double cycleBeats = 1.0;   ///< Clock and Tempo: one cycle per this many quarter notes
    float morph = 0.5f;        ///< 0..1, 0.5 = the plain wave
    float skew = 0.0f;         ///< −1..+1: moves the peak of the cycle (a triangle becomes a ramp)
    float curve = 0.0f;        ///< −1..+1: bends the wave towards exponential (+) or logarithmic (−)
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
    static float value(int wave, double p, float pulseWidth, float morph, uint32_t seed, int64_t cycle) noexcept {
        return dsp::waves::valueMorph(wave, p, pulseWidth, morph, seed, cycle);
    }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        clock_.prepare(sampleRate);
    }
    void reset() noexcept {
        reset_.reset();
        clockIn_.reset();
        clock_.reset();
        phasor_.reset();
        started_ = false;
        pulses_ = 0;
        sinceClock_ = 0;
        haveClock_ = false;
        fadeGain_ = 1.0f;
    }

    /// Phase within the cycle (0..1, before the Phase offset).
    double phase() const noexcept { return phasor_.phase(); }

    void tick(const LfoParams& p, float resetIn, float clockIn, const LfoTime& t, LfoFrame& f) noexcept {
        f.cycle = 0.0f;
        const bool resetEdge = reset_.process(resetIn) > 0;
        if (resetEdge || t.started) fadeGain_ = 0.0f;
        const double beats = std::max(p.cycleBeats, 1e-6);
        if (p.sync == LfoClock) {
            clockCycle(p, resetEdge, clockIn, f);
        } else if (p.sync == LfoTempo && t.running) {
            if (phasor_.lock(t.ppq, beats, t.bpm, sampleRate_, started_)) f.cycle = 1.0f;
        } else {
            const double hz = p.sync == LfoTempo ? dsp::syncedHz(t.bpm, beats) : (double)p.rateHz;
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
        const double sp = p.skew != 0.0f ? dsp::waves::warpPhase(ph, (double)std::clamp(p.skew, -1.0f, 1.0f)) : ph;
        auto wave = [&](int w) {
            const double q = w == LfoRandomStep ? ph : sp;
            return out(dsp::waves::bend(value(w, q, p.pulseWidth, p.morph, p.seed, cycle), p.curve));
        };
        f.sine = wave(LfoSine);
        f.triangle = wave(LfoTriangle);
        f.saw = wave(LfoSawUp);
        f.square = wave(LfoSquare);
        f.random = wave(LfoRandomStep);
        f.out = p.wave == LfoSine           ? f.sine
                : p.wave == LfoTriangle     ? f.triangle
                : p.wave == LfoSawUp        ? f.saw
                : p.wave == LfoSquare       ? f.square
                : p.wave == LfoRandomStep   ? f.random
                                            : wave(p.wave);
    }

private:
    /// Clock mode: the cycle follows the pulses, phase-locked, at the measured pulse period (the mean of the last
    /// four). Before the first pulse the phase waits at 0; a pause of over twice the period starts the count again.
    void clockCycle(const LfoParams& p, bool resetEdge, float clockIn, LfoFrame& f) noexcept {
        const bool pulse = clockIn_.process(clockIn) > 0;
        ++sinceClock_;
        if (resetEdge) pulses_ = 0, sinceClock_ = 0;  // the cycle starts again, then follows the pulses
        if (pulse) {
            if (!haveClock_ || resetEdge || (double)sinceClock_ > 2.0 * clock_.periodSeconds() * sampleRate_) pulses_ = 0;
            else ++pulses_;
            haveClock_ = true;
            sinceClock_ = 0;
        }
        clock_.tick(pulse);
        if (!haveClock_) {
            if (resetEdge || !started_) f.cycle = 1.0f;
            return;
        }
        const double perPulse = kLfoPulseBeats / std::max(p.cycleBeats, 1e-6);
        const double into = std::min(1.0, (double)sinceClock_ * clock_.hz() / sampleRate_);
        const double pos = ((double)pulses_ + into) * perPulse;
        const int64_t n = (int64_t)std::floor(pos);
        if (started_ ? n != phasor_.cycle() : true) f.cycle = 1.0f;
        phasor_.reset(pos - (double)n, n);
    }

    double sampleRate_ = 48000.0;
    dsp::GateEdge reset_, clockIn_;
    dsp::ClockLock clock_;
    int64_t pulses_ = 0, sinceClock_ = 0;
    bool haveClock_ = false;
    dsp::Phasor phasor_;
    bool started_ = false;
    float fadeGain_ = 1.0f;
};

}  // namespace bleep::patch
