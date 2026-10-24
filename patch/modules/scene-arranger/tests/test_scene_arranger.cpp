// SPDX-License-Identifier: GPL-3.0-only
// Scene Arranger: play order with repeats, every follow action, launch
// quantize, Next/Previous/Launch, the Scene CV (matches a 16-slot selector),
// lane gates and triggers, Reset, transport start/stop/jump.
#include "SceneArrangerDsp.h"

#include "dsp/tests/TestUtil.h"

#include <set>
#include <vector>

using namespace bleep;
using patch::SaInput;
using patch::SaOutputs;
using patch::SaParams;
using patch::SceneArrangerDsp;

static constexpr double kSr = 48000.0;
static constexpr int kBeat = 200;  // samples per pulse in Clock mode

struct Rig {
    SceneArrangerDsp dsp;
    SaParams p;
    SaInput in;
    SaOutputs out;
    int64_t t = 0;
    int changes = 0, cycles = 0;
    float lastChange = 0, lastCycle = 0;
    std::vector<int> sceneAtBeat;  ///< scene right after each pulse (+ a few samples)
    Rig() {
        dsp.prepare(kSr);
        dsp.reset();
        in.clocked = true;
        p.lenBeats = 1;
    }
    void tick() {
        dsp.tick(p, in, out);
        if (out.change > 0.5f && lastChange <= 0.5f) ++changes;
        if (out.cycle > 0.5f && lastCycle <= 0.5f) ++cycles;
        lastChange = out.change;
        lastCycle = out.cycle;
        ++t;
    }
    /// n pulses; the scene is sampled 50 samples after each.
    void pulses(int n) {
        for (int k = 0; k < n; ++k)
            for (int i = 0; i < kBeat; ++i) {
                in.clock = i < 10 ? 1.0f : 0.0f;
                tick();
                if (i == 50) sceneAtBeat.push_back(dsp.scene());
            }
        in.reset = in.next = in.prev = 0.0f;
    }
    int sceneNow() const { return dsp.scene(); }
};

static std::vector<int> oneBased(const std::vector<int>& v) {
    std::vector<int> r;
    for (int s : v) r.push_back(s + 1);
    return r;
}

static void orderAndRepeats() {
    TEST("scene arranger: play order and repeats");
    Rig r;
    r.p.scenes = 4;
    r.p.steps = 3;
    r.p.slotScene[0] = 1, r.p.slotScene[1] = 3, r.p.slotScene[2] = 2;
    r.p.slotRepeat[0] = 2, r.p.slotRepeat[1] = 1, r.p.slotRepeat[2] = 3;
    r.pulses(13);
    EXPECT((oneBased(r.sceneAtBeat) == std::vector<int>{1, 1, 3, 2, 2, 2, 1, 1, 3, 2, 2, 2, 1}));
    EXPECT(r.cycles == 2);
    EXPECT(r.changes == 7);  // one per visit: 1, 3, 2, 1, 3, 2, 1
    // Scene Length of 2 beats doubles every visit.
    Rig q;
    q.p.scenes = 4;
    q.p.steps = 2;
    q.p.lenBeats = 2;
    q.p.slotScene[0] = 4, q.p.slotScene[1] = 2;
    q.pulses(9);
    EXPECT((oneBased(q.sceneAtBeat) == std::vector<int>{4, 4, 2, 2, 4, 4, 2, 2, 4}));
}

