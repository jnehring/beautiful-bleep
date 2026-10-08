// SPDX-License-Identifier: MIT
// Stage Seq DSP: stage positions for every order, loop jumps, Random and
// Brownian walks (no repeats, ±1 steps, phrase restarts, replay after a
// jump), gate modes and ratchets, slides, accents, Hold, and no hanging notes.
#include "StageSequencerDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <functional>
#include <map>
#include <vector>

using namespace bleep::patch;

namespace {

constexpr double kSr = 48000.0;
constexpr double kBpm = 120.0;
constexpr double kPpqPerSample = kBpm / 60.0 / kSr;
constexpr int64_t kPulse = 6000;  // a 1/16 at 120 BPM, 48 kHz

struct Note {
    int64_t at;
    bool on;
    int note;
    float velocity;
};

struct Run {
    std::vector<Note> notes;
    std::vector<int64_t> starts, ends, triggers;
    std::vector<int> stageAtStart;
    std::vector<float> gate, pitch, accent;
    std::map<int, int> held;
    bool bad = false;
    int sounding() const {
        int n = 0;
        for (const auto& [k, v] : held) n += v;
        return n;
    }
    std::vector<Note> ons() const {
        std::vector<Note> o;
        for (const auto& n : notes)
            if (n.on) o.push_back(n);
        return o;
    }
};

struct Rig {
    StageSequencerDsp dsp;
    StageParams p;
    StageTime t;
    StageInputs in;
    int64_t sample = 0;
    double ppq = 0.0;
    Rig() {
        dsp.prepare(kSr);
        dsp.reset();
        p.scale = 0;
        t.running = true;
        t.bpm = kBpm;
    }
    void run(int64_t n, Run& r, const std::function<void(int64_t)>& each = nullptr) {
        for (int64_t i = 0; i < n; ++i, ++sample) {
            if (each) each(sample);
            t.started = sample == 0;
            t.ppq = ppq;
            StageOutputs o;
            dsp.tick(p, in, t, o, [&](bool on, int note, float, float vel) {
                r.notes.push_back({sample, on, note, vel});
                if (on) {
                    if (r.held[note]++ > 0) r.bad = true;
                } else if (--r.held[note] < 0) {
                    r.bad = true;
                }
            });
            if (o.stageStart > 0.5f) {
                r.starts.push_back(sample);
                r.stageAtStart.push_back(dsp.playingStage());
            }
            if (o.end > 0.5f) r.ends.push_back(sample);
            if (o.trigger > 0.5f) r.triggers.push_back(sample);
            r.gate.push_back(o.gate);
            r.pitch.push_back(o.pitch);
            r.accent.push_back(o.accent);
            if (t.running) ppq += kPpqPerSample;
        }
    }
};

/// Stages 0..n−1 with the given pulses, all Every, pitches 0, 1, 2, …
StagePattern pattern(std::initializer_list<int> pulses, uint8_t gate = StageEvery) {
    StagePattern p{};
    int i = 0;
    for (int n : pulses) {
        p[(size_t)i].pulses = (uint8_t)n;
        p[(size_t)i].gate = gate;
        p[(size_t)i].pitch = (int8_t)i;
        ++i;
    }
    return p;
}

int64_t pulses(int64_t at) { return (at + kPulse / 2) / kPulse; }

}  // namespace

