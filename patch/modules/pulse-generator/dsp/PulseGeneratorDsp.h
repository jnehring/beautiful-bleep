// SPDX-License-Identifier: GPL-3.0-or-later
// Pulse Generator (doc/specs/modules/pulse-generator.md): a laboratory pulse
// generator. One trapezoidal pulse per period with a delay, a width and
// slewed edges; Free Run (optionally locked to the song position),
// Triggered bursts, Gated runs and an External Width gate delay line; Double
// pulses, seeded jitter, a warm-up drift, and a resonator that rings on every
// edge.
//
// Pulses are kept as a few trapezoids with corner times in double precision
// (samples). Each sample collects the corners that fall inside it and
// corrects the naive signal with a two-sample polyBLEP (steps) or polyBLAMP
// (ramp corners) residual, so every output is one sample late (4.6).
// Overlapping pulses combine with max.
#pragma once

#include "dsp/Random.h"
#include "dsp/Smoothing.h"
#include "dsp/Svf.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>

namespace bleep::patch {

enum PulseMode { kPulseFreeRun = 0, kPulseTriggered, kPulseGated, kPulseExternalWidth };

struct PulseGeneratorParams {
    double periodSec = 0.1;
    double widthSec = 0.01, widthPct = 0.1;  ///< Time Units: Time / % of Period
    double delaySec = 0.0, delayPct = 0.0;
    double rise = 0.0, fall = 0.0;           ///< fractions of the width
    double amplitude = 1.0, offset = 0.0;
    double jitter = 0.0;                     ///< 0..1: up to ±25 % of the period
    double ring = 0.0;                       ///< ring mixed into Out
    double ringHz = 2000.0;
    double damping = 0.5;
    int mode = kPulseFreeRun;
    int sync = 0;              ///< dsp::syncNames() index, 0 = Free
    bool percent = false;      ///< Time Units = % of Period
    bool doublePulse = false;
    int burst = 1;             ///< pulses per trigger, 1..64
    bool complement = false;
    bool warmup = false;
    uint32_t seed = 1;
};

/// One sample of input.
struct PulseGeneratorInput {
    float trigger = 0.0f, gate = 0.0f, reset = 0.0f;
    float pitch = 0.0f;        ///< octaves added to Ring Freq
    bool gatePatched = false;
    bool single = false;       ///< the view's Single button (acts as a Trigger)
    bool running = false;      ///< transport playing with a valid position
    bool started = false;      ///< first sample after the transport started
    double ppq = 0.0, ppqPerSample = 0.0, bpm = 120.0;
    int voice = -1;            ///< Voice Cell index: its own jitter stream
};

struct PulseGeneratorFrame {
    float out = 0.0f, gate = 0.0f, sync = 0.0f, ring = 0.0f;
    bool duty = false;     ///< a width was limited, or pulses / edges were dropped
    bool warming = false;  ///< warm-up error still ≥ 0.1 %
};

class PulseGeneratorDsp {
public:
    static constexpr int kMaxPulses = 32;     ///< pulses alive or pending at once
    static constexpr int kMaxEdges = 256;     ///< External Width: pending edges
    static constexpr double kMinPeriod = 4.0; ///< samples

