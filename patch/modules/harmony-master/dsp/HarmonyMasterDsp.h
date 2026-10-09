// SPDX-License-Identifier: MIT
// Harmony Master core (doc/specs/modules/harmony-master.md): holds the board's
// harmonic context (key, scale, chord) from the knobs, a transport-synced
// progression or chords played into Notes, and plays it as pitches and
// notes. The module publishes context() to its harmony bus. Notes leave
// through a callback, so this stays free of the engine's types.
#pragma once

#include "dsp/Chords.h"
#include "dsp/Harmony.h"
#include "dsp/Scales.h"
#include "dsp/SeqNotes.h"
#include "dsp/Smoothing.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum HmSource { HmSrcManual = 0, HmSrcProgression, HmSrcDetect };
enum HmAdvance { HmTransport = 0, HmTrigger, HmSelect };

/// Quality setting / slot quality: diatonic stacks, else a chord-table index.
constexpr int kHmDiatonicTriad = -2, kHmDiatonicSeventh = -3;

constexpr int kHmMaxSlots = 16;
/// Allowed slot lengths in quarter notes.
inline const std::array<double, 9>& hmSlotLengths() {
    static const std::array<double, 9> l{0.5, 1.0, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0, 16.0};
    return l;
}
/// The allowed length nearest to `beats`.
inline double hmSnapLength(double beats) noexcept {
    double best = 4.0, d = 1e9;
    for (double l : hmSlotLengths())
        if (std::fabs(l - beats) < d) d = std::fabs(l - beats), best = l;
    return best;
}

struct HmSlot {
    int degree = 1;     ///< 1…7, or 0 when `root` is used
    int root = -1;      ///< absolute pitch class 0…11, or -1
    int quality = kHmDiatonicTriad;
    int bass = -1;      ///< pitch class, or -1 (the chord's own)
    double beats = 4.0;
};

struct HmProgression {
    int count = 0;
    HmSlot slots[kHmMaxSlots];
    double total() const noexcept {
        double t = 0.0;
        for (int i = 0; i < count; ++i) t += slots[i].beats;
        return t;
    }
    /// I – vi – IV – V, four beats each (a new module).
    static HmProgression defaults() noexcept {
        HmProgression p;
        const int deg[4] = {1, 6, 4, 5};
        for (int i = 0; i < 4; ++i) p.slots[i].degree = deg[i];
        p.count = 4;
        return p;
    }
};

struct HmParams {
    int source = HmSrcManual;
    int key = 0;
    int scale = 1;            ///< dsp::scales() index
    int quality = kHmDiatonicTriad;
    int advance = HmTransport;
    bool adapt = false;       ///< Scale Policy Adapt
    bool latch = true;
    int octave = 0;
    int degree = 1;           ///< Degree knob, 1…7
    int slot = 1;             ///< Slot knob, 1…16
    float velocity = 0.7f;
};

struct HmInput {
    float next = 0.0f, reset = 0.0f;
    float transpose = 0.0f;   ///< V/oct
    bool running = false;     ///< transport playing with a valid position
    bool started = false;     ///< first sample after the transport started
    double ppq = 0.0;
};

struct HmOutputs {
    float key = 0.0f, root = 0.0f, bass = 0.0f, tone[4]{}, change = 0.0f, degree = 0.0f;
};

class HarmonyMasterDsp {
public:
    static constexpr double kDetectSeconds = 0.030;

    /// The chord built on a scale degree (0-based index into the scale, any
    /// integer) or on an absolute root, with a quality setting. Pure.
    static dsp::HarmonyState build(int key, uint16_t scale, int degreeIndex, int absRoot, int quality, int bass,
                                   bool adapt) noexcept {
        dsp::HarmonyState h;
        if (quality == kHmDiatonicTriad || quality == kHmDiatonicSeventh) {
            int idx = degreeIndex;
            if (absRoot >= 0) {
                if (!dsp::inScale(scale, absRoot - key)) {  // not a scale note: major / dominant 7
                    h = dsp::makeHarmony(key, scale, absRoot,
                                         quality == kHmDiatonicTriad ? dsp::ChordMajor : dsp::ChordDominant7, bass);
                    return finish(h, adapt);
                }
                idx = dsp::scaleIndexOf(scale, dsp::pitchClass(absRoot - key));
            }
            const dsp::ScaleChord c = quality == kHmDiatonicTriad ? dsp::diatonicTriad(scale, idx)
                                                                   : dsp::diatonicSeventh(scale, idx);
            const int rootPc = key + c.root;
            if (c.quality >= 0) h = dsp::makeHarmony(key, scale, rootPc, c.quality, bass);
            else h = dsp::makeHarmonyMask(key, scale, rootPc, dsp::intervalMask(c.intervals, c.count), bass);
            return finish(h, adapt);
        }
        const int rootPc = absRoot >= 0 ? absRoot : key + dsp::scaleNote(scale, degreeIndex);
        h = dsp::makeHarmony(key, scale, rootPc, std::clamp(quality, 0, dsp::kNumChordQualities - 1), bass);
        return finish(h, adapt);
    }

