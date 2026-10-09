// SPDX-License-Identifier: MIT
// Rise/fall slope generator: the common core of Tidal, Six Slopes and
// Segments (doc/specs/modules/tidal.md, six-slopes.md, segments.md). One cycle is
// a rise and a fall; Skew sets their ratio at a constant period. It runs as a
// looping oscillator from 0.001 Hz to audio rate, as an AD envelope or as an
// AR/ASR envelope, with curve shaping, smoothing/folding, end-of-rise and
// end-of-cycle pulses, and a clock follower that locks it to an external
// clock at a ratio.
#pragma once

#include "Smoothing.h"
#include "Svf.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

// ---- Pure helpers -------------------------------------------------------------

/// 1 V/oct: baseHz × 2^octaves.
inline double voctHz(double baseHz, double octaves) noexcept { return baseHz * std::exp2(octaves); }

/// Function's curve (Function, Six Slopes, Segments): u^(1+3c) for c ≥ 0
/// (exponential), 1 − (1−u)^(1−3c) for c < 0 (logarithmic); c −1..+1.
inline float curvePow(float u, float c) noexcept {
    u = std::clamp(u, 0.0f, 1.0f);
    c = std::clamp(c, -1.0f, 1.0f);
    if (c >= 0.0f) return std::pow(u, 1.0f + 3.0f * c);
    return 1.0f - std::pow(1.0f - u, 1.0f - 3.0f * c);
}

/// Tidal's curve morph (tidal.md 4.2), linear crossfades between neighbours:
/// −1 logarithmic 1 − (1−u)^4, 0 linear, +0.5 cosine 0.5 − 0.5·cos(πu),
/// +1 exponential u^4.
inline float curveMorph(float u, float c) noexcept {
    u = std::clamp(u, 0.0f, 1.0f);
    c = std::clamp(c, -1.0f, 1.0f);
    if (c <= 0.0f) {
        const float v = 1.0f - u;
        const float lg = 1.0f - v * v * v * v;
        return lg + (c + 1.0f) * (u - lg);
    }
    const float cs = 0.5f - 0.5f * std::cos(3.14159265358979f * u);
    if (c <= 0.5f) return u + 2.0f * c * (cs - u);
    const float ex = u * u * u * u;
    return cs + (2.0f * c - 1.0f) * (ex - cs);
}

/// The linear slope at phase p (0..1) with rise fraction r (0..1):
/// p / r while rising, (1 − p) / (1 − r) while falling. r = 0 is a falling
/// saw, r = 1 a rising saw.
inline float skewedSlope(double p, double r) noexcept {
    r = std::clamp(r, 0.0, 1.0);
    if (p < r) return (float)(p / r);
    if (r >= 1.0) return 0.0f;
    return (float)std::clamp((1.0 - p) / (1.0 - r), 0.0, 1.0);
}

/// Reflects x back into −1..+1 as often as needed (a triangle wavefolder).
inline float foldReflect(float x) noexcept {
    // Period 4: −1 → +1 → −1 over x in [−1, 3).
    double t = std::fmod((double)x + 1.0, 4.0);
    if (t < 0.0) t += 4.0;
    return (float)(t < 2.0 ? t - 1.0 : 3.0 - t);
}

/// Wavefold amount (tidal.md 4.2) on a 0..1 value: x = (2v − 1)(1 + 5·amount),
/// reflected into −1..+1, mapped back to 0..1. amount 0..1.
inline float foldUnit(float v, float amount) noexcept {
    const float x = (2.0f * v - 1.0f) * (1.0f + 5.0f * std::clamp(amount, 0.0f, 1.0f));
    return 0.5f + 0.5f * foldReflect(x);
}

// ---- Slope generator --------------------------------------------------------------

enum class SlopeMode {
    Loop,  ///< cycles continuously; a gate rising edge resets the phase to 0
    AD,    ///< rising edge runs one rise and fall from the current level, then idles at 0
    AR     ///< ASR: rises while the gate is high, holds at 1, falls on the falling edge
};

struct SlopeParams {
    double hz = 1.0;                ///< cycles per second (AD/AR: 1 / total time); 0 … 0.49·sr
    float skew = 0.5f;              ///< share of the cycle spent rising, 0..1
    float curve = 0.0f;             ///< −1..+1
    bool morphCurve = true;         ///< true: curveMorph (Tidal); false: curvePow (Function, Six Slopes)
    SlopeMode mode = SlopeMode::Loop;
};

struct SlopeFrame {
    double phase = 0.0;      ///< 0..r rising, r..1 falling
    float raw = 0.0f;        ///< linear slope 0..1
    float value = 0.0f;      ///< curved slope 0..1
    bool rising = false;     ///< high while rising (Tidal's Rise gate)
    bool endOfRise = false;  ///< pulse: the top was reached
    bool endOfCycle = false; ///< pulse: the phase wrapped (Loop) or the slope reached 0 (AD/AR)
    bool active = false;     ///< AD/AR: running or holding (for Voice Out › Active); Loop: always
};

