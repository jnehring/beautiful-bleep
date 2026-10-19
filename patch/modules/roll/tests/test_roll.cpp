// SPDX-License-Identifier: GPL-3.0-or-later
// Roll DSP: note timing and length, overlapping notes and the mono outputs,
// loop region, ratchet, probability, Morph, slot changes, humanise, Clock mode
// and no hanging notes.
#include "RollDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cstdlib>
#include <functional>
#include <map>
#include <memory>
#include <vector>

using namespace bleep::patch;

namespace {

constexpr double kSr = 48000.0;
constexpr double kBpm = 120.0;
constexpr double kPpqPerSample = kBpm / 60.0 / kSr;
constexpr int64_t kBeat = 24000;  // samples per beat
constexpr int64_t kTick = 250;    // samples per tick

struct Ev {
    int64_t at;
    bool on;
    int note;
    float vel;
};

struct Run {
    std::vector<Ev> ev;
    std::vector<int64_t> triggers, loops;
    std::vector<float> lowGate, lowPitch, highPitch, lastPitch, lastGate, position;
    std::map<int, int> held;
    bool bad = false;
    int sounding() const {
        int n = 0;
        for (const auto& [k, v] : held) n += v;
        return n;
    }
    std::vector<Ev> ons() const {
        std::vector<Ev> o;
        for (const auto& e : ev)
            if (e.on) o.push_back(e);
        return o;
    }
};

RollNote note(int t, int l, int pitch, int vel = 100, int prob = 100, int ratchet = 1) {
    RollNote n;
    n.t = t;
    n.l = l;
    n.pitch = (uint8_t)pitch;
    n.vel = (uint8_t)vel;
    n.prob = (uint8_t)prob;
    n.ratchet = (uint8_t)ratchet;
    return n;
}

RollSlot slotOf(int bars, std::vector<RollNote> notes) {
    RollSlot s;
    s.bars = bars;
    s.loopStart = 0;
    s.loopEnd = s.length();
    std::sort(notes.begin(), notes.end(), [](const RollNote& a, const RollNote& b) { return a.t != b.t ? a.t < b.t : a.pitch < b.pitch; });
    s.count = (int)notes.size();
    for (size_t i = 0; i < notes.size(); ++i) s.notes[i] = notes[i];
    return s;
}

struct Rig {
    RollDsp dsp;
    RollBank bank;
    RollParams p;
    RollTime t;
    RollInputs in;
    int64_t sample = 0;
    double ppq = 0.0;
    explicit Rig(const RollSlot& s0) {
        bank.fill(RollSlot{});
        bank[0] = s0;
        for (int i = 1; i < kRollSlots; ++i) bank[(size_t)i].count = 0;
        dsp.prepare(kSr);
        dsp.reset();
        dsp.setBank(&bank);
        p.scale = 0;
        t.running = true;
        t.bpm = kBpm;
    }
    void run(int64_t n, Run& r, const std::function<void(int64_t)>& each = nullptr) {
        for (int64_t i = 0; i < n; ++i, ++sample) {
            if (each) each(sample);
            t.started = sample == 0;
            t.ppq = ppq;
            RollOutputs o;
            dsp.tick(p, in, t, o, [&](bool on, int nt, float, float vel) {
                r.ev.push_back({sample, on, nt, vel});
                if (on) {
                    if (r.held[nt]++ > 0) r.bad = true;
                } else if (--r.held[nt] < 0) {
                    r.bad = true;
                }
            });
            if (o.trigger > 0.5f) r.triggers.push_back(sample);
            if (o.loop > 0.5f) r.loops.push_back(sample);
            r.lowGate.push_back(o.lowGate);
            r.lowPitch.push_back(o.lowPitch);
            r.highPitch.push_back(o.highPitch);
            r.lastPitch.push_back(o.lastPitch);
            r.lastGate.push_back(o.lastGate);
            r.position.push_back(o.position);
            if (t.running) ppq += kPpqPerSample;
        }
    }
};

bool near(int64_t a, int64_t b, int64_t tol = 2) { return std::llabs(a - b) <= tol; }

}  // namespace

