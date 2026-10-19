// SPDX-License-Identifier: GPL-3.0-or-later
// Quantizer core (doc/specs/modules/quantizer.md §4): range, transpose, optional
// clocked sample and hold, scale quantizing with hysteresis, shift and glide.
#pragma once

#include "dsp/Scales.h"
#include "dsp/Smoothing.h"

#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum QuantizeRounding { RoundNearest = 0, RoundDown, RoundUp };

/// Index of the Custom scale in the Scale setting (after the shared scales).
constexpr int kQuantizerCustomScale = 17;

struct QuantizerParams {
    float range = 1.0f;       ///< octaves per unit of In
    float hysteresis = 0.1f;  ///< fraction of a semitone, 0..0.5
    float glide = 0.0f;       ///< seconds
    int root = 0;             ///< 0..11
    uint16_t mask = 0xfff;
    int rounding = RoundNearest;
};

struct QuantizerInputs {
    float in = 0.0f, clock = 0.0f, transpose = 0.0f, shift = 0.0f;
    bool clockPatched = false;
};

struct QuantizerFrame {
    float out = 0.0f, trigger = 0.0f, gate = 1.0f;
};

class QuantizerDsp {
public:
    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        gapSamples_ = (int)std::lround(sampleRate * 0.001);
    }
    void reset() noexcept {
        clock_.reset();
        held_ = 0.0f;
        note_ = 0;
        hasNote_ = false;
        gap_ = 0;
        glide_.reset(0.0f);
        first_ = true;
    }

    static int round(float semis, uint16_t mask, int rounding) noexcept {
        switch (rounding) {
            case RoundDown: return dsp::quantizeDown(semis, mask);
            case RoundUp: return dsp::quantizeUp(semis, mask);
            default: return dsp::quantize(semis, mask);
        }
    }

    void tick(const QuantizerInputs& in, const QuantizerParams& p, QuantizerFrame& f) noexcept {
        const float v = in.in * p.range + in.transpose;
        if (!in.clockPatched) held_ = v;
        else if (clock_.process(in.clock) > 0 || first_) held_ = v;
        first_ = false;

        // Semitones relative to the root; the stored note is absolute (from C4).
        const float semis = held_ * 12.0f - (float)p.root;
        int note = round(semis, p.mask, p.rounding) + p.root;
        if (hasNote_ && note != note_ && p.hysteresis > 0.0f) {
            // Pull the input back towards the current note: change only if
            // it still lands elsewhere (spec §4.2).
            const float pull = note_ > note ? p.hysteresis : -p.hysteresis;
            const int pulled = round(semis + pull, p.mask, p.rounding) + p.root;
            note = pulled == note_ ? note_ : pulled;
        }
        f.trigger = 0.0f;
        if (!hasNote_ || note != note_) {
            if (hasNote_) {
                f.trigger = 1.0f;
                gap_ = gapSamples_;
            }
            note_ = note;
            if (!hasNote_) glide_.reset((float)note / 12.0f);
            hasNote_ = true;
        }
        f.gate = gap_ > 0 ? 0.0f : 1.0f;
        if (gap_ > 0) --gap_;
        f.out = glide_.process((float)note_ / 12.0f, p.glide, sampleRate_) + in.shift;
    }

    int note() const noexcept { return note_; }

private:
    double sampleRate_ = 48000.0;
    int gapSamples_ = 48;
    dsp::GateEdge clock_;
    dsp::OnePole glide_;
    float held_ = 0.0f;
    int note_ = 0, gap_ = 0;
    bool hasNote_ = false, first_ = true;
};

}  // namespace bleep::patch
