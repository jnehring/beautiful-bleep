// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Shape library (doc/specs/modules/shape-envelope.md 4.1): 96 factory envelope and
// LFO shapes in 12 families of 8, generated from formulas in a fixed order
// (the index is a stable id saved in boards: never reorder, only append), each
// sampled into a 256-point table. Plus user shapes from point lists, Morph,
// Skew and Reverse helpers. Tables are read with linear (or cubic)
// interpolation at phase × 255.
#pragma once

#include "Random.h"
#include "Waves.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

enum class ShapeKind {
    Envelope,  ///< starts and ends at 0, unipolar
    Cycle      ///< ends where it starts, so it loops without a jump
};

/// One sampled shape: 256 values over phase 0..1 (point 255 is phase 1).
struct ShapeTable {
    static constexpr int kPoints = 256;
    std::array<float, kPoints> v{};

    /// Linear interpolation at phase × 255 (phase clamped to 0..1).
    float at(double phase) const noexcept {
        const double x = std::clamp(phase, 0.0, 1.0) * (kPoints - 1);
        const int i = std::min((int)x, kPoints - 2);
        const float t = (float)(x - (double)i);
        return v[(size_t)i] + t * (v[(size_t)i + 1] - v[(size_t)i]);
    }

    /// Catmull-Rom interpolation. `wrap` treats the table as a loop (point 255
    /// equals point 0, as in cycle shapes); otherwise the ends are held.
    float cubic(double phase, bool wrap) const noexcept {
        const double x = std::clamp(phase, 0.0, 1.0) * (kPoints - 1);
        const int i = std::min((int)x, kPoints - 2);
        const double t = x - (double)i;
        auto get = [&](int k) {
            if (wrap) k = ((k % (kPoints - 1)) + (kPoints - 1)) % (kPoints - 1);
            else k = std::clamp(k, 0, kPoints - 1);
            return (double)v[(size_t)k];
        };
        return (float)catmullRom(get(i - 1), get(i), get(i + 1), get(i + 2), t);
    }

    /// Order-sensitive checksum of the values rounded to 1e-4 (pins the
    /// library in tests without depending on the last bits of libm).
    uint32_t checksum() const noexcept {
        uint32_t h = 2166136261u;
        for (float x : v) {
            const int32_t q = (int32_t)std::lround((double)x * 10000.0);
            for (int b = 0; b < 4; ++b) {
                h ^= (uint32_t)((q >> (8 * b)) & 0xff);
                h *= 16777619u;
            }
        }
        return h;
    }
};

/// Linear blend between two tables at one phase: Morph 0 = a, 1 = b.
inline float morphTables(const ShapeTable& a, const ShapeTable& b, float morph, double phase) noexcept {
    const float x = a.at(phase);
    return x + std::clamp(morph, 0.0f, 1.0f) * (b.at(phase) - x);
}

/// Time warp before the lookup: phase^(2^(−skew)), skew −1..+1. At +1 the
/// first half of the shape takes a quarter of the time; at −1 about 71 %.
inline double skewPhase(double phase, float skew) noexcept {
    return std::pow(std::clamp(phase, 0.0, 1.0), std::exp2(-(double)std::clamp(skew, -1.0f, 1.0f)));
}
/// Reverse playback: reads the table from the end (also mirror sustain points).
inline double reversePhase(double phase) noexcept { return 1.0 - phase; }

// ---- Point lists (user shapes and many factory shapes) -------------------------

/// A breakpoint. `curve` (−1..+1) bends the segment to the next point, as
/// Function's curve: 0 linear, + exponential (a rise starts slowly, a fall
/// drops fast then slows), − logarithmic (the mirror). Points are sorted by x.
struct ShapePoint {
    float x = 0.0f, y = 0.0f, curve = 0.0f;
};

/// Function's curve: u^(1+3c) for c ≥ 0, 1 − (1−u)^(1−3c) for c < 0.
inline double pointCurve(double u, double c) noexcept {
    u = std::clamp(u, 0.0, 1.0);
    if (c >= 0.0) return std::pow(u, 1.0 + 3.0 * c);
    return 1.0 - std::pow(1.0 - u, 1.0 - 3.0 * c);
}

