// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Multi-stage wavefolder (doc/specs/modules/wavefolder.md 4.1–4.4), also used by
// the Dual Osc (a fixed 4-stage fold), the Macro Osc's Fold model and the Meta
// Mod's Fold algorithm (one soft stage).
//
// The fold curve F blends a soft fold sin(π/2·x) with a hard fold (reflection
// at ±1, again and again: a triangle of period 4). Both map into ±1, so any
// number of stages stays bounded. Each stage uses first-order antiderivative
// anti-aliasing (ADAA): y = (G(u) − G(u₋₁)) / (u − u₋₁) with G the integral
// of F, which strongly reduces aliasing at the cost of half a sample of delay
// per stage. Run it oversampled for clean results:
//
//     dsp::Upsampler up;  dsp::Downsampler down;     // Oversampler.h
//     dsp::Folder folder; dsp::fold::DcBlocker dc;   // dc.prepare(sampleRate)
//     float buf[4];
//     up.process(level * x, 4, buf);                 // 4× (or 2×)
//     for (float& s : buf) s = folder.process(s, params);
//     const float y = dc.process(down.process(buf, 4));
//
// The Oversampler's FIR stages delay by 47 samples each at their own rate
// (2×: ≈ 47 base samples in total, 4×: ≈ 70); ADAA adds stages / 2 samples at
// the oversampled rate. Delay any dry path by the same amount.
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::dsp {

namespace fold {

constexpr double kPi = 3.14159265358979323846;

/// Hard fold: 1 − |((x + 1) mod 4) − 2| (the identity for |x| ≤ 1).
inline double hard(double x) noexcept {
    const double m = x + 1.0 - 4.0 * std::floor((x + 1.0) * 0.25);
    return 1.0 - std::fabs(m - 2.0);
}
/// Antiderivative of hard(): piecewise quadratic, periodic in 4 (hard has no mean).
inline double hardIntegral(double x) noexcept {
    const double m = x + 1.0 - 4.0 * std::floor((x + 1.0) * 0.25);
    return m <= 2.0 ? 0.5 * m * m - m : 3.0 * m - 0.5 * m * m - 4.0;
}
/// sin(π/2 · x) and cos(π/2 · x) without libm: x is reduced to the nearest
/// quarter period, then Taylor polynomials on |a| ≤ π/4 (error < 1e-14,
/// enough for ADAA's differences of G). Several times cheaper than std::sin.
inline void sinCosHalfPi(double x, double& s, double& c) noexcept {
    const double q = std::floor(x + 0.5);  // nearest quarter period
    const double a = 0.5 * kPi * (x - q);  // |a| ≤ π/4
    const double a2 = a * a;
    const double sa = a * (1.0 + a2 * (-1.0 / 6 + a2 * (1.0 / 120 + a2 * (-1.0 / 5040 + a2 * (1.0 / 362880 +
                                 a2 * (-1.0 / 39916800 + a2 * (1.0 / 6227020800.0)))))));
    const double ca = 1.0 + a2 * (-0.5 + a2 * (1.0 / 24 + a2 * (-1.0 / 720 + a2 * (1.0 / 40320 +
                            a2 * (-1.0 / 3628800 + a2 * (1.0 / 479001600.0 + a2 * (-1.0 / 87178291200.0)))))));
    switch (((long long)q % 4 + 4) % 4) {
        case 0: s = sa, c = ca; break;
        case 1: s = ca, c = -sa; break;
        case 2: s = -sa, c = -ca; break;
        default: s = -ca, c = sa; break;
    }
}

/// Soft fold sin(π/2 · x) and its antiderivative.
inline double soft(double x) noexcept {
    double s, c;
    sinCosHalfPi(x, s, c);
    return s;
}
inline double softIntegral(double x) noexcept {
    double s, c;
    sinCosHalfPi(x, s, c);
    return -(2.0 / kPi) * c;
}

/// The fold curve: shape 0 soft … 1 hard.
inline double curve(double x, double shape) noexcept {
    if (shape <= 0.0) return soft(x);
    if (shape >= 1.0) return hard(x);
    return (1.0 - shape) * soft(x) + shape * hard(x);
}
inline double curveIntegral(double x, double shape) noexcept {
    if (shape <= 0.0) return softIntegral(x);
    if (shape >= 1.0) return hardIntegral(x);
    return (1.0 - shape) * softIntegral(x) + shape * hardIntegral(x);
}

/// One fold with first-order ADAA. Falls back to F at the midpoint when the
/// input barely moves (|Δu| < 1e-5, where the quotient is ill-conditioned).
class Stage {
public:
    void reset() noexcept { valid_ = false; }
    double process(double u, double shape, bool adaa = true) noexcept {
        if (!adaa || !valid_) {
            valid_ = adaa;
            x1_ = u;
            shape1_ = shape;
            if (adaa) g1_ = curveIntegral(u, shape);
            return curve(u, shape);
        }
        if (shape < shape1_ || shape > shape1_) {  // G depends on the shape
            g1_ = curveIntegral(x1_, shape);
            shape1_ = shape;
        }
        const double d = u - x1_;
        const double g = curveIntegral(u, shape);
        const double y = std::fabs(d) < 1e-5 ? curve(0.5 * (u + x1_), shape) : (g - g1_) / d;
        x1_ = u;
        g1_ = g;
        return y;
    }

private:
    double x1_ = 0.0, g1_ = 0.0, shape1_ = 0.0;
    bool valid_ = false;
};

/// 5 Hz one-pole DC blocker (Symmetry adds DC).
class DcBlocker {
public:
    void prepare(double sampleRate, double hz = 5.0) noexcept { r_ = (float)std::exp(-2.0 * kPi * hz / sampleRate); }
    void reset() noexcept { x1_ = y1_ = 0.0f; }
    float process(float x) noexcept {
        const float y = x - x1_ + r_ * y1_;
        x1_ = x;
        y1_ = y;
        return y;
    }

private:
    float r_ = 0.99935f, x1_ = 0.0f, y1_ = 0.0f;
};

}  // namespace fold

/// Up to six cascaded fold stages with a tap crossfade:
///   y₀ = input + symmetry
///   y₁ = F(g·y₀)
///   y₂ = F(g·y₁ + symmetry / 2)
///   yₖ = F(g·yₖ₋₁),  k = 3 … 6
/// Output: (1 − φ)·y⌊tap⌋ + φ·y⌈tap⌉. Stages above ⌈tap⌉ are not computed.
class Folder {
public:
    static constexpr int kMaxStages = 6;

    struct Params {
        float gain = 1.0f;         ///< per-stage drive g ≥ 0 (Wavefolder: 4^Fold, 1…4)
        float symmetry = 0.0f;     ///< bias before stage 1 (and half before stage 2), ±1
        float shape = 0.5f;        ///< 0 soft (sine) … 1 hard (triangle reflection)
        float firstShape = -1.0f;  ///< stage 1's shape; < 0 = `shape` (Dual Osc: 0, soft first)
        float tap = 6.0f;          ///< 1…6, fractional crossfades neighbouring stages
        bool adaa = true;          ///< antiderivative anti-aliasing (off = naive fold)
    };

    void reset() noexcept {
        for (auto& s : stages_) s.reset();
        for (double& y : y_) y = 0.0;
    }

    float process(float x, const Params& p) noexcept {
        const float tap = std::clamp(p.tap, 1.0f, (float)kMaxStages);
        const int lo = (int)tap;
        const float frac = tap - (float)lo;
        const int n = frac > 0.0f ? std::min(lo + 1, kMaxStages) : lo;
        const double g = std::max(p.gain, 0.0f), sym = std::clamp(p.symmetry, -1.0f, 1.0f);
        const double shape = std::clamp(p.shape, 0.0f, 1.0f);
        const double first = p.firstShape < 0.0f ? shape : std::min((double)p.firstShape, 1.0);
        y_[0] = (double)x + sym;
        for (int k = 1; k <= n; ++k) {
            const double u = g * y_[k - 1] + (k == 2 ? 0.5 * sym : 0.0);
            y_[k] = stages_[k - 1].process(u, k == 1 ? first : shape, p.adaa);
        }
        for (int k = n + 1; k <= kMaxStages; ++k) {  // restart cleanly when re-enabled
            stages_[k - 1].reset();
            y_[k] = 0.0;
        }
        const double y = frac > 0.0f ? y_[lo] + (double)frac * (y_[lo + 1] - y_[lo]) : y_[lo];
        return (float)y;
    }

    /// Output of stage k (1…6) at the last sample (0 if not computed).
    float stage(int k) const noexcept { return k >= 0 && k <= kMaxStages ? (float)y_[k] : 0.0f; }

    /// The static transfer curve of the chain up to `tap` (no ADAA), for views.
    static float transfer(float x, const Params& p) noexcept {
        const float tap = std::clamp(p.tap, 1.0f, (float)kMaxStages);
        const int lo = (int)tap;
        const float frac = tap - (float)lo;
        const int n = frac > 0.0f ? std::min(lo + 1, kMaxStages) : lo;
        const double g = std::max(p.gain, 0.0f), sym = std::clamp(p.symmetry, -1.0f, 1.0f);
        const double shape = std::clamp(p.shape, 0.0f, 1.0f);
        const double first = p.firstShape < 0.0f ? shape : std::min((double)p.firstShape, 1.0);
        double y[kMaxStages + 1];
        y[0] = (double)x + sym;
        for (int k = 1; k <= n; ++k) y[k] = fold::curve(g * y[k - 1] + (k == 2 ? 0.5 * sym : 0.0), k == 1 ? first : shape);
        return (float)(frac > 0.0f ? y[lo] + (double)frac * (y[lo + 1] - y[lo]) : y[lo]);
    }

private:
    fold::Stage stages_[kMaxStages];
    double y_[kMaxStages + 1] = {};
};

}  // namespace bleep::dsp
