// SPDX-License-Identifier: GPL-3.0-only
#include "FreqShifterDsp.h"
#include "dsp/tests/TestUtil.h"

#include <random>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

struct Render {
    std::vector<float> up, down, out, upR;
};

/// Renders a sine through the shifter (both channels), skipping the first `settle` samples.
static Render renderSine(double hz, double shift, int n, bool antiAlias = true, int settle = 4800) {
    FreqShifterDsp d;
    d.prepare(kSr);
    FreqShifterParams p;
    p.shiftHz = shift;
    p.antiAlias = antiAlias;
    FreqShifterFrame f;
    Render r;
    for (int i = 0; i < n + settle; ++i) {
        f.in[0] = f.in[1] = (float)std::sin(2.0 * kPi * hz * i / kSr);
        d.tick(p, f);
        if (i < settle) continue;
        r.up.push_back(f.up[0]);
        r.down.push_back(f.down[0]);
        r.out.push_back(f.out[0]);
        r.upR.push_back(f.up[1]);
    }
    return r;
}

static double db(double a, double b) { return 20.0 * std::log10(std::max(a, 1e-12) / std::max(b, 1e-12)); }

static void sidebands(double hz, double shift, double minDb) {
    const Render r = renderSine(hz, shift, 48000);
    const double upWanted = bleep::test::magnitudeAt(r.up, hz + shift, kSr);
    const double upMirror = bleep::test::magnitudeAt(r.up, hz - shift, kSr);
    const double downWanted = bleep::test::magnitudeAt(r.down, hz - shift, kSr);
    const double downMirror = bleep::test::magnitudeAt(r.down, hz + shift, kSr);
    if (db(upWanted, upMirror) < minDb || db(downWanted, downMirror) < minDb)
        std::printf("  %g Hz + %g: up %.1f dB, down %.1f dB\n", hz, shift, db(upWanted, upMirror), db(downWanted, downMirror));
    EXPECT(db(upWanted, upMirror) >= minDb);
    EXPECT(db(downWanted, downMirror) >= minDb);
    EXPECT_NEAR(upWanted, 0.5, 0.05);  // unity gain
}

static void shiftsUpAndDown() {
    TEST("Up and Down carry one sideband each");
    sidebands(1000.0, 100.0, 40.0);
    sidebands(100.0, 30.0, 35.0);
    sidebands(10000.0, 100.0, 35.0);
}

static void throughZero() {
    TEST("Shift below 0 Hz reflects back");
    const Render r = renderSine(200.0, -300.0, 48000);
    EXPECT(bleep::test::magnitudeAt(r.up, 100.0, kSr) > 0.4);
}

static void sweepIsContinuous() {
    TEST("sweeping through zero is continuous");
    FreqShifterDsp d;
    d.prepare(kSr);
    FreqShifterParams p;
    FreqShifterFrame f;
    float last = 0.0f, maxStep = 0.0f;
    const int n = 96000;
    for (int i = 0; i < n; ++i) {
        p.shiftHz = -5.0 + 10.0 * i / n;
        f.in[0] = f.in[1] = (float)std::sin(2.0 * kPi * 100.0 * i / kSr);
        d.tick(p, f);
        if (i > 4800) maxStep = std::max(maxStep, std::fabs(f.up[0] - last));
        last = f.up[0];
    }
    // A 105 Hz sine of amplitude 1 moves at most 2π·105/48000 ≈ 0.014 per sample.
    EXPECT(maxStep < 0.02f);
}

static void spreadMirrors() {
    TEST("Spread 100 % runs the right oscillator backwards, 50 % stops it");
    for (float spread : {1.0f, 0.5f}) {
        FreqShifterDsp d;
        d.prepare(kSr);
        FreqShifterParams p;
        p.shiftHz = 3.0;
        p.spread = spread;
        FreqShifterFrame f;
        for (int i = 0; i < 12345; ++i) d.tick(p, f);
        const double l = d.phaseL(), r = d.phaseR();
        const double expectR = spread > 0.75f ? 1.0 - l : 0.0;
        double err = std::fabs(r - expectR);
        err = std::min(err, 1.0 - err);
        EXPECT(err < 1e-6);
    }
}

static void feedbackBounded() {
    TEST("feedback at ±100 % with full-scale noise stays bounded");
    for (float fb : {1.0f, -1.0f})
        for (float delay : {0.0f, 0.05f}) {
            FreqShifterDsp d;
            d.prepare(kSr);
            FreqShifterParams p;
            p.shiftHz = 0.7;
            p.feedback = fb;
            p.fbDelay = delay;
            FreqShifterFrame f;
            std::mt19937 rng(7);
            std::uniform_real_distribution<float> noise(-1.0f, 1.0f);
            float peak = 0.0f;
            bool finite = true;
            for (int i = 0; i < (int)(kSr * 60.0); ++i) {
                f.in[0] = noise(rng);
                f.in[1] = noise(rng);
                d.tick(p, f);
                for (int c = 0; c < 2; ++c) {
                    peak = std::max({peak, std::fabs(f.out[c]), std::fabs(f.down[c])});
                    finite = finite && std::isfinite(f.out[c]) && std::isfinite(f.down[c]);
                }
            }
            EXPECT(finite);
            if (peak >= 4.0f) std::printf("  feedback %g, delay %g: peak %g\n", fb, delay, peak);
            EXPECT(peak < 4.0f);
        }
}

