// SPDX-License-Identifier: GPL-3.0-or-later
#include "DelayNetworkDsp.h"
#include "dsp/tests/TestUtil.h"

#include <memory>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;

struct Run {
    std::unique_ptr<DelayNetworkDsp> dsp = std::make_unique<DelayNetworkDsp>();
    DelayNetworkParams p;
    DelayNetworkFrame f;
    Run() {
        dsp->prepare(kSr);
        p.character = 0.0f;
        p.feedback = 0.0f;
        p.mix = 1.0f;
        p.width = 0.0f;
        p.routing = DnetParallel;
    }
    template <class Src, class Sink>
    void render(int n, Src&& src, Sink&& sink) {
        for (int i = 0; i < n; ++i) {
            const float x = src(i);
            dsp->tick(p, x, x, 0.0f, f);
            sink(i, f);
        }
    }
};

static uint64_t g_rng = 1;
static float noise() {
    g_rng = g_rng * 6364136223846793005ull + 1442695040888963407ull;
    return (float)((double)(g_rng >> 11) / 9007199254740992.0 - 0.5);
}

static void tapPositions() {
    TEST("tap positions: even, scattered, impulses on time");
    std::array<double, dnet::kLines> pos{};
    std::array<float, dnet::kLines> level{};
    EXPECT(dnet::layout(4.0, 0.0, pos, level) == 4);
    for (int i = 0; i < 4; ++i) EXPECT_NEAR(pos[(size_t)i], 0.25 * (i + 1), 1e-12);
    for (double sc : {1.0, -1.0}) {
        dnet::layout(4.0, sc, pos, level);
        for (int i = 0; i < 4; ++i) EXPECT_NEAR(pos[(size_t)i], std::pow(0.25 * (i + 1), std::exp2(2.0 * sc)), 1e-12);
    }
    Run r;
    r.p.timeSeconds = 1.0;
    std::array<int, 4> at{-1, -1, -1, -1};
    r.render(50000, [](int i) { return i == 0 ? 1.0f : 0.0f; }, [&](int i, const DelayNetworkFrame& f) {
        for (int k = 0; k < 4; ++k)
            if (at[(size_t)k] < 0 && f.tap[(size_t)k] > 0.5f) at[(size_t)k] = i;
    });
    for (int k = 0; k < 4; ++k) EXPECT(std::abs(at[(size_t)k] - 12000 * (k + 1)) <= 1);
}

static void fractionalTaps() {
    TEST("fractional taps: sweeping 3 → 4 is continuous");
    Run r;
    r.p.timeSeconds = 0.3;
    r.p.feedback = 0.5f;
    r.p.routing = DnetRing;
    double maxStep = 0.0;
    float prev = 0.0f;
    r.render(96000, [](int i) { return 0.3f * (float)std::sin(i * 0.02); }, [&](int i, const DelayNetworkFrame& f) {
        if (i > 48000) maxStep = std::max(maxStep, (double)std::fabs(f.wetL - prev));
        prev = f.wetL;
    });
    for (int i = 0; i < 96000; ++i) {
        r.p.taps = 3.0f + (float)i / 96000.0f;
        const float x = 0.3f * (float)std::sin((96000 + i) * 0.02);
        r.dsp->tick(r.p, x, x, 0.0f, r.f);
        maxStep = std::max(maxStep, (double)std::fabs(r.f.wetL - prev));
        prev = r.f.wetL;
    }
    EXPECT(maxStep < 0.15);
}

static void syncSpacing() {
    TEST("sync: 4 taps over 1/2 at 120 BPM are 250 ms apart");
    Run r;
    r.p.syncBeats = 2.0;
    r.p.bpm = 120.0;
    r.p.timeKnob = 0.5f;  // ×1
    EXPECT_NEAR(r.dsp->timeSamples(r.p), 48000.0, 0.5);
    r.render(100, [](int) { return 0.0f; }, [](int, const DelayNetworkFrame&) {});
    for (int i = 0; i < 4; ++i) EXPECT_NEAR(r.dsp->tapSeconds(i), 0.25 * (i + 1), 1e-4);
    r.p.timeKnob = 0.0f;  // ×¼
    EXPECT_NEAR(r.dsp->timeSamples(r.p), 12000.0, 0.5);
}

