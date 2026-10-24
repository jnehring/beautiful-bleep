// SPDX-License-Identifier: GPL-3.0-only
#include "DualFilterDsp.h"
#include "dsp/tests/TestUtil.h"

#include <random>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

/// The normalised Cutoff knob value for a frequency in Hz.
static float knob(double hz) { return (float)(std::log2(hz / 20.0) / DualFilterDsp::kOctaves); }
/// The resonance knob for a Q (inverse of FilterDsp::q).
static float res(double q) { return (float)(std::log(q / 0.5) / std::log(50.0)); }

/// Gain (linear) of a sine through the filter, left output or a filter output.
enum Tap { OutL, OutR, F1, F2 };
static double gainAt(const DualFilterParams& p, double hz, Tap tap = OutL, bool stereo = false) {
    DualFilterDsp d;
    d.prepare(kSr);
    DualFilterFrame f;
    std::vector<float> y;
    const int settle = 9600, n = 24000;
    for (int i = 0; i < settle + n; ++i) {
        f.in[0] = f.in[1] = (float)std::sin(2.0 * kPi * hz * i / kSr);
        d.tick(p, 0.0f, f, stereo);
        if (i >= settle) y.push_back(tap == OutL ? f.out[0] : tap == OutR ? f.out[1] : tap == F1 ? f.f1 : f.f2);
    }
    return bleep::test::magnitudeAt(y, hz, kSr) / 0.5;
}
static double db(double g) { return 20.0 * std::log10(std::max(g, 1e-12)); }
/// The bilinear-warped frequency ratio the digital SVF sees.
static double warped(double hz, double fc) { return std::tan(kPi * hz / kSr) / std::tan(kPi * fc / kSr); }

static void spreadPlacesCutoffs() {
    TEST("Spread places f1 and f2 symmetrically in octaves");
    for (double hz : {100.0, 1000.0, 5000.0})
        for (float s : {-5.0f, -1.0f, 0.0f, 2.0f, 5.0f}) {
            float f1, f2;
            DualFilterDsp::cutoffs(knob(hz), s, 0.0f, f1, f2);
            EXPECT_NEAR(f1 / (hz * std::exp2(-s / 2.0)), 1.0, 1e-3);
            EXPECT_NEAR(f2 / (hz * std::exp2(s / 2.0)), 1.0, 1e-3);
        }
    // Clamped at both ends by the filters: still finite and quiet-safe.
    DualFilterParams p;
    p.cutoff = 1.0f;
    p.spread = 5.0f;
    p.res1 = p.res2 = 1.0f;
    EXPECT(std::isfinite(gainAt(p, 1000.0)));
    p.cutoff = 0.0f;
    p.spread = -5.0f;
    EXPECT(std::isfinite(gainAt(p, 1000.0)));
}

static void serialSlope() {
    TEST("Serial LP + LP at Spread 0: 24 dB/oct");
    DualFilterParams p;
    p.cutoff = knob(500.0);
    p.spread = 0.0f;
    p.res1 = p.res2 = 0.0f;  // Q 0.5
    for (double mult : {4.0, 8.0}) {
        const double r = warped(500.0 * mult, 500.0);
        const double one = 1.0 / std::hypot(1.0 - r * r, r / 0.5);
        const double measured = db(gainAt(p, 500.0 * mult));
        EXPECT_NEAR(measured, db(one * one), 1.0);
    }
}

static void serialBandpass() {
    TEST("Serial HP → LP with Spread +2 oct: −3 dB at f1 and f2");
    DualFilterParams p;
    p.cutoff = knob(1000.0);
    p.spread = 2.0f;
    p.mode1 = 2.0f / 3.0f;  // HP
    p.mode2 = 0.0f;         // LP
    p.res1 = p.res2 = res(0.7071);
    const double edge1 = db(gainAt(p, 500.0)), edge2 = db(gainAt(p, 2000.0)), mid = db(gainAt(p, 1000.0));
    // Each edge is the Butterworth −3 dB point, less the other filter's (small) share.
    EXPECT_NEAR(edge1, -3.0 + std::min(0.0, mid), 1.0);
    EXPECT_NEAR(edge2, -3.0 + std::min(0.0, mid), 1.0);
    EXPECT(mid > -1.5);
}

static void parallelInverted() {
    TEST("Parallel (F2 inverted), LP − LP: a band-pass between the cutoffs");
    DualFilterParams p;
    p.routing = DualFilterParams::ParallelInverted;
    p.cutoff = knob(1000.0);
    p.spread = 2.0f;
    p.res1 = p.res2 = 0.0f;
    p.res1 = p.res2 = res(0.7071);
    const double centre = gainAt(p, 1000.0);
    EXPECT(centre > gainAt(p, 300.0));
    EXPECT(centre > gainAt(p, 3000.0));
    EXPECT(db(gainAt(p, 20000.0) / centre) < -30.0);
    // DC: LP − LP cancels exactly.
    DualFilterDsp d;
    d.prepare(kSr);
    DualFilterFrame f;
    for (int i = 0; i < 48000; ++i) {
        f.in[0] = f.in[1] = 1.0f;
        d.tick(p, 0.0f, f, false);
    }
    EXPECT(db(std::fabs(f.out[0]) / centre) < -30.0);
}

