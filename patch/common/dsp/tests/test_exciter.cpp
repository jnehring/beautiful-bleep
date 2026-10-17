// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Exciters: friction curve, bowed and blown bodies, mallet and noise burst.
#include "dsp/Exciter.h"
#include "dsp/ModalBank.h"
#include "dsp/Waveguide.h"
#include "dsp/tests/TestUtil.h"

#include <cstdio>
#include <vector>

using namespace bleep;

static double cents(double hz, double ref) { return 1200.0 * std::log2(hz / ref); }

static void friction() {
    TEST("bow friction curve");
    for (float s : {1.0f, 3.0f, 5.0f}) {
        EXPECT_NEAR(dsp::bowFriction(0.3f, s), -dsp::bowFriction(-0.3f, s), 1e-7);
        EXPECT_NEAR(dsp::bowFriction(0.0f, s), 0.0, 1e-9);
        // Peak at dv = 0.25 / slope, then falling (the slip region).
        const float peak = 0.25f / s;
        EXPECT(dsp::bowFriction(peak, s) > dsp::bowFriction(0.5f * peak, s));
        EXPECT(dsp::bowFriction(peak, s) > dsp::bowFriction(2.0f * peak, s));
        for (float dv = -4.0f; dv <= 4.0f; dv += 0.01f) EXPECT(std::fabs(dsp::bowFriction(dv, s)) <= 1.0f);
    }
}

struct Bowed {
    dsp::ModalBank bank;
    dsp::Bow bow;
    float coupling = 0.0f;
    Bowed(double sr, float f0, float structure) {
        bank.prepare(sr);
        bank.setModeCount(32);
        dsp::ModalParams p;
        p.f0Hz = f0;
        p.structure = structure;
        p.t60 = 1.0f;
        p.brightness = 0.6f;
        p.position = 0.13f;
        bank.set(p);
        bow.prepare(sr);
        coupling = dsp::bowCoupling(bank.admittance());
    }
    float tick(float bowVel, float timbre) {
        const float f = bow.process(bowVel, bank.velocity(), timbre);
        return bank.process(f * coupling).mix();
    }
    float fundamental(float bowVel, float timbre) {
        const float f = bow.process(bowVel, bank.velocity(), timbre);
        return bank.process(f * coupling).fundamental;
    }
};

static void bowed() {
    TEST("bowed body");
    const double sr = 48000.0;
    for (float f0 : {130.81f, 261.63f, 1046.5f})
        for (float timbre : {0.2f, 0.5f, 0.9f}) {
            Bowed b(sr, f0, 0.0f);
            std::vector<float> y, fund;
            for (int i = 0; i < 14400; ++i) y.push_back(b.tick(0.8f, timbre));  // 300 ms to settle
            for (int i = 0; i < 9600; ++i) fund.push_back(b.fundamental(0.8f, timbre));
            const double hz = test::zeroCrossingHz(fund, sr);
            const double level = test::rms(fund);
            std::printf("  bow f0 %.0f timbre %.1f: %.2f cents, rms %.3f\n", f0, timbre, cents(hz, f0), level);
            EXPECT(level > 0.05);
            EXPECT(level < 4.0);
            EXPECT_NEAR(cents(hz, f0), 0.0, 5.0);
            EXPECT(test::allFinite(y));
            // Release: the body rings down.
            std::vector<float> tail;
            for (int i = 0; i < 96000; ++i) tail.push_back(b.tick(0.0f, timbre));
            EXPECT(test::rms(std::vector<float>(tail.end() - 4800, tail.end())) < 0.01 * level);
        }
    // Bowed metal: works on a bar too, bounded.
    Bowed bar(sr, 220.0f, 0.5f);
    std::vector<float> y;
    for (int i = 0; i < 48000; ++i) y.push_back(bar.tick(1.0f, 1.0f));
    EXPECT(test::allFinite(y));
    EXPECT(test::rms(y, 24000) > 0.01);
}

static void blown() {
    TEST("blown body");
    const double sr = 48000.0;
    const float f0 = 392.0f;
    auto run = [&](float flowLevel, float timbre, std::vector<float>& out) {
        dsp::ModalBank bank;
        bank.prepare(sr);
        dsp::ModalParams p;
        p.f0Hz = f0;
        p.structure = 0.0f;
        p.t60 = 0.6f;
        p.position = 0.2f;
        bank.set(p);
        dsp::Blow blow;
        blow.prepare(sr);
        float y = 0.0f;
        for (int i = 0; i < 48000; ++i) {
            const float e = blow.process(i < 36000 ? flowLevel : 0.0f, timbre, f0, y);
            y = bank.process(0.0f, e).mix();
            out.push_back(y);
        }
    };
    std::vector<float> silent, breathy, singing;
    run(0.0f, 0.3f, silent);
    EXPECT(test::rms(silent) == 0.0);
    run(0.8f, 0.3f, breathy);
    run(0.8f, 1.0f, singing);
    EXPECT(test::allFinite(breathy));
    EXPECT(test::allFinite(singing));
    const double hz = test::zeroCrossingHz(std::vector<float>(singing.begin() + 24000, singing.begin() + 36000), sr);
    std::printf("  blow: breathy rms %.4f, singing rms %.4f at %.2f cents\n", test::rms(breathy, 24000),
                test::rms(std::vector<float>(singing.begin() + 24000, singing.begin() + 36000)), cents(hz, f0));
    EXPECT(test::rms(std::vector<float>(singing.begin() + 24000, singing.begin() + 36000)) >
           3.0 * test::rms(std::vector<float>(breathy.begin() + 24000, breathy.begin() + 36000)));
    EXPECT_NEAR(cents(hz, f0), 0.0, 10.0);
    EXPECT(test::rms(std::vector<float>(singing.begin() + 24000, singing.begin() + 36000)) < 1.0);
    // After the flow stops the body rings down.
    EXPECT(test::rms(std::vector<float>(singing.end() - 2400, singing.end())) <
           0.1 * test::rms(std::vector<float>(singing.begin() + 24000, singing.begin() + 36000)));
}