static void fixedOrders() {
    TEST("Forward 2, 1, 3");
    Rig rig;
    rig.dsp.setPattern(pattern({2, 1, 3}));
    rig.p.stages = 3;
    EXPECT(rig.dsp.cycleLength(rig.p) == 6);
    Run r;
    rig.run(kPulse * 12, r);
    EXPECT(r.starts.size() == 6);
    const int64_t want[6] = {0, 2, 3, 6, 8, 9};
    for (size_t i = 0; i < r.starts.size() && i < 6; ++i) EXPECT(pulses(r.starts[i]) == want[i]);
    EXPECT(r.ends.size() == 1 && pulses(r.ends[0]) == 6);
    EXPECT(r.ons().size() == 12);  // Every: one note per pulse

    TEST("Reverse and Pendulum");
    StageParams p;
    p.stages = 3;
    p.mode = StageReverse;
    StageSequencerDsp d;
    d.setPattern(pattern({2, 1, 3}));
    EXPECT(d.cycleLength(p) == 6);
    EXPECT(d.locate(p, 0).stage == 2 && d.locate(p, 3).stage == 1 && d.locate(p, 4).stage == 0);
    p.mode = StagePendulum;
    EXPECT(d.cycleLength(p) == 7);  // 0 1 2 1
    const int order[7] = {0, 0, 1, 2, 2, 2, 1};
    for (int i = 0; i < 7; ++i) EXPECT(d.locate(p, i).stage == order[i]);
    EXPECT(d.locate(p, 7).stage == 0 && d.locate(p, 7).cycleStart);
    p.stages = 1;
    EXPECT(d.cycleLength(p) == 2 && d.locate(p, 5).stage == 0);

    TEST("loop jump lands on the right stage and pulse");
    Rig j;
    j.dsp.setPattern(pattern({2, 1, 3}));
    j.p.stages = 3;
    Run rj;
    j.run(kPulse * 5, rj);
    j.ppq = 0.25 * 16 + 0.01;  // pulse 16: 16 mod 6 = 4 → stage 2, pulse 1
    j.run(10, rj);
    EXPECT(j.dsp.playingStage() == 2 && j.dsp.playingPulse() == 1);
    EXPECT(!rj.bad);
}

static void walks() {
    TEST("Random never repeats a stage");
    Rig rig;
    rig.dsp.setPattern(pattern({1, 2, 1, 1, 3}));
    rig.p.stages = 5;
    rig.p.mode = StageRandom;
    rig.p.phrase = 0;  // 1 bar
    Run r;
    rig.run(kPulse * 16 * 8, r);
    for (size_t i = 1; i < r.stageAtStart.size(); ++i)
        EXPECT(r.stageAtStart[i] != r.stageAtStart[i - 1] || pulses(r.starts[i]) % 16 == 0);

    TEST("Brownian moves by −1, 0 or +1 and restarts every phrase");
    Rig b;
    b.dsp.setPattern(pattern({1, 1, 1, 1, 1, 1}));
    b.p.stages = 6;
    b.p.mode = StageBrownian;
    b.p.phrase = 0;
    Run rb;
    b.run(kPulse * 16 * 4, rb);
    EXPECT(rb.stageAtStart.size() >= 60);
    for (size_t i = 1; i < rb.stageAtStart.size(); ++i) {
        const int64_t at = pulses(rb.starts[i]);
        if (at % 16 == 0) {
            EXPECT(rb.stageAtStart[i] == 0);
            continue;
        }
        const int d = ((rb.stageAtStart[i] - rb.stageAtStart[i - 1]) % 6 + 6) % 6;
        EXPECT(d == 0 || d == 1 || d == 5);
    }
    EXPECT(rb.ends.size() == 3);  // bars 2, 3, 4

    TEST("walks replay after a jump and with the same Seed");
    auto stagesFrom = [](int mode, uint32_t seed, double jumpTo) {
        Rig w;
        w.dsp.setPattern(pattern({1, 2, 3, 1, 2}));
        w.p.stages = 5;
        w.p.mode = mode;
        w.p.phrase = 1;  // 2 bars
        w.p.seed = seed;
        Run rw;
        if (jumpTo > 0.0) {
            w.run(kPulse * 7, rw);
            w.ppq = jumpTo;
            rw = Run{};
        }
        w.run(kPulse * 16 * 3, rw);
        return rw.stageAtStart;
    };
    for (int mode : {(int)StageRandom, (int)StageBrownian}) {
        const auto a = stagesFrom(mode, 3, 0.0), b2 = stagesFrom(mode, 3, 0.0), c = stagesFrom(mode, 4, 0.0);
        EXPECT(a == b2);
        EXPECT(a != c);
        // Jump to bar 2 (pulse 32 = a phrase start): the same walk as from the start.
        const auto j = stagesFrom(mode, 3, 8.0);
        Rig ref;
        ref.dsp.setPattern(pattern({1, 2, 3, 1, 2}));
        ref.p.stages = 5;
        ref.p.mode = mode;
        ref.p.phrase = 1;
        ref.p.seed = 3;
        const StagePosition p0 = ref.dsp.locate(ref.p, 32);
        EXPECT(!j.empty() && j[0] == p0.stage);
        EXPECT(p0.pulse == 0 && p0.cycleStart);
        // Walking on from pulse 32 and replaying pulse 50 from scratch agree.
        for (int64_t L = 33; L < 64; ++L) ref.dsp.locate(ref.p, L);
        const StagePosition walked = ref.dsp.locate(ref.p, 63);
        StageSequencerDsp fresh;
        fresh.setPattern(pattern({1, 2, 3, 1, 2}));
        const StagePosition replayed = fresh.locate(ref.p, 63);
        EXPECT(walked.stage == replayed.stage && walked.pulse == replayed.pulse && walked.visit == replayed.visit);
        if (mode == StageBrownian) EXPECT(p0.stage == 0);
    }
}

