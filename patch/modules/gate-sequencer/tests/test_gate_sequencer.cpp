// SPDX-License-Identifier: GPL-3.0-only
// Gate Sequencer DSP: polymeter and Cycle, loop jumps, exact triplet tracks,
// probability, dice and Chance, conditions, ratchets and their decay, nudge
// (early hits in Transport and Clock mode), gate gaps, ties, mutes and no
// hanging notes.
#include "GateSequencerDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cstdlib>
#include <functional>
#include <map>
#include <vector>

using namespace bleep::patch;

namespace {

constexpr double kSr = 48000.0;
constexpr double kBpm = 120.0;
constexpr double kPpqPerSample = kBpm / 60.0 / kSr;
constexpr int64_t kStep = 6000;  // a 1/16 at 120 BPM, 48 kHz

struct Hit {
    int64_t at;
    int track;
    float vel;
};

struct Run {
    std::vector<Hit> hits;
    std::vector<int64_t> cycles;
    std::vector<std::array<float, kGateTracks>> gate;
    std::map<int, int> held;
    bool bad = false;
    int notesOn = 0;
    int sounding() const {
        int n = 0;
        for (const auto& [k, v] : held) n += v;
        return n;
    }
    std::vector<int64_t> times(int track) const {
        std::vector<int64_t> t;
        for (const auto& h : hits)
            if (h.track == track) t.push_back(h.at);
        return t;
    }
};

struct Rig {
    GateSequencerDsp dsp;
    GateParams p;
    GateTime t;
    GateInputs in;
    int64_t sample = 0;
    double ppq = 0.0;
    Rig() {
        dsp.prepare(kSr);
        dsp.reset();
        t.running = true;
        t.bpm = kBpm;
    }
    void run(int64_t n, Run& r, const std::function<void(int64_t)>& each = nullptr) {
        for (int64_t i = 0; i < n; ++i, ++sample) {
            if (each) each(sample);
            t.started = sample == 0;
            t.ppq = ppq;
            GateOutputs o;
            dsp.tick(p, in, t, o, [&](bool on, int note, float, float) {
                if (on) {
                    ++r.notesOn;
                    if (r.held[note]++ > 0) r.bad = true;
                } else if (--r.held[note] < 0) {
                    r.bad = true;
                }
            });
            for (int k = 0; k < kGateTracks; ++k)
                if (o.trig[(size_t)k] > 0.5f) r.hits.push_back({sample, k, o.vel[(size_t)k]});
            if (o.cycle > 0.5f) r.cycles.push_back(sample);
            r.gate.push_back(o.gate);
            if (t.running) ppq += kPpqPerSample;
        }
    }
};

GatePattern allOn(int track, int prob = 100) {
    GatePattern p{};
    for (auto& s : p[(size_t)track].steps) {
        s.on = true;
        s.prob = (uint8_t)prob;
    }
    return p;
}

bool near(int64_t a, int64_t b, int64_t tol = 2) { return std::llabs(a - b) <= tol; }

}  // namespace

static void polymeter() {
    TEST("16 against 12 steps: Cycle every 3 bars");
    GatePattern pat = allOn(0);
    for (auto& s : pat[1].steps) s.on = true;
    Rig rig;
    rig.dsp.setPattern(pat);
    rig.p.length[1] = 12;
    Run r;
    rig.run(kStep * 16 * 7, r);
    EXPECT(r.cycles.size() == 3);  // start, bar 4, bar 7 (= sample end excluded)
    if (r.cycles.size() >= 2) EXPECT(near(r.cycles[1], kStep * 48));
    EXPECT(r.times(0).size() == 16 * 7 && r.times(1).size() == 16 * 7);
    EXPECT(rig.dsp.position(1) == (int)((16 * 7 - 1) % 12));

    TEST("loop jump lands every track on its step");
    Rig j;
    j.dsp.setPattern(pat);
    j.p.length[1] = 12;
    Run rj;
    j.run(kStep * 10, rj);
    j.ppq = 0.25 * 37 + 0.01;
    j.run(10, rj);
    EXPECT(j.dsp.position(0) == 37 % 16 && j.dsp.position(1) == 37 % 12);

    TEST("1/8T stays exact");
    GatePattern tri = allOn(2);
    Rig k;
    k.dsp.setPattern(tri);
    k.p.rate[2] = 7;  // 1/8T = 8000 samples
    Run rk;
    k.run(48000 * 4, rk);
    const auto ts = rk.times(2);
    EXPECT(ts.size() == 24);
    for (size_t i = 0; i < ts.size(); ++i) EXPECT(near(ts[i], (int64_t)i * 8000));
}