static void followActions() {
    TEST("scene arranger: follow actions");
    // Next / Previous leave the list.
    Rig a;
    a.p.scenes = 5;
    a.p.steps = 1;
    a.p.slotScene[0] = 2;
    a.p.follow[1] = patch::FollowNext;
    a.p.follow[2] = patch::FollowNext;
    a.p.follow[3] = patch::FollowPrevious;
    a.pulses(8);
    EXPECT((oneBased(a.sceneAtBeat) == std::vector<int>{2, 3, 4, 3, 4, 3, 4, 3}));
    // Hold stays forever.
    Rig h;
    h.p.scenes = 4;
    h.p.follow[1] = patch::FollowHold;
    h.pulses(12);
    EXPECT((oneBased(h.sceneAtBeat) == std::vector<int>{1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2}));
    // Jump.
    Rig j;
    j.p.scenes = 6;
    j.p.follow[2] = patch::FollowJump;
    j.p.target[2] = 6;
    j.p.follow[5] = patch::FollowJump;
    j.p.target[5] = 2;
    j.pulses(7);
    EXPECT((oneBased(j.sceneAtBeat) == std::vector<int>{1, 2, 3, 6, 2, 3, 6}));
    // Random: never the same scene twice, covers the others, repeats with the same seed.
    Rig r1, r2, r3;
    for (Rig* r : {&r1, &r2, &r3}) {
        r->p.scenes = 5;
        for (int s = 0; s < 5; ++s) r->p.follow[s] = patch::FollowRandom;
    }
    r3.p.seed = 42;
    r1.pulses(100);
    r2.pulses(100);
    r3.pulses(100);
    std::set<int> seen;
    for (size_t i = 1; i < r1.sceneAtBeat.size(); ++i) {
        EXPECT(r1.sceneAtBeat[i] != r1.sceneAtBeat[i - 1]);
        seen.insert(r1.sceneAtBeat[i]);
    }
    EXPECT(seen.size() == 5);
    EXPECT(r1.sceneAtBeat == r2.sceneAtBeat);
    EXPECT(r1.sceneAtBeat != r3.sceneAtBeat);
    // Chance 0: the order; chance 1: the jump; in between: a mix.
    for (float chance : {0.0f, 1.0f, 0.5f}) {
        Rig c;
        c.p.scenes = 4;
        c.p.follow[0] = patch::FollowChance;
        c.p.target[0] = 4;
        c.p.chance[0] = chance;
        c.pulses(200);
        int toFour = 0, toTwo = 0;
        for (size_t i = 1; i < c.sceneAtBeat.size(); ++i)
            if (c.sceneAtBeat[i - 1] == 0) (c.sceneAtBeat[i] == 3 ? toFour : toTwo) += 1;
        if (chance == 0.0f) EXPECT(toFour == 0 && toTwo > 10);
        if (chance == 1.0f) EXPECT(toTwo == 0 && toFour > 10);
        if (chance == 0.5f) EXPECT(toFour > 8 && toTwo > 8);
    }
}

static void launching() {
    TEST("scene arranger: launch quantize, Next, Previous, Launch");
    // Immediate: the scene changes on the sample.
    Rig a;
    a.p.scenes = 8;
    a.p.lenBeats = 64;  // the order will not move by itself
    a.p.quantize = patch::QuantImmediate;
    a.pulses(2);
    EXPECT(a.sceneNow() == 0);
    a.p.launch = 5;
    a.tick();
    EXPECT(a.sceneNow() == 4);
    // Beat: waits for the next pulse and shows Queued.
    Rig b;
    b.p.scenes = 8;
    b.p.lenBeats = 64;
    b.p.quantize = patch::QuantBeat;
    b.pulses(2);
    b.p.launch = 7;
    for (int i = 0; i < 20; ++i) b.tick();
    EXPECT(b.sceneNow() == 0 && b.out.queued > 0.5f);
    b.pulses(1);
    EXPECT(b.sceneNow() == 6 && b.out.queued < 0.5f);
    // Bar: waits for beat 0 of the next bar (4 beats per bar).
    Rig c;
    c.p.scenes = 8;
    c.p.lenBeats = 64;
    c.p.quantize = patch::QuantBar;
    c.pulses(2);  // beats 0, 1
    c.in.next = 1.0f;
    c.tick();
    c.in.next = 0.0f;
    c.pulses(1);  // beat 2
    EXPECT(c.sceneNow() == 0 && c.out.queued > 0.5f);
    c.pulses(1);  // beat 3
    EXPECT(c.sceneNow() == 0);
    c.pulses(1);  // beat 4 = a bar line
    EXPECT(c.sceneNow() == 1 && c.out.queued < 0.5f);
    // Previous wraps; two launches before the bar: the later one wins.
    Rig d;
    d.p.scenes = 4;
    d.p.lenBeats = 64;
    d.p.quantize = patch::QuantImmediate;
    d.pulses(1);
    d.in.prev = 1.0f;
    d.tick();
    d.in.prev = 0.0f;
    EXPECT(d.sceneNow() == 3);
    d.in.next = 1.0f;
    d.tick();
    d.in.next = 0.0f;
    EXPECT(d.sceneNow() == 0);
    // The Launch jack: scene = floor(v * 16), only on a change.
    Rig e;
    e.p.scenes = 16;
    e.p.lenBeats = 64;
    e.in.launchPatched = true;
    e.in.launchCv = 9.5f / 16.0f;
    e.pulses(2);
    EXPECT(e.sceneNow() == 9);
    e.in.launchCv = 0.0f;
    e.tick();
    EXPECT(e.sceneNow() == 0);
    // A launch is a new visit: the repeats of its slot start counting.
    Rig f;
    f.p.scenes = 4;
    f.p.steps = 4;
    f.p.slotRepeat[2] = 3;
    f.p.quantize = patch::QuantImmediate;
    f.pulses(1);
    f.p.launch = 3;
    f.tick();
    f.pulses(4);  // the partial unit counts as the first of three
    EXPECT((oneBased(f.sceneAtBeat) == std::vector<int>{1, 3, 3, 4, 1}));
}

