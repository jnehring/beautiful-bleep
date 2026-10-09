// SPDX-License-Identifier: MIT
// Gate Sequencer core (doc/specs/modules/gate-sequencer.md): four tracks of up to
// 32 steps with probability, gate length or tie, ratchets, micro-timing
// (nudge) and conditions; each track has its own length and rate.
//
// Every decision is a pure function of (seed, track, step count): whether a
// step plays, its hits' times and lengths. So the module schedules hits by
// looking ahead on each track's grid — negative nudges land early, exactly —
// and a loop jump replays the same decisions. Position comes from the song
// (Transport) or from a virtual position that Clock pulses (1/16 ticks)
// drive, interpolated with the measured tick length. Notes go through
// dsp::SeqNoteSet; they leave through a callback.
#pragma once

#include "dsp/Random.h"
#include "dsp/SeqClock.h"
#include "dsp/SeqNotes.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <numeric>

namespace bleep::patch {

constexpr int kGateTracks = 4, kGateSteps = 32;

enum GateCondition : uint8_t {
    GateAlways = 0, GateAB, GateFirst, GateNotFirst, GateFill, GateNotFill, GatePrev, GateNotPrev
};
enum GateRatchetShape : uint8_t { GateEven = 0, GateFaster, GateSlower };
enum GateDice { DiceNew = 0, DiceRepeat2, DiceRepeat4, DiceRepeat8, DiceFixed };

struct GateStep {
    bool on = false;
    uint8_t prob = 100;      ///< 0..100 %
    uint8_t length = 50;     ///< 1..100 % of the step (of a ratchet slot)
    bool tie = false;
    uint8_t ratchet = 1;     ///< 1..8 hits
    uint8_t shape = GateEven;
    int8_t nudge = 0;        ///< −50..50 % of a step
    uint8_t cond = GateAlways;
    uint8_t condA = 1, condB = 2;  ///< A:B, 1 ≤ A ≤ B, 2 ≤ B ≤ 8
    uint8_t velocity = 100;  ///< 1..127
    bool operator==(const GateStep& o) const noexcept {
        return on == o.on && prob == o.prob && length == o.length && tie == o.tie && ratchet == o.ratchet &&
               shape == o.shape && nudge == o.nudge && cond == o.cond && condA == o.condA && condB == o.condB &&
               velocity == o.velocity;
    }
};
struct GateTrack {
    bool mute = false;
    std::array<GateStep, kGateSteps> steps{};
};
using GatePattern = std::array<GateTrack, kGateTracks>;

struct GateParams {
    std::array<int, kGateTracks> length{16, 16, 16, 16};
    std::array<int, kGateTracks> rate{9, 9, 9, 9};   ///< sequencer rate index (Tempo.h)
    std::array<int, kGateTracks> note{36, 38, 42, 46};
    std::array<float, kGateTracks> chance{1.0f, 1.0f, 1.0f, 1.0f};  ///< 0..2
    int dice = DiceNew;
    uint32_t seed = 1;
    float nudgeDepth = 1.0f, ratchetDecay = 0.0f, swing = 0.5f;
};

struct GateTime {
    bool running = false, started = false;
    double bpm = 120.0, ppq = 0.0;
};

struct GateInputs {
    float clock = 0.0f, reset = 0.0f, fill = 0.0f;
    std::array<float, kGateTracks> mute{};
    bool clockPatched = false;
};

struct GateOutputs {
    std::array<float, kGateTracks> gate{}, trig{}, vel{};
    float cycle = 0.0f;
};

class GateSequencerDsp {
public:
    static int64_t mod(int64_t a, int64_t m) noexcept { return ((a % m) + m) % m; }
    static int64_t floorDiv(int64_t a, int64_t b) noexcept { return a >= 0 ? a / b : -((-a + b - 1) / b); }
    /// A rate in 1/48-beat units (every sequencer rate is a whole number of them).
    static int64_t rateUnits(int rate) noexcept { return (int64_t)std::llround(dsp::sequencerRateBeats(rate) * 48.0); }

