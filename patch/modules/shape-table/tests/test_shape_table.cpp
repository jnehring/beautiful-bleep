// SPDX-License-Identifier: GPL-3.0-or-later
// Shape Table: the curve table (presets, interpolation, antiderivative),
// edge modes, aliasing against a naive shaper, dry/wet phase alignment, DC
// handling, harmonics and bounds.
#include "ShapeTableDsp.h"

#include "dsp/tests/TestUtil.h"

#include <random>
#include <vector>

using namespace bleep;
namespace sh = patch::shapetable;

namespace {

constexpr double kSr = 48000.0;

std::shared_ptr<const sh::Table> preset(int i) { return sh::Table::build(sh::presetPoints(i)); }

void table() {
    TEST("the linear preset is the identity, soft is odd-symmetric and bounded, the others stay within ±1");
    const auto lin = preset(0);
    for (double x = -1.0; x <= 1.0; x += 0.037) EXPECT_NEAR(lin->eval(x, sh::Clip), x, 2e-4);
    const auto soft = preset(1);
    for (double x = 0.0; x <= 1.0; x += 0.05) EXPECT_NEAR(soft->eval(x, sh::Clip), -soft->eval(-x, sh::Clip), 1e-4);
    for (int i = 0; i < sh::kPresets; ++i) {
        const auto t = preset(i);
        for (double x = -1.0; x <= 1.0; x += 0.01) EXPECT(std::fabs(t->eval(x, sh::Clip)) <= 1.0001f * sh::kLimit);
    }
    TEST("the spline passes through every control point");
    sh::Points p{};
    std::mt19937 g(4);
    std::uniform_real_distribution<float> u(-1, 1);
    for (float& v : p) v = u(g);
    const auto t = sh::Table::build(p);
    for (int i = 0; i < sh::kPoints; ++i) EXPECT_NEAR(t->eval(-1.0 + 2.0 * i / (sh::kPoints - 1), sh::Clip), std::clamp(p[(size_t)i], -1.0f, 1.0f), 2e-3);
    TEST("the antiderivative differentiates back to the curve, in every edge mode, far outside ±1");
    for (int edge : {sh::Clip, sh::Fold, sh::Wrap})
        for (double x = -5.3; x <= 5.3; x += 0.173) {
            const double h = 1e-5;
            const double d = (t->antiderivative(x + h, edge) - t->antiderivative(x - h, edge)) / (2 * h);
            EXPECT_NEAR(d, t->eval(x, edge), 0.03);
        }
    TEST("edge modes: clip holds the end, wrap repeats with period 2, fold mirrors");
    EXPECT_NEAR(t->eval(2.5, sh::Clip), t->eval(1.0, sh::Clip), 1e-6);
    EXPECT_NEAR(t->eval(1.3 + 4.0, sh::Wrap), t->eval(1.3, sh::Wrap), 1e-4);
    EXPECT_NEAR(t->eval(1.3, sh::Wrap), t->eval(-0.7, sh::Clip), 1e-4);
    EXPECT_NEAR(t->eval(1.3, sh::Fold), t->eval(0.7, sh::Clip), 1e-4);
    EXPECT_NEAR(t->eval(-1.3, sh::Fold), t->eval(-0.7, sh::Clip), 1e-4);
}

std::vector<float> run(const sh::Table* t, sh::Params p, double hz, float amp, int n, int skip = 4800) {
    sh::Channel ch;
    ch.prepare(kSr);
    ch.reset();
    std::vector<float> o;
    for (int i = 0; i < n + skip; ++i) {
        const float y = ch.process(t, p, amp * (float)std::sin(6.283185307179586 * hz * i / kSr));
        if (i >= skip) o.push_back(y);
    }
    return o;
}

void aliasing() {
    TEST("anti-aliasing: a driven sine through the fold curve — non-harmonic energy falls with quality");
    const auto t = preset(3);
    const double f0 = 2217.0;  // not a divisor of the sample rate
    double res[3];
    for (int q = 0; q < 3; ++q) {
        sh::Params p;
        p.drive = 3.0f;
        p.quality = q;
        p.dcBlock = false;
        const auto y = run(t.get(), p, f0, 0.9f, 65536);
        const double fund = test::magnitudeAt(y, f0, kSr);
        double worst = 0.0;
        for (int h = 1; h < 60; ++h) {
            double f = std::fmod(h * f0, kSr);
            if (f > kSr / 2) f = kSr - f;
            if (h * f0 < kSr / 2) continue;  // true harmonics
            // an alias of the (folded) harmonic h lands at f; make sure it isn't on a true harmonic
            const double nearest = std::round(f / f0) * f0;
            if (std::fabs(f - nearest) < 40.0 || f > 20000.0) continue;
            worst = std::max(worst, test::magnitudeAt(y, f, kSr));
        }
        res[q] = 20.0 * std::log10(worst / fund + 1e-12);
        std::printf("  quality %d: strongest alias %.1f dB\n", q, res[q]);
    }
    EXPECT(res[1] < res[0] - 3.0);
    EXPECT(res[2] < res[1] - 3.0);
    EXPECT(res[2] < -45.0);
}

void identity() {
    TEST("the linear curve at unity drive passes a sine unchanged (4×), in phase with the dry path");
    const auto t = preset(0);
    sh::Params p;
    p.drive = 1.0f;
    p.quality = 2;
    const auto y = run(t.get(), p, 1000.0, 0.5f, 16384, 9600);
    const double fund = test::magnitudeAt(y, 1000.0, kSr);
    EXPECT_NEAR(fund, 0.25, 0.25 * 0.02);
    double thd = 0.0;
    for (int h = 2; h < 9; ++h) thd += std::pow(test::magnitudeAt(y, 1000.0 * h, kSr), 2.0);
    EXPECT(std::sqrt(thd) < fund * 1e-3);
    // mix 50 %: the dry and wet paths add in phase (no comb): level stays that of the wet signal
    p.mix = 0.5f;
    const auto m = run(t.get(), p, 5000.0, 0.5f, 16384, 9600);
    EXPECT_NEAR(test::magnitudeAt(m, 5000.0, kSr), test::magnitudeAt(y, 1000.0, kSr), 0.25 * 0.04);
    for (int q = 0; q < 3; ++q) {
        sh::Params r;
        r.quality = q;
        r.mix = 0.5f;
        const auto a = run(t.get(), r, 3000.0, 0.5f, 8192, 9600);
        EXPECT_NEAR(test::magnitudeAt(a, 3000.0, kSr), 0.25, 0.25 * 0.04);
    }
}

void dcAndBias() {
    TEST("bias makes even harmonics; the DC blocker removes the offset");
    const auto t = preset(1);
    sh::Params p;
    p.drive = 2.0f;
    p.bias = 0.4f;
    p.dcBlock = true;
    const auto y = run(t.get(), p, 440.0, 0.6f, 48000, 48000);
    double mean = 0.0;
    for (float v : y) mean += v;
    mean /= (double)y.size();
    EXPECT(std::fabs(mean) < 5e-3);
    EXPECT(test::magnitudeAt(y, 880.0, kSr) > 0.01);
    p.bias = 0.0f;
    const auto z = run(t.get(), p, 440.0, 0.6f, 48000, 48000);
    EXPECT(test::magnitudeAt(z, 880.0, kSr) < 1e-3);
}

void harmonicsReadout() {
    TEST("the harmonic read-out matches the measured output at Quality off with a gentle curve");
    const auto t = preset(1);
    float h[16];
    sh::harmonics(*t, 1.0f, 0.0f, sh::Clip, h, 16);
    EXPECT(h[0] > 0.5f);
    EXPECT(h[1] < 1e-3f);  // odd-symmetric: no second harmonic
    EXPECT(h[2] > 0.01f);
    sh::Params p;
    p.quality = 0;
    p.dcBlock = false;
    const auto y = run(t.get(), p, 1000.0, 1.0f, 32768);
    EXPECT_NEAR(2.0 * test::magnitudeAt(y, 1000.0, kSr), h[0], 0.02);
    EXPECT_NEAR(2.0 * test::magnitudeAt(y, 3000.0, kSr), h[2], 0.01);
}

void wrapAsWavetable() {
    TEST("Wrap turns the curve into a oscillator-like table: a ramp input sweeps it repeatedly");
    const auto t = preset(7);
    sh::Params p;
    p.drive = 3.0f;
    p.edge = sh::Wrap;
    p.dcBlock = false;
    p.quality = 2;
    const auto y = run(t.get(), p, 300.0, 1.0f, 48000);
    EXPECT(test::allFinite(y));
    for (float v : y) EXPECT(std::fabs(v) <= 1.6f);
}

void bounds() {
    TEST("wild input and settings stay finite and bounded");
    std::mt19937 g(8);
    std::uniform_real_distribution<float> u(-1, 1);
    sh::Points pts{};
    for (float& v : pts) v = u(g);
    const auto t = sh::Table::build(pts);
    for (int edge = 0; edge < 3; ++edge)
        for (int q = 0; q < 3; ++q) {
            sh::Channel ch;
            ch.prepare(kSr);
            ch.reset();
            float peak = 0.0f;
            for (int i = 0; i < 30000; ++i) {
                sh::Params p;
                p.drive = std::pow(10.0f, (12.0f + 24.0f * u(g)) / 20.0f);
                p.bias = u(g);
                p.edge = edge;
                p.quality = q;
                p.mix = 0.5f + 0.5f * u(g);
                const float y = ch.process(t.get(), p, 8.0f * u(g));
                EXPECT(std::isfinite(y));
                peak = std::max(peak, std::fabs(y));
            }
            EXPECT(peak < 12.0f);
        }
    TEST("no table yet: silence from the wet path, no crash");
    sh::Channel c;
    c.prepare(kSr);
    c.reset();
    sh::Params p;
    for (int i = 0; i < 100; ++i) EXPECT(std::isfinite(c.process(nullptr, p, 0.5f)));
}

}  // namespace

int main() {
    table();
    aliasing();
    identity();
    dcAndBias();
    harmonicsReadout();
    wrapAsWavetable();
    bounds();
    return test::finish("shape-table");
}
