// SPDX-License-Identifier: GPL-3.0-only
// Clock Div: per-output divisions, transport timing (straight, dotted,
// triplet, loop jumps), Realign, division changes, Clock mode, Width,
// Trigger output, Reset and transport stop.
#include "ClockDividerDsp.h"

#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep;
using patch::CdInput;
using patch::CdOutputs;
using patch::CdParams;
using patch::ClockDividerDsp;

static constexpr double kSr = 48000.0;

struct Rig {
    ClockDividerDsp dsp;
    CdParams p;
    CdInput in;
    CdOutputs out;
    float last[8]{};
    std::vector<int64_t> rises[8];
    int64_t t = 0;
    Rig() {
        for (int k = 0; k < 8; ++k) p.div[k] = k + 1;
        dsp.prepare(kSr);
        dsp.reset();
        in.running = true;
        in.bpm = 120.0;
        in.ppqPerSample = in.bpm / 60.0 / kSr;
    }
    void tick() {
        in.started = t == 0;
        dsp.tick(p, in, out);
        for (int k = 0; k < 8; ++k) {
            if (out.out[k] > 0.5f && last[k] <= 0.5f) rises[k].push_back(t);
            last[k] = out.out[k];
        }
        ++t;
    }
    void play(int64_t n) {
        for (int64_t i = 0; i < n; ++i) {
            tick();
            in.ppq += in.ppqPerSample;
        }
    }
    double stepAt(int64_t s, double startPpq = 0.0) const { return (startPpq + (double)s * in.ppqPerSample) / p.baseBeats; }
    void clear() {
        for (auto& r : rises) r.clear();
    }
};

static void transportTiming() {
    TEST("clock div: transport timing");
    for (int rate : {9, 8, 10}) {  // 1/16, 1/16., 1/16T
        Rig r;
        r.p.baseBeats = dsp::sequencerRateBeats(rate);
        r.p.div[0] = 1;
        r.p.div[1] = 2;
        r.p.div[2] = 3;
        r.p.div[3] = 7;
        r.p.div[4] = 16;
        r.p.div[5] = 64;
        const int64_t n = (int64_t)(4.0 / r.in.ppqPerSample);  // one bar
        r.play(n);
        for (int k = 0; k < 6; ++k) {
            const int d = r.p.div[k];
            const int64_t expected = (int64_t)std::floor(r.stepAt(n - 1) / d + 1e-9) + 1;
            EXPECT((int64_t)r.rises[k].size() == expected);
            for (int64_t at : r.rises[k]) {
                const double x = r.stepAt(at), xp = r.stepAt(at - 1);
                EXPECT(std::floor(x / d + 1e-9) != std::floor(xp / d + 1e-9) || at == 0);
            }
        }
    }
    // A loop jump lands on the same samples as the first pass.
    Rig a, b;
    a.play((int64_t)(2.0 / a.in.ppqPerSample));
    a.in.ppq = 1.0;
    a.clear();
    b.play((int64_t)(1.0 / b.in.ppqPerSample));
    b.in.ppq = 1.0;
    b.clear();
    const int64_t ta = a.t, tb = b.t;
    a.play(48000);
    b.play(48000);
    for (int k = 0; k < 8; ++k) {
        EXPECT(a.rises[k].size() == b.rises[k].size() && !a.rises[k].empty());
        for (size_t i = 0; i < a.rises[k].size() && i < b.rises[k].size(); ++i) EXPECT(a.rises[k][i] - ta == b.rises[k][i] - tb);
    }
    // Jumping onto a bar line fires the outputs whose cycle starts there.
    Rig c;
    c.play(5000);
    c.clear();
    c.in.ppq = 4.0;
    c.play(2);
    for (int k = 0; k < 8; ++k) EXPECT(c.rises[k].size() == (16 % (k + 1) == 0 ? 1u : 0u));
    // Out-of-range divisions are clamped to 1…64.
    Rig d;
    d.p.div[0] = 0;
    d.p.div[1] = 500;
    d.play((int64_t)(4.0 / d.in.ppqPerSample));
    EXPECT(d.rises[0].size() == 16);  // /1
    EXPECT(d.rises[1].size() == 1);   // /64: one cycle in a bar
}

static void realign() {
    TEST("clock div: realign");
    Rig r;
    r.p.realign = 1;
    r.p.width = 0.99f;
    const int64_t n = (int64_t)(8.0 / r.in.ppqPerSample);
    std::vector<int64_t> falls;
    for (int64_t i = 0; i < n; ++i) {
        const float before = r.last[2];
        r.tick();
        if (before > 0.5f && r.out.out[2] <= 0.5f) falls.push_back(r.t - 1);
        r.in.ppq += r.in.ppqPerSample;
    }
    // /3 at 1/16: steps 0, 3, 6, 9, 12, 15, then 0 of the next bar.
    std::vector<int> steps;
    for (int64_t at : r.rises[2]) steps.push_back((int)std::lround(r.stepAt(at)) % 16);
    EXPECT((steps == std::vector<int>{0, 3, 6, 9, 12, 15, 0, 3, 6, 9, 12, 15}));
    // The shortened gate (step 15) falls ≥ 1 ms before the downbeat.
    const int64_t downbeat = (int64_t)std::ceil(4.0 / r.in.ppqPerSample);
    bool found = false;
    for (int64_t f : falls)
        if (f < downbeat && f > downbeat - (int64_t)(0.125 * kSr)) {
            found = true;
            EXPECT(downbeat - f >= (int64_t)(0.001 * kSr) - 1);
        }
    EXPECT(found);
}

