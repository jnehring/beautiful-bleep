// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// The band-limited analog-style oscillator core of the source modules
// (Oscillator, Chord Osc, Dual Osc, Swarm Osc, Meta Mod, Wavefolder, Macro
// Osc; chord-oscillator.md §7). A double-precision phase in [0, 1) runs at a
// signed increment (through-zero FM runs it backwards), and sine, triangle,
// saw, square and sub are all read from that one phase, so they stay in step.
//
// Two flavours share the waveforms:
//
// - OscCore: the Oscillator's original code, moved here unchanged. polyBLEP
//   saw and square (looked up from the phase, no latency), naive triangle
//   (optionally polyBLAMP), instant hard sync. OscillatorDsp uses it and its
//   output must stay bit-identical (common/dsp/tests/test_osc_core.cpp).
// - SyncOsc: every discontinuity is located at its sub-sample time and
//   corrected by a polyBLEP (jumps in value) or polyBLAMP (jumps in slope)
//   scaled by its size: wraps, pulse edges, triangle corners and sync events,
//   including partial and reversing soft sync. Also no latency. Use it when
//   the oscillator is synced (Dual Osc, Macro Osc VA Pair) or when the
//   triangle must stay clean at high pitch.
//
// Plus pitch/FM helpers and OscDrift, a seeded slow random detune.
#pragma once

#include "Random.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

namespace osc {

constexpr double kC4Hz = 261.6255653005986;
constexpr double kTwoPi = 6.283185307179586476925;

/// 1 V/oct: octaves relative to C4 → Hz.
inline double pitchToHz(double octaves) noexcept { return kC4Hz * std::exp2(octaves); }

/// Linear (through-zero) FM as in the Oscillator: ±4× the base frequency at
/// depth 1 and fm ±1. The result can be negative: run the phase backwards.
inline double linearFm(double hz, double depth, double fm) noexcept { return hz * (1.0 + 4.0 * depth * fm); }

/// Exponential FM: ±4 octaves at depth 1 and fm ±1. The mean pitch rises with
/// depth, as on analog exponential FM.
inline double expFm(double hz, double depth, double fm) noexcept { return hz * std::exp2(4.0 * depth * fm); }

/// Phase increment (cycles per sample) for `hz`, clamped to ±0.49 so the
/// two-sample BLEP kernels never overlap a whole cycle.
inline double increment(double hz, double sampleRate) noexcept { return std::clamp(hz / sampleRate, -0.49, 0.49); }

inline double wrap01(double x) noexcept { return x - std::floor(x); }

/// polyBLEP residual for a downward unit-2 step at phase 0 (the saw's reset):
/// subtract it from a naive saw, add it at a rising edge. t is the phase,
/// dt = |increment|.
inline double polyBlep(double t, double dt) noexcept {
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

/// polyBLAMP residual for a corner at phase 0 whose slope rises by 1 per
/// sample: (1 − |x|)³ / 6 with x the distance from the corner in samples.
/// Scale by the slope change per sample (Δ slope per cycle × |dt|).
inline double polyBlamp(double t, double dt) noexcept {
    double x;
    if (t < dt) x = t / dt;
    else if (t > 1.0 - dt) x = (1.0 - t) / dt;
    else return 0.0;
    const double u = 1.0 - x;
    return u * u * u * (1.0 / 6.0);
}

}  // namespace osc

/// The waveforms at one phase, all ±1.
struct OscWaves {
    float sine, triangle, saw, square, sub;
};

/// The Oscillator's core: phase accumulator, polyBLEP saw/square, sub octave.
class OscCore {
public:
    void reset(double phase = 0.0) noexcept {
        phase_ = phase;
        sub_ = 1.0f;
    }
    double phase() const noexcept { return phase_; }
    void setPhase(double phase) noexcept { phase_ = osc::wrap01(phase); }
    /// Instant hard sync (no BLEP), as the Oscillator's Sync input.
    void hardSync() noexcept { phase_ = 0.0; }
    /// Rounds the triangle's corners with polyBLAMP. Off by default, because
    /// the Oscillator (and anything that must match it) has a naive triangle.
    void setTriangleBlamp(bool on) noexcept { blampTriangle_ = on; }

