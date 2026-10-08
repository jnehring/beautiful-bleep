// SPDX-License-Identifier: MIT
// Rotating Div: divisions and rotation per Set, transport timing (straight,
// dotted, triplet, loop jumps), Realign, Rotate Sync, Clock mode, Width,
// Trigger output, Stair, Align and transport stop.
#include "RotatingDividerDsp.h"

#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep;
using patch::RdInput;
using patch::RdOutputs;
using patch::RdParams;
using patch::RotatingDividerDsp;

static constexpr double kSr = 48000.0;

struct Rig {
    RotatingDividerDsp dsp;
    RdParams p;
    RdInput in;
    RdOutputs out;
    float last[8]{};
    std::vector<int64_t> rises[8];
    std::vector<int64_t> aligns;
    int64_t t = 0;
    Rig() {
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
        if (out.align > 0.5f) aligns.push_back(t);
        ++t;
    }
    /// Transport: plays from `ppq` for n samples.
    void play(int64_t n) {
        for (int64_t i = 0; i < n; ++i) {
            tick();
            in.ppq += in.ppqPerSample;
        }
    }
    /// The base step at sample s.
    double stepAt(int64_t s, double startPpq = 0.0) const { return (startPpq + (double)s * in.ppqPerSample) / p.baseBeats; }
    void clear() {
        for (auto& r : rises) r.clear();
        aligns.clear();
    }
};

static void sets() {
    TEST("rotating div: sets and rotation");
    int d[8];
    auto is = [&](std::initializer_list<int> want) {
        int k = 0;
        for (int w : want)
            if (d[k++] != w) return false;
        return true;
    };
    patch::rdDivisions(patch::RdIntegers, 0, false, nullptr, d);
    EXPECT(is({1, 2, 3, 4, 5, 6, 7, 8}));
    patch::rdDivisions(patch::RdIntegers, 1, false, nullptr, d);
    EXPECT(is({2, 3, 4, 5, 6, 7, 8, 1}));
    patch::rdDivisions(patch::RdIntegers, 8, false, nullptr, d);
    EXPECT(is({1, 2, 3, 4, 5, 6, 7, 8}));
    patch::rdDivisions(patch::RdIntegers, 4, true, nullptr, d);
    EXPECT(is({5, 6, 7, 8, 9, 10, 11, 12}));
    patch::rdDivisions(patch::RdOdds, 0, false, nullptr, d);
    EXPECT(is({1, 3, 5, 7, 9, 11, 13, 15}));
    patch::rdDivisions(patch::RdEvens, 0, false, nullptr, d);
    EXPECT(is({2, 4, 6, 8, 10, 12, 14, 16}));
    patch::rdDivisions(patch::RdPrimes, 0, false, nullptr, d);
    EXPECT(is({1, 2, 3, 5, 7, 11, 13, 17}));
    patch::rdDivisions(patch::RdPowers, 0, false, nullptr, d);
    EXPECT(is({1, 2, 4, 8, 16, 32, 64, 128}));
    patch::rdDivisions(patch::RdPowers, 4, true, nullptr, d);
    EXPECT(is({16, 32, 64, 128, 256, 512, 1024, 2048}));
    patch::rdDivisions(patch::RdPowers, 16, true, nullptr, d);
    for (int v : d) EXPECT(v == 4096);  // capped
    patch::rdDivisions(patch::RdFibonacci, 0, false, nullptr, d);
    EXPECT(is({1, 2, 3, 5, 8, 13, 21, 34}));
    const int custom[8] = {1, 2, 3, 4, 6, 8, 12, 16};
    patch::rdDivisions(patch::RdCustom, 2, true, custom, d);  // Custom always wraps
    EXPECT(is({3, 4, 6, 8, 12, 16, 1, 2}));
}

static void transportTiming() {
    TEST("rotating div: transport timing");
    for (int rate : {9, 8, 10}) {  // 1/16, 1/16., 1/16T
        Rig r;
        r.p.baseBeats = dsp::sequencerRateBeats(rate);
        const int64_t n = (int64_t)(4.0 / r.in.ppqPerSample);  // one bar
        r.play(n);
        for (int k = 0; k < 8; ++k) {
            const int d = k + 1;
            const int64_t expected = (int64_t)std::floor(r.stepAt(n - 1) / d + 1e-9) + 1;
            EXPECT((int64_t)r.rises[k].size() == expected);
            for (int64_t at : r.rises[k]) {
                // A rise on the first sample at or after a multiple of d base steps.
                const double x = r.stepAt(at), xp = r.stepAt(at - 1);
                EXPECT(std::floor(x / d + 1e-9) != std::floor(xp / d + 1e-9) || at == 0);
            }
        }
    }
    // After a loop jump the outputs fire on the same samples as the first pass.
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
        for (size_t i = 0; i < a.rises[k].size() && i < b.rises[k].size(); ++i)
            EXPECT(a.rises[k][i] - ta == b.rises[k][i] - tb);
    }
    // Jumping onto a bar line fires the outputs whose cycle starts there.
    Rig c;
    c.play(5000);
    c.clear();
    c.in.ppq = 4.0;
    c.play(2);
    for (int k = 0; k < 8; ++k) EXPECT(c.rises[k].size() == (16 % (k + 1) == 0 ? 1u : 0u));
}

