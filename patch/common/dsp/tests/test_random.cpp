// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Random.h: counter-based uniforms (unchanged), normals, Φ and Φ⁻¹, the
// spread/bias distribution and seekable smooth noise.
#include "dsp/Random.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>

using namespace bleep;

static void uniformsUnchanged() {
    TEST("random: uniform01 is unchanged");
    // Pinned values: saved boards depend on these sequences.
    EXPECT(dsp::mix64(0) == 0xe220a8397b1dcdafull);
    EXPECT(dsp::hash3(1, 2, 3) == dsp::mix64(dsp::mix64(dsp::mix64(1) ^ 2) ^ (3 * 0xd6e8feb86659fd93ull)));
    EXPECT(dsp::uniform01(1, 5, 11) == (double)(dsp::hash3(1, 5, 11) >> 11) * (1.0 / 9007199254740992.0));
}

static void normals() {
    TEST("random: standard normal mean and variance");
    const int n = 400000;
    double sum = 0.0, sq = 0.0, cube = 0.0;
    int within1 = 0;
    for (int i = 0; i < n; ++i) {
        const double z = dsp::standardNormal(7, (uint64_t)i, 3);
        EXPECT(std::isfinite(z));
        sum += z;
        sq += z * z;
        cube += z * z * z;
        within1 += std::fabs(z) < 1.0;
    }
    const double mean = sum / n, var = sq / n - mean * mean;
    EXPECT_NEAR(mean, 0.0, 0.01);
    EXPECT_NEAR(var, 1.0, 0.01);
    EXPECT_NEAR(cube / n, 0.0, 0.03);
    EXPECT_NEAR((double)within1 / n, 0.682689, 0.003);
    EXPECT(dsp::standardNormal(7, 3, 3) == dsp::standardNormal(7, 3, 3));  // pure
    EXPECT(dsp::standardNormal(7, 3, 3) != dsp::standardNormal(8, 3, 3));
}

static void cdf() {
    TEST("random: Φ and Φ⁻¹");
    EXPECT_NEAR(dsp::normalCdf(0.0), 0.5, 1e-15);
    EXPECT_NEAR(dsp::normalCdf(1.0), 0.8413447460685429, 1e-14);
    EXPECT_NEAR(dsp::normalCdf(-1.959963984540054), 0.025, 1e-14);
    EXPECT_NEAR(dsp::normalInv(0.975), 1.959963984540054, 1e-12);
    EXPECT_NEAR(dsp::normalInv(0.5), 0.0, 1e-14);
    double worst = 0.0;
    for (int i = 1; i < 10000; ++i) {
        const double p = i / 10000.0;
        worst = std::max(worst, std::fabs(dsp::normalCdf(dsp::normalInv(p)) - p));
    }
    EXPECT(worst < 1e-14);
    for (double p : {1e-12, 1e-6, 0.01, 0.99, 1.0 - 1e-9}) EXPECT_NEAR(dsp::normalCdf(dsp::normalInv(p)) / p, 1.0, 1e-9);
    for (double x : {-6.0, -2.5, -0.3, 0.7, 3.0, 5.5}) EXPECT_NEAR(dsp::normalInv(dsp::normalCdf(x)), x, 1e-9);
    EXPECT(std::isfinite(dsp::normalInv(0.0)) && std::isfinite(dsp::normalInv(1.0)));
}

