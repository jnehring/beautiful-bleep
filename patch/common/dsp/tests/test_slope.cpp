// SPDX-License-Identifier: MIT
// Slope.h: rate accuracy from 0.001 Hz to 8 kHz, 1 V/oct, skew at constant
// period, curves, AD/AR envelopes, smoothing/folding and the clock lock.
#include "dsp/Slope.h"

#include "dsp/Waves.h"
#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <vector>

using namespace bleep;
using dsp::Slope;
using dsp::SlopeMode;
using dsp::SlopeParams;

static constexpr double kSr = 48000.0;

/// Runs a Loop slope for n samples; returns the End pulse count.
static int64_t countCycles(double hz, float skew, int64_t n, std::vector<int64_t>* at = nullptr) {
    Slope s;
    s.prepare(kSr);
    s.reset();
    SlopeParams p;
    p.hz = hz;
    p.skew = skew;
    int64_t count = 0;
    for (int64_t i = 0; i < n; ++i)
        if (s.tick(p, 0.0f).endOfCycle) {
            ++count;
            if (at) at->push_back(i);
        }
    return count;
}

static void frequencyAccuracy() {
    TEST("slope: frequency accuracy 0.001 Hz … 8 kHz");
    // Whole seconds: exactly f × seconds End pulses (±1 for where the count stops).
    EXPECT(countCycles(2.0, 0.5, 48000 + 10) == 2);
    EXPECT(std::llabs(countCycles(100.0, 0.3f, 480000) - 1000) <= 1);
    EXPECT(std::llabs(countCycles(1000.0, 0.5f, 480000) - 10000) <= 1);
    EXPECT(std::llabs(countCycles(8000.0, 0.5f, 480000) - 80000) <= 1);
    // Audio rate: the period between End pulses averages to sr / f.
    std::vector<int64_t> at;
    countCycles(440.0, 0.5f, 96000, &at);
    const double period = (double)(at.back() - at.front()) / (double)(at.size() - 1);
    EXPECT_NEAR(period, kSr / 440.0, 0.01);
    // Very slow: 0.001 Hz → after 250 s the phase is 0.25 (no cycle yet).
    Slope s;
    s.prepare(kSr);
    s.reset();
    SlopeParams p;
    p.hz = 0.001;
    bool any = false;
    for (int64_t i = 0; i < (int64_t)(250.0 * kSr); ++i) any = any || s.tick(p, 0.0f).endOfCycle;
    EXPECT(!any);
    EXPECT_NEAR(s.phase(), 0.25, 1e-6);
    // The bipolar output of a sine-like slope (Curve +0.5) is at the right pitch.
    Slope t;
    t.prepare(kSr);
    t.reset();
    SlopeParams q;
    q.hz = 261.63;
    q.curve = 0.5f;
    std::vector<float> x(48000);
    for (float& v : x) v = 2.0f * t.tick(q, 0.0f).value - 1.0f;
    EXPECT_NEAR(test::zeroCrossingHz(x, kSr), 261.63, 0.05);
}

static void voct() {
    TEST("slope: 1 V/oct");
    EXPECT_NEAR(dsp::voctHz(261.63, 1.0), 523.26, 1e-9);
    EXPECT_NEAR(dsp::voctHz(261.63, -2.0), 65.4075, 1e-9);
    EXPECT(countCycles(dsp::voctHz(2.0, 1.0), 0.5f, 48010) == 4);  // Pitch +1 doubles the End pulses
}

