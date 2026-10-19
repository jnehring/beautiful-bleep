// SPDX-License-Identifier: GPL-3.0-or-later
// Automata: ring and grid rules, determinism, Interference, Rewind, Reset,
// Markov table and learning, walker, rewriting strings, pitch mapping,
// clocking (doc/specs/modules/automata.md §8).
#include "AutomataDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <set>
#include <vector>

using namespace bleep;
using patch::AutoMode;
using patch::AutomataDsp;
using patch::AutomataFrame;
using patch::AutomataInput;
using patch::AutomataParams;

static constexpr double kSr = 48000.0;

static AutomataParams params(AutoMode m) {
    AutomataParams p;
    p.mode = (int)m;
    p.seed = 7;
    return p;
}

static void ringRules() {
    TEST("rule 90 from one cell is the XOR of the neighbours; rule 0 dies and is reborn");
    uint8_t a[16] = {}, b[16] = {};
    a[8] = 1;
    AutomataDsp::ringStep(a, b, 16, 90);
    for (int i = 0; i < 16; ++i) EXPECT(b[i] == (uint8_t)(i == 7 || i == 9 ? 1 : 0));
    uint8_t c[16] = {};
    AutomataDsp::ringStep(b, c, 16, 90);
    EXPECT(c[6] == 1 && c[8] == 0 && c[10] == 1);
    // the ring wraps
    uint8_t w[8] = {1, 0, 0, 0, 0, 0, 0, 0}, w2[8] = {};
    AutomataDsp::ringStep(w, w2, 8, 90);
    EXPECT(w2[7] == 1 && w2[1] == 1);
    AutomataDsp d;
    d.prepare(kSr);
    AutomataParams p = params(AutoMode::Rule);
    p.rule = 0;
    d.seed(p);
    for (int i = 0; i < 20; ++i) {
        d.evolve(p);
        int alive = 0;
        for (int k = 0; k < p.size; ++k) alive += d.state().cell[(size_t)k];
        EXPECT(alive == 1);  // each death is replaced by one new cell
    }
}

static void gridRules() {
    TEST("a blinker oscillates with period 2; a block is still");
    uint8_t g[64] = {}, n[64] = {};
    g[3 * 8 + 2] = g[3 * 8 + 3] = g[3 * 8 + 4] = 1;
    AutomataDsp::lifeStep(g, n, patch::lifeRules()[0]);
    EXPECT(n[2 * 8 + 3] && n[3 * 8 + 3] && n[4 * 8 + 3] && !n[3 * 8 + 2]);
    uint8_t m[64] = {};
    AutomataDsp::lifeStep(n, m, patch::lifeRules()[0]);
    for (int i = 0; i < 64; ++i) EXPECT(m[i] == g[i]);
    uint8_t blk[64] = {}, o[64] = {};
    blk[0] = blk[1] = blk[8] = blk[9] = 1;
    AutomataDsp::lifeStep(blk, o, patch::lifeRules()[0]);
    for (int i = 0; i < 64; ++i) EXPECT(o[i] == blk[i]);
    TEST("the grid wraps around the edges");
    uint8_t e[64] = {}, f[64] = {};
    e[0] = e[7] = e[56] = 1;  // three corners are neighbours across the edge of the fourth
    AutomataDsp::lifeStep(e, f, patch::lifeRules()[0]);
    EXPECT(f[63] == 1);
}

static std::vector<int> degrees(const AutomataParams& p, int n) {
    AutomataDsp d;
    d.prepare(kSr);
    d.seed(p);
    std::vector<int> out;
    for (int i = 0; i < n; ++i) {
        const auto e = d.evolve(p);
        out.push_back(e.gate ? e.degree : -1);
    }
    return out;
}

static void determinism() {
    TEST("every mode repeats exactly for one seed and differs for another");
    for (int m = 0; m < 5; ++m) {
        AutomataParams p = params((AutoMode)m);
        p.density = 0.5f;
        const auto a = degrees(p, 200), b = degrees(p, 200);
        EXPECT(a == b);
        p.seed = 8;
        EXPECT(degrees(p, 200) != a);
    }
}