    /// Damping → cycles to −60 dB, N = 200 · (1/400)^Damping (4.5).
    static double ringCycles(double damping) noexcept {
        return 200.0 * std::pow(1.0 / 400.0, std::clamp(damping, 0.0, 1.0));
    }
    /// Damping → resonator Q = max(0.5, π · N / 6.91).
    static double ringQ(double damping) noexcept {
        return std::max(0.5, 3.14159265358979323846 * ringCycles(damping) / 6.907755278982137);
    }
    /// Warm-up period factor 1 + 0.05 · e^(−t / 12 s) (4.3).
    static double warmFactor(double seconds) noexcept { return 1.0 + 0.05 * std::exp(-seconds / 12.0); }
    /// Jitter offset in samples for pulse `k` (4.4): triangular, ±0.25 · T · jitter.
    static double jitterOffset(uint32_t seed, uint64_t k, int voice, double jitter, double periodSamples) noexcept {
        if (jitter <= 0.0) return 0.0;
        const uint64_t stream = 8u * (uint64_t)(voice + 1);
        const double u1 = dsp::uniform01(seed, k, stream + 1), u2 = dsp::uniform01(seed, k, stream + 2);
        return std::min(jitter, 1.0) * 0.25 * periodSamples * (u1 + u2 - 1.0);
    }
    /// The ring's soft limit: unchanged up to ±4, then a knee to ±6 (a pulse
    /// train with a harmonic on a high-Q ring builds up to Q times its size).
    static double ringLimit(double r) noexcept {
        const double a = std::fabs(r);
        return a <= 4.0 ? r : std::copysign(4.0 + 2.0 * std::tanh((a - 4.0) * 0.5), r);
    }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        reset();
    }

    void reset() noexcept {
        count_ = 0;
        now_ = 0;
        cur_ = pend_ = sCur_ = sPend_ = 0.0;
        fresh_ = true;
        elapsed_ = 0.0;
        running_ = false;
        burstLeft_ = 0;
        periodIndex_ = 0;
        pulseCount_ = 0;
        warmSamples_ = 0;
        locked_ = false;
        lastPpq_ = 0.0;
        syncCur_ = syncNext_ = false;
        qHead_ = qCount_ = 0;
        lastQueued_ = -1e300;
        trig_.reset();
        gateIn_.reset();
        reset_.reset();
        svf_.reset();
        lastHz_ = lastDamping_ = -1.0;
        lastPitch_ = -1e9f;
        periodSamples_ = 4800.0;
        widthSamples_ = delaySamples_ = 0.0;
        lastStart_ = 0.0;
    }

