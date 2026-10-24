// SPDX-License-Identifier: GPL-3.0-only
// Shape Env (doc/specs/modules/shape-envelope.md §8): the library as the module
// plays it, Morph, one-shot timing, the gated hold, retrigger crossfades,
// the bar lock, Skew and Reverse, and user slots.
#include "ShapeEnvDsp.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <functional>
#include <vector>

using namespace bleep;
using patch::ShapeEnvDsp;
using patch::ShapeEnvFrame;
using patch::ShapeEnvParams;
using patch::ShapeEnvTime;
using patch::UserShapes;
using patch::UserSlot;

static constexpr double kSr = 48000.0;

struct Run {
    std::vector<float> out, inv, phase, end, active;
};
static Run run(const ShapeEnvParams& base, int64_t n, std::function<float(int64_t)> trig, std::function<float(int64_t)> gate,
               const UserShapes* user = nullptr, std::function<void(int64_t, ShapeEnvParams&)> mod = nullptr) {
    ShapeEnvDsp d;
    d.prepare(kSr);
    Run r;
    ShapeEnvTime t;
    ShapeEnvFrame f;
    ShapeEnvParams p = base;
    for (int64_t i = 0; i < n; ++i) {
        if (mod) mod(i, p);
        d.tick(p, trig ? trig(i) : 0.0f, gate ? gate(i) : 0.0f, 1.0f, t, user, f);
        r.out.push_back(f.out);
        r.inv.push_back(f.inv);
        r.phase.push_back(f.phase);
        r.end.push_back(f.end);
        r.active.push_back(f.active);
    }
    return r;
}
static float maxStep(const std::vector<float>& x, size_t from = 1) {
    float s = 0.0f;
    for (size_t i = std::max<size_t>(from, 1); i < x.size(); ++i) s = std::max(s, std::fabs(x[i] - x[i - 1]));
    return s;
}

static void library() {
    TEST("shape env: every shape in range, envelopes 0 at both ends, cycles closed, order pinned");
    uint32_t h = 2166136261u;
    for (int s = 0; s < ShapeEnvDsp::kFactory; ++s) {
        const auto& t = ShapeEnvDsp::table(s, nullptr);
        const auto in = ShapeEnvDsp::info(s, nullptr);
        for (float v : t.v) EXPECT(std::isfinite(v) && v <= 1.0f && v >= (in.bipolar ? -1.0f : 0.0f));
        if (in.kind == dsp::ShapeKind::Envelope) EXPECT(t.v.front() == 0.0f && t.v.back() == 0.0f);
        else EXPECT(t.v.front() == t.v.back());
        h = (h ^ t.checksum()) * 16777619u;
    }
    if (std::getenv("BLEEP_PRINT_SHAPES")) std::printf("library checksum 0x%08xu\n", h);
    EXPECT(h == 0xebd6492au);  // reordering or changing a factory shape changes saved boards' sound
    // The user slots follow, then the index wraps.
    EXPECT(ShapeEnvDsp::wrap(104) == 0 && ShapeEnvDsp::wrap(-1) == 103);
}

static void morph() {
    TEST("shape env: Morph 0 / 100 % / 50 %");
    for (int s : {3, 47, 95, 103}) {
        for (double ph : {0.1, 0.37, 0.8}) {
            const float a = ShapeEnvDsp::table(s, nullptr).at(ph), b = ShapeEnvDsp::table(s + 1, nullptr).at(ph);
            EXPECT_NEAR(ShapeEnvDsp::lookup(s, 0.0f, 0.0f, false, ph, nullptr), a, 1e-6);
            EXPECT_NEAR(ShapeEnvDsp::lookup(s, 1.0f, 0.0f, false, ph, nullptr), b, 1e-6);
            EXPECT_NEAR(ShapeEnvDsp::lookup(s, 0.5f, 0.0f, false, ph, nullptr), 0.5f * (a + b), 1e-6);
        }
    }
}

