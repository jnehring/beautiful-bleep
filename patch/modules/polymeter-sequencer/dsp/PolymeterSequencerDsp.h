// SPDX-License-Identifier: MIT
// Polymeter Seq core (specs/modules/polymeter-sequencer.md): a step split into
// six tracks (Trigger, Note, Octave, Gate, Probability, Ratchet), each with
// its own length, loop window, clock division and direction, in up to 8
// pattern slots. Every track position is a pure function of the base tick
// count (from dsp::SeqClock), so the sequencer never loses the song's grid.
// Hits (and their ratchets) are scheduled inside the tick; notes go through
// dsp::SeqVoice and leave through a callback.
#pragma once

#include "dsp/Random.h"
#include "dsp/Scales.h"
#include "dsp/SeqClock.h"
#include "dsp/SeqNotes.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <numeric>

namespace bleep::patch {

enum PolyTrackId { PolyTrig = 0, PolyNote, PolyOct, PolyGate, PolyProb, PolyRatch, kPolyTracks };
enum PolyDirection : uint8_t { PolyForward = 0, PolyBackward, PolyPingPong, PolyRandom };
enum PolyRatchetShape : uint8_t { PolyEven = 0, PolyAccelerate, PolyDecelerate };
enum PolyChange { PolyImmediate = 0, PolyTrackEnd, PolyFullCycle, PolyNextBar };

constexpr int kPolySteps = 64, kPolySlots = 8, kPolyDivisions = 12;
constexpr int kPolyTie = -1;           ///< Gate track: Tie
constexpr int kPolyMinDegree = -14, kPolyMaxDegree = 21;

/// Division choices: ×4, ×3, ×2, 1, /2 … /8, /16 of the base tick.
inline const std::array<const char*, kPolyDivisions>& polyDivisionNames() {
    static const std::array<const char*, kPolyDivisions> n{"x4", "x3", "x2", "1", "/2", "/3", "/4", "/5", "/6", "/7", "/8", "/16"};
    return n;
}
inline int polyMultiplier(int div) noexcept { return div == 0 ? 4 : div == 1 ? 3 : div == 2 ? 2 : 1; }
inline int polyDivider(int div) noexcept {
    static constexpr int d[kPolyDivisions] = {1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 16};
    return d[std::clamp(div, 0, kPolyDivisions - 1)];
}

struct PolyTrack {
    uint8_t length = 16;          ///< 1..64
    uint8_t lo = 0, hi = 15;      ///< loop window, lo ≤ hi < length
    uint8_t division = 3;         ///< polyDivisionNames() index
    uint8_t direction = PolyForward;
    bool mute = false;
    std::array<int8_t, kPolySteps> steps{};  ///< the track's values (Ratchet: counts)
    std::array<uint8_t, kPolySteps> shape{}; ///< Ratchet track: shapes
    bool operator==(const PolyTrack& o) const noexcept {
        return length == o.length && lo == o.lo && hi == o.hi && division == o.division && direction == o.direction &&
               mute == o.mute && steps == o.steps && shape == o.shape;
    }
};
using PolySlot = std::array<PolyTrack, kPolyTracks>;
using PolyPattern = std::array<PolySlot, kPolySlots>;

/// A track's neutral value (also what a muted track contributes).
inline int polyNeutral(int track) noexcept {
    switch (track) {
        case PolyTrig: return 1;
        case PolyGate: return 50;
        case PolyProb: return 100;
        case PolyRatch: return 1;
        default: return 0;
    }
}

/// Scale degree → semitones above the root (degrees wrap into octaves, also
/// below 0). Chromatic: a degree is a semitone.
inline int degreeToSemitones(int degree, uint16_t mask) noexcept {
    if ((mask & 0xfff) == 0) mask = 0xfff;
    int intervals[12], n = 0;
    for (int k = 0; k < 12; ++k)
        if ((mask >> k) & 1u) intervals[n++] = k;
    const int oct = degree >= 0 ? degree / n : -((-degree + n - 1) / n);
    return intervals[degree - oct * n] + 12 * oct;
}

/// The pattern of a new module (every slot): an 8th-note line with accents
/// on the beats over a 7-step rising Note track and a 5-step Octave track,
/// so the line takes 560 steps to repeat.
inline PolySlot polyDefaultSlot() {
    PolySlot s{};
    const int lengths[kPolyTracks] = {16, 7, 5, 16, 16, 16};
    for (int k = 0; k < kPolyTracks; ++k) {
        s[(size_t)k].length = (uint8_t)lengths[k];
        s[(size_t)k].hi = (uint8_t)(lengths[k] - 1);
        s[(size_t)k].steps.fill((int8_t)polyNeutral(k));
    }
    const int trig[16] = {2, 0, 1, 0, 2, 0, 1, 1, 2, 0, 1, 0, 2, 1, 0, 1};
    const int note[7] = {0, 1, 2, 4, 2, 3, 5};
    const int oct[5] = {0, 0, 1, 0, -1};
    const int gate[16] = {50, 40, 30, 80, 50, 30, 50, kPolyTie, 50, 40, 30, 80, 50, 30, 60, 30};
    const int prob[16] = {100, 100, 100, 70, 100, 100, 80, 100, 100, 100, 100, 60, 100, 90, 100, 70};
    for (int i = 0; i < 16; ++i) {
        s[PolyTrig].steps[(size_t)i] = (int8_t)trig[i];
        s[PolyGate].steps[(size_t)i] = (int8_t)gate[i];
        s[PolyProb].steps[(size_t)i] = (int8_t)prob[i];
    }
    for (int i = 0; i < 7; ++i) s[PolyNote].steps[(size_t)i] = (int8_t)note[i];
    for (int i = 0; i < 5; ++i) s[PolyOct].steps[(size_t)i] = (int8_t)oct[i];
    s[PolyRatch].steps[15] = 2;
    return s;
}

struct PolyParams {
    int rate = 9, root = 0, scale = 12, octave = 0;
    int slotsUsed = 1, change = PolyNextBar;
    uint32_t seed = 1;
    float gateScale = 1.0f, probBias = 0.0f, ratchetAmount = 1.0f, swing = 0.5f, velocity = 0.8f, spread = 0.0f;
};

struct PolyTime {
    bool running = false, started = false;
    double bpm = 120.0, ppq = 0.0;
};

struct PolyInputs {
    float clock = 0.0f, reset = 0.0f, transpose = 0.0f, pattern = 0.0f, hold = 0.0f;
    bool clockPatched = false, patternPatched = false;
    int dataSlot = 0;  ///< the slot chosen in the view (Pattern unpatched)
};

struct PolyOutputs {
    float pitch = 0.0f, gate = 0.0f, velocity = 0.0f, trigger = 0.0f, bar = 0.0f, trackEnds = 0.0f;
};

class PolymeterSequencerDsp {
public:
    static int64_t mod(int64_t a, int64_t m) noexcept { return ((a % m) + m) % m; }
    static int64_t floorDiv(int64_t a, int64_t b) noexcept { return a >= 0 ? a / b : -((-a + b - 1) / b); }