    /// Offset (share of a step) and slot length of hit j of r, for a ratchet shape.
    static void ratchetSlot(int r, int shape, int j, double& offset, double& slot) noexcept {
        if (r <= 1 || shape == GateEven) {
            offset = (double)j / std::max(1, r);
            slot = 1.0 / std::max(1, r);
            return;
        }
        const double q = shape == GateFaster ? 0.75 : 1.0 / 0.75;
        double sum = 0.0, before = 0.0, g = 1.0;
        for (int k = 0; k < r; ++k, g *= q) {
            if (k < j) before += g;
            if (k == j) slot = g;
            sum += g;
        }
        offset = before / sum;
        slot /= sum;
    }

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    void reset() noexcept {
        notes_.reset();
        clockEdge_.reset();
        resetEdge_.reset();
        for (auto& tr : tracks_) tr = TrackState{};
        haveClock_ = pendingReset_ = false;
        ticks_ = 0;
        sinceClock_ = 0;
        period_ = (int64_t)(sampleRate_ * 0.125);
        active_ = false;
        startB_ = 0.0;
        origin_ = 0.0;
        cycleIndex_ = 0;
        haveCycle_ = haveB_ = false;
        masksDirty_ = true;
    }

    /// A new pattern. An edit to the step a sounding hit came from ends it.
    void setPattern(const GatePattern& p) noexcept {
        for (int t = 0; t < kGateTracks; ++t) {
            TrackState& s = tracks_[(size_t)t];
            if (s.lastStep >= 0 && !(p[(size_t)t].steps[(size_t)s.lastStep] == pattern_[(size_t)t].steps[(size_t)s.lastStep]))
                s.endRequested = true;
            s.dirty = true;
            s.decided = INT64_MIN;
        }
        pattern_ = p;
        masksDirty_ = true;
    }
    const GatePattern& pattern() const noexcept { return pattern_; }

    /// The position of track t (0..Length−1).
    int position(int t) const noexcept { return tracks_[(size_t)t].pos; }
    /// Bits of the steps that will play on track t's current pass.
    uint32_t upcoming(int t) const noexcept { return tracks_[(size_t)t].upcoming; }
    /// Bit t: track t's gate is high.
    uint32_t hits() const noexcept {
        uint32_t m = 0;
        for (int t = 0; t < kGateTracks; ++t)
            if (tracks_[(size_t)t].gateLeft > 0) m |= 1u << t;
        return m;
    }

    /// Whether step count `m` of track t plays (condition and probability;
    /// not Mute). A pure function of the pattern, the knobs, Fill and the
    /// loop the transport started in. Public for tests and the view.
    bool plays(const GateParams& p, int t, int64_t m, bool fill, int depth = 0) const noexcept {
        if (m < 0) return false;
        const int L = std::clamp(p.length[(size_t)t], 1, kGateSteps);
        const int i = (int)mod(m, L);
        const int64_t k = floorDiv(m, L);
        const GateStep& st = pattern_[(size_t)t].steps[(size_t)i];
        if (!st.on) return false;
        switch (st.cond) {
            case GateAB: {
                const int B = std::clamp((int)st.condB, 2, 8), A = std::clamp((int)st.condA, 1, B);
                if (mod(k, B) != A - 1) return false;
                break;
            }
            case GateFirst: if (k != firstLoop(p, t)) return false; break;
            case GateNotFirst: if (k == firstLoop(p, t)) return false; break;
            case GateFill: if (!fill) return false; break;
            case GateNotFill: if (fill) return false; break;
            case GatePrev:
            case GateNotPrev: {
                bool prev = false;
                for (int64_t q = m - 1; q >= m - L && q >= 0; --q) {
                    const GateStep& s = pattern_[(size_t)t].steps[(size_t)mod(q, L)];
                    if (s.on && (s.prob < 100 || s.cond != GateAlways)) {
                        prev = depth < 32 && plays(p, t, q, fill, depth + 1);
                        break;
                    }
                }
                if (prev != (st.cond == GatePrev)) return false;
                break;
            }
            default: break;
        }
        if (st.prob >= 100) return true;
        const double pr = std::clamp((double)st.prob / 100.0 * (double)p.chance[(size_t)t], 0.0, 1.0);
        int64_t d = k;
        switch (p.dice) {
            case DiceRepeat2: d = mod(k, 2); break;
            case DiceRepeat4: d = mod(k, 4); break;
            case DiceRepeat8: d = mod(k, 8); break;
            case DiceFixed: d = 0; break;
            default: break;
        }
        return dsp::uniform01(p.seed, (uint64_t)(d * kGateSteps + i), (uint64_t)t) < pr;
    }