    void tick(const PulseGeneratorParams& p, const PulseGeneratorInput& in, PulseGeneratorFrame& out) noexcept {
        const double t = (double)now_, prev = t - 1.0;  // this sample handles the interval (prev, t]
        out.duty = false;
        duty_ = false;

        // The sample being finished (prev), before this interval's events.
        double naive = 0.0;
        bool gateHigh = false;
        if (count_ > 0) {
            naive = value(prev, 1);
            gateHigh = gateAt(prev);
            expire(prev);
        }
        if (fresh_) {  // settle the resonator at the resting level: no ring without an edge
            complement_ = p.complement;
            svf_.resetTo(complement_ ? 1.0f : 0.0f);
        }

        // Timing in samples.
        const double beats = p.mode == kPulseFreeRun ? dsp::syncBeats(p.sync) : 0.0;
        const bool synced = beats > 0.0 && in.running;
        double T = beats > 0.0 ? dsp::beatsToSamples(beats, in.bpm, sampleRate_) : p.periodSec * sampleRate_;
        if (in.started) warmSamples_ = 0;
        const bool warm = p.warmup && p.mode == kPulseFreeRun && beats <= 0.0;
        if (warm) {
            const double f = warmFactor((double)warmSamples_ / sampleRate_);
            T *= f;
            out.warming = f - 1.0 >= 0.001;
        } else {
            out.warming = false;
        }
        ++warmSamples_;
        T = std::max(T, kMinPeriod);
        double W = (p.percent ? std::clamp(p.widthPct, 0.0, 1.0) * T : p.widthSec * sampleRate_);
        const double knobW = W;
        if (!p.percent && p.mode != kPulseExternalWidth && W > T - 1.0) {
            W = T - 1.0;
            duty_ = true;
        }
        W = std::max(W, 0.0);
        const double D = std::max(0.0, p.percent ? std::clamp(p.delayPct, 0.0, 1.0) * T : p.delaySec * sampleRate_);
        const double rise = std::clamp(p.rise, 0.0, 1.0), fall = std::clamp(p.fall, 0.0, 1.0);
        periodSamples_ = T;
        widthSamples_ = W;
        delaySamples_ = D;
        Shape sh{T, W, D, rise * W, fall * W, p.doublePulse, p.mode == kPulseFreeRun, p.jitter, p.seed, in.voice};

        // Leaving External Width (or unpatching its Gate) ends an open pulse
        // now and forgets the pending edges.
        if (p.mode != kPulseExternalWidth) qCount_ = 0;
        if (p.mode != kPulseExternalWidth || !in.gatePatched) closeOpen(t);

        const bool resetEdge = reset_.process(in.reset) > 0;
        const bool trigEdge = trig_.process(in.trigger) > 0 || in.single;

        switch (p.mode) {
            case kPulseFreeRun: {
                if (synced) {
                    const double ppq = in.ppq;
                    const double tol = std::max(1e-7, 0.5 * std::fabs(in.ppqPerSample));
                    const bool jump = in.started || !locked_ || std::fabs(ppq - (lastPpq_ + in.ppqPerSample)) > tol;
                    if (jump) {
                        seek(ppq, beats, in.bpm, t, sh);
                    } else if (ppq > lastPpq_) {
                        const double n0 = std::floor(lastPpq_ / beats), n1 = std::floor(ppq / beats);
                        for (double n = n0 + 1.0; n <= n1 && n <= n0 + 2.0; n += 1.0) {
                            const double te = prev + (n * beats - lastPpq_) / (ppq - lastPpq_);
                            startPeriod(std::clamp(te, prev, t), (int64_t)n, sh);
                        }
                    }
                    locked_ = true;
                    lastPpq_ = ppq;
                    elapsed_ = dsp::wrap01(ppq / beats) * T;  // stopping continues from here
                } else {
                    locked_ = false;
                    if (in.started) periodIndex_ = 0;
                    if (fresh_ || in.started || resetEdge) {
                        dropFuture(t);
                        restartNow(t, sh);
                    } else {
                        double te;
                        if (advance(T, prev, te)) startPeriod(te, periodIndex_++, sh);
                    }
                }
                break;
            }
            case kPulseTriggered: {
                if (resetEdge) {
                    running_ = false;
                    burstLeft_ = 0;
                    dropFuture(t);
                }
                if (trigEdge) {
                    dropFuture(t);  // a trigger during a burst restarts it
                    burstLeft_ = std::clamp(p.burst, 1, 64);
                    restartNow(t, sh);
                    running_ = --burstLeft_ > 0;
                } else if (running_) {
                    double te;
                    if (advance(T, prev, te)) {
                        startPeriod(te, 0, sh);
                        running_ = --burstLeft_ > 0;
                    }
                }
                break;
            }
            case kPulseGated: {
                const int e = gateIn_.process(in.gate);
                if (e > 0 || (resetEdge && running_)) {
                    dropFuture(t);
                    running_ = true;
                    restartNow(t, sh);
                } else if (e < 0) {
                    running_ = false;
                    dropFuture(t);  // no pulse starts after the falling edge
                } else if (running_) {
                    double te;
                    if (advance(T, prev, te)) startPeriod(te, 0, sh);
                }
                break;
            }
            default: {  // External Width: a gate delay line
                const double tr = rise * knobW, tf = fall * knobW;
                if (in.gatePatched) {
                    const int e = gateIn_.process(in.gate);
                    if (e != 0) push(t + D, e > 0 ? Edge::Rise : Edge::Fall, 0.0);
                    if (e > 0) syncNext_ = true;
                } else if (trigEdge) {
                    push(t + D, Edge::Fixed, std::max(knobW, 0.0));
                    syncNext_ = true;
                }
                while (qCount_ > 0 && edges_[(size_t)qHead_].time <= t) {
                    const Edge& ed = edges_[(size_t)qHead_];
                    applyEdge(ed, tr, tf);
                    qHead_ = (qHead_ + 1) % kMaxEdges;
                    --qCount_;
                }
                lastStart_ = t;
                break;
            }
        }
        fresh_ = false;

        // Corners inside (prev, t]: polyBLEP for steps, polyBLAMP for ramp corners.
        collectAndCorrect(prev, t);

        // Outputs for sample prev.
        const double y = naive + cur_;
        cur_ = pend_;
        pend_ = 0.0;
        double s = (complement_ ? 1.0 - y : y) + sCur_;
        sCur_ = sPend_;
        sPend_ = 0.0;
        if (p.complement != complement_) {  // a polarity switch is an edge at t too
            const double v = value(t, 1);
            sCur_ -= 0.5 * (p.complement ? 1.0 - 2.0 * v : 2.0 * v - 1.0);
            complement_ = p.complement;
        }
        if (!std::isfinite(s)) s = 0.0;

        // Resonator coefficients only when Ring Freq, Pitch or Damping move.
        if (p.ringHz < lastHz_ || p.ringHz > lastHz_ || in.pitch < lastPitch_ || in.pitch > lastPitch_ ||
            p.damping < lastDamping_ || p.damping > lastDamping_) {
            lastHz_ = p.ringHz;
            lastPitch_ = in.pitch;
            lastDamping_ = p.damping;
            const double fr = std::clamp(p.ringHz, 1.0, 40000.0) * std::exp2(std::clamp((double)in.pitch, -10.0, 10.0));
            svf_.set((float)fr, (float)ringQ(p.damping), sampleRate_);
        }
        double r = (double)svf_.process((float)s).bp;
        if (!std::isfinite(r)) {
            svf_.resetTo((float)s);
            r = 0.0;
        }
        r = ringLimit(r);

        const double amp = std::clamp(p.amplitude, 0.0, 1.0);
        out.out = (float)(std::clamp(p.offset, -1.0, 1.0) + amp * (s + std::clamp(p.ring, 0.0, 1.0) * r));
        out.ring = (float)(amp * r);
        out.gate = (gateHigh != complement_) ? 1.0f : 0.0f;
        out.sync = syncCur_ ? 1.0f : 0.0f;
        syncCur_ = syncNext_;
        syncNext_ = false;
        out.duty = duty_;
        ++now_;
    }