static void timing() {
    TEST("a note starts and ends where it is drawn");
    Rig r(slotOf(1, {note(96, 48, 64)}));
    Run run;
    r.run(kBeat * 3, run);
    const auto ons = run.ons();
    EXPECT(ons.size() == 1);
    EXPECT(near(ons[0].at, kBeat));
    EXPECT(ons[0].note == 64);
    EXPECT_NEAR(ons[0].vel, 100.0 / 127.0, 1e-4);
    int64_t off = -1;
    for (const auto& e : run.ev)
        if (!e.on) off = e.at;
    EXPECT(near(off, kBeat + kBeat / 2));
    EXPECT(!run.bad && run.sounding() == 0);

    TEST("the length scale stretches the note");
    Rig s(slotOf(1, {note(0, 96, 60)}));
    s.p.lengthScale = 0.5f;
    Run run2;
    s.run(kBeat * 2, run2);
    int64_t off2 = -1;
    for (const auto& e : run2.ev)
        if (!e.on) off2 = e.at;
    EXPECT(near(off2, kBeat / 2));

    TEST("octave and transpose move the pitch");
    Rig t2(slotOf(1, {note(0, 24, 60)}));
    t2.p.octave = 1;
    t2.in.transpose = 2.0f / 12.0f;
    Run run3;
    t2.run(2000, run3);
    EXPECT(run3.ons().size() == 1 && run3.ons()[0].note == 74);
}

static void loops() {
    TEST("the pattern repeats every bar count");
    Rig r(slotOf(1, {note(0, 24, 60)}));
    Run run;
    r.run(kBeat * 4 * 3 + 100, run);
    const auto ons = run.ons();
    EXPECT(ons.size() == 4);  // 0, 1, 2, 3 bars (the first starts the transport)
    EXPECT(near(ons[1].at, kBeat * 4));
    EXPECT(near(ons[2].at, kBeat * 8));
    EXPECT(run.loops.size() == 3);

    TEST("a loop region plays only its notes");
    RollSlot s = slotOf(2, {note(0, 12, 60), note(96, 12, 62), note(192, 12, 64), note(288, 12, 65)});
    s.loopStart = 96;
    s.loopEnd = 288;  // two beats
    Rig q(s);
    Run run2;
    q.run(kBeat * 4, run2);
    std::vector<int> pitches;
    for (const auto& e : run2.ons()) pitches.push_back(e.note);
    EXPECT((pitches == std::vector<int>{62, 64, 62, 64}));
    EXPECT(run2.position[0] < 0.01f);

    TEST("a transport jump restarts without hanging notes");
    Rig j(slotOf(1, {note(0, 96, 60), note(192, 24, 62)}));
    Run run3;
    j.run(kBeat / 2, run3);
    j.ppq = 2.0;  // jump to beat 2
    j.run(kBeat, run3);
    EXPECT(run3.sounding() <= 1 && !run3.bad);
    bool had62 = false;
    for (const auto& e : run3.ons()) had62 |= e.note == 62;
    EXPECT(had62);

    TEST("stop releases everything");
    Rig st(slotOf(1, {note(0, 384, 60), note(0, 384, 64)}));
    Run run4;
    st.run(kBeat, run4);
    EXPECT(run4.sounding() == 2);
    st.t.running = false;
    st.run(10, run4);
    EXPECT(run4.sounding() == 0 && !run4.bad);
}

static void polyphony() {
    TEST("overlapping notes sound together; low, high and latest follow them");
    Rig r(slotOf(1, {note(0, 96, 48), note(24, 96, 72), note(48, 24, 60)}));
    Run run;
    r.run(kBeat * 2, run);
    EXPECT(run.ons().size() == 3);
    // at beat 0.6 all three sound
    const size_t at = (size_t)(kBeat * 3 / 5);
    EXPECT_NEAR(run.lowPitch[at], (48 - 60) / 12.0, 1e-5);
    EXPECT_NEAR(run.highPitch[at], (72 - 60) / 12.0, 1e-5);
    EXPECT_NEAR(run.lastPitch[at], 0.0, 1e-5);
    EXPECT(run.lowGate[at] > 0.5f && run.lastGate[at] > 0.5f);
    // after the middle note ended, the latest one still sounding is the high note
    const size_t later = (size_t)(kBeat * 4 / 5) + 10;
    EXPECT_NEAR(run.lastPitch[later], 1.0, 1e-5);
    // after everything ended the gates are low
    EXPECT(run.lowGate.back() < 0.5f && run.lastGate.back() < 0.5f);
    EXPECT(!run.bad && run.sounding() == 0);

    TEST("the same note again retriggers instead of hanging");
    Rig q(slotOf(1, {note(0, 96, 60), note(48, 96, 60)}));
    Run run2;
    q.run(kBeat * 3, run2);
    EXPECT(run2.ons().size() == 2);
    EXPECT(!run2.bad && run2.sounding() == 0);

    TEST("the latest-note gate dips when another note takes over");
    Rig d(slotOf(1, {note(0, 96, 60), note(48, 48, 64)}));
    Run run3;
    d.run(kBeat, run3);
    bool dip = false;
    for (size_t i = 11000; i < 13500; ++i) dip |= run3.lastGate[i] < 0.5f;
    EXPECT(dip);
}

