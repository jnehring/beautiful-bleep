// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// FormantOsc (pulse-formant bursts) and the vowel table.
#include "dsp/Formant.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <vector>

using namespace bleep::dsp;
using bleep::test::magnitudeAt;
using bleep::test::zeroCrossingHz;

namespace {

constexpr double kSr = 48000.0;

std::vector<float> render(FormantOsc::Params p, int n, int which = 0) {
    FormantOsc o;
    o.prepare(kSr);
    o.reset();
    std::vector<float> y((size_t)n);
    for (auto& v : y) {
        const auto f = o.process(p);
        v = which == 0 ? f.formant : which == 1 ? f.square : f.formant2;
    }
    return y;
}

void pitch() {
    TEST("square at f0");
    FormantOsc::Params p;
    const auto sq = render(p, 48000, 1);
    EXPECT_NEAR(zeroCrossingHz(sq, kSr) / osc::kC4Hz, 1.0, 6e-5);
}

void harmonicWithReset() {
    TEST("Reset 100 %: energy only at harmonics of f0; Reset 0 % drifts");
    FormantOsc::Params p;
    p.f0Hz = 200.0;
    p.formantHz = formant::formantHz(formant::Tracking::Ratio, p.f0Hz, 2.4);  // 1055.6 Hz, between harmonics
    p.narrow = 0.4f;
    p.roll = 0.3f;
    auto inharmonic = [&](const std::vector<float>& y) {
        double m = 0.0;
        for (int k = -3; k <= 3; ++k) m = std::max(m, magnitudeAt(y, p.formantHz + k * p.f0Hz, kSr));
        for (int k = 1; k < 30; ++k) m = std::max(m, magnitudeAt(y, (k + 0.5) * p.f0Hz, kSr));
        return m;
    };
    const auto y = render(p, 1 << 15);
    double harm = 0.0;
    for (int k = 1; k < 30; ++k) harm = std::max(harm, magnitudeAt(y, k * p.f0Hz, kSr));
    const double inter = inharmonic(y);
    EXPECT(inter < 1e-3 * harm);
    p.reset = 0.0f;
    const double inter0 = inharmonic(render(p, 1 << 15));
    EXPECT(inter0 > 0.05 * harm);
}

void formantPeak() {
    TEST("the strongest harmonic is the one nearest the formant");
    for (double oct : {1.0, 2.0, 3.0}) {
        FormantOsc::Params p;
        p.f0Hz = 110.0;
        p.formantHz = formant::formantHz(formant::Tracking::Ratio, p.f0Hz, oct);
        p.narrow = 0.0f;
        const auto y = render(p, 1 << 15);
        int best = 0;
        double bestMag = 0.0;
        for (int k = 1; k < 40; ++k)
            if (const double m = magnitudeAt(y, k * p.f0Hz, kSr); m > bestMag) bestMag = m, best = k;
        EXPECT(std::abs(best - (int)std::lround(std::exp2(oct))) <= 1);
    }
    // Fixed: the peak stays near C4 × 4 whatever f0.
    for (double f0 : {130.81, 196.0, 261.63}) {
        FormantOsc::Params p;
        p.f0Hz = f0;
        p.formantHz = formant::formantHz(formant::Tracking::Fixed, f0, 2.0);
        const auto y = render(p, 1 << 15);
        int best = 0;
        double bestMag = 0.0;
        for (int k = 1; k < 40; ++k)
            if (const double m = magnitudeAt(y, k * f0, kSr); m > bestMag) bestMag = m, best = k;
        EXPECT(std::fabs(best * f0 - 4.0 * osc::kC4Hz) <= f0 * 1.01);
    }
}

void throughZero() {
    TEST("formant sweeps through 0 Hz without jumps (cosine start)");
    FormantOsc o;
    o.prepare(kSr);
    o.reset();
    FormantOsc::Params p;
    p.f0Hz = 110.0;
    p.cosineStart = true;
    float prev = 0.0f, worst = 0.0f;
    for (int i = 0; i < 48000; ++i) {
        const double F = -1.0 + 2.0 * i / 48000.0;
        p.formantHz = formant::formantHz(formant::Tracking::Ratio, p.f0Hz, F);
        const float y = o.process(p).formant;
        if (i > 0) worst = std::max(worst, std::fabs(y - prev));
        prev = y;
    }
    EXPECT(worst < 0.05f);
    EXPECT(formant::formantScale(0.0) == 0.0);
    EXPECT_NEAR(formant::formantScale(0.1), formant::formantScale(0.1000001), 1e-5);
    EXPECT_NEAR(formant::formantScale(-1.0), -2.0, 1e-12);
}

void clickFree() {
    TEST("Reset < 100 % adds no clicks to Roll/Narrow sweeps");
    auto worstJump = [](float reset) {
        FormantOsc o;
        o.prepare(kSr);
        o.reset();
        FormantOsc::Params p;
        p.f0Hz = 98.0;
        p.formantHz = 300.0;
        p.reset = reset;
        float prev = 0.0f, worst = 0.0f;
        for (int i = 0; i < 96000; ++i) {
            const double t = i / kSr;
            p.roll = (float)(0.5 + 0.5 * std::sin(2.0 * t));
            p.narrow = (float)(0.25 + 0.25 * std::sin(1.3 * t));
            const float y = o.process(p).formant;
            if (i > 0) worst = std::max(worst, std::fabs(y - prev));
            prev = y;
        }
        return worst;
    };
    const float strict = worstJump(1.0f);
    EXPECT(strict < 0.1f);
    EXPECT(worstJump(0.37f) < 0.1f);
    EXPECT(worstJump(0.0f) < 0.1f);
}

void bounded() {
    TEST("bounded for any parameters; narrow windows span ≥ 4 samples");
    FormantOsc o;
    o.prepare(kSr);
    o.reset();
    uint32_t s = 1;
    auto rnd = [&s] {
        s = s * 1664525u + 1013904223u;
        return (double)(s >> 8) / 16777216.0;
    };
    float peak = 0.0f;
    bool finite = true;
    for (int i = 0; i < 200000; ++i) {
        FormantOsc::Params p;
        if (i % 64 == 0) {
            p.f0Hz = 20.0 * std::exp2(10.0 * rnd());
            p.formantHz = (rnd() - 0.5) * 60000.0;
            p.narrow = (float)rnd();
        }
        p.second = true;
        p.formant2Hz = p.formantHz * 1.5;
        p.roll = (float)rnd();
        p.reset = (float)rnd();
        p.cosineStart = rnd() > 0.5;
        const auto f = o.process(p);
        finite = finite && std::isfinite(f.formant) && std::isfinite(f.formant2) && std::isfinite(f.square);
        peak = std::max({peak, std::fabs(f.formant), std::fabs(f.formant2)});
    }
    EXPECT(finite);
    EXPECT(peak <= FormantOsc::kMaxGain + 1e-3f);
    // f0 4 kHz, Narrow 100 %: the window spans at least 4 samples.
    FormantOsc::Params p;
    p.f0Hz = 4000.0;
    p.narrow = 1.0f;
    FormantOsc q;
    q.prepare(kSr);
    q.reset();
    int nonZero = 0;
    for (int i = 0; i < 12; ++i) nonZero += q.process(p).window > 0.0f;
    EXPECT(nonZero >= 3);  // L = 4 samples: 3 inside, zeros at both ends
    // Normalisation keeps the level within a few dB over Narrow.
    EXPECT(FormantOsc::gain(1.0, 1.0) == 1.0);
    EXPECT(FormantOsc::gain(0.05, 4.0) <= FormantOsc::kMaxGain);
}

void vowels() {
    TEST("vowel table and morph");
    const auto a = formant::vowelAt(0.0f);
    EXPECT(a.f[0].hz == formant::vowel(0).f[0].hz);
    const auto u = formant::vowelAt(4.0f);
    EXPECT(u.f[1].hz == formant::vowel(4).f[1].hz);
    const auto mid = formant::vowelAt(0.5f);
    EXPECT_NEAR(mid.f[0].hz, std::sqrt(650.0 * 400.0), 0.5);
    const auto big = formant::vowelAt(0.0f, -1.0f);
    EXPECT_NEAR(big.f[2].hz, 2650.0 / 2.0, 0.1);
    // The response peaks at the first formant.
    EXPECT(formant::vowelResponse(a, 650.0) > formant::vowelResponse(a, 400.0));
    EXPECT(formant::vowelResponse(a, 650.0) > formant::vowelResponse(a, 1500.0));
    EXPECT_NEAR(formant::resonance(a.f[0], 650.0), 1.0, 1e-9);
}

}  // namespace

int main() {
    pitch();
    harmonicWithReset();
    formantPeak();
    throughZero();
    clickFree();
    bounded();
    vowels();
    return bleep::test::finish("formant");
}