static void probability() {
    TEST("probability: 100 % always, 0 % never, 50 % about half");
    GateSequencerDsp d;
    GateParams p;
    GatePattern pat = allOn(0, 50);
    pat[1] = allOn(0, 100)[0];
    pat[2] = allOn(0, 0)[0];
    d.setPattern(pat);
    int n = 0;
    for (int64_t m = 0; m < 10000; ++m) n += d.plays(p, 0, m, false);
    EXPECT(n > 4800 && n < 5200);
    bool all = true, none = true;
    for (int64_t m = 0; m < 1000; ++m) {
        all = all && d.plays(p, 1, m, false);
        none = none && !d.plays(p, 2, m, false);
    }
    EXPECT(all && none);

    TEST("dice: Fixed repeats every loop, Repeat 4 every 4");
    auto pattern = [&](int dice, int64_t loop) {
        GateParams q = p;
        q.dice = dice;
        uint32_t bits = 0;
        for (int i = 0; i < 16; ++i) bits |= (uint32_t)d.plays(q, 0, loop * 16 + i, false) << i;
        return bits;
    };
    EXPECT(pattern(DiceFixed, 0) == pattern(DiceFixed, 7));
    EXPECT(pattern(DiceRepeat4, 1) == pattern(DiceRepeat4, 5) && pattern(DiceRepeat4, 1) != pattern(DiceRepeat4, 2));
    EXPECT(pattern(DiceNew, 1) != pattern(DiceNew, 2));
    GateParams s2 = p;
    s2.seed = 2;
    uint32_t a = 0, b = 0;
    for (int i = 0; i < 32; ++i) {
        a |= (uint32_t)d.plays(p, 0, i, false) << i;
        b |= (uint32_t)d.plays(s2, 0, i, false) << i;
    }
    EXPECT(a != b);

    TEST("Chance scales probabilities below 100 %");
    GatePattern c = allOn(0, 30);
    c[1] = allOn(0, 100)[0];
    d.setPattern(c);
    GateParams q = p;
    q.chance[0] = 0.0f;
    q.chance[1] = 0.0f;
    int z = 0, full = 0;
    for (int64_t m = 0; m < 2000; ++m) {
        z += d.plays(q, 0, m, false);
        full += d.plays(q, 1, m, false);
    }
    EXPECT(z == 0 && full == 2000);
    q.chance[0] = 2.0f;
    int dbl = 0;
    for (int64_t m = 0; m < 10000; ++m) dbl += d.plays(q, 0, m, false);
    EXPECT(dbl > 5800 && dbl < 6200);
}

