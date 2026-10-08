// SPDX-License-Identifier: MIT
// LFO core (specs/modules/lfo.md): fixed waveforms, free or phase-locked to
// the song position, seeded random waves and a fade-in. Random values are a
// pure function of (seed, cycle), so synced renders repeat exactly.
#pragma once

#include "dsp/Random.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum LfoWave { LfoSine = 0, LfoTriangle, LfoSawUp, LfoSawDown, LfoSquare, LfoRandomStep, LfoRandomSmooth, kLfoWaves };

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
    static constexpr double kTwoPi = 6.283185307179586;

    /// Seeded random value for a cycle, in −1..+1.
    static float randomAt(uint32_t seed, int64_t cycle) noexcept {
        return (float)(2.0 * dsp::uniform01(seed, (uint64_t)cycle, 11) - 1.0);
    }
    static float triangle(double p) noexcept {
        return (float)(p < 0.25 ? 4.0 * p : p < 0.75 ? 2.0 - 4.0 * p : 4.0 * p - 4.0);
    }
    /// Bipolar value of `wave` at phase p (0..1) in cycle `cycle`.
    static float value(int wave, double p, float pulseWidth, uint32_t seed, int64_t cycle) noexcept {
        switch (wave) {
            case LfoTriangle: return triangle(p);
            case LfoSawUp: return (float)(2.0 * p - 1.0);
            case LfoSawDown: return (float)(1.0 - 2.0 * p);
            case LfoSquare: return p < (double)std::clamp(pulseWidth, 0.05f, 0.95f) ? 1.0f : -1.0f;
            case LfoRandomStep: return randomAt(seed, cycle);
            case LfoRandomSmooth: {
                const double k = 0.5 - 0.5 * std::cos(p * kTwoPi * 0.5);
                return (float)((1.0 - k) * randomAt(seed, cycle) + k * randomAt(seed, cycle + 1));
            }
            default: return (float)std::sin(p * kTwoPi);
        }
    }

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        reset_.reset();
        phase_ = 0.0;
        cycle_ = 0;
        started_ = false;
        fadeGain_ = 1.0f;
    }

    /// Phase within the cycle (0..1, before the Phase offset).
    double phase() const noexcept { return phase_; }

    void tick(const LfoParams& p, float resetIn, const LfoTime& t, LfoFrame& f) noexcept {
        f.cycle = 0.0f;
        const bool resetEdge = reset_.process(resetIn) > 0;
        if (resetEdge || t.started) fadeGain_ = 0.0f;
        const double beats = dsp::syncBeats(p.sync);
        if (beats > 0.0 && t.running) {
            const double s = t.ppq / beats;
            const int64_t n = (int64_t)std::floor(s);
            const double inc = t.bpm / 60.0 / sampleRate_ / beats;
            if (started_ ? n != cycle_ : s - (double)n < inc) f.cycle = 1.0f;
            cycle_ = n;
            phase_ = s - (double)n;
        } else {
            const double hz = beats > 0.0 ? t.bpm / 60.0 / beats : (double)p.rateHz;
            if (resetEdge || !started_) {
                if (started_) ++cycle_;
                phase_ = 0.0;
                f.cycle = 1.0f;
            } else {
                phase_ += hz / sampleRate_;
                if (phase_ >= 1.0) {
                    const double whole = std::floor(phase_);
                    phase_ -= whole;
                    cycle_ += (int64_t)whole;
                    f.cycle = 1.0f;
                }
            }
        }
        started_ = true;
        if (p.fade > 0.0f) fadeGain_ = std::min(1.0f, fadeGain_ + (float)(1.0 / (p.fade * sampleRate_)));
        else fadeGain_ = 1.0f;

        const double shifted = phase_ + (double)std::clamp(p.phase, 0.0f, 1.0f);
        const int64_t cycle = cycle_ + (int64_t)std::floor(shifted);
        const double ph = shifted - std::floor(shifted);
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
    double phase_ = 0.0;
    int64_t cycle_ = 0;
    bool started_ = false;
    float fadeGain_ = 1.0f;
};

}  // namespace bleep::patch
