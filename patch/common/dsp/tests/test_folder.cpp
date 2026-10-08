// SPDX-License-Identifier: MIT
// Folder: fold curves and antiderivatives, ADAA accuracy and aliasing, stages,
// taps, symmetry, DC blocker, bounds, and use with the Oversampler.
#include "dsp/Folder.h"
#include "dsp/Oversampler.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <vector>

using namespace bleep::dsp;
using bleep::test::magnitudeAt;

namespace {

constexpr double kSr = 48000.0;
constexpr double kTwoPi = 6.283185307179586;

void curves() {
    TEST("fold curves and their antiderivatives");
    for (double x = -1.0; x <= 1.0; x += 0.01) EXPECT_NEAR(fold::hard(x), x, 1e-12);
    EXPECT_NEAR(fold::hard(1.5), 0.5, 1e-12);
    EXPECT_NEAR(fold::hard(3.0), -1.0, 1e-12);
    EXPECT_NEAR(fold::soft(1.0), 1.0, 1e-12);
    double worst = 0.0;
    for (double shape : {0.0, 0.3, 1.0})
        for (double x = -12.0; x <= 12.0; x += 0.0137) {
            const double h = 1e-6;
            const double d = (fold::curveIntegral(x + h, shape) - fold::curveIntegral(x - h, shape)) / (2 * h);
            worst = std::max(worst, std::fabs(d - fold::curve(x, shape)));
        }
    EXPECT(worst < 1e-6);
}

void adaaMatchesNaive() {
    TEST("ADAA ≈ naive fold of a slow signal; DC uses the fallback");
    fold::Stage st;
    double worst = 0.0, prevU = 0.0;
    for (int i = 0; i < 48000; ++i) {
        const double u = 3.0 * std::sin(kTwoPi * 2.0 * i / kSr);
        const double y = st.process(u, 0.5);
        if (i > 0) worst = std::max(worst, std::fabs(y - fold::curve(0.5 * (u + prevU), 0.5)));
        prevU = u;
    }
    EXPECT(worst < 1e-4);
    fold::Stage dc;
    for (int i = 0; i < 10; ++i) EXPECT_NEAR(dc.process(0.7, 0.2), fold::curve(0.7, 0.2), 1e-12);
}

std::vector<float> foldSine(double hz, Folder::Params p, int factor, float amp = 1.0f, int n = 1 << 15) {
    Folder f;
    Upsampler up;
    Downsampler down;
    std::vector<float> y((size_t)n);
    float buf[4];
    for (int i = 0; i < n; ++i) {
        up.process(amp * (float)std::sin(kTwoPi * hz * i / kSr), factor, buf);
        for (int k = 0; k < factor; ++k) buf[k] = f.process(buf[k], p);
        y[(size_t)i] = down.process(buf, factor);
    }
    return y;
}

/// RMS sum of the magnitudes at the folded alias positions of harmonics above
/// Nyquist, relative to the strongest of the first five harmonics.
double aliasLevel(const std::vector<float>& y, double hz) {
    double worst = 0.0;
    for (int k = 2; k < 200; ++k) {
        double f = std::fmod(k * hz, kSr);
        if (f > kSr / 2) f = kSr - f;
        if (k * hz < kSr / 2) continue;
        const double toHarmonic = std::fabs(f / hz - std::round(f / hz)) * hz;
        if (toHarmonic < 40.0 || f < 40.0) continue;
        const double m = magnitudeAt(y, f, kSr);
        worst += m * m;
    }
    worst = std::sqrt(worst);
    double ref = 0.0;
    for (int k = 1; k <= 5; ++k) ref = std::max(ref, magnitudeAt(y, k * hz, kSr));
    return worst / ref;
}

void adaaReducesAliasing() {
    TEST("ADAA reduces aliasing (more so oversampled); oversampling reduces it further");
    Folder::Params p;
    p.gain = 2.0f;
    p.shape = 1.0f;
    p.tap = 2.0f;
    const double hz = 1234.5;
    double naive[3], adaa[3];
    for (int i = 0; i < 3; ++i) {
        p.adaa = false;
        naive[i] = aliasLevel(foldSine(hz, p, 1 << i), hz);
        p.adaa = true;
        adaa[i] = aliasLevel(foldSine(hz, p, 1 << i), hz);
        std::printf("  %d×: aliasing naive %.1f dB, ADAA %.1f dB\n", 1 << i, 20 * std::log10(naive[i]), 20 * std::log10(adaa[i]));
    }
    EXPECT(adaa[0] < 0.6 * naive[0]);    // ~ −6 dB at 1×
    EXPECT(adaa[1] < 0.25 * naive[1]);   // ~ −16 dB at 2×
    EXPECT(adaa[2] < 0.25 * naive[2]);
    EXPECT(adaa[2] < 0.02 * adaa[0]);    // 4× + ADAA: > 34 dB below 1× ADAA
}

void identityAndSymmetry() {
    TEST("hard shape, gain 1, symmetry 0: a ±0.9 sine passes clean; symmetric input → no even harmonics");
    Folder::Params p;
    p.gain = 1.0f;
    p.shape = 1.0f;
    p.tap = 1.0f;
    const double hz = 1000.0;
    const auto y = foldSine(hz, p, 1, 0.9f);
    const double fund = magnitudeAt(y, hz, kSr);
    EXPECT(magnitudeAt(y, 2 * hz, kSr) < 3e-5 * fund);  // < −90 dB
    EXPECT(magnitudeAt(y, 3 * hz, kSr) < 3e-5 * fund);
    p.gain = 3.0f;
    p.shape = 0.4f;
    p.tap = 6.0f;
    const auto z = foldSine(hz, p, 2);
    const double f2 = magnitudeAt(z, hz, kSr) + magnitudeAt(z, 3 * hz, kSr);
    EXPECT(magnitudeAt(z, 2 * hz, kSr) < 3e-5 * f2);
    EXPECT(magnitudeAt(z, 4 * hz, kSr) < 3e-5 * f2);
    p.symmetry = 0.3f;
    const auto w = foldSine(hz, p, 2);
    EXPECT(magnitudeAt(w, 2 * hz, kSr) > 1e-3);
}

void tapsAndStages() {
    TEST("integer taps = stage outputs, fractional taps crossfade");
    Folder a, b, c;
    Folder::Params p;
    p.gain = 2.0f;
    p.shape = 0.6f;
    p.symmetry = 0.2f;
    for (int i = 0; i < 1000; ++i) {
        const float x = (float)std::sin(0.01 * i);
        p.tap = 6.0f;
        a.process(x, p);
        p.tap = 3.0f;
        const float y3 = b.process(x, p);
        EXPECT_NEAR(y3, a.stage(3), 1e-6);
        EXPECT(b.stage(4) == 0.0f);  // not computed
        p.tap = 2.5f;
        const float y25 = c.process(x, p);
        EXPECT_NEAR(y25, 0.5f * (a.stage(2) + a.stage(3)), 1e-6);
    }
    Folder::Params q;
    q.tap = 1.0f;
    q.shape = 1.0f;
    EXPECT_NEAR(Folder::transfer(0.5f, q), 0.5f, 1e-6);
    q.gain = 2.0f;
    EXPECT_NEAR(Folder::transfer(0.75f, q), 0.5f, 1e-6);
}

void bounds() {
    TEST("bounded within ±1 for inputs up to ±20 and any knobs");
    Folder f;
    uint32_t s = 7;
    auto rnd = [&s] {
        s = s * 1664525u + 1013904223u;
        return (float)(s >> 8) / 16777216.0f;
    };
    float peak = 0.0f;
    bool finite = true;
    Folder::Params p;
    for (int i = 0; i < 200000; ++i) {
        if (i % 16 == 0) {
            p.gain = 4.0f * rnd();
            p.shape = rnd();
            p.symmetry = 2.0f * rnd() - 1.0f;
            p.tap = 1.0f + 5.0f * rnd();
            p.firstShape = rnd() < 0.5f ? -1.0f : rnd();
        }
        const float y = f.process(40.0f * rnd() - 20.0f, p);
        finite = finite && std::isfinite(y);
        peak = std::max(peak, std::fabs(y));
    }
    EXPECT(finite);
    EXPECT(peak <= 1.0f + 1e-6f);
}

void dcBlocker() {
    TEST("DC blocker removes Symmetry's DC");
    Folder f;
    fold::DcBlocker dc;
    dc.prepare(kSr);
    Folder::Params p;
    p.gain = 2.0f;
    p.symmetry = 0.6f;
    double mean = 0.0, raw = 0.0;
    const int n = 96000;
    for (int i = 0; i < n; ++i) {
        const float x = f.process((float)std::sin(kTwoPi * 220.0 * i / kSr), p);
        const float y = dc.process(x);
        if (i >= n - 48000) mean += y, raw += x;
    }
    EXPECT(std::fabs(raw / 48000.0) > 0.05);
    EXPECT(std::fabs(mean / 48000.0) < 1e-3);
}

}  // namespace

int main() {
    curves();
    adaaMatchesNaive();
    adaaReducesAliasing();
    identityAndSymmetry();
    tapsAndStages();
    bounds();
    dcBlocker();
    return bleep::test::finish("folder");
}
