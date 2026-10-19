// SPDX-License-Identifier: GPL-3.0-or-later
// Melody Mirror: the four turns of a phrase, speed/transpose/snap, starting by
// trigger and after a pause, Answer mode, no hanging notes.
#include "MelodyMirrorDsp.h"

#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep;
using patch::MelodyMirrorDsp;
using patch::MirrorParams;
using patch::PhraseNote;

static PhraseNote pn(int64_t onset, int64_t len, int note) {
    PhraseNote n;
    n.onset = onset;
    n.length = len;
    n.note = note;
    n.pitch = dsp::notePitch(note);
    n.velocity = 0.5f + 0.1f * (float)(note % 3);
    return n;
}

static void turns() {
    TEST("turns");
    const PhraseNote in[3] = {pn(1000, 6000, 60), pn(13000, 6000, 64), pn(25000, 6000, 67)};
    PhraseNote o[16];
    MirrorParams p;

    int n = MelodyMirrorDsp::transform(in, 3, p, patch::MirrorReverse, o);
    EXPECT(n == 3);
    const int rev[3] = {67, 64, 60};
    const int64_t revT[3] = {0, 12000, 24000};
    for (int i = 0; i < 3; ++i) EXPECT(o[i].note == rev[i] && o[i].onset == revT[i] && o[i].length == 6000);

    n = MelodyMirrorDsp::transform(in, 3, p, patch::MirrorInvert, o);
    const int inv[3] = {60, 56, 53};
    for (int i = 0; i < 3; ++i) EXPECT(o[i].note == inv[i] && o[i].onset == i * 12000);
    EXPECT_NEAR(o[1].pitch, dsp::notePitch(56), 1e-5);

    p.rotate = 1;
    n = MelodyMirrorDsp::transform(in, 3, p, patch::MirrorRotate, o);
    const int rot[3] = {64, 67, 60};
    for (int i = 0; i < 3; ++i) EXPECT(o[i].note == rot[i] && o[i].onset == i * 12000);
    p.rotate = -1;
    MelodyMirrorDsp::transform(in, 3, p, patch::MirrorRotate, o);
    const int rotBack[3] = {67, 60, 64};
    for (int i = 0; i < 3; ++i) EXPECT(o[i].note == rotBack[i]);
    p.rotate = 3;  // a full turn
    MelodyMirrorDsp::transform(in, 3, p, patch::MirrorRotate, o);
    for (int i = 0; i < 3; ++i) EXPECT(o[i].note == in[i].note);

    p.rotate = 1;
    MelodyMirrorDsp::transform(in, 3, p, patch::MirrorMirror, o);
    const int mir[3] = {53, 56, 60};
    for (int i = 0; i < 3; ++i) EXPECT(o[i].note == mir[i] && o[i].onset == i * 12000);

    // twice reversed is the original; twice inverted too
    PhraseNote r1[3], r2[16];
    MelodyMirrorDsp::transform(in, 3, p, patch::MirrorReverse, r1);
    MelodyMirrorDsp::transform(r1, 3, p, patch::MirrorReverse, r2);
    for (int i = 0; i < 3; ++i) EXPECT(r2[i].note == in[i].note && r2[i].onset == in[i].onset - 1000);
    MelodyMirrorDsp::transform(in, 3, p, patch::MirrorInvert, r1);
    MelodyMirrorDsp::transform(r1, 3, p, patch::MirrorInvert, r2);
    for (int i = 0; i < 3; ++i) EXPECT(r2[i].note == in[i].note);
}

