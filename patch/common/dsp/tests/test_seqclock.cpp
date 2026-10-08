// SPDX-License-Identifier: MIT
// SeqClock.h and the note values in Tempo.h: transport steps for straight,
// dotted and triplet rates (also after a loop jump), Reset, stop, swing,
// Clock mode timing, gate lengths and ClockRatio.
#include "dsp/SeqClock.h"
#include "dsp/tests/TestUtil.h"

#include <cstdlib>
#include <functional>
#include <set>
#include <string>
#include <vector>

using namespace bleep::dsp;

namespace {

struct Ev {
    int64_t at;
    SeqClockEvent e;
};

/// Runs a clock for `n` samples at 48 kHz; `drive(i, in)` sets the input.
std::vector<Ev> run(SeqClock& c, int64_t n, const std::function<void(int64_t, SeqClockInput&)>& drive) {
    std::vector<Ev> out;
    for (int64_t i = 0; i < n; ++i) {
        SeqClockInput in;
        drive(i, in);
        c.tick(in, [&](const SeqClockEvent& e) { out.push_back({i, e}); });
    }
    return out;
}
std::vector<Ev> steps(const std::vector<Ev>& ev) {
    std::vector<Ev> s;
    for (const auto& e : ev)
        if (e.e.type == SeqClockEvent::Step) s.push_back(e);
    return s;
}

SeqClock fresh() {
    SeqClock c;
    c.prepare(48000.0);
    c.reset();
    return c;
}

}  // namespace

static void noteValueTable() {
    TEST("note values");
    std::set<std::string> names;
    for (const auto& v : noteValues()) names.insert(v.name);
    EXPECT((int)names.size() == kNumNoteValues);
    // Longest first, grouped per note value as dotted, straight, triplet.
    for (int i = 1; i < kNumNoteValues; ++i) {
        const auto &a = noteValues()[(size_t)i - 1], &b = noteValues()[(size_t)i];
        if (b.feel == NoteFeel::Dotted) EXPECT(b.beats < (a.feel == NoteFeel::Triplet ? a.beats * 1.5 : a.beats));
        else EXPECT(b.beats < a.beats);
    }
    EXPECT(noteValueBeats(noteValueIndex("16 bars")) == 64.0);
    EXPECT(noteValueBeats(noteValueIndex("1/16")) == 0.25);
    EXPECT(noteValueBeats(noteValueIndex("1/8.")) == 0.75);
    EXPECT(noteValueBeats(noteValueIndex("1/64")) == 0.0625);
    EXPECT_NEAR(noteValueBeats(noteValueIndex("1/4T")), 2.0 / 3.0, 1e-12);
    EXPECT_NEAR(noteValueBeats(noteValueIndex("1/64T")), 1.0 / 24.0, 1e-12);
    EXPECT(noteValueIndex("1/3") == -1);
    // Dotted = 1.5 × straight, triplet = 2/3 × straight.
    for (const char* s : {"1/1", "1/2", "1/4", "1/8", "1/16", "1/32", "1/64"}) {
        const double b = noteValueBeats(noteValueIndex(s));
        EXPECT_NEAR(noteValueBeats(noteValueIndex((std::string(s) + ".").c_str())), 1.5 * b, 1e-12);
        EXPECT_NEAR(noteValueBeats(noteValueIndex((std::string(s) + "T").c_str())), b * 2.0 / 3.0, 1e-12);
        EXPECT(noteValues()[(size_t)noteValueIndex((std::string(s) + "T").c_str())].feel == NoteFeel::Triplet);
    }
    // The Step Sequencer's list, in its order.
    const char* seq[kNumSequencerRates] = {"1/1",  "1/2",  "1/4.",  "1/4",  "1/4T",  "1/8.", "1/8",
                                           "1/8T", "1/16.", "1/16", "1/16T", "1/32.", "1/32", "1/32T"};
    for (int i = 0; i < kNumSequencerRates; ++i) EXPECT(std::string(sequencerRate(i).name) == seq[i]);
    EXPECT_NEAR(sequencerRateBeats(99), 1.0 / 12.0, 1e-15);  // clamped to 1/32T
    EXPECT(sequencerRateBeats(-3) == 4.0);
    EXPECT(beatsToSamples(1.0, 120.0, 48000.0) == 24000.0);
    EXPECT(beatsToSeconds(4.0, 0.0) == 240.0);  // bpm floored at 1
    EXPECT(barsToBeats(16.0) == 64.0);
    // The old sync list is unchanged.
    EXPECT(syncNames().size() == 10 && syncBeats(2) == 0.25 && syncBeats(9) == 32.0 && syncBeats(0) == 0.0);
}

