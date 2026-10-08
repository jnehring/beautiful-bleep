// SPDX-License-Identifier: MIT
// Rhythm Bank: the families against hand-checked rows, metric strength,
// determinism over every (Family, P, L), Poly Free timing, rotation, mute,
// complement, accent, pattern changes on the cycle and transport timing.
#include "RhythmBankDsp.h"

#include "dsp/tests/TestUtil.h"

#include <string>
#include <vector>

using namespace bleep;
using patch::RbParams;
using patch::RhythmBankDsp;

static constexpr double kSr = 48000.0;

static std::string row(const patch::RbPattern& p, int j) {
    std::string s;
    for (int i = 0; i < p.length; ++i) s += ((p.rows[j] >> i) & 1u) ? 'x' : '.';
    return s;
}

static void basics() {
    TEST("rhythm bank: euclid and metric strength");
    std::string e;
    for (int m = 0; m < 8; ++m) e += patch::rbEuclid(3, 8, m) ? 'x' : '.';
    EXPECT(e == "x..x..x.");
    const int s16[16] = {5, 1, 2, 1, 3, 1, 2, 1, 4, 1, 2, 1, 3, 1, 2, 1};
    for (int i = 0; i < 16; ++i) EXPECT(patch::rbStrength(16, i) == s16[i]);
    const int s12[12] = {4, 1, 1, 2, 1, 1, 3, 1, 1, 2, 1, 1};
    for (int i = 0; i < 12; ++i) EXPECT(patch::rbStrength(12, i) == s12[i]);
    EXPECT(patch::rbStrength(7, 0) == 2);
    for (int i = 1; i < 7; ++i) EXPECT(patch::rbStrength(7, i) == 1);
}

static void families() {
    TEST("rhythm bank: families");
    auto m0 = patch::rbPattern(patch::RbMetric, 0, 16);
    EXPECT(row(m0, 0) == "x...............");
    EXPECT(row(m0, 1) == "x.......x.......");
    EXPECT(row(m0, 2) == "x...x...x...x...");
    EXPECT(row(m0, 3) == "x.x.x.x.x.x.x.x.");
    EXPECT(row(patch::rbPattern(patch::RbMetric, 16, 16), 1) == "........x.......");
    EXPECT(row(patch::rbPattern(patch::RbMetric, 32, 16), 2) == "....x.......x...");
    auto pr = patch::rbPattern(patch::RbPrime, 0, 16);  // {2, 3, 5, 7}
    EXPECT(row(pr, 0) == "x.x.x.x.x.x.x.x.");
    EXPECT(row(pr, 1) == "x..x..x..x..x..x");
    EXPECT(row(pr, 2) == "x....x....x....x");
    EXPECT(row(pr, 3) == "x......x......x.");
    EXPECT((patch::rbPrimeSets()[14] == std::array<int, 4>{5, 7, 11, 13}));
    EXPECT((patch::rbPolySets()[0] == std::array<int, 4>{2, 3, 4, 6}));
    // Even, Canon at P 2 (k0 = 3), L 8: E(3, 8) rotated by 0, 2, 4, 6.
    auto ev = patch::rbPattern(patch::RbEven, 5, 16);  // k0 = 1 + round(5·15/15) = 6
    for (int j = 0; j < 4; ++j) {
        int hits = 0;
        for (int i = 0; i < 16; ++i) hits += (ev.rows[j] >> i) & 1;
        EXPECT(hits == 6);
    }
    EXPECT(row(ev, 1).substr(4) + row(ev, 1).substr(0, 4) == row(ev, 0));  // rotated by L/4
    // Interlock never overlaps; Seeded hits step 0 on Out 1.
    for (int P = 0; P < 128; ++P)
        for (int L = 2; L <= 32; ++L) {
            const auto il = patch::rbPattern(patch::RbInterlock, P, L);
            for (int a = 0; a < 4; ++a)
                for (int b = a + 1; b < 4; ++b) EXPECT((il.rows[a] & il.rows[b]) == 0);
            EXPECT(patch::rbPattern(patch::RbSeeded, P, L).rows[0] & 1u);
        }
    // Poly: a pattern's hits counted per output (Snap).
    const auto po = patch::rbPattern(patch::RbPoly, 0, 24);
    const int ns[4] = {2, 3, 4, 6};
    for (int j = 0; j < 4; ++j) {
        int hits = 0;
        for (int i = 0; i < 24; ++i) hits += (po.rows[j] >> i) & 1;
        EXPECT(hits == ns[j]);
    }
}

static void deterministic() {
    TEST("rhythm bank: every family, pattern and length");
    for (int f = 0; f < 6; ++f)
        for (int P = 0; P < 128; ++P)
            for (int L = 2; L <= 32; ++L) {
                const auto a = patch::rbPattern(f, P, L, true), b = patch::rbPattern(f, P, L, true);
                for (int j = 0; j < 4; ++j) {
                    EXPECT(a.rows[j] == b.rows[j]);
                    EXPECT(((uint64_t)a.rows[j] >> L) == 0);
                }
            }
}