class Slope {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    /// Loop: phase 0. AD/AR: idle at 0.
    void reset() noexcept {
        phase_ = 0.0;
        active_ = false;
        riseEnded_ = endPending_ = false;
        gate_.reset();
    }

    double phase() const noexcept { return phase_; }
    /// Jumps to a phase (sync, clock reset, Loop retrigger). Starts AD/AR too.
    void setPhase(double p) noexcept {
        phase_ = std::clamp(p, 0.0, 1.0);
        active_ = true;
    }

    /// Loop: back to phase 0 for a clock or sync reset. The End pulse fires if
    /// the cycle was more than half done (an early pulse), not if the phase
    /// had just wrapped (a late one), so End stays once per cycle.
    void resync() noexcept {
        if (phase_ >= 0.5) endPending_ = true;
        phase_ = 0.0;
        active_ = true;
    }

    /// Current linear level 0..1 for skew r.
    float level(double r) const noexcept { return isIdle() ? 0.0f : skewedSlope(phase_, r); }

    /// Starts a rise from the current level (AD/AR), or resets the phase (Loop).
    void trigger(const SlopeParams& p) noexcept {
        if (p.mode == SlopeMode::Loop) {
            phase_ = 0.0;
        } else {
            const double r = std::clamp((double)p.skew, 0.0, 1.0);
            phase_ = (double)level(r) * r;  // where the rise reaches the current level
            riseEnded_ = phase_ >= r;         // a zero-length rise is over at once
        }
        active_ = true;
    }

    /// Starts the fall from the current level (AR release).
    void release(const SlopeParams& p) noexcept {
        if (isIdle()) return;
        const double r = std::clamp((double)p.skew, 0.0, 1.0);
        if (phase_ < r) phase_ = r + (1.0 - (double)level(r)) * (1.0 - r);
    }

    /// One sample. `gate` (high at ≥ 0.5): Loop and AD use its rising edge,
    /// AR its level.
    SlopeFrame tick(const SlopeParams& p, float gate) noexcept {
        const int edge = gate_.process(gate);
        if (edge > 0) trigger(p);
        else if (edge < 0 && p.mode == SlopeMode::AR) release(p);
        return advance(p, std::clamp(p.hz, 0.0, 0.49 * sampleRate_) / sampleRate_);
    }

    /// Loop at an externally given phase (e.g. ppqPhase() with the transport
    /// playing). Pulses come from the movement since the previous sample; a
    /// backward jump counts as a wrap.
    SlopeFrame tickAt(const SlopeParams& p, double phase) noexcept {
        const double r = std::clamp((double)p.skew, 0.0, 1.0);
        const double prev = phase_;
        phase = phase - std::floor(phase);
        const bool wrapped = phase < prev;
        const double next = wrapped ? phase + 1.0 : phase;
        phase_ = phase;
        active_ = true;
        SlopeFrame f = frame(p, r);
        f.endOfCycle = wrapped;
        f.endOfRise = crosses(prev, next, r);
        return f;
    }

private:
    bool isIdle() const noexcept { return !active_; }

    static bool crosses(double from, double to, double r) noexcept {
        return (from < r && r <= to) || (from < r + 1.0 && r + 1.0 <= to);
    }

    SlopeFrame frame(const SlopeParams& p, double r) const noexcept {
        SlopeFrame f;
        f.phase = phase_;
        f.active = active_;
        f.raw = isIdle() ? 0.0f : skewedSlope(phase_, r);
        f.value = p.morphCurve ? curveMorph(f.raw, p.curve) : curvePow(f.raw, p.curve);
        f.rising = active_ && phase_ < r;
        return f;
    }

    SlopeFrame advance(const SlopeParams& p, double inc) noexcept {
        const double r = std::clamp((double)p.skew, 0.0, 1.0);
        bool eor = riseEnded_, eoc = endPending_;
        riseEnded_ = endPending_ = false;
        if (p.mode == SlopeMode::Loop) {
            active_ = true;
            const double prev = phase_;
            const double next = prev + inc;
            eor = crosses(prev, next, r);
            if (next >= 1.0) {
                phase_ = next - std::floor(next);
                eoc = true;
            } else {
                phase_ = next;
            }
        } else if (active_) {
            const bool holdAtTop = p.mode == SlopeMode::AR && gate_.high();
            const double prev = phase_;
            double next = prev + inc;
            if (prev < r && next >= r) {
                eor = true;
                if (holdAtTop) next = r;
            } else if (holdAtTop && !(prev < r || prev > r)) {
                next = r;  // sustaining
            }
            if (next >= 1.0) {
                // A zero-length rise still reports reaching the top.
                if (prev < r) eor = true;
                next = 1.0;
                active_ = false;
                eoc = true;
            }
            phase_ = next;
        }
        SlopeFrame f = frame(p, r);
        f.endOfRise = eor;
        f.endOfCycle = eoc;
        return f;
    }

