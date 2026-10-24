// SPDX-License-Identifier: GPL-3.0-only
// Note Looper: record and loop, overdub, record replaces, probability, quantize,
// half/double speed, undo and clear, position jumps, no hanging notes.
#include "NoteLooperDsp.h"

#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <vector>

using namespace bleep;
using patch::LooperParams;
using patch::NoteLooperDsp;

static constexpr double kSr = 48000.0;
static constexpr double kBpm = 120.0;
static constexpr int64_t kBeat = 24000;  // samples per quarter note

struct Ev {
    bool on;
    int note;
    int64_t at;
};

struct Rig {
    NoteLooperDsp dsp;
    LooperParams p;
    std::vector<Ev> events;
    int64_t n = 0;
    int wraps = 0;
    Rig() {
        dsp.prepare(kSr);
        p.bars = 1;  // 4 beats = 96000 samples
        p.running = true;
        p.bpm = kBpm;
    }
    auto emit() {
        return [this](bool on, int note, float, float) { events.push_back({on, note, n}); };
    }
    void run(int64_t k) {
        for (int64_t i = 0; i < k; ++i, ++n) {
            p.ppq = (double)n / kSr * kBpm / 60.0;
            wraps += dsp.tick(p, true, emit()) ? 1 : 0;
        }
    }
    /// Plays a note into the loop at beat `at` (waits for it), held for `beats`.
    void play(int note, double at, double beats) {
        const int64_t target = (int64_t)std::llround(at * (double)kBeat);
        const int64_t loop = 4 * kBeat;
        const int64_t now = n % loop;
        run(target >= now ? target - now : loop - now + target);
        dsp.noteOn(note, dsp::notePitch(note), 0.8f, p, emit());
        run((int64_t)std::llround(beats * (double)kBeat));
        dsp.noteOff(note, p, emit());
    }
    std::vector<Ev> ons(int64_t from, int64_t to = INT64_MAX) const {
        std::vector<Ev> v;
        for (const auto& e : events)
            if (e.on && e.at >= from && e.at < to) v.push_back(e);
        return v;
    }
    int balance() const {
        int b = 0;
        for (const auto& e : events) b += e.on ? 1 : -1;
        return b;
    }
};

static void recordsAndLoops() {
    TEST("record and loop");
    Rig r;
    r.p.muteThru = true;
    r.p.mode = patch::LoopRecord;
    r.play(60, 0.5, 0.25);
    r.play(64, 1.5, 0.5);
    r.run(4 * kBeat - r.n % (4 * kBeat));  // finish the pass
    EXPECT(r.dsp.count() == 2);
    EXPECT_NEAR(r.dsp.note(0).start, 0.5, 1e-3);
    EXPECT_NEAR(r.dsp.note(1).length, 0.5, 1e-3);
    r.p.mode = patch::LoopPlay;
    const int64_t from = r.n;
    r.run(8 * kBeat);  // two passes
    const auto on = r.ons(from);
    EXPECT(on.size() == 4);
    if (on.size() == 4) {
        EXPECT(on[0].note == 60 && on[0].at - from == kBeat / 2);
        EXPECT(on[1].note == 64 && on[1].at - from == kBeat + kBeat / 2 + 0);
        EXPECT(on[2].at - on[0].at == 4 * kBeat);
        EXPECT(on[3].at - on[1].at == 4 * kBeat);
    }
    EXPECT(r.balance() == 0);
    EXPECT(r.wraps >= 2);
}

static void overdubAndRecord() {
    TEST("overdub adds, record replaces");
    Rig r;
    r.p.muteThru = true;
    r.p.mode = patch::LoopRecord;
    r.play(60, 0.5, 0.25);
    r.run(4 * kBeat);
    r.p.mode = patch::LoopOverdub;
    r.play(67, 2.0, 0.25);
    r.run(4 * kBeat);
    EXPECT(r.dsp.count() == 2);
    r.p.mode = patch::LoopPlay;
    const int64_t from = r.n - r.n % (4 * kBeat) + 4 * kBeat;
    r.run(from - r.n);
    r.run(4 * kBeat);
    const auto on = r.ons(from, from + 4 * kBeat);
    EXPECT(on.size() == 2);
    // Play does not record
    r.play(72, 3.0, 0.25);
    EXPECT(r.dsp.count() == 2);
    // Record again starts from nothing
    r.p.mode = patch::LoopRecord;
    r.run(10);
    EXPECT(r.dsp.count() == 0);
    r.play(55, 1.0, 0.25);
    EXPECT(r.dsp.count() == 1);
}

