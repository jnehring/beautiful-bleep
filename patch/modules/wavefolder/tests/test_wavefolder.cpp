// SPDX-License-Identifier: GPL-3.0-or-later
// Folder module: clean identity at Fold 0, aliasing per quality, bounds,
// symmetry and DC, tap cost, the internal oscillator and its source logic,
// and the latency-compensated dry path. (The fold curves, ADAA accuracy, the
// ill-conditioned fallback and integer taps are covered by the shared
// common/dsp/tests/test_folder.cpp.)
#include "WavefolderDsp.h"

#include "dsp/tests/TestUtil.h"

#include <chrono>
#include <random>
#include <vector>

using namespace bleep;
using bleep::test::magnitudeAt;
using patch::WavefolderDsp;
using patch::WavefolderFrame;
using patch::WavefolderInput;
using patch::WavefolderParams;

namespace {

constexpr double kSr = 48000.0;
constexpr double kTwoPi = 6.283185307179586;

WavefolderDsp fresh() {
    WavefolderDsp d;
    d.prepare(kSr);
    d.reset();
    return d;
}

/// Folds a sine of `hz` and amplitude `amp` (In L only); returns Out L after `skip` samples.
std::vector<float> foldSine(WavefolderDsp& d, const WavefolderParams& p, double hz, float amp, int n, int skip = 4800) {
    std::vector<float> out;
    WavefolderInput in;
    in.lConnected = true;
    for (int i = 0; i < n + skip; ++i) {
        in.l = amp * (float)std::sin(kTwoPi * hz * i / kSr);
        const auto f = d.tick(p, in);
        if (i >= skip) out.push_back(f.l);
    }
    return out;
}

double db(double x) { return 20.0 * std::log10(std::max(x, 1e-12)); }

void identity() {
    TEST("Fold 0 %, Shape 100 %, Symmetry 0: a ±0.9 sine passes cleanly");
    for (int q = 0; q < WavefolderDsp::kQualities; ++q) {
        WavefolderParams p;
        p.shape = 1.0f;
        p.quality = q;
        WavefolderDsp d = fresh();
        const auto y = foldSine(d, p, 1000.0, 0.9f, 32768);
        const double fund = magnitudeAt(y, 1000.0, kSr);
        double thd = 0.0;
        for (int h = 2; h <= 9; ++h) thd += std::pow(magnitudeAt(y, 1000.0 * h, kSr), 2.0);
        std::printf("  quality %d: fundamental %.2f dB, THD %.1f dB\n", q, db(fund / 0.45), db(std::sqrt(thd) / fund));
        EXPECT(std::sqrt(thd) < fund * 3.2e-5);  // −90 dB
        EXPECT_NEAR(fund, 0.45, 0.45 * 0.02);    // within 0.2 dB (ADAA's half-sample averaging)
    }
}

void aliasing() {
    TEST("aliasing: a C5 sine, deep folds — non-harmonic energy per quality");
    const double f0 = 523.2511306;
    struct Case {
        float fold, tap;
        double eco, normal;  // limits in dB relative to the fundamental
    };
    // Fold 100 % at Tap 2 is a total drive of 16×; Fold 50 % at Tap 6 is 64×.
    for (const Case c : {Case{1.0f, 2.0f, -30.0, -80.0}, Case{0.5f, 6.0f, -35.0, -70.0}, Case{1.0f, 1.0f, -70.0, -110.0}}) {
        double result[WavefolderDsp::kQualities];
        for (int q = 0; q < WavefolderDsp::kQualities; ++q) {
            WavefolderParams p;
            p.fold = c.fold;
            p.tap = c.tap;
            p.quality = q;
            WavefolderDsp d = fresh();
            const auto y = foldSine(d, p, f0, 1.0f, 65536);
            const double fund = magnitudeAt(y, f0, kSr);
            double worst = 0.0;
            for (int h = 3; h < 2000; h += 2) {  // odd harmonics only (symmetric fold)
                double f = std::fmod(h * f0, kSr);
                if (f > kSr / 2) f = kSr - f;
                const double nearest = std::round(f / f0) * f0;
                if (h * f0 < kSr / 2 || std::fabs(f - nearest) < 40.0 || f < 30.0 || f > 20000.0) continue;
                worst = std::max(worst, magnitudeAt(y, f, kSr));
            }
            result[q] = db(worst / fund);
            std::printf("  fold %.0f %% tap %.0f, %d×: strongest alias %.1f dB\n", c.fold * 100, c.tap,
                        WavefolderDsp::factor(q), result[q]);
        }
        EXPECT(result[0] < c.eco);
        EXPECT(result[1] < c.normal);
        EXPECT(result[1] < result[0]);
    }
}

void bounds() {
    TEST("bounds: random inputs up to ±20 and knob extremes stay within ±2.2 and finite");
    std::mt19937 rng(7);
    std::uniform_real_distribution<float> u(-1.0f, 1.0f);
    float peak = 0.0f;
    bool finite = true;
    for (int run = 0; run < 24; ++run) {
        WavefolderParams p;
        p.fold = run % 2 ? 1.0f : 0.0f;
        p.symmetry = run % 3 == 0 ? -1.0f : run % 3 == 1 ? 1.0f : 0.0f;
        p.shape = run % 4 < 2 ? 0.0f : 1.0f;
        p.tap = 1.0f + (float)(run % 6) + 0.5f * (run % 2);
        p.spread = run % 5 == 0 ? 1.0f : 0.0f;
        p.quality = run % 2;
        WavefolderDsp d = fresh();
        WavefolderInput in;
        in.lConnected = in.rConnected = true;
        for (int i = 0; i < 4800; ++i) {
            in.l = 20.0f * u(rng);
            in.r = 20.0f * u(rng);
            if (run % 7 == 0) p.fold = 0.5f + 0.5f * u(rng), p.tap = 3.5f + 2.5f * u(rng);  // audio-rate modulation
            const auto f = d.tick(p, in);
            finite = finite && std::isfinite(f.l) && std::isfinite(f.r);
            peak = std::max({peak, std::fabs(f.l), std::fabs(f.r)});
        }
    }
    std::printf("  peak %.3f\n", peak);
    EXPECT(finite);
    EXPECT(peak <= 2.2f);  // ±1 folds; strong Symmetry minus its DC reaches about ±2
}

void symmetryAndDc() {
    TEST("Symmetry 0: no even harmonics; with Symmetry, no DC after 1 s");
    WavefolderParams p;
    p.fold = 0.6f;
    WavefolderDsp d = fresh();
    const auto y = foldSine(d, p, 440.0, 0.8f, 32768);
    const double fund = magnitudeAt(y, 440.0, kSr);
    double even = 0.0;
    for (int h = 2; h <= 20; h += 2) even = std::max(even, magnitudeAt(y, 440.0 * h, kSr));
    EXPECT(even < fund * 3.2e-5);
    p.symmetry = 0.7f;
    WavefolderDsp e = fresh();
    const auto z = foldSine(e, p, 440.0, 0.8f, 48000, 48000);
    double mean = 0.0, even2 = 0.0;
    for (float v : z) mean += v;
    mean /= (double)z.size();
    for (int h = 2; h <= 6; h += 2) even2 = std::max(even2, magnitudeAt(z, 440.0 * h, kSr));
    EXPECT(std::fabs(mean) < 1e-3);
    EXPECT(even2 > 1e-3);  // and Symmetry does add even harmonics
}

void tapCost() {
    TEST("Tap 1 computes one stage: cheaper than Tap 6");
    auto time = [](float tap) {
        WavefolderParams p;
        p.fold = 0.7f;
        p.shape = 0.5f;
        p.tap = tap;
        WavefolderDsp d = fresh();
        const auto t0 = std::chrono::steady_clock::now();
        const auto y = foldSine(d, p, 220.0, 1.0f, 96000, 0);
        (void)y;
        return std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    };
    time(6.0f);
    double t1 = 1e9, t6 = 1e9;
    for (int i = 0; i < 3; ++i) t1 = std::min(t1, time(1.0f)), t6 = std::min(t6, time(6.0f));
    EXPECT(t1 < t6);
}

void oscillator() {
    TEST("internal oscillator: Auto follows the patch state, Internal + In L is FM, Osc is the oscillator");
    WavefolderParams p;
    p.shape = 1.0f;
    WavefolderInput in;
    in.pitchConnected = true;  // only Pitch: Auto runs the oscillator at C4
    WavefolderDsp d = fresh();
    std::vector<float> osc, out;
    for (int i = 0; i < 32768; ++i) {
        const auto f = d.tick(p, in);
        osc.push_back(f.osc);
        out.push_back(f.l);
    }
    const double c4 = dsp::osc::kC4Hz;
    EXPECT(magnitudeAt(osc, c4, kSr) > 0.45);
    EXPECT(magnitudeAt(out, c4, kSr) > 0.4);
    // Osc is a sine at C4 (Wave 0 %).
    for (int i = 100; i < 200; ++i) EXPECT_NEAR(osc[(size_t)i], std::sin(kTwoPi * c4 * i / kSr), 1e-4);
    // In L patched too: Auto folds the input instead, the oscillator falls silent.
    in.lConnected = true;
    in.l = 0.0f;
    WavefolderFrame f;
    for (int i = 0; i < 480; ++i) f = d.tick(p, in);
    EXPECT(f.osc == 0.0f);
    // Internal: In L is FM — a sine modulator adds sidebands.
    p.source = 2;
    p.fmDepth = 0.5f;
    WavefolderDsp e = fresh();
    std::vector<float> fm;
    for (int i = 0; i < 32768; ++i) {
        in.l = (float)std::sin(kTwoPi * 100.0 * i / kSr);
        fm.push_back(e.tick(p, in).osc);
    }
    EXPECT(magnitudeAt(fm, c4 + 100.0, kSr) > 0.05);
    // Input: never the oscillator.
    p.source = 1;
    in.lConnected = false;
    WavefolderDsp g = fresh();
    for (int i = 0; i < 100; ++i) EXPECT(g.tick(p, in).osc == 0.0f);
}

void dryInPhase() {
    TEST("Mix 50 % with Fold 0 % and Shape 100 % equals the dry signal (in phase)");
    for (int q = 0; q < WavefolderDsp::kQualities; ++q) {
        double worst = 0.0;
        for (double hz : {200.0, 2000.0}) {
            WavefolderParams p;
            p.shape = 1.0f;
            p.quality = q;
            WavefolderDsp half = fresh(), dry = fresh();
            WavefolderInput in;
            in.lConnected = true;
            for (int i = 0; i < 24000; ++i) {
                in.l = 0.8f * (float)std::sin(kTwoPi * hz * i / kSr);
                p.mix = 0.5f;
                const float y = half.tick(p, in).l;
                p.mix = 0.0f;
                const float want = dry.tick(p, in).l;
                if (i > 4800) worst = std::max(worst, (double)std::fabs(y - want));
            }
        }
        std::printf("  %d×: worst error %.2e\n", WavefolderDsp::factor(q), worst);
        // In phase; what remains is level: six ADAA stages average neighbouring
        // samples, −0.1 dB at 2 kHz at 2× (a 1 % error budget).
        EXPECT(worst < 8e-3);
    }
    // The dry path at Mix 0 is the input, delayed by the latency (and DC-blocked).
    WavefolderParams p;
    p.mix = 0.0f;
    WavefolderDsp d = fresh();
    WavefolderInput in;
    in.lConnected = true;
    const double latency = WavefolderDsp::latency(4, 6);
    double worst = 0.0;
    for (int i = 0; i < 24000; ++i) {
        in.l = 0.8f * (float)std::sin(kTwoPi * 2000.0 * i / kSr);
        const float y = d.tick(p, in).l;
        const float want = 0.8f * (float)std::sin(kTwoPi * 2000.0 * (i - latency) / kSr);
        if (i > 4800) worst = std::max(worst, (double)std::fabs(y - want));
    }
    EXPECT(worst < 4e-3);  // the 5 Hz DC blocker leads by 0.15° at 2 kHz
}

}  // namespace

int main() {
    identity();
    aliasing();
    bounds();
    symmetryAndDc();
    tapCost();
    oscillator();
    dryInPhase();
    return bleep::test::finish("wavefolder");
}