    /// Track ticks until a track is back at its loop start.
    static int64_t period(const PolyTrack& t) noexcept {
        const int L = loopLength(t);
        return t.direction == PolyPingPong && L > 1 ? 2 * L - 2 : L;
    }
    static int loopLength(const PolyTrack& t) noexcept {
        const int len = std::clamp((int)t.length, 1, kPolySteps);
        const int lo = std::clamp((int)t.lo, 0, len - 1), hi = std::clamp((int)t.hi, lo, len - 1);
        return hi - lo + 1;
    }
    /// The step of a track at its tick count `tt`.
    static int position(const PolyTrack& t, int64_t tt, uint32_t seed, int track) noexcept {
        const int len = std::clamp((int)t.length, 1, kPolySteps);
        const int lo = std::clamp((int)t.lo, 0, len - 1), hi = std::clamp((int)t.hi, lo, len - 1);
        const int L = hi - lo + 1;
        if (L <= 1) return lo;
        switch (t.direction) {
            case PolyBackward: return hi - (int)mod(tt, L);
            case PolyPingPong: {
                const int k = (int)mod(tt, 2 * L - 2);
                return k < L ? lo + k : lo + 2 * L - 2 - k;
            }
            case PolyRandom:
                return lo + std::min((int)(dsp::uniform01(seed, (uint64_t)tt, 100 + (uint64_t)track) * L), L - 1);
            default: return lo + (int)mod(tt, L);
        }
    }
    /// A track's tick count at base tick n, fraction f (0 ≤ f < 1) into it.
    static int64_t trackTick(const PolyTrack& t, int64_t n, double f) noexcept {
        const int m = polyMultiplier(t.division), d = polyDivider(t.division);
        if (m > 1) return n * m + (int64_t)std::floor(f * m + 1e-9);
        return floorDiv(n, d);
    }
    /// True when the track steps at (n, f).
    static bool advances(const PolyTrack& t, int64_t n, double f) noexcept {
        const int m = polyMultiplier(t.division), d = polyDivider(t.division);
        if (m > 1) return std::fabs(f * m - std::round(f * m)) < 1e-9;
        return f == 0.0 && mod(n, d) == 0;
    }
    /// Base ticks in the slot's full cycle (unmuted tracks), or −1 above 2³¹.
    static int64_t cycleTicks(const PolySlot& s) noexcept {
        int64_t c = 1;
        bool any = false;
        for (const auto& t : s) {
            if (t.mute) continue;
            any = true;
            const int64_t P = period(t), m = polyMultiplier(t.division), d = polyDivider(t.division);
            const int64_t ticks = m > 1 ? P / std::gcd(P, m) : P * d;
            c = std::lcm(c, ticks);
            if (c > ((int64_t)1 << 31)) return -1;
        }
        return any ? c : 1;
    }
    /// The ratchet hit k of r at this share of the hit (shape: Even, Accelerate, Decelerate).
    static double ratchetTime(int k, int r, int shape) noexcept {
        const double x = (double)k / (double)std::max(1, r);
        return shape == PolyAccelerate ? std::pow(x, 1.5) : shape == PolyDecelerate ? std::pow(x, 0.67) : x;
    }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        clock_.prepare(sampleRate);
    }

