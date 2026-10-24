// SPDX-License-Identifier: GPL-3.0-only
// Meta Mod: each algorithm's defining behaviour, morphing, level matching,
// aliasing per quality, the internal oscillator's fallback table and its
// click-free switching, and bounded output under random abuse.
#include "MetaModDsp.h"

#include "dsp/Random.h"
#include "dsp/tests/TestUtil.h"

#include <random>
#include <set>
#include <vector>

using namespace bleep;
using bleep::test::magnitudeAt;
using bleep::test::rms;
using patch::MetaModDsp;
using patch::MetaModInput;
using patch::MetaModParams;

namespace {

constexpr double kSr = 48000.0;
constexpr double kTwoPi = 6.283185307179586;

double db(double x) { return 20.0 * std::log10(std::max(x, 1e-12)); }

MetaModDsp fresh() {
    MetaModDsp d;
    d.prepare(kSr);
    d.reset();
    return d;
}

/// Carrier and modulator sines (both patched); returns Out L after `skip`.
std::vector<float> run(const MetaModParams& p, double fc, double fm, float ac, float am, int n, int skip = 9600) {
    MetaModDsp d = fresh();
    MetaModInput in;
    in.carrierLConnected = in.modConnected = true;
    std::vector<float> out;
    for (int i = 0; i < n + skip; ++i) {
        in.carrierL = ac * (float)std::sin(kTwoPi * fc * i / kSr);
        in.modulator = am * (float)std::sin(kTwoPi * fm * i / kSr);
        const float y = d.tick(p, in).l;
        if (i >= skip) out.push_back(y);
    }
    return out;
}

MetaModParams at(float algorithm, float timbre, int quality = 1) {
    MetaModParams p;
    p.algorithm = algorithm;
    p.timbre = timbre;
    p.quality = quality;
    return p;
}

void crossfade() {
    TEST("Crossfade: Timbre 0 passes the carrier, 100 % the modulator");
    for (int i = 0; i < 100; ++i) {
        const float a = std::sin(0.1f * i), b = std::cos(0.37f * i);
        EXPECT(MetaModDsp::algorithm(MetaModDsp::Crossfade, a, b, 0.0f, 0) == a);
        EXPECT_NEAR(MetaModDsp::algorithm(MetaModDsp::Crossfade, a, b, 1.0f, 0), b, 1e-6);
    }
    // Through the whole module (Eco, no latency): only the 5 Hz DC blocker remains.
    const auto y = run(at(0.0f, 0.0f, 0), 1000.0, 110.0, 0.8f, 0.8f, 4800);
    EXPECT_NEAR(magnitudeAt(y, 1000.0, kSr), 0.4, 0.004);
    EXPECT(magnitudeAt(y, 110.0, kSr) < 1e-4);
}

void rings() {
    TEST("rings: digital ring is a pure product; analog ring suppresses the carrier at Timbre 0, not at 100 %");
    const auto d0 = run(at(3.0f, 0.0f), 440.0, 110.0, 1.0f, 1.0f, 32768);
    const double side = magnitudeAt(d0, 330.0, kSr);
    EXPECT(side > 0.1);
    EXPECT(magnitudeAt(d0, 550.0, kSr) > 0.1);
    EXPECT(magnitudeAt(d0, 440.0, kSr) < side * 1e-4);  // −80 dB
    EXPECT(magnitudeAt(d0, 110.0, kSr) < side * 1e-4);
    const auto d1 = run(at(3.0f, 1.0f), 440.0, 110.0, 1.0f, 1.0f, 32768);
    EXPECT(magnitudeAt(d1, 440.0, kSr) > 0.1);  // AM: the carrier stays

    // Analog ring: carrier in the output relative to the carrier at the input (0.5 · 0.5).
    const auto a0 = run(at(2.0f, 0.0f), 440.0, 110.0, 0.5f, 0.5f, 32768);
    const auto a1 = run(at(2.0f, 1.0f), 440.0, 110.0, 0.5f, 0.5f, 32768);
    const double s0 = db(magnitudeAt(a0, 440.0, kSr) / 0.25), s1 = db(magnitudeAt(a1, 440.0, kSr) / 0.25);
    std::printf("  analog ring carrier: %.1f dB at Timbre 0, %.1f dB at 100 %%\n", s0, s1);
    EXPECT(s0 < -40.0);
    EXPECT(s1 > -20.0);
    EXPECT(magnitudeAt(a0, 550.0, kSr) > 0.02);  // the sidebands are there
}

void chebyshev() {
    TEST("Chebyshev: n = 3 turns a full-scale sine into its 3rd harmonic");
    MetaModDsp d = fresh();
    MetaModInput in;
    in.carrierLConnected = in.modConnected = true;  // modulator patched but silent
    const MetaModParams p = at(7.0f, 2.0f / 15.0f);
    std::vector<float> y;
    for (int i = 0; i < 9600 + 32768; ++i) {
        in.carrierL = (float)std::sin(kTwoPi * 300.0 * i / kSr);
        const float v = d.tick(p, in).l;
        if (i >= 9600) y.push_back(v);
    }
    const double h3 = magnitudeAt(y, 900.0, kSr);
    for (int h : {1, 2, 4, 5}) EXPECT(magnitudeAt(y, 300.0 * h, kSr) < 0.01 * h3);
    EXPECT(h3 > 0.3);
    // Order 1 … 16 stay bounded for |a| ≤ 1.
    for (int k = 0; k <= 100; ++k)
        for (float a = -1.0f; a <= 1.0f; a += 0.01f)
            EXPECT(std::fabs(MetaModDsp::algorithm(MetaModDsp::Chebyshev, a, 0.0f, k / 100.0f, 0)) <= 1.0001f);
}

void bitwise() {
    TEST("Bitwise: XOR with itself is 0; 2 bits give at most 4 levels; Sum mod wraps");
    for (float a = -1.0f; a <= 1.0f; a += 0.013f) EXPECT(MetaModDsp::bitwise(a, a, 0.3f, 0) == 0.0f);
    EXPECT(MetaModDsp::bitsFor(0.0f) == 16 && MetaModDsp::bitsFor(1.0f) == 2);
    std::set<float> levels;
    for (int op = 0; op < 4; ++op)
        for (float a = -1.0f; a <= 1.0f; a += 0.01f)
            for (float b = -1.0f; b <= 1.0f; b += 0.07f) {
                const float v = MetaModDsp::bitwise(a, b, 1.0f, op);
                levels.insert(v);
                EXPECT(v >= -1.0f && v < 1.0f);
            }
    EXPECT(levels.size() <= 4);
    EXPECT(MetaModDsp::bitwise(0.75f, 0.5f, 1.0f, 3) == -1.0f);  // 1 + 1 wraps to −2 in 2 bits
}

void comparator() {
    TEST("Comparator at Timbre 0: a ±1 square at the crossings");
    for (float a = -1.0f; a <= 1.0f; a += 0.05f)
        for (float b = -1.0f; b <= 1.0f; b += 0.05f)
            if (std::fabs(a - b) > 0.01f)
                EXPECT_NEAR(std::fabs(MetaModDsp::algorithm(MetaModDsp::Comparator, a, b, 0.0f, 0)), 1.0, 1e-3);
    EXPECT_NEAR(MetaModDsp::algorithm(MetaModDsp::Comparator, 0.3f, -0.6f, 1.0f, 0), 0.3, 1e-6);  // max
}

void vocoder() {
    TEST("Vocoder: a noise carrier takes the spectrum of a 1 kHz modulator");
    MetaModDsp d = fresh();
    MetaModInput in;
    in.carrierLConnected = in.modConnected = true;
    const MetaModParams p = at(6.0f, 0.5f);
    std::vector<float> y;
    for (int i = 0; i < 9600 + 65536; ++i) {
        in.carrierL = (float)(2.0 * dsp::uniform01(3, (uint64_t)i, 0) - 1.0);
        in.modulator = (float)std::sin(kTwoPi * 1000.0 * i / kSr);
        const float v = d.tick(p, in).l;
        if (i >= 9600) y.push_back(v);
    }
    auto band = [&](double f) {
        double s = 0.0;
        for (double x = f / 1.1; x <= f * 1.1; x += f / 100.0) s += magnitudeAt(y, x, kSr);
        return s;
    };
    const double near = band(1000.0);
    std::printf("  1 kHz band vs 250 Hz: %.1f dB, vs 4 kHz: %.1f dB\n", db(near / band(250.0)), db(near / band(4000.0)));
    EXPECT(near > 10.0 * band(250.0));
    EXPECT(near > 10.0 * band(4000.0));
}

void morph() {
    TEST("Morphing: Algorithm 2.5 is the average of 2 and 3");
    const auto m = run(at(2.5f, 0.4f), 440.0, 110.0, 0.9f, 0.7f, 9600);
    const auto a = run(at(2.0f, 0.4f), 440.0, 110.0, 0.9f, 0.7f, 9600);
    const auto b = run(at(3.0f, 0.4f), 440.0, 110.0, 0.9f, 0.7f, 9600);
    double worst = 0.0;
    for (size_t i = 0; i < m.size(); ++i) worst = std::max(worst, (double)std::fabs(m[i] - 0.5f * (a[i] + b[i])));
    EXPECT(worst < 1e-4);
    // The same across a linear and a nonlinear neighbour (vocoder → Chebyshev at 6.5).
    const auto v = run(at(6.5f, 0.3f), 440.0, 110.0, 0.9f, 0.7f, 9600);
    const auto v6 = run(at(6.0f, 0.3f), 440.0, 110.0, 0.9f, 0.7f, 9600);
    const auto v7 = run(at(7.0f, 0.3f), 440.0, 110.0, 0.9f, 0.7f, 9600);
    worst = 0.0;
    for (size_t i = 0; i < v.size(); ++i) worst = std::max(worst, (double)std::fabs(v[i] - 0.5f * (v6[i] + v7[i])));
    EXPECT(worst < 1e-3);
}

void levels() {
    TEST("level matching: every integer position within ±2 dB of the crossfade");
    const double ref = rms(run(at(0.0f, 0.5f), 440.0, 110.0, 1.0f, 1.0f, 48000));
    for (int alg = 1; alg < MetaModDsp::kAlgorithms; ++alg) {
        double level;
        if (alg == MetaModDsp::Vocoder) {  // noise carrier, buzzing modulator: two sines share no band
            MetaModDsp d = fresh();
            MetaModInput in;
            in.carrierLConnected = in.modConnected = true;
            std::vector<float> y;
            for (int i = 0; i < 9600 + 48000; ++i) {
                in.carrierL = (float)(2.0 * dsp::uniform01(1, (uint64_t)i, 0) - 1.0);
                const double ph = std::fmod(i * 120.0 / kSr, 1.0);
                in.modulator = (float)((2.0 * ph - 1.0) * (0.5 + 0.5 * std::sin(kTwoPi * 3.0 * i / kSr)));
                const float v = d.tick(at((float)alg, 0.5f), in).l;
                if (i >= 9600) y.push_back(v);
            }
            level = rms(y);
        } else {
            level = rms(run(at((float)alg, 0.5f), 440.0, 110.0, 1.0f, 1.0f, 48000));
        }
        std::printf("  algorithm %d: %+.2f dB\n", alg, db(level / ref));
        EXPECT(std::fabs(db(level / ref)) <= 2.0);
    }
}

void aliasing() {
    TEST("aliasing: Fold of a 5 kHz sine at Timbre 100 % — High vs Eco");
    const double f0 = 5000.0;
    double result[3];
    for (int q = 0; q < 3; ++q) {
        MetaModDsp d = fresh();
        MetaModInput in;
        in.carrierLConnected = in.modConnected = true;
        const MetaModParams p = at(1.0f, 1.0f, q);
        std::vector<float> y;
        for (int i = 0; i < 9600 + 65536; ++i) {
            in.carrierL = (float)std::sin(kTwoPi * f0 * i / kSr);
            const float v = d.tick(p, in).l;
            if (i >= 9600) y.push_back(v);
        }
        const double fund = magnitudeAt(y, f0, kSr);
        double worst = 0.0;
        for (int h = 3; h < 200; h += 2) {
            double f = std::fmod(h * f0, kSr);
            if (f > kSr / 2) f = kSr - f;
            const double nearest = std::round(f / f0) * f0;
            if (h * f0 < kSr / 2 || std::fabs(f - nearest) < 50.0 || f < 30.0 || f > 20000.0) continue;
            worst = std::max(worst, magnitudeAt(y, f, kSr));
        }
        result[q] = db(worst / fund);
        std::printf("  quality %d (%d×): strongest alias %.1f dB\n", q, MetaModDsp::factor(q), result[q]);
    }
    EXPECT(result[2] < -60.0);
    EXPECT(result[0] > result[1] + 10.0);  // Eco is measurably worse
    EXPECT(result[1] > result[2]);
}

void fallback() {
    TEST("the internal oscillator stands in per the table; switching ramps without a click");
    auto render = [](bool carrier, bool mod, float timbre) {
        MetaModDsp d = fresh();
        MetaModInput in;
        in.carrierLConnected = carrier;
        in.modConnected = mod;
        MetaModParams p = at(0.0f, timbre, 0);
        p.oscTune = 7.0f;  // the oscillator at G4 (392 Hz)
        std::vector<float> out;
        for (int i = 0; i < 9600 + 16384; ++i) {
            in.carrierL = 0.5f * (float)std::sin(kTwoPi * 1000.0 * i / kSr);
            in.modulator = 0.5f * (float)std::sin(kTwoPi * 150.0 * i / kSr);
            const float v = d.tick(p, in).l;
            if (i >= 9600) out.push_back(v);
        }
        return out;
    };
    const double osc = 392.0;
    // Nothing patched: carrier = oscillator, modulator silent.
    EXPECT(magnitudeAt(render(false, false, 0.0f), osc, kSr) > 0.4);
    EXPECT(rms(render(false, false, 1.0f)) < 1e-4);
    // Only the modulator: carrier = oscillator, modulator = input.
    EXPECT(magnitudeAt(render(false, true, 0.0f), osc, kSr) > 0.4);
    EXPECT(magnitudeAt(render(false, true, 1.0f), 150.0, kSr) > 0.2);
    // Only the carrier: modulator = oscillator.
    EXPECT(magnitudeAt(render(true, false, 0.0f), 1000.0, kSr) > 0.2);
    EXPECT(magnitudeAt(render(true, false, 1.0f), osc, kSr) > 0.4);
    // Both: the inputs.
    EXPECT(magnitudeAt(render(true, true, 1.0f), 150.0, kSr) > 0.2);
    EXPECT(magnitudeAt(render(true, true, 1.0f), osc, kSr) < 1e-3);

    // Switching: a slow oscillator and a slow carrier, patched in mid-run.
    MetaModDsp d = fresh();
    MetaModInput in;
    MetaModParams p = at(0.0f, 0.0f, 0);
    p.oscOctave = -3;  // 32.7 Hz
    float prev = 0.0f, worst = 0.0f;
    for (int i = 0; i < 48000; ++i) {
        in.carrierLConnected = (i / 6000) % 2 == 1;
        in.carrierL = 0.9f * (float)std::cos(kTwoPi * 30.0 * i / kSr + 2.0);
        const float y = d.tick(p, in).l;
        if (i > 0) worst = std::max(worst, std::fabs(y - prev));
        prev = y;
    }
    EXPECT(worst < 0.05f);
}

void bounded() {
    TEST("bounded: random signals and audio-rate random knobs stay within ±4, never NaN");
    std::mt19937 rng(11);
    std::uniform_real_distribution<float> u(0.0f, 1.0f);
    float peak = 0.0f;
    bool finite = true;
    for (int run = 0; run < 12; ++run) {
        MetaModDsp d = fresh();
        MetaModInput in;
        in.carrierLConnected = in.modConnected = true;
        in.carrierRConnected = run % 2 == 1;
        MetaModParams p;
        p.quality = run % 3;
        p.bitwiseOp = run % 4;
        for (int i = 0; i < 9600; ++i) {
            p.algorithm = 7.0f * u(rng);
            p.timbre = u(rng);
            p.carrierLevel = 2.0f * u(rng);
            p.modLevel = 2.0f * u(rng);
            p.mix = u(rng);
            in.carrierL = 30.0f * (2.0f * u(rng) - 1.0f);
            in.carrierR = 30.0f * (2.0f * u(rng) - 1.0f);
            in.modulator = i % 500 == 0 ? NAN : 30.0f * (2.0f * u(rng) - 1.0f);
            const auto f = d.tick(p, in);
            finite = finite && std::isfinite(f.l) && std::isfinite(f.r) && std::isfinite(f.env);
            peak = std::max({peak, std::fabs(f.l), std::fabs(f.r)});
        }
    }
    std::printf("  peak %.2f\n", peak);
    EXPECT(finite);
    EXPECT(peak <= 4.0f);
}

}  // namespace

int main() {
    crossfade();
    rings();
    chebyshev();
    bitwise();
    comparator();
    vocoder();
    morph();
    levels();
    aliasing();
    fallback();
    bounded();
    return bleep::test::finish("meta-mod");
}
