// SPDX-License-Identifier: MIT
// Scales and quantizing (doc/specs/modules/step-sequencer.md §4.3), shared by
// every module that snaps pitches to a scale.
#pragma once

#include <array>
#include <cmath>
#include <cstdint>
#include <initializer_list>

namespace bleep::dsp {

struct Scale {
    const char* name;
    uint16_t mask;  ///< bit k set: k semitones above the root belong to the scale
};

constexpr uint16_t scaleMask(std::initializer_list<int> intervals) {
    uint16_t m = 0;
    for (int i : intervals) m = (uint16_t)(m | (1u << i));
    return m;
}

inline const std::array<Scale, 17>& scales() {
    static const std::array<Scale, 17> list{{
        {"Chromatic", 0xfff},
        {"Major", scaleMask({0, 2, 4, 5, 7, 9, 11})},
        {"Natural Minor", scaleMask({0, 2, 3, 5, 7, 8, 10})},
        {"Harmonic Minor", scaleMask({0, 2, 3, 5, 7, 8, 11})},
        {"Melodic Minor", scaleMask({0, 2, 3, 5, 7, 9, 11})},
        {"Dorian", scaleMask({0, 2, 3, 5, 7, 9, 10})},
        {"Phrygian", scaleMask({0, 1, 3, 5, 7, 8, 10})},
        {"Lydian", scaleMask({0, 2, 4, 6, 7, 9, 11})},
        {"Mixolydian", scaleMask({0, 2, 4, 5, 7, 9, 10})},
        {"Locrian", scaleMask({0, 1, 3, 5, 6, 8, 10})},
        {"Phrygian Dominant", scaleMask({0, 1, 4, 5, 7, 8, 10})},
        {"Major Pentatonic", scaleMask({0, 2, 4, 7, 9})},
        {"Minor Pentatonic", scaleMask({0, 3, 5, 7, 10})},
        {"Blues", scaleMask({0, 3, 5, 6, 7, 10})},
        {"Whole Tone", scaleMask({0, 2, 4, 6, 8, 10})},
        {"Diminished", scaleMask({0, 2, 3, 5, 6, 8, 9, 11})},
        {"Hirajoshi", scaleMask({0, 2, 3, 7, 8})},
    }};
    return list;
}

inline bool inScale(uint16_t mask, int semitone) noexcept { return (mask >> (((semitone % 12) + 12) % 12)) & 1u; }

/// The nearest scale note to `semitones` (relative to the root); ties go down.
inline int quantize(float semitones, uint16_t mask) noexcept {
    if ((mask & 0xfff) == 0) mask = 0xfff;
    int lo = (int)std::floor(semitones), hi = (int)std::ceil(semitones);
    while (!inScale(mask, lo)) --lo;
    while (!inScale(mask, hi)) ++hi;
    return semitones - (float)lo <= (float)hi - semitones ? lo : hi;
}

/// The highest scale note at or below `semitones`.
inline int quantizeDown(float semitones, uint16_t mask) noexcept {
    if ((mask & 0xfff) == 0) mask = 0xfff;
    int lo = (int)std::floor(semitones);
    while (!inScale(mask, lo)) --lo;
    return lo;
}

/// The lowest scale note at or above `semitones`.
inline int quantizeUp(float semitones, uint16_t mask) noexcept {
    if ((mask & 0xfff) == 0) mask = 0xfff;
    int hi = (int)std::ceil(semitones);
    while (!inScale(mask, hi)) ++hi;
    return hi;
}

}  // namespace bleep::dsp
