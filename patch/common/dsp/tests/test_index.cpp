// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Index stepper: CV bands with hysteresis, Count orders, Gates, Binary,
// Offset, and the Out round trip i / (steps - 1) → round(v × (steps - 1)).
#include "dsp/IndexStepper.h"

#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep;
using dsp::IndexClock;
using dsp::IndexParams;
using dsp::IndexStepper;

struct Rig {
    IndexStepper s;
    IndexParams p;
    IndexClock clk;
    float gate[dsp::kMaxIndexGates] = {};
    int step = -1;
    bool changed = false;
    Rig() {
        s.reset();
        clk.gate = gate;
    }
    int run(int n = 1) {
        for (int i = 0; i < n; ++i) step = s.tick(clk, p, changed);
        return step;
    }
    int cv(float x) {
        clk.in = x;
        return run();
    }
    void pulse(float& v) {
        v = 1.0f;
        run();
        v = 0.0f;
        run(2);
    }
    int up() { pulse(clk.up); return step; }
    int down() { pulse(clk.down); return step; }
    int reset() { pulse(clk.reset); return step; }
};

static void cvBands() {
    TEST("index: CV bands, hysteresis, range, NaN");
    Rig r;
    r.p.steps = 4;
    EXPECT(r.cv(0.125f) == 0);
    EXPECT(r.cv(0.375f) == 1);
    EXPECT(r.cv(0.625f) == 2);
    EXPECT(r.cv(0.875f) == 3);
    EXPECT(r.cv(1.0f) == 3);
    EXPECT(r.cv(-3.0f) == 0);
    r.cv(0.2f);
    EXPECT(r.cv(0.2f + 0.05f * 0.25f) == 0);  // just past the border at 0.25: held (2 % of a slot)
    EXPECT(r.cv(0.2f + 0.05f * 0.25f + 0.2f) == 1);
    r.cv(0.3f);
    EXPECT(r.cv(0.2495f) == 1);               // just under the border going down: held
    EXPECT(r.cv(0.2f) == 0);
    Rig b;
    b.p.steps = 2;
    b.p.bipolar = true;
    EXPECT(b.cv(-0.5f) == 0);
    EXPECT(b.cv(0.5f) == 1);
    EXPECT(b.cv(std::nanf("")) == 0);
}

static void countOrders() {
    TEST("index: Count orders, Wrap and Stop, Reset");
    Rig f;
    f.p.mode = dsp::IndexCount;
    f.p.steps = 4;
    f.run();
    std::vector<int> seq{f.step};
    for (int i = 0; i < 5; ++i) seq.push_back(f.up());
    EXPECT((seq == std::vector<int>{0, 1, 2, 3, 0, 1}));
    EXPECT(f.down() == 0);
    EXPECT(f.down() == 3);
    Rig st;
    st.p.mode = dsp::IndexCount;
    st.p.steps = 3;
    st.p.stop = true;
    st.run();
    for (int i = 0; i < 5; ++i) st.up();
    EXPECT(st.step == 2);
    for (int i = 0; i < 5; ++i) st.down();
    EXPECT(st.step == 0);
    Rig b;
    b.p.mode = dsp::IndexCount;
    b.p.order = dsp::SlotBackward;
    b.p.steps = 4;
    b.run();
    EXPECT(b.step == 3);
    EXPECT(b.up() == 2);
    EXPECT(b.down() == 3);
    Rig pp;
    pp.p.mode = dsp::IndexCount;
    pp.p.order = dsp::SlotPingPong;
    pp.p.steps = 4;
    pp.run();
    std::vector<int> ps{pp.step};
    for (int i = 0; i < 6; ++i) ps.push_back(pp.up());
    EXPECT((ps == std::vector<int>{0, 1, 2, 3, 2, 1, 0}));
    Rig rnd;
    rnd.p.mode = dsp::IndexCount;
    rnd.p.order = dsp::SlotRandom;
    rnd.p.steps = 32;
    rnd.run();
    int prev = rnd.step;
    bool repeats = false, inRange = true;
    for (int i = 0; i < 200; ++i) {
        const int s = rnd.up();
        repeats |= s == prev;
        inRange &= s >= 0 && s < 32;
        prev = s;
    }
    EXPECT(!repeats && inRange);
    f.up();
    f.up();
    EXPECT(f.reset() == 0);
    // Reset wins over Up on the same sample.
    f.clk.up = 1.0f;
    f.clk.reset = 1.0f;
    f.run();
    EXPECT(f.step == 0);
}