static void reversedTaps() {
    TEST("reverse 50 % of 4 taps reverses exactly 2, the same per seed");
    std::array<bool, 8> first{};
    for (int run = 0; run < 2; ++run) {
        Run r;
        r.p.reverse = 0.5f;
        r.p.seed = 42;
        r.render(64, [](int) { return 0.0f; }, [](int, const DelayNetworkFrame&) {});
        int count = 0;
        for (int i = 0; i < 8; ++i) {
            count += r.dsp->tapReversed(i) ? 1 : 0;
            if (run == 0) first[(size_t)i] = r.dsp->tapReversed(i);
            else EXPECT(first[(size_t)i] == r.dsp->tapReversed(i));
            if (i >= 4) EXPECT(!r.dsp->tapReversed(i));
        }
        EXPECT(count == 2);
    }
    // Raising Reverse only adds taps.
    const auto o = dnet::reverseOrder(42);
    std::array<bool, 8> seen{};
    for (int v : o) seen[(size_t)v] = true;
    for (bool b : seen) EXPECT(b);
}

static void chainSums() {
    TEST("chain: an impulse reappears at the sums of tap times");
    Run r;
    r.p.timeSeconds = 0.4;
    r.p.taps = 2.0f;  // taps at 200 and 400 ms
    r.p.routing = DnetChain;
    r.p.feedback = 1.0f;
    std::vector<int> hits;
    r.render(48000, [](int i) { return i == 0 ? 1.0f : 0.0f; }, [&](int i, const DelayNetworkFrame& f) {
        if (f.tap[1] > 0.5f) hits.push_back(i);
    });
    // Tap 2 hears the input at 400 ms and tap 1's repeat at 200 + 400 = 600 ms.
    EXPECT(hits.size() == 2);
    if (hits.size() == 2) {
        EXPECT(std::abs(hits[0] - 19200) <= 1);
        EXPECT(std::abs(hits[1] - 28800) <= 1);
    }
}

static double windowRms(const std::vector<float>& x, size_t from, size_t n) {
    double s = 0.0;
    for (size_t i = from; i < from + n; ++i) s += (double)x[i] * x[i];
    return std::sqrt(s / (double)n);
}

static void stability() {
    TEST("feedback 100 % keeps the energy; 110 % stays bounded");
    for (int routing : {DnetParallel, DnetRing, DnetMesh}) {
        Run r;
        r.p.timeSeconds = 0.25;
        r.p.taps = 8.0f;
        r.p.routing = routing;
        r.p.feedback = 1.0f;
        r.p.width = 0.0f;
        std::vector<float> e;
        r.render(48000 * 30, [](int i) { return i < 12000 ? 0.2f * noise() : 0.0f; }, [&](int, const DelayNetworkFrame&) {
            double s = 0.0;  // the network's energy: every line's output
            for (int k = 0; k < 8; ++k) s += (double)r.dsp->tapOut(k) * r.dsp->tapOut(k);
            e.push_back((float)std::sqrt(s));
        });
        const double a = windowRms(e, 48000 * 2, 96000), b = windowRms(e, 48000 * 27, 96000);
        EXPECT_NEAR(20.0 * std::log10(b / a), 0.0, 0.5);
    }
    for (float ch : {0.0f, 0.2f, 0.4f, 0.6f, 0.8f, 1.0f, 0.5f}) {
        for (int routing : {DnetParallel, DnetChain, DnetRing, DnetMesh}) {
            Run r;
            r.p.timeSeconds = 0.05;
            r.p.taps = 8.0f;
            r.p.routing = routing;
            r.p.feedback = 1.1f;
            r.p.character = ch;
            float peak = 0.0f;
            bool finite = true;
            r.render(48000 * 3, [](int i) { return i < 4800 ? noise() : 0.0f; }, [&](int, const DelayNetworkFrame& f) {
                peak = std::max(peak, std::max(std::fabs(f.wetL), std::fabs(f.wetR)));
                finite = finite && std::isfinite(f.wetL) && std::isfinite(f.wetR);
            });
            EXPECT(finite);
            EXPECT(peak < 10.0f);
        }
    }
}