    /// The waveforms at the current phase. `dt` is this sample's signed
    /// increment (osc::increment), `pulseWidth` the square's duty 0.05..0.95.
    OscWaves waves(double dt, float pulseWidth) const noexcept {
        const double adt = std::max(std::fabs(dt), 1e-9);
        const double ph = phase_;
        const float pw = std::clamp(pulseWidth, 0.05f, 0.95f);
        OscWaves o;
        o.sine = (float)std::sin(osc::kTwoPi * ph);
        double tri = ph < 0.5 ? 4.0 * ph - 1.0 : 3.0 - 4.0 * ph;
        if (blampTriangle_) tri += 8.0 * adt * (osc::polyBlamp(ph, adt) - osc::polyBlamp(osc::wrap01(ph - 0.5), adt));
        o.triangle = (float)tri;
        o.saw = (float)(2.0 * ph - 1.0 - osc::polyBlep(ph, adt));
        double sq = ph < pw ? 1.0 : -1.0;
        sq += osc::polyBlep(ph, adt);
        sq -= osc::polyBlep(osc::wrap01(ph - pw), adt);
        o.square = (float)sq;
        o.sub = sub_;
        return o;
    }

    /// Moves the phase on by `dt`; the sub flips on every forward wrap.
    void advance(double dt) noexcept {
        double next = phase_ + dt;
        if (next >= 1.0) {
            next -= 1.0;
            sub_ = -sub_;
        } else if (next < 0.0) {
            next += 1.0;
        }
        phase_ = next;
    }

    OscWaves tick(double dt, float pulseWidth) noexcept {
        const OscWaves w = waves(dt, pulseWidth);
        advance(dt);
        return w;
    }

    /// The Oscillator's Shape morph: 0 sine, 1/3 triangle, 2/3 saw, 1 square,
    /// crossfading neighbours in between.
    static float morph(const OscWaves& w, float shape) noexcept {
        const float m = std::clamp(shape, 0.0f, 1.0f) * 3.0f;
        const float waves[4] = {w.sine, w.triangle, w.saw, w.square};
        const int i = std::min((int)m, 2);
        const float t = m - (float)i;
        return waves[i] + t * (waves[i + 1] - waves[i]);
    }

private:
    double phase_ = 0.0;
    float sub_ = 1.0f;
    bool blampTriangle_ = false;
};

/// An oscillator whose discontinuities, sync resets included, are corrected
/// at their exact sub-sample time (polyBLEP for jumps, polyBLAMP for corners),
/// so hard and soft sync sweeps stay clean.
///
/// Sync. A sync event happens `syncAt` (0..1) of a sample after the sample
/// that process() returns, i.e. inside the interval the phase is about to
/// cross. A master SyncOsc reports its own wrap in that same interval
/// (wrapAt()), so a slave processed right after it in the same sample needs
/// no lookahead:
///
///     const OscWaves b = master.process(dtB, pw);
///     const OscWaves a = slave.process(dtA, pw, master.wrapAt(), syncAmount);
///
/// For an external trigger whose edge fell between the previous and the
/// current input sample, pass its offset on the next call (one sample late)
/// or accept a half-corrected edge.
///
/// `amount` blends from no sync to hard sync (Dual Osc 4.3):
/// - 0: nothing.
/// - 0 < amount < 0.5: reversing soft sync. If the phase is in the last
///   `amount` of its cycle, its direction reverses (no jump in value).
/// - 0.5 ≤ amount ≤ 1: hard part h = 2·amount − 1 pulls the phase toward 0
///   (phase ← phase·(1 − h)) and restores forward motion, except inside a
///   reversal window that shrinks from the last half (0.5) to nothing (1).
/// amount 1 is exact hard sync: phase 0, forward.
class SyncOsc {
public:
    void reset(double phase = 0.0) noexcept {
        phase_ = osc::wrap01(phase);
        dir_ = 1.0;
        sub_ = 1.0f;
        wrapAt_ = -1.0;
        for (double& p : pending_) p = 0.0;
    }
    double phase() const noexcept { return phase_; }
    /// +1 forward, −1 while reversed by soft sync.
    double direction() const noexcept { return dir_; }
    /// Where in the interval just advanced the phase wrapped forwards
    /// (0..1 of a sample after the returned sample), or −1 if it didn't.
    double wrapAt() const noexcept { return wrapAt_; }

