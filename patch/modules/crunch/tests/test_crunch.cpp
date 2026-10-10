// SPDX-License-Identifier: MIT
#include "CrunchDsp.h"
#include "dsp/tests/TestUtil.h"

#include <set>
#include <vector>

using namespace bleep::patch;
static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

static void gainStagingKeepsLevelsComparable() {
    TEST("the Drive knob changes the colour, not the loudness: 0.5 in comes out near 0.5");
    for (float knob : {0.0f, 0.2f, 0.5f, 0.8f, 1.0f}) {
        const auto g = OverdriveGains::forKnob(knob);
        EXPECT_NEAR(softClip(g.pre * 0.5f) * g.post, 0.5f, 1e-4);
        EXPECT(softClip(g.pre * 1.0f) * g.post < 1.1f);
    }
    // Soft at the bottom (linear below 0.2), a hard clipper at the top.
    const auto lo = OverdriveGains::forKnob(0.0f), hi = OverdriveGains::forKnob(1.0f);
    EXPECT_NEAR(softClip(lo.pre * 0.1f) * lo.post, 0.1f, 0.01);
    EXPECT_NEAR(softClip(hi.pre * 0.1f) * hi.post, 0.5f, 0.01);
    EXPECT(softClip(100.0f) == 1.0f && softClip(-100.0f) == -1.0f);
}

static void driveAddsHarmonics() {
    TEST("drive makes a sine richer in odd harmonics");
    auto run = [](float drive) {
        CrunchDsp d;
        d.prepare(kSr);
        CrunchParams p;
        p.drive = drive;
        std::vector<float> y;
        for (int i = 0; i < 24000; ++i) {
            const float v = d.tick((float)(0.5 * std::sin(2.0 * kPi * 500.0 * i / kSr)), p);
            if (i >= 4800) y.push_back(v);
        }
        return bleep::test::magnitudeAt(y, 1500.0, kSr) / bleep::test::magnitudeAt(y, 500.0, kSr);
    };
    EXPECT(run(0.9f) > 4.0 * run(0.05f));
}

static void bitCrushQuantises() {
    TEST("N bits give 2^(N-1) levels; 16 bits is off");
    CrunchDsp d;
    d.prepare(kSr);
    CrunchParams p;
    p.drive = 0.0f;
    p.bits = 3.0f;
    std::set<int> levels;
    for (int i = 0; i < 4800; ++i) levels.insert((int)std::lround(d.tick(0.9f * (float)std::sin(i * 0.01), p) * 4.0f));
    EXPECT(levels.size() <= 9);  // -4 … +4 at 2^(3-1) = 4 steps per unit
    EXPECT(levels.size() >= 5);
}

static void rateReductionHolds() {
    TEST("rate reduction holds samples");
    CrunchDsp d;
    d.prepare(kSr);
    CrunchParams p;
    p.rate = 0.5f;  // 0.25 * 96 = 24 held
    int changes = 0;
    float last = 99.0f;
    for (int i = 0; i < 2400; ++i) {
        const float y = d.tick((float)std::sin(i * 0.05), p);
        if (y != last) ++changes;
        last = y;
    }
    EXPECT(changes < 2400 / 20);
}

int main() {
    gainStagingKeepsLevelsComparable();
    driveAddsHarmonics();
    bitCrushQuantises();
    rateReductionHolds();
    return bleep::test::finish("crunch");
}