static void gateModes() {
    TEST("gate modes: note counts");
    auto count = [](uint8_t gate, int pulsesN, int ratchet = 2) {
        Rig rig;
        StagePattern p = pattern({pulsesN}, gate);
        p[0].ratchet = (uint8_t)ratchet;
        rig.dsp.setPattern(p);
        rig.p.stages = 1;
        Run r;
        rig.run(kPulse * pulsesN * 2 - 10, r);  // two passes of the stage
        return std::make_pair((int)r.ons().size(), r);
    };
    EXPECT(count(StageRest, 3).first == 0);
    EXPECT(count(StageFirst, 3).first == 2);
    EXPECT(count(StageEvery, 3).first == 6);
    EXPECT(count(StageHold, 3).first == 2);
    const auto rat = count(StageRatchet, 2, 3);
    EXPECT(rat.first == 12);  // 2 passes × 2 pulses × 3
    // Ratchet gates: Gate Length of a third of a pulse.
    int64_t high = 0;
    for (size_t i = 0; i < (size_t)kPulse; ++i) high += rat.second.gate[i] > 0.5f;
    EXPECT(std::llabs(high - 3 * (kPulse / 3) / 2) < 10);
    EXPECT(!rat.second.bad);

    TEST("Hold gate spans the stage, retriggers at the next one");
    const auto hold = count(StageHold, 3);
    int64_t highH = 0;
    for (size_t i = 0; i < (size_t)(3 * kPulse); ++i) highH += hold.second.gate[i] > 0.5f;
    EXPECT(highH >= 3 * kPulse - 2);  // low only for the retrigger sample
    EXPECT(hold.second.gate[3 * kPulse + 1] > 0.5f);
}

static void slides() {
    TEST("slide: legato, gate high, pitch glides");
    StagePattern p = pattern({1, 1});
    p[0].pitch = 0;
    p[1].pitch = 12;
    p[1].slide = true;
    Rig rig;
    rig.dsp.setPattern(p);
    rig.p.stages = 2;
    rig.p.slideTime = 0.05f;  // 2400 samples
    Run r;
    rig.run(kPulse * 2 - 100, r);
    std::vector<Note> at;
    for (const auto& n : r.notes)
        if (n.at >= kPulse - 2 && n.at <= kPulse + 2) at.push_back(n);
    EXPECT(at.size() == 2 && at[0].on && !at[1].on && at[0].note == 72);
    bool gateHigh = true;
    for (int64_t i = 0; i < kPulse + 100; ++i) gateHigh = gateHigh && r.gate[(size_t)i] > 0.5f;
    EXPECT(gateHigh);  // the previous gate extends to the boundary, the slide keeps it up
    const int64_t s = at.empty() ? kPulse : at[0].at;
    EXPECT(r.pitch[(size_t)s + 2400] >= 0.99f && r.pitch[(size_t)s + 2400] < 1.0f);
    EXPECT(r.pitch[(size_t)s + 600] < 0.9f);

    TEST("slide into Rest is ignored");
    StagePattern q = pattern({1, 1});
    q[1].gate = StageRest;
    q[1].slide = true;
    Rig b;
    b.dsp.setPattern(q);
    b.p.stages = 2;
    Run rb;
    b.run(kPulse * 2 - 10, rb);
    EXPECT(rb.ons().size() == 1);
    EXPECT(rb.gate[(size_t)kPulse - 100] < 0.5f);  // stage 1 kept its own Gate Length
    EXPECT(rb.sounding() == 0);
}