static void skewKeepsPeriod() {
    TEST("slope: skew changes the rise/fall ratio, not the period");
    for (float skew : {0.0f, 0.1f, 0.5f, 0.9f, 1.0f}) {
        Slope s;
        s.prepare(kSr);
        s.reset();
        SlopeParams p;
        p.hz = 10.0;
        p.skew = skew;
        std::vector<int64_t> eoc, eor;
        float lo = 1.0f, hi = 0.0f;
        for (int64_t i = 0; i < 48000; ++i) {
            const dsp::SlopeFrame f = s.tick(p, 0.0f);
            if (f.endOfCycle) eoc.push_back(i);
            if (f.endOfRise) eor.push_back(i);
            lo = std::min(lo, f.raw);
            hi = std::max(hi, f.raw);
        }
        EXPECT(eoc.size() == 10 && eor.size() == 10);
        EXPECT(std::llabs(eoc[1] - eoc[0] - 4800) <= 1);
        // Rise time r / f: from the end of a cycle to the end of the next rise.
        const int64_t rise = eor[1] > eoc[0] ? eor[1] - eoc[0] : eor[2] - eoc[0];
        const double expect = skew * 4800.0;
        EXPECT(std::fabs((double)(rise % 4800) - std::fmod(expect, 4800.0)) <= 1.0 || (skew == 0.0f || skew == 1.0f));
        EXPECT(lo < 0.001f && hi > 0.999f);
    }
    // Raw slope formula.
    EXPECT_NEAR(dsp::skewedSlope(0.1, 0.25), 0.4, 1e-6);
    EXPECT_NEAR(dsp::skewedSlope(0.625, 0.25), 0.5, 1e-6);
    EXPECT_NEAR(dsp::skewedSlope(0.3, 0.0), 0.7, 1e-6);  // falling saw
    EXPECT_NEAR(dsp::skewedSlope(0.3, 1.0), 0.3, 1e-6);  // rising saw
}

static void curves() {
    TEST("slope: curves");
    // tidal.md 4.2 table at u = 0.5.
    EXPECT_NEAR(dsp::curveMorph(0.5f, -1.0f), 0.9375, 1e-6);
    EXPECT_NEAR(dsp::curveMorph(0.5f, 0.0f), 0.5, 1e-6);
    EXPECT_NEAR(dsp::curveMorph(0.25f, 0.5f), 0.5 - 0.5 * std::cos(3.14159265358979 * 0.25), 1e-6);
    EXPECT_NEAR(dsp::curveMorph(0.5f, 1.0f), 0.0625, 1e-6);
    // Function's curve (Six Slopes, Segments).
    EXPECT_NEAR(dsp::curvePow(0.5f, 1.0f), 0.0625, 1e-6);
    EXPECT_NEAR(dsp::curvePow(0.5f, -1.0f), 0.9375, 1e-6);
    EXPECT_NEAR(dsp::curvePow(0.5f, 0.0f), 0.5, 1e-6);
    // Continuous in c and monotone in u, ends fixed.
    for (int c = -100; c <= 100; ++c) {
        const float cc = c / 100.0f;
        EXPECT(dsp::curveMorph(0.0f, cc) == 0.0f && std::fabs(dsp::curveMorph(1.0f, cc) - 1.0f) < 1e-6f);
        EXPECT(std::fabs(dsp::curveMorph(0.3f, cc) - dsp::curveMorph(0.3f, cc - 0.01f)) < 0.02f);
        for (int u = 1; u <= 100; ++u) EXPECT(dsp::curveMorph(u / 100.0f, cc) >= dsp::curveMorph((u - 1) / 100.0f, cc));
    }
    // The fold reflects into −1..+1.
    EXPECT_NEAR(dsp::foldReflect(0.5f), 0.5, 1e-6);
    EXPECT_NEAR(dsp::foldReflect(1.5f), 0.5, 1e-6);
    EXPECT_NEAR(dsp::foldReflect(-1.25f), -0.75, 1e-6);
    EXPECT_NEAR(dsp::foldReflect(3.5f), -0.5, 1e-6);
}

