// SPDX-License-Identifier: MIT
// Drum Grid core (doc/specs/modules/drum-grid.md): 8 tracks × 32 steps
// (Off/On/Accent) in 16 pattern slots; time from the transport, its own
// tempo or a clock; per-track gate, accent and velocity outputs.
#pragma once

#include "dsp/Smoothing.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum GridCell : uint8_t { GridOff = 0, GridOn = 1, GridAccent = 2 };
enum GridSource { GridTransport = 0, GridTempo = 1 };
enum GridSwitch { GridAtEnd = 0, GridImmediate = 1 };

constexpr int kGridTracks = 8, kGridSteps = 32, kGridSlots = 16;

struct GridPattern {
    std::array<std::array<uint8_t, kGridSteps>, kGridTracks> cells{};  ///< GridCell
    int length = 16;
};

/// Everything the view edits: the slots, which one is chosen, mute and solo.
struct GridBank {
    std::array<GridPattern, kGridSlots> patterns{};
    int current = 0;
    uint8_t mute = 0, solo = 0;  ///< bit per track
    /// Tracks that may play.
    uint8_t active() const noexcept { return (uint8_t)(solo ? solo : ~mute); }
};

struct GridParams {
    int source = GridTransport;
    int rate = 7;            ///< rateNames() index
    int ppqn = 0;            ///< ppqnNames() index; 0 = one pulse per step
    int switchMode = GridAtEnd;
    float tempo = 120.0f;    ///< BPM, Tempo mode
    float gateLength = 0.25f;
    float swing = 0.5f;      ///< 0.5 = straight .. 0.75
    float velocity = 0.7f;   ///< On steps; Accent steps play at 1
};

struct GridTime {
    bool running = false;    ///< transport playing with a valid position
    bool started = false;    ///< first sample after the transport started
    double bpm = 120.0;
    double ppq = 0.0;
};

struct GridInputs {
    float clock = 0.0f, run = 0.0f, reset = 0.0f, pattern = 0.0f;
    bool clockPatched = false, runPatched = false, patternPatched = false;
};

struct GridOutputs {
    std::array<float, kGridTracks> gate{}, accent{}, velocity{};
    float accentAny = 0.0f, stepClock = 0.0f, end = 0.0f, running = 0.0f;
};

class DrumGridDsp {
public:
    static constexpr int kNumRates = 12;
    static const std::array<const char*, kNumRates>& rateNames() {
        static const std::array<const char*, kNumRates> n{"1/4.",  "1/4",  "1/4T",  "1/8.",  "1/8",  "1/8T",
                                                          "1/16.", "1/16", "1/16T", "1/32.", "1/32", "1/32T"};
        return n;
    }
    /// A step's length in quarter notes.
    static double rateBeats(int rate) noexcept {
        static constexpr double b[kNumRates] = {1.5,   1.0,  2.0 / 3.0, 0.75,   0.5,   1.0 / 3.0,
                                                0.375, 0.25, 1.0 / 6.0, 0.1875, 0.125, 1.0 / 12.0};
        return b[std::clamp(rate, 0, kNumRates - 1)];
    }
    static constexpr int kNumPpqn = 5;
    static const std::array<const char*, kNumPpqn>& ppqnNames() {
        static const std::array<const char*, kNumPpqn> n{"1 per step", "2 PPQN", "4 PPQN", "24 PPQN", "48 PPQN"};
        return n;
    }
    /// Clock pulses per step: exact when `exact` comes back true.
    static int pulsesPerStep(int ppqn, int rate, bool* exact = nullptr) noexcept {
        static constexpr int q[kNumPpqn] = {0, 2, 4, 24, 48};
        const int perQuarter = q[std::clamp(ppqn, 0, kNumPpqn - 1)];
        if (perQuarter == 0) {
            if (exact) *exact = true;
            return 1;
        }
        const double p = perQuarter * rateBeats(rate);
        const int r = std::max(1, (int)std::lround(p));
        if (exact) *exact = std::fabs(p - (double)r) < 1e-9;
        return r;
    }
    /// The slot a Pattern input value selects.
    static int slotFor(float v) noexcept { return std::clamp((int)std::floor(v * kGridSlots), 0, kGridSlots - 1); }
    static int64_t mod(int64_t a, int64_t m) noexcept { return ((a % m) + m) % m; }

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    void reset() noexcept {
        clock_.reset();
        run_.reset();
        reset_.reset();
        haveN_ = false;
        lastN_ = 0;
        pendingRestart_ = false;
        pulses_ = 0;
        delayLeft_ = 0;
        sinceStep_ = sincePulseStep_ = 0;
        period_ = (int64_t)(sampleRate_ * 0.125);  // 1/16 at 120 BPM
        transportOn_ = false;
        origin_ = 0;
        phase_ = 0.0;
        tempoOn_ = false;
        played_ = false;
        patternStart_ = 0;
        pos_ = 0;
        gateSamples_ = 1;
        sounding_ = accented_ = retrig_ = hits_ = 0;
        velocity_.fill(0.0f);
        running_ = false;
    }

