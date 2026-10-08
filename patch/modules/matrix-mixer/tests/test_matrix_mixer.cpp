// SPDX-License-Identifier: MIT
// Matrix Mixer: identity and inversion, the mix formula, sparse = dense,
// mute ramps, Normalize, Soft clip, morph ends and modulation on top, the
// 20 ms ramp of knob changes, and hidden inputs/outputs.
#include "MatrixMixerDsp.h"

#include "dsp/tests/TestUtil.h"

#include <random>
#include <vector>

using namespace bleep;
using patch::kMmCross;
using patch::kMmSize;
using patch::MatrixMixerDsp;
using patch::MmBlock;

static constexpr double kSr = 48000.0;
static constexpr int kN = 32;

struct Rig {
    MatrixMixerDsp dsp;
    MmBlock b;
    float in[kMmSize][kN]{};
    float out[kMmSize][kN]{};
    float* outs[kMmSize];
    Rig() {
        dsp.prepare(kSr);
        dsp.reset();
        b.numSamples = kN;
        b.inputs = b.outputs = 8;
        for (int i = 0; i < kMmSize; ++i) {
            b.in[i] = in[i];
            b.levelKnob[i] = 1.0f;
            outs[i] = out[i];
        }
    }
    void run() { dsp.process(b, outs); }
    void fill(std::mt19937& rng) {
        std::uniform_real_distribution<float> u(-1.0f, 1.0f);
        for (auto& row : in)
            for (float& x : row) x = u(rng);
    }
};

static void identity() {
    TEST("matrix mixer: identity, inversion and the formula");
    std::mt19937 rng(1);
    Rig r;
    for (int i = 0; i < kMmSize; ++i) r.b.gainKnob[i * kMmSize + i] = 1.0f;
    r.fill(rng);
    r.run();
    for (int j = 0; j < kMmSize; ++j)
        for (int s = 0; s < kN; ++s) EXPECT_NEAR(r.out[j][s], r.in[j][s], 1e-7);
    // Random gains: Out_j = Level_j · Σ gain_ij · In_i.
    Rig f;
    std::uniform_real_distribution<float> u(-1.0f, 1.0f), l(0.0f, 2.0f);
    for (int k = 0; k < kMmCross; ++k) f.b.gainKnob[k] = u(rng);
    for (int j = 0; j < kMmSize; ++j) f.b.levelKnob[j] = l(rng);
    for (int c = 0; c < 4; ++c) {
        f.fill(rng);
        f.run();
        for (int j = 0; j < kMmSize; ++j)
            for (int s = 0; s < kN; ++s) {
                double want = 0.0;
                for (int i = 0; i < kMmSize; ++i) want += (double)f.b.gainKnob[i * kMmSize + j] * f.in[i][s];
                EXPECT_NEAR(f.out[j][s], want * f.b.levelKnob[j], 1e-5);
            }
    }
    // −1 inverts; unpatched inputs read 0 or 1.
    Rig v;
    v.b.gainKnob[0] = -1.0f;
    v.b.in[1] = nullptr;
    v.b.gainKnob[1 * kMmSize + 0] = 0.5f;
    v.b.unpatched = 1.0f;
    v.in[0][0] = 0.25f;
    v.run();
    EXPECT_NEAR(v.out[0][0], -0.25 + 0.5, 1e-7);
}

static void sparse() {
    TEST("matrix mixer: sparse and dense agree; modulation per sample");
    std::mt19937 rng(2);
    Rig a, b;
    float mod[kN];
    for (int s = 0; s < kN; ++s) mod[s] = 0.5f * std::sin(0.3f * (float)s);
    for (Rig* r : {&a, &b}) {
        r->b.gainKnob[0] = 0.7f;   // In 1 → Out 1
        r->b.gainKnob[16] = -0.4f; // In 3 → Out 1
    }
    float eff[kN];
    for (int s = 0; s < kN; ++s) eff[s] = mod[s];  // knob 0 + modulation
    a.b.gainEff[40] = eff;                             // a modulated crosspoint at 0
    b.b.gainEff[40] = eff;
    float zeros[kN]{};
    for (int k = 0; k < kMmCross; ++k)  // b: every other crosspoint "modulated" by 0 (dense path)
        if (k != 40 && b.b.gainKnob[k] == 0.0f) b.b.gainEff[k] = zeros;
    a.fill(rng);
    for (int i = 0; i < kMmSize; ++i)
        for (int s = 0; s < kN; ++s) b.in[i][s] = a.in[i][s];
    a.run();
    b.run();
    for (int j = 0; j < kMmSize; ++j)
        for (int s = 0; s < kN; ++s) EXPECT(a.out[j][s] == b.out[j][s]);
    // Crosspoint 40 = In 6 → Out 1 follows the modulation sample by sample.
    for (int s = 0; s < kN; ++s)
        EXPECT_NEAR(a.out[0][s], 0.7f * a.in[0][s] + -0.4f * a.in[2][s] + mod[s] * a.in[5][s], 1e-6);
}

static void mutes() {
    TEST("matrix mixer: mute ramps over 5 ms");
    Rig r;
    r.b.gainKnob[0] = 1.0f;
    for (float& x : r.in[0]) x = 1.0f;
    r.run();
    r.b.mute[0] = true;
    std::vector<float> y;
    for (int c = 0; c < 10; ++c) {
        r.run();
        for (int s = 0; s < kN; ++s) y.push_back(r.out[0][s]);
    }
    const double maxStep = 1.0 / (0.005 * kSr) + 1e-6;
    float prev = 1.0f;
    for (float v : y) {
        EXPECT(std::fabs(v - prev) <= maxStep);
        prev = v;
    }
    EXPECT(y.back() == 0.0f);
    // Reached zero after 5 ms, not before 4.9 ms.
    size_t zeroAt = 0;
    while (zeroAt < y.size() && y[zeroAt] > 0.0f) ++zeroAt;
    EXPECT(std::llabs((long long)zeroAt + 1 - (long long)(0.005 * kSr)) <= 1);
}