static void transportRates() {
    TEST("transport rates");
    for (const char* name : {"1/16", "1/8.", "1/8T", "1/4T", "1/32.", "1/1"}) {
        const double beats = noteValueBeats(noteValueIndex(name));
        const double stepSamples = beats * 24000.0;  // 120 BPM
        SeqClock c = fresh();
        const auto s = steps(run(c, (int64_t)(stepSamples * 6.5), [&](int64_t i, SeqClockInput& in) {
            in.running = true;
            in.started = i == 0;
            in.ppq = (double)i / 24000.0;
            in.stepBeats = beats;
        }));
        EXPECT(s.size() == 7);
        for (size_t k = 0; k < s.size(); ++k) {
            EXPECT(s[k].e.n == (int64_t)k);
            EXPECT(std::llabs(s[k].at - (int64_t)std::ceil(stepSamples * (double)k - 1e-6)) <= 1);
            EXPECT_NEAR(s[k].e.stepSamples, stepSamples, 1e-6);
            EXPECT_NEAR(s[k].e.durationSamples, stepSamples, 1e-6);
        }
    }
}

static void transportJump() {
    TEST("transport jump");
    for (const char* name : {"1/16", "1/8.", "1/8T"}) {
        const double beats = noteValueBeats(noteValueIndex(name));
        SeqClock c = fresh();
        // Play from 3.3 quarters, jump back to 1.1 quarters at sample 20000.
        const int64_t jumpAt = 20000;
        auto ppqAt = [&](int64_t i) { return i < jumpAt ? 3.3 + (double)i / 24000.0 : 1.1 + (double)(i - jumpAt) / 24000.0; };
        const auto s = steps(run(c, 60000, [&](int64_t i, SeqClockInput& in) {
            in.running = true;
            in.started = i == 0;
            in.ppq = ppqAt(i);
            in.stepBeats = beats;
        }));
        EXPECT(!s.empty() && s[0].at == 0 && s[0].e.n == (int64_t)std::floor(3.3 / beats));
        size_t j = 0;
        while (j < s.size() && s[j].at < jumpAt) ++j;
        EXPECT(j < s.size() && s[j].at == jumpAt && s[j].e.n == (int64_t)std::floor(1.1 / beats));
        // After the jump every step lands on its grid boundary, as on the first pass.
        for (size_t k = j + 1; k < s.size(); ++k) {
            EXPECT(s[k].e.n == s[k - 1].e.n + 1);
            const double boundary = (double)s[k].e.n * beats;
            EXPECT(ppqAt(s[k].at) >= boundary - 1e-9 && ppqAt(s[k].at - 1) < boundary + 1e-9);
        }
    }
}

static void transportResetAndStop() {
    TEST("transport reset/stop");
    SeqClock c = fresh();
    const auto ev = run(c, 40000, [](int64_t i, SeqClockInput& in) {
        in.running = i < 30000;
        in.started = i == 0;
        in.ppq = (double)i / 24000.0;
        in.reset = i == 7000 ? 1.0f : 0.0f;  // inside step 1 (6000…12000)
    });
    // Steps 0, 1; Reset → release; the next boundary (12000) is step 0 again.
    EXPECT(ev.size() >= 6);
    EXPECT(ev[0].at == 0 && ev[0].e.type == SeqClockEvent::Step && ev[0].e.n == 0);
    EXPECT(ev[1].at == 6000 && ev[1].e.n == 1);
    EXPECT(ev[2].at == 7000 && ev[2].e.type == SeqClockEvent::Release && ev[2].e.reason == SeqClockEvent::Reset);
    EXPECT(ev[3].at == 12000 && ev[3].e.type == SeqClockEvent::Step && ev[3].e.n == 0);
    EXPECT(ev[4].at == 18000 && ev[4].e.n == 1);
    EXPECT(c.origin() == 2);
    const Ev& last = ev.back();
    EXPECT(last.at == 30000 && last.e.type == SeqClockEvent::Release && last.e.reason == SeqClockEvent::Stop);
    EXPECT(!c.transportActive());
    // Restarting the transport clears the Reset origin.
    SeqClockInput in;
    in.running = in.started = true;
    in.ppq = 0.5;
    std::vector<SeqClockEvent> again;
    c.tick(in, [&](const SeqClockEvent& e) { again.push_back(e); });
    EXPECT(again.size() == 1 && again[0].n == 2 && c.origin() == 0);
}