static void realign() {
    TEST("rotating div: realign");
    Rig r;
    r.p.realign = 1;
    r.p.width = 0.99f;
    const int64_t n = (int64_t)(8.0 / r.in.ppqPerSample);
    std::vector<int64_t> fallsBeforeDownbeat;
    for (int64_t i = 0; i < n; ++i) {
        const float before = r.last[2];
        r.tick();
        if (before > 0.5f && r.out.out[2] <= 0.5f) fallsBeforeDownbeat.push_back(r.t - 1);
        r.in.ppq += r.in.ppqPerSample;
    }
    // /3 at 1/16: steps 0, 3, 6, 9, 12, 15, then 0 of the next bar.
    std::vector<int> steps;
    for (int64_t at : r.rises[2]) steps.push_back((int)std::lround(r.stepAt(at)) % 16);
    EXPECT((steps == std::vector<int>{0, 3, 6, 9, 12, 15, 0, 3, 6, 9, 12, 15}));
    // The shortened gate (step 15, one step long) falls ≥ 1 ms before the downbeat.
    const int64_t downbeat = (int64_t)std::ceil(4.0 / r.in.ppqPerSample);
    bool found = false;
    for (int64_t f : fallsBeforeDownbeat)
        if (f < downbeat && f > downbeat - (int64_t)(0.125 * kSr)) {
            found = true;
            EXPECT(downbeat - f >= (int64_t)(0.001 * kSr) - 1);
        }
    EXPECT(found);
    // Align: every bar.
    EXPECT(r.aligns.size() == 2);
}

static void rotateSync() {
    TEST("rotating div: rotate sync");
    Rig r;  // Next Step
    const int64_t step = (int64_t)(0.25 / r.in.ppqPerSample);  // 6000 samples
    r.play(step / 2);
    r.p.rotate = 1;
    r.play(10);
    EXPECT(r.dsp.hasPending() && r.dsp.divisions()[0] == 1);
    r.play(step / 2 - 10);  // just before the boundary
    EXPECT(r.dsp.divisions()[0] == 1);
    r.play(1);
    EXPECT(r.dsp.divisions()[0] == 2 && !r.dsp.hasPending());
    // A superseded pending change never applies.
    r.play(step / 2);
    r.p.rotate = 3;
    r.play(10);
    r.p.rotate = 1;  // back: nothing pending
    r.play(step);
    EXPECT(r.dsp.divisions()[0] == 2);
    // A high gate is not cut: /8 (Out 8 = /1 after rotate 1 … ) rotate with Immediate mid-gate.
    Rig g;
    g.p.sync = patch::RdImmediate;
    g.p.width = 0.9f;
    g.play(step * 4 + 10);  // Out 4 (/4) rose at step 4 and is high for 3.6 steps
    EXPECT(g.out.out[3] > 0.5f);
    g.p.rotate = 4;  // Out 4 becomes /8: still high until its old end
    int64_t highFor = 0;
    for (int i = 0; i < step * 4; ++i) {
        g.play(1);
        if (g.out.out[3] > 0.5f) ++highFor;
        else break;
    }
    EXPECT(std::abs(highFor - (int64_t)(3.6 * step) + 10) <= 2);
    // Next Bar waits for the bar line.
    Rig b;
    b.p.sync = patch::RdNextBar;
    b.play(step);
    b.p.rotate = 2;
    b.play(step * 14);
    EXPECT(b.dsp.divisions()[0] == 1);
    b.play(step * 2);
    EXPECT(b.dsp.divisions()[0] == 3);
}

static void clockMode() {
    TEST("rotating div: clock mode");
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
    int high = 0;
    r.clear();
    // Reset and Clock on one sample: n = 0 (every output fires).
    for (int i = 0; i < period; ++i) {
        r.in.clock = i < 10 ? 1.0f : 0.0f;
        r.in.reset = i < 10 ? 1.0f : 0.0f;
        r.tick();
        if (r.out.out[3] > 0.5f) ++high;
    }
    // (/7 was still high from n = 21: it dips for one sample.)
    for (int k = 0; k < 8; ++k) EXPECT(r.rises[k].size() == 1 && r.rises[k][0] - (r.t - period) == (k == 6 ? 1 : 0));
    EXPECT(r.aligns.size() == 1);
    EXPECT(high == period);  // /4: 0.5 · 4 · T = 2000 samples, still high at the next pulse
    r.in.reset = 0.0f;
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

static void stairAndWidth() {
    TEST("rotating div: stair, width and stop");
    Rig r;
    r.p.width = 0.25f;
    const int64_t step = (int64_t)(0.25 / r.in.ppqPerSample);
    r.play(step / 8);  // everything rose at 0; /1 is high for a quarter step
    float expect = 0.0f;
    for (int k = 0; k < 8; ++k)
        if (r.out.out[k] > 0.5f) expect += (float)(1 << (7 - k));
    EXPECT_NEAR(r.out.stair, expect / 255.0f, 1e-6);
    EXPECT_NEAR(r.out.stair, 1.0, 1e-6);
    r.play(step / 4);  // /1 has ended (0.25 steps)
    EXPECT(r.out.out[0] < 0.5f && r.out.out[1] > 0.5f);
    // Base Step width: every output high for a quarter step.
    Rig b;
    b.p.width = 0.25f;
    b.p.gateBase = true;
    b.play(step / 2);
    for (int k = 0; k < 8; ++k) EXPECT(b.out.out[k] < 0.5f);
    // Stop: all low, stair 0; restart mid-step: no pulse.
    r.in.running = false;
    r.tick();
    for (int k = 0; k < 8; ++k) EXPECT(r.out.out[k] < 0.5f);
    EXPECT(r.out.stair == 0.0f);
    r.clear();
    r.in.running = true;
    r.in.ppq = 0.3;
    r.tick();
    r.tick();
    for (int k = 0; k < 8; ++k) EXPECT(r.rises[k].empty());
}

int main() {
    sets();
    transportTiming();
    realign();
    rotateSync();
    clockMode();
    stairAndWidth();
    return bleep::test::finish("rotating-divider");
}
