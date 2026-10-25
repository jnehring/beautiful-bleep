// SPDX-License-Identifier: GPL-3.0-only
// Shape Sequencer (doc/specs/modules/shape-sequencer.md §8): the shapes, finding the
// shape at a position, the song lock, trigger and gate sync (loop and once),
// reset, the outputs and the output stage.
#include "ShapeSequencerDsp.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <vector>

using namespace bleep;
using patch::ShapeFrame;
using patch::ShapeParams;
using patch::ShapeSegment;
using patch::ShapeSequencerDsp;
using patch::ShapeTable;
using patch::ShapeTime;

static constexpr double kSr = 48000.0;
static constexpr double kBpm = 120.0;          // 2 beats a second
static constexpr int kBar = (int)(kSr * 2.0);  // one bar of 4/4 in samples

/// `n` equal shapes over `beats` quarter notes.
static ShapeTable equal(const ShapeSegment& s, int n, double beats = 4.0) {
    ShapeTable t;
    for (int i = 0; i < n; ++i) {
        ShapeSegment d = s;
        d.start = beats * i / n;
        d.len = beats / n;
        t.seg[(size_t)i] = d;
    }
    t.count = n;
    return t;
}
static const ShapeSegment kUp{patch::ShapeRamp, 0.0f, 1.0f, 0.0f, 0.0, 0.0};

static void shapes() {
    TEST("shape values");
    const ShapeSegment up{patch::ShapeRamp, 0.0f, 1.0f, 0.0f, 0.0, 1.0};
    EXPECT_NEAR(patch::shapeValue(up, 0.0), 0.0, 1e-6);
    EXPECT_NEAR(patch::shapeValue(up, 0.5), 0.5, 1e-6);
    EXPECT_NEAR(patch::shapeValue(up, 1.0), 1.0, 1e-6);
    const ShapeSegment down{patch::ShapeRamp, 1.0f, 0.0f, 0.0f, 0.0, 1.0};
    EXPECT_NEAR(patch::shapeValue(down, 0.25), 0.75, 1e-6);
    ShapeSegment bent = up;
    bent.c = 0.5f;  // exponent 2: a slow start
    EXPECT_NEAR(patch::shapeValue(bent, 0.5), 0.25, 1e-6);
    bent.c = -0.5f;
    EXPECT(patch::shapeValue(bent, 0.5) > 0.7f);
    const ShapeSegment s{patch::ShapeCurve, 0.2f, 0.8f, 0.4f, 0.0, 1.0};
    EXPECT_NEAR(patch::shapeValue(s, 0.0), 0.2, 1e-6);
    EXPECT_NEAR(patch::shapeValue(s, 0.5), 0.5, 1e-6);
    EXPECT_NEAR(patch::shapeValue(s, 1.0), 0.8, 1e-6);
    const ShapeSegment tri{patch::ShapeTriangle, 0.0f, 1.0f, 0.0f, 0.0, 1.0};
    EXPECT_NEAR(patch::shapeValue(tri, 0.0), 0.0, 1e-6);
    EXPECT_NEAR(patch::shapeValue(tri, 0.5), 1.0, 1e-6);
    EXPECT_NEAR(patch::shapeValue(tri, 1.0), 0.0, 1e-6);
    const ShapeSegment plat{patch::ShapePlateau, 0.6f, 0.6f, 0.0f, 0.0, 1.0};
    EXPECT_NEAR(patch::shapeValue(plat, 0.3), 0.6, 1e-6);
    const ShapeSegment pulse{patch::ShapePulse, 1.0f, 0.25f, 0.0f, 0.0, 1.0};
    EXPECT_NEAR(patch::shapeValue(pulse, 0.4), 1.0, 1e-6);
    EXPECT_NEAR(patch::shapeValue(pulse, 0.6), 0.25, 1e-6);
    EXPECT_NEAR(patch::shapeValue(ShapeSegment{}, 0.5), 0.0, 1e-6);
}

static void finding() {
    TEST("find the shape at a position");
    ShapeTable t;
    t.seg[0] = {patch::ShapeRamp, 0.0f, 1.0f, 0.0f, 0.0, 1.0};   // [0, 1)
    t.seg[1] = {patch::ShapePlateau, 0.5f, 0.5f, 0.0f, 1.5, 0.5};  // [1.5, 2): a gap before it
    t.seg[2] = {patch::ShapeRamp, 1.0f, 0.0f, 0.0f, 2.0, 2.0};   // [2, 4)
    t.count = 3;
    EXPECT(t.find(0.0) == 0);
    EXPECT(t.find(0.99) == 0);
    EXPECT(t.find(1.2) == -1);  // the gap
    EXPECT(t.find(1.5) == 1);
    EXPECT(t.find(2.0) == 2);
    EXPECT(t.find(3.99) == 2);
    EXPECT(t.find(4.5) == -1);
    ShapeTable none;
    EXPECT(none.find(0.5) == -1);
}

