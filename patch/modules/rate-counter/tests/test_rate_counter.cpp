// SPDX-License-Identifier: GPL-3.0-or-later
// Rate Counter: frequency of waves, tempo of pulse trains, pulses per beat, the tap average,
// the Steady gate, timeout and restart, taps (doc/specs/modules/rate-counter.md §8).
#include "RateCounterDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <functional>
#include <vector>

using namespace bleep;
using patch::RateCounterDsp;
using patch::RateFrame;
using patch::RateParams;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;
using Signal = std::function<double(double)>;

static RateFrame run(RateCounterDsp& d, const RateParams& p, double from, double seconds, const Signal& x) {
    RateFrame f;
    const int64_t n0 = (int64_t)std::llround(from * kSr), n1 = n0 + (int64_t)(seconds * kSr);
    for (int64_t n = n0; n < n1; ++n) f = d.tick(p, (float)x((double)n / kSr));
    return f;
}
static double hzOf(float pitch) { return patch::kRateMiddleC * std::pow(2.0, pitch); }
/// A train of 5 ms gates at the given instants (seconds).
static Signal train(std::vector<double> at) {
    return [at = std::move(at)](double t) {
        for (double a : at)
            if (t >= a && t < a + 0.005) return 1.0;
        return 0.0;
    };
}
static std::vector<double> regular(double bpm, int n, double start = 0.1) {
    std::vector<double> v;
    for (int i = 0; i < n; ++i) v.push_back(start + i * 60.0 / bpm);
    return v;
}

static void wavesHz() {
    TEST("frequency of waves");
    for (double f : {2.0, 50.0, 440.0, 4000.0}) {
        RateCounterDsp d;
        d.prepare(kSr);
        RateParams p;
        const auto o = run(d, p, 0.0, f < 5 ? 6.0 : 1.5, [&](double t) { return 0.4 * std::sin(2 * kPi * f * t) + 0.1; });
        EXPECT_NEAR(hzOf(o.hz), f, f * 0.002);
    }
}

static void tinyOrSilentIsIgnored() {
    TEST("noise floor");
    RateCounterDsp d;
    d.prepare(kSr);
    RateParams p;
    run(d, p, 0.0, 1.0, [](double t) { return 0.001 * std::sin(2 * kPi * 440.0 * t); });
    EXPECT(d.edges() == 0);
}

static void tempoOfGates() {
    TEST("tempo of a gate train");
    RateCounterDsp d;
    d.prepare(kSr);
    RateParams p;
    p.mode = patch::RateGate;
    const auto o = run(d, p, 0.0, 6.0, train(regular(120.0, 12)));
    EXPECT_NEAR(o.bpm, 0.5, 0.002);
    EXPECT_NEAR(o.average, 0.5, 0.002);
    EXPECT(o.stable > 0.5f);
    EXPECT_NEAR(d.hz(), 2.0, 0.01);
}

static void perBeatDivides() {
    TEST("pulses per beat");
    RateCounterDsp d;
    d.prepare(kSr);
    RateParams p;
    p.mode = patch::RateGate;
    p.perBeat = 4;  // sixteenths
    const auto o = run(d, p, 0.0, 3.0, train(regular(480.0, 24)));
    EXPECT_NEAR(o.bpm * 240.0, 120.0, 0.5);
    EXPECT_NEAR(o.average * 240.0, 120.0, 0.5);
}

static void notSteadyWhenLoose() {
    TEST("steady gate");
    RateCounterDsp d;
    d.prepare(kSr);
    RateParams p;
    p.mode = patch::RateGate;
    std::vector<double> at;
    double t = 0.1;
    for (int i = 0; i < 16; ++i) { at.push_back(t); t += (i % 2 ? 0.4 : 0.6); }
    const auto o = run(d, p, 0.0, 8.0, train(at));
    EXPECT(o.stable < 0.5f);
    EXPECT_NEAR(o.average * 240.0, 120.0, 1.0);  // the average still finds the mean
    p.tolerance = 0.3f;
    RateCounterDsp e;
    e.prepare(kSr);
    EXPECT(run(e, p, 0.0, 8.0, train(at)).stable > 0.5f);
}

static void averageLength() {
    TEST("the average covers the last N intervals");
    RateCounterDsp d;
    d.prepare(kSr);
    RateParams p;
    p.mode = patch::RateGate;
    p.average = 2;
    std::vector<double> at = regular(60.0, 6);
    for (double t = at.back() + 0.5; at.size() < 10; t += 0.5) at.push_back(t);  // then 120 bpm
    const auto fast = run(d, p, 0.0, 9.0, train(at));
    EXPECT_NEAR(fast.average * 240.0, 120.0, 1.0);
    RateCounterDsp e;
    e.prepare(kSr);
    p.average = 16;
    const auto slow = run(e, p, 0.0, 9.0, train(at));
    EXPECT(slow.average * 240.0 < 100.0);
}

static void timeoutRestarts() {
    TEST("silence starts the count over");
    RateCounterDsp d;
    d.prepare(kSr);
    RateParams p;
    p.mode = patch::RateGate;
    p.timeout = 2.0f;
    auto at = regular(120.0, 8);
    run(d, p, 0.0, 5.0, train(at));
    EXPECT(d.active());
    const auto o = run(d, p, 5.0, 3.0, train({}));
    EXPECT(!d.active());
    EXPECT(o.stable < 0.5f);
    EXPECT(d.intervals() == 0);
    // A slower train afterwards is measured fresh.
    auto at2 = regular(60.0, 6, 9.0);
    const auto o2 = run(d, p, 8.0, 8.0, train(at2));
    EXPECT_NEAR(o2.average * 240.0, 60.0, 0.5);
}

static void taps() {
    TEST("taps count as edges");
    RateCounterDsp d;
    d.prepare(kSr);
    RateParams p;
    p.mode = patch::RateGate;
    RateFrame f;
    for (int beat = 0; beat < 6; ++beat) {
        d.tap();
        for (int i = 0; i < (int)(0.5 * kSr); ++i) f = d.tick(p, 0.0f);  // 120 bpm
    }
    EXPECT_NEAR(f.average * 240.0, 120.0, 0.5);
    EXPECT(f.stable > 0.5f);
}

static void determinism() {
    TEST("same input, same output");
    auto go = [] {
        RateCounterDsp d;
        d.prepare(kSr);
        RateParams p;
        return run(d, p, 0.0, 1.0, [](double t) { return std::sin(2 * kPi * (300.0 + 40.0 * std::sin(t * 7)) * t); });
    };
    const auto a = go(), b = go();
    EXPECT(a.hz == b.hz && a.average == b.average);
}

int main() {
    wavesHz();
    tinyOrSilentIsIgnored();
    tempoOfGates();
    perBeatDivides();
    notSteadyWhenLoose();
    averageLength();
    timeoutRestarts();
    taps();
    determinism();
    return test::finish("rate-counter");
}
