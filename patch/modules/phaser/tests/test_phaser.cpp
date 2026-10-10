// SPDX-License-Identifier: MIT
#include "PhaserDsp.h"
#include "dsp/tests/TestUtil.h"

#include <random>
#include <vector>

using namespace bleep::patch;
static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

/// Gain of the allpass chain mixed 50/50 with the dry signal at `hz`.
static double mixedGain(double hz, double breakHz, int stages) {
    PhaserDsp d;
    d.prepare(kSr);
    std::vector<float> y;
    for (int i = 0; i < 24000; ++i) {
        const float x = (float)std::sin(2.0 * kPi * hz * i / kSr);
        const float wet = d.tick(x, (float)breakHz, stages, 0.0f);
        if (i >= 12000) y.push_back(0.5f * (x + wet));
    }
    return bleep::test::rms(y) * std::sqrt(2.0);
}

static void allpassIsFlat() {
    TEST("the allpass chain alone has unity gain at every frequency");
    for (double hz : {100.0, 800.0, 5000.0}) {
        PhaserDsp d;
        d.prepare(kSr);
        std::vector<float> y;
        for (int i = 0; i < 24000; ++i) {
            const float w = d.tick((float)std::sin(2.0 * kPi * hz * i / kSr), 800.0f, 6, 0.0f);
            if (i >= 12000) y.push_back(w);
        }
        EXPECT_NEAR(bleep::test::rms(y) * std::sqrt(2.0), 1.0, 0.01);
    }
}

static void notchesAppear() {
    TEST("mixed with the dry signal the chain makes a deep notch where the phase reaches 180°");
    // Two stages at the break frequency are 180° out of phase there: a notch at the break frequency.
    EXPECT(mixedGain(800.0, 800.0, 2) < 0.1);
    EXPECT(mixedGain(50.0, 800.0, 2) > 0.9);
}

static void feedbackStaysBounded() {
    TEST("feedback at 95 % stays bounded on noise");
    PhaserDsp d;
    d.prepare(kSr);
    std::mt19937 rng(1);
    std::uniform_real_distribution<float> u(-1.0f, 1.0f);
    for (float fb : {0.95f, -0.95f}) {
        float peak = 0.0f;
        for (int i = 0; i < 96000; ++i) {
            const float y = d.tick(u(rng), 300.0f + 200.0f * std::sin(i * 0.0005f), 12, fb);
            EXPECT(std::isfinite(y));
            peak = std::max(peak, std::fabs(y));
        }
        EXPECT(peak < 40.0f);
    }
}

int main() {
    allpassIsFlat();
    notchesAppear();
    feedbackStaysBounded();
    return bleep::test::finish("phaser");
}
