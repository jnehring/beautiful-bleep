// SPDX-License-Identifier: GPL-3.0-or-later
// Recorder: what is recorded is what came in (sample for sample), the length limit, start by
// hand / on signal / by gate, the pre-roll, stop and clear, the done trigger, reading out
// while a new take starts (doc/specs/modules/recorder.md §8).
#include "RecorderDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <functional>
#include <vector>

using namespace bleep;
using patch::RecorderDsp;
using patch::RecorderFrame;
using patch::RecorderParams;

static constexpr double kSr = 8000.0;  // small, so the 120 s buffer stays modest
using Fn = std::function<double(int64_t)>;

struct Out {
    RecorderFrame last;
    int doneEdges = 0;
    bool sawRecording = false;
};

static Out run(RecorderDsp& d, const RecorderParams& p, int64_t from, int64_t count, const Fn& l, const Fn& gate = nullptr) {
    Out o;
    float prevDone = 0.0f;
    for (int64_t n = from; n < from + count; ++n) {
        const float x = (float)l(n);
        o.last = d.tick(p, x, -x, gate ? (float)gate(n) : 0.0f);
        if (o.last.done > 0.5f && prevDone < 0.5f) ++o.doneEdges;
        prevDone = o.last.done;
        o.sawRecording = o.sawRecording || o.last.recording > 0.5f;
    }
    return o;
}
static double ramp(int64_t n) { return (double)(n % 1000) / 2000.0 + 0.1; }
static double quiet(int64_t) { return 0.0; }

static void manualTake() {
    TEST("record by hand, stop, read back");
    RecorderDsp d;
    d.prepare(kSr);
    RecorderParams p;
    d.record();
    run(d, p, 0, 4000, ramp);
    EXPECT(d.state() == patch::RecRecording);
    d.stop();
    const auto o = run(d, p, 4000, 10, ramp);
    EXPECT(d.state() == patch::RecDone);
    EXPECT(d.length() == 4000);
    EXPECT(o.doneEdges == 1);
    bool same = true;
    for (int64_t n = 0; n < 4000; ++n) same = same && d.left()[n] == (float)ramp(n) && d.right()[n] == (float)-ramp(n);
    EXPECT(same);
}

static void limitEndsTake() {
    TEST("the limit ends the take");
    RecorderDsp d;
    d.prepare(kSr);
    RecorderParams p;
    p.limit = 2.0;
    d.record();
    const auto o = run(d, p, 0, (int64_t)(5 * kSr), ramp);
    EXPECT(d.state() == patch::RecDone);
    EXPECT(d.length() == (size_t)(2.0 * kSr));
    EXPECT(o.doneEdges == 1);
    EXPECT_NEAR(o.last.progress, 1.0, 1e-6);
}

static void signalStartWithPreroll() {
    TEST("armed start on signal keeps the pre-roll");
    RecorderDsp d;
    d.prepare(kSr);
    RecorderParams p;
    p.preroll = 0.1;  // 800 samples
    p.threshold = 0.3f;
    d.arm();
    // Quiet murmur at 0.05, then the signal passes 0.3 at sample 3000.
    auto sig = [](int64_t n) { return n < 3000 ? 0.05 : 0.5; };
    run(d, p, 0, 5000, sig);
    EXPECT(d.state() == patch::RecRecording);
    d.stop();
    run(d, p, 5000, 2, sig);
    // 800 samples of pre-roll, the trigger sample, and what followed until the stop (5000..5001 are after the stop).
    EXPECT(d.length() == 801 + (5000 - 3001));
    EXPECT_NEAR(d.left()[0], 0.05, 1e-6);
    EXPECT_NEAR(d.left()[799], 0.05, 1e-6);
    EXPECT_NEAR(d.left()[800], 0.5, 1e-6);  // the sample that crossed the threshold
}

