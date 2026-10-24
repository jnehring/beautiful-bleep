// SPDX-License-Identifier: GPL-3.0-only
// Note Echo: repeat timing, decay, scale walk, drops, Spread fans, Gravity,
// muted original, no hanging notes.
#include "NoteEchoDsp.h"

#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <vector>

using namespace bleep;
using patch::EchoParams;
using patch::NoteEchoDsp;

static constexpr double kSr = 48000.0;
static constexpr int64_t kStep = 12000;  // 1/8 at 120 BPM

struct Ev {
    bool on;
    int note;
    float vel;
    int64_t at;
};

struct Rig {
    NoteEchoDsp dsp;
    EchoParams p;
    std::vector<Ev> events;
    int64_t n = 0;
    Rig() {
        dsp.prepare(kSr);
        p.scale.key = 0;
        p.scale.mask = dsp::scales()[1].mask;  // C major
        p.ppqValid = true;
    }
    auto emit() {
        return [this](bool on, int note, float, float vel) { events.push_back({on, note, vel, n}); };
    }
    void noteOn(int note, float vel = 0.8f) { dsp.noteOn(note, dsp::notePitch(note), vel, p, emit()); }
    void run(int64_t k) {
        for (int64_t i = 0; i < k; ++i, ++n) dsp.tick(true, emit());
    }
    std::vector<Ev> ons() const {
        std::vector<Ev> v;
        for (const auto& e : events)
            if (e.on) v.push_back(e);
        return v;
    }
};

static void timingAndDecay() {
    TEST("timing and decay");
    Rig r;
    r.p.repeats = 3;
    r.p.spacingBeats = 0.5;  // 1/8 at 120 BPM = kStep samples
    r.p.decay = 0.5f;
    r.noteOn(60, 0.8f);
    r.run(4 * kStep);
    const auto on = r.ons();
    EXPECT(on.size() == 4);  // original + 3
    if (on.size() == 4) {
        for (int k = 1; k < 4; ++k) {
            EXPECT(on[(size_t)k].at == kStep * k);
            EXPECT(on[(size_t)k].note == 60);
        }
        EXPECT_NEAR(on[1].vel, 0.4, 1e-4);
        EXPECT_NEAR(on[2].vel, 0.2, 1e-4);
        EXPECT_NEAR(on[3].vel, 0.1, 1e-4);
    }
    EXPECT(r.dsp.sounding() == 0);
}

static void freeTime() {
    TEST("free time");
    Rig r;
    r.p.free = true;
    r.p.spacingSeconds = 0.1;
    r.p.repeats = 2;
    r.noteOn(64);
    r.run(20000);
    const auto on = r.ons();
    EXPECT(on.size() == 3);
    if (on.size() == 3) EXPECT(on[2].at == 9600);
}

static void scaleWalking() {
    TEST("scale steps");
    Rig r;
    r.p.repeats = 4;
    r.p.steps = 1;
    r.noteOn(60);  // C major: D E F G
    r.run(6 * kStep);
    const auto on = r.ons();
    const int want[5] = {60, 62, 64, 65, 67};
    EXPECT(on.size() == 5);
    for (size_t i = 0; i < on.size() && i < 5; ++i) EXPECT(on[i].note == want[i]);

    Rig d;
    d.p.repeats = 3;
    d.p.steps = -2;
    d.noteOn(62);  // D: back two steps each time: B(59) G(55) E(52)
    d.run(5 * kStep);
    const auto dn = d.ons();
    const int wd[4] = {62, 59, 55, 52};
    EXPECT(dn.size() == 4);
    for (size_t i = 0; i < dn.size() && i < 4; ++i) EXPECT(dn[i].note == wd[i]);

    Rig c;  // chromatic: semitones
    c.p.scale.mask = 0xfff;
    c.p.repeats = 2;
    c.p.steps = 3;
    c.noteOn(60);
    c.run(4 * kStep);
    const auto cn = c.ons();
    EXPECT(cn.size() == 3);
    if (cn.size() == 3) EXPECT(cn[2].note == 66);
}

static void outOfRangeDropped() {
    TEST("repeats outside 0..127 are dropped");
    Rig r;
    r.p.repeats = 8;
    r.p.steps = 7;
    r.noteOn(120);
    r.dsp.noteOff(120, r.emit());
    r.run(10 * kStep);
    for (const auto& e : r.events) EXPECT(e.note >= 0 && e.note <= 127);
    EXPECT(r.dsp.sounding() == 0);
}

static void drops() {
    TEST("drop");
    Rig r;
    r.p.repeats = 16;
    r.p.drop = 1.0f;
    r.p.spacingBeats = 0.125;
    r.noteOn(60);
    r.run(40000);
    EXPECT(r.ons().size() == 1);

    Rig h;
    h.p.repeats = 16;
    h.p.drop = 0.5f;
    h.p.spacingBeats = 0.125;
    int total = 0;
    for (int i = 0; i < 40; ++i) {
        h.events.clear();
        h.noteOn(60 + i % 5);
        h.run(16 * 12000 + 10);
        total += (int)h.ons().size() - 1;
    }
    EXPECT(total > 40 * 16 * 0.35 && total < 40 * 16 * 0.65);
}

