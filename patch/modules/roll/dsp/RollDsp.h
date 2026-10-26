// SPDX-License-Identifier: GPL-3.0-only
// Roll core (doc/specs/modules/roll.md): notes with a free start, length and
// pitch on a 96-ticks-per-beat grid, 1-8 bars per pattern slot, eight slots.
// The playhead is a tick count, either the song position (phase-locked) or a
// fixed number of ticks per Clock pulse. Notes overlap freely: each one is a
// voice with its own on and off. Morph blends two slots note by note.
// Notes leave through a callback, so this stays free of the engine's types.
#pragma once

#include "dsp/Random.h"
#include "dsp/Scales.h"
#include "dsp/SeqClock.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kRollTicksPerBeat = 96;
constexpr int kRollTicksPerBar = 4 * kRollTicksPerBeat;
constexpr int kRollMaxBars = 8;
constexpr int kRollSlots = 8;
constexpr int kRollMaxNotes = 256;
constexpr int kRollVoices = 48;
constexpr int kRollMaxRatchet = 8;

struct RollNote {
    int32_t t = 0;        ///< start, in ticks from the pattern start
    int32_t l = 24;       ///< length in ticks (>= 1)
    uint8_t pitch = 60;   ///< MIDI note number
    uint8_t vel = 100;    ///< 1..127
    uint8_t prob = 100;   ///< chance 0..100 %
    uint8_t ratchet = 1;  ///< 1..8 repeats inside the length
};

struct RollSlot {
    int32_t bars = 2;
    int32_t loopStart = 0, loopEnd = 2 * kRollTicksPerBar;  ///< loop region in ticks, end exclusive
    int32_t count = 0;
    std::array<RollNote, kRollMaxNotes> notes{};  ///< sorted by start, then pitch

    int32_t length() const noexcept { return std::clamp(bars, 1, kRollMaxBars) * kRollTicksPerBar; }
    int32_t loopA() const noexcept { return std::clamp(loopStart, 0, length() - 1); }
    int32_t loopB() const noexcept { return std::clamp(loopEnd, loopA() + 1, length()); }
};
using RollBank = std::array<RollSlot, kRollSlots>;

struct RollParams {
    int speed = 2;          ///< index into speedTable()
    int clockStep = 1;      ///< index into clockStepTicks()
    int slot = 0;           ///< playing slot, 0..7
    int morphTo = 1;        ///< the slot Morph blends towards
    float morph = 0.0f;     ///< 0..1
    float humanise = 0.0f;  ///< 0..1
    float lengthScale = 1.0f;
    float swing = 0.5f;     ///< 0.5 .. 0.75
    int octave = 0;
    int root = 0;
    int scale = 0;
    int scaleMask = -1;     ///< >= 0: this 12-bit mask instead of `scale` (the harmony bus)
    bool snap = false;      ///< quantize played pitches to the scale
    int change = 1;         ///< slot change: 0 Immediate, 1 Next bar, 2 Loop end
    uint32_t seed = 1;
};

struct RollInputs {
    float clock = 0.0f, reset = 0.0f, transpose = 0.0f;  ///< transpose in V/oct
    float pattern = 0.0f;
    bool clockPatched = false, patternPatched = false;
};

struct RollTime {
    bool running = false, started = false;
    double bpm = 120.0, ppq = 0.0;
};

struct RollOutputs {
    float lowPitch = 0.0f, lowGate = 0.0f, highPitch = 0.0f, highGate = 0.0f;
    float lastPitch = 0.0f, lastGate = 0.0f, velocity = 0.0f;
    float trigger = 0.0f, loop = 0.0f, position = 0.0f;
};