static void accents() {
    TEST("accent velocity and gate");
    StagePattern p = pattern({1, 1});
    p[0].velocity = 60;
    p[0].accent = true;
    p[1].velocity = 60;
    Rig rig;
    rig.dsp.setPattern(p);
    rig.p.stages = 2;
    rig.p.accent = 0.5f;
    Run r;
    rig.run(kPulse * 2, r);
    const auto o = r.ons();
    EXPECT(o.size() == 2);
    if (o.size() == 2) {
        EXPECT_NEAR(o[0].velocity, (60.0 + 0.5 * 67.0) / 127.0, 1e-4);
        EXPECT_NEAR(o[1].velocity, 60.0 / 127.0, 1e-4);
    }
    EXPECT(r.accent[100] > 0.5f && r.accent[(size_t)kPulse + 100] < 0.5f);
    EXPECT(r.accent[(size_t)kPulse / 2 + 100] < 0.5f);  // only while the note sounds
}

static void hold() {
    TEST("Hold repeats the stage, Transport rejoins in phase");
    Rig rig;
    rig.dsp.setPattern(pattern({2, 2, 2, 2}));
    rig.p.stages = 4;
    Run r;
    rig.run(kPulse * 3, r);  // stage 1, pulse 1
    rig.in.hold = 1.0f;
    rig.run(kPulse * 4, r);
    EXPECT(rig.dsp.playingStage() == 1);
    rig.in.hold = 0.0f;
    rig.run(kPulse + 10, r);  // pulse 8 → stage 0 (cycle 8)
    EXPECT(rig.dsp.playingStage() == 0 && rig.dsp.playingPulse() == 0);

    TEST("Hold in Clock mode continues where it left off");
    Rig c;
    c.dsp.setPattern(pattern({1, 1, 1, 1}));
    c.p.stages = 4;
    c.in.clockPatched = true;
    Run rc;
    std::vector<int> seen;
    for (int k = 0; k < 10; ++k) {
        c.in.hold = k >= 2 && k < 6 ? 1.0f : 0.0f;
        c.in.clock = 1.0f;
        c.run(1, rc);
        c.in.clock = 0.0f;
        c.run(999, rc);
        seen.push_back(c.dsp.playingStage());
    }
    const std::vector<int> want{0, 1, 1, 1, 1, 1, 2, 3, 0, 1};
    EXPECT(seen == want);
    EXPECT(!rc.bad);
}

static void noHanging() {
    TEST("no hanging notes");
    StagePattern p = pattern({3, 2, 1}, StageHold);
    Rig rig;
    rig.dsp.setPattern(p);
    rig.p.stages = 3;
    Run r;
    rig.run(kPulse + 5, r);
    EXPECT(r.sounding() == 1);
    rig.t.running = false;
    rig.run(5, r);
    EXPECT(r.sounding() == 0);
    rig.t.running = true;
    rig.run(kPulse, r);
    EXPECT(r.sounding() == 1);
    rig.in.reset = 1.0f;
    rig.run(1, r);
    rig.in.reset = 0.0f;
    EXPECT(r.sounding() == 0);
    rig.run(kPulse * 2, r);
    EXPECT(r.sounding() == 1);
    rig.p.stages = 2;
    rig.run(1, r);
    EXPECT(r.sounding() == 0);
    rig.run(kPulse * 2, r);
    StagePattern q = p;
    q[(size_t)rig.dsp.playingStage()].gate = StageEvery;
    rig.dsp.setPattern(q);
    rig.run(1, r);
    EXPECT(r.sounding() == 0);
    rig.run(kPulse * 2, r);
    rig.p.mode = StageRandom;
    rig.run(1, r);
    EXPECT(r.sounding() == 0);
    rig.run(kPulse * 40, r);
    rig.t.running = false;
    rig.run(1, r);
    EXPECT(r.sounding() == 0);
    EXPECT(!r.bad);
}

int main() {
    fixedOrders();
    walks();
    gateModes();
    slides();
    accents();
    hold();
    noHanging();
    return bleep::test::finish("stage-sequencer");
}