static void interference() {
    TEST("Interference 0 never changes the course; more of it forks the future");
    for (int m = 0; m < 5; ++m) {
        AutomataParams p = params((AutoMode)m);
        p.density = 0.5f;
        p.rule = 90;
        const auto base = degrees(p, 300);
        p.interference = 0.0f;
        EXPECT(degrees(p, 300) == base);
        p.interference = 0.8f;
        const auto pert = degrees(p, 300);
        EXPECT(pert != base);
        EXPECT(degrees(p, 300) == pert);  // still repeatable
    }
}

static void rewindAndReset() {
    TEST("Rewind restores the exact earlier state; the replay forks");
    for (int m = 0; m < 5; ++m) {
        AutomataParams p = params((AutoMode)m);
        AutomataDsp d;
        d.prepare(kSr);
        d.seed(p);
        for (int i = 0; i < 10; ++i) d.evolve(p);
        const auto at10 = d.state();
        for (int i = 0; i < 6; ++i) d.evolve(p);
        d.rewind(6);
        EXPECT(d.generation() == 10);
        EXPECT(at10.cell == d.state().cell && at10.str == d.state().str && at10.window == d.state().window && at10.deg == d.state().deg &&
               at10.head == d.state().head && at10.ax == d.state().ax && at10.ay == d.state().ay && at10.note == d.state().note);
        d.rewind(1000);  // as far as the ring reaches
        EXPECT(d.generation() == 0);
    }
    TEST("the ring reaches 63 generations back");
    AutomataParams p = params(AutoMode::Life);
    AutomataDsp d;
    d.prepare(kSr);
    d.seed(p);
    for (int i = 0; i < 200; ++i) d.evolve(p);
    d.rewind(1000);
    EXPECT(d.generation() == 200 - (patch::kAutoHist - 1));
    TEST("a replay after Rewind forks when Interference is up, and repeats when it is 0");
    for (float amount : {0.0f, 0.9f}) {
        AutomataParams r = params(AutoMode::Life);
        r.interference = amount;
        AutomataDsp x;
        x.prepare(kSr);
        x.seed(r);
        for (int i = 0; i < 12; ++i) x.evolve(r);
        std::vector<uint8_t> first, second;
        for (int i = 0; i < 24; ++i) x.evolve(r);
        for (int k = 0; k < 64; ++k) first.push_back(x.state().cell[(size_t)k]);
        x.rewind(24);
        for (int i = 0; i < 24; ++i) x.evolve(r);
        for (int k = 0; k < 64; ++k) second.push_back(x.state().cell[(size_t)k]);
        EXPECT((first == second) == (amount == 0.0f));
    }
}

static AutomataFrame run(AutomataDsp& d, const AutomataParams& p, AutomataInput in, int samples, std::vector<AutomataFrame>* all = nullptr) {
    AutomataFrame f;
    for (int i = 0; i < samples; ++i) {
        d.tick(p, in, f);
        in.started = false;
        if (all) all->push_back(f);
    }
    return f;
}

static void resetGate() {
    TEST("a Reset pulse returns the system to its seed; the next clock plays from there");
    AutomataParams p = params(AutoMode::Rule);
    p.rule = 110;
    p.sync = 2;
    AutomataDsp d;
    d.prepare(kSr);
    AutomataInput in;
    in.clockPatched = true;
    std::vector<AutomataFrame> a, b;
    auto pulse = [&](float clock, float reset, std::vector<AutomataFrame>& v) {
        in.clock = clock;
        in.reset = reset;
        run(d, p, in, 1, &v);
    };
    auto pulses = [&](int n, std::vector<AutomataFrame>& v) {
        for (int i = 0; i < n; ++i) {
            pulse(1, 0, v);
            for (int k = 0; k < 99; ++k) pulse(0, 0, v);
        }
    };
    pulses(12, a);
    pulse(0, 1, a);
    pulse(0, 0, a);
    pulses(12, b);
    // the same twelve steps again
    std::vector<float> pa, pb;
    for (size_t i = 0; i < a.size(); i += 100) pa.push_back(a[i].pitch + 10.0f * a[i + 50].gate);
    for (size_t i = 0; i < b.size(); i += 100) pb.push_back(b[i].pitch + 10.0f * b[i + 50].gate);
    EXPECT(pa.size() >= 12 && pb.size() >= 12);
    for (size_t i = 0; i < 12 && i < pa.size() && i < pb.size(); ++i) EXPECT_NEAR(pa[i], pb[i], 1e-6);
}