/// Turns played notes into Roll notes while the playhead runs: a note starts at
/// the playhead tick and ends at the tick of its release, wrapping round the
/// loop. Finished notes leave through a callback. Input events arrive as note
/// numbers (the Notes input) or as a pitch plus a gate (the CV inputs).
class RollRecorder {
public:
    void reset() noexcept {
        for (auto& h : held_) h = Held{};
        gate_ = false;
        gateNote_ = -1;
    }
    void noteOn(int note, float vel, int pos) noexcept {
        note = std::clamp(note, 0, 127);
        held_[(size_t)note] = {true, pos, (uint8_t)std::clamp((int)std::lround(vel * 127.0f), 1, 127)};
    }
    template <class Done>
    void noteOff(int note, int pos, const RollSlot& slot, Done&& done) noexcept {
        Held& h = held_[(size_t)std::clamp(note, 0, 127)];
        if (!h.on) return;
        h.on = false;
        const int a = slot.loopA(), b = slot.loopB();
        int len = pos >= h.start ? pos - h.start : (b - h.start) + (pos - a);
        RollNote n;
        n.t = std::clamp(h.start, 0, slot.length() - 1);
        n.l = std::clamp(len, 1, slot.length() - n.t);
        n.pitch = (uint8_t)std::clamp(note, 0, 127);
        n.vel = h.vel;
        done(n);
    }
    /// Pitch (1 V/oct, 0 V = C4) and gate in place of note events.
    template <class Done>
    void cv(float pitch, float gate, float vel, int pos, const RollSlot& slot, Done&& done) noexcept {
        const bool high = gate >= 0.5f;
        if (high && !gate_) {
            gateNote_ = std::clamp(60 + (int)std::lround(pitch * 12.0f), 0, 127);
            noteOn(gateNote_, vel, pos);
        } else if (!high && gate_ && gateNote_ >= 0) {
            noteOff(gateNote_, pos, slot, done);
            gateNote_ = -1;
        }
        gate_ = high;
    }
    /// Ends every held note at `pos` (recording stopped, slot changed).
    template <class Done>
    void closeAll(int pos, const RollSlot& slot, Done&& done) noexcept {
        for (int i = 0; i < 128; ++i) noteOff(i, pos, slot, done);
        gate_ = false;
        gateNote_ = -1;
    }
    bool holding() const noexcept {
        for (const auto& h : held_)
            if (h.on) return true;
        return false;
    }

private:
    struct Held {
        bool on = false;
        int start = 0;
        uint8_t vel = 100;
    };
    std::array<Held, 128> held_{};
    bool gate_ = false;
    int gateNote_ = -1;
};

class RollDsp {
public:
    static constexpr int kNumSpeeds = 5;
    static const std::array<double, kNumSpeeds>& speedTable() {
        static const std::array<double, kNumSpeeds> t{0.25, 0.5, 1.0, 2.0, 4.0};
        return t;
    }
    static const std::array<const char*, kNumSpeeds>& speedNames() {
        static const std::array<const char*, kNumSpeeds> n{"x1/4", "x1/2", "x1", "x2", "x4"};
        return n;
    }
    static constexpr int kNumClockSteps = 5;
    static const std::array<int, kNumClockSteps>& clockStepTicks() {
        static const std::array<int, kNumClockSteps> t{12, 24, 48, 96, 8};
        return t;
    }
    static const std::array<const char*, kNumClockSteps>& clockStepNames() {
        static const std::array<const char*, kNumClockSteps> n{"1/32", "1/16", "1/8", "1/4", "1/32T"};
        return n;
    }
    static int64_t mod(int64_t a, int64_t m) noexcept { return ((a % m) + m) % m; }
    static int64_t floorDiv(int64_t a, int64_t m) noexcept { return (a - mod(a, m)) / m; }

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    /// Forgets timing and voices without events (a fresh module).
    void reset() noexcept {
        voices_.fill(Voice{});
        owner_.fill(0);
        clock_.reset();
        reset_.reset();
        haveN_ = false;
        lastN_ = base_ = 0;
        transportOn_ = false;
        origin_ = 0;
        pendingReset_ = false;
        haveClock_ = false;
        sinceClock_ = 0;
        period_ = (int64_t)(sampleRate_ * 0.125);
        playSlot_ = prevSlot_ = -1;
        pos_ = 0;
        selLow_ = selHigh_ = selLast_ = 0;
        lowPitch_ = highPitch_ = lastPitch_ = lastVel_ = 0.0f;
        effKey_ = -1;
    }

    /// The bank (all slots); null plays nothing.
    void setBank(const RollBank* b) noexcept {
        if (b == bank_) return;
        bank_ = b;
        effKey_ = -1;
    }

    int playingSlot() const noexcept { return std::max(playSlot_, 0); }
    /// The slot being played, for the recorder (null before the first tick).
    const RollSlot* playingSlotPtr() const noexcept { return playSlot_ < 0 ? nullptr : slotPtr(playSlot_); }
    bool running() const noexcept { return playSlot_ >= 0 && (transportOn_ || haveClock_); }
    int previousSlot() const noexcept { return prevSlot_ >= 0 ? prevSlot_ : std::max(playSlot_, 0); }
    int position() const noexcept { return pos_; }
    int sounding() const noexcept {
        int n = 0;
        for (const auto& v : voices_) n += v.started;
        return n;
    }
    /// The notes actually playing (Morph applied): for tests and the view.
    int effectiveCount() const noexcept { return effCount_; }
    const RollNote& effective(int i) const noexcept { return eff_[(size_t)i]; }

