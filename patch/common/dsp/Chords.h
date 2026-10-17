// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Chords (doc/specs/modules/chord-oscillator.md §4.2–4.4, chord-quantizer.md
// §4.1–4.3, harmony-master.md §4.2/4.4), shared by every module that builds,
// voices or recognises chords:
//
//  - the chord table: qualities as intervals in stacking order (root, third,
//    fifth, seventh, extensions), entries 0…23 are Chord Osc's list;
//  - building a sounding chord: tone count (dropping / doubling), inversion,
//    voicing (Close, Drop 2, Drop 3, Drop 2+4, Open, Wide, Spread, Open Up);
//  - diatonic chords: stacks of scale steps on a degree (Scales.h masks);
//  - voice leading: the candidate closest to the previous voices;
//  - chord detection from held pitch classes.
//
// Pitches are integer semitones (from C4 when used as pitch: V/oct · 12).
// Header-only, no allocation, RT-safe.
#pragma once

#include "dsp/Scales.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>

namespace bleep::dsp {

constexpr int kMaxChordTones = 6;   ///< tones of the largest table entry
constexpr int kMaxChordVoices = 8;  ///< voices of a built chord (with doublings)

// ---- The chord table ---------------------------------------------------------

struct ChordQuality {
    const char* id;      ///< stable id for saved data ("major7")
    const char* label;   ///< menu / knob label ("Major 7")
    const char* suffix;  ///< shown after the root: "maj7" in "Cmaj7"
    uint8_t count;       ///< number of tones
    int8_t intervals[kMaxChordTones];  ///< semitones above the root, stacking order
};

/// Indices into chordQualities().
enum ChordId : int {
    ChordUnison = 0,
    ChordFifth,
    ChordMajor,
    ChordMinor,
    ChordDiminished,
    ChordAugmented,
    ChordSus2,
    ChordSus4,
    ChordMajor6,
    ChordMinor6,
    ChordDominant7,
    ChordMajor7,
    ChordMinor7,
    ChordHalfDiminished7,
    ChordDiminished7,
    ChordMinorMajor7,
    Chord7Sus4,
    ChordAdd9,
    ChordMinorAdd9,
    Chord6Add9,
    ChordMajor9,
    ChordMinor9,
    ChordDominant9,
    ChordQuartal,
    ChordDominant11,
    ChordMinor11,
    ChordDominant13,
    Chord7Flat9,
    Chord7Sharp9,
    ChordAugmented7,
    Chord7Flat5,
    ChordMajor7Sharp11,
    kNumChordQualities
};

/// Chord Osc's chord list is the first 24 entries (Unison … Quartal).
constexpr int kNumChordOscQualities = 24;

inline const std::array<ChordQuality, kNumChordQualities>& chordQualities() {
    static const std::array<ChordQuality, kNumChordQualities> table{{
        {"unison", "Unison", "", 1, {0}},
        {"fifth", "Fifth", "5", 2, {0, 7}},
        {"major", "Major", "", 3, {0, 4, 7}},
        {"minor", "Minor", "m", 3, {0, 3, 7}},
        {"diminished", "Diminished", "dim", 3, {0, 3, 6}},
        {"augmented", "Augmented", "aug", 3, {0, 4, 8}},
        {"sus2", "Sus2", "sus2", 3, {0, 2, 7}},
        {"sus4", "Sus4", "sus4", 3, {0, 5, 7}},
        {"major6", "Major 6", "6", 4, {0, 4, 7, 9}},
        {"minor6", "Minor 6", "m6", 4, {0, 3, 7, 9}},
        {"dominant7", "Dominant 7", "7", 4, {0, 4, 7, 10}},
        {"major7", "Major 7", "maj7", 4, {0, 4, 7, 11}},
        {"minor7", "Minor 7", "m7", 4, {0, 3, 7, 10}},
        {"half-diminished", "Half-diminished", "m7♭5", 4, {0, 3, 6, 10}},
        {"diminished7", "Diminished 7", "dim7", 4, {0, 3, 6, 9}},
        {"minor-major7", "Minor-major 7", "m(maj7)", 4, {0, 3, 7, 11}},
        {"7sus4", "7sus4", "7sus4", 4, {0, 5, 7, 10}},
        {"add9", "Add9", "add9", 4, {0, 4, 7, 14}},
        {"minor-add9", "Minor add9", "m(add9)", 4, {0, 3, 7, 14}},
        {"6-9", "6/9", "6/9", 5, {0, 4, 7, 9, 14}},
        {"major9", "Major 9", "maj9", 5, {0, 4, 7, 11, 14}},
        {"minor9", "Minor 9", "m9", 5, {0, 3, 7, 10, 14}},
        {"dominant9", "Dominant 9", "9", 5, {0, 4, 7, 10, 14}},
        {"quartal", "Quartal", "4ths", 4, {0, 5, 10, 15}},
        {"dominant11", "Dominant 11", "11", 6, {0, 4, 7, 10, 14, 17}},
        {"minor11", "Minor 11", "m11", 6, {0, 3, 7, 10, 14, 17}},
        {"dominant13", "Dominant 13", "13", 6, {0, 4, 7, 10, 14, 21}},
        {"7b9", "7♭9", "7♭9", 5, {0, 4, 7, 10, 13}},
        {"7#9", "7♯9", "7♯9", 5, {0, 4, 7, 10, 15}},
        {"augmented7", "Augmented 7", "aug7", 4, {0, 4, 8, 10}},
        {"7b5", "7♭5", "7♭5", 4, {0, 4, 6, 10}},
        {"major7#11", "Major 7♯11", "maj7♯11", 5, {0, 4, 7, 11, 18}},
    }};
    return table;
}

inline const ChordQuality& chordQuality(int id) noexcept {
    return chordQualities()[(size_t)std::clamp(id, 0, kNumChordQualities - 1)];
}

/// Index of a quality by id string, or -1.
inline int chordQualityIndex(const char* id) noexcept {
    for (int i = 0; i < kNumChordQualities; ++i) {
        const char *a = chordQualities()[(size_t)i].id, *b = id;
        while (*a != 0 && *a == *b) ++a, ++b;
        if (*a == 0 && *b == 0) return i;
    }
    return -1;
}

/// 12-bit pitch-class mask of intervals (bit k: k semitones above the root, mod 12).
inline uint16_t intervalMask(const int* intervals, int count) noexcept {
    uint16_t m = 0;
    for (int i = 0; i < count; ++i) m = (uint16_t)(m | (1u << (((intervals[i] % 12) + 12) % 12)));
    return m;
}
inline uint16_t chordMask(int id) noexcept {
    const auto& q = chordQuality(id);
    uint16_t m = 0;
    for (int i = 0; i < q.count; ++i) m = (uint16_t)(m | (1u << (q.intervals[i] % 12)));
    return m;
}
/// Copies a quality's intervals; returns the count.
inline int chordIntervals(int id, int* out) noexcept {
    const auto& q = chordQuality(id);
    for (int i = 0; i < q.count; ++i) out[i] = q.intervals[i];
    return q.count;
}

inline int popcount12(uint16_t m) noexcept {
    int n = 0;
    for (int k = 0; k < 12; ++k) n += (m >> k) & 1;
    return n;
}
/// Rotates a 12-bit mask by `semitones` (bit k → bit k + semitones mod 12).
inline uint16_t rotateMask(uint16_t m, int semitones) noexcept {
    const int s = ((semitones % 12) + 12) % 12;
    m &= 0xfff;
    return (uint16_t)(((m << s) | (m >> (12 - s))) & 0xfff);
}

/// The table entry whose pitch-class set is exactly `mask` (relative to the
/// root), lowest index first; -1 if none.
inline int findChordQuality(uint16_t mask) noexcept {
    for (int i = 0; i < kNumChordQualities; ++i)
        if (chordMask(i) == (mask & 0xfff)) return i;
    return -1;
}

// ---- Names -------------------------------------------------------------------

/// "C", "C♯", … "B" (UTF-8).
inline const char* pitchClassName(int pc) noexcept {
    static const char* const names[12] = {"C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"};
    return names[((pc % 12) + 12) % 12];
}

/// Writes the chord's name, e.g. "Dm7", "E/G♯" (bass < 0 or == root: no slash;
/// quality < 0: the root and "?"). Returns `out`.
inline char* chordName(int root, int quality, int bass, char* out, size_t size) noexcept {
    const char* suffix = quality >= 0 && quality < kNumChordQualities ? chordQualities()[(size_t)quality].suffix : "?";
    const int r = ((root % 12) + 12) % 12;
    if (bass >= 0 && ((bass % 12) + 12) % 12 != r)
        std::snprintf(out, size, "%s%s/%s", pitchClassName(r), suffix, pitchClassName(bass));
    else
        std::snprintf(out, size, "%s%s", pitchClassName(r), suffix);
    return out;
}

// ---- Building a chord ----------------------------------------------------------

/// A tone's function, from its interval and stacking position.
enum ToneRole : uint8_t { RoleRoot, RoleThird, RoleFifth, RoleSeventh, RoleExtension };

/// The role of `intervals[index]`: index 0 is the root; ≥ 12 an extension;
/// 2–5 a third (sus tones count as thirds), 6–8 a fifth, 9–11 a seventh (a
/// sixth counts as seventh).
inline ToneRole toneRole(const int* intervals, int index) noexcept {
    if (index == 0) return RoleRoot;
    const int v = intervals[index];
    if (v >= 12) return RoleExtension;
    if (v >= 9) return RoleSeventh;
    if (v >= 6) return RoleFifth;
    if (v >= 1) return RoleThird;
    return RoleRoot;  // a unison doubling
}

/// A built chord. Voices stay in their order (stacking order, then the
/// doublings), so a voice keeps "its" tone across chords; use sorted() for
/// low-to-high.
struct ChordVoicing {
    int count = 0;
    int pitch[kMaxChordVoices]{};    ///< semitones
    uint8_t role[kMaxChordVoices]{}; ///< ToneRole
    uint8_t tone[kMaxChordVoices]{}; ///< index into the chord's intervals