    void reset() noexcept {
        clock_.reset();
        voice_.reset();
        pending_ = 0;
        subCount_ = 0;
        noteLeft_ = 0;
        tie_ = dip_ = false;
        slot_ = target_ = 0;
        haveSlot_ = false;
        holdHigh_ = false;
        lastBar_ = INT64_MIN;
        positions_.fill(0);
        haveTick_ = false;
    }

    /// The pattern (all slots), or null for the default of an empty module.
    void setPattern(const PolyPattern* p) noexcept {
        if (p == pattern_) return;
        pattern_ = p;
        if (voice_.sounding()) releaseRequested_ = true;
    }

    int slot() const noexcept { return slot_; }
    int trackPosition(int t) const noexcept { return positions_[(size_t)t]; }
    bool sounding() const noexcept { return voice_.sounding(); }

    /// One sample. `emit(on, note, pitch, velocity)` receives note events.
    template <class Emit>
    void tick(const PolyParams& p, const PolyInputs& in, const PolyTime& t, PolyOutputs& out, Emit&& emit) noexcept {
        out.trigger = out.bar = out.trackEnds = 0.0f;
        dip_ = false;
        voice_.beginSample();
        if (configured_ && in.clockPatched != clocked_) release(emit);
        configured_ = true;
        clocked_ = in.clockPatched;
        if (releaseRequested_) {
            releaseRequested_ = false;
            release(emit);
        }
        // Hold: nothing advances; letting go ends the note.
        const bool hold = in.hold >= 0.5f;
        if (holdHigh_ && !hold) release(emit);
        holdHigh_ = hold;

        // The slot the Pattern input or the view asks for; switched per Pattern Change.
        const int used = std::clamp(p.slotsUsed, 1, kPolySlots);
        target_ = in.patternPatched ? std::clamp((int)std::floor(std::clamp(in.pattern, 0.0f, 1.0f) * (float)used), 0, used - 1)
                                    : std::clamp(in.dataSlot, 0, used - 1);
        if (!haveSlot_) slot_ = target_, haveSlot_ = true;
        if (p.change == PolyImmediate || (!t.running && !in.clockPatched)) switchSlot(emit);
        if (!in.clockPatched && t.running) {
            const int64_t bar = (int64_t)std::floor(t.ppq / 4.0 + 1e-9);
            if (lastBar_ != INT64_MIN && bar != lastBar_ && p.change == PolyNextBar) switchSlot(emit);
            lastBar_ = bar;
        } else {
            lastBar_ = INT64_MIN;
        }
        transpose_ = in.transpose;

        // Own gate timers end notes (the voice ties every note, so a new pitch
        // while one still sounds is legato).
        if (noteLeft_ > 0 && --noteLeft_ == 0 && !tie_) voice_.release(emit), endedNow_ = true;

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
                release(emit);
                haveTick_ = false;
            } else {
                baseTick(p, e.n, e.durationSamples, in.clockPatched, out, emit);
            }
        });
        // Sub-tick events (×n tracks) inside the current tick.
        if (subCount_ > 0) {
            ++subSince_;
            while (subNext_ < subCount_ && subSince_ >= subAt_[(size_t)subNext_]) {
                subEvent(p, tickN_, subF_[(size_t)subNext_], tickDuration_, out, emit);
                ++subNext_;
            }
        }
        // Scheduled hits (ratchets, Spread delays).
        for (int k = 0; k < pending_;) {
            if (--queue_[(size_t)k].wait <= 0) {
                playHit(queue_[(size_t)k], p, out, emit);
                queue_[(size_t)k] = queue_[(size_t)--pending_];
            } else {
                ++k;
            }
        }

        voice_.endSample(emit);
        endedNow_ = false;
        out.pitch = voice_.pitch();
        out.velocity = voice_.velocity();
        out.gate = voice_.gate() && !dip_ ? 1.0f : 0.0f;
    }

    /// Base ticks in the current slot's full cycle (−1: more than 2³¹).
    int64_t cycle() const noexcept { return pattern_ ? cycleTicks((*pattern_)[(size_t)slot_]) : 1; }

