// SPDX-License-Identifier: MIT
#include "ChorusDsp.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep::patch;
static constexpr double kSr = 48000.0;

static void lfoIsATriangle() {
    TEST("the LFO is a triangle in -1…+1");
    EXPECT_NEAR(triangleLfo(0.0), 1.0, 1e-6);
    EXPECT_NEAR(triangleLfo(0.5), -1.0, 1e-6);
    EXPECT_NEAR(triangleLfo(0.25), 0.0, 1e-6);
    EXPECT_NEAR(triangleLfo(1.75), 0.0, 1e-6);
}

static void delaysByTheTime() {
    TEST("with no swing the voice delays an impulse by the delay time");
    ModDelayVoice v;
    v.prepare(kSr);
    int at = -1;
    for (int i = 0; i < 2000; ++i)
        if (v.tick(i == 0 ? 1.0f : 0.0f, 0.0f, 5.0f, 0.0f, 0.0f, false) > 0.5f && at < 0) at = i;
    EXPECT(std::abs(at - 240) <= 1);  // 5 ms = 240 samples
}

static void feedbackStaysBounded() {
    TEST("feedback at ±100 % decays or stays bounded");
    for (float fb : {1.0f, -1.0f}) {
        ModDelayVoice v;
        v.prepare(kSr);
        float peak = 0.0f;
        for (int i = 0; i < 96000; ++i) {
            const float y = v.tick(i == 0 ? 1.0f : 0.0f, triangleLfo(i * 0.5 / kSr), 3.0f, 0.5f, fb, true);
            EXPECT(std::isfinite(y));
            peak = std::max(peak, std::fabs(y));
        }
        EXPECT(peak < 2.0f);
    }
}

int main() {
    lfoIsATriangle();
    delaysByTheTime();
    feedbackStaysBounded();
    return bleep::test::finish("chorus");
}