static std::vector<float> strike(float level, float timbre, uint64_t seed, int count = 0) {
    dsp::Mallet m;
    m.prepare(48000.0);
    m.setSeed(seed);
    for (int i = 0; i < count; ++i) m.strike(0.0f, 0.0f);
    m.strike(level, timbre);
    std::vector<float> y;
    for (int i = 0; i < 4800; ++i) y.push_back(m.process());
    return y;
}

static void mallet() {
    TEST("mallet");
    // Pulse area ≈ level for the pulse-and-click range.
    for (float t : {0.0f, 0.2f, 0.4f, 0.55f, 0.7f}) {
        const auto y = strike(0.7f, t, 1);
        double sum = 0.0;
        for (float v : y) sum += v;
        EXPECT_NEAR(sum, 0.7, 0.01);
    }
    // Harder mallets have more highs.
    auto hf = [](const std::vector<float>& y) { return test::magnitudeAt(y, 6000.0, 48000.0) / test::magnitudeAt(y, 100.0, 48000.0); };
    EXPECT(hf(strike(1.0f, 0.0f, 1)) < hf(strike(1.0f, 0.3f, 1)));
    EXPECT(hf(strike(1.0f, 0.3f, 1)) < hf(strike(1.0f, 0.6f, 1)));
    // Scrape: same seed and count → same burst; another seed or count → another.
    const auto a = strike(1.0f, 0.9f, 5, 2), b = strike(1.0f, 0.9f, 5, 2), c = strike(1.0f, 0.9f, 6, 2),
               d = strike(1.0f, 0.9f, 5, 3);
    EXPECT(a == b);
    EXPECT(a != c);
    EXPECT(a != d);
    // The scrape lasts longer than the plain tick.
    auto lastNonZero = [](const std::vector<float>& y) {
        int last = 0;
        for (int i = 0; i < (int)y.size(); ++i)
            if (y[(size_t)i] != 0.0f) last = i;
        return last;
    };
    EXPECT(lastNonZero(a) > 240);
    EXPECT(lastNonZero(strike(1.0f, 0.6f, 5)) < 48);
    // Strikes on a modal body add up.
    dsp::ModalBank bank;
    bank.prepare(48000.0);
    dsp::ModalParams p;
    p.f0Hz = 200.0f;
    p.t60 = 3.0f;
    bank.set(p);
    dsp::Mallet m;
    m.prepare(48000.0);
    m.strike(1.0f, 0.3f);
    for (int i = 0; i < 4800; ++i) bank.process(m.process());
    const float e1 = bank.energy();
    m.strike(1.0f, 0.3f);
    for (int i = 0; i < 4800; ++i) bank.process(m.process());
    EXPECT(bank.energy() > e1);
}

static void burst() {
    TEST("noise burst");
    auto run = [](uint64_t seed, float tone) {
        dsp::NoiseBurst n;
        n.prepare(48000.0);
        n.trigger(0.8f, 0.003f, tone, 0.5f, seed);
        std::vector<float> y;
        for (int i = 0; i < 480; ++i) y.push_back(n.process());
        return y;
    };
    const auto a = run(1, 4000.0f), b = run(1, 4000.0f), c = run(2, 4000.0f);
    EXPECT(a == b);
    EXPECT(a != c);
    EXPECT_NEAR(a[0], 0.4, 0.05);  // the click (plus the window's first sample)
    float peak = 0.0f;
    for (size_t i = 1; i < a.size(); ++i) peak = std::max(peak, std::fabs(a[i]));
    EXPECT(peak > 0.2f && peak < 2.0f);
    for (size_t i = 150; i < a.size(); ++i) EXPECT(a[i] == 0.0f);  // 3 ms = 144 samples
    const auto dark = run(1, 300.0f);
    float darkPeak = 0.0f;
    for (size_t i = 1; i < dark.size(); ++i) darkPeak = std::max(darkPeak, std::fabs(dark[i]));
    EXPECT(darkPeak > 0.1f && darkPeak < 2.0f);
}

int main() {
    friction();
    bowed();
    blown();
    mallet();
    burst();
    return test::finish("exciter");
}
