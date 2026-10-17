// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Output limiting shared by the utility modules (doc/specs/modules/attenuverter.md
// §4.3): off, a soft knee into ±1, or a hard clamp.
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::dsp {

enum ClipMode { ClipOff = 0, ClipSoft, ClipHard };

/// Linear up to ±0.8, then a smooth knee into ±1 (slope 1 at the knee).
inline float softClip(float x) noexcept {
    constexpr float k = 0.8f;
    const float a = std::fabs(x);
    if (a <= k) return x;
    return std::copysign(k + (1.0f - k) * std::tanh((a - k) / (1.0f - k)), x);
}

inline float clip(float x, int mode) noexcept {
    switch (mode) {
        case ClipSoft: return softClip(x);
        case ClipHard: return std::clamp(x, -1.0f, 1.0f);
        default: return x;
    }
}

}  // namespace bleep::dsp
