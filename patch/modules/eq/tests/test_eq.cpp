// SPDX-License-Identifier: GPL-3.0-only
#include "EqDsp.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep::patch;
static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;
static constexpr int kN = EqDsp::kBands;

/// Gain in dB of the bands at `hz`, measured through the running filter.
static double gainDb(const EqBand (&bands)[kN], double hz) {
    EqDsp d;
    d.prepare(kSr);
    d.setBands(bands);
    std::vector<float> y;
    for (int i = 0; i < 24000; ++i) {
        const float v = d.tick((float)std::sin(2.0 * kPi * hz * i / kSr));
        if (i >= 12000) y.push_back(v);
    }
    return 20.0 * std::log10(bleep::test::rms(y) * std::sqrt(2.0));
}

/// Six bells at 0 dB: a wire.
static void flat(EqBand (&b)[kN]) {
    for (int i = 0; i < kN; ++i) b[i] = {EqBand::Bell, true, 200.0f * (i + 1), 0.0f, 1.0f, 2};
}

static void flatIsAWire() {
    TEST("all bands at 0 dB pass the signal unchanged");
    EqBand b[kN];
    flat(b);
    b[0].kind = EqBand::LowShelf;
    b[kN - 1].kind = EqBand::HighShelf;
    for (double hz : {60.0, 1000.0, 9000.0}) EXPECT_NEAR(gainDb(b, hz), 0.0, 0.01);
}

static void bellBoostsAtItsFrequency() {
    TEST("a bell has its gain at its centre and little far away");
    EqBand b[kN];
    flat(b);
    b[3] = {EqBand::Bell, true, 800.0f, 12.0f, 2.0f, 2};
    EXPECT_NEAR(gainDb(b, 800.0), 12.0, 0.1);
    EXPECT(std::fabs(gainDb(b, 8000.0)) < 0.9);
    EXPECT(std::fabs(gainDb(b, 60.0)) < 0.7);
    b[3].gainDb = -9.0f;
    EXPECT_NEAR(gainDb(b, 800.0), -9.0, 0.1);
}

static void shelvesReachTheirGain() {
    TEST("the shelves reach their gain far from the corner and half of it at the corner");
    EqBand b[kN];
    flat(b);
    b[1] = {EqBand::LowShelf, true, 120.0f, 10.0f, 0.7f, 2};
    b[4] = {EqBand::HighShelf, true, 8000.0f, -8.0f, 0.7f, 2};
    EXPECT_NEAR(gainDb(b, 30.0), 10.0, 0.5);
    EXPECT_NEAR(gainDb(b, 120.0), 5.0, 0.6);
    EXPECT_NEAR(gainDb(b, 18000.0), -8.0, 0.8);
    EXPECT_NEAR(gainDb(b, 1000.0), 0.0, 0.5);
}

/// A Butterworth cut of order n at `fc`, in dB at `hz`, with the bilinear transform's frequency warping.
static double butterworthDb(bool highPass, int n, double fc, double hz) {
    const double r = highPass ? std::tan(kPi * fc / kSr) / std::tan(kPi * hz / kSr) : std::tan(kPi * hz / kSr) / std::tan(kPi * fc / kSr);
    return -10.0 * std::log10(1.0 + std::pow(r, 2.0 * n));
}

static void cutsHaveTheirSlope() {
    TEST("a cut is 3 dB down at its corner and follows a Butterworth response of its order");
    EqBand b[kN];
    flat(b);
    for (int order : {1, 2, 3, 4, 6, 8}) {
        b[0] = {EqBand::LowCut, true, 1000.0f, 0.0f, 1.0f, order};
        EXPECT_NEAR(gainDb(b, 1000.0), -3.01, 0.1);
        EXPECT_NEAR(gainDb(b, 500.0), butterworthDb(true, order, 1000.0, 500.0), 0.1);
        EXPECT_NEAR(gainDb(b, 8000.0), 0.0, 0.1);
        b[0].kind = EqBand::HighCut;
        EXPECT_NEAR(gainDb(b, 1000.0), -3.01, 0.1);
        EXPECT_NEAR(gainDb(b, 2000.0), butterworthDb(false, order, 1000.0, 2000.0), 0.1);
        EXPECT_NEAR(gainDb(b, 125.0), 0.0, 0.1);
    }
}

