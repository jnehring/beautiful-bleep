// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Sequencer timing (doc/specs/modules/step-sequencer.md §4.2), extracted from the
// Step Sequencer so every sequencer steps the same way:
//
//   Transport mode  step n = floor((ppq − origin·len) / len), phase-locked to
//                   the song position, so loop jumps and renders land on the
//                   same step; Reset moves the origin so the next boundary is
//                   step 0.
//   Clock mode      one step per rising Clock edge; the step length is the
//                   time between the last two pulses (before there are two:
//                   the previous length, initially a 1/16 at 120 BPM). Reset:
//                   the next pulse (or one on the same sample) is step 0.
//   Swing           odd steps start late by swing·len, where
//                   swing = (Swing − 50 %)·2 for a 50–75 % knob; even steps
//                   last len·(1 + swing), odd ones len·(1 − swing).
//
// Plus GateTimer (gate length per step) and ClockRatio (phase-locked clock
// divider / multiplier for Rotating Div and friends). The rate table lives in
// Tempo.h (noteValues, sequencerRates). Header-only, no allocation.
#pragma once

#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

namespace bleep::dsp {

/// The "Sync To" setting every sequencer has: what drives its steps.
///  Auto       Clock mode while the Clock jack is patched, else the transport
///             (the behaviour before the setting existed, and the default).
///  Clock      always Clock mode: only pulses on the Clock jack step it.
///  Transport  always the transport (or the module's own free/tempo timing);
///             a patched Clock jack is ignored.
enum SeqSync : int { SyncAuto = 0, SyncClock = 1, SyncTransport = 2 };

/// The choice names of the Sync To setting, in SeqSync order.
inline const std::vector<std::string>& seqSyncNames() {
    static const std::vector<std::string> names{"Auto", "Clock", "Transport"};
    return names;
}

/// True when the sequencer runs in Clock mode: the value to use in place of
/// "Clock jack patched". `sync` is the Sync To setting (SeqSync).
inline bool clockSynced(int sync, bool clockPatched) noexcept {
    return sync == SyncClock || (sync != SyncTransport && clockPatched);
}

/// Delay of odd steps as a share of a step: Swing knob 0.5…0.75 → 0…0.5.
inline float swingAmount(float swing) noexcept { return (std::clamp(swing, 0.5f, 0.75f) - 0.5f) * 2.0f; }

/// A swung step's length: even steps are longer, odd ones shorter.
inline double swungDuration(double stepSamples, int64_t n, float swingAmt) noexcept {
    return stepSamples * ((n & 1) ? 1.0 - swingAmt : 1.0 + swingAmt);
}

/// Gate length in samples for a step of `durationSamples` (at least 1).
inline int64_t gateSamples(double durationSamples, float gateLength) noexcept {
    return std::max<int64_t>(1, (int64_t)std::llround(std::clamp(gateLength, 0.01f, 1.0f) * durationSamples));
}

/// The transport step at `ppq` for steps of `stepBeats`, counted from the
/// grid index `origin`, with odd steps delayed by `swingAmt` (swingAmount).
inline int64_t transportStep(double ppq, double stepBeats, int64_t origin, float swingAmt) noexcept {
    const double s = ppq / stepBeats - (double)origin;
    int64_t n = (int64_t)std::floor(s);
    if ((n & 1) && s - (double)n < swingAmt) --n;
    return n;
}

/// Counts samples since a step start; a gate is over once `length` passed.
/// Order per sample: advance(), then start() at a step, then expired().
class GateTimer {
public:
    void reset() noexcept { since_ = 0, length_ = 1; }
    void advance() noexcept { ++since_; }
    void start(int64_t lengthSamples) noexcept { since_ = 0, length_ = std::max<int64_t>(1, lengthSamples); }
    bool expired() const noexcept { return since_ >= length_; }
    int64_t elapsed() const noexcept { return since_; }
    int64_t length() const noexcept { return length_; }

private:
    int64_t since_ = 0, length_ = 1;
};

/// One sample of input for SeqClock.
struct SeqClockInput {
    bool clocked = false;     ///< Clock jack patched: Clock mode
    float clock = 0.0f;       ///< Clock jack (rising edge at >= 0.5)
    float reset = 0.0f;       ///< Reset jack (rising edge at >= 0.5)
    bool running = false;     ///< transport playing with a valid position
    bool started = false;     ///< first sample after the transport started
    double ppq = 0.0;         ///< song position at this sample
    double bpm = 120.0;
    double stepBeats = 0.25;  ///< Transport mode step length in quarter notes
    float swing = 0.5f;       ///< Swing knob, 0.5 (straight) … 0.75
};

/// What SeqClock reports, in order, from one tick.
struct SeqClockEvent {
    enum Type : uint8_t {
        Release,  ///< end every sounding note now (Reset edge, transport stop)
        Step      ///< a step starts on this sample
    };
    enum Reason : uint8_t { None, Reset, Stop };
    Type type = Step;
    Reason reason = None;
    int64_t n = 0;                 ///< Step: step count (see SeqClock)
    double stepSamples = 0.0;      ///< Step: unswung step length in samples
    double durationSamples = 0.0;  ///< Step: this step's length with swing
};

/// The step clock of a sequencer. Per sample call tick(); it reports, in this
/// order: a Release for a Reset edge, up to two Steps (Clock mode: a late
/// swung step and the current one can meet on one sample), and a Release when
/// the transport stops. Step counts `n`:
///  - Transport: grid index since the origin (0 at song start, or the first
///    boundary after a Reset); can be negative before the origin.
///  - Clock: pulses since the last Reset (or the first pulse).
/// `n` is the seed index for repeatable randomness and the swing parity.
class SeqClock {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    /// Forgets all timing (no events): as a newly created module.
    void reset() noexcept {
        clock_.reset();
        reset_.reset();
        haveN_ = haveClock_ = false;
        lastN_ = 0;
        pendingReset_ = false;
        delayLeft_ = 0;
        sinceClock_ = 0;
        period_ = (int64_t)(sampleRate_ * 0.125);  // 1/16 at 120 BPM
        measured_ = false;
        transportOn_ = false;
        origin_ = 0;
        resetEdge_ = false;
    }

