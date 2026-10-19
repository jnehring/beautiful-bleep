// SPDX-License-Identifier: GPL-3.0-or-later
// Multiplier core (doc/specs/modules/multiplier.md §4): two four-quadrant
// multipliers, the second chained from the first, optionally oversampled.
// Both sections run at the same (over)sampling rate, so the chain adds no
// extra latency.
#pragma once

#include <initializer_list>

#include "dsp/Oversampler.h"

namespace bleep::patch {

struct MultiplierSection {
    float biasX = 0.0f, biasY = 0.0f, gain = 1.0f;
};

struct MultiplierInputs {
    float x1 = 0.0f, y1 = 1.0f, x2 = 0.0f, y2 = 1.0f;
    bool x2Patched = false;  ///< unpatched: X2 takes Out 1 (spec §4.2)
};

class MultiplierDsp {
public:
    void reset() noexcept {
        for (auto* u : {&ux1_, &uy1_, &ux2_, &uy2_}) u->reset();
        d1_.reset(), d2_.reset();
    }

    /// factor: 1, 2 or 4.
    void tick(const MultiplierInputs& in, const MultiplierSection& s1, const MultiplierSection& s2, int factor,
              float& out1, float& out2) noexcept {
        if (factor != 2 && factor != 4) {
            out1 = (in.x1 + s1.biasX) * (in.y1 + s1.biasY) * s1.gain;
            const float x2 = in.x2Patched ? in.x2 : out1;
            out2 = (x2 + s2.biasX) * (in.y2 + s2.biasY) * s2.gain;
            return;
        }
        float x1[4], y1[4], x2[4], y2[4], p1[4], p2[4];
        ux1_.process(in.x1, factor, x1);
        uy1_.process(in.y1, factor, y1);
        ux2_.process(in.x2, factor, x2);
        uy2_.process(in.y2, factor, y2);
        for (int k = 0; k < factor; ++k) {
            p1[k] = (x1[k] + s1.biasX) * (y1[k] + s1.biasY) * s1.gain;
            const float x = in.x2Patched ? x2[k] : p1[k];
            p2[k] = (x + s2.biasX) * (y2[k] + s2.biasY) * s2.gain;
        }
        out1 = d1_.process(p1, factor);
        out2 = d2_.process(p2, factor);
    }

private:
    dsp::Upsampler ux1_, uy1_, ux2_, uy2_;
    dsp::Downsampler d1_, d2_;
};

}  // namespace bleep::patch
