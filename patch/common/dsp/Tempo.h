// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Tempo-sync helpers shared by the clocked modules.
#pragma once

#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

/// Sync choices offered by Function and Random. Index 0 means "free".
inline const std::array<const char*, 10>& syncNames() {
    static const std::array<const char*, 10> names{"Free", "1/32", "1/16", "1/8", "1/4", "1/2", "1 bar", "2 bars", "4 bars", "8 bars"};
    return names;
}

/// Length of a sync choice in quarter notes (0 for "Free"), 4/4 assumed.
inline double syncBeats(int index) noexcept {
    static constexpr double beats[10] = {0.0, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0};
    return index >= 0 && index < 10 ? beats[index] : 0.0;
}

/// Fractional part in [0, 1), also for negative inputs.
inline double wrap01(double x) noexcept { return x - std::floor(x); }

// ---- Note values ----------------------------------------------------------
// The shared rate list for sequencers and synced modules: straight, dotted
// and triplet values from 1/64 to 16 bars, longest first, grouped per note
// value as dotted, straight, triplet like the Step Sequencer's list (so a
// triplet can be shorter than the next dotted value; 4/4 assumed, as
// syncBeats). Modules offer a subset by name (noteValueIndex) or use
// sequencerRates(), the Step Sequencer's list.

enum class NoteFeel : uint8_t { Straight, Dotted, Triplet };

struct NoteValue {
    const char* name;  ///< "1/16", "1/8.", "1/4T", "2 bars"
    double beats;      ///< length in quarter notes
    NoteFeel feel;
};

constexpr int kNumNoteValues = 25;

/// All note values (order: see above).
inline const std::array<NoteValue, kNumNoteValues>& noteValues() {
    static const std::array<NoteValue, kNumNoteValues> list{{
        {"16 bars", 64.0, NoteFeel::Straight},
        {"8 bars", 32.0, NoteFeel::Straight},
        {"4 bars", 16.0, NoteFeel::Straight},
        {"2 bars", 8.0, NoteFeel::Straight},
        {"1/1.", 6.0, NoteFeel::Dotted},
        {"1/1", 4.0, NoteFeel::Straight},
        {"1/1T", 8.0 / 3.0, NoteFeel::Triplet},
        {"1/2.", 3.0, NoteFeel::Dotted},
        {"1/2", 2.0, NoteFeel::Straight},
        {"1/2T", 4.0 / 3.0, NoteFeel::Triplet},
        {"1/4.", 1.5, NoteFeel::Dotted},
        {"1/4", 1.0, NoteFeel::Straight},
        {"1/4T", 2.0 / 3.0, NoteFeel::Triplet},
        {"1/8.", 0.75, NoteFeel::Dotted},
        {"1/8", 0.5, NoteFeel::Straight},
        {"1/8T", 1.0 / 3.0, NoteFeel::Triplet},
        {"1/16.", 0.375, NoteFeel::Dotted},
        {"1/16", 0.25, NoteFeel::Straight},
        {"1/16T", 1.0 / 6.0, NoteFeel::Triplet},
        {"1/32.", 0.1875, NoteFeel::Dotted},
        {"1/32", 0.125, NoteFeel::Straight},
        {"1/32T", 1.0 / 12.0, NoteFeel::Triplet},
        {"1/64.", 0.09375, NoteFeel::Dotted},
        {"1/64", 0.0625, NoteFeel::Straight},
        {"1/64T", 1.0 / 24.0, NoteFeel::Triplet},
    }};
    return list;
}

/// Index into noteValues() by name, or -1.
inline int noteValueIndex(const char* name) noexcept {
    const auto& v = noteValues();
    for (int i = 0; i < kNumNoteValues; ++i) {
        const char *a = v[(size_t)i].name, *b = name;
        while (*a != 0 && *a == *b) ++a, ++b;
        if (*a == 0 && *b == 0) return i;
    }
    return -1;
}

/// Length of noteValues()[index] in quarter notes (index clamped).
inline double noteValueBeats(int index) noexcept {
    return noteValues()[(size_t)(index < 0 ? 0 : index >= kNumNoteValues ? kNumNoteValues - 1 : index)].beats;
}

/// The Step Sequencer's Rate list (1/1 … 1/32T, 14 entries) shared by the
/// sequencers, as indices into noteValues().
constexpr int kNumSequencerRates = 14;
inline const std::array<int, kNumSequencerRates>& sequencerRates() {
    static const std::array<int, kNumSequencerRates> r{5, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21};
    return r;
}
inline const NoteValue& sequencerRate(int rate) noexcept {
    const int i = rate < 0 ? 0 : rate >= kNumSequencerRates ? kNumSequencerRates - 1 : rate;
    return noteValues()[(size_t)sequencerRates()[(size_t)i]];
}
/// A sequencer rate's step length in quarter notes (rate clamped).
inline double sequencerRateBeats(int rate) noexcept { return sequencerRate(rate).beats; }

/// Seconds and samples for a length in quarter notes (bpm floored at 1).
inline double beatsToSeconds(double beats, double bpm) noexcept { return beats * 60.0 / (bpm > 1.0 ? bpm : 1.0); }
inline double beatsToSamples(double beats, double bpm, double sampleRate) noexcept {
    return beatsToSeconds(beats, bpm) * sampleRate;
}
/// Bars (4/4) to quarter notes.
constexpr double barsToBeats(double bars) noexcept { return bars * 4.0; }

}  // namespace bleep::dsp