    /// The slot playing at `pos` quarter notes into the progression.
    static int slotAt(const HmProgression& p, double pos) noexcept {
        double acc = 0.0;
        for (int i = 0; i < p.count; ++i) {
            acc += p.slots[i].beats;
            if (pos < acc - 1e-9) return i;
        }
        return std::max(0, p.count - 1);
    }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        detectSamples_ = std::max<int64_t>(1, (int64_t)std::llround(kDetectSeconds * sampleRate));
    }

    void reset() noexcept {
        notes_.reset();
        heldCount_ = 0;
        pendingHeld_ = false;
        stableFor_ = 0;
        haveDetected_ = false;
        haveState_ = false;
        slot_ = 0;
        trigSlot_ = 0;
        off_ = 0.0;
        resetPending_ = false;
        transpose_ = 0;
        sounding_ = false;
        notesDirty_ = false;
        next_.reset();
        reset_.reset();
        state_ = dsp::HarmonyState{};
    }

    void setProgression(const HmProgression* p) noexcept { prog_ = p; }

    // ---- Notes input (Detect) ------------------------------------------------
    void noteOn(int note) noexcept {
        for (int i = 0; i < heldCount_; ++i)
            if (held_[i] == note) return;
        if (heldCount_ < kMaxHeld) held_[heldCount_++] = note;
        heldChanged();
    }
    void noteOff(int note) noexcept {
        for (int i = 0; i < heldCount_; ++i)
            if (held_[i] == note) {
                held_[i] = held_[--heldCount_];
                heldChanged();
                return;
            }
    }

    /// One sample. `emit(on, note, pitch, velocity)` receives note events;
    /// `room` is how many note events the output can still take this sample
    /// (a change waits while there is not enough room, so no note hangs).
    template <class Emit>
    void tick(const HmParams& p, const HmInput& in, HmOutputs& out, int room, Emit&& emit) noexcept {
        out.change = 0.0f;
        const auto& scl = dsp::scales()[(size_t)std::clamp(p.scale, 0, (int)dsp::scales().size() - 1)];
        const uint16_t scale = scl.mask;
        const int t = (int)std::lround(in.transpose * 12.0f);
        const bool nextEdge = next_.process(in.next) > 0;
        const bool resetEdge = reset_.process(in.reset) > 0;
        const bool progression = p.source == HmSrcProgression && prog_ && prog_->count > 0;
        const bool transportProg = progression && p.advance == HmTransport;

        // Which chord, before Transpose.
        bool slotChanged = false;
        dsp::HarmonyState base;
        if (progression) {
            const HmProgression& pr = *prog_;
            int s = slot_;
            if (p.advance == HmTransport) {
                if (in.started) off_ = 0.0, resetPending_ = false;
                if (resetEdge) {  // the grid restarts on the next beat
                    off_ = std::floor(in.ppq) + 1.0;
                    resetPending_ = true;
                }
                if (in.running && !(resetPending_ && in.ppq < off_)) {
                    resetPending_ = false;
                    const double T = pr.total();
                    double pos = std::fmod(in.ppq - off_, T);
                    if (pos < 0.0) pos += T;
                    s = slotAt(pr, pos);
                }
            } else if (p.advance == HmTrigger) {
                if (resetEdge) trigSlot_ = 0;
                else if (nextEdge) trigSlot_ = trigSlot_ + 1;
                trigSlot_ = trigSlot_ % pr.count;
                s = trigSlot_;
            } else {
                s = ((p.slot - 1) % pr.count + pr.count) % pr.count;
            }
            s = std::clamp(s, 0, pr.count - 1);
            slotChanged = s != slot_ || !haveState_;
            slot_ = s;
            const HmSlot& sl = pr.slots[s];
            base = cached(p.key, scale, sl.degree > 0 ? sl.degree - 1 : 0, sl.degree > 0 ? -1 : sl.root, sl.quality,
                          sl.bass, p.adapt);
        } else if (p.source == HmSrcDetect) {
            if (pendingHeld_ && ++stableFor_ >= detectSamples_) {
                pendingHeld_ = false;
                if (heldCount_ > 0) {
                    const dsp::DetectedChord d = dsp::detectChordFromNotes(held_, heldCount_, scale, p.key);
                    detected_ = d;
                    haveDetected_ = d.valid;
                } else if (!p.latch) {
                    haveDetected_ = false;
                }
            }
            if (!p.latch && heldCount_ == 0 && !pendingHeld_) haveDetected_ = false;
            if (haveDetected_) {
                base = dsp::makeHarmony(p.key, scale, detected_.root, detected_.quality, detected_.bass);
                if (p.adapt) base = finish(base, true);
            } else {
                base = cached(p.key, scale, p.degree - 1, -1, p.quality, -1, p.adapt);
            }
        } else {
            base = cached(p.key, scale, p.degree - 1, -1, p.quality, -1, p.adapt);
        }

        // Transpose: in Progression it applies at slot changes and Next/Reset;
        // elsewhere as soon as it moves by a semitone.
        if (!progression || slotChanged || nextEdge || resetEdge) transpose_ = t;
        const dsp::HarmonyState next = dsp::transposed(base, transpose_);
        if (!haveState_ || !dsp::sameHarmony(next, state_)) {
            const uint32_t serial = state_.serial;
            state_ = next;
            state_.serial = serial + 1;
            if (haveState_) out.change = 1.0f;
            haveState_ = true;
            dsp::harmonyTones(state_, tones_);
            notesDirty_ = true;
        }

        // Notes: Progression/Transport stops with the transport.
        const bool shouldSound = !transportProg || in.running;
        if (!shouldSound && sounding_) {
            if (room >= notes_.count()) {
                notes_.release(emit);
                sounding_ = false;
            }
        } else if (shouldSound && (notesDirty_ || !sounding_) && room >= 8) {
            dsp::SeqNote ns[4];
            for (int k = 0; k < 4; ++k) {
                const int semis = foldMidi(12 * p.octave + state_.chordRoot + tones_[k]);
                ns[k].note = 60 + semis;
                ns[k].pitch = (float)semis / 12.0f;
                ns[k].velocity = std::clamp(p.velocity, 0.01f, 1.0f);
            }
            notes_.set(ns, 4, emit);
            sounding_ = true;
            notesDirty_ = false;
        }

        const float o = (float)p.octave;
        out.key = o + (float)state_.key / 12.0f;
        out.root = o + (float)state_.chordRoot / 12.0f;
        out.bass = o - 1.0f + (float)state_.bass / 12.0f;
        for (int k = 0; k < 4; ++k) out.tone[k] = out.root + (float)tones_[k] / 12.0f;
        out.degree = state_.degree >= 1 ? std::min(1.0f, (float)(state_.degree - 1) / 6.0f) : 0.0f;
    }

    /// Ends every sounding note (transport stop, removal).
    template <class Emit>
    void release(Emit&& emit) noexcept {
        notes_.release(emit);
        sounding_ = false;
    }

    const dsp::HarmonyState& context() const noexcept { return state_; }
    int slot() const noexcept { return slot_; }
    int heldCount() const noexcept { return heldCount_; }
    bool sounding() const noexcept { return sounding_; }
    const int* tones() const noexcept { return tones_; }

