// SPDX-License-Identifier: MIT
#include "EqDsp.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep::patch;
static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

/// Gain in dB of the four bands at `hz`.
static double gainDb(const EqBand (&bands)[4], double hz) {
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

static EqBand flat[4] = {{EqBand::LowShelf, 120.0f, 0.0f, 0.7f}, {EqBand::Peak, 400.0f, 0.0f, 1.0f},
                         {EqBand::Peak, 2500.0f, 0.0f, 1.0f}, {EqBand::HighShelf, 8000.0f, 0.0f, 0.7f}};

static void flatIsAWire() {
    TEST("all bands at 0 dB pass the signal unchanged");
    for (double hz : {60.0, 1000.0, 9000.0}) EXPECT_NEAR(gainDb(flat, hz), 0.0, 0.01);
}

static void bellBoostsAtItsFrequency() {
    TEST("a bell has its gain at its centre and little far away");
    EqBand b[4];
    std::copy(flat, flat + 4, b);
    b[1].gainDb = 12.0f;
    b[1].q = 2.0f;
    EXPECT_NEAR(gainDb(b, 400.0), 12.0, 0.1);
    EXPECT(std::fabs(gainDb(b, 4000.0)) < 0.7);
    EXPECT(std::fabs(gainDb(b, 60.0)) < 0.7);
    b[1].gainDb = -9.0f;
    EXPECT_NEAR(gainDb(b, 400.0), -9.0, 0.1);
}

static void shelvesReachTheirGain() {
    TEST("the shelves reach their gain far from the corner and half of it at the corner");
    EqBand b[4];
    std::copy(flat, flat + 4, b);
    b[0].gainDb = 10.0f;
    b[3].gainDb = -8.0f;
    EXPECT_NEAR(gainDb(b, 30.0), 10.0, 0.5);
    EXPECT_NEAR(gainDb(b, 120.0), 5.0, 0.6);
    EXPECT_NEAR(gainDb(b, 18000.0), -8.0, 0.8);
    EXPECT_NEAR(gainDb(b, 1000.0), 0.0, 0.5);
}

int main() {
    flatIsAWire();
    bellBoostsAtItsFrequency();
    shelvesReachTheirGain();
    return bleep::test::finish("eq");
}