static void notchAndBandPass() {
    TEST("a notch removes its centre, a band-pass is 0 dB there and cuts around it");
    EqBand b[kN];
    flat(b);
    b[2] = {EqBand::Notch, true, 1000.0f, 0.0f, 4.0f, 2};
    EXPECT(gainDb(b, 1000.0) < -40.0);
    EXPECT_NEAR(gainDb(b, 100.0), 0.0, 0.1);
    EXPECT_NEAR(gainDb(b, 10000.0), 0.0, 0.1);
    b[2].kind = EqBand::BandPass;
    EXPECT_NEAR(gainDb(b, 1000.0), 0.0, 0.1);
    EXPECT(gainDb(b, 100.0) < -15.0);
    EXPECT(gainDb(b, 10000.0) < -15.0);
}

static void offBandIsAWire() {
    TEST("a band that is off passes the signal, and turning it on filters again");
    EqBand b[kN];
    flat(b);
    b[0] = {EqBand::LowCut, false, 2000.0f, 0.0f, 1.0f, 4};
    EXPECT_NEAR(gainDb(b, 200.0), 0.0, 0.01);
    b[0].on = true;
    EXPECT(gainDb(b, 200.0) < -30.0);
}

static void bandsAddUp() {
    TEST("six bands together are the sum of their responses");
    EqBand b[kN] = {{EqBand::LowCut, true, 50.0f, 0.0f, 1.0f, 2},      {EqBand::LowShelf, true, 150.0f, 7.0f, 0.7f, 2},
                    {EqBand::Bell, true, 500.0f, -6.0f, 2.0f, 2},      {EqBand::Notch, true, 3000.0f, 0.0f, 3.0f, 2},
                    {EqBand::HighShelf, true, 7000.0f, -5.0f, 0.7f, 2}, {EqBand::HighCut, true, 14000.0f, 0.0f, 1.0f, 3}};
    for (double hz : {40.0, 150.0, 500.0, 1200.0, 2800.0, 5000.0, 9000.0}) {
        double db = 0.0;
        for (const auto& band : b) db += Biquad::bandMagnitudeDb(band, hz, kSr);
        EXPECT_NEAR(db, gainDb(b, hz), 0.05);
    }
}

/// Sets the algorithm of every band.
static void useAlgo(EqBand (&b)[kN], EqBand::Algo a) {
    for (auto& band : b) band.algo = a;
}

/// Level of the output's component at `hz` for a sine of `amp` at `inHz`, in dB re 1 (single-bin DFT of the settled tail).
static double toneDb(const EqBand (&bands)[kN], double inHz, double amp, double hz) {
    EqDsp d;
    d.prepare(kSr);
    d.setBands(bands);
    const int n = 48000;
    double re = 0, im = 0;
    for (int i = 0; i < 2 * n; ++i) {
        const float v = d.tick((float)(amp * std::sin(2.0 * kPi * inHz * i / kSr)));
        if (i >= n) { re += v * std::cos(2.0 * kPi * hz * (i - n) / kSr); im += v * std::sin(2.0 * kPi * hz * (i - n) / kSr); }
    }
    return 20.0 * std::log10(std::max(2.0 * std::hypot(re, im) / n, 1e-12));
}

static void cleanIsTheDefault() {
    TEST("the default algorithm is Clean and equals the RBJ response");
    EqBand b[kN];
    flat(b);
    b[3] = {EqBand::Bell, true, 800.0f, 9.0f, 1.5f, 2};
    EXPECT(b[3].algo == EqBand::Clean);
    const Biquad rbj = Biquad::section(EqBand::Bell, 800.0, 9.0, 1.5, kSr);
    for (double hz : {100.0, 800.0, 3000.0, 15000.0}) EXPECT_NEAR(Biquad::bandMagnitudeDb(b[3], hz, kSr), rbj.magnitudeDb(hz, kSr), 1e-9);
    EXPECT_NEAR(gainDb(b, 800.0), 9.0, 0.1);
}

static void modernBellIsNotCramped() {
    TEST("Modern: a high bell hits its gain, is not cramped towards Nyquist and is inverted exactly by a cut");
    EqBand b[kN];
    flat(b);
    b[3] = {EqBand::Bell, true, 12000.0f, 12.0f, 1.0f, 2, EqBand::Modern};
    EXPECT_NEAR(gainDb(b, 12000.0), 12.0, 0.15);
    EXPECT_NEAR(Biquad::bandMagnitudeDb(b[3], 23990.0, kSr), 0.0, 0.05);
    // Q = 1 at 12 kHz, 3 dB-below-peak bandwidth: still 9.3 dB 6 kHz either side; the RBJ one is cramped to 2.7 dB.
    EXPECT_NEAR(Biquad::bandMagnitudeDb(b[3], 6000.0, kSr), 9.26, 0.2);
    EXPECT_NEAR(Biquad::bandMagnitudeDb(b[3], 18000.0, kSr), 9.26, 0.2);
    EqBand clean = b[3];
    clean.algo = EqBand::Clean;
    EXPECT(Biquad::bandMagnitudeDb(clean, 18000.0, kSr) < 4.0);
    b[4] = b[3];
    b[4].gainDb = -12.0f;
    for (double hz : {500.0, 6000.0, 12000.0, 20000.0}) EXPECT_NEAR(gainDb(b, hz), 0.0, 0.05);
    b[4].gainDb = 0.0f;
    b[3] = {EqBand::Bell, true, 800.0f, -9.0f, 2.0f, 2, EqBand::Modern};
    EXPECT_NEAR(gainDb(b, 800.0), -9.0, 0.1);
    EXPECT(std::fabs(gainDb(b, 8000.0)) < 0.7);
}