    /// A note-on and note-off pair for note events of this block.
    template <class Emit>
    void tick(const RollParams& p, const RollInputs& in, const RollTime& t, RollOutputs& out, Emit&& emit) noexcept {
        out.trigger = out.loop = 0.0f;
        triggered_ = false;
        loopWrapped_ = false;
        age(emit);
        const bool resetEdge = reset_.process(in.reset) > 0;

        // The wanted slot: the Pattern jack when patched, else the setting.
        wantSlot_ = in.patternPatched ? std::clamp((int)std::floor(in.pattern * kRollSlots), 0, kRollSlots - 1) : std::clamp(p.slot, 0, kRollSlots - 1);

        if (resetEdge) {
            releaseAll(emit);
            pendingReset_ = true;
        }
        if (in.clockPatched) {
            transportOn_ = false;
            ++sinceClock_;
            if (clock_.process(in.clock) > 0) {
                if (haveClock_) period_ = std::max<int64_t>(1, sinceClock_);
                haveClock_ = true;
                sinceClock_ = 0;
                const int span = clockStepTicks()[(size_t)std::clamp(p.clockStep, 0, kNumClockSteps - 1)];
                spt_ = (double)period_ / (double)span;
                int64_t n = pendingReset_ || !haveN_ ? 0 : lastN_ + 1;
                if (pendingReset_ || !haveN_) base_ = 0;
                pendingReset_ = false;
                for (int k = 0; k < span; ++k, ++n) {
                    haveN_ = true;
                    lastN_ = n;
                    doTick(p, in, n);
                }
            }
        } else if (t.running) {
            const double speed = speedTable()[(size_t)std::clamp(p.speed, 0, kNumSpeeds - 1)];
            const double ticks = t.ppq * (double)kRollTicksPerBeat * speed;
            const int64_t abs = (int64_t)std::floor(ticks);
            spt_ = 60.0 / std::max(t.bpm, 1.0) * sampleRate_ / ((double)kRollTicksPerBeat * speed);
            if (t.started || !transportOn_) {
                haveN_ = false;
                origin_ = 0;
                base_ = 0;
                pendingReset_ = false;
            }
            transportOn_ = true;
            if (pendingReset_) {
                origin_ = abs;
                pendingReset_ = false;
                base_ = 0;
                haveN_ = false;
            }
            const int64_t n = abs - origin_;
            if (!haveN_) {
                haveN_ = true;
                lastN_ = n;
                releaseAll(emit);
                doTick(p, in, n);
            } else if (n != lastN_) {
                if (n == lastN_ + 1) {
                    lastN_ = n;
                    doTick(p, in, n);
                } else {  // a jump: no catching up
                    lastN_ = n;
                    releaseAll(emit);
                    doTick(p, in, n);
                }
            }
        } else if (transportOn_) {
            transportOn_ = false;
            haveN_ = false;
            releaseAll(emit);
        }

        service(emit);
        outputs(out);
        out.trigger = triggered_ ? 1.0f : 0.0f;
        out.loop = loopWrapped_ ? 1.0f : 0.0f;
        const RollSlot* s = slotPtr(std::max(playSlot_, 0));
        if (s != nullptr) {
            const int a = s->loopA(), b = s->loopB();
            out.position = (float)(pos_ - a) / (float)std::max(1, b - a);
        } else {
            out.position = 0.0f;
        }
    }

    /// Ends everything that sounds (module removal, mode changes).
    template <class Emit>
    void releaseAll(Emit&& emit) noexcept {
        for (auto& v : voices_) {
            if (v.started && owner_[v.note] == v.uid) emit(false, (int)v.note, v.pitch, 0.0f);
            v = Voice{};
        }
        owner_.fill(0);
    }

private:
    struct Voice {
        bool used = false, started = false;
        uint8_t note = 0;
        float pitch = 0.0f, vel = 0.0f;
        int64_t delay = 0, remaining = 0;
        uint32_t uid = 0;
        uint32_t order = 0;
    };

    const RollSlot* slotPtr(int s) const noexcept { return bank_ ? &(*bank_)[(size_t)std::clamp(s, 0, kRollSlots - 1)] : nullptr; }

    template <class Emit>
    void age(Emit& emit) noexcept {
        for (auto& v : voices_) {
            if (!v.used) continue;
            if (!v.started) {
                if (v.delay > 0) --v.delay;
            } else if (--v.remaining <= 0) {
                if (owner_[v.note] == v.uid) {
                    emit(false, (int)v.note, v.pitch, 0.0f);
                    owner_[v.note] = 0;
                }
                v = Voice{};
            }
        }
    }

