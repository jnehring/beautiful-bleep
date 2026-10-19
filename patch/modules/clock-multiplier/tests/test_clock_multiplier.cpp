// SPDX-License-Identifier: GPL-3.0-or-later
// Clock Mult: ratios on the transport (whole and fractional), loop jumps,
// skips, swing and humanize (anchors never move), Clock mode, Phase Lock,
// Reset, Width, Trigger output and transport stop.
#include "ClockMultiplierDsp.h"

#include "dsp/tests/TestUtil.h"

#include <string>
#include <vector>

using namespace bleep;
using patch::CmInput;
using patch::CmOutputs;
using patch::CmParams;
using patch::ClockMultiplierDsp;

static constexpr double kSr = 48000.0;

static int ratioIndex(const char* name) {
    for (int i = 0; i < patch::kCmRatios; ++i)
        if (std::string(patch::cmRatios()[i].name) == name) return i;
    return 0;
}

struct Rig {
    ClockMultiplierDsp dsp;
    CmParams p;
    CmInput in;
    CmOutputs out;
    float last[6]{};
    std::vector<int64_t> rises[6];
    int64_t t = 0;
    Rig() {
        p.trigger = true;
        dsp.prepare(kSr);
        dsp.reset();
        in.running = true;
        in.ppqPerSample = 120.0 / 60.0 / kSr;  // 120 BPM
    }
    void setRatios(std::initializer_list<const char*> names) {
        int k = 0;
        for (const char* n : names) p.ratio[k++] = ratioIndex(n);
    }
    void tick() {
        in.started = t == 0;
        dsp.tick(p, in, out);
        for (int k = 0; k < 6; ++k) {
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
    /// Samples in one input clock (base 1 beat at 120 BPM = 0.5 s).
    double clockSamples() const { return p.baseBeats / in.ppqPerSample; }
    void clear() {
        for (auto& r : rises) r.clear();
    }
};

static void transportRatios() {
    TEST("clock mult: transport ratios");
    Rig r;
    r.setRatios({"2", "3", "3/2", "5/4", "1/2", "1"});
    const double beat = r.clockSamples();
    r.play((int64_t)(4 * beat) - 1);  // four input clocks, x in [0, 4)
    const int expect[6] = {8, 12, 6, 5, 2, 4};
    for (int k = 0; k < 6; ++k) EXPECT((int)r.rises[k].size() == expect[k]);
    // The rises sit on the grid x = m * q / p.
    const auto& ra = patch::cmRatios()[r.p.ratio[3]];
    for (size_t m = 0; m < r.rises[3].size(); ++m) {
        const double want = (double)m * ra.q / ra.p * beat;
        EXPECT(std::fabs((double)r.rises[3][m] - want) <= 1.0);
    }
    // Anchors: the "1" output and the "2" output fire together on every clock.
    for (size_t m = 0; m < r.rises[5].size(); ++m) EXPECT(r.rises[0][2 * m] == r.rises[5][m]);
}

static void loopJump() {
    TEST("clock mult: a loop jump repeats the same ticks");
    Rig a, b;
    for (Rig* r : {&a, &b}) {
        r->setRatios({"3", "5/2", "7/4", "5/3", "2/3", "8"});
        r->p.swing = 0.6f;
        r->p.humanize = 0.5f;
        r->p.skip[0] = 0.3f;
    }
    a.play((int64_t)(8 * a.clockSamples()));
    b.play(12345);
    b.in.ppq = 0.0;  // loop back to the start
    b.clear();
    const int64_t tb = b.t;
    b.play((int64_t)(8 * b.clockSamples()));
    for (int k = 0; k < 6; ++k) {
        EXPECT(a.rises[k].size() == b.rises[k].size() && !a.rises[k].empty());
        for (size_t i = 0; i < a.rises[k].size() && i < b.rises[k].size(); ++i) EXPECT(a.rises[k][i] == b.rises[k][i] - tb);
    }
}

static void skips() {
    TEST("clock mult: skips");
    Rig a;
    a.setRatios({"4", "4", "4", "4", "4", "4"});
    a.p.skip[1] = 0.5f;
    a.p.skip[2] = 1.0f;
    a.p.keepBeat = false;
    const int64_t n = (int64_t)(64 * a.clockSamples()) - 1;
    a.play(n);
    EXPECT(a.rises[0].size() == 256);
    EXPECT(a.rises[1].size() > 90 && a.rises[1].size() < 166);  // about half of 256
    EXPECT(a.rises[2].empty());
    // Keep Beat: skip 100 % leaves exactly the anchors.
    Rig b;
    b.setRatios({"4", "4", "4", "4", "4", "4"});
    b.p.skip[0] = 1.0f;
    b.p.keepBeat = true;
    b.play(n);
    EXPECT(b.rises[0].size() == 64);
    for (size_t i = 0; i < b.rises[0].size(); ++i) EXPECT(std::fabs((double)b.rises[0][i] - (double)i * b.clockSamples()) <= 1.0);
    // The same seed drops the same ticks; another seed drops others.
    Rig c, d, e;
    for (Rig* r : {&c, &d, &e}) {
        r->setRatios({"4", "4", "4", "4", "4", "4"});
        r->p.skip[1] = 0.5f;
        r->p.keepBeat = false;
    }
    e.p.seed = 7;
    c.play(n);
    d.play(n);
    e.play(n);
    EXPECT(c.rises[1] == d.rises[1]);
    EXPECT(c.rises[1] != e.rises[1]);
}

static void swingAndHumanize() {
    TEST("clock mult: swing and humanize move only the in-between ticks");
    Rig r;
    r.setRatios({"2", "4", "4", "3/2", "2", "2"});
    r.p.swing = 1.0f;  // odd in-between ticks late by half an interval
    const double beat = r.clockSamples();
    r.play((int64_t)(4 * beat) - 1);
    for (size_t m = 0; m < r.rises[0].size(); ++m) {
        const double nominal = (double)m * 0.5 * beat;
        const double want = (m & 1) ? nominal + 0.25 * beat : nominal;
        EXPECT(std::fabs((double)r.rises[0][m] - want) <= 1.0);
    }
    // Ratio 4: ticks 0 (anchor), 1 (late), 2 (on time, in between), 3 (late).
    for (size_t m = 0; m < r.rises[1].size(); ++m) {
        const double nominal = (double)m * 0.25 * beat;
        const double want = (m & 1) ? nominal + 0.125 * beat : nominal;
        EXPECT(std::fabs((double)r.rises[1][m] - want) <= 1.0);
    }
    EXPECT(r.rises[0].size() == 8 && r.rises[1].size() == 16);
    // Humanize: anchors stay on the grid, the rest are late by up to 40 % of an interval.
    Rig h;
    h.setRatios({"4", "2", "2", "2", "2", "2"});
    h.p.humanize = 1.0f;
    h.play((int64_t)(16 * beat) - 1);
    bool moved = false;
    for (size_t m = 0; m < h.rises[0].size(); ++m) {
        const double nominal = (double)m * 0.25 * beat;
        const double late = (double)h.rises[0][m] - nominal;
        if (m % 4 == 0) EXPECT(std::fabs(late) <= 1.0);
        else {
            EXPECT(late >= -1.0 && late <= 0.4 * 0.25 * beat + 1.0);
            if (late > 2.0) moved = true;
        }
    }
    EXPECT(moved);
    EXPECT(h.rises[0].size() == 64);
    // Different seed, different offsets.
    Rig h2;
    h2.setRatios({"4", "2", "2", "2", "2", "2"});
    h2.p.humanize = 1.0f;
    h2.p.seed = 99;
    h2.play((int64_t)(16 * beat) - 1);
    EXPECT(h.rises[0] != h2.rises[0]);
}

struct ClockRig {
    ClockMultiplierDsp dsp;
    CmParams p;
    CmInput in;
    CmOutputs out;
    float last[6]{};
    std::vector<int64_t> rises[6];
    int64_t t = 0;
    ClockRig() {
        p.trigger = true;
        dsp.prepare(kSr);
        dsp.reset();
        in.clocked = true;
    }
    void tick() {
        dsp.tick(p, in, out);
        for (int k = 0; k < 6; ++k) {
            if (out.out[k] > 0.5f && last[k] <= 0.5f) rises[k].push_back(t);
            last[k] = out.out[k];
        }
        ++t;
    }
    /// n pulses with the given period; a Reset pulse accompanies pulse `resetAt`.
    void pulses(int n, int period, int resetAt = -1) {
        for (int k = 0; k < n; ++k)
            for (int i = 0; i < period; ++i) {
                in.clock = i < 10 ? 1.0f : 0.0f;
                in.reset = k == resetAt && i < 10 ? 1.0f : 0.0f;
                tick();
            }
    }
    void silence(int64_t n) {
        in.clock = 0.0f;
        in.reset = 0.0f;
        for (int64_t i = 0; i < n; ++i) tick();
    }
    void clear() {
        for (auto& v : rises) v.clear();
    }
};

static void clockMode() {
    TEST("clock mult: clock mode");
    ClockRig r;
    r.p.ratio[0] = ratioIndex("2");
    r.p.ratio[1] = ratioIndex("3");
    r.p.ratio[2] = ratioIndex("3/2");
    r.p.ratio[3] = ratioIndex("1/2");
    r.p.ratio[4] = ratioIndex("1");
    r.pulses(8, 1000);
    EXPECT(r.rises[4].size() == 8);
    // The pulse after the first period knows the period: ticks land on the half period.
    int half = 0;
    for (int64_t at : r.rises[0])
        if (at % 1000 != 0 && std::abs(at % 1000 - 500) <= 1) ++half;
    EXPECT(half >= 6);
    EXPECT(r.rises[0].size() >= 14);
    EXPECT(r.rises[1].size() >= 20 && r.rises[1].size() <= 24);
    EXPECT(r.rises[3].size() == 4);
    // Ratio 3/2: a tick every 2/3 clock once the period is known.
    for (size_t i = 4; i + 1 < r.rises[2].size() && i < 8; ++i) {
        const int64_t d = r.rises[2][i + 1] - r.rises[2][i];
        EXPECT(std::abs(d - 667) <= 2 || std::abs(d - 666) <= 2 || std::abs(d - 333) <= 2);
    }
}

static void phaseLock() {
    TEST("clock mult: phase lock");
    // Full lock: the clock stops, the multiplied output waits for it.
    ClockRig a;
    a.p.ratio[0] = ratioIndex("4");
    a.p.lock = 1.0f;
    a.pulses(6, 1000);
    a.clear();
    a.silence(10000);
    EXPECT(a.rises[0].size() <= 4);
    // No lock: a flywheel that goes on after the clock stops.
    ClockRig b;
    b.p.ratio[0] = ratioIndex("4");
    b.p.lock = 0.0f;
    b.pulses(6, 1000);
    b.clear();
    b.silence(10000);
    EXPECT(b.rises[0].size() >= 36);
    // Full lock follows a clock that is late by half a period: ticks stay on the pulses.
    ClockRig c;
    c.p.ratio[0] = ratioIndex("2");
    c.p.lock = 1.0f;
    c.pulses(6, 1000);
    c.silence(500);
    c.clear();
    c.pulses(4, 1000);
    EXPECT(!c.rises[0].empty());
    bool onPulse = false;
    for (int64_t at : c.rises[0]) onPulse = onPulse || (at - 0) % 1000 <= 2;
    EXPECT(onPulse);
    EXPECT(c.rises[0].size() >= 7);
}

static void resetAndStop() {
    TEST("clock mult: reset, width, trigger, stop");
    ClockRig r;
    r.p.ratio[0] = ratioIndex("2");
    r.p.trigger = false;
    r.p.width = 0.25f;
    r.pulses(6, 1000);
    int high = 0;
    for (int i = 0; i < 2000; ++i) {
        r.in.clock = i % 1000 < 10 ? 1.0f : 0.0f;
        r.tick();
        if (r.out.out[0] > 0.5f) ++high;
    }
    EXPECT(std::abs(high - 4 * 125) <= 8);  // 4 ticks in 2000 samples, a quarter of 500
    // Reset restarts the count: the next pulse is x = 0 and every output ticks.
    ClockRig s;
    s.p.ratio[0] = ratioIndex("3");
    s.pulses(5, 1000, 3);
    EXPECT(s.rises[0].size() == 13);  // 1, 1, then 3 per pulse
    bool at3000 = false;
    for (int64_t v : s.rises[0]) at3000 = at3000 || v == 3000;
    EXPECT(at3000);
    // Reset with a fractional ratio: the count restarts, so 3/2 ticks at 0 again.
    ClockRig f;
    f.p.ratio[0] = ratioIndex("3/2");
    f.pulses(3, 1000);
    f.clear();
    const int64_t t0 = f.t;
    f.pulses(2, 1000, 0);
    EXPECT(!f.rises[0].empty() && f.rises[0][0] == t0);
    // Transport stop: low and silent.
    Rig t;
    t.setRatios({"4", "2", "2", "2", "2", "2"});
    t.p.trigger = false;
    t.play(3000);
    t.in.running = false;
    t.play(10);
    EXPECT(t.out.out[0] < 0.5f);
    t.clear();
    t.play(48000);
    for (int k = 0; k < 6; ++k) EXPECT(t.rises[k].empty());
    // Reset on the transport: the next input clock is x = 0.
    Rig u;
    u.setRatios({"2", "2", "2", "2", "2", "2"});
    u.play((int64_t)(1.3 * u.clockSamples()));
    u.clear();
    u.in.reset = 1.0f;
    u.play(10);
    u.in.reset = 0.0f;
    const int64_t tReset = u.t;
    u.play((int64_t)(2 * u.clockSamples()));
    EXPECT(!u.rises[0].empty());
    EXPECT(std::fabs((double)(u.rises[0][0] - tReset) - 0.7 * u.clockSamples()) <= 12.0);
}

int main() {
    transportRatios();
    loopJump();
    skips();
    swingAndHumanize();
    clockMode();
    phaseLock();
    resetAndStop();
    return test::finish("clock-multiplier");
}