    /// New pattern data. Tracks that may no longer play stop at once.
    void setBank(const GridBank& b) noexcept {
        bank_ = b;
        sounding_ &= bank_.active();
        accented_ &= sounding_;
    }
    const GridBank& bank() const noexcept { return bank_; }

    int playingStep() const noexcept { return pos_; }
    int playingSlot() const noexcept { return playing_; }
    int queuedSlot() const noexcept { return target_ != playing_ ? target_ : -1; }
    uint8_t hits() const noexcept { return hits_; }
    bool running() const noexcept { return running_; }

    void tick(const GridParams& p, const GridInputs& in, const GridTime& t, GridOutputs& out) noexcept {
        out.stepClock = out.end = 0.0f;
        retrig_ = 0;
        swing_ = (std::clamp(p.swing, 0.5f, 0.75f) - 0.5f) * 2.0f;
        target_ = in.patternPatched ? slotFor(in.pattern) : std::clamp(bank_.current, 0, kGridSlots - 1);
        if (!played_) playing_ = target_;

        const int runEdge = run_.process(in.run);
        const bool runHigh = !in.runPatched || run_.high();
        const bool resetEdge = reset_.process(in.reset) > 0;
        const bool clockEdge = clock_.process(in.clock) > 0;
        ++sinceStep_;
        ++sincePulseStep_;
        const int mode = in.clockPatched ? 2 : (p.source == GridTempo ? 1 : 0);
        if (mode != mode_) {
            stop();
            haveN_ = transportOn_ = tempoOn_ = false;
            pulses_ = 0;
            pendingRestart_ = true;
            mode_ = mode;
        }
        if (in.runPatched && runEdge < 0) stop();

        if (mode == 2) {  // Clock
            if (resetEdge || (in.runPatched && runEdge > 0)) {
                pendingRestart_ = true;
                delayLeft_ = 0;
            }
            if (delayLeft_ > 0 && --delayLeft_ == 0) start(p, pendingN_, (double)period_, out);
            running_ = runHigh;
            if (clockEdge && runHigh) {
                if (delayLeft_ > 0) {  // the swung step is late: play it now
                    delayLeft_ = 0;
                    start(p, pendingN_, (double)period_, out);
                }
                if (pendingRestart_) {
                    pulses_ = 0;
                    haveN_ = false;
                    played_ = false;
                    pendingRestart_ = false;
                }
                const int per = pulsesPerStep(p.ppqn, p.rate);
                if (mod(pulses_, per) == 0) {
                    const int64_t n = pulses_ / per;
                    if (haveN_ && sincePulseStep_ > 0) period_ = sincePulseStep_;
                    haveN_ = true;
                    sincePulseStep_ = 0;
                    const int delay = (n & 1) ? (int)std::lround(swing_ * (double)period_) : 0;
                    if (delay >= 1) {
                        pendingN_ = n;
                        delayLeft_ = delay;
                    } else {
                        start(p, n, (double)period_, out);
                    }
                }
                ++pulses_;
            }
        } else if (mode == 1) {  // Tempo
            running_ = runHigh;
            if (runHigh) {
                const double beats = rateBeats(p.rate);
                const double stepSamples = beats * 60.0 / std::clamp((double)p.tempo, 1.0, 1000.0) * sampleRate_;
                if (!tempoOn_ || resetEdge || (in.runPatched && runEdge > 0)) {
                    tempoOn_ = true;
                    phase_ = 0.0;
                    haveN_ = false;
                    played_ = false;
                } else {
                    phase_ += 1.0 / stepSamples;
                }
                fromPhase(p, phase_, stepSamples, false, out);
            } else {
                tempoOn_ = false;
            }
        } else if (t.running && runHigh) {  // Transport
            running_ = true;
            const double beats = rateBeats(p.rate);
            if (t.started || !transportOn_) {
                if (t.started) origin_ = 0;
                haveN_ = false;
            }
            transportOn_ = true;
            const bool restart = resetEdge || (in.runPatched && runEdge > 0);
            if (restart) origin_ = (int64_t)std::floor(t.ppq / beats) + 1;  // the next boundary is step 1
            fromPhase(p, t.ppq / beats - (double)origin_, beats * 60.0 / std::max(t.bpm, 1.0) * sampleRate_, restart, out);
        } else {
            running_ = false;
            if (transportOn_) {
                transportOn_ = false;
                haveN_ = false;
                stop();
            }
        }

        if (sinceStep_ >= gateSamples_) sounding_ = accented_ = 0;
        const uint8_t gates = sounding_ & (uint8_t)~retrig_;
        for (int k = 0; k < kGridTracks; ++k) {
            const bool g = (gates >> k) & 1;
            out.gate[(size_t)k] = g ? 1.0f : 0.0f;
            out.accent[(size_t)k] = g && ((accented_ >> k) & 1) ? 1.0f : 0.0f;
            out.velocity[(size_t)k] = velocity_[(size_t)k];
        }
        out.accentAny = (gates & accented_) ? 1.0f : 0.0f;
        out.running = running_ ? 1.0f : 0.0f;
    }

private:
    /// Transport and Tempo: `s` is the position in steps; a new integer part starts a step.
    void fromPhase(const GridParams& p, double s, double stepSamples, bool silent, GridOutputs& out) noexcept {
        s += 1e-9;  // an accumulated phase may land just short of a boundary
        int64_t n = (int64_t)std::floor(s);
        if ((n & 1) && s - (double)n < swing_) --n;
        if (silent) {  // after a restart in Transport mode: nothing until the next boundary
            haveN_ = true;
            lastN_ = n;
            played_ = false;
            return;
        }
        if (!haveN_ || n != lastN_) {
            haveN_ = true;
            lastN_ = n;
            start(p, n, stepSamples, out);
        }
    }

