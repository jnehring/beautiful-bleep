// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Chaos.h: the integrate-and-fire neuron (neuron.md 4.1–4.3) and the chaotic
// attractors: bounded, deterministic, rate-scalable.
#include "dsp/Chaos.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <vector>

using namespace bleep;

static constexpr double kSr = 48000.0;

static void compareMode() {
    TEST("chaos: neuron compare with hysteresis");
    dsp::LifNeuron n;
    n.prepare(kSr);
    n.reset();
    dsp::NeuronParams p;
    p.leak = 0.0f;  // the membrane follows the sum
    p.threshold = 0.5f;
    p.hysteresis = 0.4f;  // h = 0.2 → high above 0.6, low below 0.4
    float up = -1.0f, down = -1.0f;
    int spikes = 0;
    for (int i = 0; i <= 1000; ++i) {
        const float s = i / 1000.0f;
        const dsp::NeuronFrame f = n.tick(s, p);
        EXPECT(f.membrane == s);
        spikes += f.spike;
        if (f.gate && up < 0.0f) up = s;
    }
    for (int i = 1000; i >= 0; --i) {
        const float s = i / 1000.0f;
        if (!n.tick(s, p).gate && down < 0.0f) down = s;
    }
    EXPECT_NEAR(up, 0.6, 0.0015);
    EXPECT_NEAR(down, 0.4, 0.0015);
    EXPECT(spikes == 1);
}

static void leak() {
    TEST("chaos: neuron membrane leak");
    dsp::LifNeuron n;
    n.prepare(kSr);
    n.reset();
    dsp::NeuronParams p;
    p.leak = 0.1f;
    p.threshold = 10.0f;
    float m = 0.0f;
    for (int i = 0; i < 4800; ++i) m = n.tick(1.0f, p).membrane;  // one time constant
    EXPECT_NEAR(m, 1.0 - std::exp(-1.0), 1e-4);
}

static void spikeRate() {
    TEST("chaos: integrate-and-fire rate");
    auto rate = [](float sum, float threshold, float leak, float pulse, int* longestGate = nullptr) {
        dsp::LifNeuron n;
        n.prepare(kSr);
        n.reset();
        dsp::NeuronParams p;
        p.spike = true;
        p.leak = leak;
        p.threshold = threshold;
        p.pulse = pulse;
        std::vector<int> spikes;
        int run = 0, longest = 0;
        for (int i = 0; i < 10 * 48000; ++i) {
            const dsp::NeuronFrame f = n.tick(sum, p);
            if (f.spike) spikes.push_back(i);
            run = f.gate ? run + 1 : 0;
            longest = std::max(longest, run);
            if (f.gate) EXPECT(f.membrane == 0.0f);  // held at 0 while refractory
        }
        if (longestGate) *longestGate = longest;
        if (spikes.size() < 2) return 0.0;
        return kSr * (double)(spikes.size() - 1) / (double)(spikes.back() - spikes.front());
    };
    // 1 / (Pulse − Leak · ln(1 − θ/s)).
    int gate = 0;
    const double r1 = rate(1.0f, 0.5f, 0.01f, 0.005f, &gate);
    const double e1 = 1.0 / (0.005 - 0.01 * std::log(1.0 - 0.5));
    EXPECT(std::fabs(r1 / e1 - 1.0) < 0.003);
    EXPECT(gate == 240);  // the gate lasts exactly Pulse
    const double r2 = rate(0.8f, 0.7f, 0.05f, 0.001f);
    const double e2 = 1.0 / (0.001 - 0.05 * std::log(1.0 - 0.7 / 0.8));
    EXPECT(std::fabs(r2 / e2 - 1.0) < 0.003);
    EXPECT(rate(0.5f, 0.5f, 0.01f, 0.005f) == 0.0);  // s ≤ θ: never fires
    // θ ≤ 0: fires again right after each pulse (one sample low in between).
    EXPECT_NEAR(rate(0.0f, -0.1f, 0.01f, 0.01f), 48000.0 / 481.0, 1e-6);
    // Hysteresis raises the firing level to threshold + h/2.
    dsp::LifNeuron n;
    n.prepare(kSr);
    n.reset();
    dsp::NeuronParams p;
    p.spike = true;
    p.leak = 0.0f;
    p.threshold = 0.5f;
    p.hysteresis = 0.4f;
    EXPECT(!n.tick(0.59f, p).spike);
    EXPECT(n.tick(0.61f, p).spike);
}

