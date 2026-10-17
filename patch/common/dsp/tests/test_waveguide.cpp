// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Waveguide string: tuning (with and without dispersion), decay, stability,
// sympathetic strings.
#include "dsp/Noise.h"
#include "dsp/Random.h"
#include "dsp/Svf.h"
#include "dsp/Waveguide.h"
#include "dsp/tests/TestUtil.h"

#include <chrono>
#include <cstdio>
#include <vector>

using namespace bleep;

static double cents(double hz, double ref) { return 1200.0 * std::log2(hz / ref); }

/// Plucks a string with a short noise burst and returns `seconds` of output.
static std::vector<float> pluck(dsp::WaveguideString& s, double sr, double seconds) {
    dsp::WhiteNoise n(7);
    std::vector<float> y;
    for (int i = 0; i < (int)(seconds * sr); ++i) y.push_back(s.process(i < 64 ? n.next() : 0.0f));
    return y;
}

/// The fundamental's frequency: the peak of the (Hann-windowed) spectrum
/// near the nominal pitch, found by a coarse then a fine scan.
static double fundamentalHz(const std::vector<float>& y, double f0, double sr) {
    const std::vector<float> x(y.begin() + (long)(y.size() / 8), y.end());
    double best = -1.0, bestC = 0.0;
    for (double c = -30.0; c <= 30.0; c += 3.0) {
        const double m = test::magnitudeAt(x, f0 * std::exp2(c / 1200.0), sr);
        if (m > best) best = m, bestC = c;
    }
    // Golden-section search for the peak within ±1 cent of the coarse one.
    auto mag = [&](double c) { return test::magnitudeAt(x, f0 * std::exp2(c / 1200.0), sr); };
    const double g = 0.6180339887;
    double lo = bestC - 3.0, hi = bestC + 3.0;
    double c1 = hi - g * (hi - lo), c2 = lo + g * (hi - lo), m1 = mag(c1), m2 = mag(c2);
    while (hi - lo > 0.02) {
        if (m1 > m2) hi = c2, c2 = c1, m2 = m1, c1 = hi - g * (hi - lo), m1 = mag(c1);
        else lo = c1, c1 = c2, m1 = m2, c2 = lo + g * (hi - lo), m2 = mag(c2);
    }
    return f0 * std::exp2(0.5 * (lo + hi) / 1200.0);
}

static void tuning() {
    TEST("waveguide tuning");
    double worst = 0.0;
    for (double sr : {44100.0, 48000.0, 96000.0})
        for (double f0 : {32.703, 65.406, 261.626, 1046.5, 2093.0, 4186.0}) {
            for (float disp : {0.0f, 0.5f}) {
                for (float bright : {0.2f, 1.0f}) {
                    if (sr < 48000.0 && bright < 0.5f) continue;  // fewer cases away from 48 kHz
                    dsp::WaveguideString s;
                    s.prepare(sr);
                    dsp::StringParams p;
                    p.hz = (float)f0;
                    p.t60 = 4.0f;
                    p.brightness = bright;
                    p.dispersion = disp;
                    s.set(p);
                    const auto y = pluck(s, sr, f0 < 50.0 ? 1.0 : 0.5);
                    const double c = cents(fundamentalHz(y, f0, sr), f0);
                    worst = std::max(worst, std::fabs(c));
                    if (std::fabs(c) > 2.0)
                        std::printf("  sr %.0f f0 %.1f disp %.1f bright %.1f: %.2f cents\n", sr, f0, disp, bright, c);
                    EXPECT_NEAR(c, 0.0, f0 > 4000.0 ? 3.0 : 2.0);
                }
            }
        }
    std::printf("  string tuning: worst %.3f cents (C1 … C8, 44.1/48/96 kHz)\n", worst);
}

static void stiffness() {
    TEST("waveguide dispersion");
    const double sr = 48000.0, f0 = 110.0;
    dsp::WaveguideString s;
    s.prepare(sr);
    dsp::StringParams p;
    p.hz = (float)f0;
    p.t60 = 4.0f;
    p.brightness = 1.0f;
    p.dispersion = 1.0f;
    p.position = 0.13f;
    s.set(p);
    const auto y = pluck(s, sr, 1.0);
    // The 8th partial is well above 8 · f0.
    double best = 0.0, bestHz = 0.0;
    for (double c = -50.0; c <= 600.0; c += 2.0) {
        const double hz = 8.0 * f0 * std::exp2(c / 1200.0);
        const double m = test::magnitudeAt(y, hz, sr);
        if (m > best) best = m, bestHz = hz;
    }
    EXPECT(cents(bestHz, 8.0 * f0) > 20.0);
}

