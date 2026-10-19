// SPDX-License-Identifier: GPL-3.0-or-later
// Organic LFOs (doc/specs/modules/organic-lfos.md §8): identical without drift,
// irrational rate fan, bounded drift with an exact anchor, bit-identical
// renders, the bar lock (seekable), the Twist formulas, Sum and Max.
#include "OrganicLfosDsp.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <vector>

using namespace bleep;
using patch::OrganicFrame;
using patch::OrganicLfosDsp;
using patch::OrganicParams;
using patch::OrganicTime;

static constexpr double kSr = 48000.0;
static float rateFor(double hz) { return (float)(std::log(hz / 0.002) / std::log(10000.0)); }

struct Run {
    std::vector<float> out[8], sum, max;
    std::vector<float> rate[8];
};
static Run run(const OrganicParams& p, int64_t n, int every = 1) {
    OrganicLfosDsp d;
    d.prepare(kSr);
    Run r;
    OrganicTime t;
    OrganicFrame f;
    for (int64_t i = 0; i < n; ++i) {
        d.tick(p, 0.0f, t, f);
        if (i % every) continue;
        for (int k = 0; k < 8; ++k) r.out[k].push_back(f.out[k]), r.rate[k].push_back((float)d.liveRate(k));
        r.sum.push_back(f.sum);
        r.max.push_back(f.max);
    }
    return r;
}

static void identical() {
    TEST("organic: Drift 0, Spread 0, Scatter 0 gives eight identical outputs");
    OrganicParams p;
    p.rate = rateFor(2.0);
    p.drift = 0.0f;
    p.spread = 0.0f;
    p.scatter = 0.0f;
    const Run r = run(p, 48000);
    for (int k = 1; k < 8; ++k) EXPECT(r.out[k] == r.out[0]);
    EXPECT_NEAR(r.rate[0][100], 2.0, 1e-6);
}

static void fan() {
    TEST("organic: Spread +1 fans the rates by 2^(4·g_k), irrationally");
    OrganicParams p;
    p.rate = rateFor(0.2);
    p.drift = 0.0f;
    p.spread = 1.0f;
    const Run r = run(p, 100);
    const double j8 = OrganicLfosDsp::jitter(p.seed, 7);
    EXPECT(std::fabs(j8) <= 0.03 && j8 != 0.0);
    EXPECT_NEAR(r.rate[7].back() / r.rate[0].back(), std::exp2(4.0 * (1.0 + j8)), 1e-3);
    // Without the jitter LFO 8 would run exactly 16× LFO 1 (and at Spread
    // ±0.75 exactly 8×): the seeded jitter moves every channel off the grid of
    // 2^(4k/7), by a different amount per channel and per seed.
    for (uint32_t seed = 0; seed < 20; ++seed) {
        for (int k = 1; k < 8; ++k) {
            const double j = OrganicLfosDsp::jitter(seed, k);
            EXPECT(std::fabs(j) <= 0.03 && std::fabs(j) > 0.0);
            for (int m = 1; m < k; ++m) EXPECT(j != OrganicLfosDsp::jitter(seed, m));
        }
        EXPECT(std::fabs(OrganicLfosDsp::rateRatio(seed, 7, 1.0f) - 16.0) > 1e-6);
        EXPECT(std::fabs(OrganicLfosDsp::rateRatio(seed, 7, 0.75f) - 8.0) > 1e-6);
    }
    EXPECT(OrganicLfosDsp::jitter(1, 3) != OrganicLfosDsp::jitter(2, 3));
}

static void drift() {
    TEST("organic: drift stays within −21 % … +27 %; the anchor is exact");
    OrganicParams p;
    p.rate = rateFor(2.0);
    p.drift = 1.0f;
    p.spread = 0.3f;
    const Run r = run(p, 48000 * 60, 480);
    for (int k = 0; k < 8; ++k) {
        const double base = 2.0 * OrganicLfosDsp::rateRatio(p.seed, k, p.spread);
        double lo = 1e9, hi = 0.0;
        for (float v : r.rate[k]) lo = std::min(lo, (double)v / base), hi = std::max(hi, (double)v / base);
        EXPECT(lo >= std::exp2(-0.35) - 1e-4 && hi <= std::exp2(0.35) + 1e-4);
        if (k == 0) EXPECT(lo > 0.99999 && hi < 1.00001);
        else EXPECT(hi - lo > 0.1);  // it does wander
    }
    p.anchor = false;
    const Run u = run(p, 48000 * 20, 480);
    double lo = 1e9, hi = 0.0;
    for (float v : u.rate[0]) lo = std::min(lo, (double)v), hi = std::max(hi, (double)v);
    EXPECT(hi - lo > 0.05);
}

static void reproducible() {
    TEST("organic: renders are bit-identical; another Seed differs");
    OrganicParams p;
    p.rate = rateFor(1.0);
    const Run a = run(p, 48000 * 3), b = run(p, 48000 * 3);
    for (int k = 0; k < 8; ++k) EXPECT(a.out[k] == b.out[k]);
    EXPECT(a.sum == b.sum && a.max == b.max);
    p.seed = 2;
    const Run c = run(p, 48000 * 3);
    EXPECT(c.out[3] != a.out[3]);
}

