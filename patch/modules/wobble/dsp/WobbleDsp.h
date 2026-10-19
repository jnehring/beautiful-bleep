// SPDX-License-Identifier: GPL-3.0-or-later
// Wobble (doc/specs/modules/wobble.md): one stream of random values in three
// shapes. Stepped jumps, Smooth glides (critically damped two-pole low-pass),
// Wobble glides with resonance (overshoot and ringing). The cutoff follows the
// step period, so the character is the same at any rate. Bursts, a step
// clock, a Compare gate and a Chaos knob that feeds the module into itself.
//
// Raw values and burst decisions are uniform01(seed, step, stream), so with
// Chaos 0 Stepped is a pure function of the song position (when synced).
#pragma once

#include "dsp/Random.h"
#include "dsp/Smoothing.h"
#include "dsp/Svf.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

struct WobbleParams {
    float rateHz = 1.0f;     ///< internal clock when sync is Free
    float smooth = 0.5f;     ///< 0..1: cutoff 2^(4 − 8·smooth) / T
    float wobble = 0.6f;     ///< 0..1: Q = 0.5 + 7.5·wobble²
    float chaos = 0.0f;      ///< 0..1 feedback (4.5)
    float burst = 0.25f;     ///< chance of a burst per step
    float level = 1.0f;
    int sync = 0;            ///< dsp::syncNames() index, 0 = Free
    int burstSize = 4;       ///< maximum pulses, 2..8
    bool unipolar = false;
    uint32_t seed = 1;
};

/// One sample of input.
struct WobbleInput {
    float clock = 0.0f;
    bool clockPatched = false;
    float sample = 0.0f;
    bool samplePatched = false;
    float hold = 0.0f;
    bool running = false;  ///< transport playing with a valid position
    bool started = false;  ///< first sample after the transport started
    double ppq = 0.0;
    double bpm = 120.0;
};

struct WobbleFrame {
    float stepped = 0.0f, smooth = 0.0f, wobble = 0.0f;  ///< after Level and Polarity
    float burst = 0.0f, clock = 0.0f, compare = 0.0f;
};

class WobbleDsp {
public:
    static constexpr int kReplaySteps = 64;    ///< Chaos: steps replayed on a start or jump (4.6)
    static constexpr int kReplaySubsteps = 128;

