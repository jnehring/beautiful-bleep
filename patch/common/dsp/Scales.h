// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Scales and quantizing (doc/specs/modules/step-sequencer.md §4.3), shared by
// every module that snaps pitches to a scale.
#pragma once

#include <array>
#include <cmath>
#include <cstdint>
#include <initializer_list>
#include <cstdlib>
#include <string>
#include <vector>

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


// ---- microtonal tunings ----------------------------------------------------------------------

/// A tuning: up to kMaxDegrees notes per period, as cents above the root (ascending, the first
/// is 0), repeating every `period` cents. Equal divisions of the octave and scale files (the
/// widely used .scl text format: cents lines with a dot, ratio lines with a slash) both load
/// into it. Plain data, so it can be handed to the audio thread; building it is for the
/// message thread (parse allocates strings).
struct Tuning {
    static constexpr int kMaxDegrees = 128;
    int count = 12;
    float period = 1200.0f;
    std::array<float, kMaxDegrees> cents{};

    /// `divisions` equal steps of the octave (clamped to 1..kMaxDegrees).
    static Tuning edo(int divisions) {
        Tuning t;
        t.count = divisions < 1 ? 1 : divisions > kMaxDegrees ? kMaxDegrees : divisions;
        for (int i = 0; i < t.count; ++i) t.cents[(size_t)i] = 1200.0f * (float)i / (float)t.count;
        return t;
    }

    /// Reads scale-file text: "!" comment lines are skipped, then a description line, the number
    /// of notes N, and N lines that each start with a pitch, either cents (contains a ".") or a
    /// ratio ("3/2" or a whole number); what follows on the line is ignored. The last pitch is the
    /// period (normally 2/1), the others are the degrees above the root 1/1. False with `error`
    /// set when the text is not a usable scale.
    static bool parse(const std::string& text, Tuning& out, std::string* error = nullptr) {
        auto fail = [&](const char* why) {
            if (error) *error = why;
            return false;
        };
        std::vector<std::string> lines;
        size_t pos = 0;
        while (pos <= text.size()) {
            size_t end = text.find('\n', pos);
            if (end == std::string::npos) end = text.size();
            std::string l = text.substr(pos, end - pos);
            while (!l.empty() && (l.back() == '\r' || l.back() == ' ' || l.back() == '\t')) l.pop_back();
            if (l.empty() || l[0] != '!') lines.push_back(l);
            pos = end + 1;
        }
        if (lines.size() < 2) return fail("no note count");
        char* rest = nullptr;
        const long n = std::strtol(lines[1].c_str(), &rest, 10);
        if (rest == lines[1].c_str() || n < 1 || n > kMaxDegrees) return fail("note count must be 1 to 128");
        if ((long)lines.size() < 2 + n) return fail("fewer pitch lines than the note count");
        Tuning t;
        t.count = (int)n;
        double prev = 0.0;
        for (long i = 0; i < n; ++i) {
            std::string l = lines[(size_t)(2 + i)];
            size_t a = l.find_first_not_of(" \t");
            if (a == std::string::npos) return fail("empty pitch line");
            l = l.substr(a);
            size_t b = l.find_first_of(" \t");
            const std::string tok = l.substr(0, b);
            double c = 0.0;
            if (tok.find('.') != std::string::npos) {
                char* e = nullptr;
                c = std::strtod(tok.c_str(), &e);
                if (e == tok.c_str()) return fail("bad cents value");
            } else {
                char* e = nullptr;
                const double num = std::strtod(tok.c_str(), &e);
                double den = 1.0;
                if (e == tok.c_str()) return fail("bad ratio");
                if (*e == '/') {
                    char* e2 = nullptr;
                    den = std::strtod(e + 1, &e2);
                    if (e2 == e + 1) return fail("bad ratio");
                }
                if (!(num > 0.0) || !(den > 0.0)) return fail("a ratio must be positive");
                c = 1200.0 * std::log2(num / den);
            }
            if (!(c > prev) || c > 12000.0) return fail("pitches must rise, and stay under 10 octaves");
            prev = c;
            if (i == n - 1) t.period = (float)c;
            else t.cents[(size_t)i + 1] = (float)c;
        }
        out = t;
        return true;
    }

    /// The step index (any integer, 0 = the root) nearest to `octaves` above the root;
    /// rounding 0 nearest (ties go down), 1 down, 2 up, like the 12-note quantizers.
    int index(float octaves, int rounding = 0) const noexcept {
        const double c = (double)octaves * 1200.0, P = (double)period;
        const double k = std::floor(c / P);
        const double r = c - k * P;
        int i = 0;
        while (i + 1 < count && (double)cents[(size_t)i + 1] <= r + 1e-4) ++i;
        const double below = r - (double)cents[(size_t)i];
        const double next = i + 1 < count ? (double)cents[(size_t)i + 1] : P;
        int step = i;
        if (rounding == 2) step = below < 1e-3 ? i : i + 1;
        else if (rounding == 0) step = below <= next - r ? i : i + 1;
        return (int)k * count + step;
    }

    /// Pitch of step `index` in octaves above the root.
    float pitch(int index) const noexcept {
        int k = index / count, i = index % count;
        if (i < 0) { i += count; --k; }
        return ((float)k * period + cents[(size_t)i]) / 1200.0f;
    }

    /// Average step size in cents, for scaling hysteresis.
    float meanStep() const noexcept { return period / (float)count; }
};

}  // namespace bleep::dsp
