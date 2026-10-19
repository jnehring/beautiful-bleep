// SPDX-License-Identifier: GPL-3.0-or-later
#include "BenderDsp.h"
#include "dsp/tests/TestUtil.h"

#include <memory>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

struct Run {
    std::unique_ptr<BenderDsp> dsp = std::make_unique<BenderDsp>();
    BenderParams p;
    BenderInput in;
    BenderFrame f;
    std::vector<float> l, active, segment;
    Run() {
        dsp->prepare(kSr);
        in.running = true;
        in.bpm = 120.0;
        p.bendSteps = BendFree;
    }
    template <class Src>
    void render(int n, Src&& src) {
        const double ppqPerSample = in.bpm / 60.0 / kSr;
        for (int i = 0; i < n; ++i) {
            in.l = in.r = src(i);
            dsp->tick(p, in, f);
            if (in.running) in.ppq += ppqPerSample;
            l.push_back(f.l);
            active.push_back(f.active);
            segment.push_back(f.segment);
        }
    }
};

static float sine(int i) { return 0.5f * (float)std::sin(2.0 * kPi * 1000.0 * i / kSr); }

static void syncBoundaries() {
    TEST("transport sync: segments on the grid, also after a loop jump");
    for (double beats : {0.25, 0.5, 1.0 / 6.0}) {
        Run r;
        r.p.syncBeats = beats;
        r.p.chance = 0.0f;
        r.render(48000, [](int) { return 0.0f; });
        const double len = beats * 0.5 * kSr;
        int count = 0, bad = 0;
        for (int i = 0; i < 48000; ++i)
            if (r.segment[(size_t)i] > 0.5f) {
                ++count;
                const double k = i / len;
                if (std::fabs(k - std::round(k)) * len > 1.0) ++bad;
            }
        EXPECT(bad == 0);
        EXPECT(std::abs(count - (int)std::ceil(48000 / len)) <= 1);
        r.in.ppq = 0.0;  // loop jump back to the start: a new segment at once
        r.segment.clear();
        r.render(10, [](int) { return 0.0f; });
        EXPECT(r.segment[0] > 0.5f);
    }
}

static std::vector<int> decisions(uint32_t seed, float chance) {
    Run r;
    r.p.syncBeats = 0.25;
    r.p.chance = chance;
    r.p.repeats = 1;
    r.p.seed = seed;
    r.render(48000 * 4, sine);
    std::vector<int> d;
    for (size_t i = 0; i < r.l.size(); ++i)
        if (r.segment[i] > 0.5f) d.push_back(r.active[i] > 0.5f ? 1 : 0);
    return d;
}

static void determinism() {
    TEST("same seed, same glitches; Chance only adds glitches");
    Run a, b;
    for (Run* r : {&a, &b}) {
        r->p.syncBeats = 0.25;
        r->p.chance = 0.5f;
        r->p.bendVar = 0.6f;
        r->p.slice = 0.3f;
        r->p.corrupt = 0.5f;
        r->p.mode = BenderShuffle;
        r->render(48000 * 2, sine);
    }
    EXPECT(a.l == b.l);
    const auto s1 = decisions(1, 0.5f), s2 = decisions(2, 0.5f);
    EXPECT(s1 != s2);
    const auto lo = decisions(5, 0.3f), hi = decisions(5, 0.6f);
    int glitched = 0;
    for (size_t i = 0; i < lo.size() && i < hi.size(); ++i) {
        if (lo[i]) EXPECT(hi[i] == 1);
        glitched += lo[i];
    }
    EXPECT(glitched > 5);
    for (int64_t k = 0; k < 1000; ++k)
        if (bender::glitchDraw(9, k, 0.3f)) EXPECT(bender::glitchDraw(9, k, 0.6f));
}

static void bendPitch() {
    TEST("bend 0.5 halves the pitch; −1 plays a ramp backwards");
    Run r;
    r.p.syncBeats = 0.5;  // 12000-sample segments
    r.p.chance = 0.0f;    // segment 0 passes (its glitch would repeat silence)
    r.p.repeats = 16;
    r.p.bend = 0.5f;
    r.render(12000, sine);
    r.p.chance = 1.0f;
    r.render(36000, [](int i) { return sine(12000 + i); });
    const std::vector<float> part(r.l.begin() + 13000, r.l.begin() + 23000);
    EXPECT_NEAR(bleep::test::zeroCrossingHz(part, kSr), 500.0, 5.0);

    Run b;
    b.p.syncBeats = 0.5;
    b.p.chance = 0.0f;
    b.p.repeats = 16;
    b.p.bend = -1.0f;
    b.p.edge = 0.0f;
    const auto ramp = [](int i) { return (float)(i % 12000) / 12000.0f; };
    b.render(12000, ramp);
    b.p.chance = 1.0f;
    b.render(36000, [&](int i) { return ramp(12000 + i); });
    int down = 0, up = 0;
    for (size_t i = 12002; i < 23990; ++i) (b.l[i] < b.l[i - 1] ? down : up)++;
    EXPECT(down > 11900 && up < 50);

    // Audio-rate Bend modulation: speed changes, the read position never jumps.
    Run m;
    m.p.syncBeats = 0.5;
    m.p.repeats = 16;
    m.p.edge = 1.0f;
    double maxStep = 0.0;
    for (int i = 0; i < 48000; ++i) {
        m.p.chance = i < 12000 ? 0.0f : 1.0f;
        m.p.bend = 1.0f + 0.5f * (float)std::sin(i * 0.05);
        m.in.l = m.in.r = 0.5f * (float)std::sin(i * 0.01);
        m.dsp->tick(m.p, m.in, m.f);
        m.in.ppq += 1.0 / 24000.0;
        if (i > 12500) maxStep = std::max(maxStep, (double)std::fabs(m.f.l - (m.l.empty() ? 0.0f : m.l.back())));
        m.l.push_back(m.f.l);
    }
    EXPECT(maxStep < 0.03);
}

