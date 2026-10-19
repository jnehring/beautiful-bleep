// SPDX-License-Identifier: GPL-3.0-or-later
// Stage Seq core (doc/specs/modules/stage-sequencer.md): up to 16 stages, each a
// pitch held for 1–8 clock pulses with a gate mode (Rest, First, Every, Hold,
// Ratchet), slides, velocity and accent. Fixed orders are located
// arithmetically from the pulse count; Random and Brownian walks restart at
// every phrase and are replayed from the phrase start after a jump, so the
// module stays phase-locked to the song. Pulses come from dsp::SeqClock,
// notes from dsp::SeqVoice; notes leave through a callback.
#pragma once

#include "dsp/Random.h"
#include "dsp/Scales.h"
#include "dsp/SeqClock.h"
#include "dsp/SeqNotes.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum StageGate : uint8_t { StageRest = 0, StageFirst, StageEvery, StageHold, StageRatchet };
enum StageMode { StageForward = 0, StageReverse, StagePendulum, StageRandom, StageBrownian };

constexpr int kStages = 16, kStageMaxPulses = 8;
constexpr int kStageMinPitch = -24, kStageMaxPitch = 36;
constexpr int kStagePhraseBars[5] = {1, 2, 4, 8, 16};

struct Stage {
    int8_t pitch = 0;          ///< semitones above Root + Octave
    uint8_t pulses = 1;        ///< 1..8
    uint8_t gate = StageEvery;
    uint8_t ratchet = 2;       ///< 2..4 sub-gates per pulse
    bool slide = false;
    uint8_t velocity = 100;    ///< 1..127
    bool accent = false;
};
using StagePattern = std::array<Stage, kStages>;

struct StageParams {
    int stages = 8;
    int rate = 9;              ///< sequencer rate index (Tempo.h)
    int mode = StageForward;
    int phrase = 2;            ///< kStagePhraseBars index
    int root = 0, scale = 1, octave = 0;
    uint32_t seed = 1;
    float gateLength = 0.5f;   ///< share of a pulse (of a sub-pulse for ratchets)
    float slideTime = 0.08f;   ///< seconds to 99 %
    float accent = 0.5f;
    float swing = 0.5f;
};

struct StageTime {
    bool running = false, started = false;
    double bpm = 120.0, ppq = 0.0;
};

struct StageInputs {
    float clock = 0.0f, reset = 0.0f, hold = 0.0f, transpose = 0.0f;
    bool clockPatched = false;
};

struct StageOutputs {
    float pitch = 0.0f, gate = 0.0f, velocity = 0.0f, accent = 0.0f, trigger = 0.0f;
    float stage = 0.0f, stageStart = 0.0f, end = 0.0f;
};

/// Where pulse L of the sequence falls.
struct StagePosition {
    int stage = 0;
    int pulse = 0;             ///< pulse inside the stage
    int pulses = 1;            ///< the stage's pulses (cut at a phrase end)
    int64_t visit = 0;         ///< identifies the stage instance
    bool cycleStart = false;   ///< first pulse of the cycle (or phrase)
    int next = -1;             ///< the following stage (−1: none, phrase ends)
};

