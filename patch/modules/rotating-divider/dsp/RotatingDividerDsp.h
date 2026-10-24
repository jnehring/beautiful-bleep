// SPDX-License-Identifier: GPL-3.0-only
// Rotating Div core (doc/specs/modules/rotating-divider.md): eight clock
// dividers on one base clock, their divisions taken from a series (Set) and
// rotated across the outputs. Transport mode derives every cycle from the
// song position (a pure function of ppq, so loop jumps and renders agree);
// Clock mode counts pulses. Rotation changes wait for the next base step or
// bar, and a gate that is already high finishes under its old division.
#pragma once

#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum RdSet { RdIntegers = 0, RdOdds, RdEvens, RdPrimes, RdPowers, RdFibonacci, RdCustom };
enum RdSync { RdImmediate = 0, RdNextStep, RdNextBar };

constexpr int kRdOutputs = 8;
constexpr int kRdMaxDivision = 4096;
constexpr int kRdMaxRotate = 16;

/// s(n) of a Set (n ≥ 0), capped at kRdMaxDivision. Custom: `custom[n mod 8]`.
inline int rdSeries(int set, int n, const int* custom = nullptr) noexcept {
    static constexpr int primes[kRdOutputs + kRdMaxRotate] = {1,  2,  3,  5,  7,  11, 13, 17, 19, 23, 29, 31,
                                                              37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83};
    n = std::max(0, n);
    int64_t v = 1;
    switch (set) {
        case RdOdds: v = 2 * (int64_t)n + 1; break;
        case RdEvens: v = 2 * (int64_t)n + 2; break;
        case RdPrimes: v = primes[std::min(n, kRdOutputs + kRdMaxRotate - 1)]; break;
        case RdPowers: v = n >= 12 ? kRdMaxDivision : (int64_t)1 << n; break;
        case RdFibonacci: {
            int64_t a = 1, b = 2;
            for (int i = 0; i < n && a < kRdMaxDivision; ++i) {
                const int64_t c = a + b;
                a = b;
                b = c;
            }
            v = a;
            break;
        }
        case RdCustom: v = custom ? custom[n % kRdOutputs] : n % kRdOutputs + 1; break;
        default: v = (int64_t)n + 1; break;
    }
    return (int)std::clamp<int64_t>(v, 1, kRdMaxDivision);
}

/// The eight divisions for a Set, a Rotate value and the Rotate Mode
/// (Extend = the series continues; Custom always wraps).
inline void rdDivisions(int set, int rotate, bool extend, const int* custom, int* out) noexcept {
    const int r = std::clamp(rotate, 0, kRdMaxRotate);
    for (int k = 0; k < kRdOutputs; ++k)
        out[k] = extend && set != RdCustom ? rdSeries(set, k + r, custom) : rdSeries(set, (k + r) % kRdOutputs, custom);
}

/// Realign setting → bars (0 = Never).
inline int rdRealignBars(int setting) noexcept {
    static constexpr int bars[5] = {0, 1, 2, 4, 8};
    return bars[std::clamp(setting, 0, 4)];
}

struct RdParams {
    int set = RdIntegers;
    bool extend = false;       ///< Rotate Mode
    int sync = RdNextStep;
    double baseBeats = 0.25;   ///< Base in quarter notes
    int realign = 0;           ///< bars, 0 = Never
    bool trigger = false;      ///< Output: Trigger
    bool gateBase = false;     ///< Gate Length: Base Step
    float width = 0.5f;
    int rotate = 0;
    const int* custom = nullptr;  ///< 8 custom divisions
};

struct RdInput {
    float clock = 0.0f, reset = 0.0f;
    bool clocked = false;      ///< Clock patched
    bool running = false;      ///< transport playing with a valid position
    bool started = false;
    double ppq = 0.0;
    double ppqPerSample = 0.0;
    double bpm = 120.0;
};

