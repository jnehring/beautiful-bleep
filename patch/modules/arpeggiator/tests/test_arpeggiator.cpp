// SPDX-License-Identifier: GPL-3.0-or-later
// Arpeggiator: pattern order, octaves, latch, gate length, clock mode,
// transport lock, release on empty/stop, no hanging notes.
#include "ArpeggiatorDsp.h"

#include "dsp/tests/TestUtil.h"

#include <map>
#include <vector>

using namespace bleep;
using patch::ArpeggiatorDsp;
using patch::ArpOutputs;
using patch::ArpParams;
using patch::ArpTime;

static constexpr double kSr = 48000.0;
static constexpr double kBpm = 120.0;

struct Ev {
    bool on;
    int note;
    int64_t at;
};

/// Transport rig: 1/16 steps at 120 BPM = 6000 samples.
struct Rig {
    ArpeggiatorDsp dsp;
    ArpParams p;
    ArpTime t;
    ArpOutputs out;
    std::vector<Ev> events;
    std::map<int, int> sounding;
    int64_t n = 0;
    float clock = 0.0f;
    bool clocked = false;
    Rig() {
        dsp.prepare(kSr);
        dsp.reset();
        t.running = true;
        t.started = true;
        t.bpm = kBpm;
    }
    void tick() {
        t.ppq = (double)n / kSr * kBpm / 60.0;
        dsp.tick(p, clock, clocked, 0.0f, t, out, [&](bool on, int note, float, float) {
            events.push_back({on, note, n});
            sounding[note] += on ? 1 : -1;
        });
        t.started = false;
        ++n;
    }
    void run(int64_t k) {
        for (int64_t i = 0; i < k; ++i) tick();
    }
    void press(std::initializer_list<int> notes) {
        for (int k : notes) dsp.noteOn(k, (float)(k - 60) / 12.0f, 0.8f, p.latch);
    }
    void release(std::initializer_list<int> notes) {
        for (int k : notes) dsp.noteOff(k, p.latch);
    }
    std::vector<int> played() const {
        std::vector<int> v;
        for (const auto& e : events)
            if (e.on) v.push_back(e.note);
        return v;
    }
    int soundingCount() const {
        int c = 0;
        for (const auto& [k, v] : sounding) {
            EXPECT(v == 0 || v == 1);
            c += v;
        }
        return c;
    }
};

static std::vector<int> firstN(const std::vector<int>& v, size_t k) { return {v.begin(), v.begin() + (long)std::min(k, v.size())}; }

static void patternsOrder() {
    TEST("pattern order");
    struct Case {
        int pattern;
        std::vector<int> expect;
    };
    // Held, in the order played: 64 60 67 (sorted: 60 64 67).
    const std::vector<Case> cases = {
        {patch::ArpUp, {60, 64, 67, 60, 64, 67}},
        {patch::ArpDown, {67, 64, 60, 67, 64, 60}},
        {patch::ArpUpDown, {60, 64, 67, 64, 60, 64}},
        {patch::ArpDownUp, {67, 64, 60, 64, 67, 64}},
        {patch::ArpUpAndDown, {60, 64, 67, 67, 64, 60, 60}},
        {patch::ArpPlayed, {64, 60, 67, 64, 60, 67}},
        {patch::ArpConverge, {60, 67, 64, 60, 67, 64}},
        {patch::ArpDiverge, {64, 67, 60, 64, 67, 60}},
    };
    for (const auto& c : cases) {
        Rig r;
        r.p.pattern = c.pattern;
        r.press({64, 60, 67});
        r.run(6000 * (int64_t)c.expect.size() - 100);
        EXPECT(firstN(r.played(), c.expect.size()) == c.expect);
    }
}

static void octaves() {
    TEST("octaves");
    Rig r;
    r.p.octaves = 2;
    r.press({60, 64});
    r.run(6000 * 4 - 100);
    EXPECT((r.played() == std::vector<int>{60, 64, 72, 76}));
    Rig clamp;
    clamp.p.octaves = 4;
    clamp.press({120});
    clamp.run(6000 * 4 - 100);
    for (int k : clamp.played()) EXPECT(k >= 0 && k <= 127);
}

