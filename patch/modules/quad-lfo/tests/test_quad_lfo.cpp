// SPDX-License-Identifier: GPL-3.0-or-later
// Quad LFO (doc/specs/modules/quad-lfo.md §8): quadrature and phase offsets,
// Cycle pulses that ignore Spread movement, Divide realignment, free rates,
// transport lock, clock, seeded random waves and click-free mode switches.
#include "QuadLfoDsp.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <vector>

using namespace bleep;
using patch::QuadFrame;
using patch::QuadLfoDsp;
using patch::QuadParams;
using patch::QuadTime;

static constexpr double kSr = 48000.0;
static float rateFor(double hz) { return (float)(std::log(hz / 0.01) / std::log(5000.0)); }

struct Run {
    std::vector<float> out[4], sum;
    int cycles[4] = {};
    std::vector<int64_t> cycleAt[4];
};

static Run run(const QuadParams& base, int64_t n, std::function<void(int64_t, QuadParams&)> mod = nullptr,
               std::function<float(int64_t)> clock = nullptr, QuadLfoDsp* keep = nullptr) {
    QuadLfoDsp local;
    QuadLfoDsp& d = keep ? *keep : local;
    if (!keep) d.prepare(kSr);
    Run r;
    QuadTime t;
    QuadFrame f;
    QuadParams p = base;
    for (int64_t i = 0; i < n; ++i) {
        if (mod) mod(i, p);
        d.tick(p, 0.0f, clock ? clock(i) : 0.0f, (bool)clock, 0.0f, t, f);
        for (int k = 0; k < 4; ++k) {
            r.out[k].push_back(f.out[k]);
            if (f.cycle[k] > 0.5f) ++r.cycles[k], r.cycleAt[k].push_back(i);
        }
        r.sum.push_back(f.sum);
    }
    return r;
}

static void quadrature() {
    TEST("quad lfo: quadrature offsets and a unit circle");
    QuadParams p;
    p.rate[0] = rateFor(2.0);
    QuadLfoDsp d;
    d.prepare(kSr);
    const Run r = run(p, 30000, nullptr, nullptr, &d);
    for (int k = 1; k < 4; ++k) EXPECT_NEAR(dsp::wrap01(d.phase(k) - d.phase(0)), k * 0.25, 1e-9);
    for (size_t i = 0; i < r.out[0].size(); i += 97) EXPECT_NEAR(r.out[0][i] * r.out[0][i] + r.out[1][i] * r.out[1][i], 1.0, 1e-4);
    EXPECT(r.cycles[0] == 2 && r.cycles[1] == 1 && r.cycles[2] == 1);  // 1.25 cycles: channel 1 also at the start
}

static void phaseSpread() {
    TEST("quad lfo: Phase 120° offsets; modulating Spread fires no extra Cycle pulses");
    QuadParams p;
    p.mode = patch::QuadPhase;
    p.rate[0] = rateFor(1.0);
    p.spread = 120.0f / 360.0f;
    QuadLfoDsp d;
    d.prepare(kSr);
    run(p, 1000, nullptr, nullptr, &d);
    const double expect[4] = {0.0, 1.0 / 3.0, 2.0 / 3.0, 0.0};
    for (int k = 0; k < 4; ++k) EXPECT_NEAR(dsp::wrap01(d.phase(k) - d.phase(0) + 1e-12), expect[k], 1e-6);
    // 10 s at 1 Hz, Spread swept 0…360° back and forth at 3 Hz: still 10 pulses per channel (±1 for the start).
    const Run s = run(p, 480000, [](int64_t i, QuadParams& q) { q.spread = 0.5f + 0.5f * (float)std::sin(i * 6.2832 * 3.0 / kSr); });
    for (int k = 0; k < 4; ++k) EXPECT(std::abs(s.cycles[k] - 10) <= 1);
}

static void divide() {
    TEST("quad lfo: Divide ÷1 ÷2 ÷3 ÷4 counts 12, 6, 4, 3 and realigns at 12 s");
    QuadParams p;
    p.mode = patch::QuadDivide;
    p.rate[0] = rateFor(1.0);
    QuadLfoDsp d;
    d.prepare(kSr);
    const Run r = run(p, 48000 * 12 - 10, nullptr, nullptr, &d);
    EXPECT(r.cycles[0] == 12 && r.cycles[1] == 6 && r.cycles[2] == 4 && r.cycles[3] == 3);  // incl. the start
    run(p, 20, nullptr, nullptr, &d);
    for (int k = 0; k < 4; ++k) EXPECT(d.phase(k) < 0.001);
    // A clock ×2 (Divide ×2) keeps up with channel 1.
    p.divide[1] = 2;
    const Run x = run(p, 48000 * 4);
    EXPECT(std::abs(x.cycles[1] - 2 * x.cycles[0]) <= 1);
}

static void freeRates() {
    TEST("quad lfo: Free mode, four independent rates");
    QuadParams p;
    p.mode = patch::QuadFree;
    const double hz[4] = {1.0, 1.5, 2.0, 3.0};
    for (int k = 0; k < 4; ++k) p.rate[k] = rateFor(hz[k]);
    const Run r = run(p, 48000 * 4 - 10);
    for (int k = 0; k < 4; ++k) EXPECT(r.cycles[k] == (int)(hz[k] * 4.0 - 1e-9) + 1);
}