static void envelopes() {
    TEST("slope: AD and AR");
    // AD at 10 Hz, skew 25 %: rise 25 ms, fall 75 ms, End at 100 ms, idle after.
    Slope s;
    s.prepare(kSr);
    s.reset();
    SlopeParams p;
    p.mode = SlopeMode::AD;
    p.hz = 10.0;
    p.skew = 0.25f;
    for (int i = 0; i < 100; ++i) EXPECT(s.tick(p, 0.0f).raw == 0.0f);  // idle
    int64_t eor = -1, eoc = -1;
    float last = 0.0f, maxStep = 0.0f;
    for (int64_t i = 0; i < 9600; ++i) {
        const dsp::SlopeFrame f = s.tick(p, i < 10 ? 1.0f : 0.0f);
        if (f.endOfRise) eor = i;
        if (f.endOfCycle) eoc = i;
        maxStep = std::max(maxStep, std::fabs(f.raw - last));
        last = f.raw;
    }
    EXPECT(std::llabs(eor - 1200) <= 1);
    EXPECT(std::llabs(eoc - 4800) <= 1);
    EXPECT(last == 0.0f && !s.tick(p, 0.0f).active);
    EXPECT(maxStep < 1.0f / 1200.0f + 1e-5f);

    // Retrigger during the fall: rises again from the current level, no jump.
    s.reset();
    float level = 0.0f, worst = 0.0f;
    for (int64_t i = 0; i < 9600; ++i) {
        const float gate = (i < 10 || (i >= 3000 && i < 3010)) ? 1.0f : 0.0f;
        const dsp::SlopeFrame f = s.tick(p, gate);
        if (i > 0) worst = std::max(worst, std::fabs(f.raw - level));
        level = f.raw;
        if (i == 3001) EXPECT(f.rising);
    }
    EXPECT(worst < 1.0f / 1200.0f + 1e-5f);

    // AR: rises over 25 ms, holds at 1 while the gate is high, falls from the
    // current level on release (also when released during the rise).
    Slope a;
    a.prepare(kSr);
    a.reset();
    p.mode = SlopeMode::AR;
    dsp::SlopeFrame f;
    for (int i = 0; i < 20000; ++i) f = a.tick(p, 1.0f);
    EXPECT(f.raw == 1.0f && f.active && !f.rising);
    int64_t end = -1;
    for (int64_t i = 0; i < 10000; ++i)
        if (a.tick(p, 0.0f).endOfCycle) end = i;
    EXPECT(std::llabs(end - 3600) <= 1);  // fall time (1 − r) / f = 75 ms
    a.reset();
    for (int i = 0; i < 600; ++i) f = a.tick(p, 1.0f);  // halfway up
    EXPECT_NEAR(f.raw, 0.5, 0.01);
    const float before = f.raw;
    f = a.tick(p, 0.0f);
    EXPECT(f.raw < before && before - f.raw < 1.0f / 3600.0f + 1e-5f);
    // Curves shape the envelope but keep it continuous.
    p.curve = 1.0f;
    Slope c;
    c.prepare(kSr);
    c.reset();
    for (int i = 0; i < 600; ++i) f = c.tick(p, 1.0f);
    EXPECT_NEAR(f.value, std::pow(f.raw, 4.0f), 1e-6);
    // Zero rise time (skew 0) still reports reaching the top.
    Slope z;
    z.prepare(kSr);
    z.reset();
    SlopeParams pz;
    pz.mode = SlopeMode::AD;
    pz.skew = 0.0f;
    pz.hz = 10.0;
    f = z.tick(pz, 1.0f);
    EXPECT(f.endOfRise && f.raw > 0.99f);
}

static void lockedPhase() {
    TEST("slope: locked to the song position");
    Slope s;
    s.prepare(kSr);
    s.reset();
    SlopeParams p;
    p.skew = 0.5f;
    const double bpm = 120.0, perSample = bpm / 60.0 / kSr;
    int ends = 0, rises = 0;
    std::vector<float> first;
    for (int i = 0; i < 4 * 96000; ++i) {
        const int j = i % 96000;  // loop jump every 2 bars
        const double ppq = j * perSample;
        const dsp::SlopeFrame f = s.tickAt(p, dsp::ppqPhase(ppq, 1.0));  // one cycle per quarter
        ends += f.endOfCycle;
        rises += f.endOfRise;
        if (i < 50) first.push_back(f.value);
        if (i >= 96000 && i < 96050) EXPECT(f.value == first[(size_t)(i - 96000)]);
    }
    // 4 quarters per pass, 4 passes: a wrap per quarter (the jump back counts), none at the very start.
    EXPECT(ends == 4 * 4 - 1 && rises == 4 * 4);
}