struct RdOutputs {
    float out[kRdOutputs]{};
    float stair = 0.0f;
    float align = 0.0f;
};

class RotatingDividerDsp {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    void reset() noexcept {
        clock_.reset();
        reset_.reset();
        haveMap_ = havePending_ = haveWant_ = false;
        off_ = 0.0;
        wasRunning_ = false;
        haveN_ = haveClock_ = pendingReset_ = false;
        n_ = 0;
        sinceClock_ = 0;
        period_ = (int64_t)(sampleRate_ * 0.125);
        for (int k = 0; k < kRdOutputs; ++k) {
            end_[k] = stairEnd_[k] = -1e300;
            gateLeft_[k] = stairLeft_[k] = 0;
            high_[k] = false;
        }
        wasClocked_ = false;
    }

    /// One sample.
    void tick(const RdParams& p, const RdInput& in, RdOutputs& out) noexcept { tickImpl(p, in, out); }

    const int* divisions() const noexcept { return map_; }
    const int* pending() const noexcept { return havePending_ ? pending_ : map_; }
    bool hasPending() const noexcept { return havePending_; }
    bool high(int k) const noexcept { return high_[k]; }
    /// The base step count: in the realign window (Transport) or since Reset (Clock).
    int64_t step() const noexcept { return step_; }

private:
    void tickImpl(const RdParams& p, const RdInput& in, RdOutputs& out) noexcept {
        out.align = 0.0f;
        const bool resetEdge = reset_.process(in.reset) > 0;
        const bool clockEdge = clock_.process(in.clock) > 0;
        if (in.clocked != wasClocked_) {  // mode switch: start clean
            for (int k = 0; k < kRdOutputs; ++k) end_[k] = stairEnd_[k] = -1e300, gateLeft_[k] = stairLeft_[k] = 0;
            haveN_ = false;
            wasRunning_ = false;
            wasClocked_ = in.clocked;
        }

        // The mapping the knobs ask for (recomputed only when they change).
        const int key = p.set | p.rotate << 4 | (int)p.extend << 12;
        bool same = haveWant_ && key == wantKey_;
        for (int k = 0; k < kRdOutputs && same && p.set == RdCustom; ++k) same = p.custom && p.custom[k] == custom_[k];
        if (!same) {
            rdDivisions(p.set, p.rotate, p.extend, p.custom, want_);
            wantKey_ = key;
            haveWant_ = true;
            for (int k = 0; k < kRdOutputs; ++k) custom_[k] = p.custom ? p.custom[k] : 0;
        }
        const int* want = want_;
        if (!haveMap_) {
            std::copy(want, want + kRdOutputs, map_);
            haveMap_ = true;
        }
        bool differs = false;
        for (int k = 0; k < kRdOutputs && !differs; ++k) differs = want[k] != map_[k];
        havePending_ = differs;  // a newer value supersedes a pending one; back where it was: none
        if (differs) std::copy(want, want + kRdOutputs, pending_);

        bool rose[kRdOutputs]{};
        int rises = 0;
        if (in.clocked) {
            clockMode(p, in, clockEdge, resetEdge, rose, rises);
        } else {
            transportMode(p, in, resetEdge, rose, rises);
        }
        if (rises == kRdOutputs) out.align = 1.0f;

        // Outputs and Stair.
        int bits = 0;
        for (int k = 0; k < kRdOutputs; ++k) {
            bool h, sh;
            if (in.clocked) {
                h = gateLeft_[k] > 0;
                sh = stairLeft_[k] > 0;
            } else {
                h = in.running && in.ppq < end_[k];
                sh = in.running && in.ppq < stairEnd_[k];
            }
            if (p.trigger) {
                out.out[k] = rose[k] ? 1.0f : 0.0f;
                if (sh) bits |= 1 << (kRdOutputs - 1 - k);
            } else {
                // A rise while the old gate is still high dips for one sample.
                out.out[k] = rose[k] && high_[k] ? 0.0f : (h ? 1.0f : 0.0f);
                if (h) bits |= 1 << (kRdOutputs - 1 - k);
            }
            high_[k] = out.out[k] > 0.5f;
            if (in.clocked) {
                if (gateLeft_[k] > 0) --gateLeft_[k];
                if (stairLeft_[k] > 0) --stairLeft_[k];
            }
        }
        out.stair = (float)bits / 255.0f;
    }