static void stereoRouting() {
    TEST("Stereo: left is filter 1 at f1, right filter 2 at f2");
    DualFilterParams p;
    p.routing = DualFilterParams::Stereo;
    p.cutoff = knob(1000.0);
    p.spread = 2.0f;
    p.res1 = p.res2 = 0.0f;
    // LP Q 0.5 at its own cutoff: −6 dB.
    EXPECT_NEAR(db(gainAt(p, 500.0, OutL)), -6.02, 0.3);
    EXPECT_NEAR(db(gainAt(p, 2000.0, OutR)), -6.02, 0.3);
    EXPECT_NEAR(gainAt(p, 2000.0, OutL), gainAt(p, 2000.0, F1), 1e-4);
    // Compare with one SVF.
    bleep::dsp::Svf ref;
    ref.set(500.0f, 0.5f, kSr);
    DualFilterDsp d;
    d.prepare(kSr);
    DualFilterFrame f;
    double maxErr = 0.0;
    for (int i = 0; i < 4800; ++i) {
        const float x = (float)std::sin(2.0 * kPi * 300.0 * i / kSr);
        f.in[0] = f.in[1] = x;
        d.tick(p, 0.0f, f, false);
        maxErr = std::max(maxErr, (double)std::fabs(f.out[0] - ref.process(x).lp));
    }
    EXPECT(maxErr < 1e-5);
}

static void linkModes() {
    TEST("Link Same and Mirror");
    const float m1s[4] = {0.0f, 1.0f / 3.0f, 2.0f / 3.0f, 1.0f};
    for (float m1 : m1s) {
        EXPECT_NEAR(DualFilterDsp::linkedMode2(m1, 0.0f, DualFilterParams::Same), m1, 1e-6);
        EXPECT_NEAR(DualFilterDsp::linkedMode2(m1, 0.0f, DualFilterParams::Mirror), 1.0f - m1, 1e-6);
        EXPECT_NEAR(DualFilterDsp::linkedMode2(m1, 0.5f, DualFilterParams::Off), 0.5f, 1e-6);
    }
    EXPECT_NEAR(DualFilterDsp::linkedMode2(1.0f / 3.0f, 1.0f / 3.0f, DualFilterParams::Same), 2.0f / 3.0f, 1e-6);
    EXPECT_NEAR(DualFilterDsp::linkedMode2(0.0f, 1.0f / 3.0f, DualFilterParams::Mirror), 1.0f, 1e-6);  // clamped
}

static void gainStaging() {
    TEST("Clean Serial at full resonance and Spread 0 stays below ±8");
    DualFilterParams p;
    p.cutoff = knob(800.0);
    p.spread = 0.0f;
    p.res1 = p.res2 = 1.0f;
    for (int character : {0, 1}) {
        p.character = character;
        DualFilterDsp d;
        d.prepare(kSr);
        DualFilterFrame f;
        std::mt19937 rng(3);
        std::uniform_real_distribution<float> noise(-1.0f, 1.0f);
        float peak = 0.0f;
        for (int i = 0; i < 96000; ++i) {
            f.in[0] = noise(rng);
            f.in[1] = noise(rng);
            d.tick(p, 0.0f, f, true);
            peak = std::max({peak, std::fabs(f.out[0]), std::fabs(f.out[1]), std::fabs(f.f2)});
        }
        EXPECT(peak < 8.0f);
    }
}

static void routingCrossfade() {
    TEST("routing changes crossfade without steps");
    DualFilterParams p;
    p.cutoff = knob(1000.0);
    p.spread = 1.0f;
    DualFilterDsp d;
    d.prepare(kSr);
    DualFilterFrame f;
    float last = 0.0f, maxStep = 0.0f;
    const int order[] = {0, 2, 3, 1, 0};
    for (int i = 0; i < 48000; ++i) {
        p.routing = order[std::min(i / 9600, 4)];
        f.in[0] = f.in[1] = (float)std::sin(2.0 * kPi * 150.0 * i / kSr);
        d.tick(p, 0.0f, f, false);
        if (i > 100) maxStep = std::max(maxStep, std::fabs(f.out[0] - last));
        last = f.out[0];
    }
    // A 150 Hz sine moves at most 0.0196 per sample on its own.
    EXPECT(maxStep < 0.05f);
}

static void audioRateSpread() {
    TEST("audio-rate Spread modulation at full resonance is stable");
    for (int character : {0, 1})
        for (int routing : {0, 1, 2, 3}) {
            DualFilterParams p;
            p.cutoff = knob(1500.0);
            p.res1 = p.res2 = 1.0f;
            p.character = character;
            p.routing = routing;
            p.mode1 = 1.0f / 3.0f;
            DualFilterDsp d;
            d.prepare(kSr);
            DualFilterFrame f;
            std::mt19937 rng(5);
            std::uniform_real_distribution<float> noise(-1.0f, 1.0f);
            bool ok = true;
            for (int i = 0; i < 96000; ++i) {
                p.spread = 4.0f * (float)std::sin(2.0 * kPi * 440.0 * i / kSr);
                p.cutoff = knob(1500.0) + 0.3f * (float)std::sin(2.0 * kPi * 97.0 * i / kSr);
                f.in[0] = noise(rng);
                f.in[1] = noise(rng);
                d.tick(p, 0.0f, f, true);
                ok = ok && std::isfinite(f.out[0]) && std::fabs(f.out[0]) < 8.0f && std::fabs(f.out[1]) < 8.0f;
            }
            EXPECT(ok);
        }
}

int main() {
    spreadPlacesCutoffs();
    serialSlope();
    serialBandpass();
    parallelInverted();
    stereoRouting();
    linkModes();
    gainStaging();
    routingCrossfade();
    audioRateSpread();
    return bleep::test::finish("dual-filter");
}