    /// Returns the waveforms at the current phase and advances by `dt`
    /// (signed increment, |dt| < 0.5), applying a sync event at `syncAt`
    /// (negative = none) with strength `syncAmount`.
    OscWaves process(double dt, float pulseWidth, double syncAt = -1.0, float syncAmount = 1.0f) noexcept {
        pw_ = (double)std::clamp(pulseWidth, 0.05f, 0.95f);
        double cur[kWaves];
        naive(phase_, cur);
        for (int k = 0; k < kWaves; ++k) {
            cur[k] += pending_[k];
            pending_[k] = 0.0;
        }
        wrapAt_ = -1.0;
        double p = phase_;
        double edt = dt * dir_;
        if (syncAt >= 0.0 && syncAt < 1.0 && syncAmount > 0.0f) {
            segment(p, edt, 0.0, syncAt, cur);
            sync(p, edt, syncAt, std::min(syncAmount, 1.0f), cur);
            segment(p, edt, syncAt, 1.0, cur);
        } else {
            segment(p, edt, 0.0, 1.0, cur);
        }
        phase_ = p;
        return {(float)cur[0], (float)cur[1], (float)cur[2], (float)cur[3], (float)cur[4]};
    }

private:
    static constexpr int kWaves = 5;  // sine, triangle, saw, square, sub

    void naive(double p, double* v) const noexcept {
        v[0] = std::sin(osc::kTwoPi * p);
        v[1] = p < 0.5 ? 4.0 * p - 1.0 : 3.0 - 4.0 * p;
        v[2] = 2.0 * p - 1.0;
        v[3] = p < pw_ ? 1.0 : -1.0;
        v[4] = sub_;
    }
    /// d value / d phase of each wave.
    static void slopes(double p, double* s) noexcept {
        s[0] = osc::kTwoPi * std::cos(osc::kTwoPi * p);
        s[1] = p < 0.5 ? 4.0 : -4.0;
        s[2] = 2.0;
        s[3] = 0.0;
        s[4] = 0.0;
    }

    /// Adds the residuals of a discontinuity `a` (0..1] of a sample after the
    /// current one: value jump `jump`, slope jump `kink` (per sample).
    void correct(int k, double a, double jump, double kink, double* cur) noexcept {
        const double b = 1.0 - a;
        cur[k] += jump * 0.5 * b * b + kink * (1.0 / 6.0) * b * b * b;
        pending_[k] += -jump * 0.5 * a * a + kink * (1.0 / 6.0) * a * a * a;
    }

    /// Moves p over the interval fraction [t0, t1) at increment edt, applying
    /// the residuals of the waveforms' own breakpoints.
    void segment(double& p, double edt, double t0, double t1, double* cur) noexcept {
        const double span = edt * (t1 - t0);
        const double end = p + span;
        const double adt = std::fabs(edt);
        if (adt < 1e-12) return;
        const double fwd = edt > 0.0 ? 1.0 : -1.0;
        auto crossed = [&](double u) noexcept { return edt > 0.0 ? (u > p && u <= end) : (u <= p && u > end); };
        auto when = [&](double u) noexcept { return t0 + (u - p) / edt; };
        // The cycle boundary (0 ≡ 1): saw −2, square +2, triangle corner +8/cycle.
        const double wrapU = edt > 0.0 ? 1.0 : 0.0;
        if (crossed(wrapU)) {
            const double a = when(wrapU);
            correct(2, a, -2.0 * fwd, 0.0, cur);
            correct(3, a, 2.0 * fwd, 0.0, cur);
            correct(1, a, 0.0, 8.0 * adt, cur);
            if (edt > 0.0) {
                correct(4, a, -2.0 * sub_, 0.0, cur);
                sub_ = -sub_;
                wrapAt_ = a;
            }
        }
        // Triangle peak at 0.5 (−8/cycle) and the falling pulse edge (−2),
        // in this cycle or the next/previous one.
        for (double u : {0.5, 0.5 + fwd})
            if (crossed(u)) correct(1, when(u), 0.0, -8.0 * adt, cur);
        for (double u : {pw_, pw_ + fwd})
            if (crossed(u)) correct(3, when(u), -2.0 * fwd, 0.0, cur);
        p = end;
        if (p >= 1.0) p -= 1.0;
        else if (p < 0.0) p += 1.0;
    }

