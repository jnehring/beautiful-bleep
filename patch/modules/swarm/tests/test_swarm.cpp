// SPDX-License-Identifier: GPL-3.0-only
// Swarm: unison tuning and level, settled chord stacks, quantizing while
// opening, seeded glides, detune patterns, stereo, Cross FM, aliasing and
// repeatable renders.
#include "SwarmDsp.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <vector>

using namespace bleep;
using bleep::test::magnitudeAt;
using patch::SwarmDsp;
using patch::SwarmParams;

namespace {

constexpr double kSr = 48000.0;

struct Render {
    std::vector<float> l, r, root, upper;
};

Render render(SwarmDsp& d, const SwarmParams& p, int n) {
    Render o;
    for (int i = 0; i < n; ++i) {
        const auto f = d.tick(p);
        o.l.push_back(f.l), o.r.push_back(f.r), o.root.push_back(f.root), o.upper.push_back(f.upper);
    }
    return o;
}

SwarmDsp fresh() {
    SwarmDsp d;
    d.prepare(kSr);
    d.reset();
    return d;
}

void unison() {
    TEST("Spread 0, Detune 0: every oscillator on the root, level normalised by √Count");
    SwarmParams p;
    p.spread = 0.0f;
    p.detune = 0.0f;
    p.width = 0.0f;
    p.count = 8.0f;
    SwarmDsp d = fresh();
    const auto x = render(d, p, 24000);
    for (int k = 0; k < d.oscillators(); ++k) EXPECT_NEAR(d.pitchOf(k), 0.0, 0.001);  // 0.1 cent
    // All at C4, sines with seeded phases: the energy is at 261.6 Hz only.
    const double f = dsp::osc::kC4Hz;
    EXPECT(magnitudeAt(x.l, f, kSr) > 0.05);
    EXPECT(magnitudeAt(x.l, 1.5 * f, kSr) < 1e-3);
    // One oscillator alone is the root output.
    SwarmParams one = p;
    one.count = 1.0f;
    SwarmDsp e = fresh();
    const auto y = render(e, one, 4800);
    for (size_t i = 0; i < y.l.size(); ++i) EXPECT_NEAR(y.l[i], y.root[i], 1e-6);
    // Eight unit sines summed and divided by √8 stay within ±√8.
    for (float v : x.l) EXPECT(std::fabs(v) <= std::sqrt(8.0f) + 1e-3f);
}

void settledStack() {
    TEST("Spread 100 %, Minor 7, Range 2, Count 8: settled pitches are the stacked chord");
    SwarmParams p;
    p.spread = 1.0f;
    p.detune = 0.0f;
    p.drift = 0.0f;
    p.glide = 0.05f;
    SwarmDsp d = fresh();
    render(d, p, 48000);
    std::vector<int> got;
    for (int k = 0; k < d.oscillators(); ++k) got.push_back((int)std::lround(d.pitchOf(k)));
    EXPECT((got == std::vector<int>{0, 3, 7, 10, 15, 19, 22, 24}));
    for (int k = 0; k < d.oscillators(); ++k) EXPECT_NEAR(d.pitchOf(k), std::round(d.pitchOf(k)), 1e-3);
    // Stack Centred keeps the root oscillator on 0 and spreads ±1 octave.
    p.stack = 1;
    SwarmDsp e = fresh();
    render(e, p, 48000);
    EXPECT_NEAR(e.pitchOf(0), 0.0, 1e-4);
    float lo = 0.0f, hi = 0.0f;
    for (int k = 0; k < e.oscillators(); ++k) lo = std::min(lo, e.pitchOf(k)), hi = std::max(hi, e.pitchOf(k));
    EXPECT_NEAR(lo, -12.0, 1e-3);
    EXPECT_NEAR(hi, 12.0, 1e-3);
}

void quantizing() {
    TEST("intermediate spreads only produce chord notes; ties go down");
    int stack[SwarmDsp::kMaxStack];
    const int n = SwarmDsp::buildStack(patch::kSwarmMinor7, 2, 0, stack);
    EXPECT(n == 9);
    EXPECT(SwarmDsp::nearest(stack, n, 5.0f) == 3);  // 3 and 7 are equally far: down
    EXPECT(SwarmDsp::nearest(stack, n, 5.1f) == 7);
    for (float spread = 0.0f; spread <= 1.0f; spread += 0.05f) {
        SwarmParams p;
        p.spread = spread;
        p.glide = 0.0f;
        p.detune = 0.0f;
        SwarmDsp d = fresh();
        render(d, p, 64);
        for (int k = 0; k < d.oscillators(); ++k) {
            const int t = (int)std::lround(d.targetOf(k));
            EXPECT(std::find(stack, stack + n, t) != stack + n);
            EXPECT_NEAR(d.targetOf(k), (float)t, 1e-6);
        }
    }
    // Quartal and quintal stack evenly; scales are sets of pitch classes.
    EXPECT(SwarmDsp::buildStack(13, 2, 0, stack) == 5 && stack[4] == 20);
    EXPECT(SwarmDsp::buildStack(16 + 1, 1, 0, stack) == 8 && stack[7] == 12);  // Major scale
}

void glide() {
    TEST("glide: each oscillator reaches 99 % within 4.6 × its time; seeded and repeatable");
    SwarmParams p;
    p.spread = 0.0f;
    p.detune = 0.0f;
    p.glide = 0.2f;
    SwarmDsp d = fresh();
    render(d, p, 4800);
    p.spread = 1.0f;  // open up: every oscillator moves
    std::vector<int> reached(16, -1);
    for (int i = 0; i < 96000; ++i) {
        d.tick(p);
        for (int k = 1; k < d.oscillators(); ++k)
            if (reached[(size_t)k] < 0 && std::fabs(d.gliding(k) - d.targetOf(k)) <= 0.01f * std::fabs(d.targetOf(k)))
                reached[(size_t)k] = i;
    }
    bool differ = false;
    for (int k = 1; k < d.oscillators(); ++k) {
        const double limit = 4.61 * 0.2 * d.glideTimeFactor(k) * kSr + 2 * SwarmDsp::kControl;  // e^−4.6 = 1.005 %
        if (!(reached[(size_t)k] >= 0 && reached[(size_t)k] <= limit))
            std::printf("  osc %d: reached %d, limit %.0f, target %g, glide %g\n", k, reached[(size_t)k], limit, d.targetOf(k), d.gliding(k));
        EXPECT(reached[(size_t)k] >= 0 && reached[(size_t)k] <= limit);
        differ = differ || d.glideTimeFactor(k) != d.glideTimeFactor(1);
    }
    EXPECT(differ);
}

void patterns() {
    TEST("detune patterns: Fan monotonic, Alternate alternates, Outer zero in the middle");
    const int n = 10;
    for (int k = 2; k < n; ++k) EXPECT(SwarmDsp::patternValue(0, k, n, 1) > SwarmDsp::patternValue(0, k - 1, n, 1));
    for (int k = 2; k < n; ++k)
        EXPECT(SwarmDsp::patternValue(1, k, n, 1) * SwarmDsp::patternValue(1, k - 1, n, 1) < 0.0f);
    EXPECT_NEAR(SwarmDsp::patternValue(3, 1 + (n - 2) / 2, n, 1), 0.0, 1e-6);
    EXPECT_NEAR(std::fabs(SwarmDsp::patternValue(3, 1, n, 1)), 1.0, 1e-6);
    EXPECT_NEAR(std::fabs(SwarmDsp::patternValue(3, n - 1, n, 1)), 1.0, 1e-6);
    for (int p = 0; p < 4; ++p) EXPECT(SwarmDsp::patternValue(p, 0, n, 1) == 0.0f);  // the root never
    EXPECT(SwarmDsp::patternValue(2, 3, n, 1) != SwarmDsp::patternValue(2, 3, n, 2));
}

void stereo() {
    TEST("Width 0: L = R; the root never pans");
    SwarmParams p;
    p.width = 0.0f;
    SwarmDsp d = fresh();
    const auto x = render(d, p, 9600);
    for (size_t i = 0; i < x.l.size(); ++i) EXPECT(x.l[i] == x.r[i]);
    p.width = 1.0f;
    SwarmDsp e = fresh();
    const auto y = render(e, p, 9600);
    EXPECT(e.panOf(0) == 0.0f);
    bool wide = false;
    for (size_t i = 0; i < y.l.size(); ++i) wide = wide || std::fabs(y.l[i] - y.r[i]) > 0.01f;
    EXPECT(wide);
}

void crossFm() {
    TEST("Cross FM: 0 % is the plain sum, more adds sidebands");
    SwarmParams p;
    p.spread = 1.0f;
    p.set = 2;  // Fifths
    p.count = 3.0f;  // 0, 7, 12
    p.range = 1;
    p.detune = 0.0f;
    p.drift = 0.0f;
    p.glide = 0.0f;
    p.width = 0.0f;
    SwarmDsp a = fresh();
    const auto x = render(a, p, 32768);
    const double f0 = dsp::osc::kC4Hz, f1 = f0 * std::pow(2.0, 7.0 / 12.0);
    EXPECT(magnitudeAt(x.l, f1 - f0, kSr) < 1e-4);
    p.crossFm = 0.5f;
    SwarmDsp b = fresh();
    const auto y = render(b, p, 32768);
    EXPECT(magnitudeAt(y.l, f1 + f0, kSr) > 0.01);
    for (float v : y.l) EXPECT(std::isfinite(v) && std::fabs(v) < 4.0f);
}

void aliasing() {
    TEST("aliasing: a saw at C6, band below 10 kHz: Normal below −55 dB, High below −70 dB");
    for (bool high : {false, true}) {
        SwarmParams p;
        p.count = 1.0f;
        p.warp = 1.0f;
        p.pitch = 2.0f;  // C6
        p.high = high;
        SwarmDsp d = fresh();
        const auto x = render(d, p, 32768);
        const double f0 = dsp::osc::kC4Hz * 4.0;
        const double fund = magnitudeAt(x.l, f0, kSr);
        double worst = 0.0;
        for (int h = 20; h < 200; ++h) {
            double f = std::fmod(h * f0, kSr * (high ? 2.0 : 1.0));
            if (high && f > kSr) f = 2.0 * kSr - f;  // folds at the 2× rate, then decimated
            if (f > kSr / 2) f = kSr - f;
            const double nearest = std::round(f / f0) * f0;
            if (h * f0 < kSr / 2 || std::fabs(f - nearest) < 60.0 || f < 40.0 || f > 10000.0) continue;
            worst = std::max(worst, magnitudeAt(x.l, f, kSr));
        }
        std::printf("  saw C6 %s: strongest alias %.1f dB\n", high ? "High" : "Normal", 20.0 * std::log10(worst / fund + 1e-12));
        EXPECT(worst < fund * (high ? 0.000316 : 0.00178));  // −70 / −55 dB
    }
    // A full cloud stays finite and bounded.
    SwarmParams p;
    p.count = 16.0f;
    p.spread = 1.0f;
    p.warp = 1.0f;
    p.range = 4;
    p.pitch = 2.0f;
    p.crossFm = 1.0f;
    SwarmDsp d = fresh();
    const auto x = render(d, p, 48000);
    EXPECT(bleep::test::allFinite(x.l));
    for (float v : x.l) EXPECT(std::fabs(v) < 8.0f);
}

void repeatable() {
    TEST("same Seed and Reshuffle triggers: identical renders; Reshuffle changes the pattern");
    SwarmParams p;
    p.pattern = 2;
    p.detune = 20.0f;
    p.drift = 1.0f;
    p.spread = 0.6f;
    auto run = [&](uint32_t seed) {
        SwarmDsp d = fresh();
        SwarmParams q = p;
        q.seed = seed;
        std::vector<float> out;
        for (int i = 0; i < 24000; ++i) out.push_back(d.tick(q, 0.0f, i == 12000 ? 1.0f : 0.0f).l);
        return out;
    };
    EXPECT(run(5) == run(5));
    EXPECT(run(5) != run(6));
    SwarmDsp d = fresh();
    d.tick(p);
    const float before = d.detuneUnit(3);
    d.reshuffle();
    for (int i = 0; i < SwarmDsp::kControl; ++i) d.tick(p);
    EXPECT(d.detuneUnit(3) != before);
}

void spreadOutput() {
    TEST("the Spread output follows the cloud's opening after glide");
    SwarmParams p;
    p.spread = 0.0f;
    p.glide = 0.0f;
    SwarmDsp d = fresh();
    EXPECT_NEAR(d.tick(p).spread, 0.0, 1e-6);
    p.spread = 1.0f;
    float s = 0.0f;
    for (int i = 0; i < 100; ++i) s = d.tick(p).spread;
    EXPECT_NEAR(s, 1.0, 1e-3);
}

}  // namespace

int main() {
    unison();
    settledStack();
    quantizing();
    glide();
    patterns();
    stereo();
    crossFm();
    aliasing();
    repeatable();
    spreadOutput();
    return bleep::test::finish("swarm");
}