static void armedWaitsInSilence() {
    TEST("armed does nothing without a signal, and by-hand mode ignores it");
    RecorderDsp d;
    d.prepare(kSr);
    RecorderParams p;
    d.arm();
    run(d, p, 0, 20000, quiet);
    EXPECT(d.state() == patch::RecArmed);
    p.autoStart = false;
    run(d, p, 20000, 100, [](int64_t) { return 0.9; });
    EXPECT(d.state() == patch::RecArmed);
    d.record();
    run(d, p, 20100, 10, [](int64_t) { return 0.9; });
    EXPECT(d.state() == patch::RecRecording);
}

static void gateControl() {
    TEST("gate starts and ends a take");
    RecorderDsp d;
    d.prepare(kSr);
    RecorderParams p;
    p.gateControl = true;
    auto gate = [](int64_t n) { return n >= 1000 && n < 3000 ? 1.0 : 0.0; };
    const auto o = run(d, p, 0, 5000, ramp, gate);
    EXPECT(o.sawRecording);
    EXPECT(d.state() == patch::RecDone);
    EXPECT(d.length() == 2000);
    EXPECT_NEAR(d.left()[0], ramp(1000), 1e-6);
}

static void newTakeReplacesOld() {
    TEST("a new take replaces the old one; clear empties");
    RecorderDsp d;
    d.prepare(kSr);
    RecorderParams p;
    d.record();
    run(d, p, 0, 100, ramp);
    d.stop();
    run(d, p, 100, 1, ramp);
    EXPECT(d.length() == 100);
    d.record();
    run(d, p, 0, 40, [](int64_t) { return 0.7; });
    d.stop();
    run(d, p, 40, 1, ramp);
    EXPECT(d.length() == 40);
    EXPECT_NEAR(d.left()[0], 0.7, 1e-6);
    d.clear();
    EXPECT(d.length() == 0);
    EXPECT(d.state() == patch::RecIdle);
}

static void clearIgnoredWhileRecording() {
    TEST("clear does not cut a running take");
    RecorderDsp d;
    d.prepare(kSr);
    RecorderParams p;
    d.record();
    run(d, p, 0, 100, ramp);
    d.clear();
    run(d, p, 100, 100, ramp);
    EXPECT(d.state() == patch::RecRecording);
}

static void readBlocksStart() {
    TEST("a take being read out is not overwritten");
    RecorderDsp d;
    d.prepare(kSr);
    RecorderParams p;
    d.record();
    run(d, p, 0, 100, ramp);
    d.stop();
    run(d, p, 100, 1, ramp);
    EXPECT(d.beginRead());
    d.record();
    run(d, p, 0, 50, [](int64_t) { return 0.9; });
    EXPECT(d.state() == patch::RecDone);
    EXPECT_NEAR(d.left()[0], ramp(0), 1e-6);
    d.endRead();
    d.record();
    run(d, p, 0, 5, [](int64_t) { return 0.9; });
    EXPECT(d.state() == patch::RecRecording);
}

static void cannotReadWhileRecording() {
    TEST("no read-out mid-take");
    RecorderDsp d;
    d.prepare(kSr);
    RecorderParams p;
    d.record();
    run(d, p, 0, 10, ramp);
    EXPECT(!d.beginRead());
}

static void peaksFill() {
    TEST("peak columns follow the take");
    RecorderDsp d;
    d.prepare(kSr);
    RecorderParams p;
    p.limit = 10.0;
    d.record();
    run(d, p, 0, (int64_t)(2 * kSr), [](int64_t n) { return n < 8000 ? 0.2 : 0.8; });
    EXPECT_NEAR(d.peak(0), 0.2, 1e-6);
    EXPECT_NEAR(d.peak(100), 0.8, 1e-6);  // 2 s of a 10 s limit is 102 columns
    EXPECT_NEAR(d.peak(300), 0.0, 1e-6);
    EXPECT_NEAR(d.peakSeconds(), 10.0, 1e-9);
}

int main() {
    manualTake();
    limitEndsTake();
    signalStartWithPreroll();
    armedWaitsInSilence();
    gateControl();
    newTakeReplacesOld();
    clearIgnoredWhileRecording();
    readBlocksStart();
    cannotReadWhileRecording();
    peaksFill();
    return test::finish("recorder");
}
