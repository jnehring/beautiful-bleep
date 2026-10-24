// SPDX-License-Identifier: GPL-3.0-only
// Monitor: the event log (order, wrap-around, packing), held notes, CV range and
// note name, gate state, count, length, rate and duty (doc/specs/modules/monitor.md §8).
#include "MonitorDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <cstdint>

using namespace bleep;
using namespace bleep::patch;

static constexpr double kSr = 48000.0;

static void logKeepsOrderAndData() {
    TEST("log order and packing");
    MidiLog log;
    log.push(monitorEvent(kMonNoteOn, 2, 64, 1.0f));
    log.push(monitorEvent(kMonCc, 15, 74, 0.5f));
    log.push(monitorEvent(kMonBend, 0, 0, -1.0f));
    log.push(monitorEvent(kMonBend, 0, 0, 1.0f));
    log.push(monitorEvent(kMonProgram, 9, 33, 0.0f));
    log.push(monitorEvent(kMonSystem, 0, 0xf8, 0.0f));
    uint32_t total = 0;
    const auto e = log.latest(10, total);
    EXPECT(total == 6 && e.size() == 6);
    EXPECT(e[0].type == kMonNoteOn && e[0].channel == 2 && e[0].a == 64 && e[0].b == 127);
    EXPECT(e[1].type == kMonCc && e[1].channel == 15 && e[1].a == 74 && e[1].b == 64);
    EXPECT(e[2].b == -8192);
    EXPECT(e[3].b == 8191);  // +1 clamps to the largest 14-bit bend
    EXPECT(e[4].type == kMonProgram && e[4].a == 33 && e[4].channel == 9);
    EXPECT(e[5].type == kMonSystem && e[5].a == 0xf8);
    const auto two = log.latest(2, total);  // the newest two, oldest first
    EXPECT(two.size() == 2 && two[0].type == kMonProgram && two[1].type == kMonSystem);
}

static void logWraps() {
    TEST("log wrap-around");
    MidiLog log;
    for (int i = 0; i < 1000; ++i) log.push(monitorEvent(kMonCc, 0, i & 127, 0.0f));
    uint32_t total = 0;
    const auto e = log.latest(kMonitorShown, total);
    EXPECT(total == 1000 && (int)e.size() == kMonitorShown);
    for (size_t k = 0; k < e.size(); ++k) EXPECT(e[k].a == (int)((1000 - kMonitorShown + (int)k) & 127));
    log.reset();
    EXPECT(log.latest(5, total).empty() && total == 0);
}

static void heldNotes() {
    TEST("held notes");
    HeldNotes h;
    h.on(0); h.on(60); h.on(61); h.on(127);
    EXPECT(h.held(0) && h.held(60) && h.held(61) && h.held(127) && !h.held(62) && h.count() == 4);
    h.off(60); h.off(60);
    EXPECT(!h.held(60) && h.held(61) && h.count() == 3);
    h.on(-1); h.on(128); h.off(300);  // out of range: ignored
    EXPECT(h.count() == 3 && !h.held(-1) && !h.held(128));
    h.reset();
    EXPECT(h.count() == 0);
}

static void cvRange() {
    TEST("cv range");
    CvStats s;
    float lo, hi;
    s.takeRange(lo, hi);
    EXPECT(lo == 0.0f && hi == 0.0f);
    for (float x : {0.2f, -0.7f, 0.9f, 0.1f}) s.tick(x);
    s.takeRange(lo, hi);
    EXPECT(lo == -0.7f && hi == 0.9f && s.last == 0.1f);
    s.takeRange(lo, hi);  // nothing new: the range collapses to the current value
    EXPECT(lo == 0.1f && hi == 0.1f);
    s.tick(0.05f);
    s.takeRange(lo, hi);
    EXPECT(lo == 0.05f && hi == 0.1f);
}

static void cvNote() {
    TEST("cv to note name");
    int cents = 0;
    EXPECT(cvToMidiNote(0.0f, cents) == 60 && cents == 0);
    EXPECT(cvToMidiNote(1.0f, cents) == 72 && cents == 0);
    EXPECT(cvToMidiNote(-1.0f, cents) == 48 && cents == 0);
    EXPECT(cvToMidiNote(9.0f / 12.0f, cents) == 69 && cents == 0);                // A4
    EXPECT(cvToMidiNote(9.25f / 12.0f, cents) == 69 && cents == 25);              // 25 cents sharp
    EXPECT(cvToMidiNote(8.75f / 12.0f, cents) == 69 && cents == -25);
}

/// Runs the gate for `seconds` with `high` for the first `highSeconds` of every `period`.
static void runGate(GateStats& g, double seconds, double period, double highSeconds) {
    const int n = (int)(seconds * kSr);
    for (int i = 0; i < n; ++i) g.tick(std::fmod((double)i / kSr, period) < highSeconds ? 1.0f : 0.0f);
}

static void gateTimings() {
    TEST("gate count, length, rate, duty");
    GateStats g;
    g.prepare(kSr);
    runGate(g, 4.0, 0.25, 0.05);  // 4 Hz, 20 % duty
    EXPECT(g.count() == 16);
    EXPECT_NEAR(g.rateHz(), 4.0, 0.01);
    EXPECT_NEAR(g.length(), 0.05, 0.0005);
    EXPECT_NEAR(g.duty(), 0.2, 0.03);
    EXPECT(g.takeAnyHigh());
}

static void gateTrigger() {
    TEST("one-sample trigger is seen");
    GateStats g;
    g.prepare(kSr);
    g.tick(0.0f);
    g.tick(1.0f);
    g.tick(0.0f);
    for (int i = 0; i < 100; ++i) g.tick(0.0f);
    EXPECT(g.count() == 1 && !g.high());
    EXPECT(g.takeAnyHigh());   // the lamp still lights
    EXPECT(!g.takeAnyHigh());  // and only once
    EXPECT_NEAR(g.length(), 1.0 / kSr, 1e-9);
}

static void gateGoesQuiet() {
    TEST("rate drops to 0 when the gate stops");
    GateStats g;
    g.prepare(kSr);
    runGate(g, 2.0, 0.5, 0.1);
    EXPECT(g.rateHz() > 1.9);
    for (int i = 0; i < (int)(3.0 * kSr); ++i) g.tick(0.0f);
    EXPECT(g.rateHz() == 0.0f);
    g.reset();
    EXPECT(g.count() == 0 && g.length() == 0.0f);
}

static void gateHeldHigh() {
    TEST("a held gate reports its running length");
    GateStats g;
    g.prepare(kSr);
    for (int i = 0; i < (int)(1.5 * kSr); ++i) g.tick(1.0f);
    EXPECT(g.high() && g.count() == 1);
    EXPECT_NEAR(g.length(), 1.5, 0.001);
    EXPECT_NEAR(g.duty(), 1.0, 0.25);
    EXPECT(g.rateHz() == 0.0f);  // one edge is no rate
}

int main() {
    logKeepsOrderAndData();
    logWraps();
    heldNotes();
    cvRange();
    cvNote();
    gateTimings();
    gateTrigger();
    gateGoesQuiet();
    gateHeldHigh();
    return bleep::test::finish("monitor");
}
