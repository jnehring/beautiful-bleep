// SPDX-License-Identifier: GPL-3.0-only
// Shape Sequencer (doc/specs/modules/shape-sequencer.md §8): the shapes, the slot
// count, the song lock, trigger and gate sync (loop and once), reset, the
// outputs and the output stage.
#include "ShapeSequencerDsp.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <vector>

using namespace bleep;
using patch::ShapeFrame;
using patch::ShapeParams;
using patch::ShapeSequencerDsp;
using patch::ShapeSlot;
using patch::ShapeTable;
using patch::ShapeTime;

static constexpr double kSr = 48000.0;
static constexpr double kBpm = 120.0;          // 2 beats a second
static constexpr int kBar = (int)(kSr * 2.0);  // one bar of 4/4 in samples

static ShapeTable all(const ShapeSlot& s) {
    ShapeTable t{};
    for (auto& x : t) x = s;
    return t;
}

static void shapes() {
    TEST("shape values");
    const ShapeSlot up{patch::ShapeRamp, 0.0f, 1.0f, 0.0f};
    EXPECT_NEAR(patch::shapeValue(up, 0.0), 0.0, 1e-6);
    EXPECT_NEAR(patch::shapeValue(up, 0.5), 0.5, 1e-6);
    EXPECT_NEAR(patch::shapeValue(up, 1.0), 1.0, 1e-6);
    const ShapeSlot down{patch::ShapeRamp, 1.0f, 0.0f, 0.0f};
    EXPECT_NEAR(patch::shapeValue(down, 0.25), 0.75, 1e-6);
    ShapeSlot bent = up;
    bent.c = 0.5f;  // exponent 2: a slow start
    EXPECT_NEAR(patch::shapeValue(bent, 0.5), 0.25, 1e-6);
    bent.c = -0.5f;
    EXPECT(patch::shapeValue(bent, 0.5) > 0.7f);
    const ShapeSlot s{patch::ShapeCurve, 0.2f, 0.8f, 0.4f};
    EXPECT_NEAR(patch::shapeValue(s, 0.0), 0.2, 1e-6);
    EXPECT_NEAR(patch::shapeValue(s, 0.5), 0.5, 1e-6);
    EXPECT_NEAR(patch::shapeValue(s, 1.0), 0.8, 1e-6);
    const ShapeSlot tri{patch::ShapeTriangle, 0.0f, 1.0f, 0.0f};
    EXPECT_NEAR(patch::shapeValue(tri, 0.0), 0.0, 1e-6);
    EXPECT_NEAR(patch::shapeValue(tri, 0.5), 1.0, 1e-6);
    EXPECT_NEAR(patch::shapeValue(tri, 1.0), 0.0, 1e-6);
    const ShapeSlot plat{patch::ShapePlateau, 0.6f, 0.6f, 0.0f};
    EXPECT_NEAR(patch::shapeValue(plat, 0.3), 0.6, 1e-6);
    const ShapeSlot pulse{patch::ShapePulse, 1.0f, 0.25f, 0.0f};
    EXPECT_NEAR(patch::shapeValue(pulse, 0.4), 1.0, 1e-6);
    EXPECT_NEAR(patch::shapeValue(pulse, 0.6), 0.25, 1e-6);
    EXPECT_NEAR(patch::shapeValue(ShapeSlot{}, 0.5), 0.0, 1e-6);
}

static void slotCounts() {
    TEST("slot count");
    EXPECT(patch::slotCount(4.0, 1.0) == 4);      // 1 bar on 1/4
    EXPECT(patch::slotCount(4.0, 0.25) == 16);    // 1 bar on 1/16
    EXPECT(patch::slotCount(2.0, 1.0) == 2);      // half a bar on 1/4
    EXPECT(patch::slotCount(16.0, 0.125) == 32);  // 4 bars on 1/32: capped
    EXPECT(patch::slotCount(1.0, 4.0) == 1);      // never fewer than one
}