static void probability() {
    TEST("probability");
    Rig r;
    r.p.muteThru = true;
    r.p.mode = patch::LoopRecord;
    for (int i = 0; i < 8; ++i) r.play(60 + i, 0.25 + 0.4 * i, 0.1);
    r.run(4 * kBeat);
    r.p.mode = patch::LoopPlay;
    r.p.probability = 0.0f;
    r.events.clear();
    r.run(4 * 4 * kBeat);
    EXPECT(r.ons(0).empty());
    r.p.probability = 0.5f;
    r.events.clear();
    r.run(40 * 4 * kBeat);
    const size_t played = r.ons(0).size();
    EXPECT(played > 320 * 0.35 && played < 320 * 0.65);
    r.p.probability = 1.0f;
    r.events.clear();
    r.run(4 * 4 * kBeat);
    EXPECT(r.ons(0).size() >= 31 && r.ons(0).size() <= 32);
    r.run(4 * kBeat - r.n % (4 * kBeat));  // finish the pass
    EXPECT(r.dsp.sounding() == 0);
    // the same seed gives the same notes in the same pass
    Rig a, b;
    for (Rig* x : {&a, &b}) {
        x->p.muteThru = true;
        x->p.mode = patch::LoopRecord;
        for (int i = 0; i < 8; ++i) x->play(60 + i, 0.25 + 0.4 * i, 0.1);
        x->run(4 * kBeat);
        x->p.mode = patch::LoopPlay;
        x->p.probability = 0.5f;
        x->events.clear();
        x->run(8 * 4 * kBeat);
    }
    EXPECT(a.ons(0).size() == b.ons(0).size());
}

static void quantize() {
    TEST("quantize");
    Rig r;
    r.p.muteThru = true;
    r.p.mode = patch::LoopRecord;
    r.play(60, 0.6, 0.2);
    r.run(4 * kBeat);
    r.p.mode = patch::LoopPlay;
    auto firstOn = [&](double grid, float strength) {
        r.p.gridBeats = grid;
        r.p.strength = strength;
        r.events.clear();
        const int64_t from = r.n - r.n % (4 * kBeat) + 4 * kBeat;
        r.run(from - r.n);
        r.run(4 * kBeat);
        const auto on = r.ons(from, from + 4 * kBeat);
        return on.empty() ? -1.0 : (double)(on[0].at - from) / (double)kBeat;
    };
    EXPECT_NEAR(firstOn(0.0, 1.0f), 0.6, 0.002);
    EXPECT_NEAR(firstOn(0.5, 1.0f), 0.5, 0.002);
    EXPECT_NEAR(firstOn(0.5, 0.5f), 0.55, 0.002);
    EXPECT_NEAR(firstOn(0.5, 0.0f), 0.6, 0.002);
    EXPECT_NEAR(NoteLooperDsp::quantized(3.9, 0.5, 1.0f, 4.0), 4.0 - 4.0, 1e-9);  // wraps to the loop start
}

static void speeds() {
    TEST("half and double speed");
    for (int s : {patch::LoopHalf, patch::LoopDouble}) {
        Rig r;
        r.p.speed = s;
        r.p.muteThru = true;
        r.p.mode = patch::LoopRecord;
        r.play(60, 1.0, 0.25);
        const double f = NoteLooperDsp::speedFactor(s);
        const int64_t pass = (int64_t)(4.0 * kBeat / f);
        r.run(pass - r.n % pass);
        EXPECT(r.dsp.count() == 1);
        r.p.mode = patch::LoopPlay;
        r.events.clear();
        r.run(3 * pass);
        const auto on = r.ons(0);
        EXPECT(on.size() >= 2);
        if (on.size() >= 2) EXPECT(std::llabs((on[1].at - on[0].at) - pass) <= 2);
    }
}

static void undoAndClear() {
    TEST("undo and clear");
    Rig r;
    r.p.muteThru = true;
    r.p.mode = patch::LoopRecord;
    r.play(60, 0.5, 0.25);
    r.run(4 * kBeat);
    r.p.mode = patch::LoopPlay;
    r.run(100);
    r.p.mode = patch::LoopOverdub;  // a second layer
    r.play(64, 1.5, 0.25);
    r.play(67, 2.5, 0.25);
    r.p.mode = patch::LoopPlay;
    r.run(10);
    EXPECT(r.dsp.count() == 3);
    r.dsp.undo(r.emit());
    EXPECT(r.dsp.count() == 1);
    EXPECT(r.dsp.note(0).note == 60);
    r.dsp.undo(r.emit());
    EXPECT(r.dsp.count() == 0);
    r.p.mode = patch::LoopOverdub;
    r.play(62, 0.5, 0.25);
    r.p.mode = patch::LoopPlay;
    r.dsp.clear(r.emit());
    EXPECT(r.dsp.count() == 0);
    r.run(4 * kBeat);
    EXPECT(r.dsp.sounding() == 0);
    EXPECT(r.balance() == 0);
}