    template <class Emit>
    void service(Emit& emit) noexcept {
        for (auto& v : voices_) {
            if (!v.used || v.started || v.delay > 0) continue;
            if (owner_[v.note] != 0) emit(false, (int)v.note, v.pitch, 0.0f);  // the same note again: retrigger
            emit(true, (int)v.note, v.pitch, v.vel);
            owner_[v.note] = v.uid;
            v.started = true;
            v.order = ++orderCounter_;
            triggered_ = true;
            lastVel_ = v.vel;
        }
    }

    void outputs(RollOutputs& out) noexcept {
        const Voice *lo = nullptr, *hi = nullptr, *last = nullptr;
        for (const auto& v : voices_) {
            if (!v.started) continue;
            if (!lo || v.note < lo->note || (v.note == lo->note && v.order > lo->order)) lo = &v;
            if (!hi || v.note > hi->note || (v.note == hi->note && v.order > hi->order)) hi = &v;
            if (!last || v.order > last->order) last = &v;
        }
        auto pick = [&](const Voice* v, uint32_t& sel, float& pitch, float& gate) {
            if (!v) {
                gate = 0.0f;
                sel = 0;
                return;
            }
            gate = (sel != 0 && sel != v->uid) ? 0.0f : 1.0f;  // a different note takes over: a one-sample dip
            sel = v->uid;
            pitch = v->pitch;
        };
        pick(lo, selLow_, lowPitch_, out.lowGate);
        pick(hi, selHigh_, highPitch_, out.highGate);
        pick(last, selLast_, lastPitch_, out.lastGate);
        out.lowPitch = lowPitch_;
        out.highPitch = highPitch_;
        out.lastPitch = lastPitch_;
        out.velocity = lastVel_;
        // After a dip the next sample must see the new note as selected: sel was updated above.
    }

    // The playing notes: slot A, or A and B blended by Morph.
    void rebuild(const RollParams& p, int slotA) noexcept {
        const int mi = (int)std::lround(std::clamp(p.morph, 0.0f, 1.0f) * 64.0f);
        const int b = std::clamp(p.morphTo, 0, kRollSlots - 1);
        const int key = (slotA << 16) | (b << 8) | mi;
        if (key == effKey_ && p.seed == effSeed_) return;
        effKey_ = key;
        effSeed_ = p.seed;
        effCount_ = 0;
        const RollSlot* A = slotPtr(slotA);
        const RollSlot* B = slotPtr(b);
        if (!A) return;
        if (mi == 0 || !B || b == slotA) {
            effCount_ = A->count;
            for (int i = 0; i < A->count; ++i) eff_[(size_t)i] = A->notes[(size_t)i];
            return;
        }
        const double m = (double)mi / 64.0;
        auto lerp = [&](double x, double y) { return x + (y - x) * m; };
        const int common = std::min(A->count, B->count);
        for (int i = 0; i < common; ++i) {
            const RollNote &x = A->notes[(size_t)i], &y = B->notes[(size_t)i];
            RollNote r;
            r.t = (int32_t)std::lround(lerp(x.t, y.t));
            r.l = std::max(1, (int32_t)std::lround(lerp(x.l, y.l)));
            r.pitch = (uint8_t)std::clamp((int)std::lround(lerp(x.pitch, y.pitch)), 0, 127);
            r.vel = (uint8_t)std::clamp((int)std::lround(lerp(x.vel, y.vel)), 1, 127);
            r.prob = (uint8_t)std::clamp((int)std::lround(lerp(x.prob, y.prob)), 0, 100);
            r.ratchet = m < 0.5 ? x.ratchet : y.ratchet;
            eff_[(size_t)effCount_++] = r;
        }
        // Notes without a partner fade in (from B) or out (from A) by a fixed seeded threshold each.
        for (int i = common; i < A->count && effCount_ < kRollMaxNotes; ++i)
            if (dsp::uniform01(p.seed, (uint64_t)i, 21) < 1.0 - m) eff_[(size_t)effCount_++] = A->notes[(size_t)i];
        for (int i = common; i < B->count && effCount_ < kRollMaxNotes; ++i)
            if (dsp::uniform01(p.seed, (uint64_t)i, 22) < m) eff_[(size_t)effCount_++] = B->notes[(size_t)i];
    }

