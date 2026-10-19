// SPDX-License-Identifier: GPL-3.0-or-later
// Math core: one binary operation on two signals, safe for any input.
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::patch {

enum class MathOp { Add, Subtract, Multiply, Divide, Power, Min, Max };

constexpr float kMathLimit = 1000.0f;  ///< outputs are clamped to ±this

/// a op b. Never returns NaN or inf: divide keeps the sign of B and treats |B| < 1e-6 as 1e-6;
/// power is sign(a) · |a|^b (0 for a = 0); the result is clamped to ±kMathLimit.
inline float mathApply(MathOp op, float a, float b) noexcept {
    float r = 0.0f;
    switch (op) {
        case MathOp::Add: r = a + b; break;
        case MathOp::Subtract: r = a - b; break;
        case MathOp::Multiply: r = a * b; break;
        case MathOp::Divide: {
            const float d = std::fabs(b) < 1e-6f ? (std::signbit(b) ? -1e-6f : 1e-6f) : b;
            r = a / d;
            break;
        }
        case MathOp::Power: {
            const float m = std::fabs(a);
            // b == 2 and b == 0.5 are common and cheap; the rest goes through powf
            r = m == 0.0f ? 0.0f : (b == 2.0f ? m * m : b == 0.5f ? std::sqrt(m) : std::pow(m, b));
            if (a < 0.0f) r = -r;
            break;
        }
        case MathOp::Min: r = std::min(a, b); break;
        case MathOp::Max: r = std::max(a, b); break;
    }
    if (!(r == r)) return 0.0f;  // NaN
    return std::clamp(r, -kMathLimit, kMathLimit);
}

}  // namespace bleep::patch