    /// Effective period, width and delay in samples (after limits), for the view.
    double periodSamples() const noexcept { return periodSamples_; }
    double widthSamples() const noexcept { return widthSamples_; }
    double delaySamples() const noexcept { return delaySamples_; }
    /// Position in the current period, 0..1 (for the view's playhead).
    double position() const noexcept {
        return std::clamp(((double)now_ - lastStart_) / std::max(periodSamples_, 1.0), 0.0, 1.0);
    }
    /// The logical (naive) pulse shape p at time t in samples (tests).
    double logical(double t) const noexcept { return value(t, 1); }

private:
    static constexpr double kInf = std::numeric_limits<double>::infinity();

    /// One trapezoid: rise from t0 over tr, fall from t0 + w over tf; a
    /// ramp under one sample is a step at its midpoint (4.6). p = min(rise, fall).
    struct Pulse {
        double t0 = 0.0, w = 0.0, tr = 0.0, tf = 0.0;
        bool open = false;     ///< External Width: the fall is not known yet
        double born = -kInf;   ///< corners at or before this time are not corrected (seeks)
        double fallStart() const noexcept { return open ? kInf : t0 + w; }
        double end() const noexcept { return open ? kInf : fallStart() + (tf < 1.0 ? 0.5 * tf : tf); }
    };
    struct VS {
        double v, s;  ///< value and slope (per sample)
    };
    struct Edge {
        enum Kind : uint8_t { Rise, Fall, Fixed };
        double time = 0.0, width = 0.0;
        Kind kind = Rise;
    };
    /// Timing for the pulses of one period.
    struct Shape {
        double T, W, D, tr, tf;
        bool dbl, freeRun;
        double jitter;
        uint32_t seed;
        int voice;
    };