static void conditions() {
    TEST("A:B, Fill, First, Prev");
    GateSequencerDsp d;
    GateParams p;
    GatePattern pat{};
    GateStep& ab = pat[0].steps[0];
    ab.on = true;
    ab.cond = GateAB;
    ab.condA = 2;
    ab.condB = 4;
    GateStep& fill = pat[0].steps[1];
    fill.on = true;
    fill.cond = GateFill;
    GateStep& first = pat[0].steps[2];
    first.on = true;
    first.cond = GateFirst;
    GateStep& chancy = pat[0].steps[3];
    chancy.on = true;
    chancy.prob = 50;
    GateStep& prev = pat[0].steps[4];
    prev.on = true;
    prev.cond = GatePrev;
    GateStep& notPrev = pat[0].steps[5];
    notPrev.on = true;
    notPrev.cond = GateNotPrev;
    notPrev.prob = 100;
    d.setPattern(pat);
    for (int64_t k = 0; k < 8; ++k) EXPECT(d.plays(p, 0, k * 16, false) == (k % 4 == 1));
    EXPECT(d.plays(p, 0, 1, true) && !d.plays(p, 0, 1, false));
    EXPECT(d.plays(p, 0, 2, false) && !d.plays(p, 0, 18, false));
    for (int64_t k = 0; k < 50; ++k) {
        const bool c = d.plays(p, 0, k * 16 + 3, false);
        EXPECT(d.plays(p, 0, k * 16 + 4, false) == c);
        // Not Prev looks at step 4 (a conditional step): the opposite of it.
        EXPECT(d.plays(p, 0, k * 16 + 5, false) == !c);
    }

    TEST("First: the first loop after the transport starts");
    Rig rig;
    GatePattern f{};
    f[0].steps[0].on = true;
    f[0].steps[0].cond = GateFirst;
    rig.dsp.setPattern(f);
    rig.ppq = 4.0 * 3;  // start in bar 4
    Run r;
    rig.run(kStep * 16 * 3, r);
    EXPECT(r.times(0).size() == 1);
}

static void ratchets() {
    TEST("ratchets: counts, shapes and decay");
    for (int shape : {(int)GateEven, (int)GateFaster, (int)GateSlower}) {
        GatePattern pat{};
        GateStep& s = pat[0].steps[0];
        s.on = true;
        s.ratchet = 4;
        s.shape = (uint8_t)shape;
        s.length = 50;
        Rig rig;
        rig.dsp.setPattern(pat);
        rig.p.ratchetDecay = 1.0f;
        Run r;
        rig.run(kStep, r);
        const auto ts = r.times(0);
        EXPECT(ts.size() == 4);
        if (ts.size() != 4) continue;
        double off, slot;
        for (int j = 0; j < 4; ++j) {
            GateSequencerDsp::ratchetSlot(4, shape, j, off, slot);
            EXPECT(near(ts[(size_t)j], (int64_t)std::llround(off * kStep)));
            EXPECT_NEAR(r.hits[(size_t)j].vel, 100.0 / 127.0 * (1.0 - j / 4.0), 1e-4);
        }
        const int64_t gap1 = ts[1] - ts[0], gap3 = ts[3] - ts[2];
        if (shape == GateEven) EXPECT(near(gap1, gap3));
        if (shape == GateFaster) EXPECT(gap3 < gap1);
        if (shape == GateSlower) EXPECT(gap3 > gap1);
    }
}

static void nudge() {
    TEST("nudge −25 % plays a quarter step early; depth 0 plays straight");
    GatePattern pat{};
    pat[0].steps[4].on = true;
    pat[0].steps[4].nudge = -25;
    Rig rig;
    rig.dsp.setPattern(pat);
    Run r;
    rig.run(kStep * 8, r);
    EXPECT(r.times(0).size() == 1 && near(r.times(0)[0], kStep * 4 - kStep / 4));
    Rig s;
    s.dsp.setPattern(pat);
    s.p.nudgeDepth = 0.0f;
    Run rs;
    s.run(kStep * 8, rs);
    EXPECT(rs.times(0).size() == 1 && near(rs.times(0)[0], kStep * 4));

    TEST("Clock mode: early hits from the measured tick");
    Rig c;
    c.dsp.setPattern(pat);
    c.in.clockPatched = true;
    Run rc;
    c.run(kStep * 8 + 10, rc, [&](int64_t i) { c.in.clock = i % kStep == 0 ? 1.0f : 0.0f; });
    EXPECT(rc.times(0).size() == 1 && near(rc.times(0)[0], kStep * 4 - kStep / 4, 3));

    TEST("Clock mode: a 1/32 track plays twice per tick");
    GatePattern f = allOn(1);
    Rig q;
    q.dsp.setPattern(f);
    q.in.clockPatched = true;
    q.p.rate[1] = 12;  // 1/32
    Run rq;
    q.run(kStep * 4 + 10, rq, [&](int64_t i) { q.in.clock = i % kStep == 0 ? 1.0f : 0.0f; });
    const auto tq = rq.times(1);
    EXPECT(tq.size() == 9);
    for (size_t i = 0; i < tq.size(); ++i) EXPECT(near(tq[i], (int64_t)i * kStep / 2, 3));
}