static void outShape() {
    TEST("chaos: neuron Out");
    EXPECT(dsp::neuronOut(0.2f, 0.5f, 10.0f) == 0.0f);
    EXPECT_NEAR(dsp::neuronOut(0.55f, 0.5f, 10.0f), 0.5, 1e-6);
    EXPECT(dsp::neuronOut(0.9f, 0.5f, 10.0f) == 1.0f);
    float last = 0.0f, maxStep = 0.0f;
    for (int i = 0; i <= 2000; ++i) {
        const float v = dsp::neuronOut(0.5f + i / 1000.0f, 0.5f, 1.0f);
        EXPECT(v >= last && v <= 1.0f);
        maxStep = std::max(maxStep, v - last);
        last = v;
    }
    EXPECT(maxStep <= 0.001f + 1e-6f);
}

static void attractors() {
    for (auto type : {dsp::Attractor::Lorenz, dsp::Attractor::Thomas}) {
        TEST(type == dsp::Attractor::Lorenz ? "chaos: Lorenz bounded, deterministic, rate-scaled"
                                            : "chaos: Thomas bounded, deterministic, rate-scaled");
        auto make = [&](uint64_t seed) {
            dsp::Attractor a;
            a.prepare(kSr);
            a.setType(type);
            a.reset(seed);
            return a;
        };
        // Bounded and finite at slow, LFO and audio rates; rarely at the clamp.
        for (double hz : {0.001, 0.5, 20.0, 8000.0}) {
            dsp::Attractor a = make(3);
            int clamped = 0;
            double spanX = 0.0;
            float lo = 1.0f, hi = -1.0f;
            const int n = 200000;
            for (int i = 0; i < n; ++i) {
                const dsp::Attractor::Frame f = a.tick(hz);
                EXPECT(std::isfinite(f.x) && std::isfinite(f.y) && std::isfinite(f.z));
                EXPECT(std::fabs(f.x) <= 1.0f && std::fabs(f.y) <= 1.0f && std::fabs(f.z) <= 1.0f);
                clamped += std::fabs(f.x) == 1.0f || std::fabs(f.y) == 1.0f || std::fabs(f.z) == 1.0f;
                lo = std::min(lo, f.x);
                hi = std::max(hi, f.x);
            }
            spanX = hi - lo;
            EXPECT(clamped < n / 100);
            if (hz >= 20.0) EXPECT(spanX > 0.8);  // explores the attractor
            if (hz <= 0.001) EXPECT(spanX < 0.2);  // barely moves in 4 s
        }
        // Deterministic per seed; different seeds differ.
        dsp::Attractor a = make(7), b = make(7), c = make(8);
        float diffAB = 0.0f, diffAC = 0.0f;
        for (int i = 0; i < 480000; ++i) {
            const auto fa = a.tick(2.0), fb = b.tick(2.0), fc = c.tick(2.0);
            diffAB = std::max(diffAB, std::fabs(fa.x - fb.x));
            diffAC = std::max(diffAC, std::fabs(fa.x - fc.x));
        }
        EXPECT(diffAB == 0.0f);
        EXPECT(diffAC > 0.1f);
        // Rate scales time: 2 Hz for N samples ≈ 1 Hz for 2N samples.
        dsp::Attractor s1 = make(5), s2 = make(5);
        dsp::Attractor::Frame f1, f2;
        for (int i = 0; i < 4800; ++i) f2 = s2.tick(2.0);
        for (int i = 0; i < 9600; ++i) f1 = s1.tick(1.0);
        EXPECT_NEAR(f1.x, f2.x, 1e-3);
        EXPECT_NEAR(f1.z, f2.z, 1e-3);
        // Rate 0 holds still; reset() restarts the same path.
        dsp::Attractor h = make(5);
        const auto h0 = h.frame();
        for (int i = 0; i < 1000; ++i) h.tick(0.0);
        EXPECT(h.frame().x == h0.x);
        h.reset(5);
        EXPECT(h.tick(1.0).x == make(5).tick(1.0).x);
    }
}

int main() {
    compareMode();
    leak();
    spikeRate();
    outShape();
    attractors();
    return bleep::test::finish("chaos");
}