static void smoothing() {
    TEST("slope: smooth (low-pass) and fold");
    auto render = [](float smooth, float skew, double hz) {
        Slope s;
        s.prepare(kSr);
        s.reset();
        dsp::SlopeSmoother sm;
        sm.prepare(kSr);
        SlopeParams p;
        p.hz = hz;
        p.skew = skew;
        std::vector<float> x(96000);
        for (float& v : x) v = 2.0f * sm.process(s.tick(p, 0.0f).value, hz, smooth) - 1.0f;
        return x;
    };
    // Smooth −1 removes most harmonics of a saw: 3rd harmonic far below the fundamental.
    const auto saw = render(0.0f, 0.98f, 50.0), soft = render(-1.0f, 0.98f, 50.0);
    const double h1 = test::magnitudeAt(soft, 50.0, kSr), h2 = test::magnitudeAt(soft, 100.0, kSr);
    const double s1 = test::magnitudeAt(saw, 50.0, kSr), s2 = test::magnitudeAt(saw, 100.0, kSr);
    EXPECT(s2 / s1 > 0.4);   // a saw: 2nd harmonic at about half
    EXPECT(h2 / h1 < 0.2);   // smoothed: near-sine (2-pole at f: 2nd harmonic −12 dB more)
    EXPECT(test::allFinite(soft));
    // Smooth near 0 is transparent; at 0 exactly it is the input.
    const auto tiny = render(-0.001f, 0.5f, 5.0), zero = render(0.0f, 0.5f, 5.0);
    double diff = 0.0;
    for (size_t i = 0; i < zero.size(); ++i) diff = std::max(diff, (double)std::fabs(tiny[i] - zero[i]));
    EXPECT(diff < 0.01);
    // Fold +1 on a triangle: (2v − 1) × 6 → many more turning points per cycle.
    const auto folded = render(1.0f, 0.5f, 10.0);
    int turns = 0;
    for (size_t i = 2; i < 4800 + 2; ++i)
        turns += (folded[i] - folded[i - 1]) * (folded[i - 1] - folded[i - 2]) < 0.0f;
    // x = (2v − 1) × 6 sweeps −6…+6: a turn at each odd integer (6 per slope)
    // plus the triangle's own top and bottom.
    EXPECT(turns == 14);
    float lo = 1.0f, hi = -1.0f;
    for (float v : folded) lo = std::min(lo, v), hi = std::max(hi, v);
    EXPECT(lo >= -1.0f && hi <= 1.0f);
    // Sub-audio rates work (cutoff down to the cycle rate at 0.01 Hz).
    dsp::SlopeSmoother sm;
    sm.prepare(kSr);
    sm.reset(0.0f);
    float y = 0.0f;
    for (int i = 0; i < 48000 * 30; ++i) y = sm.process(1.0f, 0.01, -1.0f);
    EXPECT(y > 0.0f && y < 1.0f && std::isfinite(y));
}

