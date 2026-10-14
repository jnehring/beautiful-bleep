// SPDX-License-Identifier: MIT
// Clock Div core (doc/specs/modules/clock-divider.md): eight clock dividers,
// each with its own division. Transport mode derives every cycle from the
// song position (a pure function of ppq, so loop jumps and renders agree);
// Clock mode counts pulses. A gate that is already high finishes its length
// when a division changes.
#pragma once

#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kCdOutputs = 8;
constexpr int kCdMaxDivision = 64;

/// Realign setting → bars (0 = Never).
inline int cdRealignBars(int setting) noexcept {
    static constexpr int bars[5] = {0, 1, 2, 4, 8};
    return bars[std::clamp(setting, 0, 4)];
}

struct CdParams {
    int div[kCdOutputs]{2, 3, 4, 5, 6, 8, 16, 32};
    double baseBeats = 0.25;  ///< Base in quarter notes
    int realign = 0;          ///< bars, 0 = Never
    bool trigger = false;     ///< Output: Trigger
    bool gateBase = false;    ///< Gate Length: Base Step
    float width = 0.5f;
};

struct CdInput {
    float clock = 0.0f, reset = 0.0f;
    bool clocked = false;  ///< Clock patched (or forced by Sync To)
    bool running = false;  ///< transport playing with a valid position
    bool started = false;
    double ppq = 0.0;
    double ppqPerSample = 0.0;
    double bpm = 120.0;
};

struct CdOutputs {
    float out[kCdOutputs]{};
};

class ClockDividerDsp {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    void reset() noexcept {
        clock_.reset();
        reset_.reset();
        off_ = lastPpq_ = 0.0;
        wasRunning_ = wasClocked_ = false;
        haveN_ = haveClock_ = pendingReset_ = false;
        n_ = step_ = sinceClock_ = 0;
        period_ = (int64_t)(sampleRate_ * 0.125);
        for (int k = 0; k < kCdOutputs; ++k) {
            end_[k] = -1e300;
            gateLeft_[k] = 0;
            high_[k] = false;
        }
    }

    /// One sample.
    void tick(const CdParams& p, const CdInput& in, CdOutputs& out) noexcept {
        const bool resetEdge = reset_.process(in.reset) > 0;
        const bool clockEdge = clock_.process(in.clock) > 0;
        if (in.clocked != wasClocked_) {  // mode switch: start clean
            for (int k = 0; k < kCdOutputs; ++k) end_[k] = -1e300, gateLeft_[k] = 0;
            haveN_ = wasRunning_ = false;
            wasClocked_ = in.clocked;
        }
        int d[kCdOutputs];
        for (int k = 0; k < kCdOutputs; ++k) d[k] = std::clamp(p.div[k], 1, kCdMaxDivision);

        bool rose[kCdOutputs]{};
        if (in.clocked) clockMode(p, d, clockEdge, resetEdge, rose);
        else transportMode(p, in, d, resetEdge, rose);

        for (int k = 0; k < kCdOutputs; ++k) {
            const bool h = in.clocked ? gateLeft_[k] > 0 : in.running && in.ppq < end_[k];
            if (p.trigger) out.out[k] = rose[k] ? 1.0f : 0.0f;
            else out.out[k] = rose[k] && high_[k] ? 0.0f : (h ? 1.0f : 0.0f);  // a rise on a high gate dips for a sample
            high_[k] = out.out[k] > 0.5f;
            if (in.clocked && gateLeft_[k] > 0) --gateLeft_[k];
        }
    }

    bool high(int k) const noexcept { return high_[k]; }
    /// Base steps into the realign window (Transport) or since Reset (Clock).
    int64_t step() const noexcept { return step_; }

private:
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

    /// The gate of output k for the cycle containing `q`: sets end_[k].
    void startGate(const CdParams& p, const CdInput& in, int k, int d, const Pos& q, double b, double L) noexcept {
        const int64_t c = cycleOf(q, d);
        const double winStart = off_ + (L > 0.0 ? (double)q.window * L : 0.0);
        const double start = winStart + (double)c * d * b;
        double cycleEnd = start + (double)d * b;
        if (L > 0.0) cycleEnd = std::min(cycleEnd, winStart + L);
        const double gap = 0.001 * in.bpm / 60.0;  // ≥ 1 ms low before the next rise
        double len = std::clamp((double)p.width, 0.01, 0.99) * (p.gateBase ? b : (double)d * b);
        len = std::min(len, cycleEnd - start - gap);
        end_[k] = start + std::max(len, in.ppqPerSample);
    }

    void transportMode(const CdParams& p, const CdInput& in, const int* d, bool resetEdge, bool* rose) noexcept {
        if (!in.running) {
            if (wasRunning_) {
                off_ = 0.0;  // Reset is cleared when the transport stops
                for (int k = 0; k < kCdOutputs; ++k) end_[k] = -1e300;
            }
            wasRunning_ = false;
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
        const Pos prev = position(in.ppq - in.ppqPerSample, b, L);
        step_ = (int64_t)std::floor(now.x + 1e-9);
        for (int k = 0; k < kCdOutputs; ++k) {
            const bool edge = now.window != prev.window || cycleOf(now, d[k]) != cycleOf(prev, d[k]);
            if (rebase) {
                // Start, stop→play or a jump: worked out from the position, with
                // no catching up: a pulse only on an exact cycle start, and a
                // gate mid-cycle stays high only if it already was.
                startGate(p, in, k, d[k], now, b, L);
                const double startX = (double)cycleOf(now, d[k]) * d[k];
                if (now.x - startX < in.ppqPerSample / b - 1e-12) rose[k] = true;
                else if (!high_[k]) end_[k] = -1e300;
            } else if (edge) {
                startGate(p, in, k, d[k], now, b, L);
                rose[k] = true;
            }
        }
    }

    void clockMode(const CdParams& p, const int* d, bool pulse, bool resetEdge, bool* rose) noexcept {
        ++sinceClock_;
        if (resetEdge) pendingReset_ = true;
        if (!pulse) return;
        if (haveClock_ && sinceClock_ > 0) period_ = sinceClock_;
        haveClock_ = true;
        sinceClock_ = 0;
        n_ = pendingReset_ || !haveN_ ? 0 : n_ + 1;
        pendingReset_ = false;
        haveN_ = true;
        step_ = n_;
        const double T = (double)period_;
        const double gap = 0.001 * sampleRate_;
        for (int k = 0; k < kCdOutputs; ++k) {
            if (n_ % d[k] != 0) continue;
            double len = std::clamp((double)p.width, 0.01, 0.99) * (p.gateBase ? T : (double)d[k] * T);
            len = std::min(len, (double)d[k] * T - gap);
            gateLeft_[k] = std::max<int64_t>(1, (int64_t)std::llround(len));
            rose[k] = true;
        }
    }

    double sampleRate_ = 48000.0;
    dsp::GateEdge clock_, reset_;
    // Transport
    double off_ = 0.0, lastPpq_ = 0.0;
    bool wasRunning_ = false;
    double end_[kCdOutputs]{};
    // Clock
    bool haveN_ = false, haveClock_ = false, pendingReset_ = false, wasClocked_ = false;
    int64_t n_ = 0, sinceClock_ = 0, period_ = 6000, step_ = 0;
    int64_t gateLeft_[kCdOutputs]{};
    bool high_[kCdOutputs]{};
};

}  // namespace bleep::patch
