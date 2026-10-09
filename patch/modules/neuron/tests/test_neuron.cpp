// SPDX-License-Identifier: MIT
// Neuron: compare thresholds, spike rate, leak, normals and cross delay,
// logic, Out curve, the default rhythm, determinism (doc/specs/modules/neuron.md §8).
#include "NeuronDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <vector>

using namespace bleep;
using patch::NeuronCross;
using patch::NeuronDsp;
using patch::NeuronFrame;
using patch::NeuronInputs;
using patch::NeuronParams;

static constexpr double kSr = 48000.0;

/// The module's defaults (NeuronModule.cpp).
static NeuronParams defaults() {
    NeuronParams p;
    p.unit[0].weight = {0.6f, 1.0f, 0.5f};
    p.unit[1].weight = {0.9f, 1.0f, -1.0f};
    for (auto& u : p.unit) {
        u.cell.threshold = 0.5f;
        u.cell.hysteresis = 0.1f;
        u.cell.pulse = 0.03f;
        u.cell.spike = true;
        u.sharp = 4.0f;
    }
    p.unit[0].cell.leak = 0.25f;
    p.unit[1].cell.leak = 0.4f;
    return p;
}

/// Neuron A alone: In 1 patched with `x`, everything else 0, Cross off.
static NeuronParams single(bool spike, float threshold, float hyst, float leak) {
    NeuronParams p = defaults();
    p.cross = NeuronCross::Off;
    p.unit[0].weight = {1.0f, 0.0f, 0.0f};
    p.unit[0].cell = {leak, threshold, hyst, 0.01f, spike};
    return p;
}
static NeuronInputs patchedIn1(float x) {
    NeuronInputs in;
    in.patched[0] = {true, true, true};
    in.patched[1] = {true, true, true};
    in.in[0][0] = x;
    return in;
}

static void compare() {
    TEST("compare switches at threshold ± h/2");
    NeuronDsp d;
    d.prepare(kSr);
    const NeuronParams p = single(false, 0.2f, 0.4f, 0.0f);  // h = 0.2: on above 0.3, off below 0.1
    NeuronFrame f;
    auto at = [&](float x) { d.tick(p, patchedIn1(x), f); return f.gate[0] > 0.5f; };
    EXPECT(!at(0.0f));
    EXPECT(!at(0.299f));
    EXPECT(at(0.301f));
    EXPECT(at(0.2f));    // inside the band: stays high
    EXPECT(at(0.101f));
    EXPECT(!at(0.099f));
    EXPECT(!at(0.2f));   // inside the band: stays low
    TEST("hysteresis 0 is a plain comparator");
    const NeuronParams q = single(false, 0.2f, 0.0f, 0.0f);
    for (float x = -1.0f; x <= 1.0f; x += 0.013f) {
        d.tick(q, patchedIn1(x), f);
        EXPECT((f.gate[0] > 0.5f) == (x > 0.2f));
    }
    TEST("no chatter inside the band");
    const NeuronParams r = single(false, 0.0f, 0.4f, 0.0f);
    d.reset();
    int edges = 0;
    for (int i = 0; i < 10000; ++i) {
        d.tick(r, patchedIn1(0.3f + 0.08f * std::sin(i * 0.37f)), f);  // noise inside ±0.1 around 0.3 ≥ 0.1
        edges += f.spike[0] > 0.5f;
    }
    EXPECT(edges == 1);
}

static void spikeRate() {
    TEST("spike rate follows the formula");
    for (float s : {0.6f, 0.8f, 1.5f}) {
        NeuronDsp d;
        d.prepare(kSr);
        NeuronParams p = single(true, 0.5f, 0.0f, 0.1f);
        p.unit[0].cell.pulse = 0.02f;
        NeuronFrame f;
        std::vector<int> fires;
        bool zeroDuringPulse = true;
        int since = 1 << 30;
        for (int i = 0; i < (int)(kSr * 4); ++i) {
            d.tick(p, patchedIn1(s), f);
            if (f.spike[0] > 0.5f) fires.push_back(i), since = 0;
            else ++since;
            if (since < (int)(0.02 * kSr) && f.membrane[0] != 0.0f) zeroDuringPulse = false;
        }
        const double expected = 0.02 - 0.1 * std::log(1.0 - 0.5 / s);
        EXPECT(fires.size() > 4);
        const double period = (double)(fires.back() - fires[1]) / (double)(fires.size() - 2) / kSr;
        EXPECT_NEAR(period, expected, 2.0 / kSr);
        EXPECT(zeroDuringPulse);
    }
    TEST("at or below threshold never fires");
    NeuronDsp d;
    d.prepare(kSr);
    const NeuronParams p = single(true, 0.5f, 0.0f, 0.1f);
    NeuronFrame f;
    int n = 0;
    for (int i = 0; i < (int)kSr * 2; ++i) d.tick(p, patchedIn1(0.5f), f), n += f.spike[0] > 0.5f;
    EXPECT(n == 0);
}

static void leakZero() {
    TEST("leak 0: membrane equals the sum");
    NeuronDsp d;
    d.prepare(kSr);
    NeuronParams p = single(false, 0.5f, 0.0f, 0.0f);
    p.unit[0].weight = {0.5f, -2.0f, 0.0f};
    NeuronFrame f;
    for (int i = 0; i < 100; ++i) {
        NeuronInputs in = patchedIn1(std::sin(i * 0.1f));
        in.in[0][1] = std::cos(i * 0.3f);
        d.tick(p, in, f);
        EXPECT_NEAR(f.membrane[0], 0.5f * in.in[0][0] - 2.0f * in.in[0][1], 1e-6);
    }
}