class StageSequencerDsp {
public:
    static int64_t mod(int64_t a, int64_t m) noexcept { return ((a % m) + m) % m; }
    static int64_t floorDiv(int64_t a, int64_t b) noexcept { return a >= 0 ? a / b : -((-a + b - 1) / b); }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        clock_.prepare(sampleRate);
    }

    void reset() noexcept {
        clock_.reset();
        voice_.reset();
        configured_ = havePos_ = played_ = replaying_ = false;
        stopRequested_ = dip_ = false;
        frozen_ = 0;
        subLeft_ = 0;
        walk_.valid = false;
        orderDirty_ = true;
        pitch_ = target_ = 0.0f;
        accentOn_ = false;
        trailLen_ = 0;
    }

    /// A new pattern. A change to the sounding stage's gate mode or pulses
    /// ends its note.
    void setPattern(const StagePattern& p) noexcept {
        const Stage before = pattern_[(size_t)cur_.stage];
        pattern_ = p;
        const Stage& now = pattern_[(size_t)cur_.stage];
        if (voice_.sounding() && (now.gate != before.gate || now.pulses != before.pulses)) stopRequested_ = true;
        orderDirty_ = true;
        walk_.valid = false;
    }
    const StagePattern& pattern() const noexcept { return pattern_; }

    int playingStage() const noexcept { return cur_.stage; }
    int playingPulse() const noexcept { return curPulse_; }
    bool sounding() const noexcept { return voice_.sounding(); }
    /// The last stages entered, newest first (Random and Brownian trails).
    int trail(int* out, int max) const noexcept {
        const int n = std::min(max, trailLen_);
        for (int i = 0; i < n; ++i) out[i] = trail_[(size_t)i];
        return n;
    }

    /// Locates pulse `L` (fixed orders arithmetically, walks by replaying
    /// the phrase). Public for tests and the view's cycle length.
    StagePosition locate(const StageParams& p, int64_t L) noexcept {
        const int S = std::clamp(p.stages, 1, kStages);
        StagePosition pos;
        if (p.mode == StageRandom || p.mode == StageBrownian) return locateWalk(p, S, L);
        if (orderDirty_ || S != orderStages_ || p.mode != orderMode_) buildOrder(S, p.mode);
        const int64_t m = mod(L, cycle_);
        int idx = 0;
        while (idx + 1 < orderLen_ && sums_[(size_t)idx + 1] <= m) ++idx;
        pos.stage = order_[(size_t)idx];
        pos.pulse = (int)(m - sums_[(size_t)idx]);
        pos.pulses = pulsesOf(pos.stage);
        pos.visit = floorDiv(L, cycle_) * orderLen_ + idx;
        pos.cycleStart = m == 0;
        pos.next = order_[(size_t)((idx + 1) % orderLen_)];
        return pos;
    }
    /// Pulses in one cycle of a fixed order (0 for walks).
    int64_t cycleLength(const StageParams& p) noexcept {
        if (p.mode == StageRandom || p.mode == StageBrownian) return 0;
        const int S = std::clamp(p.stages, 1, kStages);
        if (orderDirty_ || S != orderStages_ || p.mode != orderMode_) buildOrder(S, p.mode);
        return cycle_;
    }

    /// One sample. `emit(on, note, pitch, velocity)` receives note events.
    template <class Emit>
    void tick(const StageParams& p, const StageInputs& in, const StageTime& t, StageOutputs& out, Emit&& emit) noexcept {
        out.trigger = out.stageStart = out.end = 0.0f;
        dip_ = false;
        voice_.beginSample();
        const int S = std::clamp(p.stages, 1, kStages);
        if (configured_ && (S != stages_ || p.mode != mode_ || p.phrase != phrase_ || in.clockPatched != clocked_)) {
            stop(emit);
            havePos_ = false;
            played_ = false;
            replaying_ = false;
            walk_.valid = false;
        }
        configured_ = true;
        stages_ = S, mode_ = p.mode, phrase_ = p.phrase, clocked_ = in.clockPatched;
        if (stopRequested_) stop(emit);
        holdHigh_ = in.hold >= 0.5f;

        dsp::SeqClockInput ci;
        ci.clocked = in.clockPatched;
        ci.clock = in.clock;
        ci.reset = in.reset;
        ci.running = t.running;
        ci.started = t.started;
        ci.ppq = t.ppq;
        ci.bpm = t.bpm;
        ci.stepBeats = dsp::sequencerRateBeats(p.rate);
        ci.swing = p.swing;
        clock_.tick(ci, [&](const dsp::SeqClockEvent& e) {
            if (e.type == dsp::SeqClockEvent::Release) {
                stop(emit);
                havePos_ = replaying_ = false;
                if (e.reason == dsp::SeqClockEvent::Reset) frozen_ = 0;
            } else {
                if (in.clockPatched && e.n == 0) frozen_ = 0;
                pulse(p, e.n, e.durationSamples, in.transpose, emit, out);
            }
        });

        // Ratchet sub-pulses inside the current pulse.
        if (subLeft_ > 0 && ++subSince_ >= (int64_t)std::llround(subLen_ * (double)subIndex_)) {
            --subLeft_;
            ++subIndex_;
            note(p, subGate_, subLeft_ == 0 && subLastOfStage_, in.transpose, emit, out);
        }

        voice_.endSample(emit);
        // Pitch glides into slide stages: 99 % after Slide Time.
        if (gliding_ && p.slideTime > 0.0f) {
            const double a = std::exp(-4.605170186 / (std::max(p.slideTime, 0.001f) * sampleRate_));
            pitch_ = target_ + (float)a * (pitch_ - target_);
        } else {
            pitch_ = target_;
        }
        out.pitch = pitch_;
        out.velocity = voice_.velocity();
        out.gate = voice_.gate() && !dip_ ? 1.0f : 0.0f;
        out.accent = out.gate > 0.5f && accentOn_ ? 1.0f : 0.0f;
        out.stage = S > 1 ? (float)cur_.stage / (float)(S - 1) : 0.0f;
    }

