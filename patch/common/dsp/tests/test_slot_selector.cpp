// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Slot selector (Select and Route): the stepping orders, Next/Reset, Select
// slots with hysteresis, Trig k, transport mode and fades that never jump.
#include "dsp/SlotSelector.h"

#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep;
using dsp::SlotClock;
using dsp::SlotFrame;
using dsp::SlotParams;
using dsp::SlotSelector;

static constexpr double kSr = 48000.0;

struct Rig {
    SlotSelector s;
    SlotParams p;
    SlotClock clk;
    SlotFrame f;
    Rig() {
        s.prepare(kSr);
        s.reset();
        p.fade = 0.0f;
    }
    void run(int n = 1) {
        for (int i = 0; i < n; ++i) s.tick(clk, p, f);
    }
    /// A Next pulse: one sample high, two low.
    void next() {
        clk.next = 1.0f;
        run();
        clk.next = 0.0f;
        run(2);
    }
    void pulse(float& v) {
        v = 1.0f;
        run();
        v = 0.0f;
        run(2);
    }
};

static std::vector<int> sequence(Rig& r, int steps) {
    std::vector<int> out{r.s.position()};
    for (int i = 0; i < steps; ++i) {
        r.next();
        out.push_back(r.s.position());
    }
    return out;
}

static void orders() {
    TEST("slot selector: orders");
    Rig r;
    r.run();
    EXPECT((sequence(r, 5) == std::vector<int>{0, 1, 2, 3, 0, 1}));
    Rig b;
    b.p.order = dsp::SlotBackward;
    b.run();
    EXPECT((sequence(b, 4) == std::vector<int>{3, 2, 1, 0, 3}));
    Rig pp;
    pp.p.order = dsp::SlotPingPong;
    pp.run();
    EXPECT((sequence(pp, 7) == std::vector<int>{0, 1, 2, 3, 2, 1, 0, 1}));
    Rig rnd;
    rnd.p.order = dsp::SlotRandom;
    rnd.run();
    int prev = rnd.s.position();
    bool repeats = false, inRange = true;
    for (int i = 0; i < 200; ++i) {
        rnd.next();
        const int pos = rnd.s.position();
        repeats |= pos == prev;
        inRange &= pos >= 0 && pos < 4;
        prev = pos;
    }
    EXPECT(!repeats);
    EXPECT(inRange);
}

static void resetAndTrig() {
    TEST("slot selector: reset wins over next, Trig k jumps");
    Rig r;
    r.run();
    r.next();
    r.next();
    EXPECT(r.s.position() == 2);
    r.clk.next = r.clk.reset = 1.0f;
    r.run();
    EXPECT(r.s.position() == 0);
    r.clk.next = r.clk.reset = 0.0f;
    r.run(2);
    float trig[dsp::kMaxSlots] = {};
    r.clk.trig = trig;
    r.clk.trigs = 4;
    r.pulse(trig[2]);
    EXPECT(r.s.position() == 2);
    r.next();  // continues from the triggered slot
    EXPECT(r.s.position() == 3);
    r.pulse(trig[0]);
    EXPECT(r.s.position() == 0);
    // Triggers beyond `trigs` are ignored.
    r.clk.trigs = 2;
    r.pulse(trig[3]);
    EXPECT(r.s.position() == 0);
}

static void selectSlots() {
    TEST("slot selector: Select picks slots, 2 % hysteresis");
    Rig r;
    for (int k = 0; k < 4; ++k) {
        r.p.select = ((float)k + 0.5f) / 4.0f;
        r.run();
        EXPECT(r.s.position() == k);
    }
    // 1 % of a slot past the border into slot 3 doesn't move it back; well past does.
    r.p.select = 0.75f - 0.01f * 0.25f;
    r.run();
    EXPECT(r.s.position() == 3);
    r.p.select = 0.75f - 0.05f * 0.25f;
    r.run();
    EXPECT(r.s.position() == 2);
    // Select adds to the stepping position.
    Rig a;
    a.p.select = 0.3f;  // slot 1
    a.run();
    a.next();
    EXPECT(a.s.position() == 2);
}

static void transport() {
    TEST("slot selector: transport mode is a function of the tick");
    Rig r;
    r.clk.transport = r.clk.playing = true;
    r.clk.tick = 0;
    r.run();
    EXPECT(r.s.position() == 0);
    r.clk.tick = 5;
    r.run();
    EXPECT(r.s.position() == 1);
    Rig q;  // a different route to the same tick gives the same slot
    q.clk.transport = q.clk.playing = true;
    q.p.order = dsp::SlotRandom;
    r.p.order = dsp::SlotRandom;
    q.clk.tick = 40;
    q.run();
    for (int64_t t = 0; t <= 40; ++t) {
        r.clk.tick = t;
        r.run();
    }
    EXPECT(r.s.position() == q.s.position());
}

static void fades() {
    TEST("slot selector: fades");
    Rig r;
    r.p.fade = 0.002f;
    r.p.curve = dsp::SlotLinear;
    r.run();
    EXPECT_NEAR(r.f.gain[0], 1.0, 1e-6);
    r.clk.next = 1.0f;
    r.run();
    r.clk.next = 0.0f;
    r.run((int)(0.001 * kSr) - 1);  // halfway through a 2 ms fade
    EXPECT_NEAR(r.f.gain[0], 0.5, 0.02);
    EXPECT_NEAR(r.f.gain[1], 0.5, 0.02);
    // A second change mid-fade never jumps, and the linear gains always add up to 1.
    float last = r.f.gain[1];
    r.clk.next = 1.0f;
    r.run();
    r.clk.next = 0.0f;
    float maxJump = std::fabs(r.f.gain[1] - last), maxErr = 0.0f;
    for (int i = 0; i < 200; ++i) {
        last = r.f.gain[1];
        r.run();
        maxJump = std::max(maxJump, std::fabs(r.f.gain[1] - last));
        float sum = 0.0f;
        for (float g : r.f.gain) sum += g;
        maxErr = std::max(maxErr, std::fabs(sum - 1.0f));
    }
    EXPECT(maxJump < 0.02f);
    EXPECT(maxErr < 1e-4f);
    // Fade 0 switches on the sample of the change.
    Rig h;
    h.run();
    h.clk.next = 1.0f;
    h.run();
    EXPECT(h.f.gain[1] == 1.0f);
    EXPECT(h.f.gain[0] == 0.0f);
    EXPECT(h.f.changed);
    // Equal power keeps the power constant at the half-way point.
    Rig e;
    e.p.fade = 0.002f;
    e.run();
    e.clk.next = 1.0f;
    e.run();
    e.clk.next = 0.0f;
    e.run((int)(0.001 * kSr) - 1);
    EXPECT_NEAR(e.f.gain[0] * e.f.gain[0] + e.f.gain[1] * e.f.gain[1], 1.0, 0.03);
}

static void fewerSlots() {
    TEST("slot selector: shrinking the slot count wraps the position");
    Rig r;
    r.p.slots = 8;
    r.run();
    for (int i = 0; i < 6; ++i) r.next();
    EXPECT(r.s.position() == 6);
    r.p.slots = 4;
    r.run(2);
    EXPECT(r.s.position() == 2);
}

int main() {
    orders();
    resetAndTrig();
    selectSlots();
    transport();
    fades();
    fewerSlots();
    return bleep::test::finish("slot-selector");
}