static void axes() {
    TEST("axis");
    const PhraseNote in[3] = {pn(0, 100, 60), pn(200, 100, 64), pn(400, 100, 67)};
    PhraseNote o[16];
    MirrorParams p;
    p.axisMode = patch::AxisMean;  // mean 63.67 → 64
    MelodyMirrorDsp::transform(in, 3, p, patch::MirrorInvert, o);
    EXPECT(o[0].note == 68 && o[1].note == 64 && o[2].note == 61);
    p.axisMode = patch::AxisFixed;
    p.axis = 72;
    MelodyMirrorDsp::transform(in, 3, p, patch::MirrorInvert, o);
    EXPECT(o[0].note == 84 && o[1].note == 80 && o[2].note == 77);
    p.axis = 20;  // far below: results fold back into range by octaves
    MelodyMirrorDsp::transform(in, 3, p, patch::MirrorInvert, o);
    for (int i = 0; i < 3; ++i) EXPECT(o[i].note >= 0 && o[i].note <= 127);
}

static void playbackShaping() {
    TEST("speed, transpose, velocity, gate, snap");
    const PhraseNote in[2] = {pn(0, 1000, 61), pn(2000, 1000, 66)};
    PhraseNote o[16];
    MirrorParams p;
    p.speed = 2.0f;
    p.transpose = 12;
    p.velocity = 0.5f;
    p.gateLength = 0.5f;
    MelodyMirrorDsp::transform(in, 2, p, patch::MirrorRotate, o);
    p.rotate = 0;
    MelodyMirrorDsp::transform(in, 2, p, patch::MirrorRotate, o);
    EXPECT(o[0].note == 73 && o[1].note == 78);
    EXPECT(o[1].onset == 1000 && o[0].length == 250);
    EXPECT_NEAR(o[0].velocity, in[0].velocity * 0.5f, 1e-5);
    EXPECT_NEAR(o[0].pitch, dsp::notePitch(73), 1e-5);
    p.transpose = 0;
    p.snap = true;
    p.scale.key = 0;
    p.scale.mask = dsp::scales()[1].mask;  // C major
    MelodyMirrorDsp::transform(in, 2, p, patch::MirrorRotate, o);
    EXPECT(o[0].note == 60 && o[1].note == 65);
}

struct Rig {
    MelodyMirrorDsp dsp;
    MirrorParams p;
    struct Ev {
        bool on;
        int note;
        int64_t at;
    };
    std::vector<Ev> events;
    int64_t n = 0;
    int starts = 0;
    Rig() {
        dsp.prepare(48000.0);
        p.gapSamples = 24000.0;
        p.length = 3;
        p.mode = patch::MirrorReverse;
    }
    auto emit() {
        return [this](bool on, int note, float, float) { events.push_back({on, note, n}); };
    }
    void run(int64_t k) {
        for (int64_t i = 0; i < k; ++i, ++n) starts += dsp.tick(p, true, emit()) ? 1 : 0;
    }
    void play(int note, int64_t len, int64_t gapAfter) {
        dsp.noteOn(note, dsp::notePitch(note), 0.8f, p, emit());
        run(len);
        dsp.noteOff(note, emit());
        run(gapAfter);
    }
    std::vector<Ev> ons(int64_t from) const {
        std::vector<Ev> v;
        for (const auto& e : events)
            if (e.on && e.at >= from) v.push_back(e);
        return v;
    }
};

static void startAfterGap() {
    TEST("start after a gap");
    Rig r;
    r.p.muteThru = true;
    r.play(60, 3000, 3000);
    r.play(64, 3000, 3000);
    r.play(67, 3000, 0);
    const int64_t played = r.n;
    r.run(23000);
    EXPECT(r.starts == 0);
    r.run(2000);
    EXPECT(r.starts == 1);
    r.run(30000);
    const auto on = r.ons(0);
    EXPECT(on.size() == 3);
    if (on.size() == 3) {
        EXPECT(on[0].note == 67 && on[1].note == 64 && on[2].note == 60);
        EXPECT(on[0].at >= played);
        EXPECT(on[1].at - on[0].at == 6000);
        EXPECT(on[2].at - on[1].at == 6000);
    }
    EXPECT(r.dsp.sounding() == 0);
    EXPECT(!r.dsp.playing());
    r.run(50000);
    EXPECT(r.starts == 1);  // nothing new heard: it does not repeat by itself
}