    // ---- the pulse shape ---------------------------------------------------

    /// clamp((t − a) / d, 0, 1) as a one-sided limit (side −1 left, +1 right).
    /// Exact equality (corner times are computed by the same expressions as the shape).
    static bool same(double a, double b) noexcept { return !(a < b) && !(a > b); }
    static VS ramp(double t, double a, double d, int side) noexcept {
        const double b = a + d;
        if (t < a || (same(t, a) && side < 0)) return {0.0, 0.0};
        if (t > b || (same(t, b) && side > 0)) return {1.0, 0.0};
        return {(t - a) / d, 1.0 / d};
    }
    static double step(double t, double c, int side) noexcept { return t > c || (same(t, c) && side > 0) ? 1.0 : 0.0; }

    static VS riseOf(const Pulse& u, double t, int side) noexcept {
        return u.tr < 1.0 ? VS{step(t, u.t0 + 0.5 * u.tr, side), 0.0} : ramp(t, u.t0, u.tr, side);
    }
    static VS fallOf(const Pulse& u, double t, int side) noexcept {
        if (u.open) return {1.0, 0.0};
        const double fs = u.fallStart();
        if (u.tf < 1.0) return {1.0 - step(t, fs + 0.5 * u.tf, side), 0.0};
        const VS r = ramp(t, fs, u.tf, side);
        return {1.0 - r.v, -r.s};
    }
    /// A pulse's value: min(rise, fall); on a tie the left limit takes the
    /// larger slope and the right limit the smaller (the min's one-sided slopes).
    static VS pulseAt(const Pulse& u, double t, int side) noexcept {
        if (t < u.t0) return {0.0, 0.0};
        const VS a = riseOf(u, t, side), b = fallOf(u, t, side);
        if (std::fabs(a.v - b.v) < 1e-12) return side < 0 ? (a.s > b.s ? a : b) : (a.s < b.s ? a : b);
        return a.v < b.v ? a : b;
    }
    /// All pulses: max, with the opposite tie rule.
    VS combined(double t, int side) const noexcept {
        VS best{0.0, 0.0};
        bool any = false;
        for (int i = 0; i < count_; ++i) {
            const VS v = pulseAt(pulses_[(size_t)i], t, side);
            if (!any || v.v > best.v + 1e-12) best = v;
            else if (std::fabs(v.v - best.v) <= 1e-12) best.s = side < 0 ? std::min(best.s, v.s) : std::max(best.s, v.s);
            any = true;
        }
        return best;
    }
    double value(double t, int side) const noexcept { return combined(t, side).v; }
    /// Gate: high for t0 ≤ t < t0 + W on any pulse.
    bool gateAt(double t) const noexcept {
        for (int i = 0; i < count_; ++i) {
            const Pulse& u = pulses_[(size_t)i];
            if (t >= u.t0 && t < u.fallStart()) return true;
        }
        return false;
    }

    // ---- band-limiting -----------------------------------------------------

