// SPDX-License-Identifier: MIT
// Segments (specs/modules/segments.md §8): the default ADSR, ramp curves,
// click-free retrigger, Jump vs Finish release, loops, Seg inputs, the song
// lock, and one segment gate at a time.
#include "SegmentsDsp.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <vector>

using namespace bleep;
using patch::SegmentsDsp;
using patch::SegmentsFrame;
using patch::SegmentsParams;
using patch::SegmentsTime;
using patch::SegmentTable;

static constexpr double kSr = 48000.0;

struct Run {
    std::vector<float> out, loop, end, active;
    std::vector<int> seg;
};
static Run run(const SegmentsParams& p, const SegmentTable& d, int64_t n, std::function<float(int64_t)> gate,
               std::function<float(int64_t, int)> segIn = nullptr) {
    SegmentsDsp dsp;
    dsp.prepare(kSr);
    Run r;
    SegmentsTime t;
    SegmentsFrame f;
    float ins[8];
    for (int64_t i = 0; i < n; ++i) {
        for (int k = 0; k < 8; ++k) ins[k] = segIn ? segIn(i, k) : 0.0f;
        dsp.tick(p, d, gate ? gate(i) : 0.0f, 1.0f, ins, t, f);
        r.out.push_back(f.out);
        r.loop.push_back(f.loop);
        r.end.push_back(f.end);
        r.active.push_back(f.active);
        r.seg.push_back(f.segment);
    }
    return r;
}
static std::vector<int64_t> pulses(const std::vector<float>& x) {
    std::vector<int64_t> at;
    for (size_t i = 0; i < x.size(); ++i)
        if (x[i] > 0.5f) at.push_back((int64_t)i);
    return at;
}
/// The last sample of each run of segment k.
static int64_t lastOf(const Run& r, int k) {
    int64_t at = -1;
    for (size_t i = 0; i < r.seg.size(); ++i)
        if (r.seg[i] == k) at = (int64_t)i;
    return at;
}

static void defaultAdsr() {
    TEST("segments: the default ADSR with a 1 s gate");
    const SegmentsParams p;
    const SegmentTable d = patch::defaultSegments();
    const Run r = run(p, d, 96000, [](int64_t i) { return i >= 100 && i < 100 + 48000 ? 1.0f : 0.0f; });
    // The sample a segment finishes on carries its end level (and already names the next one).
    EXPECT_NEAR(r.out[(size_t)lastOf(r, 0) + 1], 1.0, 1e-6);
    EXPECT_NEAR(r.out[(size_t)lastOf(r, 1) + 1], 0.7, 1e-6);
    EXPECT_NEAR(r.out[(size_t)lastOf(r, 2)], 0.7, 1e-6);  // the hold, until the gate falls
    EXPECT_NEAR(r.out[(size_t)lastOf(r, 3) + 1], 0.0, 1e-6);
    const auto ends = pulses(r.end);
    EXPECT(ends.size() == 1);
    if (!ends.empty()) EXPECT(std::llabs(ends[0] - (100 + 48000 + 19200)) <= 2);
    EXPECT(r.active[200] > 0.5f && r.active[90000] < 0.5f && r.active[50] < 0.5f);
}

static void curves() {
    TEST("segments: ramp curves at u = 0.5 (Function's curve), rising and falling");
    EXPECT_NEAR(SegmentsDsp::ramp(0.0f, 1.0f, 0.5, 0.0f), 0.5, 1e-6);
    EXPECT_NEAR(SegmentsDsp::ramp(0.0f, 1.0f, 0.5, 1.0f), 0.0625, 1e-6);
    EXPECT_NEAR(SegmentsDsp::ramp(0.0f, 1.0f, 0.5, -1.0f), 0.9375, 1e-6);
    // Falling: the curve on the distance travelled, so +1 drops fast first.
    EXPECT_NEAR(SegmentsDsp::ramp(1.0f, 0.0f, 0.5, 0.0f), 0.5, 1e-6);
    EXPECT_NEAR(SegmentsDsp::ramp(1.0f, 0.0f, 0.5, 1.0f), 0.0625, 1e-6);
    EXPECT_NEAR(SegmentsDsp::ramp(1.0f, 0.0f, 0.5, -1.0f), 0.9375, 1e-6);
    EXPECT_NEAR(SegmentsDsp::ramp(0.2f, -0.6f, 1.0, 0.7f), -0.6, 1e-6);
}