static void markov() {
    TEST("a Markov row with one weight always takes that transition");
    AutomataParams p = params(AutoMode::Markov);
    AutomataDsp d;
    d.prepare(kSr);
    uint8_t t[AutomataDsp::kTable] = {};
    for (int i = 0; i < 8; ++i) t[i * 9 + (i + 1) % 8] = 9;
    t[8 * 9 + 0] = 9;
    d.setTable(t);
    d.seed(p);
    int prev = d.state().deg;
    for (int i = 0; i < 40; ++i) {
        d.evolve(p);
        EXPECT(d.state().deg == (prev + 1) % 8);
        prev = d.state().deg;
    }
    TEST("zero-weight transitions are never taken; the rest column makes rests");
    uint8_t u[AutomataDsp::kTable] = {};
    for (int i = 0; i < 9; ++i) u[i * 9 + 8] = 1, u[i * 9 + 3] = 1;  // only degree 3 or a rest
    d.setTable(u);
    d.seed(p);
    int rests = 0, notes = 0;
    for (int i = 0; i < 400; ++i) {
        const auto e = d.evolve(p);
        const int s = d.state().deg;
        EXPECT(s == 3 || s == 8);
        e.gate ? ++notes : ++rests;
    }
    EXPECT(rests > 120 && notes > 120);
    TEST("learning from played notes raises the weights it saw");
    AutomataParams q = params(AutoMode::Markov);
    q.learn = 1.0f;
    AutomataDsp l;
    l.prepare(kSr);
    uint8_t flat[AutomataDsp::kTable];
    for (auto& v : flat) v = 1;
    l.setTable(flat);
    l.seed(q);
    // play a repeated 2 -> 5 -> 2 melody (degrees of a seven-note scale)
    q.scale = dsp::scales()[1].mask;  // Major
    const float v2 = (float)dsp::scaleNote(q.scale, 2) / 12.0f, v5 = (float)dsp::scaleNote(q.scale, 5) / 12.0f;
    EXPECT(AutomataDsp::degreeOf(v2, q) == 2 && AutomataDsp::degreeOf(v5, q) == 5);
    for (int i = 0; i < 30; ++i) {
        l.observePlayed(q, i & 1 ? v5 : v2);
    }
    EXPECT(l.learnedWeight(2, 5) > 4.0f && l.learnedWeight(5, 2) > 4.0f);
    EXPECT(l.learnedWeight(2, 3) == 0.0f);
    uint8_t eff[AutomataDsp::kTable];
    l.effectiveTable(eff);
    EXPECT(eff[2 * 9 + 5] > eff[2 * 9 + 3] * 3);
}

static void walker() {
    TEST("the walker leaves marks, turns by them and stays on the grid");
    AutomataParams p = params(AutoMode::Ant);
    p.turns = 0;
    p.density = 0.0f;
    AutomataDsp d;
    d.prepare(kSr);
    d.seed(p);
    EXPECT(AutomataDsp::densityOf(d.state(), p) == 0.0f);
    std::set<int> xs;
    int births = 0;
    for (int i = 0; i < 300; ++i) {
        const auto e = d.evolve(p);
        births += e.birth ? 1 : 0;
        EXPECT(d.state().ax < 8 && d.state().ay < 8 && e.degree >= 0 && e.degree <= 7);
        xs.insert(d.state().ax);
    }
    EXPECT(xs.size() >= 4);
    EXPECT(births > 5);
    EXPECT(AutomataDsp::densityOf(d.state(), p) > 0.0f);
}