    void apply() noexcept {
        std::copy(pending_, pending_ + kRdOutputs, map_);
        havePending_ = false;
    }

    // ---- Transport ----------------------------------------------------------------
    struct Pos {
        int64_t window = 0;  ///< realign window index
        double x = 0.0;      ///< base steps into the window
    };
    Pos position(double ppq, double b, double L) const noexcept {
        const double rel = ppq - off_;
        Pos q;
        if (L > 0.0) {
            q.window = (int64_t)std::floor(rel / L);
            q.x = (rel - (double)q.window * L) / b;
        } else {
            q.x = rel / b;
        }
        return q;
    }
    static int64_t cycleOf(const Pos& q, int d) noexcept { return (int64_t)std::floor(q.x / (double)d + 1e-9); }

    /// The gate of output k for the cycle containing `q`: sets end_ and stairEnd_.
    void startGate(const RdParams& p, const RdInput& in, int k, const Pos& q, double b, double L) noexcept {
        const int d = map_[k];
        const int64_t c = cycleOf(q, d);
        const double winStart = off_ + (L > 0.0 ? (double)q.window * L : 0.0);
        const double start = winStart + (double)c * d * b;
        double cycleEnd = start + (double)d * b;
        if (L > 0.0) cycleEnd = std::min(cycleEnd, winStart + L);
        const double gap = 0.001 * in.bpm / 60.0;  // ≥ 1 ms low before the next rise
        double len = std::clamp((double)p.width, 0.01, 0.99) * (p.gateBase ? b : (double)d * b);
        len = std::min(len, cycleEnd - start - gap);
        end_[k] = start + std::max(len, in.ppqPerSample);
        stairEnd_[k] = start + std::min(b, cycleEnd - start);
    }

    void transportMode(const RdParams& p, const RdInput& in, bool resetEdge, bool* rose, int& rises) noexcept {
        if (!in.running) {
            if (wasRunning_) {
                off_ = 0.0;  // Reset is cleared when the transport stops
                for (int k = 0; k < kRdOutputs; ++k) end_[k] = stairEnd_[k] = -1e300;
            }
            wasRunning_ = false;
            if (havePending_) apply();
            return;
        }
        const double b = std::max(p.baseBeats, 1e-6);
        const double L = 4.0 * (double)p.realign;
        bool rebase = in.started || !wasRunning_;
        if (in.started) off_ = 0.0;
        if (std::fabs(in.ppq - (lastPpq_ + in.ppqPerSample)) > 0.5 * in.ppqPerSample + 1e-9) rebase = true;  // a jump
        lastPpq_ = in.ppq;
        wasRunning_ = true;
        if (resetEdge) off_ = (std::floor(in.ppq / b) + 1.0) * b;  // the next base step is x = 0

        const Pos now = position(in.ppq, b, L);
        step_ = (int64_t)std::floor(now.x + 1e-9);
        const Pos prev = position(in.ppq - in.ppqPerSample, b, L);
        const bool stepEdge = now.window != prev.window || std::floor(now.x + 1e-9) != std::floor(prev.x + 1e-9);
        const bool barEdge = std::floor(in.ppq / 4.0 + 1e-9) != std::floor((in.ppq - in.ppqPerSample) / 4.0 + 1e-9);
        bool applied = false;
        if (havePending_ && (p.sync == RdImmediate || (p.sync == RdNextStep && stepEdge) || (p.sync == RdNextBar && barEdge))) {
            apply();
            applied = true;
        }

        for (int k = 0; k < kRdOutputs; ++k) {
            const int d = map_[k];
            const bool edge = now.window != prev.window || cycleOf(now, d) != cycleOf(prev, d);
            if (rebase) {
                // Start, stop→play or a jump: worked out from the position, with
                // no catching up: a pulse only on an exact cycle start, and a
                // gate mid-cycle stays high only if it already was.
                startGate(p, in, k, now, b, L);
                const double startX = (double)cycleOf(now, d) * d;
                if (now.x - startX < in.ppqPerSample / b - 1e-12) {
                    rose[k] = true;
                    ++rises;
                } else {
                    if (!high_[k]) end_[k] = -1e300;
                    stairEnd_[k] = -1e300;
                }
            } else if (edge) {
                startGate(p, in, k, now, b, L);
                rose[k] = true;
                ++rises;
            } else if (applied && !(in.ppq < end_[k])) {
                // New division, no edge: the current cycle's gate (if any) is already over,
                // so only the stair window follows the new division.
                const double keepEnd = end_[k];
                startGate(p, in, k, now, b, L);
                end_[k] = keepEnd;
            }
            // While a gate is high it finishes its length under the old division.
        }
    }