static void shaping() {
    TEST("ratchet repeats a note inside its length");
    Rig r(slotOf(1, {note(0, 96, 60, 100, 100, 4)}));
    Run run;
    r.run(kBeat * 2, run);
    EXPECT(run.ons().size() == 4);
    EXPECT(near(run.ons()[1].at, kBeat / 4));
    EXPECT(!run.bad && run.sounding() == 0);

    TEST("probability is seeded and about right");
    std::vector<RollNote> notes;
    for (int b = 0; b < 8; ++b) notes.push_back(note(b * 48, 12, 60, 100, 50));
    auto count = [&](uint32_t seed) {
        Rig q(slotOf(1, notes));
        q.p.seed = seed;
        Run run2;
        q.run(kBeat * 4 * 40, run2);
        return run2.ons().size();
    };
    const size_t a = count(1), b = count(1), c = count(7);
    EXPECT(a == b);
    EXPECT(a > 130 && a < 190);  // 320 chances at 50 %
    EXPECT(a != c);

    TEST("probability 0 never plays");
    Rig z(slotOf(1, {note(0, 24, 60, 100, 0)}));
    Run run3;
    z.run(kBeat * 8, run3);
    EXPECT(run3.ons().empty());

    TEST("quantize snaps to the scale");
    Rig s(slotOf(1, {note(0, 24, 61)}));
    s.p.snap = true;
    s.p.scale = 1;  // major
    s.p.root = 0;
    Run run4;
    s.run(1000, run4);
    EXPECT(run4.ons().size() == 1 && (run4.ons()[0].note == 60 || run4.ons()[0].note == 62));

    TEST("humanise only delays, within 30 ms, and is repeatable");
    auto delays = [&](uint32_t seed) {
        std::vector<RollNote> n2;
        for (int i = 0; i < 8; ++i) n2.push_back(note(i * 48, 12, 60 + i, 100));
        Rig h(slotOf(1, n2));
        h.p.humanise = 1.0f;
        h.p.seed = seed;
        Run r5;
        h.run(kBeat * 4, r5);
        std::vector<int64_t> d;
        int i = 0;
        for (const auto& e : r5.ons()) d.push_back(e.at - (int64_t)i++ * kBeat / 2);
        return d;
    };
    const auto d1 = delays(3), d2 = delays(3);
    EXPECT(d1 == d2 && d1.size() == 8);
    bool any = false;
    for (auto v : d1) {
        EXPECT(v >= -2 && v <= (int64_t)(0.031 * kSr));
        any |= v > 20;
    }
    EXPECT(any);

    TEST("swing delays notes on odd sixteenths");
    Rig sw(slotOf(1, {note(24, 12, 60)}));
    sw.p.swing = 0.75f;
    Run run6;
    sw.run(kBeat, run6);
    EXPECT(run6.ons().size() == 1);
    EXPECT(near(run6.ons()[0].at, kBeat / 4 + kBeat / 8, 3));
}