private:
    static constexpr int kMaxHeld = 16;

    static dsp::HarmonyState finish(dsp::HarmonyState h, bool adapt) noexcept {
        if (adapt) {
            h.scale = dsp::adaptScale(h.scale, h.key, h.chordRoot, h.chord);
            h.degree = (uint8_t)dsp::scaleDegree(h.scale, h.chordRoot - h.key);
        }
        return h;
    }
    /// Semitones from C4 folded by octaves into MIDI 0…127.
    static int foldMidi(int semis) noexcept {
        while (semis + 60 > 127) semis -= 12;
        while (semis + 60 < 0) semis += 12;
        return semis;
    }
    /// build() with the last arguments remembered (it runs every sample).
    const dsp::HarmonyState& cached(int key, uint16_t scale, int degreeIndex, int absRoot, int quality, int bass,
                                    bool adapt) noexcept {
        const int64_t k = (int64_t)key | (int64_t)scale << 4 | (int64_t)(degreeIndex & 0xff) << 16 |
                          (int64_t)(absRoot + 1) << 24 | (int64_t)(quality + 8) << 32 | (int64_t)(bass + 1) << 40 |
                          (int64_t)adapt << 48;
        if (!haveCache_ || k != cacheKey_) {
            cache_ = build(key, scale, degreeIndex, absRoot, quality, bass, adapt);
            cacheKey_ = k;
            haveCache_ = true;
        }
        return cache_;
    }
    void heldChanged() noexcept {
        pendingHeld_ = true;
        stableFor_ = 0;
    }

    double sampleRate_ = 48000.0;
    int64_t detectSamples_ = 1440;
    const HmProgression* prog_ = nullptr;
    dsp::GateEdge next_, reset_;
    int held_[kMaxHeld]{};
    int heldCount_ = 0;
    bool pendingHeld_ = false;
    int64_t stableFor_ = 0;
    dsp::DetectedChord detected_;
    bool haveDetected_ = false;
    dsp::HarmonyState state_, cache_;
    bool haveState_ = false, haveCache_ = false;
    int64_t cacheKey_ = 0;
    int tones_[4]{0, 4, 7, 12};
    int slot_ = 0, trigSlot_ = 0;
    double off_ = 0.0;
    bool resetPending_ = false;
    int transpose_ = 0;
    dsp::SeqNoteSet<4> notes_;
    bool sounding_ = false, notesDirty_ = false;
};

}  // namespace bleep::patch