    /// Clock mode, before two pulses have been measured: assume this step
    /// length instead of a 1/16 at 120 BPM (e.g. the Rate at the current tempo).
    void setFallbackPeriod(int64_t samples) noexcept {
        if (!measured_) period_ = std::max<int64_t>(1, samples);
    }
    /// Starts counting steps again (e.g. on a transport start) but keeps the
    /// measured clock period, unlike reset().
    void restartCount() noexcept {
        const int64_t period = period_;
        const bool measured = measured_;
        reset();
        period_ = period;
        measured_ = measured;
    }

    /// One sample. `on(const SeqClockEvent&)` receives the events.
    template <class On>
    void tick(const SeqClockInput& in, On&& on) noexcept {
        swing_ = swingAmount(in.swing);
        resetEdge_ = reset_.process(in.reset) > 0;
        if (resetEdge_) release(on, SeqClockEvent::Reset);

        if (in.clocked) {
            ++sinceClock_;
            if (resetEdge_) {
                pendingReset_ = true;
                delayLeft_ = 0;
            }
            if (delayLeft_ > 0 && --delayLeft_ == 0) step(on, pendingN_, (double)period_);
            if (clock_.process(in.clock) > 0) {
                if (delayLeft_ > 0) {  // the swung step is late: play it now
                    delayLeft_ = 0;
                    step(on, pendingN_, (double)period_);
                }
                if (sinceClock_ > 0 && haveClock_) period_ = sinceClock_, measured_ = true;
                haveClock_ = true;
                sinceClock_ = 0;
                const int64_t n = pendingReset_ || !haveN_ ? 0 : lastN_ + 1;
                pendingReset_ = false;
                haveN_ = true;
                lastN_ = n;
                const int delay = (n & 1) ? (int)std::lround(swing_ * (double)period_) : 0;
                if (delay >= 1) {
                    pendingN_ = n;
                    delayLeft_ = delay;
                } else {
                    step(on, n, (double)period_);
                }
            }
        } else if (in.running) {
            const double beats = in.stepBeats;
            if (in.started || !transportOn_) {
                if (in.started) origin_ = 0;
                haveN_ = false;
            }
            transportOn_ = true;
            if (resetEdge_) origin_ = (int64_t)std::floor(in.ppq / beats) + 1;  // the next boundary is step 0
            const int64_t n = transportStep(in.ppq, beats, origin_, swing_);
            if (resetEdge_) {  // silent until then
                haveN_ = true;
                lastN_ = n;
            } else if (!haveN_ || n != lastN_) {
                haveN_ = true;
                lastN_ = n;
                step(on, n, beats * 60.0 / std::max(in.bpm, 1.0) * sampleRate_);
            }
        } else if (transportOn_) {
            transportOn_ = false;
            haveN_ = false;
            release(on, SeqClockEvent::Stop);
        }
    }

    /// The last step count (valid once a step played).
    int64_t lastStep() const noexcept { return lastN_; }
    bool hasStep() const noexcept { return haveN_; }
    /// Clock mode: the measured pulse period in samples.
    int64_t periodSamples() const noexcept { return period_; }
    /// Transport mode: the grid index of step 0 (moved by Reset).
    int64_t origin() const noexcept { return origin_; }
    /// Transport mode is running (a Stop release follows when it stops).
    bool transportActive() const noexcept { return transportOn_; }
    /// The last tick saw a rising Reset edge.
    bool resetEdge() const noexcept { return resetEdge_; }
    /// The current swing amount (0…0.5).
    float swing() const noexcept { return swing_; }

private:
    template <class On>
    void release(On& on, SeqClockEvent::Reason why) noexcept {
        SeqClockEvent e;
        e.type = SeqClockEvent::Release;
        e.reason = why;
        on(static_cast<const SeqClockEvent&>(e));
    }
    template <class On>
    void step(On& on, int64_t n, double stepSamples) noexcept {
        SeqClockEvent e;
        e.type = SeqClockEvent::Step;
        e.n = n;
        e.stepSamples = stepSamples;
        e.durationSamples = swungDuration(stepSamples, n, swing_);
        on(static_cast<const SeqClockEvent&>(e));
    }

