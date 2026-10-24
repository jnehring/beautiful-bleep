// SPDX-License-Identifier: GPL-3.0-only
// Recall: transport grid, rebuild on jumps, T modes, jitter, X distribution,
// Steps, Recall rings, Sorted, captured loops (doc/specs/modules/recall.md §8).
#include "RecallDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <vector>

using namespace bleep;
using patch::RecallCaptures;
using patch::RecallDsp;
using patch::RecallFrame;
using patch::RecallInput;
using patch::RecallParams;
using patch::RecallTMode;
using patch::RecallXSource;

static constexpr double kSr = 48000.0;

template <class In>
static std::vector<RecallFrame> render(const RecallParams& p, int samples, In&& input, RecallDsp* use = nullptr) {
    RecallDsp local;
    RecallDsp& d = use ? *use : local;
    if (!use) d.prepare(kSr);
    std::vector<RecallFrame> out;
    RecallFrame f;
    for (int i = 0; i < samples; ++i) {
        RecallInput in;
        input(i, in);
        d.tick(p, in, f);
        out.push_back(f);
    }
    return out;
}
/// Transport at 120 BPM from `ppq0` (started on the first sample if `start`).
static auto playing(double ppq0, bool start = true) {
    return [ppq0, start](int i, RecallInput& in) {
        in.running = true;
        in.started = start && i == 0;
        in.ppq = ppq0 + i * 2.0 / kSr;
    };
}
/// Clock patched, a pulse every `period` samples.
static auto clocked(int period) {
    return [period](int i, RecallInput& in) {
        in.clockPatched = true;
        in.clock = i % period == 0 ? 1.0f : 0.0f;
    };
}

static void grid() {
    TEST("ticks land on the grid for every Sync value");
    for (int s = 1; s < RecallDsp::numSyncs(); ++s) {
        RecallParams p;
        p.sync = s;
        const double beats = RecallDsp::syncBeats(s);
        const auto r = render(p, (int)(kSr * 3), playing(0.3));
        for (size_t i = 1; i < r.size(); ++i) {
            const bool boundary = std::floor((0.3 + i * 2.0 / kSr) / beats) != std::floor((0.3 + (i - 1) * 2.0 / kSr) / beats);
            EXPECT((r[i].clock > 0.5f) == boundary);
        }
    }
    TEST("a loop jump rebuilds the rings as playing through would");
    RecallParams p;
    p.tRecall = 0.6f;
    p.xRecall = 0.7f;
    p.tLoop = 5;
    RecallDsp a;
    a.prepare(kSr);
    render(p, (int)(kSr * 4), playing(0.0), &a);  // 8 beats
    const auto jumped = render(p, (int)(kSr * 2), playing(40.0, false), &a);
    const auto fresh = render(p, (int)(kSr * 2), playing(40.0));
    bool same = true;
    for (size_t i = 0; i < jumped.size(); ++i)
        same = same && jumped[i].t1 == fresh[i].t1 && jumped[i].t2 == fresh[i].t2 && jumped[i].x == fresh[i].x;
    EXPECT(same);
}

static std::array<float, 4> uniforms(int64_t k) {
    std::array<float, 4> u{};
    for (int j = 0; j < 4; ++j) u[(size_t)j] = (float)dsp::uniform01(99, (uint64_t)k, (uint64_t)j);
    return u;
}