static void triggerStart() {
    TEST("trigger start");
    Rig r;
    r.p.startOnGap = false;
    r.p.muteThru = true;
    r.play(60, 3000, 3000);
    r.play(64, 3000, 40000);
    EXPECT(r.starts == 0);
    EXPECT(r.dsp.start(r.p, false));
    r.run(20000);
    const auto on = r.ons(0);
    EXPECT(on.size() == 2 && on[0].note == 64 && on[1].note == 60);
    // a second trigger plays it again, also without new notes
    EXPECT(r.dsp.start(r.p, false));
    r.run(20000);
    EXPECT(r.ons(0).size() == 4);
    Rig e;
    EXPECT(!e.dsp.start(e.p, false));  // nothing remembered
}

static void windowLength() {
    TEST("window length");
    Rig r;
    r.p.length = 2;
    r.p.startOnGap = false;
    r.p.muteThru = true;
    for (int i = 0; i < 5; ++i) r.play(60 + i, 1000, 1000);
    r.dsp.start(r.p, false);
    r.run(10000);
    const auto on = r.ons(0);
    EXPECT(on.size() == 2 && on[0].note == 64 && on[1].note == 63);
    // more than sixteen notes: the oldest are forgotten
    Rig q;
    q.p.length = 16;
    q.p.startOnGap = false;
    q.p.muteThru = true;
    for (int i = 0; i < 30; ++i) q.play(40 + i, 500, 500);
    EXPECT(q.dsp.count() == 16);
}

static void answer() {
    TEST("answer");
    Rig r;
    r.p.mode = patch::MirrorAnswer;
    r.p.reply = patch::MirrorInvert;
    r.play(60, 3000, 3000);
    r.play(64, 3000, 3000);
    r.play(67, 3000, 0);
    r.run(25000);  // the pause: it answers
    EXPECT(r.starts == 1);
    EXPECT(r.dsp.playing());
    // while it answers the input is heard (thru) but not remembered
    const int before = r.dsp.count();
    r.dsp.noteOn(90, dsp::notePitch(90), 0.8f, r.p, r.emit());
    EXPECT(r.dsp.count() == before);
    r.run(500);
    r.dsp.noteOff(90, r.emit());
    r.run(40000);
    EXPECT(!r.dsp.playing());
    EXPECT(r.dsp.fresh() == 0);
    const auto replies = r.ons(24000 + 9000);  // after the played notes
    int inv = 0;
    for (const auto& e : replies) inv += (e.note == 60 || e.note == 56 || e.note == 53) ? 1 : 0;
    EXPECT(inv == 3);
    // listening again: a new phrase is remembered and answered
    r.play(72, 2000, 0);
    EXPECT(r.dsp.count() > before);
    r.run(25000);
    EXPECT(r.starts == 2);
    r.run(40000);
    EXPECT(r.dsp.sounding() == 0);
}

static void noHangingNotes() {
    TEST("no hanging notes");
    Rig r;
    r.p.mode = patch::MirrorMirror;
    for (int i = 0; i < 60; ++i) {
        r.dsp.noteOn(48 + i % 12, dsp::notePitch(48 + i % 12), 0.7f, r.p, r.emit());
        r.run(700 + 311 * (i % 7));
        if (i % 3) r.dsp.noteOff(48 + i % 12, r.emit());
        if (i % 11 == 0) r.dsp.start(r.p, false);  // a trigger in the middle of a phrase
    }
    for (int i = 0; i < 12; ++i) r.dsp.noteOff(48 + i, r.emit());
    r.run(300000);
    EXPECT(r.dsp.sounding() == 0);
    int on = 0, off = 0;
    for (const auto& e : r.events) (e.on ? on : off)++;
    EXPECT(on == off);
}

int main() {
    turns();
    axes();
    playbackShaping();
    startAfterGap();
    triggerStart();
    windowLength();
    answer();
    noHangingNotes();
    return bleep::test::finish("melody-mirror");
}