static void stages() {
    TEST("matrix mixer: normalize and soft clip");
    std::mt19937 rng(3);
    std::uniform_real_distribution<float> u(-1.0f, 1.0f);
    Rig r;
    r.b.stage = patch::MmNormalize;
    for (int k = 0; k < kMmCross; ++k) r.b.gainKnob[k] = u(rng);
    for (int c = 0; c < 20; ++c) {
        r.fill(rng);
        r.run();
        float maxIn = 0.0f;
        for (int i = 0; i < kMmSize; ++i)
            for (int s = 0; s < kN; ++s) maxIn = std::max(maxIn, std::fabs(r.in[i][s]));
        for (int j = 0; j < kMmSize; ++j)
            for (int s = 0; s < kN; ++s) EXPECT(std::fabs(r.out[j][s]) <= maxIn + 1e-6f);
    }
    Rig sc;
    sc.b.stage = patch::MmSoftClip;
    for (int i = 0; i < kMmSize; ++i) sc.b.gainKnob[i * kMmSize] = 1.0f;
    for (int i = 0; i < kMmSize; ++i)
        for (float& x : sc.in[i]) x = 1.0f;
    sc.b.levelKnob[0] = 2.0f;
    sc.run();
    EXPECT(sc.out[0][0] <= 1.0f && sc.out[0][0] > 0.99f);
    EXPECT_NEAR(patch::mmSoftClip(0.5f), 0.5, 1e-7);
    // Clean never exceeds ±10.
    Rig cl;
    for (int i = 0; i < kMmSize; ++i) cl.b.gainKnob[i * kMmSize] = 1.0f;
    for (int i = 0; i < kMmSize; ++i)
        for (float& x : cl.in[i]) x = 5.0f;
    cl.b.levelKnob[0] = 2.0f;
    cl.run();
    EXPECT(cl.out[0][0] == 10.0f);
}

static void morph() {
    TEST("matrix mixer: morph between snapshots");
    static patch::MmSnapshots snaps;
    std::mt19937 rng(4);
    std::uniform_real_distribution<float> u(-1.0f, 1.0f);
    snaps.a = 2;
    snaps.b = 5;
    for (int k : {2, 5}) {
        snaps.s[k].valid = true;
        for (float& g : snaps.s[k].g) g = u(rng);
    }
    snaps.s[5].level[1] = 0.5f;
    for (float m : {0.0f, 1.0f}) {
        Rig r;
        float amount[kN];
        std::fill(amount, amount + kN, m);
        r.b.morph = true;
        r.b.morphAmount = amount;
        r.b.snapshots = &snaps;
        r.fill(rng);
        r.run();
        const auto& S = snaps.s[m < 0.5f ? 2 : 5];
        for (int j = 0; j < kMmSize; ++j)
            for (int s = 0; s < kN; ++s) {
                double want = 0.0;
                for (int i = 0; i < kMmSize; ++i) want += (double)S.g[i * kMmSize + j] * r.in[i][s];
                EXPECT_NEAR(r.out[j][s], want * S.level[j], 1e-5);
            }
    }
    // Modulation adds on top of the morphed gain.
    Rig r;
    float amount[kN], eff[kN];
    std::fill(amount, amount + kN, 0.5f);
    std::fill(eff, eff + kN, 0.25f);  // knob 0 + 0.25
    r.b.morph = true;
    r.b.morphAmount = amount;
    r.b.snapshots = &snaps;
    r.b.gainEff[0] = eff;
    r.in[0][0] = 1.0f;
    for (int i = 1; i < kMmSize; ++i) r.in[i][0] = 0.0f;
    r.run();
    EXPECT_NEAR(r.out[0][0], 0.5f * snaps.s[2].g[0] + 0.5f * snaps.s[5].g[0] + 0.25f, 1e-6);
}

static void ramps() {
    TEST("matrix mixer: knob changes ramp over 20 ms; hidden jacks");
    Rig r;
    for (float& x : r.in[0]) x = 1.0f;
    r.run();
    r.b.gainKnob[0] = 1.0f;  // a recall: 0 → 1
    std::vector<float> y;
    for (int c = 0; c < 40; ++c) {
        r.run();
        for (int s = 0; s < kN; ++s) y.push_back(r.out[0][s]);
    }
    const size_t ramp = (size_t)(0.020 * kSr);
    EXPECT_NEAR(y[ramp / 2], 0.5, 0.01);
    EXPECT(y[ramp - 2] < 1.0f && y[ramp + 1] == 1.0f);
    // Inputs and outputs beyond the counts carry nothing.
    Rig h;
    h.b.inputs = 2;
    h.b.outputs = 2;
    h.b.gainKnob[3 * kMmSize + 0] = 1.0f;  // In 4 → Out 1: hidden
    for (float& x : h.in[3]) x = 1.0f;
    h.run();
    EXPECT(h.out[0][0] == 0.0f);
}

int main() {
    identity();
    sparse();
    mutes();
    stages();
    morph();
    ramps();
    return bleep::test::finish("matrix-mixer");
}