    double sampleRate_ = 48000.0;
    double phase_ = 0.0;
    bool active_ = false;
    bool riseEnded_ = false, endPending_ = false;
    GateEdge gate_;
};

// ---- Smoothing / folding ------------------------------------------------------------

/// Tidal's Smooth (tidal.md 4.2), per output. smooth < 0: a 2-pole low-pass
/// whose cutoff tracks the cycle rate, fc = f × 2^(7(1 + smooth)) (at −1 the
/// cutoff is f: any shape becomes a near-sine, at reduced level); smooth > 0:
/// wavefolding with gain 1 + 5·smooth. Input and output are 0..1. Pulses
/// (End, Rise) should come from the unfiltered Slope.
class SlopeSmoother {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset(float value = 0.0f) noexcept { lp_.resetTo((double)value); }

    float process(float x, double cycleHz, float smooth) noexcept {
        smooth = std::clamp(smooth, -1.0f, 1.0f);
        if (smooth >= 0.0f) {
            lp_.resetTo((double)x);  // keeps the filter ready: no jump when smoothing starts
            return smooth > 0.0f ? foldUnit(x, smooth) : x;
        }
        const double fc = std::max(cycleHz, 0.0) * std::exp2(7.0 * (1.0 + (double)smooth));
        lp_.set(fc, 0.7071, sampleRate_);
        const double y = lp_.lowpass((double)x);
        // Fade the filter in over the first 10 % so Smooth is continuous at 0.
        const double mix = std::min(1.0, -(double)smooth / 0.1);
        return (float)((double)x + mix * (y - (double)x));
    }

private:
    double sampleRate_ = 48000.0;
    SvfLow lp_;
};

// ---- Clock follower -----------------------------------------------------------------

/// Measures an external clock and runs at multiply / divide × its rate
/// (÷16 … ×16), phase-locked: the phase should be set to 0 whenever tick()
/// returns true — on every pulse for multiplications, on every divide-th
/// pulse for divisions (counted from the first pulse after reset()).
/// The period is the mean of the last 4 intervals; a pulse more than 2 × T
/// after the previous one is a new start (counting restarts, the measurement
/// is renewed from the next interval), so a pause never gives a wild rate.
/// Before the first interval the period is `firstPeriodSeconds` (0.5 s).
class ClockLock {
public:
    void prepare(double sampleRate, double firstPeriodSeconds = 0.5) noexcept {
        sampleRate_ = sampleRate;
        firstPeriod_ = firstPeriodSeconds * sampleRate;
        reset();
    }
    void reset() noexcept {
        period_ = firstPeriod_;
        count_ = 0;
        n_ = 0;
        next_ = 0;
        since_ = 0;
        started_ = false;
    }

    /// multiply, divide ≥ 1 (e.g. ×4 = (4, 1), ÷3 = (1, 3)).
    void setRatio(int multiply, int divide) noexcept {
        multiply_ = std::max(multiply, 1);
        divide_ = std::max(divide, 1);
    }
    /// Signed ratio as in the Ratio settings: +n = ×n, −n = ÷n (0 and ±1 = ×1).
    void setRatio(int signedRatio) noexcept {
        if (signedRatio < -1) setRatio(1, -signedRatio);
        else setRatio(std::max(signedRatio, 1), 1);
    }

    /// One sample; `pulse` is a detected rising edge. Returns true when the
    /// locked phase restarts at this sample.
    bool tick(bool pulse) noexcept {
        ++since_;
        if (!pulse) return false;
        const double interval = (double)since_;
        since_ = 0;
        if (!started_) {
            started_ = true;
            count_ = 0;
            return true;
        }
        if (n_ > 0 && interval > 2.0 * period_) {  // a pause: start again
            count_ = 0;
            n_ = 0;
            return true;
        }
        intervals_[(size_t)next_] = interval;
        next_ = (next_ + 1) % kAverage;
        n_ = std::min(n_ + 1, kAverage);
        double sum = 0.0;
        for (int i = 0; i < n_; ++i) sum += intervals_[(size_t)i];
        period_ = sum / n_;
        count_ = (count_ + 1) % divide_;
        return count_ == 0;
    }

    /// The locked frequency in Hz.
    double hz() const noexcept { return (double)multiply_ * sampleRate_ / ((double)divide_ * period_); }
    /// Measured clock period (seconds) and tempo (one pulse per beat).
    double periodSeconds() const noexcept { return period_ / sampleRate_; }
    double bpm() const noexcept { return 60.0 / periodSeconds(); }
    bool started() const noexcept { return started_; }

private:
    static constexpr int kAverage = 4;
    double sampleRate_ = 48000.0;
    double firstPeriod_ = 24000.0;
    double period_ = 24000.0;
    std::array<double, kAverage> intervals_{};
    int n_ = 0, next_ = 0;
    int64_t since_ = 0;
    int count_ = 0;
    int multiply_ = 1, divide_ = 1;
    bool started_ = false;
};

}  // namespace bleep::dsp
