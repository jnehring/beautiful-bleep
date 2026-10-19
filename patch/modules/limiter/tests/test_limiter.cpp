// SPDX-License-Identifier: GPL-3.0-or-later
#include "LimiterDsp.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep::patch;
static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

static float dbToLin(float db) { return std::pow(10.0f, db * 0.05f); }

static void neverExceedsTheCeiling() {
    TEST("no sample passes the ceiling, with and without lookahead, on loud bursts and steps");
    for (int look : {1, 48, 96, 240}) {
        LimiterDsp d;
        d.prepare(kSr);
        d.setLookahead(look);
        LimiterParams p;
        p.ceilingDb = -6.0f;
        p.inputDb = 12.0f;
        p.releaseMs = 50.0f;
        const float ceil = dbToLin(p.ceilingDb);
        float worst = 0.0f;
        for (int i = 0; i < 96000; ++i) {
            const float burst = (i / 8000) % 2 ? 1.0f : 0.05f;  // loud, quiet, loud ...
            const float x = burst * (float)std::sin(2.0 * kPi * 330.0 * i / kSr) + (i == 5000 ? 1.0f : 0.0f);
            const float in[2] = {x, -x * 0.7f};
            float o[2];
            d.tick(in, o, p);
            worst = std::max({worst, std::fabs(o[0]), std::fabs(o[1])});
        }
        EXPECT(worst <= ceil + 1e-6f);
        EXPECT(worst > ceil * 0.9f);  // and it does reach it: the limiter is not just muting
    }
}

static void leavesQuietSignalsAlone() {
    TEST("below the ceiling the signal passes unchanged, delayed by the lookahead");
    LimiterDsp d;
    d.prepare(kSr);
    d.setLookahead(96);
    LimiterParams p;
    std::vector<float> in, out;
    for (int i = 0; i < 4800; ++i) {
        const float x = 0.3f * (float)std::sin(2.0 * kPi * 220.0 * i / kSr);
        const float f[2] = {x, x};
        float o[2];
        d.tick(f, o, p);
        in.push_back(x), out.push_back(o[0]);
    }
    EXPECT(d.latency() == 95);
    for (int i = 200; i < 4800; ++i) EXPECT_NEAR(out[(size_t)i], in[(size_t)(i - d.latency())], 1e-5);
}

static void releasesBack() {
    TEST("the gain comes back after a peak, over about the release time");
    LimiterDsp d;
    d.prepare(kSr);
    d.setLookahead(48);
    LimiterParams p;
    p.ceilingDb = -6.0f;
    p.releaseMs = 100.0f;
    float g = 1.0f, low = 1.0f, atTail = 0.0f;
    for (int i = 0; i < 48000; ++i) {
        const float x = i < 2400 ? 1.0f : 0.1f;  // 50 ms loud, then quiet
        const float f[2] = {x, x};
        float o[2];
        g = d.tick(f, o, p);
        low = std::min(low, g);
        if (i == 2400 + 4800) atTail = g;  // 100 ms after the loud part
    }
    EXPECT_NEAR(low, dbToLin(-6.0f), 0.01);
    EXPECT(atTail > low && atTail < 0.95f);  // on its way back, not there yet
    EXPECT_NEAR(g, 1.0f, 0.01);
}

int main() {
    neverExceedsTheCeiling();
    leavesQuietSignalsAlone();
    releasesBack();
    return bleep::test::finish("limiter");
}
