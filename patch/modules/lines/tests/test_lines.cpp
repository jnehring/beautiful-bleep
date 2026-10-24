// SPDX-License-Identifier: GPL-3.0-only
// Lines DSP: row timing, gate lengths, the effect column (retrigger, slide,
// probability, transpose, jump, skip), per-track speed and length drifting
// apart, the pattern order, Free-run against restarting tracks, Clock mode and
// no hanging notes.
#include "LinesDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cstdlib>
#include <functional>
#include <map>
#include <vector>

using namespace bleep::patch;

namespace {

constexpr double kSr = 48000.0;
constexpr double kBpm = 120.0;
constexpr double kPpqPerSample = kBpm / 60.0 / kSr;
constexpr int64_t kRow = 6000;  // a 1/16 at 120 BPM, 48 kHz

struct Ev {
    int64_t at;
    int track;
    bool on;
    int note;
    float vel;
};

struct Run {
    std::vector<Ev> ev;
    std::vector<int64_t> patterns, ends;
    std::map<std::pair<int, int>, int> held;
    bool bad = false;
    std::vector<Ev> ons(int track = -1) const {
        std::vector<Ev> o;
        for (const auto& e : ev)
            if (e.on && (track < 0 || e.track == track)) o.push_back(e);
        return o;
    }
    std::vector<Ev> offs(int track = -1) const {
        std::vector<Ev> o;
        for (const auto& e : ev)
            if (!e.on && (track < 0 || e.track == track)) o.push_back(e);
        return o;
    }
    int sounding() const {
        int n = 0;
        for (const auto& [k, v] : held) n += v;
        return n;
    }
};

LinesCell cell(int note, int vel = 0, int gate = 0, int fx = 0, int fxp = 0) {
    LinesCell c;
    c.note = (uint8_t)note;
    c.vel = (uint8_t)vel;
    c.gate = (uint8_t)gate;
    c.fx = (uint8_t)fx;
    c.fxp = (uint8_t)fxp;
    return c;
}

struct Rig {
    LinesDsp dsp;
    LinesSong song;
    LinesParams p;
    LinesTime t;
    LinesInputs in;
    int64_t sample = 0;
    double ppq = 0.0;
    Rig() {
        dsp.prepare(kSr);
        dsp.reset();
        dsp.setSong(&song);
        t.running = true;
        t.bpm = kBpm;
        for (auto& k : p.length) k = 16;
    }
    LinesCell& at(int pat, int track, int row) { return song.patterns[(size_t)pat].cells[(size_t)track][(size_t)row]; }
    void run(int64_t n, Run& r, const std::function<void(int64_t)>& each = nullptr) {
        for (int64_t i = 0; i < n; ++i, ++sample) {
            if (each) each(sample);
            t.started = sample == 0;
            t.ppq = ppq;
            LinesOutputs o;
            dsp.tick(p, in, t, o, [&](int track, bool on, int note, float, float vel) {
                r.ev.push_back({sample, track, on, note, vel});
                int& h = r.held[{track, note}];
                if (on) {
                    if (h++ > 0) r.bad = true;
                } else if (--h < 0) {
                    r.bad = true;
                }
            });
            if (o.pattern > 0.5f) r.patterns.push_back(sample);
            if (o.end > 0.5f) r.ends.push_back(sample);
            if (t.running) ppq += kPpqPerSample;
        }
    }
};

bool near(int64_t a, int64_t b, int64_t tol = 2) { return std::llabs(a - b) <= tol; }

}  // namespace

static void rows() {
    TEST("a note plays on its row for the Gate share");
    Rig r;
    r.at(0, 0, 4) = cell(64);
    Run run;
    r.run(kRow * 6, run);
    EXPECT(run.ons().size() == 1);
    EXPECT(near(run.ons()[0].at, 4 * kRow));
    EXPECT_NEAR(run.ons()[0].vel, 0.8, 1e-4);
    EXPECT(near(run.offs()[0].at, 4 * kRow + kRow / 2));

    TEST("the gate column and velocity column override the settings");
    Rig g;
    g.at(0, 1, 0) = cell(60, 127, 8);  // a full row
    g.at(0, 1, 2) = cell(62, 0, 12);   // 12/8 rows
    Run run2;
    g.run(kRow * 5, run2);
    EXPECT(near(run2.offs(1)[0].at, kRow));
    EXPECT_NEAR(run2.ons(1)[0].vel, 1.0, 1e-4);
    EXPECT(near(run2.offs(1)[1].at, 2 * kRow + kRow * 3 / 2));

    TEST("a note off cell ends a note");
    Rig o;
    o.p.gate = 1.0f;
    o.at(0, 0, 0) = cell(60, 0, 15);
    o.at(0, 0, 1) = cell(kLinesNoteOff);
    Run run3;
    o.run(kRow * 4, run3);
    EXPECT(near(run3.offs(0)[0].at, kRow));
    EXPECT(!run3.bad);

    TEST("a muted track is silent");
    Rig m;
    m.at(0, 2, 0) = cell(60);
    m.at(0, 3, 0) = cell(61);
    m.p.mute[2] = true;
    Run run4;
    m.run(kRow * 3, run4);
    EXPECT(run4.ons(2).empty() && run4.ons(3).size() == 1);

    TEST("octave and transpose input move the notes");
    Rig q;
    q.p.octave[0] = 1;
    q.in.transpose = 3.0f / 12.0f;
    q.at(0, 0, 0) = cell(60);
    Run run5;
    q.run(kRow, run5);
    EXPECT(run5.ons()[0].note == 75);
}