    void collectAndCorrect(double prev, double t) noexcept {
        std::array<double, kMaxPulses * 5> at;
        int n = 0;
        auto add = [&](double c, double born) {
            if (c > prev && c <= t && c > born && n < (int)at.size()) at[(size_t)n++] = c;
        };
        for (int i = 0; i < count_; ++i) {
            const Pulse& u = pulses_[(size_t)i];
            if (u.t0 > t || u.end() <= prev) continue;
            if (u.tr < 1.0) {
                add(u.t0 + 0.5 * u.tr, u.born);
            } else {
                add(u.t0, u.born);
                add(u.t0 + u.tr, u.born);
            }
            if (u.open) continue;
            const double fs = u.fallStart();
            if (u.tf < 1.0) {
                add(fs + 0.5 * u.tf, u.born);
            } else {
                add(fs, u.born);
                add(fs + u.tf, u.born);
            }
            if (u.tr >= 1.0 && u.tf >= 1.0 && fs < u.t0 + u.tr)  // the fall cuts into the rise
                add((1.0 + u.t0 / u.tr + fs / u.tf) / (1.0 / u.tr + 1.0 / u.tf), u.born);
        }
        if (n == 0) return;
        std::sort(at.begin(), at.begin() + n);
        for (int k = 0; k < n; ++k) {
            if (k > 0 && same(at[(size_t)k], at[(size_t)k - 1])) continue;  // the same corner twice
            const double c = at[(size_t)k];
            const VS l = combined(c, -1), r = combined(c, 1);
            residual(c - prev, r.v - l.v, r.s - l.s);
        }
    }
    /// Adds the residuals of a jump and a slope change `a` (0..1] of a sample
    /// after prev: polyBLEP (two samples) and polyBLAMP ((1 − |x|)³ / 6).
    void residual(double a, double jump, double kink) noexcept {
        a = std::clamp(a, 0.0, 1.0);
        const double b = 1.0 - a;
        cur_ += jump * 0.5 * b * b + kink * (1.0 / 6.0) * b * b * b;
        pend_ += -jump * 0.5 * a * a + kink * (1.0 / 6.0) * a * a * a;
    }

    // ---- pulses and periods ------------------------------------------------

    void addPulse(double t0, double w, double tr, double tf, bool open = false, double born = -kInf) noexcept {
        if (count_ >= kMaxPulses) {
            duty_ = true;
            return;
        }
        Pulse& u = pulses_[(size_t)count_++];
        u.t0 = t0;
        u.w = std::max(w, 0.0);
        u.tr = std::max(tr, 0.0);
        u.tf = std::max(tf, 0.0);
        u.open = open;
        u.born = born;
    }
    void removeAt(int i) noexcept { pulses_[(size_t)i] = pulses_[(size_t)--count_]; }
    void expire(double t) noexcept {
        for (int i = count_ - 1; i >= 0; --i)
            if (pulses_[(size_t)i].end() < t - 1.0) removeAt(i);
    }
    /// Removes the pulses that have not started by t.
    void dropFuture(double t) noexcept {
        for (int i = count_ - 1; i >= 0; --i)
            if (pulses_[(size_t)i].t0 > t) removeAt(i);
    }

    /// Pulse index for jitter: the period index in Free Run (2n, 2n + 1 with
    /// Double), pulses since the start otherwise.
    void addJittered(double start, double offset, int64_t period, int which, const Shape& sh, double born) noexcept {
        const uint64_t k = sh.freeRun ? (sh.dbl ? 2u * (uint64_t)period + (uint64_t)which : (uint64_t)period) : pulseCount_++;
        double j = jitterOffset(sh.seed, k, sh.voice, sh.jitter, sh.T);
        if (offset + j < 0.0) j = -j;  // never before the event that caused it
        addPulse(start + offset + j, sh.W, sh.tr, sh.tf, false, born);
    }
    /// Starts a period at te: its pulse(s) and Sync. Seeks pass `born` = now.
    void startPeriod(double te, int64_t period, const Shape& sh, double born = -kInf) noexcept {
        lastStart_ = te;
        if (sh.dbl) {
            addJittered(te, 0.0, period, 0, sh, born);
            addJittered(te, sh.D, period, 1, sh, born);
        } else {
            addJittered(te, sh.D, period, 0, sh, born);
        }
        syncNext_ = true;
    }
    /// A period starting at t itself (a trigger, a reset, the first sample).
    void restartNow(double t, const Shape& sh) noexcept {
        elapsed_ = 0.0;
        startPeriod(t, sh.freeRun ? periodIndex_++ : 0, sh);
    }
    /// Advances the period timer over one sample; true with the start time
    /// `te` in (prev, prev + 1] when a period begins. Counting samples (not a
    /// phase) keeps integer periods exact; a shorter Period ends the current
    /// one at once.
    bool advance(double T, double prev, double& te) noexcept {
        if (elapsed_ + 1.0 < T) {
            elapsed_ += 1.0;
            return false;
        }
        te = std::clamp(prev + (T - elapsed_), prev + 1e-9, prev + 1.0);
        elapsed_ = prev + 1.0 - te;
        return true;
    }
    /// Synced Free Run after a start or a jump (4.7): the pulses are a function
    /// of the song position. Rebuilds every pulse that still reaches `t`; the
    /// jump in value at t is band-limited (and rings) like any edge.
    void seek(double ppq, double beats, double bpm, double t, const Shape& sh) noexcept {
        const double before = value(t, 1);
        count_ = 0;
        const double spb = dsp::beatsToSamples(1.0, bpm, sampleRate_);
        const double reach = sh.D + 0.25 * sh.T + sh.W + sh.tf + 2.0;
        const int64_t n = (int64_t)std::floor(ppq / beats);
        for (int64_t m = n; m > n - kMaxPulses / 2; --m) {
            const double start = t - (ppq - (double)m * beats) * spb;
            if (start + reach < t - 1.0) break;
            startPeriod(start, m, sh, t);
        }
        lastStart_ = t - (ppq - (double)n * beats) * spb;
        syncNext_ = lastStart_ > t - 1.0;  // the period starts at this sample (e.g. a start on the beat)
        residual(1.0, value(t, 1) - before, 0.0);
    }