static void oneShot() {
    TEST("shape env: One-shot End at exactly Time; Gated holds at the sustain point");
    ShapeEnvParams p;
    p.time = 0.1f;  // 4800 samples
    p.shape = 3;    // Long exp
    const Run r = run(p, 9600, [](int64_t i) { return i == 100 ? 1.0f : 0.0f; }, nullptr);
    std::vector<int64_t> ends;
    for (size_t i = 0; i < r.end.size(); ++i)
        if (r.end[i] > 0.5f) ends.push_back((int64_t)i);
    EXPECT(ends.size() == 1 && !ends.empty() && std::llabs(ends[0] - (100 + 4800)) <= 1);
    EXPECT(r.active[200] > 0.5f && r.active[6000] < 0.5f);
    EXPECT(r.out[9000] == 0.0f);
    EXPECT(r.out[100 + 20] > 0.9f);  // the attack is one table step (19 samples here)
    // Gated, ADSR 50 % (sustain at 0.745): holds while the gate is high.
    p.mode = patch::ShapeGated;
    p.shape = 25;
    const Run g = run(p, 48000, nullptr, [](int64_t i) { return i >= 100 && i < 30000 ? 1.0f : 0.0f; });
    const double hold = 0.745 * 4800.0;
    EXPECT_NEAR(g.phase[20000], 0.745, 1e-6);
    EXPECT_NEAR(g.out[20000], 0.5, 0.01);
    EXPECT(g.out[29999] == g.out[20000]);
    bool ended = false;  // the rest of the shape after the gate falls
    for (int i = -2; i <= 2; ++i) ended = ended || g.end[(size_t)(30000 + 4800 - (int)hold + i)] > 0.5f;
    EXPECT(ended);
    // A gate that ends before the sustain point plays on.
    const Run e = run(p, 9600, nullptr, [](int64_t i) { return i >= 100 && i < 500 ? 1.0f : 0.0f; });
    EXPECT(e.end[4900] > 0.5f || e.end[4901] > 0.5f);
}

static void retrigger() {
    TEST("shape env: Restart crossfades over 2 ms; Ignore drops starts while running");
    ShapeEnvParams p;
    p.time = 0.5f;
    p.shape = 48;  // Sine: 1 at a quarter, restarting at 0
    const Run r = run(p, 24000, [](int64_t i) { return i == 10 || i == 6010 ? 1.0f : 0.0f; }, nullptr);
    // From 1 back to 0: at most 1/96 per sample (2 ms) plus the sine's own slope.
    EXPECT(r.out[6009] > 0.99f);
    EXPECT(maxStep(r.out, 12) < 1.0f / 96.0f + 2.0f * 3.1416f / 24000.0f + 1e-4f);
    EXPECT(std::fabs(r.out[6010 + 200] - (float)std::sin(2.0 * 3.141592653589793 * 199.0 / 24000.0)) < 1e-3f);
    p.ignoreRetrigger = true;
    const Run g = run(p, 30000, [](int64_t i) { return i == 10 || i == 6010 ? 1.0f : 0.0f; }, nullptr);
    EXPECT(g.out[6200] > 0.99f);  // still the first sine, around its peak
    int ends = 0;
    for (float v : g.end) ends += v > 0.5f ? 1 : 0;
    EXPECT(ends == 1);
}

static void loopSync() {
    TEST("shape env: Loop + Sync follows the song position and repeats after a jump");
    ShapeEnvParams p;
    p.mode = patch::ShapeLoop;
    p.sync = 12;  // 1/4 (Off, 16 bars, 8 bars, … 1/4 is note value 11)
    EXPECT(std::string(ShapeEnvDsp::syncName(12)) == "1/4");
    p.shape = 50;  // Saw up
    ShapeEnvDsp d;
    d.prepare(kSr);
    ShapeEnvTime t;
    t.running = true;
    ShapeEnvFrame f;
    std::vector<float> first;
    int ends = 0;
    for (int i = 0; i < 48000; ++i) {
        t.ppq = i * 2.0 / kSr;
        d.tick(p, 0.0f, 0.0f, 1.0f, t, nullptr, f);
        first.push_back(f.out);
        ends += f.end > 0.5f ? 1 : 0;
        if (i == 30000) EXPECT_NEAR(f.phase, dsp::wrap01(t.ppq), 1e-6);
    }
    EXPECT(ends == 1);  // the wrap at 1 beat (and none at the start)
    for (int i = 24000; i < 48000; ++i) {
        t.ppq = i * 2.0 / kSr;
        d.tick(p, 0.0f, 0.0f, 1.0f, t, nullptr, f);
        EXPECT(f.out == first[(size_t)i]);
    }
    // A shape change in Loop crossfades over 5 ms.
    ShapeEnvParams q;
    q.mode = patch::ShapeLoop;
    q.shape = 48;  // Sine
    const Run r = run(q, 24000, nullptr, nullptr, nullptr, [](int64_t i, ShapeEnvParams& x) { x.shape = i < 6000 ? 48 : 52; });
    EXPECT(maxStep(r.out, 1) < 2.0f / 240.0f + 0.02f);
}