static void decay() {
    TEST("waveguide decay");
    const double sr = 48000.0;
    for (double f0 : {110.0, 880.0})
        for (float t60 : {0.3f, 2.0f, 10.0f})
            for (float bright : {0.0f, 0.5f, 1.0f}) {
                dsp::WaveguideString s;
                s.prepare(sr);
                dsp::StringParams p;
                p.hz = (float)f0;
                p.t60 = t60;
                p.brightness = bright;
                s.set(p);
                const double len = std::min(1.5 * t60, 3.0);
                auto y = pluck(s, sr, len);
                dsp::Svf bp;
                bp.set((float)f0, 4.0f, sr);
                for (float& v : y) v = bp.process(v).bp;
                const size_t w = (size_t)(0.05 * sr);
                const size_t a = (size_t)(0.1 * len * sr), b = (size_t)(0.9 * len * sr);
                const double ra = test::rms(std::vector<float>(y.begin() + a, y.begin() + a + w));
                const double rb = test::rms(std::vector<float>(y.begin() + b - w, y.begin() + b));
                const double dt = (double)(b - w / 2 - (a + w / 2)) / sr;
                const double m = 60.0 * dt / (20.0 * std::log10(ra / rb));
                if (std::fabs(m - t60) > 0.1 * t60)
                    std::printf("  f0 %.0f t60 %.1f bright %.1f: measured %.3f\n", f0, t60, bright, m);
                EXPECT_NEAR(m, t60, 0.1 * t60);
            }
}

static void position() {
    TEST("waveguide position");
    const double sr = 48000.0, f0 = 200.0;
    dsp::WaveguideString s;
    s.prepare(sr);
    dsp::StringParams p;
    p.hz = (float)f0;
    p.t60 = 3.0f;
    p.brightness = 1.0f;
    p.position = 0.5f;
    s.set(p);
    std::vector<float> y;
    for (int i = 0; i < 48000; ++i) y.push_back(s.process(i == 0 ? 1.0f : 0.0f));
    EXPECT(test::magnitudeAt(y, 2.0 * f0, sr) < 0.0316 * test::magnitudeAt(y, f0, sr));
}

static void stability() {
    TEST("waveguide stability");
    const double sr = 48000.0;
    dsp::WaveguideString s;
    s.prepare(sr);
    dsp::WhiteNoise n(3);
    float peak = 0.0f;
    bool finite = true;
    for (int i = 0; i < 4 * 48000; ++i) {
        if (i % 4 == 0) {
            dsp::StringParams p;
            p.hz = 16.0f * std::exp2(10.0f * (float)dsp::uniform01(2, (uint64_t)i, 1));
            p.t60 = 0.01f + 30.0f * (float)dsp::uniform01(2, (uint64_t)i, 2);
            p.brightness = (float)dsp::uniform01(2, (uint64_t)i, 3);
            p.dispersion = (float)dsp::uniform01(2, (uint64_t)i, 4);
            p.position = (float)dsp::uniform01(2, (uint64_t)i, 5);
            s.set(p);
        }
        const float y = s.process(0.1f * n.next());
        float a, b;
        s.pickups(a, b);
        finite = finite && std::isfinite(y) && std::isfinite(a) && std::isfinite(b);
        peak = std::max(peak, std::fabs(y));
    }
    EXPECT(finite);
    EXPECT(peak < 50.0f);
    // Long T60, full brightness, steady pitch: loop gain < 1, rings down.
    dsp::StringParams p;
    p.hz = 40.0f;
    p.t60 = 30.0f;
    p.brightness = 0.0f;
    s.set(p);
    s.reset();
    std::vector<float> y;
    for (int i = 0; i < 20 * 48000; ++i) y.push_back(s.process(i < 100 ? n.next() : 0.0f));
    EXPECT(test::allFinite(y));
    EXPECT(test::rms(std::vector<float>(y.end() - 4800, y.end())) < test::rms(std::vector<float>(y.begin(), y.begin() + 48000)));
}

static void sympathetic() {
    TEST("sympathetic strings");
    const double sr = 48000.0;
    auto drive = [&](double hz) {
        dsp::SympatheticStrings s;
        s.prepare(sr);
        s.setTuning(dsp::StringTuning::Octaves);
        s.set(110.0f, 3.0f, 0.7f, 0.3f);
        std::vector<float> y;
        for (int i = 0; i < 96000; ++i) y.push_back(s.process(0.5f * (float)std::sin(2.0 * 3.141592653589793 * hz * i / sr)).mix());
        return y;
    };
    const auto inTune = drive(440.0);
    const auto offTune = drive(440.0 * std::exp2(6.0 / 12.0));
    EXPECT(test::allFinite(inTune));
    EXPECT(test::rms(inTune, 48000) > 4.0 * test::rms(offTune, 48000));
    EXPECT(test::rms(inTune, 48000) < 2.0);

    float t[8];
    dsp::stringTuning(dsp::StringTuning::Harmonic, 1, t);
    EXPECT_NEAR(t[2], 12.0 * std::log2(3.0), 1e-4);
    float a[8], b[8];
    dsp::stringTuning(dsp::StringTuning::Inharmonic, 5, a);
    dsp::stringTuning(dsp::StringTuning::Inharmonic, 5, b);
    EXPECT(a[3] == b[3]);
}

static void cpu() {
    const double sr = 48000.0;
    dsp::WaveguideString s;
    s.prepare(sr);
    dsp::StringParams p;
    p.dispersion = 0.5f;
    float acc = 0.0f;
    const int n = 480000;
    const auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < n; ++i) {
        if (i % 32 == 0) {
            p.hz = 220.0f + (float)(i % 5);
            s.set(p);
        }
        acc += s.process(i % 9600 == 0 ? 1.0f : 0.0f);
    }
    const double ns = std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - t0).count() / n;
    std::printf("  string: %.1f ns/sample (set every 32 samples)%s\n", ns, std::isfinite(acc) ? "" : " !");
}

int main() {
    tuning();
    stiffness();
    decay();
    position();
    stability();
    sympathetic();
    cpu();
    return test::finish("waveguide");
}
