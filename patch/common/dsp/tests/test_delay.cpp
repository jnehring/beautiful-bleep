// SPDX-License-Identifier: MIT
#include "dsp/Delay.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep::dsp;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

static void impulseArrives() {
    TEST("impulse arrives at the right sample");
    RingDelay d;
    d.resize(1000);
    int hermiteAt = -1, linearAt = -1, intAt = -1;
    for (int n = 0; n < 200; ++n) {
        d.write(n == 0 ? 1.0f : 0.0f);
        if (d.readHermite(37.0) > 0.5f) hermiteAt = n;
        if (d.readLinear(37.0) > 0.5f) linearAt = n;
        if (d.at(37) > 0.5f) intAt = n;
    }
    EXPECT(hermiteAt == 37);
    EXPECT(linearAt == 37);
    EXPECT(intAt == 37);
    EXPECT(d.maxDelay() >= 1000.0);
    // d = 0 passes the input straight through.
    d.write(0.25f);
    EXPECT_NEAR(d.readHermite(0.0), 0.25, 1e-7);
}

static void fractionalDelays() {
    TEST("fractional reads match a delayed sine");
    RingDelay d;
    d.resize(4096);
    AllpassTap ap;
    const double hz = 500.0, w = 2.0 * kPi * hz / kSr;
    double errH = 0.0, errL = 0.0, errA = 0.0;
    for (int n = 0; n < 8000; ++n) {
        d.write((float)std::sin(w * n));
        const double delay = 10.37;
        const float h = d.readHermite(delay), l = d.readLinear(delay), a = ap.read(d, delay);
        if (n > 4000) {
            const double ref = std::sin(w * (n - delay));
            errH = std::max(errH, std::fabs(h - ref));
            errL = std::max(errL, std::fabs(l - ref));
            errA = std::max(errA, std::fabs(a - ref));
        }
    }
    EXPECT(errH < 2e-4);  // Hermite: < −74 dB at 500 Hz
    EXPECT(errL < 3e-3);
    EXPECT(errA < 2e-3);  // allpass: phase-exact at low frequencies
}

static void tapeGlides() {
    TEST("tape follower glides with bounded slew");
    TapeTime t;
    t.prepare(kSr, 0.05f, 1.0);
    t.reset(100.0);
    double prev = 100.0, maxStep = 0.0;
    bool monotonic = true;
    for (int n = 0; n < 48000; ++n) {
        const double v = t.process(5000.0);
        maxStep = std::max(maxStep, std::fabs(v - prev));
        if (v < prev) monotonic = false;
        prev = v;
    }
    EXPECT(monotonic);
    EXPECT(maxStep <= 1.0 + 1e-9);
    EXPECT_NEAR(prev, 5000.0, 0.5);
    // A small change follows the one-pole: 63 % after the glide time.
    t.reset(1000.0);
    for (int n = 0; n < (int)(0.05 * kSr); ++n) prev = t.process(1010.0);
    EXPECT_NEAR(prev, 1006.3, 0.2);

    // Read through a gliding head, a sine's pitch drops while the delay grows.
    RingDelay d;
    d.resize(48000);
    t.prepare(kSr, 0.0f, 0.5);
    t.reset(100.0);
    std::vector<float> out;
    for (int n = 0; n < 24000; ++n) {
        d.write((float)std::sin(2.0 * kPi * 1000.0 * n / kSr));
        out.push_back(d.readHermite(t.process(n < 4800 ? 100.0 : 40000.0)));
    }
    std::vector<float> bent(out.begin() + 6000, out.end());
    EXPECT_NEAR(bleep::test::zeroCrossingHz(bent, kSr), 500.0, 2.0);  // slew 0.5 → half speed
}

static double maxStep(const std::vector<float>& x, size_t from = 1) {
    double m = 0.0;
    for (size_t i = std::max<size_t>(from, 1); i < x.size(); ++i) m = std::max(m, (double)std::fabs(x[i] - x[i - 1]));
    return m;
}

static void crossfadeIsSmooth() {
    TEST("crossfade reader changes time without a step or pitch change");
    RingDelay d;
    d.resize(48000);
    CrossfadeReader r;
    r.setFadeSamples(2880);
    r.reset(4800.0);
    std::vector<float> out;
    const double w = 2.0 * kPi * 440.0 / kSr;
    for (int n = 0; n < 40000; ++n) {
        d.write((float)std::sin(w * n));
        double target = 4800.0;
        if (n >= 10000) target = 7321.5;
        if (n >= 11000) target = 9000.0 + (n % 7);  // changes during the fade are latched
        out.push_back(r.process(d, target));
        if (n == 11000) EXPECT(r.fading());
    }
    const double steady = std::sin(w * 0.5) * 2.0;  // a sine's largest sample step
    EXPECT(maxStep(out, 6000) < 1.5 * steady);
    EXPECT(!r.fading());
    EXPECT_NEAR(r.delay(), 9006.0, 6.0);
    std::vector<float> tail(out.begin() + 30000, out.end());
    EXPECT_NEAR(bleep::test::zeroCrossingHz(tail, kSr), 440.0, 0.5);
}

