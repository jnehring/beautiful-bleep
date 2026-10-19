// SPDX-License-Identifier: GPL-3.0-or-later
// Note Gate: range, velocity floor/ceiling/curve, remap, gate, rule lanes,
// note-off pairing.
#include "NoteGateDsp.h"

#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <vector>

using namespace bleep;
using patch::GateParams;
using patch::GateTable;
using patch::GateVerdict;
using patch::NoteGateDsp;

struct Ev {
    bool on;
    int note;
    float vel;
};

struct Rig {
    NoteGateDsp dsp;
    GateParams p;
    GateTable t;
    std::vector<Ev> events;
    int64_t at = 0;
    auto emit() {
        return [this](bool on, int note, float, float vel) { events.push_back({on, note, vel}); };
    }
    GateVerdict on(int note, float vel = 0.8f) { return dsp.noteOn(note, dsp::notePitch(note), vel, p, t, at, emit()); }
    void off(int note) { dsp.noteOff(note, emit()); }
    int count(bool on) const {
        int n = 0;
        for (const auto& e : events) n += e.on == on ? 1 : 0;
        return n;
    }
};

static void rangeWindow() {
    TEST("range");
    Rig r;
    r.p.low = 48;
    r.p.high = 72;
    EXPECT(r.on(60) == patch::GatePassed);
    EXPECT(r.on(47) == patch::GateRange);
    EXPECT(r.on(73) == patch::GateRange);
    EXPECT(r.on(48) == patch::GatePassed);
    EXPECT(r.on(72) == patch::GatePassed);
    r.p.blockInside = true;
    EXPECT(r.on(60) == patch::GateRange);
    EXPECT(r.on(30) == patch::GatePassed);
    r.p.blockInside = false;
    r.p.low = 80;  // reversed bounds still make a window
    r.p.high = 40;
    EXPECT(r.on(60) == patch::GatePassed);
}

static void velocityLimits() {
    TEST("velocity floor and ceiling");
    Rig r;
    r.p.floor = 0.3f;
    r.p.ceiling = 0.7f;
    EXPECT(r.on(60, 0.2f) == patch::GateVelocity);
    r.events.clear();
    EXPECT(r.on(61, 0.5f) == patch::GatePassed);
    EXPECT(r.on(62, 0.95f) == patch::GatePassed);
    EXPECT_NEAR(r.events[0].vel, 0.5, 1e-4);
    EXPECT_NEAR(r.events[1].vel, 0.7, 1e-4);
    r.p.liftFloor = true;
    r.events.clear();
    EXPECT(r.on(63, 0.1f) == patch::GatePassed);
    EXPECT_NEAR(r.events[0].vel, 0.3, 1e-4);
}

static void velocityCurve() {
    TEST("velocity curve");
    Rig r;
    r.p.bend = 1.0f;
    EXPECT(NoteGateDsp::curve(0.5f, false, 1.0f, r.t) > 0.6f);
    EXPECT(NoteGateDsp::curve(0.5f, false, -1.0f, r.t) < 0.4f);
    EXPECT_NEAR(NoteGateDsp::curve(0.5f, false, 0.0f, r.t), 0.5, 1e-5);
    float prev = 0.0f;
    for (int i = 0; i <= 20; ++i) {
        const float v = NoteGateDsp::curve((float)i / 20.0f, false, 0.6f, r.t);
        EXPECT(v >= prev - 1e-6f);
        prev = v;
    }
    // drawn: a step curve (everything above 0.5 plays at full)
    for (int i = 0; i < patch::kGateCurvePoints; ++i) r.t.curve[(size_t)i] = i < 8 ? 0.2f : 1.0f;
    EXPECT_NEAR(NoteGateDsp::curve(0.1f, true, 0, r.t), 0.2, 1e-4);
    EXPECT_NEAR(NoteGateDsp::curve(0.9f, true, 0, r.t), 1.0, 1e-4);
    r.p.drawnCurve = true;
    r.on(60, 0.9f);
    EXPECT_NEAR(r.events[0].vel, 1.0, 1e-4);
    r.events.clear();
    r.on(61, 0.0f);  // velocity never reaches 0: that would be a note-off
    EXPECT(r.events[0].vel > 0.0f);
}