static void modernIsBroaderForBigMoves() {
    TEST("Modern: the centre gain stays; a big boost is clearly broader than the Clean one, a small one only slightly");
    EqBand m = {EqBand::Bell, true, 1000.0f, 12.0f, 1.0f, 2, EqBand::Modern}, c = m;
    c.algo = EqBand::Clean;
    EXPECT_NEAR(Biquad::bandMagnitudeDb(m, 1000.0, kSr), 12.0, 0.01);
    EXPECT(Biquad::bandMagnitudeDb(m, 2000.0, kSr) > Biquad::bandMagnitudeDb(c, 2000.0, kSr) + 3.0);
    m.gainDb = c.gainDb = 3.0f;
    EXPECT(std::fabs(Biquad::bandMagnitudeDb(m, 2000.0, kSr) - Biquad::bandMagnitudeDb(c, 2000.0, kSr)) < 0.4);
}

static void vintageIsProportionalQ() {
    TEST("Vintage: a small boost is broader than the Clean one, a large boost narrower; the centre gain stays");
    EqBand v = {EqBand::Bell, true, 1000.0f, 3.0f, 1.0f, 2, EqBand::Vintage}, c = v;
    c.algo = EqBand::Clean;
    EXPECT_NEAR(Biquad::bandMagnitudeDb(v, 1000.0, kSr), 3.0, 0.01);
    EXPECT(Biquad::bandMagnitudeDb(v, 2000.0, kSr) > Biquad::bandMagnitudeDb(c, 2000.0, kSr) + 0.5);
    v.gainDb = c.gainDb = 18.0f;
    EXPECT_NEAR(Biquad::bandMagnitudeDb(v, 1000.0, kSr), 18.0, 0.01);
    EXPECT(Biquad::bandMagnitudeDb(v, 2000.0, kSr) < Biquad::bandMagnitudeDb(c, 2000.0, kSr) - 1.0);
    EqBand cut = {EqBand::LowCut, true, 1000.0f, 0.0f, 1.0f, 4, EqBand::Vintage}, cc = cut;  // cuts are not touched
    cc.algo = EqBand::Clean;
    EXPECT_NEAR(Biquad::bandMagnitudeDb(cut, 500.0, kSr), Biquad::bandMagnitudeDb(cc, 500.0, kSr), 1e-9);
}

static void vintageSaturates() {
    TEST("Vintage: small signals follow the response, loud ones get odd harmonics; Clean and Modern stay linear");
    EqBand b[kN];
    flat(b);
    b[2] = {EqBand::Bell, true, 1000.0f, 6.0f, 1.0f, 2, EqBand::Vintage};
    EXPECT_NEAR(toneDb(b, 1000.0, 0.01, 1000.0) - 20.0 * std::log10(0.01), 6.0, 0.02);
    EXPECT(toneDb(b, 1000.0, 0.01, 3000.0) < -110.0);
    const double h3 = toneDb(b, 1000.0, 0.45, 3000.0);
    EXPECT(h3 > -45.0 && h3 < -10.0);
    EXPECT(toneDb(b, 1000.0, 0.45, 2000.0) < -90.0);  // symmetric curve: no even harmonics
    for (auto a : {EqBand::Clean, EqBand::Modern}) {
        useAlgo(b, a);
        EXPECT(toneDb(b, 1000.0, 0.45, 3000.0) < -100.0);
    }
    useAlgo(b, EqBand::Vintage);
    b[2].on = false;  // an off band is a wire
    EXPECT(toneDb(b, 1000.0, 0.45, 3000.0) < -100.0);
}

int main() {
    flatIsAWire();
    bellBoostsAtItsFrequency();
    shelvesReachTheirGain();
    cutsHaveTheirSlope();
    notchAndBandPass();
    offBandIsAWire();
    bandsAddUp();
    cleanIsTheDefault();
    modernBellIsNotCramped();
    modernIsBroaderForBigMoves();
    vintageIsProportionalQ();
    vintageSaturates();
    return bleep::test::finish("eq");
}