    /// The raw value of a step, −1..+1.
    static double rawValue(uint32_t seed, int64_t step) noexcept {
        return 2.0 * dsp::uniform01(seed, (uint64_t)step, 1) - 1.0;
    }
    /// Reflects x back into −1..+1 (a triangle fold with period 4).
    static double fold(double x) noexcept {
        if (!std::isfinite(x)) return 0.0;
        const double t = x + 1.0 - 4.0 * std::floor((x + 1.0) / 4.0);  // 0..4
        return t <= 2.0 ? t - 1.0 : 3.0 - t;
    }
    /// The Chaos value map (4.5, path 1).
    static double chaosValue(double v, double chaos, double smoothPrev) noexcept {
        return chaos <= 0.0 ? v : fold(v * (1.0 - chaos) + chaos * 2.4 * smoothPrev);
    }
    /// Wobble's soft limit: |x| ≤ 1 unchanged, then a smooth knee to ±1.5.
    static double softLimit(double x) noexcept {
        const double a = std::fabs(x);
        if (a <= 1.0) return x;
        const double d = std::min(a - 1.0, 1.0);
        return std::copysign(1.0 + d - 0.5 * d * d, x);
    }
    /// Cutoff in Hz for a step period of `stepSeconds`.
    static double cutoffHz(double smooth, double stepSeconds) noexcept {
        return std::exp2(4.0 - 8.0 * std::clamp(smooth, 0.0, 1.0)) / std::max(stepSeconds, 1e-4);
    }
    static double wobbleQ(double wobble) noexcept {
        const double w = std::clamp(wobble, 0.0, 1.0);
        return 0.5 + 7.5 * w * w;
    }
    /// Burst decision for a step: number of pulses (0 = no burst).
    static int burstPulses(uint32_t seed, int64_t step, double chance, int size) noexcept {
        if (dsp::uniform01(seed, (uint64_t)step, 2) >= chance) return 0;
        size = std::clamp(size, 2, 8);
        return 2 + (int)std::floor(dsp::uniform01(seed, (uint64_t)step, 3) * (double)(size - 1));
    }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        reset();
    }

    void reset() noexcept {
        clock_.reset();
        step_ = -1;
        counter_ = -1;
        haveStep_ = false;
        locked_ = false;
        phase_ = 0.0;
        sinceClock_ = 0;
        clockPeriod_ = 0;
        stepSamples_ = sampleRate_;
        value_ = 0.0;
        smooth_.resetTo(0.0);
        wobble_.resetTo(0.0);
        smoothOut_ = wobbleOut_ = 0.0;
        burstLeft_ = 0;
        lastFc_ = lastQ_ = -1.0;
    }

    void tick(const WobbleParams& p, const WobbleInput& in, WobbleFrame& out) noexcept {
        out.clock = out.burst = 0.0f;
        const bool hold = in.hold >= 0.5f;
        const double beats = dsp::syncBeats(p.sync);
        bool step = false, restart = false, jump = false;
        int64_t index = step_;
        ++sinceStep_;

        if (in.clockPatched) {
            locked_ = false;
            ++sinceClock_;
            if (clock_.process(in.clock) > 0) {
                if (clockPeriod_ > 0 || haveStep_) clockPeriod_ = sinceClock_;
                sinceClock_ = 0;
                step = true;
                index = ++counter_;
            }
            stepSamples_ = clockPeriod_ > 0 ? (double)clockPeriod_ : sampleRate_ / std::max(p.rateHz, 0.001f);
        } else if (in.running && beats > 0.0) {
            const int64_t n = (int64_t)std::floor(in.ppq / beats);
            stepSamples_ = beats * 60.0 / std::max(in.bpm, 1.0) * sampleRate_;
            if (in.started || !haveStep_) {
                step = restart = true;
            } else if (n != step_) {
                step = true;
                jump = !locked_ || n != step_ + 1;  // a loop jump, a seek, or back on the grid
            }
            locked_ = true;
            index = n;
            counter_ = n;
            phase_ = dsp::wrap01(in.ppq / beats);
        } else {
            locked_ = false;
            double hz = beats > 0.0 ? in.bpm / 60.0 / beats : (double)p.rateHz;
            hz *= std::exp2(3.0 * (double)p.chaos * std::clamp(wobbleOut_, -1.5, 1.5));  // path 2
            hz = std::clamp(hz, 0.001, sampleRate_ * 0.25);
            stepSamples_ = sampleRate_ / hz;
            if (in.started) {
                counter_ = -1;
                phase_ = 1.0;
                restart = true;
            }
            phase_ += hz / sampleRate_;
            if (!haveStep_ || phase_ >= 1.0) {
                phase_ -= std::floor(phase_);
                step = true;
                index = ++counter_;
            }
        }

        if (step) {
            step_ = index;
            if (!hold || restart || !haveStep_) takeStep(p, in, index, restart, jump);
            else burstLeft_ = 0;  // a held step still cuts a running burst
        }

        // Bursts (4.4): pulses over the first half of the step, cut at the next step.
        if (burstLeft_ > 0 && sinceStep_ >= burstNext_) {
            out.burst = 1.0f;
            --burstLeft_;
            ++burstK_;
            const double u = dsp::uniform01(p.seed, (uint64_t)burstStep_ * 8u + (uint64_t)burstK_, 4);
            const double gap = burstGap_ * (1.0 + (double)p.chaos * 0.5 * (2.0 * u - 1.0));
            burstNext_ += std::max<int64_t>(1, (int64_t)std::llround(gap));
        }
        if (step && !hold) out.clock = 1.0f;

        // Filters: same cutoff, Smooth critically damped, Wobble resonant.
        const double fc = cutoffHz(p.smooth, stepSamples_ / sampleRate_);
        const double q = wobbleQ(p.wobble);
        if (fc < lastFc_ || fc > lastFc_) {
            smooth_.set(fc, 0.5, sampleRate_);
            lastFc_ = fc;
            lastQ_ = -1.0;
        }
        if (q < lastQ_ || q > lastQ_) {
            wobble_.set(fc, q, sampleRate_);
            lastQ_ = q;
        }
        smoothOut_ = smooth_.lowpass(value_);
        wobbleOut_ = wobble_.lowpass(value_);
        if (!std::isfinite(smoothOut_) || !std::isfinite(wobbleOut_)) {
            smooth_.resetTo(value_);
            wobble_.resetTo(value_);
            smoothOut_ = wobbleOut_ = value_;
        }

        const double level = std::clamp((double)p.level, 0.0, 1.0);
        auto shape = [&](double v) { return (float)(level * (p.unipolar ? 0.5 + 0.5 * v : v)); };
        out.stepped = shape(value_);
        out.smooth = shape(std::clamp(smoothOut_, -1.5, 1.5));
        out.wobble = shape(softLimit(wobbleOut_));
        out.compare = value_ > smoothOut_ ? 1.0f : 0.0f;
    }

    double value() const noexcept { return value_; }
    double smoothValue() const noexcept { return smoothOut_; }
    double wobbleValue() const noexcept { return wobbleOut_; }
    /// Current step period in samples.
    double stepSamples() const noexcept { return stepSamples_; }