static void drift() {
    TEST("speed multiplies a track's rows");
    Rig r;
    r.p.speed[1] = 7;  // x2
    r.p.speed[2] = 2;  // x1/2
    for (int i = 0; i < 16; ++i) {
        r.at(0, 0, i) = cell(60);
        r.at(0, 1, i) = cell(60);
        r.at(0, 2, i) = cell(60);
    }
    Run run;
    r.run(kRow * 16 - 100, run);
    EXPECT(run.ons(0).size() == 16);
    EXPECT(run.ons(1).size() == 32);
    EXPECT(run.ons(2).size() == 8);
    EXPECT(near(run.ons(1)[1].at, kRow / 2));
    EXPECT(near(run.ons(2)[1].at, 2 * kRow));

    TEST("different lengths drift and meet again");
    Rig d;
    d.p.length[0] = 3;
    d.p.length[1] = 4;
    for (int i = 0; i < 16; ++i) {
        d.at(0, 0, i) = cell(i == 0 ? 60 : 0);
        d.at(0, 1, i) = cell(i == 0 ? 72 : 0);
    }
    d.at(0, 0, 0).note = 60;
    d.at(0, 1, 0).note = 72;
    Run run2;
    d.run(kRow * 12 - 100, run2);
    EXPECT(run2.ons(0).size() == 4);  // rows 0, 3, 6, 9
    EXPECT(run2.ons(1).size() == 3);  // rows 0, 4, 8
    // they meet at row 12, the next cycle
    Run run3;
    d.run(kRow + 200, run3);
    EXPECT(run3.ons(0).size() == 1 && run3.ons(1).size() == 1);
    EXPECT(near(run3.ons(0)[0].at, 12 * kRow) && near(run3.ons(1)[0].at, 12 * kRow));
}

static void effects() {
    TEST("retrigger repeats the note inside the row");
    Rig r;
    r.at(0, 0, 1) = cell(60, 0, 0, FxRetrigger, 4);
    Run run;
    r.run(kRow * 4, run);
    EXPECT(run.ons(0).size() == 4);
    EXPECT(near(run.ons(0)[1].at, kRow + kRow / 4, 3));
    EXPECT(!run.bad);

    TEST("slide ties into the note: the new note-on comes before the old note-off");
    Rig s;
    s.p.gate = 1.0f;
    s.at(0, 0, 0) = cell(60, 0, 15);
    s.at(0, 0, 1) = cell(67, 0, 0, FxSlide, 128);
    Run run2;
    s.run(kRow * 4, run2);
    int onIdx = -1, offIdx = -1;
    for (size_t i = 0; i < run2.ev.size(); ++i) {
        if (run2.ev[i].on && run2.ev[i].note == 67) onIdx = (int)i;
        if (!run2.ev[i].on && run2.ev[i].note == 60) offIdx = (int)i;
    }
    EXPECT(onIdx >= 0 && offIdx == onIdx + 1);
    EXPECT(run2.ev[(size_t)onIdx].at == run2.ev[(size_t)offIdx].at);
    EXPECT(!run2.bad);

    TEST("probability 0 never plays, 255 always");
    Rig p0;
    p0.at(0, 0, 0) = cell(60, 0, 0, FxProbability, 0);
    p0.at(0, 1, 0) = cell(60, 0, 0, FxProbability, 255);
    Run run3;
    p0.run(kRow * 16 * 8, run3);
    EXPECT(run3.ons(0).empty() && run3.ons(1).size() == 8);

    TEST("probability is seeded and about right");
    auto count = [&](uint32_t seed) {
        Rig q;
        q.p.seed = seed;
        for (int i = 0; i < 16; ++i) q.at(0, 0, i) = cell(60, 0, 0, FxProbability, 128);
        Run run4;
        q.run(kRow * 16 * 20, run4);
        return run4.ons(0).size();
    };
    EXPECT(count(1) == count(1));
    EXPECT(count(1) > 130 && count(1) < 190);  // 320 rows at 50 %
    EXPECT(count(1) != count(2));

    TEST("transpose shifts up and down");
    Rig t;
    t.at(0, 0, 0) = cell(60, 0, 0, FxTranspose, 7);
    t.at(0, 0, 1) = cell(60, 0, 0, FxTranspose, 0xfc);  // -4
    Run run5;
    t.run(kRow * 3, run5);
    EXPECT(run5.ons(0)[0].note == 67 && run5.ons(0)[1].note == 56);

    TEST("jump sends the track to a row");
    Rig j;
    j.at(0, 0, 0) = cell(60, 0, 0, FxJump, 5);
    j.at(0, 0, 1) = cell(61);
    j.at(0, 0, 5) = cell(65);
    Run run6;
    j.run(kRow * 3, run6);
    EXPECT(run6.ons(0).size() == 2 && run6.ons(0)[0].note == 60 && run6.ons(0)[1].note == 65);

    TEST("skip leaves rows out");
    Rig k;
    k.at(0, 0, 0) = cell(60, 0, 0, FxSkip, 2);
    k.at(0, 0, 1) = cell(61);
    k.at(0, 0, 2) = cell(62);
    k.at(0, 0, 3) = cell(63);
    Run run7;
    k.run(kRow * 4 - 100, run7);
    EXPECT(run7.ons(0).size() == 2 && run7.ons(0)[1].note == 63);
}