    // ---- Clock ---------------------------------------------------------------------
    void clockMode(const RdParams& p, [[maybe_unused]] const RdInput& in, bool pulse, bool resetEdge, bool* rose, int& rises) noexcept {
        ++sinceClock_;
        if (resetEdge) pendingReset_ = true;
        if (havePending_ && p.sync == RdImmediate) apply();
        if (!pulse) return;
        if (haveClock_ && sinceClock_ > 0) period_ = sinceClock_;
        haveClock_ = true;
        sinceClock_ = 0;
        n_ = pendingReset_ || !haveN_ ? 0 : n_ + 1;
        pendingReset_ = false;
        haveN_ = true;
        step_ = n_;
        if (havePending_ && p.sync == RdNextStep) apply();
        if (havePending_ && p.sync == RdNextBar) {
            bool aligned = true;
            for (int k = 0; k < kRdOutputs; ++k) aligned = aligned && n_ % map_[k] == 0;
            if (aligned) apply();
        }
        const double T = (double)period_;
        const double gap = 0.001 * sampleRate_;
        for (int k = 0; k < kRdOutputs; ++k) {
            const int d = map_[k];
            if (n_ % d != 0) continue;
            double len = std::clamp((double)p.width, 0.01, 0.99) * (p.gateBase ? T : (double)d * T);
            len = std::min(len, (double)d * T - gap);
            gateLeft_[k] = std::max<int64_t>(1, (int64_t)std::llround(len));
            stairLeft_[k] = std::max<int64_t>(1, (int64_t)std::llround(T));
            rose[k] = true;
            ++rises;
        }
    }

    double sampleRate_ = 48000.0;
    dsp::GateEdge clock_, reset_;
    int map_[kRdOutputs]{1, 2, 3, 4, 5, 6, 7, 8}, pending_[kRdOutputs]{};
    bool haveMap_ = false, havePending_ = false, haveWant_ = false;
    int want_[kRdOutputs]{}, custom_[kRdOutputs]{}, wantKey_ = 0;
    // Transport
    double off_ = 0.0, lastPpq_ = 0.0;
    bool wasRunning_ = false;
    double end_[kRdOutputs]{}, stairEnd_[kRdOutputs]{};
    // Clock
    bool haveN_ = false, haveClock_ = false, pendingReset_ = false, wasClocked_ = false;
    int64_t n_ = 0, sinceClock_ = 0, period_ = 6000, step_ = 0;
    int64_t gateLeft_[kRdOutputs]{}, stairLeft_[kRdOutputs]{};
    bool high_[kRdOutputs]{};
};

}  // namespace bleep::patch