static void complement() {
    TEST("rhythm bank: rotate, mute, complement, accent");
    patch::RbPattern pt;
    pt.length = 8;
    pt.rows[0] = 0b00010001;  // x...x...
    pt.rows[1] = 0b00010101;  // x.x.x...
    pt.rows[2] = 0b11111111;
    pt.rows[3] = 0b00000011;
    int rot[4] = {0, 0, 0, 0};
    bool mute[4] = {false, false, false, false};
    auto bits = [&](int comp, int step) { return patch::rbStep(pt, 0, 0, false, step, rot, mute, comp).bits; };
    EXPECT(bits(patch::RbOff, 0) == 0b1111);
    EXPECT(bits(patch::RbAvoid, 0) == 0b0001);
    EXPECT(bits(patch::RbAvoid, 2) == 0b0010);
    EXPECT(bits(patch::RbAvoid, 3) == 0b0100);
    // Fill: every step exactly once.
    for (int i = 0; i < 8; ++i) {
        const int b = bits(patch::RbFill, i);
        EXPECT(b == 1 || b == 2 || b == 4 || b == 8);
    }
    // Pairs: Out 2 = not Out 1, Out 4 = not Out 3.
    for (int i = 0; i < 8; ++i) {
        const int b = bits(patch::RbPairs, i);
        EXPECT(((b >> 1) & 1) != (b & 1) && ((b >> 3) & 1) != ((b >> 2) & 1));
    }
    // Rotate: Out 1 by +1 hits on step 1 and 5; by −1 on 3 and 7.
    rot[0] = 1;
    EXPECT((bits(patch::RbOff, 1) & 1) && (bits(patch::RbOff, 5) & 1) && !(bits(patch::RbOff, 0) & 1));
    rot[0] = -1;
    EXPECT((bits(patch::RbOff, 3) & 1) && (bits(patch::RbOff, 7) & 1));
    rot[0] = 0;
    // Mute: muted outputs are empty and don't count for Accent or Complement.
    mute[0] = true;
    EXPECT(bits(patch::RbAvoid, 0) == 0b0010);
    const auto h = patch::rbStep(pt, 0, 0, false, 6, rot, mute, patch::RbAvoid);
    EXPECT(!h.accent);  // only Out 3 hits on step 6
    mute[0] = false;
    EXPECT(patch::rbStep(pt, 0, 0, false, 0, rot, mute, patch::RbAvoid).accent);  // accent before complement
}

struct Rig {
    RhythmBankDsp dsp;
    RbParams p;
    patch::RbInput in;
    patch::RbOutputs out;
    int64_t t = 0;
    float last[4]{};
    std::vector<int64_t> rises[4];
    Rig() {
        dsp.prepare(kSr);
        dsp.reset();
        in.running = true;
    }
    double origin = 0.0;
    int64_t originT = 0;
    void jump(double ppq) {
        origin = ppq;
        originT = t;
    }
    void play(int64_t n) {
        const double samplesPerBeat = kSr * 60.0 / in.bpm;
        for (int64_t i = 0; i < n; ++i) {
            in.started = t == 0;
            in.ppq = origin + (double)(t - originT) / samplesPerBeat;
            dsp.tick(p, in, out);
            for (int j = 0; j < 4; ++j) {
                if (out.out[j] > 0.5f && last[j] <= 0.5f) rises[j].push_back(t);
                last[j] = out.out[j];
            }
            ++t;
        }
    }
};

static void timing() {
    TEST("rhythm bank: transport timing, pattern change on the cycle, poly free");
    Rig r;
    r.p.family = patch::RbMetric;
    const int64_t step = (int64_t)(0.25 * 60.0 / 120.0 * kSr);  // 6000
    r.play(step * 16);
    EXPECT(r.rises[0].size() == 1 && r.rises[1].size() == 2 && r.rises[2].size() == 4 && r.rises[3].size() == 8);
    for (int64_t at : r.rises[3]) EXPECT(at % (2 * step) == 0);
    // A new Pattern mid-cycle waits for step 1.
    for (auto& v : r.rises) v.clear();
    r.play(step * 3);
    r.p.pattern = 16;  // Out 2 only on step 8
    r.play(step * 13);
    EXPECT((r.rises[1] == std::vector<int64_t>{step * 16, step * 24}));  // still the old pattern this cycle
    EXPECT(r.dsp.activePattern() == 0);
    r.play(1);
    EXPECT(r.dsp.activePattern() == 16);
    for (auto& v : r.rises) v.clear();
    r.play(step * 16 - 1);
    EXPECT(r.rises[1].size() == 1 && r.rises[1][0] == step * 40);
    // A loop jump lands on the right step.
    r.jump(2.0);  // step 8
    r.play(1);
    EXPECT(r.dsp.step() == 8);
    // Poly Free: hits at exact fractions of the cycle.
    Rig q;
    q.p.family = patch::RbPoly;
    q.p.freeGrid = true;
    q.p.length = 16;
    q.play(step * 16);
    // Out 2 is n = 3: hits at 0, 16/3, 32/3 steps.
    EXPECT(q.rises[1].size() == 3);
    if (q.rises[1].size() == 3) {
        EXPECT(std::llabs(q.rises[1][1] - (int64_t)std::llround(16.0 / 3.0 * step)) <= 1);
        EXPECT(std::llabs(q.rises[1][2] - (int64_t)std::llround(32.0 / 3.0 * step)) <= 1);
    }
    // Stop: all gates fall.
    q.p.width = 1.0f;
    q.in.running = false;
    q.play(2);
    for (int j = 0; j < 4; ++j) EXPECT(q.out.out[j] == 0.0f);
}

int main() {
    basics();
    families();
    deterministic();
    complement();
    timing();
    return bleep::test::finish("rhythm-bank");
}
