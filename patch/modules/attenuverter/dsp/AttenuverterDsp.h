// SPDX-License-Identifier: MIT
// Attenuverter core (specs/modules/attenuverter.md): four rows of
// In × Scale + Offset, a sum, and optional clipping.
#pragma once

#include "dsp/Clip.h"

namespace bleep::patch {

constexpr int kAttenuverterRows = 4;

struct AttenuverterFrame {
    float out[kAttenuverterRows] = {};
    float sum = 0.0f;
};

/// `in[r]` is the row's input; pass 1 for an unpatched row (spec §4.2).
inline void attenuverterTick(const float* in, const float* scale, const float* offset, int clipMode,
                             AttenuverterFrame& f) noexcept {
    float sum = 0.0f;
    for (int r = 0; r < kAttenuverterRows; ++r) {
        f.out[r] = dsp::clip(in[r] * scale[r] + offset[r], clipMode);
        sum += f.out[r];
    }
    f.sum = dsp::clip(sum, clipMode);
}

}  // namespace bleep::patch
