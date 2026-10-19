// SPDX-License-Identifier: GPL-3.0-or-later
// Clock Mult core (doc/specs/modules/clock-multiplier.md): six outputs, each
// ticking at its own ratio p/q of the input clock. Everything is worked out
// from a position x measured in input clocks:
//
//   Transport mode  x = (ppq - off) / base: a pure function of the song
//                   position, so loop jumps and renders land on the same ticks.
//   Clock mode      x counts pulses (n) plus the share of the measured period
//                   that has passed. Phase Lock pulls the running phase onto n
//                   at each pulse (100 %: snaps, 0 %: free-runs on the
//                   averaged period like a flywheel).
//
// Output k ticks at x = m * q / p. A tick that falls on a whole x is an anchor
// (it coincides with an input pulse); the others are in-between ticks. Swing
// delays the odd in-between ticks and Humanize delays each of them by its own
// seeded amount; anchors never move. A tick may be skipped with a probability.
#pragma once

#include "dsp/Random.h"
#include "dsp/Smoothing.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kCmOutputs = 6;
constexpr int kCmRatios = 25;

struct CmRatio {
    const char* name;
    int p, q;  ///< p ticks per q input clocks, in lowest terms
};

inline const CmRatio* cmRatios() {
    static const CmRatio list[kCmRatios] = {
        {"1/8", 1, 8}, {"1/4", 1, 4}, {"1/3", 1, 3}, {"1/2", 1, 2}, {"2/3", 2, 3}, {"3/4", 3, 4}, {"1", 1, 1},
        {"5/4", 5, 4}, {"4/3", 4, 3}, {"3/2", 3, 2}, {"5/3", 5, 3}, {"7/4", 7, 4}, {"2", 2, 1}, {"5/2", 5, 2},
        {"3", 3, 1}, {"7/2", 7, 2}, {"4", 4, 1}, {"5", 5, 1}, {"6", 6, 1}, {"7", 7, 1}, {"8", 8, 1},
        {"12", 12, 1}, {"16", 16, 1}, {"24", 24, 1}, {"32", 32, 1}};
    return list;
}

struct CmParams {
    int ratio[kCmOutputs]{12, 14, 16, 9, 7, 20};  ///< indices into cmRatios()
    float skip[kCmOutputs]{};                      ///< probability 0…1
    float swing = 0.0f;                            ///< 0…1: delay of odd in-between ticks, up to half an interval
    float humanize = 0.0f;                         ///< 0…1: seeded extra delay, up to 40 % of an interval
    float width = 0.5f;
    float lock = 1.0f;                             ///< Clock mode: share of the phase error removed per pulse
    double baseBeats = 1.0;                        ///< Transport mode: one input clock in quarter notes
    bool trigger = false;
    bool keepBeat = true;  ///< anchors are never skipped
    uint64_t seed = 1;
};

struct CmInput {
    float clock = 0.0f, reset = 0.0f;
    bool clocked = false;
    bool running = false;
    bool started = false;
    double ppq = 0.0;
    double ppqPerSample = 0.0;
};

struct CmOutputs {
    float out[kCmOutputs]{};
    float any = 0.0f;
};

class ClockMultiplierDsp {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    void reset() noexcept {
        clock_.reset();
        reset_.reset();
        off_ = 0.0;
        wasRunning_ = wasClocked_ = false;
        haveClock_ = pendingReset_ = havePair_ = false;
        n_ = 0;
        sinceClock_ = 0;
        period_ = sampleRate_ * 0.5;
        phase_ = 0.0;
        for (int k = 0; k < kCmOutputs; ++k) {
            gateLeft_[k] = 0;
            high_[k] = false;
            lastTick_[k] = -1;
        }
    }

    /// Tick index m of output k that lies in (xPrev, xNow], or -1.
    static int64_t tickIn(const CmRatio& r, const CmParams& p, int k, double xPrev, double xNow, bool& anchor) noexcept {
        const double iv = (double)r.q / (double)r.p;
        const int64_t top = (int64_t)std::floor(xNow / iv + 1e-9);
        for (int64_t m = top; m >= std::max<int64_t>(0, top - 1); --m) {
            const double t = tickTime(r, p, k, m, anchor);
            if (t > xPrev + 1e-9 && t <= xNow + 1e-9) return m;
        }
        return -1;
    }

    /// When tick m of output k happens, in input clocks.
    static double tickTime(const CmRatio& r, const CmParams& p, int k, int64_t m, bool& anchor) noexcept {
        const double iv = (double)r.q / (double)r.p;
        anchor = (m * r.q) % r.p == 0;
        double delay = 0.0;
        if (!anchor) {
            if (m & 1) delay += 0.5 * (double)std::clamp(p.swing, 0.0f, 1.0f);
            delay += 0.4 * (double)std::clamp(p.humanize, 0.0f, 1.0f) * dsp::uniform01(p.seed, (uint64_t)m, 100 + (uint64_t)k);
        }
        return ((double)m + delay) * iv;
    }

    /// Whether tick m of output k is dropped.
    static bool skipped(const CmParams& p, int k, int64_t m, bool anchor) noexcept {
        if (p.skip[k] <= 0.0f || (anchor && p.keepBeat)) return false;
        return dsp::uniform01(p.seed, (uint64_t)m, 200 + (uint64_t)k) < (double)p.skip[k];
    }