/// Four-slot ramp loop on the transport: one bar = 4 slots.
static void onTransport() {
    const ShapeTable t = all({patch::ShapeRamp, 0.0f, 1.0f, 0.0f});
    ShapeParams p;  // 1 bar, 1/4
    ShapeSequencerDsp dsp;
    dsp.prepare(kSr);
    ShapeFrame f;
    ShapeTime tm;
    tm.running = true;
    TEST("transport lock");
    int cycles = 0, slots = 0;
    float lc = 0.0f, ls = 0.0f, maxOut = 0.0f;
    for (int i = 0; i < 2 * kBar; ++i) {
        tm.ppq = (double)i / kSr * 2.0;
        dsp.tick(p, t, 0.0f, 0.0f, tm, f);
        if (i == kBar / 8) EXPECT_NEAR(f.out, 0.5, 0.01);  // half way up the first slot
        if (f.cycle > 0.5f && lc < 0.5f) ++cycles;
        if (f.slotTrig > 0.5f && ls < 0.5f) ++slots;
        lc = f.cycle;
        ls = f.slotTrig;
        maxOut = std::max(maxOut, f.out);
    }
    EXPECT(maxOut > 0.99f && maxOut <= 1.0f);
    EXPECT(cycles == 1);  // the loop starts once more at the second bar
    EXPECT(slots == 8);

    TEST("a loop jump lands on the same value");
    tm.ppq = 4.0 + 0.5;
    dsp.tick(p, t, 0.0f, 0.0f, tm, f);
    const float a = f.out;
    tm.ppq = 0.5;
    dsp.tick(p, t, 0.0f, 0.0f, tm, f);
    EXPECT_NEAR(a, f.out, 1e-5);

    TEST("stopped transport is idle");
    tm.running = false;
    dsp.tick(p, t, 0.0f, 0.0f, tm, f);
    EXPECT(!f.active && f.out == 0.0f);
}

static void rateAndReset() {
    const ShapeTable t = all({patch::ShapeRamp, 0.0f, 1.0f, 0.0f});
    ShapeParams p;
    p.rate = 2.0;  // the bar lasts two beats
    ShapeSequencerDsp dsp;
    dsp.prepare(kSr);
    ShapeFrame f;
    ShapeTime tm;
    tm.running = true;
    TEST("rate doubles the speed");
    tm.ppq = 1.0;
    dsp.tick(p, t, 0.0f, 0.0f, tm, f);
    EXPECT_NEAR(f.phase, 0.5, 1e-6);

    TEST("reset moves the loop start");
    tm.ppq = 1.25;
    dsp.tick(p, t, 0.0f, 1.0f, tm, f);
    EXPECT_NEAR(f.phase, 0.0, 1e-6);
    tm.ppq = 1.25 + 0.5;
    dsp.tick(p, t, 0.0f, 1.0f, tm, f);
    EXPECT_NEAR(f.phase, 0.25, 1e-6);
}

/// Trigger sync: a 10-sample pulse at `trigAt`. Gate sync: high from `trigAt` to `gateOff`.
static std::vector<float> run(const ShapeParams& p, const ShapeTable& t, int n, int trigAt, int gateOff = -1) {
    ShapeSequencerDsp dsp;
    dsp.prepare(kSr);
    ShapeFrame f;
    ShapeTime tm;
    tm.bpm = kBpm;
    std::vector<float> out;
    for (int i = 0; i < n; ++i) {
        const bool in = p.sync == patch::ShapeOnGate ? (i >= trigAt && (gateOff < 0 || i < gateOff)) : (i >= trigAt && i < trigAt + 10);
        dsp.tick(p, t, in ? 1.0f : 0.0f, 0.0f, tm, f);
        out.push_back(f.out);
    }
    return out;
}

