// SPDX-License-Identifier: MIT
// Function: a rise/fall slope generator. Free-running it is an LFO, triggered
// it is an envelope; Spread derives three more related outputs from one gesture.
#pragma once

#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::patch {

struct FunctionParams {
    float rise = 0.25f;   ///< seconds (free) — in sync mode only the rise/fall ratio counts
    float fall = 0.25f;   ///< seconds
    float shape = 0.0f;   ///< -1 (logarithmic) .. 0 (linear) .. +1 (exponential)
    float spread = 0.0f;  ///< 0..1: phase offsets (cycling) or time ratios (envelope) for B..D
    bool cycle = true;    ///< loop (LFO) instead of one-shot (envelope)
    int sync = 0;         ///< index into dsp::syncNames(); 0 = free
};

/// Where the module is in musical time for the current sample.
struct SampleClock {
    double sampleRate = 48000.0;
    double bpm = 120.0;
    double ppq = 0.0;      ///< quarter notes, valid when `locked`
    bool locked = false;   ///< transport is playing and the host reports ppq
};

class FunctionDsp {
public:
    static constexpr int kOutputs = 4;

    static float curve(float u, float shape) noexcept {
        u = std::clamp(u, 0.0f, 1.0f);
        if (shape >= 0.0f) return std::pow(u, 1.0f + 3.0f * shape);
        return 1.0f - std::pow(1.0f - u, 1.0f - 3.0f * shape);
    }

    /// Triangle with the peak at `riseFraction`.
    static float slope(double phase, float riseFraction) noexcept {
        const float r = std::clamp(riseFraction, 0.001f, 0.999f);
        const float p = (float)phase;
        return p < r ? p / r : 1.0f - (p - r) / (1.0f - r);
    }

    void reset() noexcept {
        phase_ = 0.0;
        prevPhase_ = 0.0;
        for (auto& v : voices_) v = Voice{};
        trig_.reset();
    }

    /// One sample. `trig` is the Trig input (gate). Writes A..D and EOC.
    void tick(const FunctionParams& p, float trig, const SampleClock& clk, float* out, float& eoc) noexcept {
        const bool rising = trig_.process(trig) > 0;
        const double beats = dsp::syncBeats(p.sync);
        const float rise = std::max(p.rise, 0.0005f), fall = std::max(p.fall, 0.0005f);
        const float riseFraction = rise / (rise + fall);
        eoc = 0.0f;

        if (p.cycle) {
            if (beats > 0.0 && clk.locked) {
                phase_ = dsp::wrap01(clk.ppq / beats);
            } else {
                const double hz = beats > 0.0 ? clk.bpm / 60.0 / beats : 1.0 / (rise + fall);
                phase_ = dsp::wrap01(phase_ + hz / clk.sampleRate);
            }
            if (rising) phase_ = 0.0;
            if (phase_ < prevPhase_ && !rising) eoc = 1.0f;
            prevPhase_ = phase_;
            for (int k = 0; k < kOutputs; ++k) {
                const double ph = dsp::wrap01(phase_ + k * p.spread * 0.25);
                out[k] = curve(slope(ph, riseFraction), p.shape);
            }
            for (auto& v : voices_) v.stage = Stage::Idle;
            return;
        }

        // Envelope mode.
        float riseS = rise, fallS = fall;
        if (beats > 0.0) {
            const double total = beats * 60.0 / std::max(clk.bpm, 1.0);
            riseS = (float)(total * riseFraction);
            fallS = (float)(total * (1.0 - riseFraction));
        }
        for (int k = 0; k < kOutputs; ++k) {
            Voice& v = voices_[(size_t)k];
            const float stretch = std::pow(1.0f + p.spread, (float)k);
            if (rising) v.stage = Stage::Rise;
            if (v.stage == Stage::Rise) {
                v.u += 1.0f / (float)(riseS * stretch * clk.sampleRate);
                if (v.u >= 1.0f) {
                    v.u = 1.0f;
                    v.stage = Stage::Fall;
                }
            } else if (v.stage == Stage::Fall) {
                v.u -= 1.0f / (float)(fallS * stretch * clk.sampleRate);
                if (v.u <= 0.0f) {
                    v.u = 0.0f;
                    v.stage = Stage::Idle;
                    if (k == 0) eoc = 1.0f;
                }
            }
            out[k] = curve(v.u, p.shape);
        }
        phase_ = prevPhase_ = 0.0;
    }

private:
    enum class Stage { Idle, Rise, Fall };
    struct Voice {
        Stage stage = Stage::Idle;
        float u = 0.0f;
    };
    double phase_ = 0.0, prevPhase_ = 0.0;
    std::array<Voice, kOutputs> voices_{};
    dsp::GateEdge trig_;
};

}  // namespace bleep::patch