    void doTick(const RollParams& p, const RollInputs& in, int64_t n) noexcept {
        if (playSlot_ < 0) {  // first tick: no waiting
            playSlot_ = wantSlot_;
            prevSlot_ = -1;
        }
        const RollSlot* cur = slotPtr(playSlot_);
        if (!cur) return;
        int len = cur->loopB() - cur->loopA();
        int pos = cur->loopA() + (int)mod(n - base_, len);
        if (wantSlot_ != playSlot_) {
            const bool boundary = p.change == 0 || (p.change == 1 && pos % kRollTicksPerBar == 0) || (p.change == 2 && pos == cur->loopA());
            if (boundary) {
                prevSlot_ = playSlot_;
                playSlot_ = wantSlot_;
                cur = slotPtr(playSlot_);
                len = cur->loopB() - cur->loopA();
                if (p.change != 0) base_ = n;
                pos = cur->loopA() + (int)mod(n - base_, len);
            }
        }
        rebuild(p, playSlot_);
        pos_ = pos;
        if (pos == cur->loopA() && n != base_) loopWrapped_ = true;
        const int64_t cycle = floorDiv(n - base_, len);

        const float transpose = in.transpose * 12.0f;
        for (int i = 0; i < effCount_; ++i) {
            const RollNote& nt = eff_[(size_t)i];
            if (nt.t != pos) continue;
            startNote(p, nt, (uint64_t)cycle * 4096u + (uint64_t)i, transpose);
        }
    }

    void startNote(const RollParams& p, const RollNote& nt, uint64_t key, float transpose) noexcept {
        if (nt.prob < 100 && dsp::uniform01(p.seed, key, 11) * 100.0 >= (double)nt.prob) return;
        int semis = (int)nt.pitch + p.octave * 12 + (int)std::lround(transpose);
        if (p.snap) {
            const auto& sc = dsp::scales()[(size_t)std::clamp(p.scale, 0, (int)dsp::scales().size() - 1)];
            const uint16_t mask = p.scaleMask >= 0 ? (uint16_t)p.scaleMask : sc.mask;
            semis = 60 + p.root + dsp::quantize((float)(semis - 60 - p.root), mask);
        }
        semis = std::clamp(semis, 0, 127);
        float vel = (float)nt.vel / 127.0f;
        double delay = 0.0;
        const double h = std::clamp(p.humanise, 0.0f, 1.0f);
        if (h > 0.0) {
            vel *= 1.0f + (float)((dsp::uniform01(p.seed, key, 12) * 2.0 - 1.0) * 0.25 * h);
            delay += dsp::uniform01(p.seed, key, 13) * 0.03 * h * sampleRate_;
        }
        if ((nt.t / 24) % 2 == 1 && nt.t % 24 == 0)
            delay += (double)dsp::swingAmount(p.swing) * 24.0 * spt_;
        vel = std::clamp(vel, 1.0f / 127.0f, 1.0f);
        const int r = std::clamp((int)nt.ratchet, 1, kRollMaxRatchet);
        const double total = std::max(1.0, (double)nt.l * std::clamp(p.lengthScale, 0.05f, 4.0f) * spt_);
        const double sub = total / r;
        for (int k = 0; k < r; ++k) {
            Voice* v = nullptr;
            for (auto& c : voices_)
                if (!c.used) {
                    v = &c;
                    break;
                }
            if (!v) return;  // out of voices
            v->used = true;
            v->started = false;
            v->note = (uint8_t)semis;
            v->pitch = (float)(semis - 60) / 12.0f;
            v->vel = vel;
            v->delay = (int64_t)std::llround(delay + sub * k);
            v->remaining = std::max<int64_t>(1, (int64_t)std::llround(r > 1 ? sub * 0.75 : sub));
            v->uid = ++uidCounter_;
        }
    }

    double sampleRate_ = 48000.0;
    const RollBank* bank_ = nullptr;
    std::array<Voice, kRollVoices> voices_{};
    std::array<uint32_t, 128> owner_{};
    uint32_t uidCounter_ = 0, orderCounter_ = 0;
    dsp::GateEdge clock_, reset_;
    bool haveN_ = false, transportOn_ = false, pendingReset_ = false, haveClock_ = false;
    bool triggered_ = false, loopWrapped_ = false;
    int64_t lastN_ = 0, base_ = 0, origin_ = 0, sinceClock_ = 0, period_ = 6000;
    double spt_ = 250.0;  ///< samples per tick
    int playSlot_ = -1, prevSlot_ = -1, wantSlot_ = 0, pos_ = 0;
    uint32_t selLow_ = 0, selHigh_ = 0, selLast_ = 0;
    float lowPitch_ = 0.0f, highPitch_ = 0.0f, lastPitch_ = 0.0f, lastVel_ = 0.0f;
    std::array<RollNote, kRollMaxNotes> eff_{};
    int effCount_ = 0;
    int effKey_ = -1;
    uint32_t effSeed_ = 0;
};

}  // namespace bleep::patch