static void transportSwing() {
    TEST("transport swing");
    SeqClock c = fresh();
    const auto s = steps(run(c, 30000, [](int64_t i, SeqClockInput& in) {
        in.running = true;
        in.started = i == 0;
        in.ppq = (double)i / 24000.0;
        in.swing = 0.75f;
    }));
    // 1/16 = 6000 samples; odd steps start half a step late.
    EXPECT(s.size() == 5);
    const int64_t want[5] = {0, 9000, 12000, 21000, 24000};
    for (size_t k = 0; k < s.size() && k < 5; ++k) {
        EXPECT(std::llabs(s[k].at - want[k]) <= 1);
        EXPECT_NEAR(s[k].e.durationSamples, k % 2 ? 3000.0 : 9000.0, 1e-6);
    }
    EXPECT(swingAmount(0.5f) == 0.0f && swingAmount(0.75f) == 0.5f && swingAmount(0.9f) == 0.5f);
    EXPECT(transportStep(1.4, 1.0, 0, 0.5f) == 0 && transportStep(1.6, 1.0, 0, 0.5f) == 1);
    EXPECT(transportStep(-0.5, 1.0, 0, 0.0f) == -1);
}

static void clockMode() {
    TEST("clock mode");
    SeqClock c = fresh();
    // Pulses every 1000 samples; Reset alone at 3500, Reset with the pulse at 6000.
    const auto ev = run(c, 8000, [](int64_t i, SeqClockInput& in) {
        in.clocked = true;
        in.clock = i % 1000 == 0 ? 1.0f : 0.0f;
        in.reset = i == 3500 || i == 6000 ? 1.0f : 0.0f;
    });
    std::vector<int64_t> ns, at;
    for (const auto& e : steps(ev)) ns.push_back(e.e.n), at.push_back(e.at);
    EXPECT((ns == std::vector<int64_t>{0, 1, 2, 3, 0, 1, 0, 1}));
    EXPECT((at == std::vector<int64_t>{0, 1000, 2000, 3000, 4000, 5000, 6000, 7000}));
    const auto s = steps(ev);
    EXPECT(s[0].e.stepSamples == 6000.0);  // before two pulses: a 1/16 at 120 BPM
    EXPECT(s[1].e.stepSamples == 1000.0 && s[5].e.stepSamples == 1000.0);
    int releases = 0;
    for (const auto& e : ev)
        if (e.e.type == SeqClockEvent::Release) {
            ++releases;
            EXPECT(e.at == 3500 || e.at == 6000);
        }
    EXPECT(releases == 2);
    // A Reset and a pulse on one sample: the release comes before the step.
    size_t k = 0;
    while (k < ev.size() && ev[k].at < 6000) ++k;
    EXPECT(k + 1 < ev.size() && ev[k].e.type == SeqClockEvent::Release && ev[k + 1].at == 6000 &&
           ev[k + 1].e.type == SeqClockEvent::Step);
    EXPECT(c.periodSamples() == 1000);
}

static void clockSwing() {
    TEST("clock swing");
    SeqClock c = fresh();
    const auto s = steps(run(c, 6000, [](int64_t i, SeqClockInput& in) {
        in.clocked = true;
        in.clock = i % 1000 == 0 ? 1.0f : 0.0f;
        in.swing = 0.75f;
    }));
    std::vector<int64_t> at;
    for (const auto& e : s) at.push_back(e.at);
    EXPECT((at == std::vector<int64_t>{0, 1500, 2000, 3500, 4000, 5500}));
    EXPECT(s.size() == 6 && s[2].e.durationSamples == 1500.0 && s[3].e.durationSamples == 500.0);
    // A pulse that arrives before the swung step: the late step plays first, then the new one.
    SeqClock d = fresh();
    const auto late = steps(run(d, 1300, [](int64_t i, SeqClockInput& in) {
        in.clocked = true;
        in.clock = i == 0 || i == 1000 || i == 1200 ? 1.0f : 0.0f;
        in.swing = 0.75f;
    }));
    EXPECT(late.size() == 3);
    EXPECT(late.size() == 3 && late[1].at == 1200 && late[1].e.n == 1 && late[2].at == 1200 && late[2].e.n == 2);
}