static void tModes() {
    TEST("Coin: exactly one of T1/T2; share of T1 ≈ Bias");
    int t1 = 0, both = 0, n1 = 0, n2 = 0;
    for (int64_t k = 0; k < 10000; ++k) {
        const auto f = RecallDsp::tFire(uniforms(k), k, RecallTMode::Coin, 0.3);
        EXPECT(f.count[0] + f.count[1] == 1);
        t1 += f.count[0];
        const auto c = RecallDsp::tFire(uniforms(k), k, RecallTMode::Chance, 0.6);
        both += c.count[0] && c.count[1];
        n1 += c.count[0];
        n2 += c.count[1];
    }
    EXPECT_NEAR(t1 / 10000.0, 0.3, 0.02);
    TEST("Chance: independent (joint ≈ Bias²)");
    EXPECT_NEAR(both / 10000.0, 0.36, 0.02);
    EXPECT_NEAR(n1 / 10000.0, 0.6, 0.02);
    EXPECT_NEAR(n2 / 10000.0, 0.6, 0.02);
    TEST("Drums: ticks 1 and 9 fire T1 more often than 3 and 11");
    int strong = 0, weak = 0;
    for (int64_t k = 0; k < 16000; ++k) {
        const auto f = RecallDsp::tFire(uniforms(k), k, RecallTMode::Drums, 0.5);
        const int pos = (int)(k % 16);
        if (pos == 0 || pos == 8) strong += f.count[0];
        if (pos == 2 || pos == 10) weak += f.count[0];
    }
    EXPECT(strong > 3 * weak);
    TEST("Ratchet choices follow Bias");
    EXPECT(RecallDsp::ratchet(0.5, 0.5) == 1);
    EXPECT(RecallDsp::ratchet(0.5, 0.0) < 0);
    EXPECT(RecallDsp::ratchet(0.5, 1.0) > 1);
}

/// A captured T loop whose every slot is `u` (all four numbers).
static RecallCaptures capturedT(float u0, float u1 = 0.99f) {
    RecallCaptures c;
    c.t.use = true;
    c.t.length = 16;
    for (int s = 0; s < 16; ++s) {
        c.t.values[(size_t)s] = {u0, u1, 0.0f, 0.0f, 0, 0, 0, 0, 0};
        c.t.count[(size_t)s] = 4;
    }
    return c;
}
static double findRatchet(int rate, double bias) {
    for (double u = 0.0005; u < 1.0; u += 0.001)
        if (RecallDsp::ratchet(u, bias) == rate) return u;
    return -1.0;
}

static void ratchets() {
    TEST("Ratchet ×3: three evenly spaced pulses per tick");
    const double u3 = findRatchet(3, 0.8);
    EXPECT(u3 >= 0.0);
    RecallCaptures cap = capturedT((float)u3);
    RecallParams p;
    p.tMode = RecallTMode::Ratchet;
    p.tBias = 0.8f;
    p.captured = &cap;
    const auto r = render(p, 4800 * 6, clocked(4800));
    std::vector<int> rises;
    for (size_t i = 1; i < r.size(); ++i)
        if (r[i].t1 > 0.5f && r[i - 1].t1 < 0.5f) rises.push_back((int)i);
    // Once the period is measured: pulses at 0, 1600, 3200 into each tick.
    int checked = 0;
    for (int x : rises)
        if (x >= 9600) {  // the first tick (unmeasured period) overlaps the second
            EXPECT(x % 1600 == 0);
            ++checked;
        }
    EXPECT(checked == 12);
    TEST("Ratchet ÷2 fires on every other tick");
    const double u2 = findRatchet(-2, 0.2);
    RecallCaptures cap2 = capturedT((float)u2);
    p.tBias = 0.2f;
    p.captured = &cap2;
    const auto q = render(p, 4800 * 8, clocked(4800));
    for (int t = 0; t < 8; ++t) EXPECT((q[(size_t)(t * 4800 + 10)].t1 > 0.5f) == (t % 2 == 0));
}

static void jitter() {
    TEST("Jitter never moves a gate early; Clock is never late");
    RecallParams p;
    p.tJitter = 1.0f;
    p.tMode = RecallTMode::Chance;
    p.tBias = 0.7f;
    const auto r = render(p, 4800 * 40, clocked(4800));
    int late = 0;
    for (size_t i = 1; i < r.size(); ++i) {
        EXPECT((r[i].clock > 0.5f) == (i % 4800 == 0));
        if (r[i].t1 > 0.5f && r[i - 1].t1 < 0.5f) {
            const size_t into = i % 4800;
            if (i >= 4800) EXPECT(into <= 2400 + 1);
            late += into > 0;
        }
    }
    EXPECT(late > 10);
}

