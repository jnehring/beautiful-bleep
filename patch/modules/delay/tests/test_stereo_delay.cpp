// SPDX-License-Identifier: GPL-3.0-or-later
#include "DelayDsp.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep::patch;
static constexpr double kSr = 48000.0;

static DelayDsp make(const DelayParams& p) {
    DelayDsp d;
    d.prepare(kSr);
    d.snapTimes(p);
    return d;
}

static std::vector<float> run(DelayDsp& d, const DelayParams& p, int n, bool right = false, float inR0 = 0.0f) {
    std::vector<float> out((size_t)n);
    for (int i = 0; i < n; ++i) {
        float l, r;
        d.tick(p, i == 0 ? 1.0f : 0.0f, i == 0 ? inR0 : 0.0f, l, r);
        out[(size_t)i] = right ? r : l;
    }
    return out;
}

static void delaysByTheTime() {
    TEST("an impulse comes back after the time, scaled by the mix");
    DelayParams p;
    p.timeL = p.timeR = 0.1f;
    p.feedback = 0.0f;
    p.mix = 1.0f;
    auto d = make(p);
    const auto y = run(d, p, 9000);
    int at = -1;
    for (int i = 1; i < (int)y.size(); ++i)
        if (y[(size_t)i] > 0.5f && at < 0) at = i;
    EXPECT(std::abs(at - 4800) <= 1);
}

static void feedbackRepeats() {
    TEST("feedback makes decaying repeats");
    DelayParams p;
    p.timeL = p.timeR = 0.05f;
    p.feedback = 0.5f;
    p.mix = 1.0f;
    auto d = make(p);
    const auto y = run(d, p, 12000);
    EXPECT_NEAR(y[2400], 1.0, 0.01);
    EXPECT_NEAR(y[4800], 0.5, 0.01);
    EXPECT_NEAR(y[7200], 0.25, 0.01);
}

static void fullFeedbackStaysBounded() {
    TEST("100 % feedback holds and never grows");
    DelayParams p;
    p.timeL = p.timeR = 0.02f;
    p.feedback = 1.0f;
    p.mix = 1.0f;
    auto d = make(p);
    float peak = 0.0f;
    for (int i = 0; i < 48000 * 5; ++i) {
        float l, r;
        d.tick(p, i < 960 ? 0.9f : 0.0f, 0.0f, l, r);
        EXPECT(std::isfinite(l) && std::isfinite(r));
        peak = std::max(peak, std::max(std::fabs(l), std::fabs(r)));
    }
    EXPECT(peak <= 1.0f);
}

static void recoversFromNaN() {
    TEST("a NaN input does not poison the repeats");
    DelayParams p;
    p.timeL = p.timeR = 0.02f;
    p.feedback = 0.7f;
    p.mix = 1.0f;
    auto d = make(p);
    for (int i = 0; i < 48000; ++i) {
        float l, r;
        d.tick(p, i == 100 ? std::nanf("") : (i < 960 ? 0.5f : 0.0f), 0.0f, l, r);
        EXPECT(std::isfinite(l) && std::isfinite(r));
    }
}

static void pingPongAlternates() {
    TEST("ping-pong: the first repeat is on the left, the next on the right");
    DelayParams p;
    p.timeL = p.timeR = 0.05f;
    p.feedback = 0.8f;
    p.pingPong = true;
    p.mix = 1.0f;
    auto d = make(p);
    std::vector<float> l((size_t)9000), r((size_t)9000);
    for (int i = 0; i < 9000; ++i) {
        float a, b;
        d.tick(p, i == 0 ? 1.0f : 0.0f, i == 0 ? 1.0f : 0.0f, a, b);
        l[(size_t)i] = a;
        r[(size_t)i] = b;
    }
    EXPECT(l[2400] > 0.5f);
    EXPECT(std::fabs(r[2400]) < 0.01f);
    EXPECT(r[4800] > 0.3f);
    EXPECT(std::fabs(l[4800]) < 0.01f);
}

static void highCutDarkensRepeats() {
    TEST("high cut removes highs from the repeats");
    auto energy = [](float cutoff) {
        DelayParams p;
        p.timeL = p.timeR = 0.01f;
        p.feedback = 0.9f;
        p.highCutHz = cutoff;
        p.mix = 1.0f;
        DelayDsp d;
        d.prepare(kSr);
        d.snapTimes(p);
        double e = 0.0;
        float prev = 0.0f;
        for (int i = 0; i < 48000; ++i) {
            float l, r;
            d.tick(p, i == 0 ? 1.0f : 0.0f, 0.0f, l, r);
            e += std::fabs(l - prev);  // total variation: high-frequency content
            prev = l;
        }
        return e;
    };
    EXPECT(energy(1000.0f) < energy(20000.0f) * 0.7);
}

static void syncedRates() {
    TEST("synced rates are note values: 1/4 is one beat, 1/8. is three quarters of one");
    EXPECT_NEAR(delayRateBeats(8), 1.0, 1e-9);
    EXPECT_NEAR(delayRateBeats(6), 0.75, 1e-9);
    EXPECT_NEAR(delayRateBeats(13), 4.0, 1e-9);
}

static void timeChangeBends() {
    TEST("a time change glides (no jump): consecutive outputs stay close");
    DelayParams p;
    p.timeL = p.timeR = 0.1f;
    p.feedback = 0.0f;
    p.mix = 1.0f;
    DelayDsp d;
    d.prepare(kSr);
    d.snapTimes(p);
    float prev = 0.0f, worst = 0.0f;
    for (int i = 0; i < 48000; ++i) {
        if (i == 24000) p.timeL = 0.3f;
        float l, r;
        d.tick(p, (float)std::sin(i * 0.05), 0.0f, l, r);
        worst = std::max(worst, std::fabs(l - prev));
        prev = l;
    }
    EXPECT(worst < 0.2f);
}

int main() {
    delaysByTheTime();
    feedbackRepeats();
    fullFeedbackStaysBounded();
    recoversFromNaN();
    pingPongAlternates();
    highCutDarkensRepeats();
    syncedRates();
    timeChangeBends();
    return bleep::test::finish("stereo-delay");
}