static void transport() {
    TEST("quad lfo: Sync follows the song position and repeats after a loop jump");
    QuadParams p;
    p.mode = patch::QuadFree;
    p.sync = true;
    const float knobs[4] = {11.0f / 21.0f, 14.0f / 21.0f, 8.0f / 21.0f, 17.0f / 21.0f};  // 1/4, 1/8, 1/2, 1/16
    for (int k = 0; k < 4; ++k) p.rate[k] = knobs[k];
    EXPECT(std::string(QuadLfoDsp::syncName(knobs[0])) == "1/4");
    QuadLfoDsp d;
    d.prepare(kSr);
    QuadTime t;
    t.running = true;
    QuadFrame f;
    std::vector<float> first[4];
    for (int i = 0; i < 48000; ++i) {
        t.ppq = i * 2.0 / kSr;
        t.started = i == 0;
        d.tick(p, 0.0f, 0.0f, false, 0.0f, t, f);
        for (int k = 0; k < 4; ++k) first[k].push_back(f.out[k]);
        if (i == 33333)
            for (int k = 0; k < 4; ++k) EXPECT_NEAR(d.phase(k), dsp::wrap01(t.ppq / QuadLfoDsp::syncBeats(knobs[k])), 1e-9);
    }
    for (int i = 20000; i < 48000; ++i) {
        t.ppq = i * 2.0 / kSr;
        t.started = false;
        d.tick(p, 0.0f, 0.0f, false, 0.0f, t, f);
        for (int k = 0; k < 4; ++k) EXPECT(f.out[k] == first[k][(size_t)i]);
    }
    // Quadrature: offsets on top of the song position.
    p.mode = patch::QuadQuadrature;
    t.ppq = 3.3;
    d.tick(p, 0.0f, 0.0f, false, 0.0f, t, f);
    for (int k = 0; k < 4; ++k) EXPECT_NEAR(d.phase(k), dsp::wrap01(3.3 + 0.25 * k), 1e-9);
}

static void clockFollow() {
    TEST("quad lfo: Clock Ratio 4 with 0.25 s pulses runs at 1 Hz, reset every 4th pulse");
    QuadParams p;
    p.clockRatio = 3;  // 4 pulses
    const int period = 12000;
    QuadLfoDsp d;
    d.prepare(kSr);
    const Run r = run(p, period * 25 + 5, nullptr, [&](int64_t i) { return i % period == 0 ? 1.0f : 0.0f; }, &d);
    // Channel 1's cycles after the measurement settles start on every 4th pulse.
    std::vector<int64_t> late;
    for (int64_t at : r.cycleAt[0])
        if (at > period * 8) late.push_back(at);
    EXPECT(late.size() == 4);
    for (int64_t at : late) EXPECT(std::llabs(((at + 2) % (4 * period)) - 2) <= 2);
}

static void randomWaves() {
    TEST("quad lfo: random waves differ per channel and repeat with the Seed");
    QuadParams p;
    p.mode = patch::QuadFree;
    for (int k = 0; k < 4; ++k) p.rate[k] = rateFor(5.0), p.wave[k] = dsp::WaveRandomStep;
    const Run a = run(p, 48000), b = run(p, 48000);
    for (int k = 0; k < 4; ++k) EXPECT(a.out[k] == b.out[k]);
    EXPECT(a.out[0] != a.out[1] && a.out[1] != a.out[2] && a.out[2] != a.out[3]);
    p.seed = 2;
    const Run c = run(p, 48000);
    EXPECT(c.out[0] != a.out[0]);
}

static void modeSwitch() {
    TEST("quad lfo: a mode switch crossfades over 5 ms");
    QuadParams p;
    p.mode = patch::QuadQuadrature;
    p.rate[0] = rateFor(1.0);
    p.rate[1] = rateFor(7.0);
    const Run r = run(p, 48000, [](int64_t i, QuadParams& q) { q.mode = i < 10000 ? patch::QuadQuadrature : patch::QuadFree; });
    float step = 0.0f;
    for (int k = 0; k < 4; ++k)
        for (size_t i = 1; i < r.out[k].size(); ++i) step = std::max(step, std::fabs(r.out[k][i] - r.out[k][i - 1]));
    // A 2-unit jump spread over 240 samples, plus the waves' own movement.
    EXPECT(step < 2.0f / 240.0f + 2.0f * 3.1416f * 7.0f / 48000.0f + 1e-3f);
    // Unipolar with a negative level gives 1 − v, in range.
    EXPECT_NEAR(QuadLfoDsp::shape(1.0f, -1.0f, true), 0.0, 1e-6);
    EXPECT_NEAR(QuadLfoDsp::shape(-1.0f, -1.0f, true), 1.0, 1e-6);
    EXPECT_NEAR(QuadLfoDsp::shape(0.5f, -0.5f, false), -0.25, 1e-6);
}

int main() {
    quadrature();
    phaseSpread();
    divide();
    freeRates();
    transport();
    clockFollow();
    randomWaves();
    modeSwitch();
    return bleep::test::finish("quad lfo");
}