    void stop() noexcept {
        sounding_ = accented_ = 0;
        played_ = false;
        delayLeft_ = 0;
    }

    void start(const GridParams& p, int64_t n, double stepSamples, GridOutputs& out) noexcept {
        if (!played_) patternStart_ = n;  // a fresh start is step 1
        int length = std::clamp(bank_.patterns[(size_t)playing_].length, 1, kGridSteps);
        int pos = (int)mod(n - patternStart_, length);
        const bool wrapped = played_ && pos == 0;
        if (played_ && target_ != playing_ && (wrapped || p.switchMode == GridImmediate)) {
            playing_ = target_;
            length = std::clamp(bank_.patterns[(size_t)playing_].length, 1, kGridSteps);
            if (wrapped) patternStart_ = n;
            pos = (int)mod(n - patternStart_, length);
            out.end = 1.0f;
        }
        if (wrapped) out.end = 1.0f;
        played_ = true;
        pos_ = pos;
        out.stepClock = 1.0f;

        const double dur = stepSamples * ((n & 1) ? 1.0 - swing_ : 1.0 + swing_);
        gateSamples_ = std::max<int64_t>(1, (int64_t)std::llround(std::clamp(p.gateLength, 0.01f, 1.0f) * dur));
        sinceStep_ = 0;

        const GridPattern& pat = bank_.patterns[(size_t)playing_];
        const uint8_t active = bank_.active();
        uint8_t hits = 0, accents = 0;
        for (int k = 0; k < kGridTracks; ++k) {
            const uint8_t c = pat.cells[(size_t)k][(size_t)pos];
            if (c == GridOff || !((active >> k) & 1)) continue;
            hits |= (uint8_t)(1u << k);
            if (c == GridAccent) accents |= (uint8_t)(1u << k);
            velocity_[(size_t)k] = c == GridAccent ? 1.0f : std::clamp(p.velocity, 0.0f, 1.0f);
        }
        retrig_ = sounding_ & hits;  // a gate still high drops for this sample
        sounding_ = hits;
        accented_ = accents;
        hits_ = hits;
    }

    double sampleRate_ = 48000.0;
    GridBank bank_{};
    dsp::GateEdge clock_, run_, reset_;
    int mode_ = 0;
    float swing_ = 0.0f;
    bool haveN_ = false, pendingRestart_ = false;
    int64_t lastN_ = 0, pendingN_ = 0, pulses_ = 0;
    int64_t delayLeft_ = 0, sinceStep_ = 0, sincePulseStep_ = 0, period_ = 6000;
    bool transportOn_ = false, tempoOn_ = false, running_ = false;
    int64_t origin_ = 0;
    double phase_ = 0.0;
    bool played_ = false;
    int playing_ = 0, target_ = 0, pos_ = 0;
    int64_t patternStart_ = 0, gateSamples_ = 1;
    uint8_t sounding_ = 0, accented_ = 0, retrig_ = 0, hits_ = 0;
    std::array<float, kGridTracks> velocity_{};
};

}  // namespace bleep::patch