static void transport() {
    TEST("index: transport mode is a function of the tick");
    Rig r;
    r.p.mode = dsp::IndexCount;
    r.p.steps = 5;
    r.clk.transport = true;
    r.clk.playing = true;
    r.clk.tick = 7;
    EXPECT(r.run() == 2);  // the first sample follows the song
    r.clk.tick = 12;
    EXPECT(r.run() == 2);
    r.clk.tick = 13;
    EXPECT(r.run() == 3);
    r.clk.playing = false;
    r.clk.tick = 99;
    EXPECT(r.run() == 3);  // stopped: holds
    Rig a, b;
    for (Rig* x : {&a, &b}) {
        x->p.mode = dsp::IndexCount;
        x->p.order = dsp::SlotRandom;
        x->p.steps = 7;
        x->clk.transport = x->clk.playing = true;
    }
    a.clk.tick = 100;
    a.run();
    for (int t = 90; t <= 100; ++t) { b.clk.tick = t; b.run(); }
    EXPECT(a.step == b.step);
}

static void gates() {
    TEST("index: Gates, one-hot with the highest winning");
    Rig r;
    r.p.mode = dsp::IndexGates;
    r.p.steps = 8;
    r.p.gates = 3;
    r.p.defaultStep = 5;
    EXPECT(r.run() == 5);
    r.gate[0] = 1.0f;
    EXPECT(r.run() == 0);
    r.gate[2] = 1.0f;
    EXPECT(r.run() == 2);
    r.gate[3] = 1.0f;  // beyond Gate Inputs
    EXPECT(r.run() == 2);
    r.gate[2] = 0.0f;
    r.gate[3] = 0.0f;
    EXPECT(r.run() == 0);
    r.gate[0] = 0.0f;
    EXPECT(r.run() == 5);
    Rig s;
    s.p.mode = dsp::IndexGates;
    s.p.steps = 2;
    s.p.gates = 4;
    s.gate[3] = 1.0f;  // step 3 does not exist with 2 steps
    EXPECT(s.run() == 0);
}

static void binary() {
    TEST("index: Binary, sums clamp at steps - 1");
    Rig r;
    r.p.mode = dsp::IndexBinary;
    r.p.steps = 8;
    r.p.gates = 3;
    EXPECT(r.run() == 0);
    r.gate[0] = 1.0f;
    EXPECT(r.run() == 1);
    r.gate[1] = 1.0f;
    EXPECT(r.run() == 3);
    r.gate[2] = 1.0f;
    EXPECT(r.run() == 7);
    r.p.steps = 6;
    EXPECT(r.run() == 5);
    Rig t;
    t.p.mode = dsp::IndexBinary;
    t.p.steps = 2;
    t.p.gates = 1;
    EXPECT(t.run() == 0);
    t.gate[0] = 1.0f;
    EXPECT(t.run() == 1);
}

static void offsetAndChanged() {
    TEST("index: Offset wraps, Changed fires only on a change, fewer steps clamp");
    Rig r;
    r.p.steps = 4;
    r.cv(0.375f);  // step 1
    r.p.offset = 0.5f;  // + 2
    EXPECT(r.run() == 3);
    r.p.offset = 0.75f;  // + 3 → wraps
    EXPECT(r.run() == 0);
    Rig c;
    c.p.steps = 4;
    c.cv(0.1f);
    EXPECT(!c.changed);
    c.cv(0.1f);
    EXPECT(!c.changed);
    c.cv(0.6f);
    EXPECT(c.changed);
    c.cv(0.6f);
    EXPECT(!c.changed);
    Rig d;
    d.p.mode = dsp::IndexBinary;
    d.p.steps = 8;
    d.p.gates = 3;
    d.gate[2] = 1.0f;
    EXPECT(d.run() == 4);
    d.p.steps = 3;
    EXPECT(d.run() == 2);
}

static void roundTrip() {
    TEST("index: Out = i / (steps - 1) round-trips through the target's rounding");
    bool ok = true;
    for (int n = 2; n <= dsp::kMaxIndexSteps; ++n)
        for (int i = 0; i < n; ++i) {
            const float v = (float)i / (float)(n - 1);
            ok &= (int)std::lround(v * (float)(n - 1)) == i;
        }
    EXPECT(ok);
}

int main() {
    cvBands();
    countOrders();
    transport();
    gates();
    binary();
    offsetAndChanged();
    roundTrip();
    return bleep::test::finish("index");
}