    void sync(double& p, double& edt, double a, float amount, double* cur) noexcept {
        const double oldEdt = edt;
        double newP = p;
        double window = amount < 0.5f ? (double)amount : 1.0 - (double)amount;
        if (p >= 1.0 - window && window > 0.0) {
            dir_ = -dir_;  // reversal: no jump in value, only in slope
        } else if (amount >= 0.5f) {
            const double h = 2.0 * (double)amount - 1.0;
            newP = p * (1.0 - h);
            dir_ = 1.0;
        } else {
            return;
        }
        edt = std::fabs(oldEdt) * dir_;
        double v0[kWaves], v1[kWaves], s0[kWaves], s1[kWaves];
        naive(p, v0);
        slopes(p, s0);
        p = newP;
        naive(p, v1);
        slopes(p, s1);
        for (int k = 0; k < kWaves; ++k) correct(k, a, v1[k] - v0[k], s1[k] * edt - s0[k] * oldEdt, cur);
    }

    double phase_ = 0.0, dir_ = 1.0, pw_ = 0.5, wrapAt_ = -1.0;
    float sub_ = 1.0f;
    double pending_[kWaves] = {};
};

/// Analog drift: a seeded, slowly wandering value in −1..+1 (smoothstep
/// curve through random points spaced 1 / rate seconds apart). A pure function
/// of (seed, stream, elapsed samples), so renders repeat; reset() rewinds it.
/// Scale it to cents for detune: `hz *= exp2(drift.next() * cents / 1200)`.
class OscDrift {
public:
    void prepare(double sampleRate, double rateHz = 0.2) noexcept {
        sampleRate_ = sampleRate;
        setRate(rateHz);
    }
    void setRate(double rateHz) noexcept { step_ = std::max(rateHz, 0.0) / sampleRate_; }
    /// `stream` separates the cores/partials/voices that share one seed.
    void reset(uint64_t seed, uint64_t stream) noexcept {
        seed_ = seed;
        stream_ = stream;
        pos_ = 0.0;
        index_ = 0;
        a_ = point(0);
        b_ = point(1);
    }
    float next() noexcept {
        const double u = pos_;
        const double s = u * u * (3.0 - 2.0 * u);
        const float v = (float)(a_ + s * (b_ - a_));
        pos_ += step_;
        while (pos_ >= 1.0) {
            pos_ -= 1.0;
            ++index_;
            a_ = b_;
            b_ = point(index_ + 1);
        }
        return v;
    }
    /// Skips `samples` samples cheaply (for control-rate use).
    float advance(int samples) noexcept {
        const double saved = step_;
        step_ *= (double)std::max(samples, 1);
        const float v = next();
        step_ = saved;
        return v;
    }

private:
    double point(uint64_t i) const noexcept { return 2.0 * uniform01(seed_, i, stream_ ^ 0x0d51f7ull) - 1.0; }

    double sampleRate_ = 48000.0, step_ = 0.2 / 48000.0, pos_ = 0.0, a_ = 0.0, b_ = 0.0;
    uint64_t seed_ = 0, stream_ = 0, index_ = 0;
};

}  // namespace bleep::dsp