static void bars() {
    TEST("organic: Lock = Bars follows the song position; seeking equals playing");
    OrganicParams p;
    p.bars = true;
    p.rate = 13.0f / 14.0f;  // 1/4 (index 13: 64 bars, 32 bars, then 16 bars … 1/4T)
    EXPECT(std::string(OrganicLfosDsp::barName(p.rate)) == "1/4");
    p.twist = 0.0f;
    p.drift = 0.5f;
    OrganicLfosDsp d;
    d.prepare(kSr);
    OrganicTime t;
    t.running = true;
    OrganicFrame f;
    std::vector<OrganicFrame> played;
    for (int i = 0; i < 48000; ++i) {
        t.ppq = i * 2.0 / kSr;
        t.started = i == 0;
        d.tick(p, 0.0f, t, f);
        played.push_back(f);
    }
    // Twist at 0 and Drift 0: LFO 1 is exactly the song-position sine.
    OrganicParams q = p;
    q.drift = 0.0f;
    OrganicLfosDsp e;
    e.prepare(kSr);
    t.ppq = 7.3;
    t.started = true;
    e.tick(q, 0.0f, t, f);
    EXPECT_NEAR(f.out[0], std::sin(2.0 * 3.141592653589793 * 0.3), 1e-5);
    // Seek: a fresh module jumping straight to a position gives what playing gave.
    OrganicLfosDsp s;
    s.prepare(kSr);
    for (int i : {33333, 47000, 12345}) {
        t.ppq = i * 2.0 / kSr;
        t.started = false;
        s.tick(p, 0.0f, t, f);
        for (int k = 0; k < 8; ++k) EXPECT(f.out[k] == played[(size_t)i].out[k]);
        EXPECT(f.sum == played[(size_t)i].sum);
    }
}

static void twist() {
    TEST("organic: Twist −1, 0, +1 at quarter phases");
    const double pi = 3.141592653589793;
    EXPECT_NEAR(OrganicLfosDsp::wave(0.25, 0.0f), 1.0, 1e-6);
    EXPECT_NEAR(OrganicLfosDsp::wave(0.75, 0.0f), -1.0, 1e-6);
    EXPECT_NEAR(OrganicLfosDsp::wave(0.125, 0.0f), std::sin(pi / 4.0), 1e-6);
    EXPECT_NEAR(OrganicLfosDsp::wave(0.125, -1.0f), std::tanh(6.0 * std::sin(pi / 4.0)) / std::tanh(6.0), 1e-6);
    EXPECT_NEAR(OrganicLfosDsp::wave(0.25, -1.0f), 1.0, 1e-6);
    // +1: the rise takes 10 % of the cycle (trough at 0.75, peak at 0.85), cubed.
    EXPECT_NEAR(OrganicLfosDsp::wave(0.75, 1.0f), -1.0, 1e-6);
    EXPECT_NEAR(OrganicLfosDsp::wave(0.85, 1.0f), 1.0, 1e-6);
    EXPECT_NEAR(OrganicLfosDsp::wave(0.8, 1.0f), 0.0, 1e-6);
    const double fall = 0.5 + 0.5 * 0.25 / 0.9;  // p = 0.1: a quarter into the 90 % fall... in the skewed phase
    EXPECT_NEAR(OrganicLfosDsp::wave(0.1, 1.0f), std::pow(std::fabs(std::cos(2.0 * pi * fall)), 3.0) * (std::cos(2.0 * pi * fall) < 0 ? 1 : -1), 1e-5);
    // Continuous at 0 from both sides, in range everywhere.
    for (int i = 0; i <= 100; ++i) {
        const double ph = i / 100.0;
        EXPECT(std::fabs(OrganicLfosDsp::wave(ph, 0.001f) - OrganicLfosDsp::wave(ph, -0.001f)) < 0.01f);
        for (float t : {-1.0f, -0.4f, 0.3f, 1.0f}) EXPECT(std::fabs(OrganicLfosDsp::wave(ph, t)) <= 1.0f);
    }
}

static void sumAndMax() {
    TEST("organic: Sum within ±1, Max ≥ every output");
    OrganicParams p;
    p.rate = rateFor(3.0);
    for (float spread : {0.0f, 0.5f, -1.0f}) {
        p.spread = spread;
        p.drift = spread == 0.0f ? 0.0f : 1.0f;
        p.scatter = spread == 0.0f ? 0.0f : 1.0f;
        const Run r = run(p, 48000 * 2);
        for (size_t i = 0; i < r.sum.size(); ++i) {
            EXPECT(r.sum[i] >= -1.0f && r.sum[i] <= 1.0f);
            for (int k = 0; k < 8; ++k) EXPECT(r.max[i] >= r.out[k][i]);
        }
    }
}

int main() {
    identical();
    fan();
    drift();
    reproducible();
    bars();
    twist();
    sumAndMax();
    return bleep::test::finish("organic lfos");
}
