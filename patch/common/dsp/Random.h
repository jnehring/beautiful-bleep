// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Counter-based randomness: every value is a pure function of
// (seed, index, stream), so renders are reproducible and seekable.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

/// SplitMix64 finaliser: a good 64-bit mix of x.
constexpr uint64_t mix64(uint64_t x) noexcept {
    x += 0x9e3779b97f4a7c15ull;
    x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ull;
    x = (x ^ (x >> 27)) * 0x94d049bb133111ebull;
    return x ^ (x >> 31);
}

/// Hash of three values; `stream` separates independent uses of one seed.
constexpr uint64_t hash3(uint64_t seed, uint64_t index, uint64_t stream) noexcept {
    return mix64(mix64(mix64(seed) ^ index) ^ (stream * 0xd6e8feb86659fd93ull));
}

/// Uniform double in [0, 1).
constexpr double uniform01(uint64_t seed, uint64_t index, uint64_t stream) noexcept {
    return (double)(hash3(seed, index, stream) >> 11) * (1.0 / 9007199254740992.0);
}

// ---- Distributions -----------------------------------------------------------
// Everything below is also a pure function of its arguments.

/// Seeded standard normal (mean 0, variance 1), Box–Muller from one hash.
inline double standardNormal(uint64_t seed, uint64_t index, uint64_t stream) noexcept {
    const uint64_t h = hash3(seed, index, stream);
    const double u1 = (double)((mix64(h) >> 11) + 1) * (1.0 / 9007199254740992.0);  // (0, 1]
    const double u2 = (double)(mix64(h ^ 0x5851f42d4c957f2dull) >> 11) * (1.0 / 9007199254740992.0);
    return std::sqrt(-2.0 * std::log(u1)) * std::cos(6.283185307179586 * u2);
}

/// Standard normal CDF Φ(x).
inline double normalCdf(double x) noexcept { return 0.5 * std::erfc(-x * 0.7071067811865476); }

/// Inverse standard normal CDF Φ⁻¹(p), p clamped to [1e-300, 1 − 1e-16].
/// Acklam's rational approximation plus one Halley step (|error| < 1e-14).
inline double normalInv(double p) noexcept {
    p = std::clamp(p, 1e-300, 1.0 - 1e-16);
    static constexpr double a[6] = {-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
                                    1.383577518672690e+02,  -3.066479806614716e+01, 2.506628277459239e+00};
    static constexpr double b[5] = {-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
                                    6.680131188771972e+01,  -1.328068155288572e+01};
    static constexpr double c[6] = {-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
                                    -2.549732539343734e+00, 4.374664141464968e+00,  2.938163982698783e+00};
    static constexpr double d[4] = {7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
                                    3.754408661907416e+00};
    double x;
    if (p < 0.02425) {
        const double q = std::sqrt(-2.0 * std::log(p));
        x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
    } else if (p > 1.0 - 0.02425) {
        const double q = std::sqrt(-2.0 * std::log1p(-p));
        x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
    } else {
        const double q = p - 0.5, r = q * q;
        x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0);
    }
    // One Halley refinement step.
    const double e = normalCdf(x) - p;
    const double u = e * 2.5066282746310002 * std::exp(0.5 * x * x);
    return x - u / (1.0 + 0.5 * x * u);
}

/// Smooth-step 3u² − 2u³ on [0, 1] (pushes values toward the edges when
/// applied to a uniform).
inline double smoothstep01(double u) noexcept {
    u = std::clamp(u, 0.0, 1.0);
    return u * u * (3.0 - 2.0 * u);
}

/// Inverse of smoothstep01 (concentrates a uniform around the centre).
inline double inverseSmoothstep01(double y) noexcept {
    y = std::clamp(y, 0.0, 1.0);
    return 0.5 - std::sin(std::asin(1.0 - 2.0 * y) / 3.0);
}

/// Power skew of a unit value: u^γ with γ = 4^(−amount), amount −1..+1.
/// +1 crowds values toward 1, −1 toward 0, 0 leaves u unchanged.
/// (Recall's Bias b in 0..1 is amount = 2b − 1; Uncertainty's Distribution is amount.)
inline double skew01(double u, double amount) noexcept {
    return std::pow(std::clamp(u, 0.0, 1.0), std::pow(4.0, -std::clamp(amount, -1.0, 1.0)));
}

/// Spread + bias distribution (doc/specs/modules/recall.md 4.3, X section).
/// u0..u2 are raw uniforms in [0, 1); spread 0..1, bias 0..1 (0.5 neutral).
/// Returns −1..+1:
///   spread 0        → the centre (0, moved by bias);
///   0 … 0.5         → a bell (mean of three uniforms) of width 2·spread;
///   0.5 … 0.85      → the bell widens into a uniform distribution;
///   0.85 … 1        → values are pushed toward the edges (sign(w)·√|w|).
inline double spreadBias(double u0, double u1, double u2, double spread, double bias) noexcept {
    spread = std::clamp(spread, 0.0, 1.0);
    const double bell = (u0 + u1 + u2) * (2.0 / 3.0) - 1.0;
    const double flat = 2.0 * u0 - 1.0;
    double v;
    if (spread <= 0.5) {
        v = bell * 2.0 * spread;
    } else if (spread <= 0.85) {
        const double t = (spread - 0.5) / 0.35;
        v = bell + t * (flat - bell);
    } else {
        const double t = (spread - 0.85) / 0.15;
        const double edge = (flat < 0.0 ? -1.0 : 1.0) * std::sqrt(std::fabs(flat));
        v = flat + t * (edge - flat);
    }
    const double x = skew01(0.5 * (v + 1.0), 2.0 * std::clamp(bias, 0.0, 1.0) - 1.0);
    return 2.0 * x - 1.0;
}

// ---- Smooth noise -------------------------------------------------------------

/// Catmull-Rom spline through y0..y3, evaluated between y1 (t = 0) and y2 (t = 1).
inline double catmullRom(double y0, double y1, double y2, double y3, double t) noexcept {
    return y1 + 0.5 * t * (y2 - y0 + t * (2.0 * y0 - 5.0 * y1 + 4.0 * y2 - y3 + t * (3.0 * (y1 - y2) + y3 - y0)));
}

/// Value of the seeded random point `i` used by smoothNoise, in −1..+1.
inline double noisePoint(uint64_t seed, int64_t i, uint64_t stream) noexcept {
    return 2.0 * uniform01(seed, (uint64_t)i, stream) - 1.0;
}

/// Smooth value noise: a Catmull-Rom curve through seeded random points
/// placed at every integer `t` (point i = 2·uniform01(seed, i, stream) − 1).
/// A pure function of (seed, stream, t), so it is seekable; continuous with a
/// continuous slope, clamped to −1..+1. For a rate, pass t = seconds × hz.
inline double smoothNoise(uint64_t seed, uint64_t stream, double t) noexcept {
    const double fl = std::floor(t);
    const int64_t i = (int64_t)fl;
    const double v = catmullRom(noisePoint(seed, i - 1, stream), noisePoint(seed, i, stream),
                                noisePoint(seed, i + 1, stream), noisePoint(seed, i + 2, stream), t - fl);
    return std::clamp(v, -1.0, 1.0);
}

/// smoothNoise with points every 1 / rateHz seconds, at time `seconds`.
inline double smoothNoiseAt(uint64_t seed, uint64_t stream, double seconds, double rateHz) noexcept {
    return smoothNoise(seed, stream, seconds * rateHz);
}

}  // namespace bleep::dsp