static void xDistribution() {
    TEST("Spread 0 gives the constant; 100 % spreads beyond ±0.5; Bias moves the mean");
    RecallParams p;
    p.xSpread = 0.0f;
    p.xSteps = 0.5f;
    for (int k = 0; k < 100; ++k) EXPECT_NEAR(RecallDsp::shapeX((float)uniforms(k)[0], 0.3f, 0.8f, p), 0.0f, 1e-6);
    p.xSpread = 1.0f;
    int wide = 0;
    double mean = 0.0;
    for (int k = 0; k < 10000; ++k) {
        const auto u = uniforms(k);
        const float v = RecallDsp::shapeX(u[0], u[1], u[2], p);
        wide += std::fabs(v) > 0.5f;
        mean += v;
    }
    EXPECT(wide > 5000);
    p.xBias = 0.8f;
    double up = 0.0;
    for (int k = 0; k < 10000; ++k) {
        const auto u = uniforms(k);
        up += RecallDsp::shapeX(u[0], u[1], u[2], p);
    }
    EXPECT(up / 10000.0 > mean / 10000.0 + 0.2);
}

static void steps() {
    TEST("Steps 0 %: continuous; 50 %: stepped");
    RecallParams p;
    p.xSteps = 0.0f;
    const auto smooth = render(p, 48000, clocked(4800));
    double maxJump = 0.0;
    for (size_t i = 4801; i < smooth.size(); ++i) maxJump = std::max(maxJump, (double)std::fabs(smooth[i].x[0] - smooth[i - 1].x[0]));
    EXPECT(maxJump < 0.01);
    p.xSteps = 0.5f;
    const auto stepped = render(p, 48000, clocked(4800));
    int changes = 0;
    for (size_t i = 1; i < stepped.size(); ++i) changes += stepped[i].x[0] != stepped[i - 1].x[0];
    EXPECT(changes <= 10);
    TEST("quantized values are in the scale; 100 % only roots");
    p.xRange = patch::RecallXRange::Wide;
    p.root = 2;
    for (float s : {0.6f, 0.8f, 0.9f, 1.0f}) {
        p.xSteps = s;
        const uint16_t mask = RecallDsp::thinnedScale(p.scale, s);
        for (int k = 0; k < 2000; ++k) {
            const auto u = uniforms(k);
            const float v = RecallDsp::shapeX(u[0], u[1], u[2], p);
            const int semis = (int)std::lround(v * 12.0f);
            EXPECT(std::fabs(v * 12.0f - (float)semis) < 1e-4f);
            EXPECT(dsp::inScale(p.scale, semis - 2));
            EXPECT(dsp::inScale(mask, semis - 2));
            if (s == 1.0f) EXPECT(((semis - 2) % 12 + 12) % 12 == 0);
        }
    }
    TEST("thinning order for seven notes: 2nd, 6th, 4th, 7th, 3rd, 5th");
    const uint16_t major = dsp::scales()[1].mask;
    EXPECT(RecallDsp::thinnedScale(major, 0.70) == major);
    EXPECT(RecallDsp::thinnedScale(major, 0.75) == (major & ~(1u << 2)));
    EXPECT(RecallDsp::thinnedScale(major, 1.0) == 1u);
}

