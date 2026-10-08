// SPDX-License-Identifier: MIT
// Six Slopes (specs/modules/six-slopes.md §8): harmonic ratios and snapping,
// shared triggers, envelopes without jumps, Sound mode pitch and muting,
// transport lock, Tilt and Sum.
#include "SixSlopesDsp.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <vector>

using namespace bleep;
using patch::SixFrame;
using patch::SixParams;
using patch::SixSlopesDsp;
using patch::SixTime;

static constexpr double kSr = 48000.0;
static float rateFor(double hz) { return (float)(std::log(hz / 0.02) / std::log(50000.0)); }

struct Run {
    std::vector<float> out[6], sum, end1, active;
};
template <class Trig>
static Run run(const SixParams& p, int64_t n, Trig trig) {
    SixSlopesDsp d;
    d.prepare(kSr);
    Run r;
    SixTime t;
    SixFrame f;
    float tr[6];
    for (int64_t i = 0; i < n; ++i) {
        for (int k = 0; k < 6; ++k) tr[k] = trig(i, k);
        d.tick(p, tr, t, f);
        for (int k = 0; k < 6; ++k) r.out[k].push_back(f.out[k]);
        r.sum.push_back(f.sum);
        r.end1.push_back(f.end1);
        r.active.push_back(f.active);
    }
    return r;
}
static Run run(const SixParams& p, int64_t n) {
    return run(p, n, [](int64_t, int) { return 0.0f; });
}
static int crossings(const std::vector<float>& x, float level) {
    int c = 0;
    for (size_t i = 1; i < x.size(); ++i) c += x[i - 1] < level && x[i] >= level ? 1 : 0;
    return c;
}

static void harmonics() {
    TEST("six slopes: Harmonics 0 identical, ±1 overtones and undertones");
    SixParams p;
    p.mode = patch::SixLoop;
    p.rate = rateFor(1.0);
    p.skew = 0.5f;
    const Run a = run(p, 48000);
    for (int k = 1; k < 6; ++k) EXPECT(a.out[k] == a.out[0]);
    p.harmonics = 1.0f;
    const Run b = run(p, 48000 + 20);
    int ends = 0;
    for (float v : b.end1) ends += v > 0.5f ? 1 : 0;
    EXPECT(ends == 1);
    for (int k = 0; k < 6; ++k) EXPECT(crossings(b.out[k], 0.5f) == k + 1);
    p.harmonics = -1.0f;
    const Run c = run(p, 48000 * 60 + 20);
    for (int k = 0; k < 6; ++k) EXPECT(crossings(c.out[k], 0.5f) == 60 / (k + 1));
}

static void snap() {
    TEST("six slopes: Snap Integer and Just");
    const double expect[6] = {1, 1, 2, 2, 3, 3};
    for (int k = 0; k < 6; ++k) EXPECT_NEAR(SixSlopesDsp::ratio(k, 0.4f, patch::SixSnapInteger), expect[k], 1e-9);
    for (int k = 0; k < 6; ++k) EXPECT_NEAR(SixSlopesDsp::ratio(k, -0.4f, patch::SixSnapInteger), 1.0 / expect[k], 1e-9);
    const double just[8] = {1.0, 9.0 / 8.0, 5.0 / 4.0, 4.0 / 3.0, 3.0 / 2.0, 5.0 / 3.0, 15.0 / 8.0, 2.0};
    for (int h = -100; h <= 100; h += 7)
        for (int k = 0; k < 6; ++k) {
            const double r = SixSlopesDsp::ratio(k, h / 100.0f, patch::SixSnapJust);
            const double l = std::log2(r), f = std::exp2(l - std::floor(l));
            bool ok = false;
            for (double j : just) ok = ok || std::fabs(f - j) < 1e-9 || std::fabs(f * 2.0 - j) < 1e-9;
            EXPECT(ok);
        }
    // Overtones 1…6 at +1 are a just chord already: 1, 2, 3, 4, 5, 6.
    for (int k = 0; k < 6; ++k) EXPECT_NEAR(SixSlopesDsp::ratio(k, 1.0f, patch::SixSnapJust), k + 1.0, 1e-9);
}

static void sharedTrigger() {
    TEST("six slopes: one trigger on all six (as normalled) fires six envelopes");
    SixParams p;
    p.rate = rateFor(4.0);
    p.harmonics = 1.0f;
    // Trig 1 patched and normalled to all: the same signal on every channel.
    const Run r = run(p, 48000, [](int64_t i, int) { return i == 100 ? 1.0f : 0.0f; });
    for (int k = 0; k < 6; ++k) EXPECT(*std::max_element(r.out[k].begin(), r.out[k].end()) > 0.99f);
    // Trig 1 into 1–3, Trig 4 into 4–6 (later): the halves start apart.
    const Run s = run(p, 48000, [](int64_t i, int k) { return (k < 3 ? i == 100 : i == 5000) ? 1.0f : 0.0f; });
    EXPECT(s.out[0][2000] > 0.0f && s.out[3][2000] == 0.0f && s.out[3][5500] > 0.0f);
}