private:
    void takeStep(const WobbleParams& p, const WobbleInput& in, int64_t index, bool restart, bool jump) noexcept {
        haveStep_ = true;
        sinceStep_ = 0;
        const double chaos = std::clamp((double)p.chaos, 0.0, 1.0);
        double v;
        if (in.samplePatched) {
            v = chaosValue(std::clamp((double)in.sample, -1.0, 1.0), chaos, smoothOut_);
        } else if (chaos > 0.0 && (restart || jump)) {
            v = replay(p, index);  // the same value from the same start, whatever came before
        } else {
            v = chaosValue(rawValue(p.seed, index), chaos, smoothOut_);
        }
        value_ = std::isfinite(v) ? std::clamp(v, -1.0, 1.0) : 0.0;
        if (restart) {  // playback starts calm: at the value, with zero velocity
            smooth_.resetTo(value_);
            wobble_.resetTo(value_);
            smoothOut_ = wobbleOut_ = value_;
        }
        const int n = burstPulses(p.seed, index, p.burst, p.burstSize);
        burstLeft_ = n;
        burstK_ = 0;
        burstStep_ = index;
        burstNext_ = 0;
        burstGap_ = n > 0 ? stepSamples_ / (2.0 * n) : 0.0;
    }

    /// Chaos with a start or a jump: replays the last kReplaySteps steps from
    /// rest (Smooth at 0) with a coarse filter, returns the value of `index`.
    double replay(const WobbleParams& p, int64_t index) const noexcept {
        const double chaos = std::clamp((double)p.chaos, 0.0, 1.0);
        dsp::SvfLow f;
        const double rate = (double)kReplaySubsteps;  // substeps per step: the step period is 1
        f.set(cutoffHz(p.smooth, 1.0), 0.5, rate);
        f.resetTo(0.0);
        double smooth = 0.0;
        for (int64_t s = index - kReplaySteps; s < index; ++s) {
            const double v = chaosValue(rawValue(p.seed, s), chaos, smooth);
            for (int k = 0; k < kReplaySubsteps; ++k) smooth = f.lowpass(v);
        }
        return chaosValue(rawValue(p.seed, index), chaos, smooth);
    }

    double sampleRate_ = 48000.0;
    dsp::GateEdge clock_;
    bool haveStep_ = false, locked_ = false;
    int64_t step_ = -1, counter_ = -1;
    double phase_ = 0.0;
    int64_t sinceClock_ = 0, clockPeriod_ = 0, sinceStep_ = 0;
    double stepSamples_ = 48000.0;
    double value_ = 0.0, smoothOut_ = 0.0, wobbleOut_ = 0.0;
    dsp::SvfLow smooth_, wobble_;
    double lastFc_ = -1.0, lastQ_ = -1.0;
    int burstLeft_ = 0, burstK_ = 0;
    int64_t burstStep_ = 0, burstNext_ = 0;
    double burstGap_ = 0.0;
};

}  // namespace bleep::patch
