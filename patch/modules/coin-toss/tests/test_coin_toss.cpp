// SPDX-License-Identifier: GPL-3.0-only
// Coin Toss: probabilities, memory runs, modes, link modes, determinism,
// Reset and Loop (doc/specs/modules/coin-toss.md §8).
#include "CoinTossDsp.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep;
using patch::CoinLink;
using patch::CoinMode;
using patch::CoinTossDsp;
using patch::CoinTossFrame;
using patch::CoinTossParams;

/// Feeds `tosses` pulses (2 samples high, 2 low) and records each toss's
/// result per channel (true = B), read while the input is high.
struct Run {
    std::vector<bool> b1, b2;
    std::vector<CoinTossFrame> frames;
};
static Run run(const CoinTossParams& p, int tosses, CoinTossDsp* use = nullptr, bool keepFrames = false) {
    CoinTossDsp local;
    CoinTossDsp& d = use ? *use : local;
    Run r;
    CoinTossFrame f;
    for (int t = 0; t < tosses; ++t)
        for (int s = 0; s < 4; ++s) {
            const float in = s < 2 ? 1.0f : 0.0f;
            d.tick(p, in, in, 0.0f, f);
            if (keepFrames) r.frames.push_back(f);
            if (s == 0) {
                r.b1.push_back(d.lastB(0));
                r.b2.push_back(d.lastB(1));
            }
        }
    return r;
}

static void extremes() {
    TEST("probability 0 % and 100 %");
    CoinTossParams p;
    p.probability = {0.0f, 1.0f};
    const Run r = run(p, 1000);
    for (size_t i = 0; i < r.b1.size(); ++i) {
        EXPECT(!r.b1[i]);
        EXPECT(r.b2[i]);
    }
}

static void share() {
    TEST("share of B at 30 %");
    CoinTossParams p;
    p.probability = {0.3f, 0.3f};
    const Run r = run(p, 100000);
    int n = 0;
    for (bool b : r.b1) n += b;
    EXPECT_NEAR(n / 100000.0, 0.3, 0.01);
}

static double meanRun(const std::vector<bool>& v) {
    int runs = 1;
    for (size_t i = 1; i < v.size(); ++i) runs += v[i] != v[i - 1];
    return (double)v.size() / runs;
}

static void memory() {
    TEST("memory");
    CoinTossParams p;
    p.memory = {1.0f, 0.5f};
    const Run r = run(p, 20000);
    for (bool b : r.b1) EXPECT(b == r.b1[0]);
    CoinTossParams q;
    const Run free = run(q, 20000);
    const double ratio = meanRun(r.b2) / meanRun(free.b2);
    EXPECT_NEAR(ratio, 2.0, 0.15);
}

static void modes() {
    TEST("trigger keeps the gate length");
    CoinTossParams p;
    const Run r = run(p, 200, nullptr, true);
    for (size_t i = 0; i < r.frames.size(); ++i) {
        const auto& f = r.frames[i];
        const bool high = (i % 4) < 2;
        EXPECT((f.a[0] + f.b[0] > 0.5f) == high);
        EXPECT(f.a[0] + f.b[0] < 1.5f);
    }
    TEST("latch is complementary");
    p.mode = {CoinMode::Latch, CoinMode::Latch};
    const Run l = run(p, 200, nullptr, true);
    for (const auto& f : l.frames) EXPECT(f.a[0] + f.b[0] == 1.0f);
    TEST("toggle at 0 % never flips");
    p.mode = {CoinMode::Toggle, CoinMode::Toggle};
    p.probability = {0.0f, 0.0f};
    const Run t = run(p, 200, nullptr, true);
    for (const auto& f : t.frames) EXPECT(f.a[0] == 1.0f && f.b[0] == 0.0f);
}

static void links() {
    TEST("shared: B1 implies B2");
    CoinTossParams p;
    p.link = CoinLink::Shared;
    p.probability = {0.2f, 0.7f};
    const Run r = run(p, 10000);
    int b1 = 0, b2 = 0;
    for (size_t i = 0; i < r.b1.size(); ++i) {
        if (r.b1[i]) EXPECT(r.b2[i]);
        b1 += r.b1[i];
        b2 += r.b2[i];
    }
    EXPECT_NEAR(b1 / 10000.0, 0.2, 0.02);
    EXPECT_NEAR(b2 / 10000.0, 0.7, 0.02);
    TEST("opposed: never B on both");
    p.link = CoinLink::Opposed;
    p.probability = {0.4f, 0.6f};
    const Run o = run(p, 10000);
    for (size_t i = 0; i < o.b1.size(); ++i) EXPECT(!(o.b1[i] && o.b2[i]));
}

static void determinism() {
    TEST("same seed, same tosses; reset repeats");
    CoinTossParams p;
    const Run a = run(p, 500), b = run(p, 500);
    EXPECT(a.b1 == b.b1 && a.b2 == b.b2);
    EXPECT(a.b1 != a.b2);  // the two channels are independent
    p.seed = 2;
    EXPECT(run(p, 500).b1 != a.b1);
    p.seed = 1;
    CoinTossDsp d;
    const Run first = run(p, 300, &d);
    d.restart();
    const Run again = run(p, 300, &d);
    EXPECT(first.b1 == again.b1);
    TEST("loop repeats with its period");
    p.loop = 6;
    p.memory = {0.3f, 0.0f};
    const Run l = run(p, 120);
    for (size_t i = 12; i < l.b1.size(); ++i) EXPECT(l.b1[i] == l.b1[i - 6]);
}

int main() {
    extremes();
    share();
    memory();
    modes();
    links();
    determinism();
    return bleep::test::finish("coin-toss");
}
