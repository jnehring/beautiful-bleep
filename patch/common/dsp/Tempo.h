// SPDX-License-Identifier: MIT
// Tempo-sync helpers shared by the clocked modules.
#pragma once

#include <array>
#include <cmath>

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

}  // namespace bleep::dsp
