// SPDX-License-Identifier: GPL-3.0-or-later
#include "CompressorDsp.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep::patch;
static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

static void staticCurve() {
    TEST("the static curve: below the threshold nothing, above it 1/ratio, a limiter holds the threshold");
    CompressorParams p;
    p.thresholdDb = -20.0f;
    p.ratio = 4.0f;
    p.kneeDb = 0.0f;
    EXPECT_NEAR(CompressorDsp::gainReductionDb(-30.0f, p), 0.0f, 1e-4);
    EXPECT_NEAR(CompressorDsp::gainReductionDb(-20.0f, p), 0.0f, 1e-4);
    EXPECT_NEAR(CompressorDsp::gainReductionDb(0.0f, p), -15.0f, 1e-3);  // 20 dB over becomes 5 dB over
    p.ratio = 40.0f;
    EXPECT_NEAR(CompressorDsp::gainReductionDb(0.0f, p), -20.0f, 1e-3);
    p.ratio = 4.0f;
    p.kneeDb = 10.0f;  // the knee is continuous: half-way into it the reduction is a fraction of the full one
    const float inKnee = CompressorDsp::gainReductionDb(-20.0f, p);
    EXPECT(inKnee < 0.0f && inKnee > -1.0f);
    EXPECT_NEAR(CompressorDsp::gainReductionDb(-25.0f, p), 0.0f, 1e-4);
}

/// Steady-state output level (dB) of a sine of `inDb` through the compressor.
static double outDb(double inDb, const CompressorParams& p) {
    CompressorDsp d;
    d.prepare(kSr);
    std::vector<float> y;
    const double amp = std::pow(10.0, inDb / 20.0);
    for (int i = 0; i < 48000; ++i) {
        const float x = (float)(amp * std::sin(2.0 * kPi * 440.0 * i / kSr));
        const float in[2] = {x, x};
        float o[2];
        d.tick(in, in, o, p);
        if (i >= 24000) y.push_back(o[0]);
    }
    return 20.0 * std::log10(bleep::test::rms(y) * std::sqrt(2.0));
}

static void compressesSteadyLevels() {
    TEST("a steady sine is turned down by the curve");
    CompressorParams p;
    p.thresholdDb = -20.0f;
    p.ratio = 4.0f;
    p.kneeDb = 0.0f;
    p.attackMs = 1.0f;
    p.releaseMs = 50.0f;
    EXPECT_NEAR(outDb(-30.0, p), -30.0, 0.5);
    EXPECT_NEAR(outDb(-6.0, p), -6.0 + CompressorDsp::gainReductionDb(-6.0f, p), 0.8);
    p.makeupDb = 6.0f;
    EXPECT_NEAR(outDb(-30.0, p), -24.0, 0.5);
}

static void attackAndRelease() {
    TEST("the attack takes time and the release takes longer");
    CompressorDsp d;
    d.prepare(kSr);
    CompressorParams p;
    p.thresholdDb = -30.0f;
    p.ratio = 20.0f;
    p.kneeDb = 0.0f;
    p.attackMs = 20.0f;
    p.releaseMs = 400.0f;
    float o[2];
    float firstGr = 0.0f, settledGr = 0.0f;
    for (int i = 0; i < 48000; ++i) {
        const float x = i < 24000 ? 0.5f : 0.0001f;  // loud, then quiet
        const float in[2] = {x, x};
        const float gr = d.tick(in, in, o, p);
        if (i == 5) firstGr = gr;
        if (i == 23999) settledGr = gr;
        if (i == 24000 + 480) EXPECT(gr < settledGr * 0.5f);  // 10 ms into the release: still mostly reduced
    }
    EXPECT(std::fabs(firstGr) < std::fabs(settledGr) * 0.2f);  // the first samples are barely reduced
    EXPECT(settledGr < -15.0f);
}

int main() {
    staticCurve();
    compressesSteadyLevels();
    attackAndRelease();
    return bleep::test::finish("compressor");
}