    void tick(const CmParams& p, const CmInput& in, CmOutputs& out) noexcept {
        const bool resetEdge = reset_.process(in.reset) > 0;
        const bool clockEdge = clock_.process(in.clock) > 0;
        if (in.clocked != wasClocked_) {
            for (int k = 0; k < kCmOutputs; ++k) gateLeft_[k] = 0, lastTick_[k] = -1;
            wasRunning_ = false;
            wasClocked_ = in.clocked;
        }
        double xPrev = 0.0, xNow = 0.0, dx = 0.0;
        bool active = false;
        if (in.clocked) active = clockMode(p, clockEdge, resetEdge, xPrev, xNow, dx);
        else active = transportMode(p, in, resetEdge, xPrev, xNow, dx);

        bool any = false;
        for (int k = 0; k < kCmOutputs; ++k) {
            bool rose = false;
            const CmRatio& r = cmRatios()[std::clamp(p.ratio[k], 0, kCmRatios - 1)];
            if (active && xNow >= 0.0 && dx > 0.0) {
                bool anchor = false;
                const int64_t m = tickIn(r, p, k, xPrev, xNow, anchor);
                if (m >= 0 && (!in.clocked || m > lastTick_[k])) {
                    if (in.clocked) lastTick_[k] = m;
                    if (!skipped(p, k, m, anchor)) {
                        rose = true;
                        const double ivSamples = ((double)r.q / (double)r.p) / dx;
                        const double len = std::clamp((double)p.width, 0.01, 0.99) * ivSamples;
                        gateLeft_[k] = std::max<int64_t>(1, (int64_t)std::llround(len));
                    }
                }
            } else if (!active) {
                gateLeft_[k] = 0;
            }
            const bool h = gateLeft_[k] > 0;
            if (p.trigger) out.out[k] = rose ? 1.0f : 0.0f;
            else out.out[k] = rose && high_[k] ? 0.0f : (h ? 1.0f : 0.0f);
            high_[k] = out.out[k] > 0.5f;
            if (gateLeft_[k] > 0) --gateLeft_[k];
            any = any || out.out[k] > 0.5f;
        }
        out.any = any ? 1.0f : 0.0f;
    }

    bool high(int k) const noexcept { return high_[k]; }
    /// The running position in input clocks (for displays and tests).
    double position() const noexcept { return in_clockMode_ ? phase_ : lastX_; }

private:
    bool transportMode(const CmParams& p, const CmInput& in, bool resetEdge, double& xPrev, double& xNow, double& dx) noexcept {
        in_clockMode_ = false;
        if (!in.running) {
            if (wasRunning_) off_ = 0.0;
            wasRunning_ = false;
            return false;
        }
        const double b = std::max(p.baseBeats, 1e-6);
        if (in.started) off_ = 0.0;
        wasRunning_ = true;
        if (resetEdge) off_ = (std::floor(in.ppq / b) + 1.0) * b;  // the next input clock is x = 0
        dx = in.ppqPerSample / b;
        xNow = (in.ppq - off_) / b;
        xPrev = xNow - dx;
        lastX_ = xNow;
        return true;
    }

    bool clockMode(const CmParams& p, bool pulse, bool resetEdge, double& xPrev, double& xNow, double& dx) noexcept {
        in_clockMode_ = true;
        ++sinceClock_;
        if (resetEdge) pendingReset_ = true;
        const double lock = std::clamp((double)p.lock, 0.0, 1.0);
        xPrev = phase_;
        if (haveClock_) {
            phase_ += 1.0 / period_;
            // At full lock the phase waits for the next pulse instead of running on.
            if (lock >= 0.999 && phase_ > (double)n_ + 1.0 - 1e-9) phase_ = (double)n_ + 1.0 - 1e-9;
        }
        if (pulse) {
            if (haveClock_ && sinceClock_ > 0) {
                const double measured = (double)sinceClock_;
                period_ = havePair_ ? period_ + (measured - period_) * (0.1 + 0.9 * lock) : measured;
                havePair_ = true;
            }
            const bool restart = pendingReset_ || !haveClock_;
            n_ = restart ? 0 : n_ + 1;
            pendingReset_ = false;
            sinceClock_ = 0;
            if (restart || std::fabs((double)n_ - phase_) > 1.0 || lock >= 0.999) {
                phase_ = (double)n_;
                if (restart) {
                    xPrev = -1.0;  // so the tick at x = 0 fires
                    for (int k = 0; k < kCmOutputs; ++k) lastTick_[k] = -1;
                }
            } else {
                phase_ += lock * ((double)n_ - phase_);
            }
            haveClock_ = true;
        }
        xNow = phase_;
        lastX_ = xNow;
        dx = haveClock_ ? 1.0 / period_ : 0.0;
        return haveClock_;
    }

    double sampleRate_ = 48000.0;
    dsp::GateEdge clock_, reset_;
    double off_ = 0.0, lastX_ = 0.0;
    bool wasRunning_ = false, wasClocked_ = false, in_clockMode_ = false;
    bool haveClock_ = false, pendingReset_ = false, havePair_ = false;
    int64_t n_ = 0, sinceClock_ = 0;
    double period_ = 24000.0, phase_ = 0.0;
    int64_t gateLeft_[kCmOutputs]{};
    int64_t lastTick_[kCmOutputs]{};
    bool high_[kCmOutputs]{};
};

}  // namespace bleep::patch