static void freezeHolds() {
    TEST("freeze holds the content; release is click-free");
    Run r;
    r.p.timeSeconds = 0.2;
    r.p.taps = 4.0f;
    r.p.routing = DnetRing;
    r.p.feedback = 0.6f;
    r.p.character = 0.5f;
    const auto sine = [](int i) { return 0.4f * (float)std::sin(i * 0.04); };
    r.render(24000, [&](int i) { return i < 6000 ? sine(i) : 0.0f; }, [](int, const DelayNetworkFrame&) {});
    r.p.freeze = true;
    std::vector<float> out;
    // The input fades out over 20 ms; noise after that must not get in.
    r.render(48000 * 10, [](int i) { return i < 2400 ? 0.0f : noise(); }, [&](int, const DelayNetworkFrame& f) { out.push_back(f.tap[0]); });
    const double a = windowRms(out, 48000, 48000), b = windowRms(out, 48000 * 9, 48000);
    EXPECT(a > 0.01);
    EXPECT_NEAR(20.0 * std::log10(b / a), 0.0, 0.5);
    r.p.freeze = false;
    double maxStep = 0.0;
    float prev = out.back();
    r.render(9600, [](int) { return 0.0f; }, [&](int, const DelayNetworkFrame& f) {
        maxStep = std::max(maxStep, (double)std::fabs(f.tap[0] - prev));
        prev = f.tap[0];
    });
    EXPECT(maxStep < 0.05);
}

static void timeModulation() {
    TEST("audio-rate Time modulation: no discontinuity in either mode");
    for (bool tape : {false, true}) {
        Run r;
        r.p.taps = 3.0f;
        r.p.tape = tape;
        r.p.feedback = 0.3f;
        double maxStep = 0.0;
        float prev = 0.0f;
        for (int i = 0; i < 96000; ++i) {
            r.p.timeSeconds = 0.3 + 0.1 * std::sin(i * 0.05);
            const float x = 0.4f * (float)std::sin(i * 0.01);
            r.dsp->tick(r.p, x, x, 0.0f, r.f);
            if (i > 1000) maxStep = std::max(maxStep, (double)std::fabs(r.f.wetL - prev));
            prev = r.f.wetL;
        }
        EXPECT(maxStep < 0.12);
    }
}

static void determinism() {
    TEST("clear + same seed: identical renders");
    std::vector<float> a, b;
    for (int run = 0; run < 2; ++run) {
        Run r;
        r.p.character = 1.0f;  // Wear: wow and noise
        r.p.feedback = 0.8f;
        r.p.reverse = 0.5f;
        r.p.jitter = 0.7f;
        r.p.routing = DnetMesh;
        r.p.taps = 6.5f;
        r.render(20000 + 3333 * run, [&](int i) { return 0.2f * (float)std::sin(i * 0.003 * (run + 1)); },
                 [](int, const DelayNetworkFrame&) {});
        r.dsp->clear();
        r.dsp->restart(r.p.seed);
        auto& out = run == 0 ? a : b;
        r.render(48000, [](int i) { return 0.3f * (float)std::sin(i * 0.02); },
                 [&](int, const DelayNetworkFrame& f) { out.push_back(f.wetL); });
    }
    bool same = true;
    for (size_t i = 480; i < a.size(); ++i) same = same && a[i] == b[i];
    EXPECT(same);
}

int main() {
    tapPositions();
    fractionalTaps();
    syncSpacing();
    reversedTaps();
    chainSums();
    stability();
    freezeHolds();
    timeModulation();
    determinism();
    return bleep::test::finish("delay-network");
}