    double sampleRate_ = 48000.0;
    GateEdge clock_, reset_;
    float swing_ = 0.0f;
    bool haveN_ = false, haveClock_ = false, pendingReset_ = false, resetEdge_ = false, measured_ = false;
    int64_t lastN_ = 0, pendingN_ = 0;
    int64_t delayLeft_ = 0, sinceClock_ = 0, period_ = 6000;
    bool transportOn_ = false;
    int64_t origin_ = 0;
};

/// A phase-locked clock divider / multiplier: output cycles of `div / mul`
/// input steps (÷div, ×mul).
///  - Transport: from a position `x` in input steps (e.g. (ppq − off) / len),
///    cycle = floor(x · mul / div); a pure function of the song position.
///  - Clock: a counter n advances on every pulse (0 on the first pulse after
///    Reset; a Reset and a pulse on one sample count as 0); a cycle starts on
///    pulses where n mod div = 0, and ×mul adds mul − 1 evenly spaced pulses
///    from the measured pulse period.
class ClockRatio {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        have_ = haveClock_ = pendingReset_ = false;
        cycle_ = n_ = 0;
        sub_ = mul_;
        sinceClock_ = sinceCycle_ = 0;
        period_ = (int64_t)(sampleRate_ * 0.125);
    }
    void setRatio(int div, int mul = 1) noexcept {
        div_ = std::max(1, div);
        mul_ = std::max(1, mul);
    }
    int division() const noexcept { return div_; }
    int multiplication() const noexcept { return mul_; }

    static int64_t cycleAt(double x, int div, int mul = 1) noexcept {
        return (int64_t)std::floor(x * (double)std::max(1, mul) / (double)std::max(1, div));
    }
    static double phaseAt(double x, int div, int mul = 1) noexcept {
        return wrap01(x * (double)std::max(1, mul) / (double)std::max(1, div));
    }

    /// Transport, per sample: true when a cycle starts. `restart` (first
    /// sample after the transport started, or after a stop) re-syncs without
    /// catching up: it fires only when `x` sits exactly on a cycle start.
    bool transport(double x, bool restart) noexcept {
        const int64_t c = cycleAt(x, div_, mul_);
        phase_ = phaseAt(x, div_, mul_);
        if (restart || !have_) {
            have_ = true;
            cycle_ = c;
            return phase_ < 1e-9;
        }
        if (c == cycle_) return false;
        cycle_ = c;
        return true;
    }
    /// Transport stopped: the next transport() call re-syncs.
    void stop() noexcept { have_ = false; }

    /// Clock, per sample: `pulse` and `resetEdge` are rising edges. True when
    /// the output fires.
    bool clock(bool pulse, bool resetEdge) noexcept {
        ++sinceClock_;
        ++sinceCycle_;
        if (resetEdge) pendingReset_ = true;
        if (pulse) {
            if (haveClock_ && sinceClock_ > 0) period_ = sinceClock_;
            haveClock_ = true;
            sinceClock_ = 0;
            n_ = pendingReset_ || !have_ ? 0 : n_ + 1;
            pendingReset_ = false;
            have_ = true;
            if (n_ % div_ == 0) {
                cycle_ = n_ / div_;
                sub_ = 1;
                sinceCycle_ = 0;
                phase_ = 0.0;
                return true;
            }
        }
        if (sub_ < mul_ && (double)sinceCycle_ >= std::round((double)sub_ * cycleSamples())) {
            ++sub_;
            return true;
        }
        return false;
    }

    /// The last cycle index (Transport) or input pulse count / div (Clock).
    int64_t cycle() const noexcept { return cycle_; }
    /// Transport: the phase in the current output cycle, 0…1.
    double phase() const noexcept { return phase_; }
    /// Clock: input pulses since Reset.
    int64_t count() const noexcept { return n_; }
    /// Clock: the measured input period in samples.
    int64_t periodSamples() const noexcept { return period_; }
    /// Clock: one output pulse's length in samples (div · period / mul).
    double cycleSamples() const noexcept { return (double)period_ * (double)div_ / (double)mul_; }

private:
    double sampleRate_ = 48000.0;
    int div_ = 1, mul_ = 1, sub_ = 1;
    bool have_ = false, haveClock_ = false, pendingReset_ = false;
    int64_t cycle_ = 0, n_ = 0, sinceClock_ = 0, sinceCycle_ = 0, period_ = 6000;
    double phase_ = 0.0;
};

}  // namespace bleep::dsp
