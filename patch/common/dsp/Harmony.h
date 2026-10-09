// SPDX-License-Identifier: MIT
// The board-wide harmony context (doc/specs/modules/harmony-master.md §4.1, §7):
// what key, scale and chord the music is in right now. A Harmony Master
// publishes a HarmonyState to one of kHarmonyBuses buses; followers read it
// and quantize with the helpers here instead of their own Root/Scale.
//
// Pitches: the V/oct helpers take and return V/oct (0 = C4); the *Semis
// variants work in semitones from C4. Masks follow Scales.h: bit k set = k
// semitones above the mask's root. Header-only, no allocation, RT-safe.
#pragma once

#include "dsp/Chords.h"
#include "dsp/Scales.h"

#include <cmath>
#include <cstdint>
#include <type_traits>

namespace bleep::dsp {

constexpr int kHarmonyBuses = 4;  ///< A, B, C, D

/// One harmonic context. Plain data: trivially copyable, so the engine can
/// copy it per chunk and hand it across threads by value.
struct HarmonyState {
    bool valid = false;        ///< false: nobody publishes; followers use their own settings
    uint8_t key = 0;           ///< key root pitch class, 0…11 (C = 0)
    uint8_t chordRoot = 0;     ///< chord root pitch class
    uint8_t bass = 0;          ///< pitch class of the chord's lowest note
    uint16_t scale = 0xab5;    ///< 12-bit mask relative to `key` (Major)
    uint16_t chord = 0x091;    ///< 12-bit mask relative to `chordRoot` (Major)
    int16_t quality = ChordMajor;  ///< chordQualities() index, -1 if none
    uint8_t degree = 1;        ///< 1… (scale degree of chordRoot), 0 if not a scale note
    uint32_t serial = 0;       ///< increases at every change
};
static_assert(std::is_trivially_copyable_v<HarmonyState>, "HarmonyState must stay plain data");
static_assert(std::is_standard_layout_v<HarmonyState>, "HarmonyState must stay plain data");
using HarmonyContext = HarmonyState;  // the spec's name

inline int pitchClass(int semitone) noexcept { return ((semitone % 12) + 12) % 12; }

/// Same harmony (ignores `serial`).
inline bool sameHarmony(const HarmonyState& a, const HarmonyState& b) noexcept {
    return a.valid == b.valid && a.key == b.key && a.chordRoot == b.chordRoot && a.bass == b.bass && a.scale == b.scale &&
           a.chord == b.chord && a.quality == b.quality && a.degree == b.degree;
}

/// A valid context: key + scale, chord `quality` on `chordRoot` (pitch
/// classes); bass < 0 means the root. Degree from the scale.
inline HarmonyState makeHarmony(int key, uint16_t scale, int chordRoot, int quality, int bass = -1) noexcept {
    HarmonyState h;
    h.valid = true;
    h.key = (uint8_t)pitchClass(key);
    h.scale = (uint16_t)((scale & 0xfff) ? (scale & 0xfff) : 0xfff);
    h.chordRoot = (uint8_t)pitchClass(chordRoot);
    h.quality = (int16_t)(quality >= 0 && quality < kNumChordQualities ? quality : -1);
    h.chord = quality >= 0 && quality < kNumChordQualities ? chordMask(quality) : (uint16_t)1;
    h.bass = (uint8_t)pitchClass(bass < 0 ? chordRoot : bass);
    h.degree = (uint8_t)scaleDegree(h.scale, h.chordRoot - h.key);
    return h;
}
/// The same with an explicit chord mask (relative to chordRoot); the quality
/// is looked up in the table (-1 if not found).
inline HarmonyState makeHarmonyMask(int key, uint16_t scale, int chordRoot, uint16_t chord, int bass = -1) noexcept {
    HarmonyState h = makeHarmony(key, scale, chordRoot, -1, bass);
    h.chord = (uint16_t)((chord & 0xfff) | 1u);
    h.quality = (int16_t)findChordQuality(h.chord);
    return h;
}

/// Key, chord root and bass shifted by `semitones` (Harmony Master Transpose).
inline HarmonyState transposed(HarmonyState h, int semitones) noexcept {
    h.key = (uint8_t)pitchClass(h.key + semitones);
    h.chordRoot = (uint8_t)pitchClass(h.chordRoot + semitones);
    h.bass = (uint8_t)pitchClass(h.bass + semitones);
    return h;
}

/// Pitch-class masks relative to C.
inline uint16_t absoluteScale(const HarmonyState& h) noexcept { return rotateMask(h.scale, h.key); }
inline uint16_t absoluteChord(const HarmonyState& h) noexcept { return rotateMask(h.chord, h.chordRoot); }

/// Scale Policy Adapt (Harmony Master 4.2): every chord tone outside the
/// scale replaces the scale note one semitone below it, else the one above
/// (never another chord tone), else is simply added. Returns the new scale
/// mask, relative to `key`.
inline uint16_t adaptScale(uint16_t scale, int key, int chordRoot, uint16_t chord) noexcept {
    const uint16_t chordRel = rotateMask(chord, chordRoot - key);  // chord relative to key
    uint16_t s = (uint16_t)(scale & 0xfff);
    for (int pc = 0; pc < 12; ++pc) {
        if (!((chordRel >> pc) & 1u) || ((s >> pc) & 1u)) continue;
        const int lo = pitchClass(pc - 1), hi = pitchClass(pc + 1);
        if (((s >> lo) & 1u) && !((chordRel >> lo) & 1u)) s = (uint16_t)(s & ~(1u << lo));
        else if (((s >> hi) & 1u) && !((chordRel >> hi) & 1u)) s = (uint16_t)(s & ~(1u << hi));
        s = (uint16_t)(s | (1u << pc));
    }
    return s;
}

// ---- Quantizing (semitones from C4) ------------------------------------------

/// Nearest note of `mask` (relative to the pitch class `root`); ties go down.
inline int quantizeSemis(float semis, uint16_t mask, int root) noexcept {
    return root + quantize(semis - (float)root, mask);
}
/// Moves the (already quantized) `semitone` by `steps` notes of `mask`.
inline int stepSemis(int semitone, uint16_t mask, int root, int steps) noexcept {
    return root + scaleNote(mask, scaleIndexOf(mask, semitone - root) + steps);
}

inline int scaleSemis(const HarmonyState& h, float semis) noexcept { return quantizeSemis(semis, h.scale, h.key); }
inline int chordSemis(const HarmonyState& h, float semis) noexcept { return quantizeSemis(semis, h.chord, h.chordRoot); }
/// Nearest scale note, but a chord tone within `window` semitones wins
/// (Quantizer Suite Follow · Chord + Scale).
inline int chordPreferredSemis(const HarmonyState& h, float semis, float window = 1.0f) noexcept {
    const int c = chordSemis(h, semis);
    return std::fabs((float)c - semis) <= window ? c : scaleSemis(h, semis);
}
/// The chord root in the octave nearest the input (ties down).
inline int rootSemis(const HarmonyState& h, float semis) noexcept {
    return h.chordRoot + 12 * (int)std::ceil((semis - (float)h.chordRoot) / 12.0f - 0.5f);
}
/// Quantized to the scale, then moved by `steps` scale notes.
inline int scaleStepSemis(const HarmonyState& h, float semis, int steps) noexcept {
    return stepSemis(scaleSemis(h, semis), h.scale, h.key, steps);
}
/// Quantized to the chord, then moved by `steps` chord tones.
inline int chordStepSemis(const HarmonyState& h, float semis, int steps) noexcept {
    return stepSemis(chordSemis(h, semis), h.chord, h.chordRoot, steps);
}

// ---- Quantizing (V/oct) --------------------------------------------------------

inline float quantizeToScale(const HarmonyState& h, float volts) noexcept { return (float)scaleSemis(h, volts * 12.0f) / 12.0f; }
inline float quantizeToChord(const HarmonyState& h, float volts) noexcept { return (float)chordSemis(h, volts * 12.0f) / 12.0f; }
inline float quantizeChordPreferred(const HarmonyState& h, float volts, float windowSemis = 1.0f) noexcept {
    return (float)chordPreferredSemis(h, volts * 12.0f, windowSemis) / 12.0f;
}
inline float quantizeToRoot(const HarmonyState& h, float volts) noexcept { return (float)rootSemis(h, volts * 12.0f) / 12.0f; }
inline float transposeInScale(const HarmonyState& h, float volts, int steps) noexcept {
    return (float)scaleStepSemis(h, volts * 12.0f, steps) / 12.0f;
}
inline float transposeInChord(const HarmonyState& h, float volts, int steps) noexcept {
    return (float)chordStepSemis(h, volts * 12.0f, steps) / 12.0f;
}

/// Tone 1…4 (Harmony Master 4.5): the chord's intervals above the root in
/// stacking order, cut to 4; fewer are filled with root + 12, then the fifth
/// + 12 (else the root + 24). Quality -1: the mask's notes low to high.
inline void harmonyTones(const HarmonyState& h, int out[4]) noexcept {
    int iv[12], n = 0;
    if (h.quality >= 0 && h.quality < kNumChordQualities) {
        n = chordIntervals(h.quality, iv);
    } else {
        for (int k = 0; k < 12; ++k)
            if ((h.chord >> k) & 1u) iv[n++] = k;
        if (n == 0) iv[n++] = 0;
    }
    int fifth = -1;
    for (int i = 0; i < n; ++i)
        if (toneRole(iv, i) == RoleFifth) {
            fifth = iv[i];
            break;
        }
    int k = 0;
    for (; k < 4 && k < n; ++k) out[k] = iv[k];
    if (k < 4) out[k++] = 12;
    if (k < 4) out[k++] = fifth >= 0 ? fifth + 12 : 24;
    for (; k < 4; ++k) out[k] = out[k - 1];
}

// ---- A bus over one chunk ------------------------------------------------------

/// One bus for one processing chunk: the context at the chunk start plus up
/// to kMaxChanges changes at sample offsets (harmony-master.md §7.1). The
/// publisher calls begin() then publish(); readers call at(sample).
struct HarmonyBus {
    static constexpr int kMaxChanges = 8;
    HarmonyState start{};
    int numChanges = 0;
    int offsets[kMaxChanges]{};
    HarmonyState changes[kMaxChanges]{};