static void recallRings() {
    TEST("Recall 100 % repeats the last Loop decisions exactly");
    RecallParams p;
    p.xLoop = 6;
    p.xRecall = 0.0f;
    RecallDsp d;
    d.prepare(kSr);
    render(p, 4800 * 20, clocked(4800), &d);
    p.xRecall = 1.0f;
    const auto r = render(p, 4800 * 30, [](int i, RecallInput& in) {
        in.clockPatched = true;
        in.clock = i % 4800 == 0 ? 1.0f : 0.0f;
    }, &d);
    for (int t = 6; t < 30; ++t) EXPECT(r[(size_t)(t * 4800 + 10)].x == r[(size_t)((t - 6) * 4800 + 10)].x);
    TEST("Recall 0 % never repeats from the ring");
    p.xRecall = 0.0f;
    const auto a = render(p, 4800 * 30, clocked(4800));
    int repeats = 0;
    for (int t = 6; t < 30; ++t) repeats += a[(size_t)(t * 4800 + 10)].x == a[(size_t)((t - 6) * 4800 + 10)].x;
    EXPECT(repeats == 0);
    TEST("re-shaping a locked loop keeps the order of the values");
    RecallParams q = p;
    q.xSpread = 0.2f;
    RecallParams w = p;
    w.xSpread = 0.45f;
    const auto lo = render(q, 4800 * 20, clocked(4800)), hi = render(w, 4800 * 20, clocked(4800));
    for (int t = 1; t < 20; ++t) {
        const size_t i = (size_t)(t * 4800 + 10), j = (size_t)((t - 1) * 4800 + 10);
        EXPECT((lo[i].x[0] < lo[j].x[0]) == (hi[i].x[0] < hi[j].x[0]));
    }
}

static void sorted() {
    TEST("Sorted: X1 ≤ X2 ≤ X3");
    RecallParams p;
    p.sorted = true;
    p.xSteps = 0.0f;
    const auto r = render(p, 48000, clocked(1000));
    for (const auto& f : r) EXPECT(f.x[0] <= f.x[1] + 1e-6f && f.x[1] <= f.x[2] + 1e-6f);
}

static void captured() {
    TEST("captured loops play identically from any start");
    RecallCaptures cap;
    cap.t.use = cap.x.use = true;
    cap.t.length = 3;  // shorter than the loop: the rest is padded from the seed
    cap.x.length = 8;
    for (int s = 0; s < 8; ++s) {
        for (int j = 0; j < 9; ++j) cap.x.values[(size_t)s][(size_t)j] = (float)dsp::uniform01(5, (uint64_t)s, (uint64_t)j);
        cap.x.count[(size_t)s] = 9;
        cap.t.values[(size_t)s] = {0.1f * (float)s, 0.9f, 0.5f, 0.5f};
        cap.t.count[(size_t)s] = s < 3 ? 4 : 0;
    }
    RecallParams p;
    p.captured = &cap;
    p.tRecall = 0.3f;
    const auto a = render(p, (int)(kSr * 4), playing(0.0));
    const auto b = render(p, (int)(kSr * 2), playing(4.0));  // 2 s later
    bool same = true;
    for (size_t i = 0; i < b.size(); ++i) same = same && b[i].x == a[i + (size_t)(kSr * 2)].x && b[i].t1 == a[i + (size_t)(kSr * 2)].t1;
    EXPECT(same);
}

static void ranges() {
    TEST("outputs stay finite and in range at extreme settings");
    RecallParams p;
    p.xRange = patch::RecallXRange::Wide;
    p.xSpread = 1.0f;
    p.xBias = 1.0f;
    p.xSteps = 0.2f;
    p.tMode = RecallTMode::Ratchet;
    p.tBias = 1.0f;
    p.rateHz = 40.0f;
    p.sync = 0;
    p.xSource = RecallXSource::T1;
    const auto r = render(p, 48000 * 3, [](int, RecallInput&) {});
    for (const auto& f : r)
        for (float x : f.x) EXPECT(std::isfinite(x) && std::fabs(x) <= 2.0f + 1e-6f);
}

int main() {
    grid();
    tModes();
    ratchets();
    jitter();
    xDistribution();
    steps();
    recallRings();
    sorted();
    captured();
    ranges();
    return bleep::test::finish("recall");
}
