// SPDX-License-Identifier: MIT
#include "EnvelopeFollowerDsp.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

struct Run {
    EnvelopeFollowerDsp dsp;
    EnvelopeFollowerParams p;
    std::vector<float> env, gate, trigger, inverted;
    Run() { dsp.prepare(kSr); }
    template <class Src>
    void render(int n, Src&& src) {
        EnvelopeFollowerFrame f;
        for (int i = 0; i < n; ++i) {
            dsp.tick(src(i), p, f);
            env.push_back(f.env);
            gate.push_back(f.gate);
            trigger.push_back(f.trigger);
            inverted.push_back(f.inverted);
        }
    }
};

static float sine(int i) { return 0.8f * (float)std::sin(2.0 * kPi * 220.0 * i / kSr); }

static void peakTracksLevel() {
    TEST("peak: a steady sine settles near its amplitude, silence falls back to zero");
    Run r;
    r.p.attack = 0.001f;
    r.p.release = 0.05f;
    r.render(24000, sine);
    EXPECT_NEAR(r.env[23999], 0.8, 0.12);
    r.render(48000, [](int) { return 0.0f; });
    EXPECT(r.env.back() < 0.001f);
}

static void attackAndRelease() {
    TEST("attack and release times: 63 % rise, 63 % fall");
    Run r;
    r.p.attack = 0.01f;
    r.p.release = 0.1f;
    r.render((int)(0.01 * kSr), [](int) { return 1.0f; });
    EXPECT_NEAR(r.env.back(), 0.632, 0.02);
    r.env.clear();
    r.render((int)(0.2 * kSr), [](int) { return 1.0f; });
    r.env.clear();
    r.render((int)(0.1 * kSr), [](int) { return 0.0f; });
    EXPECT_NEAR(r.env.back(), 0.368, 0.02);
}

static void rmsOfSine() {
    TEST("rms: a sine of amplitude a settles at a / sqrt 2");
    Run r;
    r.p.detector = DetectRms;
    r.p.attack = r.p.release = 0.05f;
    r.render(48000, sine);
    EXPECT_NEAR(r.env.back(), 0.8 / std::sqrt(2.0), 0.03);
}

static void rectify() {
    TEST("rectify: positive half ignores negative CV, signed follows both ways");
    Run r;
    r.p.attack = r.p.release = 0.0f;
    r.p.rectify = RectifyPositive;
    r.render(10, [](int) { return -0.5f; });
    EXPECT_NEAR(r.env.back(), 0.0, 1e-6);
    Run n;
    n.p.attack = n.p.release = 0.0f;
    n.p.rectify = RectifyNone;
    n.render(10, [](int) { return -0.5f; });
    EXPECT_NEAR(n.env.back(), -0.5, 1e-6);
    EXPECT_NEAR(n.inverted.back(), 0.5, 1e-6);
}

static void gateHysteresis() {
    TEST("gate: opens at the threshold, closes below 80 % of it, one trigger per opening");
    Run r;
    r.p.attack = r.p.release = 0.0f;
    r.p.threshold = 0.5f;
    for (float v : {0.0f, 0.55f, 0.45f, 0.39f, 0.6f}) r.render(4, [v](int) { return v; });
    // samples:        0..3 low | 4..7 high | 8..11 still high | 12..15 low | 16..19 high
    EXPECT(r.gate[3] < 0.5f);
    EXPECT(r.gate[5] > 0.5f);
    EXPECT(r.gate[9] > 0.5f);
    EXPECT(r.gate[13] < 0.5f);
    EXPECT(r.gate[17] > 0.5f);
    int triggers = 0;
    for (float t : r.trigger) triggers += t > 0.5f;
    EXPECT(triggers == 2);
}

static void gainAndFinite() {
    TEST("gain scales the output; extreme input stays finite");
    Run r;
    r.p.attack = r.p.release = 0.0f;
    r.p.gain = 4.0f;
    r.render(4, [](int) { return 0.25f; });
    EXPECT_NEAR(r.env.back(), 1.0, 1e-5);
    r.render(100, [](int i) { return i % 2 ? 1e6f : -1e6f; });
    EXPECT(std::isfinite(r.env.back()));
}

int main() {
    peakTracksLevel();
    attackAndRelease();
    rmsOfSine();
    rectify();
    gateHysteresis();
    gainAndFinite();
    return bleep::test::finish("envelope-follower");
}