static void rewrite() {
    TEST("the rewriting string grows, restarts and plays notes");
    for (int set = 0; set < 5; ++set) {
        AutomataParams p = params(AutoMode::Lsys);
        p.lsys = set;
        AutomataDsp d;
        d.prepare(kSr);
        d.seed(p);
        int gates = 0, births = 0;
        for (int i = 0; i < 600; ++i) {
            const auto e = d.evolve(p);
            gates += e.gate ? 1 : 0;
            births += e.birth ? 1 : 0;
            EXPECT(d.state().len >= 1 && d.state().len <= patch::kAutoStr);
            EXPECT(e.degree >= 0 && e.degree <= 7 && e.octave >= -1 && e.octave <= 1);
        }
        EXPECT(gates > 150);
        EXPECT(births >= 3);
    }
}

static void pitches() {
    TEST("pitches are in the scale; Octaves widens the range; Transpose moves it");
    AutomataParams p = params(AutoMode::Rule);
    p.scale = dsp::scales()[12].mask;  // minor pentatonic
    for (int span = 1; span <= 3; ++span) {
        p.spread = span;
        float lo = 99, hi = -99;
        for (int deg = 0; deg < 8; ++deg) {
            const float v = AutomataDsp::pitchFor(deg, 0, p, 0);
            const int semi = (int)std::lround(v * 12.0f);
            EXPECT(dsp::inScale(p.scale, semi));
            lo = std::min(lo, v);
            hi = std::max(hi, v);
        }
        EXPECT_NEAR(hi - lo, (float)span, 0.45);
    }
    p.root = 2;
    p.spread = 1;
    EXPECT_NEAR(AutomataDsp::pitchFor(0, 0, p, 0), 2.0 / 12.0, 1e-6);
    EXPECT_NEAR(AutomataDsp::pitchFor(0, 0, p, 7), 9.0 / 12.0, 1e-6);
}

static void clocking() {
    TEST("free running: steps come at the Rate, gates last Gate Length, Step and Birth are trigger pulses");
    AutomataParams p = params(AutoMode::Rule);
    p.sync = 0;
    p.rateHz = 8.0f;
    p.gateLength = 0.5f;
    p.rule = 30;
    p.density = 0.5f;
    AutomataDsp d;
    d.prepare(kSr);
    AutomataInput in;
    std::vector<AutomataFrame> all;
    run(d, p, in, (int)kSr, &all);
    int steps = 0, gateHigh = 0, births = 0;
    for (const auto& f : all) {
        steps += f.step > 0.5f;
        gateHigh += f.gate > 0.5f;
        births += f.birth > 0.5f;
        EXPECT(f.density >= 0.0f && f.density <= 1.0f && f.velocity >= 0.0f && f.velocity <= 1.0f);
        EXPECT(std::isfinite(f.pitch));
    }
    EXPECT(steps >= 8 && steps <= 9);
    EXPECT(gateHigh > 0 && gateHigh < (int)(kSr * 0.5) + 100);
    EXPECT(births >= 1 && births <= steps);
    TEST("the transport lands on the same step wherever it starts (seeking)");
    p.sync = 2;
    AutomataDsp a, b;
    a.prepare(kSr);
    b.prepare(kSr);
    AutomataInput t;
    t.running = true;
    t.bpm = 120;
    t.ppq = 0.0;
    t.started = true;
    auto playTo = [&](AutomataDsp& x, double fromPpq, double toPpq) {
        AutomataFrame f;
        for (double q = fromPpq; q < toPpq; q += 120.0 / 60.0 / kSr) {
            t.ppq = q;
            x.tick(p, t, f);
            t.started = false;
        }
        return f;
    };
    playTo(a, 0.0, 8.01);
    t.started = true;
    AutomataDsp c;
    c.prepare(kSr);
    playTo(c, 8.0, 8.01);  // jump straight to bar 3
    EXPECT(a.generation() == c.generation());
    EXPECT(a.state().cell == c.state().cell && a.state().str == c.state().str && a.state().window == c.state().window);
}

int main() {
    ringRules();
    gridRules();
    determinism();
    interference();
    rewindAndReset();
    resetGate();
    markov();
    walker();
    rewrite();
    pitches();
    clocking();
    return test::finish("automata");
}
