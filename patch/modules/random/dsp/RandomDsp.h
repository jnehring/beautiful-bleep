// SPDX-License-Identifier: GPL-3.0-only
// Random: stepped random values with a looping memory. One knob (Loop) moves
// from "always new" to "locked loop". Every value is a pure function of
// (seed, step), so renders are reproducible and the transport can jump.
#pragma once

#include "dsp/Random.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

struct RandomParams {
    float rateHz = 2.0f;   ///< free-running step rate
    int sync = 4;          ///< dsp::syncNames() index; 0 = free (rateHz)
    float spread = 1.0f;   ///< 0..1 width of the distribution
    float bias = 0.0f;     ///< -1..1 centre
    float smooth = 0.0f;   ///< 0..1 glide, as a fraction of a step
    float loop = 0.0f;     ///< 0 = always new .. 1 = locked loop
    int length = 8;        ///< loop length in steps
    bool quantize = false; ///< snap to semitones (1/12 per semitone, 1 V/oct)
    uint32_t seed = 1;
};

class RandomDsp {
public:
    static constexpr std::array<int, 9> kLengths{2, 3, 4, 5, 6, 8, 12, 16, 32};

    /// Raw value in 0..1 for a step: deterministic, independent of history.
    static double stepValue(uint32_t seed, int64_t step, int length, float loop) noexcept {
        length = std::max(length, 1);
        const int64_t slot = ((step % length) + length) % length;
        const int64_t pass = (step - slot) / length; // floor division
        const double changeProbability = 1.0 - std::clamp((double)loop, 0.0, 1.0);
        int64_t p = pass;
        for (int back = 0; back < 1024 && p > 0; ++back, --p) {
            const uint64_t key = ((uint64_t)slot << 40) ^ (uint64_t)p;
            if (dsp::uniform01(seed, key, 1) < changeProbability) break;
        }
        if (p < 0) p = 0;
        return dsp::uniform01(seed, ((uint64_t)slot << 40) ^ (uint64_t)p, 2);
    }

    static float shapeValue(double u, const RandomParams& p) noexcept {
        float v = std::clamp(p.bias + p.spread * (float)(2.0 * u - 1.0), -1.0f, 1.0f);
        if (p.quantize) v = std::round(v * 12.0f) / 12.0f;
        return v;
    }

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    void reset() noexcept {
        step_ = -1;
        phase_ = 0.0;
        sinceClock_ = 0;
        clockPeriod_ = sampleRate_ * 0.25;
        clock_.reset();
        glide_.reset(0.0f);
        target_ = 0.0f;
    }

    /// Restart free/external stepping, e.g. when the transport starts.
    void restart() noexcept {
        step_ = -1;
        phase_ = 0.0;
    }

    /// One sample. `clockIn` drives the steps when `clockPatched`.
    void tick(const RandomParams& p, float clockIn, bool clockPatched, double bpm, double ppq, bool locked,
              float& out, float& trig) noexcept {
        trig = 0.0f;
        const double beats = dsp::syncBeats(p.sync);
        int64_t next = step_;
        double stepSeconds = 1.0 / std::max(p.rateHz, 0.001f);

        ++sinceClock_;
        if (clockPatched) {
            if (clock_.process(clockIn) > 0) {
                next = step_ + 1;
                clockPeriod_ = (double)sinceClock_;
                sinceClock_ = 0;
            }
            stepSeconds = clockPeriod_ / sampleRate_;
        } else if (beats > 0.0 && locked) {
            next = (int64_t)std::floor(ppq / beats);
            stepSeconds = beats * 60.0 / std::max(bpm, 1.0);
        } else {
            const double hz = beats > 0.0 ? bpm / 60.0 / beats : (double)p.rateHz;
            if (beats > 0.0) stepSeconds = 1.0 / hz;
            phase_ += hz / sampleRate_;
            if (step_ < 0 || phase_ >= 1.0) {
                phase_ -= std::floor(phase_);
                next = step_ + 1;
            }
        }

        if (next != step_) {
            step_ = next;
            target_ = shapeValue(stepValue(p.seed, step_, p.length, p.loop), p);
            trig = 1.0f;
        }
        out = glide_.process(target_, (float)(p.smooth * stepSeconds * 0.5), sampleRate_);
    }

private:
    double sampleRate_ = 48000.0;
    int64_t step_ = -1;
    double phase_ = 0.0;
    int64_t sinceClock_ = 0;
    double clockPeriod_ = 12000.0;
    float target_ = 0.0f;
    dsp::GateEdge clock_;
    dsp::OnePole glide_;
};

}  // namespace bleep::patch