    /// One sample. `emit(on, note, pitch, velocity)` receives note events.
    template <class Emit>
    void tick(const GateParams& p, const GateInputs& in, const GateTime& t, GateOutputs& out, Emit&& emit) noexcept {
        out.cycle = 0.0f;
        for (int k = 0; k < kGateTracks; ++k) out.trig[(size_t)k] = 0.0f;
        const bool fill = in.fill >= 0.5f;
        const bool resetEdge = resetEdge_.process(in.reset) > 0;

        // ---- gates and notes running out; edits, mutes and setting changes -----
        for (int k = 0; k < kGateTracks; ++k) {
            TrackState& s = tracks_[(size_t)k];
            const bool muted = in.mute[(size_t)k] >= 0.5f || pattern_[(size_t)k].mute;
            if (s.endRequested || (muted && !s.muted) || p.note[(size_t)k] != s.noteNumber ||
                p.length[(size_t)k] != s.length || p.rate[(size_t)k] != s.rate) {
                endTrack(k, emit);
                s.endRequested = false;
                if (p.rate[(size_t)k] != s.rate || p.length[(size_t)k] != s.length) s.dirty = masksDirty_ = true;
            }
            s.muted = muted;
            s.noteNumber = p.note[(size_t)k];
            s.length = p.length[(size_t)k];
            s.rate = p.rate[(size_t)k];
            if (s.dipLeft > 0) --s.dipLeft;
            if (s.gateLeft > 0) --s.gateLeft;
            if (s.noteLeft > 0 && --s.noteLeft == 0) {
                notes_.noteOff(s.sounding, emit);
                s.sounding = -1;
            }
        }

        // ---- the position, in beats since the origin --------------------------
        bool restart = false;
        double b = 0.0;
        if (in.clockPatched != clocked_) {
            releaseAll(emit);
            active_ = false;
            haveClock_ = false;
            clocked_ = in.clockPatched;
        }
        if (in.clockPatched) {
            ++sinceClock_;
            if (resetEdge) {
                pendingReset_ = true;
                releaseAll(emit);
            }
            if (clockEdge_.process(in.clock) > 0) {
                if (haveClock_ && sinceClock_ > 0) period_ = sinceClock_;
                sinceClock_ = 0;
                ticks_ = pendingReset_ || !haveClock_ ? 0 : ticks_ + 1;
                if (pendingReset_ || !haveClock_) {
                    startB_ = 0.0;
                    restart = true;
                }
                pendingReset_ = false;
                haveClock_ = true;
                active_ = true;
            }
            b = 0.25 * ((double)ticks_ + std::min((double)sinceClock_ / (double)std::max<int64_t>(1, period_), 0.999));
            beatSamples_ = (double)period_ * 4.0;
        } else if (t.running) {
            if (t.started || !active_) {
                if (t.started || !active_) origin_ = 0.0;
                startB_ = t.ppq;
                restart = true;
                active_ = true;
            }
            if (resetEdge) {
                releaseAll(emit);
                origin_ = (std::floor(t.ppq / 0.25) + 1.0) * 0.25;  // the next 1/16 is step 1
                startB_ = 0.0;
                restart = true;
            }
            b = t.ppq - origin_;
            beatSamples_ = 60.0 / std::max(t.bpm, 1.0) * sampleRate_;
        } else if (active_) {
            active_ = false;
            releaseAll(emit);
        }
        if (!active_) haveB_ = false;

        if (active_) {
            // A jump (loop, Rate change): re-sync without playing what was skipped.
            if (haveB_ && (b < prevB_ - 1e-9 || b - prevB_ > 0.25)) restart = true;
            haveB_ = true;
            prevB_ = b;
            for (int k = 0; k < kGateTracks; ++k) trackTick(p, in, k, b, restart, fill, out, emit);
            // Cycle: every track back at its step 1 together.
            int64_t cyc = 1;
            for (int k = 0; k < kGateTracks && cyc > 0; ++k) {
                const int64_t u = rateUnits(p.rate[(size_t)k]) * std::clamp(p.length[(size_t)k], 1, kGateSteps);
                cyc = std::lcm(cyc, u);
                if (cyc > ((int64_t)1 << 40)) cyc = 0;
            }
            if (cyc > 0) {
                const int64_t c = (int64_t)std::floor((b * 48.0 + 1e-6) / (double)cyc);
                if (!restart && haveCycle_ && c != cycleIndex_ && c >= 0 && b >= 0.0) out.cycle = 1.0f;
                if (restart && b * 48.0 >= 0.0 && std::fabs(b * 48.0 - (double)c * (double)cyc) < 1e-6) out.cycle = 1.0f;
                cycleIndex_ = c;
                haveCycle_ = true;
            }
        }

        for (int k = 0; k < kGateTracks; ++k) {
            TrackState& s = tracks_[(size_t)k];
            const bool high = s.gateLeft > 0 && s.dipLeft == 0;
            s.lowFor = high ? 0 : std::min<int64_t>(s.lowFor + 1, 1 << 30);
            out.gate[(size_t)k] = high ? 1.0f : 0.0f;
            out.vel[(size_t)k] = s.velocity;
        }
    }

private:
    struct Hit {
        bool valid = false;
        double T = 0.0;  ///< in steps of the track
        int64_t m = 0;
        int j = 0;
    };
    static bool after(const Hit& a, double T, int64_t m, int j) noexcept {  // (T, m, j) > a
        return T > a.T || (!(T < a.T || T > a.T) && (m > a.m || (m == a.m && j > a.j)));
    }