static void feedbackEchoes() {
    TEST("FB Delay 250 ms: echoes 250 ms apart, each shifted further");
    FreqShifterDsp d;
    d.prepare(kSr);
    FreqShifterParams p;
    p.shiftHz = 200.0;
    p.feedback = 0.5f;
    p.fbDelay = 0.25f;
    FreqShifterFrame f;
    std::vector<float> y;
    const int burst = 4800;  // a 1 kHz burst of 100 ms
    for (int i = 0; i < (int)kSr; ++i) {
        f.in[0] = f.in[1] = i < burst ? (float)std::sin(2.0 * kPi * 1000.0 * i / kSr) : 0.0f;
        d.tick(p, f);
        y.push_back(f.up[0]);
    }
    const auto slice = [&](double from) {
        const int a = (int)(from * kSr) + 600;
        return std::vector<float>(y.begin() + a, y.begin() + a + 3600);
    };
    const auto first = slice(0.0), echo1 = slice(0.25), echo2 = slice(0.5), gap = slice(0.125);
    EXPECT(bleep::test::magnitudeAt(first, 1200.0, kSr) > 0.3);
    EXPECT(bleep::test::magnitudeAt(echo1, 1400.0, kSr) > 0.1);  // ½ × the first, shifted again
    EXPECT(bleep::test::magnitudeAt(echo2, 1600.0, kSr) > 0.05);
    EXPECT(bleep::test::rms(gap) < 0.02);
}

static void antiAlias() {
    TEST("anti-alias removes what folds back above Nyquist");
    // 20 kHz + 3 kHz shift = 23 kHz: fine. 20 kHz + 6 kHz = 26 kHz folds to 22 kHz.
    const Render on = renderSine(20000.0, 6000.0, 48000, true);
    const Render off = renderSine(20000.0, 6000.0, 48000, false);
    const double aOn = bleep::test::magnitudeAt(on.up, 22000.0, kSr);
    const double aOff = bleep::test::magnitudeAt(off.up, 22000.0, kSr);
    EXPECT(aOff > 0.3);  // the alias is there without the filter
    EXPECT(db(aOff, aOn) > 15.0);
}

static void quadratureOutputs() {
    TEST("Sin and Cos are 90 degrees apart, within ±1");
    FreqShifterDsp d;
    d.prepare(kSr);
    FreqShifterParams p;
    p.shiftHz = 2.0;
    FreqShifterFrame f;
    double cross = 0.0;
    float lo = 1.0f, hi = -1.0f;
    for (int i = 0; i < 48000; ++i) {
        d.tick(p, f);
        cross += (double)f.sin * f.cos;
        lo = std::min({lo, f.sin, f.cos});
        hi = std::max({hi, f.sin, f.cos});
        EXPECT_NEAR(f.sin * f.sin + f.cos * f.cos, 1.0, 1e-3);
    }
    EXPECT(std::fabs(cross / 48000.0) < 1e-3);  // orthogonal over whole cycles
    EXPECT(lo >= -1.0f && hi <= 1.0f && hi > 0.99f);
}

static void resetIsSmooth() {
    TEST("Reset ramps instead of stepping");
    FreqShifterDsp d;
    d.prepare(kSr);
    FreqShifterParams p;
    p.shiftHz = 50.0;
    FreqShifterFrame f;
    float last = 0.0f, maxStep = 0.0f;
    for (int i = 0; i < 9600; ++i) {
        if (i == 4801) d.triggerReset();
        f.in[0] = f.in[1] = (float)std::sin(2.0 * kPi * 300.0 * i / kSr);
        d.tick(p, f);
        if (i > 4800) maxStep = std::max(maxStep, std::fabs(f.up[0] - last));
        last = f.up[0];
    }
    EXPECT(maxStep < 0.06f);
    // The phase jumped to 0 after the 1 ms fade-out and ran on from there.
    double expect = (9600 - 4801 - 48) * 50.0 / kSr;
    expect -= std::floor(expect);
    double err = std::fabs(d.phaseL() - expect);
    EXPECT(std::min(err, 1.0 - err) < 0.01);
}

int main() {
    shiftsUpAndDown();
    throughZero();
    sweepIsContinuous();
    spreadMirrors();
    feedbackBounded();
    feedbackEchoes();
    antiAlias();
    quadratureOutputs();
    resetIsSmooth();
    return bleep::test::finish("freq-shifter");
}