static void spreadFans() {
    TEST("spread fan");
    Rig r;
    r.p.repeats = 4;
    r.p.spread = 0.5f;  // three tones: root, third, fifth (scale degrees 0, 2, 4)
    EXPECT(NoteEchoDsp::fanTones(0.5f) == 3);
    r.noteOn(60);
    r.run(6 * kStep);
    const auto on = r.ons();
    const int up[5] = {60, 64, 67, 60, 64};
    EXPECT(on.size() == 5);
    for (size_t i = 0; i < on.size() && i < 5; ++i) EXPECT(on[i].note == up[i]);

    Rig d;
    d.p.repeats = 3;
    d.p.spread = 0.5f;
    d.p.fan = patch::EchoFanDown;
    d.noteOn(60);
    d.run(5 * kStep);
    const auto dn = d.ons();
    const int wd[4] = {60, 67, 64, 60};
    EXPECT(dn.size() == 4);
    for (size_t i = 0; i < dn.size() && i < 4; ++i) EXPECT(dn[i].note == wd[i]);

    Rig u;  // up-down over three tones: 1 2 1 0 1 2
    u.p.repeats = 5;
    u.p.spread = 0.5f;
    u.p.fan = patch::EchoFanUpDown;
    u.noteOn(60);
    u.run(7 * kStep);
    const auto ud = u.ons();
    const int wu[6] = {60, 64, 67, 64, 60, 64};
    EXPECT(ud.size() == 6);
    for (size_t i = 0; i < ud.size() && i < 6; ++i) EXPECT(ud[i].note == wu[i]);
}

static void gravity() {
    TEST("gravity");
    // Triplet-eighth repeats (1/3 beat) pulled to the 1/16 grid land on it.
    Rig r;
    r.p.repeats = 6;
    r.p.spacingBeats = 1.0 / 3.0;
    r.p.gravity = 1.0f;
    r.p.gridBeats = 0.25;
    r.p.ppq = 0.0;
    r.noteOn(60);
    r.run(3 * 48000);
    const auto on = r.ons();
    EXPECT(on.size() >= 5);
    for (size_t i = 1; i < on.size(); ++i) {
        const double beats = (double)on[i].at / kSr * 2.0;  // 120 BPM
        const double g = beats / 0.25;
        EXPECT_NEAR(g, std::round(g), 0.01);
        EXPECT(on[i].at > on[i - 1].at);
    }
    // Negative gravity moves repeats that sit on the grid halfway off it.
    Rig a;
    a.p.repeats = 3;
    a.p.spacingBeats = 0.5;
    a.p.gravity = -1.0f;
    a.p.gridBeats = 0.5;
    a.noteOn(60);
    a.run(4 * kStep);
    const auto an = a.ons();
    EXPECT(an.size() == 4);
    for (size_t i = 1; i < an.size(); ++i) {
        const double g = (double)an[i].at / kSr * 2.0 / 0.5;
        EXPECT_NEAR(g - std::floor(g), 0.5, 0.02);
    }
    // Zero gravity leaves the time alone.
    Rig z;
    z.p.repeats = 2;
    z.p.spacingBeats = 1.0 / 3.0;
    z.noteOn(60);
    z.run(48000);
    const auto zn = z.ons();
    EXPECT(zn.size() == 3);
    if (zn.size() == 3) EXPECT(zn[1].at == 8000);
}

static void muteOriginalAndOffs() {
    TEST("muted original, note-offs");
    Rig r;
    r.p.repeats = 2;
    r.p.muteOriginal = true;
    r.noteOn(60);
    r.dsp.noteOff(60, r.emit());
    r.run(3 * kStep);
    EXPECT(r.ons().size() == 2);
    EXPECT(r.events.size() == 4);

    Rig o;  // the original's note-off must not end a repeat of the same note
    o.p.repeats = 2;
    o.p.length = 0.98f;
    o.noteOn(60);
    o.run(kStep + 100);  // a repeat started
    o.dsp.noteOff(60, o.emit());
    int offsBefore = 0;
    for (const auto& e : o.events) offsBefore += e.on ? 0 : 1;
    // note-on, note-off (retrigger of the repeat on the same number), note-on …
    EXPECT(offsBefore >= 1);
    o.run(4 * kStep);
    EXPECT(o.dsp.sounding() == 0);
    int on = 0, off = 0;
    for (const auto& e : o.events) (e.on ? on : off)++;
    EXPECT(on == off);
}

static void flushEnds() {
    TEST("flush");
    Rig r;
    r.p.repeats = 4;
    r.p.length = 0.98f;
    r.noteOn(60);
    r.run(kStep + 10);
    EXPECT(r.dsp.sounding() >= 1);
    r.dsp.flush(r.emit());
    EXPECT(r.dsp.sounding() == 0);
    EXPECT(r.dsp.pending() == 0);
}

int main() {
    timingAndDecay();
    freeTime();
    scaleWalking();
    outOfRangeDropped();
    drops();
    spreadFans();
    gravity();
    muteOriginalAndOffs();
    flushEnds();
    return bleep::test::finish("note-echo");
}