static void order() {
    TEST("the order list chains patterns and Free-run keeps the track counting");
    Rig r;
    r.song.orderLen = 3;
    r.song.order[0] = 0;
    r.song.order[1] = 1;
    r.song.order[2] = 0;
    r.p.length[0] = 5;
    for (int i = 0; i < 16; ++i) {
        r.at(0, 0, i) = cell(60 + i % 12);
        r.at(1, 0, i) = cell(72 + i % 12);
    }
    Run run;
    r.run(kRow * 48 - 100, run);
    EXPECT(run.patterns.size() == 2);
    EXPECT(near(run.patterns[0], 16 * kRow) && near(run.patterns[1], 32 * kRow));
    EXPECT(run.ends.empty());
    const auto on = run.ons(0);
    EXPECT(on.size() == 48);
    EXPECT(on[16].note == 72 + 1);  // 16 mod 5 = row 1 of pattern B
    EXPECT(on[32].note == 60 + 2);  // 32 mod 5 = row 2 of pattern A again

    TEST("Per pattern restarts the tracks with each pattern");
    Rig q;
    q.song.orderLen = 2;
    q.song.order[1] = 1;
    q.p.freeRun = false;
    q.p.length[0] = 5;
    for (int i = 0; i < 16; ++i) {
        q.at(0, 0, i) = cell(60 + i % 12);
        q.at(1, 0, i) = cell(72 + i % 12);
    }
    Run run2;
    q.run(kRow * 32 - 100, run2);
    EXPECT(run2.ons(0)[16].note == 72);

    TEST("End fires when the order starts over");
    Rig e;
    e.song.orderLen = 2;
    e.song.order[1] = 1;
    Run run3;
    e.run(kRow * 40, run3);
    EXPECT(run3.ends.size() == 1 && near(run3.ends[0], 32 * kRow));
}

static void timing() {
    TEST("Clock mode steps one row per pulse and Reset restarts");
    Rig r;
    r.in.clockPatched = true;
    r.t.running = false;
    for (int i = 0; i < 16; ++i) r.at(0, 0, i) = cell(60 + i);
    Run run;
    r.run(kRow * 8, run, [&](int64_t i) {
        r.in.clock = (i % kRow) < 100 ? 1.0f : 0.0f;
        r.in.reset = (i >= 4 * kRow + 2000 && i < 4 * kRow + 2100) ? 1.0f : 0.0f;
    });
    const auto on = run.ons(0);
    EXPECT(on.size() >= 6);
    EXPECT(on[0].note == 60 && on[1].note == 61 && on[2].note == 62 && on[3].note == 63 && on[4].note == 64);
    EXPECT(on[5].note == 60);  // the pulse after Reset
    EXPECT(!run.bad);

    TEST("stopping the transport ends every note");
    Rig s;
    s.p.gate = 1.0f;
    s.at(0, 0, 0) = cell(60, 0, 15);
    s.at(0, 1, 0) = cell(64, 0, 15);
    Run run2;
    s.run(kRow / 2, run2);
    EXPECT(run2.sounding() == 2);
    s.t.running = false;
    s.run(10, run2);
    EXPECT(run2.sounding() == 0 && !run2.bad);

    TEST("a transport jump resyncs without catching up");
    Rig j;
    for (int i = 0; i < 16; ++i) j.at(0, 0, i) = cell(60 + i);
    Run run3;
    j.run(kRow * 2, run3);
    j.ppq = 2.0;  // 8 rows on
    j.run(kRow, run3);
    EXPECT(run3.ons(0).size() == 3 && run3.ons(0)[2].note == 68);
    EXPECT(!run3.bad);
}

int main() {
    rows();
    drift();
    effects();
    order();
    timing();
    return bleep::test::finish("lines");
}