private:
    struct Pending {
        int64_t wait = 0;
        int degree = 0, octave = 0;
        float velocity = 0.8f;
        int64_t gate = 1;
        bool tie = false;
    };

    const PolySlot* current() const noexcept { return pattern_ ? &(*pattern_)[(size_t)slot_] : nullptr; }
    int value(const PolySlot& s, int track) const noexcept {
        const PolyTrack& t = s[(size_t)track];
        return t.mute ? polyNeutral(track) : (int)t.steps[(size_t)positions_[(size_t)track]];
    }

    template <class Emit>
    void switchSlot(Emit& emit) noexcept {
        if (slot_ == target_) return;
        slot_ = target_;
        release(emit);
    }

    template <class Emit>
    void baseTick(const PolyParams& p, int64_t n, double duration, bool clocked, PolyOutputs& out, Emit& emit) noexcept {
        if (clocked && n == 0) haveTick_ = false;
        tickN_ = n;
        tickDuration_ = duration;
        // Next bar in Clock mode: 16 ticks (4/4 at 1/16).
        if (clocked && target_ != slot_ && p.change == PolyNextBar && mod(n, 16) == 0) switchSlot(emit);
        // The fractions of this tick where a ×n track steps.
        subCount_ = 0;
        subNext_ = 0;
        subSince_ = 0;
        if (const PolySlot* s = current()) {
            bool m2 = false, m3 = false, m4 = false;
            for (const auto& tr : *s) {
                const int m = polyMultiplier(tr.division);
                m2 |= m == 2 || m == 4;
                m3 |= m == 3;
                m4 |= m == 4;
            }
            const double fr[5] = {0.25, 1.0 / 3.0, 0.5, 2.0 / 3.0, 0.75};
            const bool use[5] = {m4, m3, m2, m3, m4};
            for (int k = 0; k < 5; ++k)
                if (use[k]) {
                    subF_[(size_t)subCount_] = fr[k];
                    subAt_[(size_t)subCount_] = (int64_t)std::llround(fr[k] * duration);
                    ++subCount_;
                }
        }
        subEvent(p, n, 0.0, duration, out, emit);
    }

    /// Tracks stepping at (n, f): positions, Track Ends, Bar, and a hit when
    /// the Trigger track steps.
    template <class Emit>
    void subEvent(const PolyParams& p, int64_t n, double f, double tickDuration, PolyOutputs& out, Emit& emit) noexcept {
        const PolySlot* s = current();
        if (!s) return;
        bool wrapped = false;
        for (int k = 0; k < kPolyTracks; ++k) {
            const PolyTrack& tr = (*s)[(size_t)k];
            const int64_t tt = trackTick(tr, n, f);
            positions_[(size_t)k] = position(tr, tt, p.seed, k);
            if (advances(tr, n, f) && !tr.mute && haveTick_ && mod(tt, period(tr)) == 0) wrapped = true;
        }
        if (wrapped) out.trackEnds = 1.0f;
        if (f == 0.0) {
            bool all = true, any = false;
            for (const auto& tr : *s) {
                if (tr.mute) continue;
                any = true;
                const int64_t m = polyMultiplier(tr.division), d = polyDivider(tr.division);
                const int64_t ph = m > 1 ? mod(n * m, period(tr)) : mod(n, d * period(tr));
                all = all && ph == 0;
            }
            if (all && any) out.bar = 1.0f;
            if (all && any && target_ != slot_ && p.change == PolyFullCycle) switchSlot(emit);
        }
        if (wrapped && target_ != slot_ && p.change == PolyTrackEnd) switchSlot(emit);
        haveTick_ = true;
        s = current();
        const PolyTrack& trig = (*s)[PolyTrig];
        if (!advances(trig, n, f) || holdHigh_) return;

        // A hit: the Trigger track stepped. The other tracks give its values.
        const int64_t hitIndex = trackTick(trig, n, f);
        const int trigValue = value(*s, PolyTrig);
        const double prob = std::clamp((double)value(*s, PolyProb) / 100.0 + (double)p.probBias, 0.0, 1.0);
        const bool plays = trigValue > 0 && dsp::uniform01(p.seed, (uint64_t)hitIndex, 5) < prob;
        if (!plays) {
            // A rest: a tied note ends here.
            if (tie_ && voice_.sounding()) voice_.release(emit), endedNow_ = true;
            tie_ = false;
            return;
        }
        const int m = polyMultiplier(trig.division), d = polyDivider(trig.division);
        const double hitSamples = m > 1 ? tickDuration / m : tickDuration * d;
        const int gateValue = value(*s, PolyGate);
        int r = std::clamp((int)value(*s, PolyRatch), 1, 8);
        const int shape = (*s)[PolyRatch].mute ? PolyEven : (int)(*s)[PolyRatch].shape[(size_t)positions_[PolyRatch]];
        r = 1 + (int)std::lround((r - 1) * std::clamp((double)p.ratchetAmount, 0.0, 1.0));
        float vel = std::clamp(p.velocity, 0.0f, 1.0f) + (trigValue >= 2 ? 0.2f : 0.0f);
        if (p.spread > 0.0f)
            vel *= 1.0f + 0.25f * std::clamp(p.spread, 0.0f, 1.0f) * (float)(2.0 * dsp::uniform01(p.seed, (uint64_t)hitIndex, 6) - 1.0);
        const int64_t delay = p.spread > 0.0f
                                  ? (int64_t)std::llround(dsp::uniform01(p.seed, (uint64_t)hitIndex, 7) * 0.05 *
                                                          std::clamp((double)p.spread, 0.0, 1.0) * tickDuration)
                                  : 0;
        for (int k = 0; k < r; ++k) {
            const double t0 = ratchetTime(k, r, shape), t1 = ratchetTime(k + 1, r, shape);
            const double sub = (t1 - t0) * hitSamples;
            Pending h;
            h.wait = delay + (int64_t)std::llround(t0 * hitSamples);
            h.degree = value(*s, PolyNote);
            h.octave = value(*s, PolyOct);
            h.velocity = std::clamp(vel * (1.0f - 0.08f * (float)k), 0.01f, 1.0f);
            h.tie = gateValue == kPolyTie && k == r - 1;
            const double share = gateValue == kPolyTie ? 1.0 : std::clamp(gateValue, 5, 100) / 100.0 * std::clamp((double)p.gateScale, 0.1, 2.0);
            h.gate = std::max<int64_t>(1, (int64_t)std::llround(share * sub));
            if (h.wait <= 0) playHit(h, p, out, emit);
            else if (pending_ < (int)queue_.size()) queue_[(size_t)pending_++] = h;
        }
    }

    template <class Emit>
    void playHit(const Pending& h, const PolyParams& p, PolyOutputs& out, Emit& emit) noexcept {
        const float transpose = transpose_;
        const auto& sc = dsp::scales()[(size_t)std::clamp(p.scale, 0, (int)dsp::scales().size() - 1)];
        const float rel = (float)degreeToSemitones(std::clamp(h.degree, kPolyMinDegree, kPolyMaxDegree), sc.mask) +
                          (float)(p.octave + std::clamp(h.octave, -3, 3)) * 12.0f + transpose * 12.0f;
        const int q = std::clamp(p.root + dsp::quantize(rel, sc.mask), -60, 67);
        // The same note still sounding is ended first; a different one glides (legato).
        if (voice_.sounding() && voice_.note() == 60 + q) {
            voice_.release(emit);
            endedNow_ = true;
        }
        if (endedNow_) dip_ = true;
        const auto how = voice_.play(60 + q, (float)q / 12.0f, h.velocity, true, h.gate, emit);
        (void)how;
        out.trigger = 1.0f;
        noteLeft_ = h.gate;
        tie_ = h.tie;
    }

    template <class Emit>
    void release(Emit& emit) noexcept {
        voice_.release(emit);
        pending_ = 0;
        noteLeft_ = 0;
        tie_ = false;
    }

    double sampleRate_ = 48000.0;
    const PolyPattern* pattern_ = nullptr;
    dsp::SeqClock clock_;
    dsp::SeqVoice voice_;
    bool configured_ = false, clocked_ = false, releaseRequested_ = false;
    bool holdHigh_ = false, tie_ = false, dip_ = false, endedNow_ = false, haveTick_ = false;
    int slot_ = 0, target_ = 0;
    bool haveSlot_ = false;
    int64_t lastBar_ = INT64_MIN;
    std::array<int, kPolyTracks> positions_{};
    // the current base tick and its sub-ticks
    int64_t tickN_ = 0;
    double tickDuration_ = 6000.0;
    std::array<double, 5> subF_{};
    std::array<int64_t, 5> subAt_{};
    int subCount_ = 0, subNext_ = 0;
    int64_t subSince_ = 0;
    // scheduled hits
    std::array<Pending, 32> queue_{};
    int pending_ = 0;
    int64_t noteLeft_ = 0;
    float transpose_ = 0.0f;
};

}  // namespace bleep::patch