static void envelopes() {
    TEST("six slopes: AR retrigger mid-fall and ASR early release don't jump");
    SixParams p;
    p.rate = rateFor(2.0);
    const Run r = run(p, 48000, [](int64_t i, int) { return i == 10 || i == 15000 ? 1.0f : 0.0f; });
    float step = 0.0f;
    for (size_t i = 12; i < r.out[0].size(); ++i) step = std::max(step, std::fabs(r.out[0][i] - r.out[0][i - 1]));
    EXPECT(step < 0.001f);  // rise: 1 / 6000 per sample
    EXPECT(r.out[0][14999] > 0.2f && r.out[0][14999] < 0.9f);
    p.mode = patch::SixASR;
    const Run a = run(p, 48000, [](int64_t i, int) { return i >= 10 && i < 3000 ? 1.0f : 0.0f; });
    step = 0.0f;
    for (size_t i = 12; i < a.out[0].size(); ++i) step = std::max(step, std::fabs(a.out[0][i] - a.out[0][i - 1]));
    EXPECT(step < 0.001f);
    EXPECT(a.out[0][3005] < a.out[0][2999]);
    EXPECT(a.active[100] > 0.5f && a.active[47000] < 0.5f);
}

static void sound() {
    TEST("six slopes: Sound mode pitch, muting above sr/4");
    SixParams p;
    p.mode = patch::SixSound;
    p.rate = 0.5f;  // C4
    p.skew = 0.5f;
    p.curve = 0.0f;
    const Run r = run(p, 48000);
    EXPECT_NEAR(test::zeroCrossingHz(r.out[0], kSr), 261.63, 0.05);
    // Overtones from C7 up: channel 5 (×6, 12.6 kHz) is above sr/4 and silent.
    p.rate = 1.0f;  // 4 kHz
    p.harmonics = 1.0f;
    const Run m = run(p, 4800);
    EXPECT(*std::max_element(m.out[0].begin(), m.out[0].end()) > 0.9f);
    EXPECT(*std::max_element(m.out[5].begin(), m.out[5].end()) == 0.0f);
    for (float v : m.sum) EXPECT(v >= -1.0f && v <= 1.0f);
}

static void transport() {
    TEST("six slopes: Sync + Loop follows the song position and repeats after a jump");
    SixParams p;
    p.mode = patch::SixLoop;
    p.sync = 11;  // 1/4
    EXPECT(std::string(SixSlopesDsp::syncName(11)) == "1/4");
    p.harmonics = 1.0f;
    p.skew = 0.995f;  // nearly a rising saw: value ≈ phase
    SixSlopesDsp d;
    d.prepare(kSr);
    SixTime t;
    t.running = true;
    SixFrame f;
    const float none[6] = {};
    std::vector<float> first[6];
    for (int i = 0; i < 48000; ++i) {
        t.ppq = i * 2.0 / kSr;
        t.started = i == 0;
        d.tick(p, none, t, f);
        for (int k = 0; k < 6; ++k) first[k].push_back(f.out[k]);
        if (i == 31000)
            for (int k = 0; k < 6; ++k) EXPECT_NEAR(d.phase(k), dsp::wrap01(t.ppq * (k + 1)), 1e-9);
    }
    for (int i = 20000; i < 48000; ++i) {
        t.ppq = i * 2.0 / kSr;
        t.started = false;
        d.tick(p, none, t, f);
        for (int k = 0; k < 6; ++k) EXPECT(f.out[k] == first[k][(size_t)i]);
    }
}

static void tiltAndSum() {
    TEST("six slopes: Tilt ±1 and Sum in range");
    EXPECT_NEAR(SixSlopesDsp::tilt(0, 1.0f), 0.0, 1e-6);
    EXPECT_NEAR(SixSlopesDsp::tilt(5, 1.0f), 1.0, 1e-6);
    EXPECT_NEAR(SixSlopesDsp::tilt(0, -1.0f), 1.0, 1e-6);
    EXPECT_NEAR(SixSlopesDsp::tilt(5, -1.0f), 0.0, 1e-6);
    EXPECT_NEAR(SixSlopesDsp::tilt(2, 0.0f), 1.0, 1e-6);
    SixParams p;
    p.mode = patch::SixLoop;
    p.rate = rateFor(3.0);
    p.harmonics = 0.37f;
    p.tilt = 1.0f;
    for (bool bip : {false, true}) {
        p.bipolar = bip;
        const Run r = run(p, 48000);
        for (float v : r.out[0]) EXPECT(v == 0.0f || v == -0.0f);
        for (float v : r.sum) EXPECT(v >= (bip ? -1.0f : 0.0f) && v <= 1.0f);
    }
}

int main() {
    harmonics();
    snap();
    sharedTrigger();
    envelopes();
    sound();
    transport();
    tiltAndSum();
    return bleep::test::finish("six slopes");
}