static void retrigger() {
    TEST("segments: a retrigger mid-release starts segment 1 from the current level");
    SegmentsParams p;
    p.time[0] = 0.05f;
    const SegmentTable d = patch::defaultSegments();
    // Gate 100 ms, release, retrigger 200 ms into the 400 ms release.
    const Run r = run(p, d, 48000, [](int64_t i) { return (i < 4800) || (i >= 4800 + 9600 && i < 4800 + 9600 + 2400) ? 1.0f : 0.0f; });
    float step = 0.0f;
    for (size_t i = 4800 + 9590; i < 4800 + 9620; ++i) step = std::max(step, std::fabs(r.out[i] - r.out[i - 1]));
    EXPECT(r.out[4800 + 9599] > 0.05f && r.out[4800 + 9599] < 0.6f);
    EXPECT(r.seg[4800 + 9600] == 0);
    EXPECT(step < 1.0f / 2400.0f + 1e-4f);  // the attack's own slope (50 ms to 1.0)
}

static void releaseModes() {
    TEST("segments: early gate-off in the attack, Jump vs Finish");
    SegmentsParams p;
    p.time[0] = 0.1f;  // a slow attack
    const SegmentTable d = patch::defaultSegments();
    auto gate = [](int64_t i) { return i < 1000 ? 1.0f : 0.0f; };
    const Run jump = run(p, d, 48000, gate);
    EXPECT(jump.seg[1001] == 3);  // straight to the release
    EXPECT(jump.out[1000] < 0.25f);
    p.finish = true;
    const Run fin = run(p, d, 48000, gate);
    EXPECT(fin.seg[1001] == 0);   // the attack plays on
    EXPECT_NEAR(fin.out[(size_t)lastOf(fin, 0) + 1], 1.0, 1e-6);
    EXPECT(lastOf(fin, 1) > 0 && lastOf(fin, 3) > lastOf(fin, 1));  // then the decay, the hold ends at once, the release
}

static void loops() {
    TEST("segments: a two-segment loop fires Loop every 20 ms; gate-off leaves it");
    SegmentsParams p;
    p.count = 3;
    p.time[0] = 0.01f;
    p.level[0] = 1.0f;
    p.time[1] = 0.01f;
    p.level[1] = 0.2f;
    p.time[2] = 0.05f;
    p.level[2] = 0.0f;
    SegmentTable d{};
    d[0].loop = d[1].loop = true;
    const Run r = run(p, d, 24000, [](int64_t i) { return i < 9600 ? 1.0f : 0.0f; });
    const auto at = pulses(r.loop);
    EXPECT(at.size() >= 9);
    for (size_t k = 1; k < at.size(); ++k) EXPECT(std::llabs(at[k] - at[k - 1] - 960) <= 1);
    EXPECT(r.seg[9601] == 2);  // into the release at gate-off
    EXPECT(pulses(r.end).size() == 1);
    // Free run: loops on its own, no gate.
    p.freeRun = true;
    const Run f = run(p, d, 9600, nullptr);
    EXPECT(pulses(f.loop).size() >= 9 && pulses(f.end).empty());
    // A Ramp looping alone is a saw (it restarts from the level before it).
    SegmentsParams s;
    s.freeRun = true;
    s.count = 1;
    s.time[0] = 0.01f;
    s.level[0] = 1.0f;
    SegmentTable one{};
    one[0].loop = true;
    const Run saw = run(s, one, 4800, nullptr);
    EXPECT(saw.out[2400 + 479] > 0.99f && saw.out[2400 + 480] < 0.01f);
}