static void slots() {
    TEST("Morph blends two slots note by note");
    Rig r(slotOf(1, {note(0, 24, 60, 80)}));
    r.bank[1] = slotOf(1, {note(48, 48, 72, 120)});
    r.p.morphTo = 1;
    r.p.morph = 0.5f;
    Run run;
    r.run(kBeat, run);
    EXPECT(run.ons().size() == 1);
    EXPECT(run.ons()[0].note == 66);
    EXPECT(near(run.ons()[0].at, 24 * kTick));
    EXPECT_NEAR(run.ons()[0].vel, 100.0 / 127.0, 0.01);

    TEST("Morph 0 is slot A and Morph 1 is slot B");
    Rig a(slotOf(1, {note(0, 24, 60)}));
    a.bank[1] = slotOf(1, {note(0, 24, 72)});
    a.p.morphTo = 1;
    Run run2;
    a.run(2000, run2);
    EXPECT(run2.ons().size() == 1 && run2.ons()[0].note == 60);
    Rig b(slotOf(1, {note(0, 24, 60)}));
    b.bank[1] = slotOf(1, {note(0, 24, 72)});
    b.p.morphTo = 1;
    b.p.morph = 1.0f;
    Run run3;
    b.run(2000, run3);
    EXPECT(run3.ons().size() == 1 && run3.ons()[0].note == 72);

    TEST("notes without a partner fade with Morph");
    std::vector<RollNote> many;
    for (int i = 0; i < 16; ++i) many.push_back(note(i * 24, 12, 60 + i));
    auto plays = [&](float m) {
        Rig q(slotOf(1, {note(0, 12, 60)}));
        q.bank[1] = slotOf(1, many);
        q.p.morphTo = 1;
        q.p.morph = m;
        Run run4;
        q.run(kBeat * 4 - 100, run4);
        return run4.ons().size();
    };
    EXPECT(plays(0.0f) == 1);
    EXPECT(plays(1.0f) == 16);
    const size_t mid = plays(0.5f);
    EXPECT(mid > 2 && mid < 16);

    TEST("a slot change waits for the next bar");
    Rig c(slotOf(1, {note(0, 12, 60)}));
    c.bank[1] = slotOf(1, {note(0, 12, 72)});
    Run run5;
    c.run(kBeat * 2, run5);
    c.p.slot = 1;
    c.run(kBeat * 6, run5);
    std::vector<int> pitches;
    for (const auto& e : run5.ons()) pitches.push_back(e.note);
    EXPECT((pitches == std::vector<int>{60, 72}));
    EXPECT(c.dsp.previousSlot() == 0 && c.dsp.playingSlot() == 1);

    TEST("an immediate change is heard at once");
    Rig im(slotOf(1, {note(0, 12, 60), note(192, 12, 61)}));
    im.bank[1] = slotOf(1, {note(192, 12, 72)});
    im.p.change = 0;
    Run run6;
    im.run(kBeat, run6);
    im.p.slot = 1;
    im.run(kBeat * 2, run6);
    bool got72 = false;
    for (const auto& e : run6.ons()) got72 |= e.note == 72;
    EXPECT(got72);

    TEST("the Pattern input picks the slot");
    Rig pi(slotOf(1, {note(0, 12, 60)}));
    pi.bank[3] = slotOf(1, {note(0, 12, 70)});
    pi.in.patternPatched = true;
    pi.in.pattern = 3.2f / 8.0f;
    pi.p.change = 0;
    Run run7;
    pi.run(1000, run7);
    EXPECT(run7.ons().size() == 1 && run7.ons()[0].note == 70);
}

static void clocked() {
    TEST("Clock mode advances 1/16 per pulse");
    Rig r(slotOf(1, {note(24, 12, 64)}));
    r.in.clockPatched = true;
    r.t.running = false;
    Run run;
    r.run(6000 * 6, run, [&](int64_t i) { r.in.clock = (i % 6000) < 100 ? 1.0f : 0.0f; });
    EXPECT(run.ons().size() == 1);
    EXPECT(near(run.ons()[0].at, 6000, 2));
    EXPECT(!run.bad);

    TEST("a Reset pulse restarts and releases");
    Rig q(slotOf(1, {note(0, 96, 64)}));
    q.in.clockPatched = true;
    q.t.running = false;
    Run run2;
    q.run(6000 * 3, run2, [&](int64_t i) {
        q.in.clock = (i % 6000) < 100 ? 1.0f : 0.0f;
        q.in.reset = (i >= 9000 && i < 9100) ? 1.0f : 0.0f;
    });
    EXPECT(run2.ons().size() >= 1);
    EXPECT(!run2.bad);
}

int main() {
    timing();
    loops();
    polyphony();
    shaping();
    slots();
    clocked();
    return bleep::test::finish("roll");
}