    // ---- External Width ----------------------------------------------------

    void push(double time, Edge::Kind kind, double width) noexcept {
        if (qCount_ >= kMaxEdges) {
            duty_ = true;
            return;
        }
        Edge& e = edges_[(size_t)((qHead_ + qCount_) % kMaxEdges)];
        e.time = std::max(time, lastQueued_);  // edges stay in order when Delay moves
        e.kind = kind;
        e.width = width;
        lastQueued_ = e.time;
        ++qCount_;
    }
    void closeOpen(double te) noexcept {
        for (int i = 0; i < count_; ++i) {
            Pulse& u = pulses_[(size_t)i];
            if (u.open) {
                u.open = false;
                u.w = std::max(0.0, te - u.t0);
            }
        }
    }
    void applyEdge(const Edge& e, double tr, double tf) noexcept {
        switch (e.kind) {
            case Edge::Rise:
                closeOpen(e.time);
                addPulse(e.time, 0.0, tr, tf, true);
                break;
            case Edge::Fall: closeOpen(e.time); break;
            case Edge::Fixed: addPulse(e.time, e.width, tr, tf); break;
        }
    }

    double sampleRate_ = 48000.0;
    std::array<Pulse, kMaxPulses> pulses_{};
    int count_ = 0;
    int64_t now_ = 0;
    double cur_ = 0.0, pend_ = 0.0;    ///< residuals for the sample being finished and the next (p)
    double sCur_ = 0.0, sPend_ = 0.0;  ///< the same for polarity switches (s)
    bool fresh_ = true, complement_ = false, duty_ = false;
    double elapsed_ = 0.0;  ///< samples since the period started
    bool running_ = false;
    int burstLeft_ = 0;
    int64_t periodIndex_ = 0;
    uint64_t pulseCount_ = 0;
    int64_t warmSamples_ = 0;
    bool locked_ = false;
    double lastPpq_ = 0.0;
    bool syncCur_ = false, syncNext_ = false;
    std::array<Edge, kMaxEdges> edges_{};
    int qHead_ = 0, qCount_ = 0;
    double lastQueued_ = -1e300;
    dsp::GateEdge trig_, gateIn_, reset_;
    dsp::Svf svf_;
    double lastHz_ = -1.0, lastDamping_ = -1.0;
    float lastPitch_ = -1e9f;
    double periodSamples_ = 4800.0, widthSamples_ = 0.0, delaySamples_ = 0.0;
    double lastStart_ = 0.0;
};

}  // namespace bleep::patch