static void segInputs() {
    TEST("segments: Hold Wait Trigger ends on the Seg pulse; Jump lands on segment n");
    SegmentsParams p;
    p.count = 3;
    SegmentTable d{};
    d[1].type = patch::SegHold;
    d[1].wait = patch::WaitTrigger;
    p.time[0] = 0.01f;
    const Run r = run(p, d, 24000, [](int64_t i) { return i >= 10 && i < 20000 ? 1.0f : 0.0f; },
                      [](int64_t i, int k) { return k == 1 && i == 5000 ? 1.0f : 0.0f; });
    EXPECT(r.seg[4999] == 1 && r.seg[5000] == 2);
    d[2].segIn = patch::SegInJump;
    const Run j = run(p, d, 24000, [](int64_t i) { return i >= 10 && i < 20000 ? 1.0f : 0.0f; },
                      [](int64_t i, int k) { return k == 2 && i == 200 ? 1.0f : 0.0f; });
    EXPECT(j.seg[199] == 0 && j.seg[200] == 2);
    EXPECT(std::fabs(j.out[200] - j.out[199]) < 0.01f);  // from the current level
}

static void lockedToSong() {
    TEST("segments: Sync + Free + transport: the same value at bar 5 on two renders and after a loop jump");
    SegmentsParams p;
    p.freeRun = true;
    p.sync = true;
    p.count = 3;
    p.level[0] = 0.5f;
    p.level[1] = 1.0f;
    p.level[2] = -0.5f;
    p.shape[1] = 0.6f;
    SegmentTable d{};
    d[0].sync = 8;   // 1/2: an intro
    d[1].sync = 11;  // 1/4
    d[2].sync = 14;  // 1/8
    d[1].loop = d[2].loop = true;
    auto render = [&](double from, double to, SegmentsDsp& dsp, bool start) {
        SegmentsTime t;
        t.running = true;
        SegmentsFrame f;
        const float none[8] = {};
        std::vector<float> v;
        for (double ppq = from; ppq < to; ppq += 2.0 / kSr) {
            t.ppq = ppq;
            t.started = start && ppq == from;
            dsp.tick(p, d, 0.0f, 1.0f, none, t, f);
            v.push_back(f.out);
        }
        return v;
    };
    SegmentsDsp a, b;
    a.prepare(kSr);
    b.prepare(kSr);
    const auto ra = render(0.0, 20.0, a, true), rb = render(0.0, 20.0, b, true);
    EXPECT(ra == rb);
    // Loop jump: from bar 5 + a bit back to bar 4, and on to bar 5 again.
    const auto again = render(12.0, 16.5, a, false);
    const size_t bar5 = (size_t)std::llround(16.0 * kSr / 2.0);
    const size_t inAgain = (size_t)std::llround(4.0 * kSr / 2.0);
    EXPECT(std::fabs(again[inAgain] - ra[bar5]) < 1e-6f);
    // Intro 2 beats, then the 1.5-beat loop anchored at beat 2: at beat 16 it is
    // 0.5 beats into a later pass, half way up segment 2 (from segment 3's −0.5).
    EXPECT_NEAR(ra[bar5], SegmentsDsp::ramp(-0.5f, 1.0f, 0.5, 0.6f), 1e-4);
}

static void oneGate() {
    TEST("segments: exactly one segment gate at a time while running");
    SegmentsParams p;
    p.count = 5;
    SegmentTable d{};
    d[1].loop = d[2].loop = d[3].loop = true;
    for (int k = 0; k < 5; ++k) p.time[k] = 0.003f * (k + 1);
    const Run r = run(p, d, 48000, [](int64_t i) { return i >= 100 && i < 30000 ? 1.0f : 0.0f; });
    for (size_t i = 0; i < r.seg.size(); ++i) {
        EXPECT((r.seg[i] >= 0) == (r.active[i] > 0.5f));
        EXPECT(r.seg[i] < 5);
    }
    // Count lowered while a higher segment runs: the chain goes to its release (or ends).
    SegmentsDsp dsp;
    dsp.prepare(kSr);
    SegmentsTime t;
    SegmentsFrame f;
    const float none[8] = {};
    SegmentsParams q;
    q.count = 4;
    const SegmentTable adsr = patch::defaultSegments();
    for (int i = 0; i < 48000; ++i) dsp.tick(q, adsr, 1.0f, 1.0f, none, t, f);
    EXPECT(f.segment == 2);  // holding
    q.count = 2;
    dsp.tick(q, adsr, 1.0f, 1.0f, none, t, f);
    EXPECT(f.segment == -1 && f.end > 0.5f);
}

int main() {
    defaultAdsr();
    curves();
    retrigger();
    releaseModes();
    loops();
    segInputs();
    lockedToSong();
    oneGate();
    return bleep::test::finish("segments");
}