    struct TrackState {
        double prevX = 0.0;
        bool have = false, dirty = true, endRequested = false, muted = false, tie = false;
        int64_t lowFor = 1 << 30;  ///< samples since the gate output was last high
        Hit next{};
        int64_t decided = INT64_MIN;
        bool decision = false;
        int64_t gateLeft = 0, dipLeft = 0, noteLeft = 0;
        int sounding = -1;     ///< sounding note number
        int noteNumber = -1, length = 16, rate = 9;
        float velocity = 0.0f;
        int lastStep = -1, pos = 0;
        uint32_t upcoming = 0;
        int64_t maskLoop = INT64_MIN;
        float nudgeDepth = -1.0f, swing = -1.0f;
    };

    int64_t firstLoop(const GateParams& p, int t) const noexcept {
        const double beats = dsp::sequencerRateBeats(p.rate[(size_t)t]);
        const int L = std::clamp(p.length[(size_t)t], 1, kGateSteps);
        return floorDiv((int64_t)std::floor(startB_ / beats + 1e-9), L);
    }

    /// The time (in track steps) of hit j of step count m.
    double hitTime(const GateParams& p, const GateStep& st, int64_t m, int j, double& slot) const noexcept {
        double offset;
        ratchetSlot(std::clamp((int)st.ratchet, 1, 8), st.shape, j, offset, slot);
        const double swing = (m & 1) ? (double)dsp::swingAmount(p.swing) : 0.0;
        const double nudge = (double)std::clamp((int)st.nudge, -50, 50) / 100.0 * std::clamp((double)p.nudgeDepth, 0.0, 1.0);
        return (double)m + swing + nudge + offset;
    }

    /// The first hit of track t strictly after `from` (in (T, m, j) order).
    Hit findNext(const GateParams& p, int t, const Hit& from) const noexcept {
        const int L = std::clamp(p.length[(size_t)t], 1, kGateSteps);
        Hit best;
        const int64_t m0 = (int64_t)std::floor(from.T) - 2;
        for (int64_t m = std::max<int64_t>(0, m0); m <= m0 + L + 4; ++m) {
            if (best.valid && (double)m - 0.5 > best.T) break;
            const GateStep& st = pattern_[(size_t)t].steps[(size_t)mod(m, L)];
            if (!st.on) continue;
            const int r = std::clamp((int)st.ratchet, 1, 8);
            for (int j = 0; j < r; ++j) {
                double slot;
                const double T = hitTime(p, st, m, j, slot);
                if (!after(from, T, m, j)) continue;
                if (!best.valid || T < best.T || (!(T < best.T || T > best.T) && m < best.m)) best = {true, T, m, j};
            }
        }
        return best;
    }

    template <class Emit>
    void trackTick(const GateParams& p, const GateInputs& in, int t, double b, bool restart, bool fill,
                   GateOutputs& out, Emit& emit) noexcept {
        TrackState& s = tracks_[(size_t)t];
        const double beats = dsp::sequencerRateBeats(p.rate[(size_t)t]);
        const int L = std::clamp(p.length[(size_t)t], 1, kGateSteps);
        const double x = b / beats;
        if (restart || !s.have || x < s.prevX - 1e-9 || x - s.prevX > 1.0) {
            s.prevX = x - 1e-9;  // a hit exactly here plays
            s.have = true;
            s.dirty = true;
            s.decided = INT64_MIN;
        }
        if (std::fabs(p.nudgeDepth - s.nudgeDepth) > 1e-4f || std::fabs(p.swing - s.swing) > 1e-4f) {
            s.nudgeDepth = p.nudgeDepth;
            s.swing = p.swing;
            s.dirty = true;
        }
        if (s.dirty || std::floor(x) != std::floor(s.prevX)) {
            s.next = findNext(p, t, Hit{true, s.prevX, INT64_MAX, 1 << 30});
            s.dirty = false;
        }
        while (s.next.valid && s.next.T <= x) {
            fire(p, in, t, s.next, fill, beats, out, emit);
            s.next = findNext(p, t, s.next);
        }
        s.prevX = x;
        const int64_t n = (int64_t)std::floor(x);
        s.pos = (int)mod(n, L);
        // Which steps play on this pass (for the view), once per loop or after edits.
        const int64_t loop = floorDiv(n, L);
        if (loop != s.maskLoop || masksDirty_) {
            uint32_t mask = 0;
            for (int i = 0; i < L; ++i)
                if (plays(p, t, loop * L + i, fill)) mask |= 1u << i;
            s.upcoming = mask;
            s.maskLoop = loop;
            if (t == kGateTracks - 1) masksDirty_ = false;
        }
    }