static void remap() {
    TEST("remap");
    Rig r;
    r.p.remap = true;
    r.t.remap[1] = 0;   // C♯ → C
    r.t.remap[3] = -1;  // D♯ blocked
    r.t.remap[0] = 7;   // C → G (same octave)
    EXPECT(r.on(61) == patch::GatePassed);
    EXPECT(r.events.back().note == 60);
    EXPECT(r.on(63) == patch::GateRemap);
    EXPECT(r.on(72) == patch::GatePassed);
    EXPECT(r.events.back().note == 79);
    // the note-off arrives for the input note and ends the output note
    r.off(72);
    EXPECT(r.events.back().note == 79 && !r.events.back().on);
    r.off(63);  // a blocked note's off does nothing
    const size_t n = r.events.size();
    r.off(63);
    EXPECT(r.events.size() == n);
    r.off(61);
    EXPECT(r.dsp.sounding() == 0);
    // two inputs onto one output: the first off must not cut the second
    Rig m;
    m.p.remap = true;
    m.t.remap[2] = 0;  // D → C
    m.on(60);
    m.on(62);          // retriggers C
    m.off(60);         // the C of input 60 was taken over: no off
    EXPECT(m.dsp.sounding() == 0 || m.dsp.sounding() == 1);
    m.off(62);
    EXPECT(m.dsp.sounding() == 0);
    EXPECT(m.count(true) == m.count(false));
}

static void gateInput() {
    TEST("gate input");
    Rig r;
    r.p.open = false;
    EXPECT(r.on(60) == patch::GateClosed);
    EXPECT(r.events.empty());
    r.p.open = true;
    r.on(60);
    r.p.open = false;
    r.off(60);  // a note that passed ends although the gate closed
    EXPECT(r.count(true) == 1 && r.count(false) == 1);
}

static void stepLane() {
    TEST("step lane");
    Rig r;
    r.p.stepsOn = true;
    r.p.ppqValid = true;
    r.t.steps = (uint16_t)((1u << 0) | (1u << 4) | (1u << 8) | (1u << 12));  // the beats
    r.p.ppq = 0.0;
    EXPECT(r.on(60) == patch::GatePassed);
    r.p.ppq = 0.25;  // second sixteenth
    EXPECT(r.on(61) == patch::GateRule);
    r.p.ppq = 1.0;
    EXPECT(r.on(62) == patch::GatePassed);
    r.p.ppq = 2.99;  // just before beat 4 → nearest step 12
    EXPECT(r.on(63) == patch::GatePassed);
    r.p.ppq = 4.0 + 0.02;  // bar 2 step 0
    EXPECT(r.on(64) == patch::GatePassed);
    r.p.ppqValid = false;  // without a song position the lane does not decide
    r.p.ppq = 0.25;
    EXPECT(r.on(65) == patch::GatePassed);
    EXPECT(NoteGateDsp::stepAt(3.9, 4.0) == 0);  // rounds to the next bar's first step
    EXPECT(NoteGateDsp::stepAt(0.5, 3.0) == 3);
}

static void everyNth() {
    TEST("every nth");
    Rig r;
    r.p.every = 3;
    r.p.offset = 1;
    int passed[9];
    for (int i = 0; i < 9; ++i) passed[i] = r.on(60 + i) == patch::GatePassed ? 1 : 0;
    const int want[9] = {0, 1, 0, 0, 1, 0, 0, 1, 0};
    for (int i = 0; i < 9; ++i) EXPECT(passed[i] == want[i]);
}

static void densityLimit() {
    TEST("density limit");
    Rig r;
    r.p.densityMax = 3;
    r.p.windowBeats = 1.0;  // 24000 samples at 120 BPM
    int pass = 0;
    for (int i = 0; i < 10; ++i) {
        r.at = i * 1000;  // ten notes within a beat
        pass += r.on(60 + i) == patch::GatePassed ? 1 : 0;
    }
    EXPECT(pass == 3);
    r.at = 30000;  // the window moved on
    EXPECT(r.on(70) == patch::GatePassed);
    // a long run never exceeds the limit within any window
    Rig q;
    q.p.densityMax = 2;
    std::vector<int64_t> times;
    for (int i = 0; i < 200; ++i) {
        q.at = i * 3000;
        if (q.on(60) == patch::GatePassed) times.push_back(q.at);
    }
    for (size_t i = 2; i < times.size(); ++i) EXPECT(times[i] - times[i - 2] >= 24000);
}

static void noHangingNotes() {
    TEST("no hanging notes");
    Rig r;
    r.p.remap = true;
    r.t.remap[0] = 4;
    r.p.low = 40;
    for (int i = 0; i < 40; ++i) {
        r.p.open = i % 3 != 0;
        r.on(36 + i * 2, 0.7f);
        if (i % 2) r.off(36 + (i - 1) * 2);
    }
    for (int i = 0; i < 40; ++i) r.off(36 + i * 2);
    r.dsp.flush(r.emit());
    EXPECT(r.dsp.sounding() == 0);
    EXPECT(r.count(true) == r.count(false));
}

int main() {
    rangeWindow();
    velocityLimits();
    velocityCurve();
    remap();
    gateInput();
    stepLane();
    everyNth();
    densityLimit();
    noHangingNotes();
    return bleep::test::finish("note-gate");
}