static void normals() {
    TEST("unpatched In 1 reads +1");
    NeuronDsp d;
    d.prepare(kSr);
    NeuronParams p = single(false, 0.5f, 0.0f, 0.0f);
    p.unit[0].weight = {0.7f, 0.0f, 0.0f};
    NeuronInputs in;  // nothing patched
    NeuronFrame f;
    d.tick(p, in, f);
    EXPECT_NEAR(f.membrane[0], 0.7f, 1e-6);

    TEST("In 3 hears the other neuron one sample late");
    for (NeuronCross cross : {NeuronCross::Out, NeuronCross::Gate, NeuronCross::Off}) {
        NeuronDsp e;
        e.prepare(kSr);
        NeuronParams q = single(false, 0.0f, 0.0f, 0.0f);
        q.cross = cross;
        q.unit[0].weight = {0.0f, 0.0f, 1.0f};       // A = its In 3
        q.unit[1].weight = {0.0f, 1.0f, 0.0f};       // B = its In 2
        q.unit[1].cell = {0.0f, 0.0f, 0.0f, 0.01f, false};
        q.unit[1].sharp = 1.0f;
        NeuronInputs n;
        n.patched[1][1] = true;
        float prevOut = 0.0f, prevGate = 0.0f;
        for (int i = 0; i < 50; ++i) {
            n.in[1][1] = 0.5f + 0.4f * std::sin(i * 0.5f);
            e.tick(q, n, f);
            const float expected = cross == NeuronCross::Out ? prevOut : cross == NeuronCross::Gate ? prevGate : 0.0f;
            EXPECT_NEAR(f.membrane[0], expected, 1e-6);
            prevOut = f.out[1];
            prevGate = f.gate[1];
        }
        n.patched[0][2] = true;  // a cable replaces the normal
        n.in[0][2] = -0.3f;
        e.tick(q, n, f);
        EXPECT_NEAR(f.membrane[0], -0.3f, 1e-6);
    }
}

static void logicAndOut() {
    TEST("logic truth tables and Diff");
    NeuronDsp d;
    d.prepare(kSr);
    NeuronParams p = defaults();
    p.cross = NeuronCross::Off;
    for (auto& u : p.unit) {
        u.weight = {0.0f, 1.0f, 0.0f};
        u.cell = {0.0f, 0.0f, 0.0f, 0.01f, false};
    }
    NeuronInputs in;
    in.patched[0] = in.patched[1] = {true, true, true};
    NeuronFrame f;
    for (int a = 0; a < 2; ++a)
        for (int b = 0; b < 2; ++b) {
            in.in[0][1] = a ? 0.3f : -0.3f;
            in.in[1][1] = b ? 0.2f : -0.2f;
            d.tick(p, in, f);
            EXPECT((f.logicAnd > 0.5f) == (a && b));
            EXPECT((f.logicOr > 0.5f) == (a || b));
            EXPECT((f.logicXor > 0.5f) == (a != b));
            EXPECT_NEAR(f.diff, f.out[0] - f.out[1], 1e-7);
        }
    TEST("Out stays in 0..1; Sharp 1 is m − threshold below 0.95");
    for (float sharp : {1.0f, 4.0f, 30.0f, 100.0f})
        for (float m = -2.0f; m <= 3.0f; m += 0.01f) {
            const float o = NeuronDsp::outCurve(m, 0.2f, sharp, false);
            EXPECT(o >= 0.0f && o <= 1.0f);
            if (sharp == 1.0f && m - 0.2f < 0.95f) EXPECT_NEAR(o, std::max(0.0f, m - 0.2f), 1e-6);
            const float s = NeuronDsp::outCurve(m, 0.2f, sharp, true);
            EXPECT(s >= 0.0f && s <= 1.0f);
        }
}

static std::vector<float> renderDefaults(int seconds, int* firesA = nullptr, int* firesB = nullptr) {
    NeuronDsp d;
    d.prepare(kSr);
    const NeuronParams p = defaults();
    NeuronInputs in;
    NeuronFrame f;
    std::vector<float> out;
    for (int i = 0; i < (int)kSr * seconds; ++i) {
        d.tick(p, in, f);
        out.push_back(f.gate[0] + 2.0f * f.gate[1] + f.out[0]);
        if (firesA) *firesA += f.spike[0] > 0.5f;
        if (firesB) *firesB += f.spike[1] > 0.5f;
    }
    return out;
}

static void defaultRhythm() {
    TEST("defaults fire both neurons within 2 s, without cables");
    int a = 0, b = 0;
    renderDefaults(2, &a, &b);
    EXPECT(a >= 2);
    EXPECT(b >= 1);
    std::printf("  2 s: A fired %d, B fired %d\n", a, b);
    TEST("two renders are identical");
    EXPECT(renderDefaults(3) == renderDefaults(3));
}

static void stable() {
    TEST("audio-rate feedback stays in range");
    NeuronDsp d;
    d.prepare(kSr);
    NeuronParams p = defaults();
    for (auto& u : p.unit) u.cell.leak = 0.0f, u.cell.spike = false, u.sharp = 100.0f;
    p.unit[0].weight = {0.0f, 0.0f, -2.0f};
    p.unit[1].weight = {0.0f, 0.0f, 2.0f};
    NeuronInputs in;
    NeuronFrame f;
    for (int i = 0; i < 10000; ++i) {
        d.tick(p, in, f);
        EXPECT(std::isfinite(f.diff) && std::fabs(f.diff) <= 1.0f);
    }
}

int main() {
    compare();
    spikeRate();
    leakZero();
    normals();
    logicAndOut();
    defaultRhythm();
    stable();
    return bleep::test::finish("neuron");
}