static void skewReverse() {
    TEST("shape env: Skew ±1 and Reverse map phases as documented");
    EXPECT_NEAR(dsp::skewPhase(0.25, 1.0f), 0.5, 1e-9);  // the first half in a quarter of the time
    EXPECT_NEAR(dsp::skewPhase(std::sqrt(0.5), -1.0f), 0.5, 1e-9);
    const int saw = 50;  // Saw up: −1 → +1
    EXPECT_NEAR(ShapeEnvDsp::lookup(saw, 0.0f, 0.0f, true, 0.25, nullptr), ShapeEnvDsp::table(saw, nullptr).at(0.75), 1e-6);
    EXPECT_NEAR(ShapeEnvDsp::lookup(saw, 0.0f, 1.0f, false, 0.25, nullptr), ShapeEnvDsp::table(saw, nullptr).at(0.5), 1e-6);
    // Sustain points mirror with Reverse and move with Skew.
    EXPECT_NEAR(ShapeEnvDsp::holdPhase(0.75f, 0.0f, true), 0.25, 1e-9);
    EXPECT_NEAR(dsp::skewPhase(ShapeEnvDsp::holdPhase(0.6f, 0.7f, false), 0.7f), 0.6, 1e-6);
    EXPECT(ShapeEnvDsp::holdPhase(-1.0f, 0.0f, false) < 0.0);
}

static void userShapes() {
    TEST("shape env: user slots clean, build and play; empty slots are 0");
    UserShapes user{};
    // A drawn ramp with 10 points, stored as 64; a cycle closes; out-of-range values clamp.
    double ramp[10];
    for (int i = 0; i < 10; ++i) ramp[i] = i / 9.0 * 1.4 - 0.2;
    UserSlot slot;
    slot.set(ramp, 10, 0.5, false, false);
    EXPECT(slot.used && slot.points[0] == 0.0f && slot.points[63] == 1.0f && slot.sustain == 0.5f);
    for (float v : slot.points) EXPECT(v == UserSlot::round3(v));
    slot.build(user[0]);
    EXPECT_NEAR(user[0].table.at(0.5), slot.points[31] + 0.5f * (slot.points[32] - slot.points[31]), 0.01);
    UserSlot cyc;
    cyc.set(ramp, 10, 2.0, true, true);
    EXPECT(cyc.points[63] == cyc.points[0] && cyc.sustain < 0.0f && cyc.points[0] < 0.0f);
    cyc.build(user[1]);
    EXPECT(user[1].table.v.back() == user[1].table.v.front());
    // Broken input: nothing, NaNs.
    UserSlot none;
    none.set(ramp, 0, 0.5, false, false);
    EXPECT(!none.used);
    const double nan[3] = {NAN, INFINITY, 0.5};
    UserSlot odd;
    odd.set(nan, 3, NAN, false, false);
    for (float v : odd.points) EXPECT(std::isfinite(v));
    // Playing slot 96 (User 1) and an empty slot 98 (User 3).
    ShapeEnvParams p;
    p.time = 0.1f;
    p.shape = 96;
    const Run r = run(p, 6000, [](int64_t i) { return i == 0 ? 1.0f : 0.0f; }, nullptr, &user);
    EXPECT_NEAR(r.out[2400], user[0].table.at(0.5), 0.01);
    p.shape = 98;
    const Run z = run(p, 6000, [](int64_t i) { return i == 0 ? 1.0f : 0.0f; }, nullptr, &user);
    for (float v : z.out) EXPECT(v == 0.0f);
    EXPECT(ShapeEnvDsp::info(97, &user).bipolar && ShapeEnvDsp::info(97, &user).kind == dsp::ShapeKind::Cycle);
}

int main() {
    library();
    morph();
    oneShot();
    retrigger();
    loopSync();
    skewReverse();
    userShapes();
    return bleep::test::finish("shape env");
}