static void gateLength() {
    TEST("gate length");
    Rig r;
    r.p.gateLength = 0.5f;
    r.press({60});
    r.run(6000 * 2 - 100);
    // Note-on at the step, note-off half a step later, then again.
    EXPECT(r.events.size() >= 3);
    EXPECT(r.events[0].on && !r.events[1].on);
    EXPECT(r.events[1].at - r.events[0].at == 3000);
    EXPECT(r.events[2].at - r.events[0].at == 6000);
}

static void silentWithoutNotes() {
    TEST("silent without notes");
    Rig r;
    r.run(6000 * 3);
    EXPECT(r.events.empty());
    r.press({60});
    r.run(6000 * 2);
    EXPECT(!r.events.empty());
    r.release({60});
    r.run(1);
    EXPECT(r.soundingCount() == 0);  // the note ends with the key
    const auto before = r.events.size();
    r.run(6000 * 3);
    EXPECT(r.events.size() == before);
}

static void latch() {
    TEST("latch");
    Rig r;
    r.p.latch = true;
    r.press({60, 64});
    r.release({60, 64});
    r.run(6000 * 4 - 100);
    EXPECT((firstN(r.played(), 4) == std::vector<int>{60, 64, 60, 64}));  // still playing after release
    // A new chord replaces the latched one.
    r.press({67});
    r.run(6000 * 2);
    EXPECT(r.played().back() == 67);
    // Latch off drops the held notes.
    r.release({67});
    r.p.latch = false;
    r.dsp.latchOff();
    r.run(1);
    EXPECT(r.soundingCount() == 0);
    EXPECT(r.dsp.heldCount() == 0);
}

static void playingWhileHeldChanges() {
    TEST("held set changes mid-pattern");
    Rig r;
    r.press({60});
    r.run(6000 * 2 - 100);
    r.press({64, 67});
    r.run(6000 * 3);
    EXPECT(r.soundingCount() <= 1);
    bool saw64 = false;
    for (int k : r.played()) saw64 |= k == 64;
    EXPECT(saw64);
}

static void clockMode() {
    TEST("clock mode");
    Rig r;
    r.clocked = true;
    r.p.pattern = patch::ArpUp;
    r.press({60, 64});
    // A pulse every 4800 samples; the first pulse plays the first note.
    for (int i = 0; i < 4800 * 4; ++i) {
        r.clock = (i % 4800) < 10 ? 1.0f : 0.0f;
        r.tick();
    }
    EXPECT((firstN(r.played(), 4) == std::vector<int>{60, 64, 60, 64}));
    EXPECT(r.events[0].at == 0);
}

static void transportStopReleases() {
    TEST("transport stop releases");
    Rig r;
    r.press({60});
    r.run(100);
    EXPECT(r.soundingCount() == 1);
    r.t.running = false;
    r.run(1);
    EXPECT(r.soundingCount() == 0);
}

static void clearHeldReleases() {
    TEST("cable removed");
    Rig r;
    r.press({60});
    r.run(100);
    r.dsp.clearHeld();
    r.run(1);
    EXPECT(r.soundingCount() == 0);
    r.run(6000 * 2);
    EXPECT(r.soundingCount() == 0);
}

static void randomIsRepeatable() {
    TEST("random is seeded");
    auto run = [](uint32_t seed) {
        Rig r;
        r.p.pattern = patch::ArpRandom;
        r.p.seed = seed;
        r.press({60, 62, 64, 65, 67});
        r.run(6000 * 16 - 100);
        return r.played();
    };
    EXPECT(run(3) == run(3));
    EXPECT(run(3) != run(4));
    for (int k : run(3)) EXPECT(k >= 60 && k <= 67);
}

static void noHangingNotes() {
    TEST("never more than one note, always ends");
    Rig r;
    r.p.pattern = patch::ArpUpDown;
    r.p.octaves = 3;
    r.p.gateLength = 1.0f;
    r.press({60, 64, 67});
    for (int i = 0; i < 20; ++i) {
        r.run(5000);
        EXPECT(r.soundingCount() <= 1);
    }
    r.release({60, 64, 67});
    r.run(1);
    EXPECT(r.soundingCount() == 0);
}

int main() {
    patternsOrder();
    octaves();
    gateLength();
    silentWithoutNotes();
    latch();
    playingWhileHeldChanges();
    clockMode();
    transportStopReleases();
    clearHeldReleases();
    randomIsRepeatable();
    noHangingNotes();
    return bleep::test::finish("arpeggiator");
}