    template <class Emit>
    void fire(const GateParams& p, const GateInputs& in, int t, const Hit& h, bool fill, double beats,
              GateOutputs& out, Emit& emit) noexcept {
        TrackState& s = tracks_[(size_t)t];
        if (h.m != s.decided) {
            s.decided = h.m;
            s.decision = plays(p, t, h.m, fill);
        }
        const bool muted = in.mute[(size_t)t] >= 0.5f || pattern_[(size_t)t].mute;
        if (!s.decision || muted) return;
        const int L = std::clamp(p.length[(size_t)t], 1, kGateSteps);
        const int i = (int)mod(h.m, L);
        const GateStep& st = pattern_[(size_t)t].steps[(size_t)i];
        const int r = std::clamp((int)st.ratchet, 1, 8);
        const double stepSamples = beats * beatSamples_;
        double slot;
        hitTime(p, st, h.m, h.j, slot);
        int64_t len;
        const bool tie = st.tie && h.j == r - 1;
        if (tie) {
            // Holds until the next step that doesn't play starts.
            int64_t q = h.m + 1;
            while (q < h.m + L + 1 && plays(p, t, q, fill)) ++q;
            const double end = (double)q + ((q & 1) ? (double)dsp::swingAmount(p.swing) : 0.0);
            double offset;
            ratchetSlot(r, st.shape, h.j, offset, slot);
            len = (int64_t)std::llround(std::max(0.05, end - h.T) * stepSamples);
        } else if (st.tie) {
            len = (int64_t)std::llround(slot * stepSamples);  // ratchets before a tie fill their slots
        } else {
            len = (int64_t)std::llround(slot * std::clamp((int)st.length, 1, 100) / 100.0 * stepSamples);
        }
        const int64_t dip = (int64_t)std::llround(0.001 * sampleRate_);
        len = std::max<int64_t>(len, 1);
        if ((s.gateLeft > 0 || s.lowFor < dip) && !s.tie) {  // touching gates drop for 1 ms
            s.dipLeft = s.gateLeft > 0 ? dip : dip - s.lowFor;
            len = std::max(len, s.dipLeft + 1);
        }
        s.gateLeft = len;
        s.tie = tie;
        s.lastStep = i;
        const float decay = std::clamp(p.ratchetDecay, 0.0f, 1.0f) * (float)h.j / (float)r;
        s.velocity = std::clamp((float)st.velocity / 127.0f * (1.0f - decay), 1.0f / 127.0f, 1.0f);
        out.trig[(size_t)t] = 1.0f;
        // Notes: a new hit on a sounding note ends it first (SeqNoteSet::noteOn).
        const int note = std::clamp(p.note[(size_t)t], 0, 127);
        if (s.sounding >= 0 && s.sounding != note) notes_.noteOff(s.sounding, emit);
        notes_.noteOn({note, dsp::notePitch(note), s.velocity}, emit);
        s.sounding = note;
        s.noteLeft = len;
    }

    template <class Emit>
    void endTrack(int t, Emit& emit) noexcept {
        TrackState& s = tracks_[(size_t)t];
        if (s.sounding >= 0) notes_.noteOff(s.sounding, emit);
        s.sounding = -1;
        s.noteLeft = s.gateLeft = s.dipLeft = 0;
        s.tie = false;
    }

    template <class Emit>
    void releaseAll(Emit& emit) noexcept {
        for (int t = 0; t < kGateTracks; ++t) {
            endTrack(t, emit);
            tracks_[(size_t)t].have = false;
        }
        notes_.release(emit);
        haveCycle_ = false;
    }

    double sampleRate_ = 48000.0;
    GatePattern pattern_{};
    std::array<TrackState, kGateTracks> tracks_{};
    dsp::SeqNoteSet<8> notes_;
    dsp::GateEdge clockEdge_, resetEdge_;
    bool clocked_ = false, haveClock_ = false, pendingReset_ = false, active_ = false;
    int64_t ticks_ = 0, sinceClock_ = 0, period_ = 6000;
    double beatSamples_ = 24000.0;
    double startB_ = 0.0, origin_ = 0.0;
    int64_t cycleIndex_ = 0;
    bool haveCycle_ = false, masksDirty_ = true, haveB_ = false;
    double prevB_ = 0.0;
};

}  // namespace bleep::patch