static void divisionChange() {
    TEST("clock div: a division change never cuts a high gate");
    Rig g;
    g.p.width = 0.9f;
    const int64_t step = (int64_t)(0.25 / g.in.ppqPerSample);
    g.play(step * 4 + 10);  // Out 4 (/4) rose at step 4 and is high for 3.6 steps
    EXPECT(g.out.out[3] > 0.5f);
    g.p.div[3] = 8;
    int64_t highFor = 0;
    for (int i = 0; i < step * 4; ++i) {
        g.play(1);
        if (g.out.out[3] > 0.5f) ++highFor;
        else break;
    }
    EXPECT(std::abs(highFor - (int64_t)(3.6 * step) + 10) <= 2);
    // From there the output runs at its new division.
    g.clear();
    g.play(step * 16);
    EXPECT(g.rises[3].size() == 2);
}

static void clockMode() {
    TEST("clock div: clock mode");
    Rig r;
    r.in.clocked = true;
    const int period = 1000;
    auto runPulses = [&](int pulses, bool resetFirst) {
        for (int k = 0; k < pulses; ++k)
            for (int i = 0; i < period; ++i) {
                r.in.clock = i < 10 ? 1.0f : 0.0f;
                r.in.reset = resetFirst && k == 0 && i < 10 ? 1.0f : 0.0f;
                r.tick();
            }
    };
    runPulses(24, false);
    for (int k = 0; k < 8; ++k) EXPECT((int)r.rises[k].size() == 24 / (k + 1) + (24 % (k + 1) ? 1 : 0));
    // Reset and Clock on one sample: n = 0, every output fires.
    r.clear();
    for (int i = 0; i < period; ++i) {
        r.in.clock = i < 10 ? 1.0f : 0.0f;
        r.in.reset = i < 10 ? 1.0f : 0.0f;
        r.tick();
    }
    for (int k = 0; k < 8; ++k) EXPECT(r.rises[k].size() == 1);
    r.in.reset = 0.0f;
    // Gate length follows the measured period: /4 at Width 0.5 is 2 · 1000 samples.
    r.clear();
    int high = 0;
    for (int i = 0; i < period * 4; ++i) {
        r.in.clock = i % period < 10 ? 1.0f : 0.0f;
        r.tick();
        if (r.out.out[3] > 0.5f) ++high;
    }
    EXPECT(std::abs(high - 2 * period) <= 2);
    // Trigger output: one-sample pulses.
    r.p.trigger = true;
    r.clear();
    int ones = 0;
    for (int i = 0; i < period * 2; ++i) {
        r.in.clock = i % period < 10 ? 1.0f : 0.0f;
        r.tick();
        if (r.out.out[0] > 0.5f) ++ones;
    }
    EXPECT(ones == 2);
}

static void widthAndStop() {
    TEST("clock div: width, reset and stop");
    Rig r;
    r.p.width = 0.25f;
    const int64_t step = (int64_t)(0.25 / r.in.ppqPerSample);
    r.play(step / 8);  // everything rose at 0
    for (int k = 0; k < 8; ++k) EXPECT(r.out.out[k] > 0.5f);
    r.play(step / 4);  // /1 (0.25 steps) has ended, /2 is still high
    EXPECT(r.out.out[0] < 0.5f && r.out.out[1] > 0.5f);
    // Base Step width: every output high for a quarter step.
    Rig b;
    b.p.width = 0.25f;
    b.p.gateBase = true;
    b.play(step / 2);
    for (int k = 0; k < 8; ++k) EXPECT(b.out.out[k] < 0.5f);
    // Reset: the next base step starts every output's cycle.
    Rig s;
    s.play(step * 2 + step / 2);  // mid step 2
    s.clear();
    s.in.reset = 1.0f;
    s.play(10);
    s.in.reset = 0.0f;
    s.play(step);
    for (int k = 1; k < 8; ++k) EXPECT(s.rises[k].size() == 1);
    // Stop: all low; restart mid-step: no pulse.
    r.in.running = false;
    r.tick();
    for (int k = 0; k < 8; ++k) EXPECT(r.out.out[k] < 0.5f);
    r.clear();
    r.in.running = true;
    r.in.ppq = 0.3;
    r.tick();
    r.tick();
    for (int k = 0; k < 8; ++k) EXPECT(r.rises[k].empty());
}

int main() {
    transportTiming();
    realign();
    divisionChange();
    clockMode();
    widthAndStop();
    return bleep::test::finish("clock-divider");
}
