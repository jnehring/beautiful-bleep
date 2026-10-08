// SPDX-License-Identifier: MIT
// PartialBank: sine accuracy, pitch, band limit, shapes, stretch, chorus.
#include "dsp/Partials.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <vector>

using namespace bleep::dsp;
using bleep::test::magnitudeAt;
using bleep::test::rms;
using bleep::test::zeroCrossingHz;

namespace {

constexpr double kSr = 48000.0;
constexpr double kPi = 3.14159265358979323846;

struct Spec {
    float ratios[64], levels[64];
};

Spec sawSpec(int count, float oddEven = 0.0f, float stretch = 0.0f) {
    Spec s;
    for (int i = 0; i < 64; ++i) {
        const int n = i + 1;
        s.ratios[i] = partials::stretchRatio(n, stretch);
        s.levels[i] = partials::baseLevel(partials::Base::Saw, n) * partials::oddEvenGain(n, oddEven) * partials::countGain(n, (float)count);
    }
    return s;
}

std::vector<float> render(PartialBank& b, const Spec& s, double f0, int n, int block = 32) {
    std::vector<float> y((size_t)n);
    for (int i = 0; i < n; ++i) {
        if (i % block == 0) b.setPartials(s.ratios, s.levels, 64, f0);
        y[(size_t)i] = b.process(f0);
    }
    return y;
}

void sineAccuracy() {
    TEST("polynomial sine error < 1e-6");
    double worst = 0.0;
    for (int i = 0; i < 100000; ++i) {
        const float p = (float)i / 100000.0f;
        worst = std::max(worst, std::fabs((double)partials::sin2pi(p) - std::sin(2.0 * kPi * p)));
    }
    EXPECT(worst < 1e-6);
}

void pitch() {
    TEST("partial 1 at f0 (±0.1 cent)");
    PartialBank b;
    b.prepare(kSr);
    b.reset();
    Spec s = sawSpec(1);
    const double c4 = 261.6255653005986;
    const auto y = render(b, s, c4, 96000);
    EXPECT_NEAR(zeroCrossingHz(y, kSr, 4800) / c4, 1.0, 6e-5);
}

void bandLimit() {
    TEST("partials above 0.45 fs are dropped; count follows Nyquist");
    PartialBank b;
    b.prepare(kSr);
    b.reset();
    const Spec s = sawSpec(64);
    b.setPartials(s.ratios, s.levels, 64, 2000.0);
    EXPECT(b.activeCount() == 10);  // 10 × 2 kHz = 20 kHz < 21.6 kHz; 22 kHz is out
    const auto y = render(b, s, 2000.0, 1 << 15);
    EXPECT(magnitudeAt(y, 22000.0, kSr) < 1e-6);
    // 22 kHz aliases to 26 kHz → 22 kHz; also check nothing at the fold of 24 kHz (24 → 24).
    EXPECT(magnitudeAt(y, 20000.0, kSr) > 1e-3);  // partial 10 fading but present
    b.setPartials(s.ratios, s.levels, 64, 50.0);
    EXPECT(b.activeCount() == 64);
    b.setPartials(s.ratios, s.levels, 64, 20000.0);
    EXPECT(b.activeCount() >= 1);
    // A sweep across the cut changes each partial's level smoothly.
    PartialBank c;
    c.prepare(kSr);
    c.reset();
    float worstStep = 0.0f;
    float prev[64] = {};
    for (int i = 0; i < 48000; ++i) {
        const double f0 = 1500.0 * std::exp2(2.0 * i / 48000.0);
        if (i % 32 == 0) c.setPartials(s.ratios, s.levels, 64, f0);
        c.process(f0);
        for (int k = 0; k < 64; ++k) {
            if (i > 2000) worstStep = std::max(worstStep, std::fabs(c.level(k) - prev[k]));
            prev[k] = c.level(k);
        }
    }
    EXPECT(worstStep < 0.01f);
}

void sawShape() {
    TEST("64-partial aligned saw matches the exact additive saw");
    PartialBank b;
    b.prepare(kSr, 0.01f);
    b.reset(PartialBank::PhaseMode::Aligned);
    const Spec s = sawSpec(64);
    const double f0 = 50.0;
    const auto y = render(b, s, f0, 9600);
    double worst = 0.0;
    for (int i = 4800; i < 9600; ++i) {
        double ref = 0.0;
        for (int n = 1; n <= 64; ++n) ref += std::sin(2.0 * kPi * n * f0 * i / kSr) / n;
        worst = std::max(worst, std::fabs(y[(size_t)i] - ref));
    }
    EXPECT(worst < 1.5e-3);  // float phases: below −60 dB of the ~1.8 peak
}

void oddEven() {
    TEST("odd/even balance and the odd/even split");
    PartialBank b;
    b.prepare(kSr);
    b.reset();
    const double f0 = 300.0;
    const auto odd = render(b, sawSpec(16, -1.0f), f0, 1 << 15);
    EXPECT(magnitudeAt(odd, 2 * f0, kSr) < 1e-5);
    EXPECT(magnitudeAt(odd, 3 * f0, kSr) > 0.1);
    b.reset();
    const auto even = render(b, sawSpec(16, 1.0f), f0, 1 << 15);
    EXPECT(magnitudeAt(even, 3 * f0, kSr) < 1e-5);
    EXPECT(magnitudeAt(even, f0, kSr) > 0.3);
    EXPECT(magnitudeAt(even, 2 * f0, kSr) > 0.1);
    // processOddEven sums to process.
    PartialBank a, c;
    a.prepare(kSr), c.prepare(kSr), a.reset(), c.reset();
    const Spec s = sawSpec(20);
    float worst = 0.0f;
    for (int i = 0; i < 4800; ++i) {
        if (i % 32 == 0) a.setPartials(s.ratios, s.levels, 64, f0), c.setPartials(s.ratios, s.levels, 64, f0);
        float o, e;
        a.processOddEven(f0, o, e);
        worst = std::max(worst, std::fabs(o + e - c.process(f0)));
    }
    EXPECT(worst < 1e-5f);
}

void stretch() {
    TEST("stretch keeps partial 1, raises partial 20 by the formula");
    EXPECT_NEAR(partials::stretchRatio(1, 1.0f), 1.0, 1e-6);
    EXPECT_NEAR(partials::stretchRatio(1, -1.0f), 1.0, 1e-6);
    const double b = 0.0005;
    const double expected = 20.0 * std::sqrt(1.0 + b * 400.0) / std::sqrt(1.0 + b);
    EXPECT_NEAR(1200.0 * std::log2(partials::stretchRatio(20, 1.0f) / expected), 0.0, 1.0);
    EXPECT(partials::stretchRatio(20, -1.0f) < 20.0f);
    EXPECT_NEAR(partials::tiltGain(8, -6.0f), std::pow(10.0, -18.0 / 20.0), 1e-5);
    EXPECT_NEAR(partials::countGain(5, 4.25f), 0.25, 1e-6);
    EXPECT(partials::countGain(6, 4.25f) == 0.0f);
}

void chorus() {
    TEST("chorus: seeded, repeatable, voice-dependent");
    auto run = [](uint64_t seed, uint64_t voice, float cents) {
        PartialBank b;
        b.prepare(kSr);
        b.reset(PartialBank::PhaseMode::Random, seed, voice);
        b.setChorus(cents, 2.0f);
        return render(b, sawSpec(32), 220.0, 48000);
    };
    const auto a = run(5, 0, 20.0f), b = run(5, 0, 20.0f), c = run(5, 1, 20.0f), d = run(5, 0, 0.0f);
    EXPECT(a == b);
    EXPECT(a != c);
    EXPECT(a != d);
    for (float v : a) EXPECT(std::isfinite(v) && std::fabs(v) < 4.0f);
    // Without chorus the ratios stay exact.
    PartialBank e;
    e.prepare(kSr);
    e.reset();
    const Spec s = sawSpec(8);
    e.setPartials(s.ratios, s.levels, 64, 100.0);
    EXPECT(e.ratio(4) == 5.0f);
}

void randomPhases() {
    TEST("random phases lower the crest factor of a flat spectrum");
    auto crest = [](PartialBank::PhaseMode m) {
        PartialBank b;
        b.prepare(kSr);
        b.reset(m, 99);
        Spec s;
        for (int i = 0; i < 64; ++i) {
            s.ratios[i] = (float)(i + 1);
            s.levels[i] = partials::baseLevel(partials::Base::Flat, i + 1);
        }
        const auto y = render(b, s, 100.0, 9600);
        float peak = 0.0f;
        for (size_t i = 4800; i < y.size(); ++i) peak = std::max(peak, std::fabs(y[i]));
        return peak / rms(y, 4800);
    };
    EXPECT(crest(PartialBank::PhaseMode::Random) < crest(PartialBank::PhaseMode::Aligned));
}

}  // namespace

int main() {
    sineAccuracy();
    pitch();
    bandLimit();
    sawShape();
    oddEven();
    stretch();
    chorus();
    randomPhases();
    return bleep::test::finish("partials");
}