    /// Pitches low to high into `out` (count entries); returns count.
    int sorted(int* out) const noexcept {
        for (int i = 0; i < count; ++i) out[i] = pitch[i];
        std::sort(out, out + count);
        return count;
    }
    int lowest() const noexcept {
        int m = pitch[0];
        for (int i = 1; i < count; ++i) m = std::min(m, pitch[i]);
        return m;
    }
    int highest() const noexcept {
        int m = pitch[0];
        for (int i = 1; i < count; ++i) m = std::max(m, pitch[i]);
        return m;
    }
    void transpose(int semitones) noexcept {
        for (int i = 0; i < count; ++i) pitch[i] += semitones;
    }
};

/// Voice indices of `v` sorted low to high (ties keep voice order).
inline void voiceOrder(const ChordVoicing& v, int* idx) noexcept {
    for (int i = 0; i < v.count; ++i) idx[i] = i;
    std::stable_sort(idx, idx + v.count, [&](int a, int b) { return v.pitch[a] < v.pitch[b]; });
}

/// Step 1 (Chord Osc 4.3): `voices` tones of the chord on `root` (≤ 0: as
/// many as the chord has). Fewer voices drop tones in the order fifth,
/// extension (lowest first), seventh, third; the root stays. More voices
/// double tones an octave up: root, fifth, third, seventh, extensions, then
/// two octaves up, and so on.
inline ChordVoicing selectTones(int root, const int* intervals, int count, int voices) noexcept {
    ChordVoicing v;
    count = std::clamp(count, 1, kMaxChordTones);
    if (voices <= 0) voices = count;
    voices = std::min(voices, kMaxChordVoices);
    bool keep[kMaxChordTones];
    for (int i = 0; i < count; ++i) keep[i] = true;
    int n = count;
    static constexpr ToneRole dropOrder[4] = {RoleFifth, RoleExtension, RoleSeventh, RoleThird};
    while (n > voices) {
        int drop = -1;
        for (ToneRole r : dropOrder) {
            for (int i = 1; i < count; ++i)
                if (keep[i] && toneRole(intervals, i) == r && (drop < 0 || intervals[i] < intervals[drop])) drop = i;
            if (drop >= 0) break;
        }
        if (drop < 0) break;
        keep[drop] = false;
        --n;
    }
    for (int i = 0; i < count; ++i)
        if (keep[i]) {
            v.pitch[v.count] = root + intervals[i];
            v.role[v.count] = (uint8_t)toneRole(intervals, i);
            v.tone[v.count] = (uint8_t)i;
            ++v.count;
        }
    // Doubling order: root, fifth, third, seventh, extensions (stacking order inside a role).
    int order[kMaxChordTones], m = 0;
    static constexpr ToneRole doubleOrder[5] = {RoleRoot, RoleFifth, RoleThird, RoleSeventh, RoleExtension};
    for (ToneRole r : doubleOrder)
        for (int i = 0; i < count; ++i)
            if (toneRole(intervals, i) == r) order[m++] = i;
    for (int octave = 1; v.count < voices; ++octave)
        for (int k = 0; k < m && v.count < voices; ++k) {
            const int i = order[k];
            v.pitch[v.count] = root + intervals[i] + 12 * octave;
            v.role[v.count] = (uint8_t)toneRole(intervals, i);
            v.tone[v.count] = (uint8_t)i;
            ++v.count;
        }
    return v;
}

/// Step 2: inversion i > 0 moves the lowest voice up an octave, i times;
/// i < 0 moves the highest voice down an octave, |i| times.
inline void invertChord(ChordVoicing& v, int inversion) noexcept {
    if (v.count <= 0) return;
    for (int k = 0; k < inversion; ++k) {
        int lo = 0;
        for (int i = 1; i < v.count; ++i)
            if (v.pitch[i] < v.pitch[lo]) lo = i;
        v.pitch[lo] += 12;
    }
    for (int k = 0; k < -inversion; ++k) {
        int hi = v.count - 1;
        for (int i = v.count - 2; i >= 0; --i)
            if (v.pitch[i] > v.pitch[hi]) hi = i;
        v.pitch[hi] -= 12;
    }
}

enum Voicing : int {
    VoicingClose = 0,  ///< unchanged
    VoicingDrop2,      ///< the 2nd from the top down an octave (≥ 3 voices)
    VoicingDrop3,      ///< the 3rd from the top down an octave (≥ 4 voices)
    VoicingDrop24,     ///< the 2nd and 4th from the top down an octave (≥ 4 voices)
    VoicingOpen,       ///< Chord Osc: the bass down an octave (≥ 2 voices)
    VoicingWide,       ///< octaves −1, 0, +1, −1, … from the bottom (≥ 3 voices)
    VoicingSpread,     ///< Chord Quantizer: bass down an octave, the rest root–fifth–third–seventh upwards, ≥ a fourth apart (≥ 3 voices)
    VoicingOpenUp,     ///< Chord Quantizer "Open": the 2nd, 4th, … from the bottom up an octave (≥ 3 voices)
    kNumVoicings
};

inline const char* voicingName(int v) noexcept {
    static const char* const names[kNumVoicings] = {"Close", "Drop 2", "Drop 3", "Drop 2+4", "Open", "Wide", "Spread", "Open Up"};
    return names[std::clamp(v, 0, kNumVoicings - 1)];
}

/// Voices a voicing needs; with fewer it falls back to Close.
inline int voicingMinVoices(int voicing) noexcept {
    switch (voicing) {
        case VoicingDrop2: case VoicingWide: case VoicingSpread: case VoicingOpenUp: return 3;
        case VoicingDrop3: case VoicingDrop24: return 4;
        case VoicingOpen: return 2;
        default: return 1;
    }
}

/// Step 3: applies `voicing` to the (inverted) close chord. Returns false
/// (and leaves the chord Close) when it needs more voices than there are.
inline bool applyVoicing(ChordVoicing& v, int voicing) noexcept {
    const int n = v.count;
    if (voicing == VoicingClose) return true;
    if (voicing < 0 || voicing >= kNumVoicings || n < voicingMinVoices(voicing)) return false;
    int idx[kMaxChordVoices];
    voiceOrder(v, idx);
    switch (voicing) {
        case VoicingDrop2: v.pitch[idx[n - 2]] -= 12; break;
        case VoicingDrop3: v.pitch[idx[n - 3]] -= 12; break;
        case VoicingDrop24:
            v.pitch[idx[n - 2]] -= 12;
            v.pitch[idx[n - 4]] -= 12;
            break;
        case VoicingOpen: v.pitch[idx[0]] -= 12; break;
        case VoicingWide:
            for (int k = 0; k < n; ++k) v.pitch[idx[k]] += 12 * (k % 3 - 1);
            break;
        case VoicingOpenUp:
            for (int k = 1; k < n; k += 2) v.pitch[idx[k]] += 12;
            break;
        case VoicingSpread: {
            const int bass = idx[0];
            v.pitch[bass] -= 12;
            int prev = v.pitch[bass];
            static constexpr ToneRole order[5] = {RoleRoot, RoleFifth, RoleThird, RoleSeventh, RoleExtension};
            for (ToneRole r : order)
                for (int i = 0; i < n; ++i) {  // voice order = stacking order inside a role
                    if (i == bass || v.role[i] != r) continue;
                    const int pc = ((v.pitch[i] % 12) + 12) % 12;
                    int p = prev + 5;  // at least a fourth above the voice below
                    p += ((pc - p) % 12 + 12) % 12;
                    v.pitch[i] = p;
                    prev = p;
                }
            break;
        }
        default: break;
    }
    return true;
}

/// Steps 1–3: the chord on `root` (semitones) with `voices` voices (≤ 0: the
/// chord's tone count), `inversion` and `voicing`.
inline ChordVoicing buildChord(int root, const int* intervals, int count, int voices, int inversion,
                               int voicing = VoicingClose) noexcept {
    ChordVoicing v = selectTones(root, intervals, count, voices);
    invertChord(v, inversion);
    applyVoicing(v, voicing);
    return v;
}
inline ChordVoicing buildChord(int root, int quality, int voices, int inversion, int voicing = VoicingClose) noexcept {
    int iv[kMaxChordTones];
    const int n = chordIntervals(quality, iv);
    return buildChord(root, iv, n, voices, inversion, voicing);
}

/// Which pitch of a chord is kept near a target (Chord Quantizer Anchor).
enum ChordAnchor : int { AnchorBass = 0, AnchorCentre, AnchorTop };

inline float anchorPitch(const ChordVoicing& v, int anchor) noexcept {
    if (v.count <= 0) return 0.0f;
    if (anchor == AnchorBass) return (float)v.lowest();
    if (anchor == AnchorTop) return (float)v.highest();
    float s = 0.0f;
    for (int i = 0; i < v.count; ++i) s += (float)v.pitch[i];
    return s / (float)v.count;
}
/// The whole-octave shift (semitones) that brings the anchor closest to `target` (ties: down).
inline int octaveShiftTo(const ChordVoicing& v, int anchor, float target) noexcept {
    return 12 * (int)std::ceil((target - anchorPitch(v, anchor)) / 12.0f - 0.5f);
}
/// Shifts the chord by octaves until all voices lie in [lo, hi] where
/// possible (the lowest wins when the chord is wider than the range).
inline void foldIntoRange(ChordVoicing& v, int lo, int hi) noexcept {
    if (v.count <= 0) return;
    while (v.highest() > hi && v.lowest() - 12 >= lo) v.transpose(-12);
    while (v.lowest() < lo) v.transpose(12);
}

// ---- Voice leading -------------------------------------------------------------

struct VoiceLeadOptions {
    bool keepTop = false;        ///< Smooth + Top: the top voice moves as little as possible
    float unisonPenalty = 3.0f;  ///< per pair of voices on the same pitch
    float topWeight = 4.0f;      ///< × |top movement| with keepTop
    bool useTarget = false;      ///< keep the anchor near `target`
    int anchor = AnchorCentre;
    float target = 0.0f;         ///< semitones
    float targetWeight = 2.0f / 12.0f;  ///< × |anchor − target|
};

/// Cost of moving from `prev` (sorted low to high) to `cand`:
/// Σ |cᵢ − prevᵢ| over the voices sorted (extra voices: distance to the
/// nearest previous voice) + unisonPenalty · unisons
/// [+ topWeight · |top − prev top|] [+ targetWeight · |anchor − target|].
inline float voiceLeadCost(const int* prev, int prevCount, const ChordVoicing& cand, const VoiceLeadOptions& o) noexcept {
    int c[kMaxChordVoices];
    const int n = cand.sorted(c);
    float cost = 0.0f;
    for (int i = 0; i < n; ++i) {
        if (i < prevCount) {
            cost += (float)std::abs(c[i] - prev[i]);
        } else if (prevCount > 0) {
            int d = std::abs(c[i] - prev[0]);
            for (int k = 1; k < prevCount; ++k) d = std::min(d, std::abs(c[i] - prev[k]));
            cost += (float)d;
        }
    }
    int unisons = 0;
    for (int i = 0; i < n; ++i)
        for (int k = i + 1; k < n; ++k) unisons += c[i] == c[k];
    cost += o.unisonPenalty * (float)unisons;
    if (o.keepTop && n > 0 && prevCount > 0) cost += o.topWeight * (float)std::abs(c[n - 1] - prev[prevCount - 1]);
    if (o.useTarget) cost += o.targetWeight * std::fabs(anchorPitch(cand, o.anchor) - o.target);
    return cost;
}

/// The candidate with the lowest cost; ties go to the lower candidate (lower
/// bass, then the earlier one). `prev` sorted low to high. -1 if none.
inline int leadVoices(const int* prev, int prevCount, const ChordVoicing* candidates, int count,
                      const VoiceLeadOptions& o = {}) noexcept {
    int best = -1;
    float bestCost = 0.0f;
    for (int i = 0; i < count; ++i) {
        const float c = voiceLeadCost(prev, prevCount, candidates[i], o);
        if (best < 0 || c < bestCost - 1e-4f ||
            (c <= bestCost + 1e-4f && candidates[i].lowest() < candidates[best].lowest())) {
            best = i;
            bestCost = c;
        }
    }
    return best;
}

/// Voice leading over a chord (Chord Quantizer 4.3): candidates are every
/// inversion (0 … voices − 1) of `voicing`, each shifted by octaves to keep
/// the anchor within ±1 octave of the target (or, without a target, of the
/// previous chord's centre); the cheapest by voiceLeadCost wins. `prev`
/// sorted low to high; prevCount 0 gives the root-position chord.
inline ChordVoicing leadChord(const int* prev, int prevCount, int root, const int* intervals, int count, int voices,
                              int voicing, const VoiceLeadOptions& o = {}) noexcept {
    const ChordVoicing base = selectTones(root, intervals, count, voices);
    if (prevCount <= 0) {
        ChordVoicing v = base;
        applyVoicing(v, voicing);
        return v;
    }
    float centre = 0.0f;
    for (int i = 0; i < prevCount; ++i) centre += (float)prev[i];
    centre /= (float)prevCount;
    const int anchor = o.useTarget ? o.anchor : (int)AnchorCentre;
    const float target = o.useTarget ? o.target : centre;
    ChordVoicing cand[kMaxChordVoices * 3];
    int n = 0;
    for (int inv = 0; inv < base.count; ++inv) {
        ChordVoicing v = base;
        invertChord(v, inv);
        applyVoicing(v, voicing);
        const int s0 = octaveShiftTo(v, anchor, target);
        for (int s = s0 - 12; s <= s0 + 12; s += 12) {
            ChordVoicing w = v;
            w.transpose(s);
            if (std::fabs(anchorPitch(w, anchor) - target) <= 12.0f) cand[n++] = w;
        }
    }
    const int best = leadVoices(prev, prevCount, cand, n, o);
    return best >= 0 ? cand[best] : base;
}

// ---- Scale steps and diatonic chords ---------------------------------------------

/// Notes per octave of a scale mask (0 counts as chromatic, as quantize()).
inline int scaleSize(uint16_t mask) noexcept {
    const int n = popcount12(mask & 0xfff);
    return n > 0 ? n : 12;
}
/// The scale note at `index` (any integer; wraps with octaves), in semitones
/// above the key: index 0 is the key root, scaleSize() is an octave up.
inline int scaleNote(uint16_t mask, int index) noexcept {
    if ((mask & 0xfff) == 0) mask = 0xfff;
    const int size = scaleSize(mask);
    const int oct = (int)std::floor((double)index / size);
    int k = index - oct * size;
    for (int pc = 0; pc < 12; ++pc)
        if ((mask >> pc) & 1u) {
            if (k == 0) return pc + 12 * oct;
            --k;
        }
    return 12 * oct;
}
/// The scale index of `semitone` (above the key) if it is a scale note;
/// otherwise of the nearest scale note below it.
inline int scaleIndexOf(uint16_t mask, int semitone) noexcept {
    if ((mask & 0xfff) == 0) mask = 0xfff;
    int s = semitone;
    while (!inScale(mask, s)) --s;
    const int oct = (int)std::floor((double)s / 12.0);
    const int pc = s - 12 * oct;
    int k = 0;
    for (int i = 0; i < pc; ++i) k += (mask >> i) & 1;
    return k + oct * scaleSize(mask);
}
/// The scale degree (1…size) of a pitch class relative to the key, 0 if not in the scale.
inline int scaleDegree(uint16_t mask, int semitone) noexcept {
    if ((mask & 0xfff) == 0) mask = 0xfff;
    const int pc = ((semitone % 12) + 12) % 12;
    if (!((mask >> pc) & 1u)) return 0;
    int k = 1;
    for (int i = 0; i < pc; ++i) k += (mask >> i) & 1;
    return k;
}

/// Stacks of scale steps above a degree (Chord Osc 4.4 / Chord Quantizer 4.1).
enum ScaleStack : int {
    StackSingle = 0,
    StackFifth,
    StackTriad,
    StackSus2,
    StackSus4,
    StackSixth,
    StackSeventh,
    StackAdd9,
    StackNinth,
    StackQuartal,
    kNumScaleStacks
};

struct ScaleStackDef {
    const char* name;
    uint8_t count;
    int8_t steps[5];   ///< scale steps above the degree
    int8_t chromatic;  ///< the table quality used on the Chromatic scale (chromaticAsMajor)
};

inline const std::array<ScaleStackDef, kNumScaleStacks>& scaleStacks() {
    static const std::array<ScaleStackDef, kNumScaleStacks> s{{
        {"Single", 1, {0}, ChordUnison},
        {"Fifth", 2, {0, 4}, ChordFifth},
        {"Triad", 3, {0, 2, 4}, ChordMajor},
        {"Sus2", 3, {0, 1, 4}, ChordSus2},
        {"Sus4", 3, {0, 3, 4}, ChordSus4},
        {"Sixth", 4, {0, 2, 4, 5}, ChordMajor6},
        {"Seventh", 4, {0, 2, 4, 6}, ChordDominant7},
        {"Add9", 4, {0, 2, 4, 8}, ChordAdd9},
        {"Ninth", 5, {0, 2, 4, 6, 8}, ChordDominant9},
        {"Quartal", 4, {0, 3, 6, 9}, ChordQuartal},
    }};
    return s;
}

/// A chord built from a scale.
struct ScaleChord {
    int root = 0;     ///< semitones above the key (≥ 12 for degrees past the octave)
    int count = 0;
    int intervals[kMaxChordTones]{};  ///< semitones above `root`, stacking order
    int quality = -1;  ///< exact table match (findChordQuality), or -1
};

/// The chord stacked from scale steps `steps` above the 0-based scale index
/// `degree` (wrapping with octaves). With `chromaticAsMajor` and a Chromatic
/// scale, `fallbackQuality` (≥ 0) is used instead of a cluster.
inline ScaleChord scaleChord(uint16_t scaleMask, int degree, const int* steps, int count, bool chromaticAsMajor = false,
                             int fallbackQuality = -1) noexcept {
    ScaleChord c;
    c.root = scaleNote(scaleMask, degree);
    if (chromaticAsMajor && (scaleMask & 0xfff) == 0xfff && fallbackQuality >= 0) {
        c.count = chordIntervals(fallbackQuality, c.intervals);
        c.quality = fallbackQuality;
        return c;
    }
    c.count = std::clamp(count, 0, kMaxChordTones);
    for (int i = 0; i < c.count; ++i) c.intervals[i] = scaleNote(scaleMask, degree + steps[i]) - c.root;
    c.quality = findChordQuality(intervalMask(c.intervals, c.count));
    return c;
}
inline ScaleChord scaleChord(uint16_t scaleMask, int degree, int stack, bool chromaticAsMajor = false) noexcept {
    const auto& s = scaleStacks()[(size_t)std::clamp(stack, 0, kNumScaleStacks - 1)];
    int steps[5];
    for (int i = 0; i < s.count; ++i) steps[i] = s.steps[i];
    return scaleChord(scaleMask, degree, steps, s.count, chromaticAsMajor, s.chromatic);
}
/// Diatonic triad / seventh on the 0-based `degree` (Harmony Master: the
/// Chromatic scale gives Major / Dominant 7).
inline ScaleChord diatonicTriad(uint16_t scaleMask, int degree) noexcept {
    return scaleChord(scaleMask, degree, StackTriad, true);
}
inline ScaleChord diatonicSeventh(uint16_t scaleMask, int degree) noexcept {
    return scaleChord(scaleMask, degree, StackSeventh, true);
}

// ---- Chord detection (Harmony Master 4.4) -----------------------------------------

struct DetectedChord {
    bool valid = false;
    int root = 0;      ///< pitch class
    int quality = -1;  ///< table index
    int bass = 0;      ///< pitch class of the lowest held note
    int score = 0;     ///< × 100
};

/// score × 100 of root `r` and quality `q` for held pitch classes `held`:
/// 2·|H ∩ T| − |T \ H| − 1.5·|H \ T| + 0.5·[r = bass] − 0.01·|T|.
inline int chordScore(uint16_t held, int bassPc, int root, int quality) noexcept {
    const uint16_t t = rotateMask(chordMask(quality), root);
    held &= 0xfff;
    return 200 * popcount12((uint16_t)(held & t)) - 100 * popcount12((uint16_t)(t & ~held & 0xfff)) -
           150 * popcount12((uint16_t)(held & ~t & 0xfff)) + (root == bassPc ? 50 : 0) -
           (int)chordQuality(quality).count;
}

/// The best (root, quality) for the held pitch classes; every table entry
/// except Unison and Quartal competes. Ties: the root in the scale (`scale`
/// relative to `key`), then the lower table index, then the lower root. One
/// held note gives Unison. `bassPc`: pitch class of the lowest held note.
inline DetectedChord detectChord(uint16_t held, int bassPc, uint16_t scale = 0xfff, int key = 0) noexcept {
    DetectedChord d;
    held &= 0xfff;
    bassPc = ((bassPc % 12) + 12) % 12;
    d.bass = bassPc;
    const int n = popcount12(held);
    if (n == 0) return d;
    d.valid = true;
    if (n == 1) {
        for (int pc = 0; pc < 12; ++pc)
            if ((held >> pc) & 1u) d.root = pc;
        d.quality = ChordUnison;
        d.score = chordScore(held, bassPc, d.root, ChordUnison);
        return d;
    }
    bool bestInScale = false;
    for (int q = 0; q < kNumChordQualities; ++q) {
        if (q == ChordUnison || q == ChordQuartal) continue;
        for (int r = 0; r < 12; ++r) {
            const int s = chordScore(held, bassPc, r, q);
            const bool in = inScale(scale, r - key);
            if (d.quality < 0 || s > d.score || (s == d.score && in && !bestInScale)) {
                d.root = r;
                d.quality = q;
                d.score = s;
                bestInScale = in;
            }
        }
    }
    return d;
}

/// detectChord for MIDI note numbers (the lowest is the bass).
inline DetectedChord detectChordFromNotes(const int* notes, int count, uint16_t scale = 0xfff, int key = 0) noexcept {
    uint16_t held = 0;
    int lowest = 0;
    for (int i = 0; i < count; ++i) {
        held = (uint16_t)(held | (1u << (((notes[i] % 12) + 12) % 12)));
        if (i == 0 || notes[i] < lowest) lowest = notes[i];
    }
    return detectChord(held, lowest, scale, key);
}

}  // namespace bleep::dsp