static void sliceLengths() {
    TEST("slice: (1 − Slice)^r free, powers of two synced");
    const double len = 12000.0;
    for (int r = 0; r < 4; ++r) EXPECT_NEAR(bender::repetitionLength(len, 0.3f, r, false, kSr), len * std::pow(1.0 - 0.3f, r), 1e-3);
    EXPECT_NEAR(bender::repetitionLength(len, 0.3f, 2, true, kSr), 6000.0, 1e-6);  // 0.49 → ½
    EXPECT_NEAR(bender::repetitionLength(len, 0.6f, 2, true, kSr), 1500.0, 1e-6);  // 0.16 → ⅛
    EXPECT_NEAR(bender::repetitionLength(len, 0.9f, 9, false, kSr), 0.003 * kSr, 1e-6);  // floor at 3 ms
}

static void transparentAtZero() {
    TEST("corrupt 0 %: Crush, Fold, Dropout pass bit-exact");
    std::vector<float> ref;
    for (int mode : {BenderCrush, BenderFold, BenderDropout}) {
        Run r;
        r.p.syncBeats = 0.25;
        r.p.chance = 0.0f;
        r.p.always = true;
        r.p.corrupt = 0.0f;
        r.p.mode = mode;
        r.render(24000, sine);
        bool same = true;
        for (int i = 0; i < 24000; ++i) same = same && r.l[(size_t)i] == sine(i);
        EXPECT(same);
        Run g;  // and inside a glitch: all three modes give the same output
        g.p.syncBeats = 0.25;
        g.p.chance = 1.0f;
        g.p.corrupt = 0.0f;
        g.p.mode = mode;
        g.render(24000, sine);
        if (ref.empty()) ref = g.l;
        else EXPECT(ref == g.l);
    }
}

static void edges() {
    TEST("edge: crossfaded transitions; Edge 0 switches on the sample");
    Run r;
    r.p.syncBeats = 0.25;
    r.p.chance = 0.5f;
    r.p.repeats = 2;
    r.p.bend = 1.5f;
    r.p.edge = 1.0f;
    r.render(48000 * 2, [](int i) { return 0.5f * (float)std::sin(2.0 * kPi * 200.0 * i / kSr); });
    double maxStep = 0.0;
    for (size_t i = 1; i < r.l.size(); ++i) maxStep = std::max(maxStep, (double)std::fabs(r.l[i] - r.l[i - 1]));
    EXPECT(maxStep < 0.1);
    Run h;
    h.p.syncBeats = 0.25;
    h.p.chance = 1.0f;
    h.p.edge = 0.0f;
    h.render(7000, [](int i) { return i < 6000 ? 0.0f : 1.0f; });
    // Segment 1 starts at 6000 and repeats segment 0 (silence): the input step never shows.
    EXPECT(h.l[6000] == 0.0f && h.l[6001] == 0.0f);
}

static void freeze() {
    TEST("freeze holds the segment; release lands on a boundary");
    Run r;
    r.p.syncBeats = 0.25;
    r.p.chance = 0.0f;
    r.p.edge = 0.0f;
    r.render(30000, [](int i) { return (float)((i * 37) % 1000) / 1000.0f; });
    r.in.freeze = true;
    r.render(30000, [](int) { return 0.25f; });
    const size_t base = 30000;
    bool loops = true;  // the frozen output repeats every segment (6000 samples)
    for (size_t i = base + 6000; i < base + 24000; ++i) loops = loops && r.l[i] == r.l[i - 6000];
    EXPECT(loops);
    EXPECT(r.active.back() > 0.5f);
    r.in.freeze = false;
    r.l.clear();
    r.active.clear();
    r.segment.clear();
    r.render(14000, [](int) { return 0.25f; });
    int end = -1;
    for (size_t i = 0; i < r.active.size(); ++i)
        if (r.active[i] < 0.5f) {
            end = (int)i;
            break;
        }
    EXPECT(end >= 0 && r.segment[(size_t)end] > 0.5f);
}

static void transportStop() {
    TEST("transport stop mid-glitch finishes, then passes dry");
    Run r;
    r.p.syncBeats = 0.25;
    r.p.chance = 1.0f;
    r.p.repeats = 3;
    r.render(7000, sine);
    EXPECT(r.active.back() > 0.5f);
    r.p.chance = 0.0f;
    r.in.running = false;
    r.render(48000, sine);
    EXPECT(r.active.back() < 0.5f);
    bool dry = true;
    for (size_t i = r.l.size() - 1000; i < r.l.size(); ++i) dry = dry && r.l[i] == sine((int)i - 7000);
    EXPECT(dry);
}

int main() {
    syncBoundaries();
    determinism();
    bendPitch();
    sliceLengths();
    transparentAtZero();
    edges();
    freeze();
    transportStop();
    return bleep::test::finish("bender");
}