/// Value of a point list at x (held flat before the first and after the last point).
inline float evaluatePoints(const ShapePoint* pts, int n, double x) noexcept {
    if (n <= 0) return 0.0f;
    if (x <= (double)pts[0].x) return pts[0].y;
    for (int i = 0; i + 1 < n; ++i) {
        const ShapePoint& a = pts[i];
        const ShapePoint& b = pts[i + 1];
        if (x <= (double)b.x) {
            const double w = (double)b.x - (double)a.x;
            if (w <= 0.0) return b.y;
            const double u = (x - (double)a.x) / w;
            if (b.y >= a.y) return (float)((double)a.y + ((double)b.y - a.y) * pointCurve(u, a.curve));
            return (float)((double)b.y + ((double)a.y - b.y) * pointCurve(1.0 - u, a.curve));
        }
    }
    return pts[n - 1].y;
}

/// Samples a point list into a table.
inline void renderPoints(const ShapePoint* pts, int n, ShapeTable& out) noexcept {
    for (int i = 0; i < ShapeTable::kPoints; ++i)
        out.v[(size_t)i] = evaluatePoints(pts, n, (double)i / (ShapeTable::kPoints - 1));
}

/// Resamples n evenly spaced values (e.g. the 64 saved points of a drawn
/// shape) to a table with a monotone cubic (Fritsch–Carlson): no overshoot.
inline void resampleMonotone(const float* values, int n, ShapeTable& out) noexcept {
    if (n <= 0) {
        out.v.fill(0.0f);
        return;
    }
    if (n == 1) {
        out.v.fill(values[0]);
        return;
    }
    auto slope = [&](int k) {  // tangent at point k
        const double d0 = k > 0 ? (double)values[k] - values[k - 1] : (double)values[1] - values[0];
        const double d1 = k < n - 1 ? (double)values[k + 1] - values[k] : (double)values[n - 1] - values[n - 2];
        if (d0 * d1 <= 0.0) return 0.0;
        return 2.0 / (1.0 / d0 + 1.0 / d1);  // harmonic mean keeps it monotone
    };
    for (int i = 0; i < ShapeTable::kPoints; ++i) {
        const double x = (double)i / (ShapeTable::kPoints - 1) * (n - 1);
        const int k = std::min((int)x, n - 2);
        const double t = x - k, t2 = t * t, t3 = t2 * t;
        const double y0 = values[k], y1 = values[k + 1];
        const double m0 = slope(k), m1 = slope(k + 1);
        out.v[(size_t)i] = (float)((2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 +
                                   (t3 - t2) * m1);
    }
}

// ---- Factory library ---------------------------------------------------------

struct ShapeInfo {
    const char* name;
    int family;
    ShapeKind kind;
    bool bipolar;
    float sustain;  ///< sustain phase for Gated mode (just before the release starts), or −1 for none
    bool hasSustain() const noexcept { return sustain >= 0.0f; }
};

namespace shapes_detail {

constexpr double kPi = 3.14159265358979323846;

inline double expDecay(double u, double k) noexcept {  // 1 → 0 over u 0..1, exactly 0 at 1
    if (u >= 1.0) return 0.0;
    return (std::exp(-k * u) - std::exp(-k)) / (1.0 - std::exp(-k));
}
inline double smooth(double u) noexcept { return smoothstep01(u); }
inline double cosRise(double u) noexcept { return 0.5 - 0.5 * std::cos(kPi * std::clamp(u, 0.0, 1.0)); }
inline double sinN(double x, double n) noexcept { return std::sin(2.0 * kPi * n * x); }

/// Attack over `a`, then decay(u) over the rest.
template <typename Decay>
double attackDecay(double x, double a, Decay decay) noexcept {
    return x < a ? x / a : decay((x - a) / (1.0 - a));
}

/// Hits at times t[i] with amplitudes amp[i]; each decays (exp k) to 0 by the next hit.
inline double hits(double x, const double* t, const double* amp, int n, double k) noexcept {
    for (int i = n - 1; i >= 0; --i)
        if (x >= t[i]) {
            const double end = i + 1 < n ? t[i + 1] : 1.0;
            return amp[i] * expDecay((x - t[i]) / (end - t[i]), k);
        }
    return 0.0;
}
/// n hits with gaps shrinking by `ratio` each time and amplitudes × `fall`.
inline double bounces(double x, int n, double ratio, double fall, double k) noexcept {
    double t[16], amp[16], sum = 0.0;
    for (int i = 0; i < n; ++i) sum += std::pow(ratio, i);
    double at = 0.0;
    for (int i = 0; i < n; ++i) {
        t[i] = at;
        amp[i] = std::pow(fall, i);
        at += std::pow(ratio, i) / sum;
    }
    return hits(x, t, amp, n, k);
}

/// Stairs: n levels, each 1/n long, with ramps of width w; starts and ends at 0.
inline double stairs(double x, const double* level, int n) noexcept {
    constexpr double w = 0.01;
    ShapePoint p[2 * 16 + 2];
    int m = 0;
    p[m++] = {0.0f, 0.0f, 0.0f};
    for (int i = 0; i < n; ++i) {
        p[m++] = {(float)((double)i / n + w), (float)level[i], 0.0f};
        p[m++] = {(float)((double)(i + 1) / n - (i == n - 1 ? w : 0.0)), (float)level[i], 0.0f};
    }
    p[m++] = {1.0f, 0.0f, 0.0f};
    return evaluatePoints(p, m, x);
}

/// Rhythmic gate pattern ('x' on, '.' off), each gate 60 % of its sub-step,
/// with soft edges (2 % of a sub-step, at least one table step).
inline double gates(double x, const char* pattern) noexcept {
    int n = 0;
    while (pattern[n]) ++n;
    const double len = 1.0 / n;
    const double w = std::max(0.02 * len, 1.0 / (ShapeTable::kPoints - 1));
    const int j = std::min((int)(x * n), n - 1);
    if (pattern[j] != 'x') return 0.0;
    const double t = x - j * len, on = 0.6 * len;
    if (t < w) return t / w;
    if (t < on - w) return 1.0;
    if (t < on) return (on - t) / w;
    return 0.0;
}

/// Skewed triangle 0 → 1 (at r) → 0.
inline double skewTri(double x, double r) noexcept { return x < r ? x / r : 1.0 - (x - r) / (1.0 - r); }

inline double damped(double u, double cycles, double decay) noexcept {
    return std::exp(-decay * u) * std::sin(2.0 * kPi * cycles * u);
}
inline double bump(double x, double centre, double width) noexcept {
    const double d = (x - centre) / width;
    return std::exp(-d * d);
}

/// Periodic smooth noise through k seeded points per cycle.
inline double texture(double x, uint64_t seed, int k) noexcept {
    const double t = x * k;
    const int i = std::min((int)std::floor(t), k - 1);
    auto pt = [&](int j) { return noisePoint(seed, (int64_t)(((j % k) + k) % k), 0x7e47); };
    return catmullRom(pt(i - 1), pt(i), pt(i + 1), pt(i + 2), t - i);
}

inline double pluck(double x, double ratio, bool soft) noexcept {
    // The peak lands on a table point, so the table reaches exactly 1.
    const double a = std::round(255.0 / (1.0 + ratio)) / 255.0;
    if (!soft) return attackDecay(x, a, [](double u) { return expDecay(u, 6.0); });
    if (x < a) return cosRise(x / a);
    const double u = (x - a) / (1.0 - a), k = 5.0;  // starts with zero slope: a rounded knee
    return (std::exp(-k * std::pow(u, 1.5)) - std::exp(-k)) / (1.0 - std::exp(-k));
}

/// Raw (un-normalised) value of factory shape `index` at x in 0..1.
inline double formula(int index, double x) noexcept {
    const int f = index / 8, s = index % 8;
    const double a1 = 1.0 / (ShapeTable::kPoints - 1);  // one-table-step attack
    switch (f) {
        case 0: {  // Decays
            switch (s) {
                case 0: return attackDecay(x, a1, [](double u) { return expDecay(u, 60.0); });
                case 1: return attackDecay(x, a1, [](double u) { return expDecay(u, 25.0); });
                case 2: return attackDecay(x, a1, [](double u) { return expDecay(u, 10.0); });
                case 3: return attackDecay(x, a1, [](double u) { return expDecay(u, 4.0); });
                case 4: return attackDecay(x, a1, [](double u) { return 1.0 - u; });
                case 5: return attackDecay(x, a1, [](double u) { return 1.0 - u * u; });
                case 6:
                    return attackDecay(x, a1, [](double u) { return (1.0 - std::exp(6.0 * (u - 1.0))) / (1.0 - std::exp(-6.0)); });
                default: return attackDecay(x, a1, [](double u) { return 0.6 * expDecay(u, 30.0) + 0.4 * expDecay(u, 3.0); });
            }
        }
        case 1: {  // Plucks: attack/decay 1:20, 1:8, 1:4, 1:2, each soft then hard
            static constexpr double ratios[4] = {20.0, 8.0, 4.0, 2.0};
            return pluck(x, ratios[s / 2], s % 2 == 0);
        }
        case 2: {  // Swells
            switch (s) {
                case 0: return x < 0.9 ? (x / 0.9) * (x / 0.9) : 1.0 - (x - 0.9) / 0.1;
                case 1: return x < 0.85 ? smooth(x / 0.85) : 1.0 - cosRise((x - 0.85) / 0.15);
                case 2: {
                    static constexpr ShapePoint p[] = {{0.0f, 0.0f, 0.0f}, {0.3f, 1.0f, 0.0f}, {0.7f, 1.0f, 0.0f}, {1.0f, 0.0f, 0.0f}};
                    return evaluatePoints(p, 4, x);
                }
                case 3: {
                    static constexpr ShapePoint p[] = {{0.0f, 0.0f, -0.3f}, {0.35f, 0.65f, -0.3f}, {0.5f, 0.42f, 0.3f},
                                                       {0.85f, 1.0f, 0.0f}, {1.0f, 0.0f, 0.0f}};
                    return evaluatePoints(p, 5, x);
                }
                case 4: {
                    constexpr double top = 235.0 / 255.0;  // on a table point, so the peak is exactly 1
                    return x < top ? std::pow(x / top, 4.0) : 1.0 - (x - top) / (1.0 - top);
                }
                case 5: return x < 0.8 ? 1.0 - std::pow(1.0 - x / 0.8, 3.0) : 1.0 - smooth((x - 0.8) / 0.2);
                case 6: {
                    static constexpr ShapePoint p[] = {{0.0f, 0.0f, 0.3f}, {0.3f, 0.7f, 0.3f}, {0.45f, 0.3f, 0.3f},
                                                       {0.85f, 1.0f, 0.3f}, {1.0f, 0.0f, 0.0f}};
                    return evaluatePoints(p, 5, x);
                }
                default: return x < 0.97 ? (std::exp(5.0 * x / 0.97) - 1.0) / (std::exp(5.0) - 1.0) : 1.0 - (x - 0.97) / 0.03;
            }
        }
        case 3: {  // Sustains (sustain points in info())
            auto adsr = [&](float level) {
                const ShapePoint p[] = {{0.0f, 0.0f, -0.3f}, {0.05f, 1.0f, 0.5f}, {0.25f, level, 0.0f},
                                        {0.75f, level, 0.5f}, {1.0f, 0.0f, 0.0f}};
                return evaluatePoints(p, 5, x);
            };
            switch (s) {
                case 0: return adsr(0.25f);
                case 1: return adsr(0.5f);
                case 2: return adsr(0.75f);
                case 3: {  // AHDSR
                    static constexpr ShapePoint p[] = {{0.0f, 0.0f, -0.3f}, {0.05f, 1.0f, 0.0f}, {0.15f, 1.0f, 0.5f},
                                                       {0.35f, 0.5f, 0.0f}, {0.75f, 0.5f, 0.5f}, {1.0f, 0.0f, 0.0f}};
                    return evaluatePoints(p, 6, x);
                }
                case 4: {  // overshoot and settle
                    static constexpr ShapePoint p[] = {{0.0f, 0.0f, -0.3f}, {0.06f, 1.0f, 0.3f}, {0.14f, 0.5f, -0.3f},
                                                       {0.25f, 0.7f, 0.0f}, {0.75f, 0.7f, 0.5f}, {1.0f, 0.0f, 0.0f}};
                    return evaluatePoints(p, 6, x);
                }
                case 5: {  // double attack
                    static constexpr ShapePoint p[] = {{0.0f, 0.0f, -0.3f}, {0.04f, 1.0f, 0.5f}, {0.1f, 0.45f, -0.3f},
                                                       {0.15f, 0.9f, 0.5f}, {0.3f, 0.6f, 0.0f},   {0.75f, 0.6f, 0.5f},
                                                       {1.0f, 0.0f, 0.0f}};
                    return evaluatePoints(p, 7, x);
                }
                case 6: {  // organ
                    static constexpr ShapePoint p[] = {{0.0f, 0.0f, 0.0f}, {0.01f, 1.0f, 0.0f}, {0.9f, 1.0f, 0.0f}, {1.0f, 0.0f, 0.0f}};
                    return evaluatePoints(p, 4, x);
                }
                default: {  // pad
                    static constexpr ShapePoint p[] = {{0.0f, 0.0f, -0.2f}, {0.35f, 1.0f, 0.3f}, {0.5f, 0.8f, 0.0f},
                                                       {0.65f, 0.8f, 0.3f}, {1.0f, 0.0f, 0.0f}};
                    return evaluatePoints(p, 5, x);
                }
            }
        }
        case 4: {  // Bounces: hits after a one-table-step attack
            if (x < a1) return x / a1 * formula(index, a1);
            x = (x - a1) / (1.0 - a1);
            switch (s) {
                case 0: return bounces(x, 3, 0.6, 0.6, 5.0);
                case 1: return bounces(x, 5, 0.7, 0.72, 5.0);
                case 2: return bounces(x, 8, 0.78, 0.78, 5.0);
                case 3: {  // echoes at 1/8 spacing
                    double t[8], amp[8];
                    for (int i = 0; i < 8; ++i) t[i] = i / 8.0, amp[i] = std::pow(0.65, i);
                    return hits(x, t, amp, 8, 8.0);
                }
                case 4: {  // ping-pong: alternating loud and soft echoes
                    double t[6], amp[6];
                    for (int i = 0; i < 6; ++i) t[i] = i / 6.0, amp[i] = std::pow(0.75, i) * (i % 2 ? 0.5 : 1.0);
                    return hits(x, t, amp, 6, 8.0);
                }
                case 5: {  // stutter: four quick hits, then a long decay
                    static constexpr double t[5] = {0.0, 0.0625, 0.125, 0.1875, 0.25}, amp[5] = {1, 1, 1, 1, 1};
                    return hits(x, t, amp, 5, x < 0.25 ? 10.0 : 5.0);
                }
                case 6: {  // flam
                    static constexpr double t[2] = {0.0, 0.035}, amp[2] = {0.55, 1.0};
                    return hits(x, t, amp, 2, 6.0);
                }
                default: {  // roll: 12 hits, crescendo
                    double t[12], amp[12];
                    for (int i = 0; i < 12; ++i) t[i] = i / 12.0, amp[i] = 0.3 + 0.7 * i / 11.0;
                    return hits(x, t, amp, 12, 6.0);
                }
            }
        }
        case 5: {  // Stairs
            static constexpr double r3[3] = {1 / 3.0, 2 / 3.0, 1.0}, r4[4] = {0.25, 0.5, 0.75, 1.0},
                                    r8[8] = {0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0},
                                    f3[3] = {1.0, 2 / 3.0, 1 / 3.0}, f4[4] = {1.0, 0.75, 0.5, 0.25},
                                    f8[8] = {1.0, 0.875, 0.75, 0.625, 0.5, 0.375, 0.25, 0.125},
                                    ud[6] = {0.25, 0.5, 1.0, 0.75, 0.5, 0.25},
                                    alt[8] = {1.0, 0.25, 0.875, 0.375, 0.75, 0.5, 0.625, 0.125};
            switch (s) {
                case 0: return stairs(x, r3, 3);
                case 1: return stairs(x, r4, 4);
                case 2: return stairs(x, r8, 8);
                case 3: return stairs(x, f3, 3);
                case 4: return stairs(x, f4, 4);
                case 5: return stairs(x, f8, 8);
                case 6: return stairs(x, ud, 6);
                default: return stairs(x, alt, 8);
            }
        }
        case 6: {  // Classic waves
            switch (s) {
                case 0: return waves::sine(x);
                case 1: return waves::triangle(x);
                case 2: return 2.0 * x - 1.0;
                case 3: return 1.0 - 2.0 * x;
                case 4: return x < 0.5 ? 1.0 : -1.0;
                case 5: return std::clamp(2.0 * waves::triangle(x), -1.0, 1.0);
                case 6: return x < 0.5 ? std::sin(2.0 * kPi * x) : 0.0;
                default: return 2.0 * (std::exp(4.0 * x) - 1.0) / (std::exp(4.0) - 1.0) - 1.0;
            }
        }
        case 7: {  // Skewed waves: sine, then triangle, peaks at 10/25/75/90 %
            static constexpr double r[4] = {0.1, 0.25, 0.75, 0.9};
            const double u = skewTri(x, r[s % 4]);
            return s < 4 ? -std::cos(kPi * u) : 2.0 * u - 1.0;
        }
        case 8: {  // Harmonic waves (normalised to peak 1)
            switch (s) {
                case 0: return sinN(x, 1) + 0.5 * sinN(x, 2);
                case 1: return sinN(x, 1) + 0.33 * sinN(x, 3);
                case 2: return sinN(x, 1) + 0.5 * sinN(x, 2) + 0.33 * sinN(x, 3);
                case 3: {
                    double v = 0.0;
                    for (int n = 1; n <= 9; n += 2) v += sinN(x, n) / n;
                    return v;
                }
                case 4: {
                    double v = sinN(x, 1);
                    for (int n = 2; n <= 8; n += 2) v += sinN(x, n) / n;
                    return v;
                }
                case 5: {
                    double v = 0.0;
                    for (int k = 0; k < 5; ++k) v += sinN(x, std::exp2(k)) / (k + 1);
                    return v;
                }
                case 6: return (0.5 - 0.5 * std::cos(2.0 * kPi * x)) * sinN(x, 6);
                default: return std::pow(sinN(x, 1), 3.0);
            }
        }
        case 9: {  // Gates
            static constexpr const char* p[8] = {"x.x.xx.x", "xx.x.xx.", "x..x..x.", "x.xxx.x.",
                                                 "x..x..x...x..x..", "x.x.x.xxx.x.x.xx", "xx.x..x.xx.x..x.", "x...x.x...x.xx.x"};
            return gates(x, p[s]);
        }
        case 10: {  // Wobbles (normalised)
            switch (s) {
                case 0: return damped(x, 4.0, 3.0);
                case 1: return x < 0.5 ? damped(2.0 * x, 3.0, 4.0) : 0.7 * damped(2.0 * x - 1.0, 3.0, 4.0);
                case 2: return x < 0.62 ? damped(x / 0.62, 3.0, 4.0) : 0.8 * damped((x - 0.62) / 0.38, 3.0, 4.0);
                case 3: return sinN(x, 1) * (1.0 - 0.9 * bump(x, 0.25, 0.04));
                case 4: {  // bounce loop: decaying arcs, bipolar
                    double at = 0.0, sum = 0.0;
                    for (int i = 0; i < 5; ++i) sum += std::pow(0.7, i);
                    for (int i = 0; i < 5; ++i) {
                        const double g = std::pow(0.7, i) / sum;
                        if (x < at + g || i == 4) return 2.0 * std::pow(0.7, i) * std::sin(kPi * std::clamp((x - at) / g, 0.0, 1.0)) - 1.0;
                        at += g;
                    }
                    return -1.0;
                }
                case 5: return bump(x, 0.12, 0.02) - 0.35 * bump(x, 0.17, 0.015) + 0.6 * bump(x, 0.3, 0.025);
                case 6: {  // breathing: inhale 40 %, exhale 45 %, pause
                    if (x < 0.4) return -std::cos(kPi * x / 0.4);
                    if (x < 0.85) return std::cos(kPi * (x - 0.4) / 0.45);
                    return -1.0;
                }
                default: return sinN(x, 1) + 0.3 * std::sin(2.0 * kPi * 3.0 * x + 0.5);
            }
        }
        default:  // Textures: seeded smooth noise, seeds 1–8
            return texture(x, (uint64_t)(s + 1), s < 4 ? 8 : 12);
    }
}

}  // namespace shapes_detail

class ShapeLibrary {
public:
    static constexpr int kFamilies = 12, kPerFamily = 8, kFactoryShapes = kFamilies * kPerFamily;

    /// The factory tables, built on first use (about 100 kB; call once from
    /// prepare() or the message thread so the audio thread never builds them).
    static const ShapeLibrary& factory() {
        static const ShapeLibrary lib;
        return lib;
    }

    static const char* familyName(int family) noexcept {
        static constexpr const char* names[kFamilies] = {"Decays", "Plucks",       "Swells",   "Sustains", "Bounces", "Stairs",
                                                         "Classic waves", "Skewed waves", "Harmonic waves", "Gates", "Wobbles", "Textures"};
        return names[std::clamp(family, 0, kFamilies - 1)];
    }

    static const ShapeInfo& info(int shape) noexcept {
        using K = ShapeKind;
        static const ShapeInfo table[kFactoryShapes] = {
            // 0 Decays
            {"Click", 0, K::Envelope, false, -1}, {"Snap", 0, K::Envelope, false, -1},
            {"Short exp", 0, K::Envelope, false, -1}, {"Long exp", 0, K::Envelope, false, -1},
            {"Linear", 0, K::Envelope, false, -1}, {"Log", 0, K::Envelope, false, -1},
            {"Reverse curve", 0, K::Envelope, false, -1}, {"Two-rate", 0, K::Envelope, false, -1},
            // 8 Plucks
            {"Pluck 1:20 soft", 1, K::Envelope, false, -1}, {"Pluck 1:20 hard", 1, K::Envelope, false, -1},
            {"Pluck 1:8 soft", 1, K::Envelope, false, -1}, {"Pluck 1:8 hard", 1, K::Envelope, false, -1},
            {"Pluck 1:4 soft", 1, K::Envelope, false, -1}, {"Pluck 1:4 hard", 1, K::Envelope, false, -1},
            {"Pluck 1:2 soft", 1, K::Envelope, false, -1}, {"Pluck 1:2 hard", 1, K::Envelope, false, -1},
            // 16 Swells
            {"Slow rise", 2, K::Envelope, false, -1}, {"S-curve rise", 2, K::Envelope, false, -1},
            {"Rise-hold-drop", 2, K::Envelope, false, -1}, {"Crescendo dip", 2, K::Envelope, false, -1},
            {"Exp swell", 2, K::Envelope, false, -1}, {"Log swell", 2, K::Envelope, false, -1},
            {"Double swell", 2, K::Envelope, false, -1}, {"Reverse pluck", 2, K::Envelope, false, -1},
            // 24 Sustains
            {"ADSR 25%", 3, K::Envelope, false, 0.745f}, {"ADSR 50%", 3, K::Envelope, false, 0.745f},
            {"ADSR 75%", 3, K::Envelope, false, 0.745f}, {"AHDSR", 3, K::Envelope, false, 0.745f},
            {"Overshoot", 3, K::Envelope, false, 0.745f}, {"Double attack", 3, K::Envelope, false, 0.745f},
            {"Organ", 3, K::Envelope, false, 0.895f}, {"Pad", 3, K::Envelope, false, 0.645f},
            // 32 Bounces
            {"Bounce 3", 4, K::Envelope, false, -1}, {"Bounce 5", 4, K::Envelope, false, -1},
            {"Bounce 8", 4, K::Envelope, false, -1}, {"Echoes 1/8", 4, K::Envelope, false, -1},
            {"Ping-pong", 4, K::Envelope, false, -1}, {"Stutter", 4, K::Envelope, false, -1},
            {"Flam", 4, K::Envelope, false, -1}, {"Roll", 4, K::Envelope, false, -1},
            // 40 Stairs
            {"Rise 3", 5, K::Envelope, false, -1}, {"Rise 4", 5, K::Envelope, false, -1},
            {"Rise 8", 5, K::Envelope, false, -1}, {"Fall 3", 5, K::Envelope, false, -1},
            {"Fall 4", 5, K::Envelope, false, -1}, {"Fall 8", 5, K::Envelope, false, -1},
            {"Up-down 6", 5, K::Envelope, false, -1}, {"Alternating", 5, K::Envelope, false, -1},
            // 48 Classic waves
            {"Sine", 6, K::Cycle, true, -1}, {"Triangle", 6, K::Cycle, true, -1},
            {"Saw up", 6, K::Cycle, true, -1}, {"Saw down", 6, K::Cycle, true, -1},
            {"Square", 6, K::Cycle, true, -1}, {"Trapezoid", 6, K::Cycle, true, -1},
            {"Half-sine", 6, K::Cycle, true, -1}, {"Exp saw", 6, K::Cycle, true, -1},
            // 56 Skewed waves
            {"Sine 10%", 7, K::Cycle, true, -1}, {"Sine 25%", 7, K::Cycle, true, -1},
            {"Sine 75%", 7, K::Cycle, true, -1}, {"Sine 90%", 7, K::Cycle, true, -1},
            {"Triangle 10%", 7, K::Cycle, true, -1}, {"Triangle 25%", 7, K::Cycle, true, -1},
            {"Triangle 75%", 7, K::Cycle, true, -1}, {"Triangle 90%", 7, K::Cycle, true, -1},
            // 64 Harmonic waves
            {"Sine + 2nd", 8, K::Cycle, true, -1}, {"Sine + 3rd", 8, K::Cycle, true, -1},
            {"Sine + 2nd + 3rd", 8, K::Cycle, true, -1}, {"Odd series", 8, K::Cycle, true, -1},
            {"Even series", 8, K::Cycle, true, -1}, {"Octave pulse", 8, K::Cycle, true, -1},
            {"Formant", 8, K::Cycle, true, -1}, {"Pinched sine", 8, K::Cycle, true, -1},
            // 72 Gates
            {"x.x.xx.x", 9, K::Cycle, false, -1}, {"xx.x.xx.", 9, K::Cycle, false, -1},
            {"x..x..x.", 9, K::Cycle, false, -1}, {"x.xxx.x.", 9, K::Cycle, false, -1},
            {"x..x..x...x..x..", 9, K::Cycle, false, -1}, {"x.x.x.xxx.x.x.xx", 9, K::Cycle, false, -1},
            {"xx.x..x.xx.x..x.", 9, K::Cycle, false, -1}, {"x...x.x...x.xx.x", 9, K::Cycle, false, -1},
            // 80 Wobbles
            {"Wobble", 10, K::Cycle, true, -1}, {"Double wobble", 10, K::Cycle, true, -1},
            {"Swing wobble", 10, K::Cycle, true, -1}, {"Sine with notch", 10, K::Cycle, true, -1},
            {"Bounce loop", 10, K::Cycle, true, -1}, {"Heartbeat", 10, K::Cycle, true, -1},
            {"Breathing", 10, K::Cycle, true, -1}, {"Sway", 10, K::Cycle, true, -1},
            // 88 Textures
            {"Texture 1", 11, K::Cycle, true, -1}, {"Texture 2", 11, K::Cycle, true, -1},
            {"Texture 3", 11, K::Cycle, true, -1}, {"Texture 4", 11, K::Cycle, true, -1},
            {"Texture 5", 11, K::Cycle, true, -1}, {"Texture 6", 11, K::Cycle, true, -1},
            {"Texture 7", 11, K::Cycle, true, -1}, {"Texture 8", 11, K::Cycle, true, -1},
        };
        return table[std::clamp(shape, 0, kFactoryShapes - 1)];
    }

    const ShapeTable& table(int shape) const noexcept { return tables_[(size_t)std::clamp(shape, 0, kFactoryShapes - 1)]; }

    /// Shape `shape` at `phase` (linear lookup).
    float value(int shape, double phase) const noexcept { return table(shape).at(phase); }

    /// Morph from `shape` toward `shape + 1` (wrapping from the last factory shape to 0).
    float morph(int shape, float amount, double phase) const noexcept {
        const int s = std::clamp(shape, 0, kFactoryShapes - 1);
        return morphTables(tables_[(size_t)s], tables_[(size_t)((s + 1) % kFactoryShapes)], amount, phase);
    }

    /// Fills `out` with factory shape `index` (what the constructor does).
    static void generate(int index, ShapeTable& out) noexcept {
        const ShapeInfo& in = info(index);
        constexpr int n = ShapeTable::kPoints;
        for (int i = 0; i < n; ++i) out.v[(size_t)i] = (float)shapes_detail::formula(index, (double)i / (n - 1));
        if (in.family == 11) {  // textures: centre the range on 0 so they span −1..+1
            const auto [lo, hi] = std::minmax_element(out.v.begin(), out.v.end());
            const float mid = 0.5f * (*lo + *hi);
            for (float& x : out.v) x -= mid;
        }
        if (in.family == 4 || in.family == 8 || in.family == 10 || in.family == 11) {  // normalise to peak 1
            float peak = 0.0f;
            for (float x : out.v) peak = std::max(peak, std::fabs(x));
            if (peak > 0.0f)
                for (float& x : out.v) x /= peak;
        }
        const float lo = in.bipolar ? -1.0f : 0.0f;
        for (float& x : out.v) x = std::clamp(x, lo, 1.0f);
        if (in.kind == ShapeKind::Envelope) out.v[0] = out.v[n - 1] = 0.0f;
        else out.v[n - 1] = out.v[0];
    }

private:
    ShapeLibrary() noexcept {
        for (int i = 0; i < kFactoryShapes; ++i) generate(i, tables_[(size_t)i]);
    }
    std::array<ShapeTable, kFactoryShapes> tables_{};
};

}  // namespace bleep::dsp