static void gates() {
    TEST("gates");
    EXPECT(gateSamples(6000.0, 0.5f) == 3000);
    EXPECT(gateSamples(6000.0, 0.0f) == 60);
    EXPECT(gateSamples(6000.0, 2.0f) == 6000);
    EXPECT(gateSamples(10.0, 0.01f) == 1);
    EXPECT(swungDuration(1000.0, 2, 0.5f) == 1500.0 && swungDuration(1000.0, 3, 0.5f) == 500.0);
    GateTimer t;
    t.start(3);
    int high = 0;
    for (int i = 0; i < 10; ++i) {
        if (i > 0) t.advance();
        if (!t.expired()) ++high;
    }
    EXPECT(high == 3);
}

static void ratio() {
    TEST("clock ratio");
    // Transport: ÷3 of 1/16 steps fires every 3 steps; ×2 every half step.
    ClockRatio r;
    r.prepare(48000.0);
    r.reset();
    r.setRatio(3);
    std::vector<int64_t> at;
    for (int64_t i = 0; i < 40000; ++i)
        if (r.transport((double)i / 24000.0 / 0.25, i == 0)) at.push_back(i);
    EXPECT((at == std::vector<int64_t>{0, 18000, 36000}));
    r.setRatio(1, 2);
    at.clear();
    for (int64_t i = 0; i < 13000; ++i)
        if (r.transport((double)i / 24000.0 / 0.25, i == 0)) at.push_back(i);
    EXPECT((at == std::vector<int64_t>{0, 3000, 6000, 9000, 12000}));
    // A restart mid-cycle doesn't fire until the next cycle start.
    r.setRatio(4);
    EXPECT(!r.transport(1.5, true) && r.cycle() == 0);
    EXPECT_NEAR(r.phase(), 1.5 / 4.0, 1e-12);
    EXPECT(!r.transport(3.9, false) && r.transport(4.0, false));
    EXPECT(ClockRatio::cycleAt(-0.5, 2) == -1 && ClockRatio::cycleAt(7.9, 2, 1) == 3);

    // Clock: ÷2 fires on pulses 0, 2, 4; Reset makes the next pulse 0.
    ClockRatio c;
    c.prepare(48000.0);
    c.reset();
    c.setRatio(2);
    at.clear();
    for (int64_t i = 0; i < 1000; ++i)
        if (c.clock(i % 100 == 0, i == 250)) at.push_back(i);
    EXPECT((at == std::vector<int64_t>{0, 200, 300, 500, 700, 900}));
    // ×2: extra pulses halfway, from the measured period.
    ClockRatio m;
    m.prepare(48000.0);
    m.reset();
    m.setRatio(1, 2);
    at.clear();
    for (int64_t i = 0; i < 400; ++i)
        if (m.clock(i % 100 == 0, false)) at.push_back(i);
    EXPECT((at == std::vector<int64_t>{0, 100, 150, 200, 250, 300, 350}));
    EXPECT(m.cycleSamples() == 50.0 && m.periodSamples() == 100);
}

static void clockFallbackAndRestart() {
    TEST("clock fallback and restart");
    SeqClock c = fresh();
    c.setFallbackPeriod(2400);  // e.g. a 1/16 at 300 BPM
    const auto s = steps(run(c, 3000, [](int64_t i, SeqClockInput& in) {
        in.clocked = true;
        in.clock = i % 1000 == 0 ? 1.0f : 0.0f;
    }));
    EXPECT(!s.empty() && s[0].e.stepSamples == 2400.0);
    EXPECT(c.periodSamples() == 1000);
    c.setFallbackPeriod(5000);  // measured already: ignored
    EXPECT(c.periodSamples() == 1000);
    // restartCount: the count starts at 0 again, the measured period stays.
    c.restartCount();
    EXPECT(c.periodSamples() == 1000);
    const auto t = steps(run(c, 1500, [](int64_t i, SeqClockInput& in) {
        in.clocked = true;
        in.clock = i % 1000 == 0 ? 1.0f : 0.0f;
    }));
    EXPECT(!t.empty() && t[0].e.n == 0 && t[0].e.stepSamples == 1000.0);
}

int main() {
    noteValueTable();
    transportRates();
    transportJump();
    transportResetAndStop();
    transportSwing();
    clockMode();
    clockSwing();
    gates();
    ratio();
    clockFallbackAndRestart();
    return bleep::test::finish("seqclock");
}