static void sceneCvAndLanes() {
    TEST("scene arranger: Scene CV and lanes");
    Rig a;
    a.p.scenes = 12;
    a.p.lenBeats = 64;
    for (int s = 0; s < 12; ++s) {
        a.p.launch = s + 1;
        a.tick();
        EXPECT((int)std::floor(a.out.scene * 16.0f) == s);  // what a 16-slot pattern select reads
    }
    a.p.cvLinear = true;
    a.p.launch = 16;
    a.p.scenes = 16;
    a.tick();
    EXPECT(std::fabs(a.out.scene - 1.0f) < 1e-6f);
    // Lanes: one-hot by default; a range; a lane that is off.
    Rig l;
    l.p.scenes = 8;
    l.p.lenBeats = 64;
    l.p.laneFrom[1] = 2, l.p.laneTo[1] = 4;
    l.p.laneFrom[7] = 0;
    l.pulses(1);
    EXPECT(l.out.lane[0] > 0.5f && l.out.lane[1] < 0.5f);
    for (int s = 0; s < 8; ++s) {
        l.p.launch = s + 1;
        l.tick();
        l.tick();
        for (int k = 0; k < 7; ++k) {
            bool want = k == 1 ? (s >= 1 && s <= 3) : k == s;
            EXPECT((l.out.lane[k] > 0.5f) == want);
        }
        EXPECT(l.out.lane[7] < 0.5f);
    }
    // Trigger mode: a short pulse when a scene in the lane's range starts.
    Rig t;
    t.p.scenes = 4;
    t.p.steps = 4;
    t.p.laneTrigger = true;
    t.p.laneFrom[2] = 1, t.p.laneTo[2] = 4;
    int rises[8]{};
    float last[8]{};
    for (int k = 0; k < 8; ++k) last[k] = 0;
    for (int i = 0; i < 4; ++i)
        for (int j = 0; j < kBeat; ++j) {
            t.in.clock = j < 10 ? 1.0f : 0.0f;
            t.tick();
            for (int k = 0; k < 8; ++k) {
                if (t.out.lane[k] > 0.5f && last[k] <= 0.5f) ++rises[k];
                last[k] = t.out.lane[k];
            }
        }
    EXPECT(rises[0] == 1 && rises[1] == 1 && rises[2] == 4 && rises[3] == 1 && rises[4] == 0);
}

static void resetAndTransport() {
    TEST("scene arranger: reset and the transport");
    Rig r;
    r.p.scenes = 4;
    r.pulses(3);
    EXPECT(r.sceneNow() == 2);
    r.in.reset = 1.0f;
    r.tick();
    r.in.reset = 0.0f;
    EXPECT(r.sceneNow() == 0);
    r.sceneAtBeat.clear();
    r.pulses(3);
    EXPECT((oneBased(r.sceneAtBeat) == std::vector<int>{1, 2, 3}));  // the reset beat does not count as a finished unit

    // Transport: 120 BPM, a pulse every beat; loop jumps do not advance.
    Rig t;
    t.in.clocked = false;
    t.in.running = true;
    t.in.ppqPerSample = 2.0 / kSr;
    t.p.scenes = 4;
    t.p.lenBeats = 1;
    auto play = [&](int64_t n) {
        for (int64_t i = 0; i < n; ++i) {
            t.in.started = t.t == 0;
            t.tick();
            t.in.ppq += t.in.ppqPerSample;
        }
    };
    const int64_t beat = (int64_t)(kSr / 2);
    play(beat * 2 + 100);  // beats 0, 1, 2
    EXPECT(t.sceneNow() == 2);
    t.in.ppq = 0.0;  // loop back to the start
    play(100);
    EXPECT(t.sceneNow() == 2);  // a jump re-syncs, it does not play catch-up
    play(beat);
    EXPECT(t.sceneNow() == 3);
    // Stop: lanes go low; a launch made while stopped decides where play starts.
    t.in.running = false;
    play(10);
    for (int k = 0; k < 8; ++k) EXPECT(t.out.lane[k] < 0.5f);
    t.p.launch = 2;
    play(10);
    EXPECT(t.sceneNow() == 1);
    t.in.running = true;
    t.in.ppq = 0.0;
    t.in.started = true;
    t.tick();
    EXPECT(t.sceneNow() == 1);
    // A plain start (no launch) begins at slot 1.
    Rig u;
    u.in.clocked = false;
    u.in.running = true;
    u.in.ppqPerSample = 2.0 / kSr;
    u.p.slotScene[0] = 3;
    u.in.started = true;
    u.tick();
    EXPECT(u.sceneNow() == 2);
}

int main() {
    orderAndRepeats();
    followActions();
    launching();
    sceneCvAndLanes();
    resetAndTransport();
    return test::finish("scene-arranger");
}