static void triggerAndGate() {
    const ShapeTable t = all({patch::ShapeRamp, 0.0f, 1.0f, 0.0f});
    ShapeParams p;
    p.sync = patch::ShapeOnTrigger;
    {
        TEST("trigger idles until fired");
        const auto o = run(p, t, kBar, 100000);
        EXPECT(o[1000] == 0.0f);
    }
    {
        TEST("trigger loop");
        const auto o = run(p, t, 3 * kBar, 0);
        EXPECT_NEAR(o[kBar / 8], 0.5, 0.01);
        EXPECT_NEAR(o[kBar + kBar / 8], 0.5, 0.01);  // second pass
    }
    {
        TEST("trigger once holds the end");
        p.once = true;
        const auto o = run(p, t, 3 * kBar, 0);
        EXPECT_NEAR(o[kBar / 8], 0.5, 0.01);
        EXPECT_NEAR(o[2 * kBar], 1.0, 1e-4);
        EXPECT_NEAR(o[3 * kBar - 1], 1.0, 1e-4);
    }
    {
        TEST("a trigger restarts a running pass");
        p.once = false;
        ShapeSequencerDsp dsp;
        dsp.prepare(kSr);
        ShapeFrame f;
        ShapeTime tm;
        tm.bpm = kBpm;
        for (int i = 0; i < kBar / 2; ++i) dsp.tick(p, t, i < 10 ? 1.0f : 0.0f, 0.0f, tm, f);
        EXPECT(f.phase > 0.45);
        dsp.tick(p, t, 0.0f, 0.0f, tm, f);
        dsp.tick(p, t, 1.0f, 0.0f, tm, f);
        EXPECT(f.phase < 0.001);
    }
    {
        TEST("gate runs while high and idles after");
        p.sync = patch::ShapeOnGate;
        const auto o = run(p, t, 2 * kBar, 0, kBar / 2);
        EXPECT_NEAR(o[kBar / 8], 0.5, 0.01);
        EXPECT(o[kBar / 2 + 10] == 0.0f);
        EXPECT(o[kBar] == 0.0f);
    }
}

static void outputStage() {
    ShapeTable t = all({patch::ShapePlateau, 0.5f, 0.5f, 0.0f});
    ShapeSequencerDsp dsp;
    dsp.prepare(kSr);
    ShapeFrame f;
    ShapeTime tm;
    tm.running = true;
    ShapeParams p;
    {
        TEST("depth and offset");
        p.depth = 0.5f;
        p.offset = 0.25f;
        dsp.tick(p, t, 0.0f, 0.0f, tm, f);
        EXPECT_NEAR(f.out, 0.5, 1e-6);  // 0.25 + 0.5 * 0.5
    }
    {
        TEST("bipolar");
        p.bipolar = true;
        p.depth = 1.0f;
        p.offset = 0.0f;
        dsp.tick(p, t, 0.0f, 0.0f, tm, f);
        EXPECT_NEAR(f.out, 0.0, 1e-6);  // a plateau at 50 % is the centre
        t = all({patch::ShapePlateau, 1.0f, 1.0f, 0.0f});
        dsp.tick(p, t, 0.0f, 0.0f, tm, f);
        EXPECT_NEAR(f.out, 1.0, 1e-6);
    }
    {
        TEST("output is clamped");
        p.bipolar = false;
        p.offset = 1.0f;
        dsp.tick(p, t, 0.0f, 0.0f, tm, f);
        EXPECT(f.out <= 1.0f);
    }
    {
        TEST("slew smooths a jump");
        const ShapeTable g = all({patch::ShapePulse, 1.0f, 0.0f, 0.0f});
        p = ShapeParams{};
        p.slew = 1.0f;
        p.gridBeats = 4.0;  // one slot: high, then low half way
        ShapeSequencerDsp d2;
        d2.prepare(kSr);
        for (int i = 0; i < 100000; ++i) {
            tm.ppq = 0.5;
            d2.tick(p, g, 0.0f, 0.0f, tm, f);
        }
        EXPECT(f.out > 0.99f);
        tm.ppq = 2.5;  // the falling edge
        d2.tick(p, g, 0.0f, 0.0f, tm, f);
        EXPECT(f.out > 0.9f);  // not yet there
        for (int i = 0; i < 200000; ++i) d2.tick(p, g, 0.0f, 0.0f, tm, f);
        EXPECT(f.out < 0.01f);
    }
}

int main() {
    shapes();
    slotCounts();
    onTransport();
    rateAndReset();
    triggerAndGate();
    outputStage();
    return bleep::test::finish("shape-sequencer");
}