static void clockLock() {
    TEST("slope: clock lock");
    // Runs a Loop slope from a clock with `period` samples between pulses.
    auto run = [](int multiply, int divide, std::vector<int64_t> pulses, int64_t n, std::vector<int64_t>& ends,
                  std::vector<int64_t>& resets, double* lastHz = nullptr) {
        dsp::ClockLock clk;
        clk.prepare(kSr);
        clk.setRatio(multiply, divide);
        Slope s;
        s.prepare(kSr);
        s.reset();
        SlopeParams p;
        size_t k = 0;
        for (int64_t i = 0; i < n; ++i) {
            const bool pulse = k < pulses.size() && pulses[k] == i;
            if (pulse) ++k;
            if (clk.tick(pulse)) {
                s.resync();
                resets.push_back(i);
            }
            p.hz = clk.hz();
            if (s.tick(p, 0.0f).endOfCycle) ends.push_back(i);
        }
        if (lastHz) *lastHz = clk.hz();
    };
    // A 2 Hz clock (every 24000 samples) for 8 s.
    std::vector<int64_t> pulses;
    for (int64_t t = 1000; t < 8 * 48000; t += 24000) pulses.push_back(t);
    {
        std::vector<int64_t> ends, resets;
        double hz = 0.0;
        run(4, 1, pulses, 8 * 48000, ends, resets, &hz);
        EXPECT_NEAR(hz, 8.0, 1e-9);
        EXPECT(resets.size() == pulses.size());  // ×4: reset on every pulse
        // After the first interval: exactly 4 cycles per pulse, evenly spaced (6000 samples).
        int good = 0, total = 0;
        for (size_t i = 1; i < ends.size(); ++i)
            if (ends[i] > 30000) {
                ++total;
                good += std::llabs(ends[i] - ends[i - 1] - 6000) <= 1;
            }
        EXPECT(total > 20 && good == total);
    }
    {
        std::vector<int64_t> ends, resets;
        double hz = 0.0;
        run(1, 3, pulses, 8 * 48000, ends, resets, &hz);
        EXPECT_NEAR(hz, 2.0 / 3.0, 1e-9);
        // ÷3: resets on the first pulse and every third after it.
        EXPECT(resets.size() == 6 && resets[0] == pulses[0] && resets[1] == pulses[3] && resets[2] == pulses[6]);
    }
    {
        // Every ratio from ÷16 to ×16 has the right rate.
        for (int r : {-16, -8, -6, -4, -3, -2, 1, 2, 3, 4, 6, 8, 16}) {
            dsp::ClockLock clk;
            clk.prepare(kSr);
            clk.setRatio(r);
            for (int64_t i = 0; i < 5 * 12000 + 1; ++i) clk.tick(i % 12000 == 0);  // 4 Hz clock
            const double expect = r > 0 ? 4.0 * r : 4.0 / -r;
            EXPECT_NEAR(clk.hz(), expect, 1e-9);
            EXPECT_NEAR(clk.bpm(), 240.0, 1e-9);
        }
    }
    {
        // Jitter of ±200 samples is averaged over 4 pulses.
        std::vector<int64_t> jittered;
        for (int k = 0; k < 20; ++k) jittered.push_back(1000 + k * 24000 + ((k * 7) % 5 - 2) * 100);
        dsp::ClockLock clk;
        clk.prepare(kSr);
        double worst = 0.0;
        size_t k = 0;
        for (int64_t i = 0; i < 20 * 24000; ++i) {
            const bool pulse = k < jittered.size() && jittered[k] == i;
            if (pulse) ++k;
            clk.tick(pulse);
            if (k >= 6) worst = std::max(worst, std::fabs(clk.hz() - 2.0));
        }
        EXPECT(worst < 0.02);
    }
    {
        // A long pause doesn't produce a runaway (or crawling) rate; counting restarts.
        std::vector<int64_t> p2 = {0, 24000, 48000, 72000, 72000 + 10 * 48000, 72000 + 10 * 48000 + 24000};
        dsp::ClockLock clk;
        clk.prepare(kSr);
        clk.setRatio(1, 2);
        std::vector<int64_t> resets;
        size_t k = 0;
        double worst = 0.0;
        for (int64_t i = 0; i < p2.back() + 100; ++i) {
            const bool pulse = k < p2.size() && p2[k] == i;
            if (pulse) ++k;
            if (clk.tick(pulse)) resets.push_back(i);
            if (i > 24000) worst = std::max(worst, std::fabs(clk.hz() - 1.0));
        }
        EXPECT(worst < 1e-9);  // the 10 s gap never enters the measurement
        EXPECT(resets.size() == 3 && resets[2] == p2[4]);
        // The first period (before any interval) is 0.5 s.
        dsp::ClockLock fresh;
        fresh.prepare(kSr);
        EXPECT_NEAR(fresh.periodSeconds(), 0.5, 1e-12);
        // A slower clock after a pause is measured from its next interval.
        dsp::ClockLock slow;
        slow.prepare(kSr);
        for (int64_t i = 0; i <= 4 * 96000; ++i) slow.tick(i % 96000 == 0);  // 0.5 Hz
        EXPECT_NEAR(slow.hz(), 0.5, 1e-9);
    }
}

int main() {
    frequencyAccuracy();
    voct();
    skewKeepsPeriod();
    curves();
    envelopes();
    lockedPhase();
    smoothing();
    clockLock();
    return bleep::test::finish("slope");
}
