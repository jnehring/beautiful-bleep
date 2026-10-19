// SPDX-License-Identifier: GPL-3.0-or-later
// Crossfader gains (doc/specs/modules/crossfader.md §4).
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::patch {

enum CrossfadeCurve { CrossfadeEqualPower = 0, CrossfadeLinear };

/// Gains for A and B at fade position f (clamped to 0..1).
inline void crossfadeGains(float f, int curve, float& a, float& b) noexcept {
    f = std::clamp(f, 0.0f, 1.0f);
    if (curve == CrossfadeLinear) {
        a = 1.0f - f, b = f;
        return;
    }
    constexpr float halfPi = 1.57079632679489662f;
    a = std::cos(f * halfPi), b = std::sin(f * halfPi);
}

}  // namespace bleep::patch
