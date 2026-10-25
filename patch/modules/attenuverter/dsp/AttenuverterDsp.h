// SPDX-License-Identifier: GPL-3.0-only
// Attenuverter core (doc/specs/modules/attenuverter.md): In × Scale + Offset,
// with optional clipping.
#pragma once

#include "dsp/Clip.h"

namespace bleep::patch {

/// `in` is the input; pass 1 for an unpatched input (spec §4.2).
inline float attenuverterTick(float in, float scale, float offset, int clipMode) noexcept {
    return dsp::clip(in * scale + offset, clipMode);
}

}  // namespace bleep::patch