static void shaping() {
    TEST("random: smooth-step, skew and spread/bias");
    for (double u : {0.0, 0.1, 0.37, 0.5, 0.9, 1.0}) EXPECT_NEAR(dsp::inverseSmoothstep01(dsp::smoothstep01(u)), u, 1e-12);
    EXPECT_NEAR(dsp::skew01(0.25, 0.0), 0.25, 1e-15);
    EXPECT_NEAR(dsp::skew01(0.25, 1.0), std::pow(0.25, 0.25), 1e-12);  // γ = 1/4
    EXPECT_NEAR(dsp::skew01(0.5, -1.0), 0.0625, 1e-12);                                                 // γ = 4

    // Spread 0: the centre, moved by bias.
    EXPECT_NEAR(dsp::spreadBias(0.9, 0.1, 0.3, 0.0, 0.5), 0.0, 1e-12);
    EXPECT(dsp::spreadBias(0.9, 0.1, 0.3, 0.0, 1.0) > 0.5);
    EXPECT(dsp::spreadBias(0.9, 0.1, 0.3, 0.0, 0.0) < -0.5);
    // Continuous in spread (at the zone borders too) and always in range.
    for (int k = 0; k < 200; ++k) {
        const double u0 = dsp::uniform01(1, (uint64_t)k, 1), u1 = dsp::uniform01(1, (uint64_t)k, 2), u2 = dsp::uniform01(1, (uint64_t)k, 3);
        double last = dsp::spreadBias(u0, u1, u2, 0.0, 0.3);
        for (int s = 1; s <= 1000; ++s) {
            const double v = dsp::spreadBias(u0, u1, u2, s / 1000.0, 0.3);
            EXPECT(v >= -1.0 && v <= 1.0);
            EXPECT(std::fabs(v - last) < 0.02);
            last = v;
            if (bleep::test::failures()) return;
        }
    }
    // Statistics: spread 25 % is a narrow bell, 70 % fills uniformly, 100 % crowds the edges.
    auto stats = [](double spread, double& meanAbs, double& mean) {
        meanAbs = mean = 0.0;
        const int n = 50000;
        for (int i = 0; i < n; ++i) {
            const double v = dsp::spreadBias(dsp::uniform01(2, (uint64_t)i, 1), dsp::uniform01(2, (uint64_t)i, 2),
                                             dsp::uniform01(2, (uint64_t)i, 3), spread, 0.5);
            meanAbs += std::fabs(v) / n;
            mean += v / n;
        }
    };
    double a25, m25, a85, m85, a100, m100;
    stats(0.25, a25, m25);
    stats(0.85, a85, m85);
    stats(1.0, a100, m100);
    EXPECT(a25 < 0.15);
    EXPECT_NEAR(a85, 0.5, 0.02);  // uniform on −1..1
    EXPECT(a100 > 0.6);           // sign(w)·√|w|: E|v| = 2/3
    EXPECT_NEAR(m25, 0.0, 0.01);
    EXPECT_NEAR(m100, 0.0, 0.02);
}

static void smoothNoise() {
    TEST("random: smooth noise is continuous and seekable");
    // Seekable: a pure function of (seed, stream, t).
    EXPECT(dsp::smoothNoise(5, 1, 12.345) == dsp::smoothNoise(5, 1, 12.345));
    EXPECT(dsp::smoothNoise(5, 1, 12.345) != dsp::smoothNoise(6, 1, 12.345));
    EXPECT(dsp::smoothNoise(5, 1, 12.345) != dsp::smoothNoise(5, 2, 12.345));
    // Passes through the seeded points at integer t.
    for (int i = -5; i < 5; ++i) EXPECT_NEAR(dsp::smoothNoise(5, 1, (double)i), dsp::noisePoint(5, i, 1), 1e-12);
    // Continuous value and slope: no big steps, no corners, also across integers.
    const double dt = 1e-4;
    double last = dsp::smoothNoise(9, 3, -3.0), lastSlope = 0.0, maxJump = 0.0, maxSlopeJump = 0.0;
    double lo = 1.0, hi = -1.0;
    for (int i = 1; i < 200000; ++i) {
        const double t = -3.0 + i * dt;
        const double v = dsp::smoothNoise(9, 3, t);
        const double slope = (v - last) / dt;
        maxJump = std::max(maxJump, std::fabs(v - last));
        if (i > 1) maxSlopeJump = std::max(maxSlopeJump, std::fabs(slope - lastSlope));
        lo = std::min(lo, v);
        hi = std::max(hi, v);
        last = v;
        lastSlope = slope;
    }
    EXPECT(maxJump < 5e-4);      // |slope| ≤ ~3 per unit
    EXPECT(maxSlopeJump < 0.01);  // C1: no corners at the points
    EXPECT(lo >= -1.0 && hi <= 1.0 && hi - lo > 1.0);
    // smoothNoiseAt: points every 1/rate seconds.
    EXPECT(dsp::smoothNoiseAt(5, 1, 2.0, 4.0) == dsp::smoothNoise(5, 1, 8.0));
    EXPECT_NEAR(dsp::catmullRom(0, 1, 2, 3, 0.5), 1.5, 1e-15);  // straight lines stay straight
}

int main() {
    uniformsUnchanged();
    normals();
    cdf();
    shaping();
    smoothNoise();
    return bleep::test::finish("random");
}