private:
    int pulsesOf(int stage) const noexcept {
        return std::clamp((int)pattern_[(size_t)stage].pulses, 1, kStageMaxPulses);
    }

    void buildOrder(int S, int mode) noexcept {
        orderLen_ = 0;
        if (mode == StageReverse) {
            for (int i = S - 1; i >= 0; --i) order_[(size_t)orderLen_++] = i;
        } else {
            for (int i = 0; i < S; ++i) order_[(size_t)orderLen_++] = i;
            if (mode == StagePendulum)
                for (int i = S - 2; i >= 1; --i) order_[(size_t)orderLen_++] = i;
        }
        cycle_ = 0;
        for (int i = 0; i < orderLen_; ++i) {
            sums_[(size_t)i] = cycle_;
            cycle_ += pulsesOf(order_[(size_t)i]);
        }
        orderStages_ = S;
        orderMode_ = mode;
        orderDirty_ = false;
    }

    // ---- Random / Brownian walks, restarted every phrase ----------------------
    uint64_t phraseSeed(uint32_t seed, int64_t phrase) const noexcept { return dsp::hash3(seed, (uint64_t)phrase, 99); }
    int firstStage(const StageParams& p, int S, int64_t phrase) const noexcept {
        if (p.mode == StageBrownian || S <= 1) return 0;
        return std::min((int)(dsp::uniform01(phraseSeed(p.seed, phrase), 0, 0) * S), S - 1);
    }
    int nextStage(const StageParams& p, int S, int64_t phrase, int64_t visit, int cur) const noexcept {
        if (S <= 1) return 0;
        const uint64_t seed = phraseSeed(p.seed, phrase);
        if (p.mode == StageRandom) {
            const double u = dsp::uniform01(seed, (uint64_t)visit, 0);
            const int r = std::min((int)(u * (S - 1)), S - 2);
            return r >= cur ? r + 1 : r;
        }
        const double u = dsp::uniform01(seed, (uint64_t)visit, 1);
        const int step = u < 0.5 ? 1 : u < 0.75 ? -1 : 0;
        return (int)mod(cur + step, S);
    }
    /// The first pulse of phrase `ph` (pulses of `beats`, phrases of `phraseBeats`).
    static int64_t phraseStart(int64_t ph, double beats, double phraseBeats) noexcept {
        return (int64_t)std::ceil((double)ph * phraseBeats / beats - 1e-6);
    }

    StagePosition locateWalk(const StageParams& p, int S, int64_t L) noexcept {
        const double beats = dsp::sequencerRateBeats(p.rate);
        const double phraseBeats = 4.0 * kStagePhraseBars[std::clamp(p.phrase, 0, 4)];
        const int64_t ph = (int64_t)std::floor(((double)L * beats + 1e-6) / phraseBeats);
        const int64_t start = phraseStart(ph, beats, phraseBeats);
        const int64_t len = std::max<int64_t>(1, phraseStart(ph + 1, beats, phraseBeats) - start);
        const int64_t k = L - start;
        if (!walk_.valid || walk_.phrase != ph || k < walk_.start || walk_.S != S || walk_.mode != p.mode ||
            walk_.seed != p.seed) {
            walk_ = {};
            walk_.valid = true;
            walk_.phrase = ph;
            walk_.S = S, walk_.mode = p.mode, walk_.seed = p.seed;
            walk_.stage = firstStage(p, S, ph);
        }
        // Replays the walk from where it is (at most one phrase of visits).
        while (k >= walk_.start + pulsesOf(walk_.stage) && walk_.start + pulsesOf(walk_.stage) < len) {
            walk_.start += pulsesOf(walk_.stage);
            ++walk_.visit;
            walk_.stage = nextStage(p, S, ph, walk_.visit, walk_.stage);
        }
        StagePosition pos;
        pos.stage = walk_.stage;
        pos.pulse = (int)(k - walk_.start);
        pos.pulses = (int)std::min<int64_t>(pulsesOf(walk_.stage), len - walk_.start);
        pos.visit = ph * 4096 + walk_.visit;
        pos.cycleStart = k == 0;
        pos.next = walk_.start + pulsesOf(walk_.stage) < len ? nextStage(p, S, ph, walk_.visit + 1, walk_.stage) : -1;
        return pos;
    }

    // ---- pulses and notes -------------------------------------------------------
    template <class Emit>
    void pulse(const StageParams& p, int64_t n, double duration, float transpose, Emit& emit, StageOutputs& out) noexcept {
        subLeft_ = 0;
        const int64_t L = n - (clocked_ ? frozen_ : 0);
        StagePosition pos = locate(p, L);
        const bool newVisit = !havePos_ || pos.visit != cur_.visit;
        if (holdHigh_ && havePos_ && newVisit && !replaying_) {
            replaying_ = true;
            replayPulse_ = -1;
        }
        bool entry;
        if (replaying_ && holdHigh_) {
            // Hold: the stage starts again instead of moving on.
            replayPulse_ = (replayPulse_ + 1) % std::max(1, cur_.pulses);
            if (clocked_) ++frozen_;  // Clock mode continues where it left off
            entry = replayPulse_ == 0;
            curPulse_ = replayPulse_;
            if (entry) {
                cur_.next = cur_.stage;
                if (played_) out.stageStart = 1.0f;
            }
            playPulse(p, entry, curPulse_, cur_, duration, transpose, emit, out);
            return;
        }
        replaying_ = false;
        entry = newVisit;
        if (entry) {
            cur_ = pos;
            out.stageStart = 1.0f;
            if (played_ && pos.cycleStart) out.end = 1.0f;
            for (int i = std::min(trailLen_, 7); i > 0; --i) trail_[(size_t)i] = trail_[(size_t)i - 1];
            trail_[0] = (uint8_t)pos.stage;
            trailLen_ = std::min(trailLen_ + 1, 8);
        } else {
            cur_.pulses = pos.pulses;
            cur_.next = pos.next;
        }
        if (holdHigh_) cur_.next = cur_.stage;
        havePos_ = true;
        played_ = true;
        curPulse_ = pos.pulse;
        playPulse(p, entry, pos.pulse, cur_, duration, transpose, emit, out);
    }

    template <class Emit>
    void playPulse(const StageParams& p, bool entry, int k, const StagePosition& pos, double duration, float transpose,
                   Emit& emit, StageOutputs& out) noexcept {
        const Stage& st = pattern_[(size_t)pos.stage];
        const bool slideIn = st.slide && st.gate != StageRest;
        const bool nextSlides = pos.next >= 0 && pattern_[(size_t)pos.next].slide &&
                                pattern_[(size_t)pos.next].gate != StageRest;
        const bool lastPulse = k >= pos.pulses - 1;
        if (entry) {
            // A held or extended note ends at the stage boundary unless this stage slides.
            if (voice_.tied() && !slideIn) {
                voice_.release(emit);
                dip_ = true;
            }
            gliding_ = slideIn;
        }
        GateSpec g;
        g.slideIn = entry && slideIn;
        switch (st.gate) {
            case StageRest:
                if (entry) voice_.rest(emit);
                return;
            case StageFirst:
                if (!entry) return;
                g.tie = nextSlides;
                g.length = dsp::gateSamples(duration, p.gateLength);
                note(p, g, g.tie, transpose, emit, out);
                return;
            case StageEvery:
                g.length = dsp::gateSamples(duration, p.gateLength);
                note(p, g, lastPulse && nextSlides, transpose, emit, out);
                return;
            case StageHold:
                if (!entry) return;
                g.length = dsp::gateSamples(duration * pos.pulses, 1.0f);
                note(p, g, true, transpose, emit, out);
                return;
            case StageRatchet: {
                const int r = std::clamp((int)st.ratchet, 2, 4);
                subLen_ = duration / r;
                g.length = dsp::gateSamples(subLen_, p.gateLength);
                note(p, g, false, transpose, emit, out);
                subGate_ = g;
                subGate_.slideIn = false;
                subLeft_ = r - 1;
                subIndex_ = 1;
                subSince_ = 0;
                subLastOfStage_ = lastPulse && nextSlides;
                return;
            }
            default: return;
        }
    }

    struct GateSpec {
        int64_t length = 1;
        bool tie = false;
        bool slideIn = false;
    };

    template <class Emit>
    void note(const StageParams& p, const GateSpec& g, bool tie, float transpose, Emit& emit, StageOutputs& out) noexcept {
        const Stage& st = pattern_[(size_t)cur_.stage];
        const auto& sc = dsp::scales()[(size_t)std::clamp(p.scale, 0, (int)dsp::scales().size() - 1)];
        const float rel = (float)(p.octave * 12 + st.pitch) + transpose * 12.0f;
        const int q = std::clamp(p.root + dsp::quantize(rel, sc.mask), -60, 67);
        float v = (float)st.velocity;
        if (st.accent) v += std::clamp(p.accent, 0.0f, 1.0f) * (127.0f - v);
        const float vel = std::clamp(v / 127.0f, 1.0f / 127.0f, 1.0f);
        // Only a slide keeps a tied note going into a new pitch (legato).
        if (voice_.tied() && !g.slideIn) {
            voice_.release(emit);
            dip_ = true;
        }
        const auto how = voice_.play(60 + q, (float)q / 12.0f, vel, tie || g.tie, g.length, emit);
        if (how == dsp::SeqVoice::Fresh) out.trigger = 1.0f;
        target_ = (float)q / 12.0f;
        if (!gliding_) pitch_ = target_;
        accentOn_ = st.accent;
    }

    template <class Emit>
    void stop(Emit& emit) noexcept {
        stopRequested_ = false;
        subLeft_ = 0;
        voice_.release(emit);
    }

    double sampleRate_ = 48000.0;
    StagePattern pattern_{};
    dsp::SeqClock clock_;
    dsp::SeqVoice voice_;
    bool configured_ = false, clocked_ = false, stopRequested_ = false, dip_ = false;
    int stages_ = 8, mode_ = StageForward, phrase_ = 2;
    bool havePos_ = false, played_ = false, holdHigh_ = false;
    bool replaying_ = false;
    int replayPulse_ = 0;
    int64_t frozen_ = 0;
    StagePosition cur_{};
    int curPulse_ = 0;
    // fixed orders
    std::array<int, 2 * kStages> order_{};
    std::array<int64_t, 2 * kStages> sums_{};
    int orderLen_ = 1, orderStages_ = -1, orderMode_ = -1;
    int64_t cycle_ = 1;
    bool orderDirty_ = true;
    // walks
    struct Walk {
        bool valid = false;
        int64_t phrase = 0, visit = 0, start = 0;
        int stage = 0, S = 0, mode = 0;
        uint32_t seed = 0;
    } walk_;
    // ratchets
    int subLeft_ = 0, subIndex_ = 1;
    int64_t subSince_ = 0;
    double subLen_ = 0.0;
    GateSpec subGate_{};
    bool subLastOfStage_ = false;
    // outputs
    float pitch_ = 0.0f, target_ = 0.0f;
    bool gliding_ = false, accentOn_ = false;
    std::array<uint8_t, 8> trail_{};
    int trailLen_ = 0;
};

}  // namespace bleep::patch