static void reversePlaysBackwards() {
    TEST("reverse reader: windows sum to one, playback runs backwards");
    RingDelay d;
    d.resize(20000);
    ReverseReader r;
    r.reset();
    std::vector<float> dc;
    for (int n = 0; n < 20000; ++n) {
        d.write(1.0f);
        dc.push_back(r.process(d, 2000.0));
    }
    double err = 0.0;
    for (size_t i = 5000; i < dc.size(); ++i) err = std::max(err, (double)std::fabs(dc[i] - 1.0f));
    EXPECT(err < 1e-4);

    // Two impulses, + then −, 100 samples apart, come out reversed: each
    // head meets the − one first and the + one exactly 100 samples later.
    d.clear();
    r.reset();
    std::vector<float> imp;
    for (int n = 0; n < 30000; ++n) {
        d.write(n == 10000 ? 1.0f : n == 10100 ? -1.0f : 0.0f);
        imp.push_back(r.process(d, 3000.0));
    }
    int pairs = 0, wrongOrder = 0;
    for (size_t i = 0; i + 100 < imp.size(); ++i) {
        const bool a = std::fabs(imp[i]) > 1e-4f, b = std::fabs(imp[i + 100]) > 1e-4f;
        if (a && b) {
            ++pairs;
            if (!(imp[i] < 0.0f && imp[i + 100] > 0.0f)) ++wrongOrder;
        }
    }
    EXPECT(pairs >= 2);
    EXPECT(wrongOrder == 0);

    // A sine stays continuous, also while the window is modulated.
    d.clear();
    r.reset();
    std::vector<float> out;
    for (int n = 0; n < 48000; ++n) {
        d.write((float)std::sin(2.0 * kPi * 300.0 * n / kSr));
        out.push_back(r.process(d, 2400.0 + 1500.0 * std::sin(n * 1e-3)));
    }
    EXPECT(maxStep(out, 9000) < 0.06);  // 300 Hz steady: ≈ 0.039
}

static void holdLoops() {
    TEST("hold loop continues seamlessly and repeats");
    RingDelay d;
    d.resize(48000);
    HoldLoop h;
    h.setSeamSamples(240);
    const double w = 2.0 * kPi * 233.0 / kSr;  // not a divisor of the loop
    const double D = 4000.0;
    std::vector<float> out;
    for (int n = 0; n < 20000; ++n) {
        d.write((float)std::sin(w * n));
        out.push_back(d.readHermite(D));
    }
    h.engage(d, D);
    // The first held samples are what the live reader would have produced.
    for (int n = 0; n < 12000; ++n) out.push_back(h.process(d, D, 1.0));
    for (int n = 0; n < 50; ++n) EXPECT_NEAR(out[20000 + (size_t)n], std::sin(w * (20000 + n - D)), 1e-4);
    const double steady = std::sin(w * 0.5) * 2.0;
    EXPECT(maxStep(out, 15000) < 1.6 * steady);
    // Periodic with the loop length.
    double err = 0.0;
    for (size_t i = 24500; i + 4000 < out.size(); ++i) err = std::max(err, (double)std::fabs(out[i + 4000] - out[i]));
    EXPECT(err < 1e-6);
    // Writing resumes (release): the loop stays anchored.
    const float before = h.process(d, D, 1.0);
    (void)before;
    d.write(0.0f);
    std::vector<float> back;
    for (int n = 0; n < 9000; ++n) {
        d.write(0.0f);
        back.push_back(h.process(d, D, -1.0));  // and backwards
    }
    EXPECT(bleep::test::allFinite(back));
    EXPECT(maxStep(back) < 1.6 * steady);
    EXPECT(bleep::test::rms(back) > 0.5);
}

static void tempoHelpers() {
    TEST("tempo helpers");
    EXPECT_NEAR(noteValueSamples(noteValueIndex("1/8"), 120.0, kSr), 12000.0, 1e-9);
    EXPECT_NEAR(noteFractionSamples(1.0 / 8.0, NoteFeel::Straight, 120.0, kSr), 12000.0, 1e-9);
    EXPECT_NEAR(noteFractionSamples(1.0 / 8.0, NoteFeel::Dotted, 120.0, kSr), 18000.0, 1e-9);
    EXPECT_NEAR(noteFractionSamples(1.0 / 4.0, NoteFeel::Triplet, 120.0, kSr), 16000.0, 1e-9);
    EXPECT_NEAR(msToSamples(250.0, kSr), 12000.0, 1e-9);
}

int main() {
    impulseArrives();
    fractionalDelays();
    tapeGlides();
    crossfadeIsSmooth();
    reversePlaysBackwards();
    holdLoops();
    tempoHelpers();
    return bleep::test::finish("delay");
}