    /// New chunk: starts from the last state of the previous one.
    void begin() noexcept {
        start = current();
        numChanges = 0;
    }
    void begin(const HarmonyState& s) noexcept {
        start = s;
        numChanges = 0;
    }
    /// A change at `offset` (non-decreasing). A change on the same offset as
    /// the previous replaces it; beyond kMaxChanges the last one is replaced
    /// (and moves to `offset`).
    void publish(int offset, const HarmonyState& s) noexcept {
        if (numChanges > 0 && (offsets[numChanges - 1] >= offset || numChanges == kMaxChanges)) {
            changes[numChanges - 1] = s;
            if (offset > offsets[numChanges - 1]) offsets[numChanges - 1] = offset;
            return;
        }
        offsets[numChanges] = offset;
        changes[numChanges++] = s;
    }
    /// The context in force at `sample` (a change at `sample` counts).
    const HarmonyState& at(int sample) const noexcept {
        const HarmonyState* s = &start;
        for (int i = 0; i < numChanges && offsets[i] <= sample; ++i) s = &changes[i];
        return *s;
    }
    /// The state at the chunk end.
    const HarmonyState& current() const noexcept { return numChanges > 0 ? changes[numChanges - 1] : start; }
    /// A change happens exactly at `sample`.
    bool changesAt(int sample) const noexcept {
        for (int i = 0; i < numChanges; ++i)
            if (offsets[i] == sample) return true;
        return false;
    }
};

}  // namespace bleep::dsp