static void jumpsAndFreeRun() {
    TEST("position jump and free run");
    Rig r;
    r.p.muteThru = true;
    r.p.mode = patch::LoopRecord;
    r.play(60, 0.5, 2.0);
    r.run(4 * kBeat);
    r.p.mode = patch::LoopPlay;
    r.run(3 * kBeat);  // loop position 1.5: inside the long note
    EXPECT(r.dsp.sounding() == 1);
    // the song position jumps back: the note must not hang
    for (int i = 0; i < 100; ++i) {
        r.p.ppq = 1.3;
        r.dsp.tick(r.p, true, r.emit());
    }
    EXPECT(r.dsp.sounding() == 0);
    EXPECT(r.balance() == 0);

    // free running: one pass lasts loop beats at the tempo
    Rig f;
    f.p.running = false;
    f.p.muteThru = true;
    f.p.mode = patch::LoopRecord;
    f.run(1000);
    f.dsp.noteOn(60, dsp::notePitch(60), 0.8f, f.p, f.emit());
    f.run(2000);
    f.dsp.noteOff(60, f.p, f.emit());
    f.p.mode = patch::LoopPlay;
    f.events.clear();
    f.run(4 * 4 * kBeat);
    const auto on = f.ons(0);
    EXPECT(on.size() == 4 || on.size() == 3);
    if (on.size() >= 2) EXPECT(std::llabs((on[1].at - on[0].at) - 4 * kBeat) <= 4);
}

static void heldAcrossWrapAndThru() {
    TEST("a held note across the wrap; thru");
    Rig r;
    r.p.mode = patch::LoopRecord;  // thru passes
    r.play(60, 3.5, 1.0);          // held from beat 3.5 to 4.5: crosses the loop end
    EXPECT(r.dsp.count() == 1);
    EXPECT_NEAR(r.dsp.note(0).length, 1.0, 1e-3);
    r.run(2 * 4 * kBeat + kBeat);
    EXPECT(r.dsp.sounding() == 0);
    EXPECT(r.balance() == 0);
    // a note held longer than the whole loop is cut to the loop length
    Rig q;
    q.p.mode = patch::LoopOverdub;
    q.run(100);
    q.dsp.noteOn(62, dsp::notePitch(62), 0.8f, q.p, q.emit());
    q.run(6 * kBeat * 2);
    q.dsp.noteOff(62, q.p, q.emit());
    EXPECT_NEAR(q.dsp.note(0).length, 4.0, 1e-9);
    q.p.mode = patch::LoopPlay;
    q.run(4 * 4 * kBeat);
    q.dsp.flush(q.emit());
    EXPECT(q.dsp.sounding() == 0);
    EXPECT(q.balance() == 0);
}

static void shorterLoopKeepsNotes() {
    TEST("shorter loop keeps the notes");
    Rig r;
    r.p.bars = 2;
    r.p.muteThru = true;
    r.p.mode = patch::LoopRecord;
    r.play(60, 1.0, 0.25);
    r.play(64, 5.0, 0.25);
    r.p.mode = patch::LoopPlay;
    r.p.bars = 1;
    EXPECT(r.dsp.count() == 2);
    r.events.clear();
    const int64_t from = r.n;
    r.run(8 * kBeat);
    for (const auto& e : r.ons(from)) EXPECT(e.note == 60);  // the note at beat 5 is outside a one-bar loop
    r.p.bars = 2;
    r.events.clear();
    r.run(16 * kBeat);
    bool sawHigh = false;
    for (const auto& e : r.ons(0)) sawHigh = sawHigh || e.note == 64;
    EXPECT(sawHigh);
}

int main() {
    recordsAndLoops();
    overdubAndRecord();
    probability();
    quantize();
    speeds();
    undoAndClear();
    jumpsAndFreeRun();
    heldAcrossWrapAndThru();
    shorterLoopKeepsNotes();
    return bleep::test::finish("note-looper");
}