/// Four equal ramps over one bar on the transport.
static void onTransport() {
    const ShapeTable t = equal(kUp, 4);
    ShapeParams p;  // 4 beats
    ShapeSequencerDsp dsp;
    dsp.prepare(kSr);
    ShapeFrame f;
    ShapeTime tm;
    tm.running = true;
    TEST("transport lock");
    int cycles = 0, steps = 0;
    float lc = 0.0f, ls = 0.0f, maxOut = 0.0f;
    for (int i = 0; i < 2 * kBar; ++i) {
        tm.ppq = (double)i / kSr * 2.0;
        dsp.tick(p, t, 0.0f, 0.0f, tm, f);
        if (i == kBar / 8) EXPECT_NEAR(f.out, 0.5, 0.01);  // half way up the first shape
        if (f.cycle > 0.5f && lc < 0.5f) ++cycles;
        if (f.stepTrig > 0.5f && ls < 0.5f) ++steps;
        lc = f.cycle;
        ls = f.stepTrig;
        maxOut = std::max(maxOut, f.out);
    }
    EXPECT(maxOut > 0.99f && maxOut <= 1.0f);
    EXPECT(cycles == 1);  // the loop starts once more at the second bar
    EXPECT(steps == 8);

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

static void anyLengthAndGaps() {
    TEST("a loop of 3 beats");
    ShapeTable t = equal(kUp, 3, 3.0);  // three ramps, one per beat
    ShapeParams p;
    p.lengthBeats = 3.0;
    ShapeSequencerDsp dsp;
    dsp.prepare(kSr);
    ShapeFrame f;
    ShapeTime tm;
    tm.running = true;
    tm.ppq = 3.0 + 0.5;  // half way up the first ramp of the second pass
    dsp.tick(p, t, 0.0f, 0.0f, tm, f);
    EXPECT_NEAR(f.out, 0.5, 1e-5);

    TEST("a gap plays the floor");
    t.seg[1] = t.seg[2];  // beats 1…2 are now empty
    t.count = 2;
    tm.ppq = 1.5;
    dsp.tick(p, t, 0.0f, 0.0f, tm, f);
    EXPECT(f.out == 0.0f);

    TEST("a shape split in two keeps the rest");
    // 1 beat ramp [0,1) replaced by two half-beat shapes: a plateau and a ramp.
    ShapeTable s;
    s.seg[0] = {patch::ShapePlateau, 0.8f, 0.8f, 0.0f, 0.0, 0.5};
    s.seg[1] = {patch::ShapeRamp, 0.0f, 1.0f, 0.0f, 0.5, 0.5};
    s.seg[2] = {patch::ShapeRamp, 0.0f, 1.0f, 0.0f, 1.0, 1.0};
    s.count = 3;
    p.lengthBeats = 2.0;
    tm.ppq = 0.25;
    dsp.tick(p, s, 0.0f, 0.0f, tm, f);
    EXPECT_NEAR(f.out, 0.8, 1e-5);
    tm.ppq = 0.75;  // half way up the second small shape
    dsp.tick(p, s, 0.0f, 0.0f, tm, f);
    EXPECT_NEAR(f.out, 0.5, 1e-5);
    tm.ppq = 1.5;  // the untouched second shape
    dsp.tick(p, s, 0.0f, 0.0f, tm, f);
    EXPECT_NEAR(f.out, 0.5, 1e-5);
}

static void rateAndReset() {
    const ShapeTable t = equal(kUp, 4);
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
    const ShapeTable t = equal(kUp, 4);
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
        EXPECT_NEAR(o[2 * kBar], 1.0, 1e-3);
        EXPECT_NEAR(o[3 * kBar - 1], 1.0, 1e-3);
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
    ShapeTable t = equal({patch::ShapePlateau, 0.5f, 0.5f, 0.0f, 0.0, 0.0}, 1);
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
        t = equal({patch::ShapePlateau, 1.0f, 1.0f, 0.0f, 0.0, 0.0}, 1);
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
        const ShapeTable g = equal({patch::ShapePulse, 1.0f, 0.0f, 0.0f, 0.0, 0.0}, 1);
        p = ShapeParams{};
        p.slew = 1.0f;
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
    finding();
    onTransport();
    anyLengthAndGaps();
    rateAndReset();
    triggerAndGate();
    outputStage();
    return bleep::test::finish("shape-sequencer");
}