static void gates() {
    TEST("touching gates drop for 1 ms; tie holds");
    GatePattern pat = allOn(0);
    for (auto& s : pat[0].steps) s.length = 100;
    Rig rig;
    rig.dsp.setPattern(pat);
    Run r;
    rig.run(kStep * 3, r);
    const auto ts = r.times(0);
    EXPECT(ts.size() == 3);
    if (ts.size() == 3) {
        EXPECT(r.gate[(size_t)ts[1]][0] < 0.5f && r.gate[(size_t)ts[1] + 40][0] < 0.5f);
        EXPECT(r.gate[(size_t)ts[1] + 60][0] > 0.5f);
        EXPECT(r.gate[(size_t)ts[1] - 10][0] > 0.5f);
    }
    GatePattern tie{};
    tie[0].steps[0].on = tie[0].steps[1].on = true;
    tie[0].steps[0].tie = true;
    tie[0].steps[1].length = 25;
    Rig t;
    t.dsp.setPattern(tie);
    Run rt;
    t.run(kStep * 3, rt);
    bool high = true;
    for (int64_t i = 1; i < kStep + kStep / 4 - 10; ++i) high = high && rt.gate[(size_t)i][0] > 0.5f;
    EXPECT(high);  // no gap into the next hit
    EXPECT(rt.gate[(size_t)(kStep + kStep / 4 + 10)][0] < 0.5f);

    TEST("Mute silences without moving the counters");
    GatePattern m = allOn(0);
    Rig mu;
    mu.dsp.setPattern(m);
    Run rm;
    mu.run(kStep * 2 + 10, rm);
    EXPECT(rm.sounding() == 1);
    mu.in.mute[0] = 1.0f;
    mu.run(kStep * 4, rm);
    EXPECT(rm.sounding() == 0);
    EXPECT(rm.times(0).size() == 3);
    mu.in.mute[0] = 0.0f;
    mu.run(kStep, rm);
    EXPECT(rm.times(0).size() == 4 && mu.dsp.position(0) == 7);
    EXPECT(!rm.bad);
}

static void noHanging() {
    TEST("no hanging notes: stop, Reset, edits, note change");
    GatePattern pat = allOn(0);
    for (auto& s : pat[0].steps) s.tie = true;
    pat[1] = allOn(0)[0];
    Rig rig;
    rig.dsp.setPattern(pat);
    Run r;
    rig.run(kStep * 2 + 10, r);
    EXPECT(r.sounding() == 2);
    rig.t.running = false;
    rig.run(2, r);
    EXPECT(r.sounding() == 0);
    rig.t.running = true;
    rig.run(kStep, r);
    EXPECT(r.sounding() >= 1);
    rig.in.reset = 1.0f;
    rig.run(1, r);
    rig.in.reset = 0.0f;
    EXPECT(r.sounding() == 0);
    rig.run(kStep * 2, r);
    EXPECT(r.sounding() >= 1);
    GatePattern edited = pat;
    for (auto& s : edited[0].steps) s.velocity = 50;
    for (auto& s : edited[1].steps) s.velocity = 50;
    rig.dsp.setPattern(edited);
    rig.run(1, r);
    EXPECT(r.sounding() == 0);
    rig.run(kStep * 2, r);
    rig.p.note[0] = 40;
    rig.p.note[1] = 41;
    rig.run(1, r);
    EXPECT(r.sounding() == 0);
    rig.run(kStep * 2, r);
    rig.t.running = false;
    rig.run(1, r);
    EXPECT(r.sounding() == 0);
    EXPECT(!r.bad);
}

int main() {
    polymeter();
    probability();
    conditions();
    ratchets();
    nudge();
    gates();
    noHanging();
    return bleep::test::finish("gate-sequencer");
}
