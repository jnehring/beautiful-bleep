// SPDX-License-Identifier: GPL-3.0-only
// Harmony Master: diatonic stacking, detection with the 30 ms window, Scale
// Policy Adapt, progression timing (Transport, Trigger, Select), Transpose,
// and the Notes output (common tones held, note-ons first, nothing hangs).
#include "HarmonyMasterDsp.h"

#include "dsp/tests/TestUtil.h"

#include <map>
#include <vector>

using namespace bleep;
using patch::HarmonyMasterDsp;
using patch::HmInput;
using patch::HmOutputs;
using patch::HmParams;
using patch::HmProgression;

static constexpr double kSr = 48000.0;

struct Ev {
    bool on;
    int note;
    int64_t at;
};

/// Runs a DSP and keeps track of the notes it plays.
struct Rig {
    HarmonyMasterDsp dsp;
    HmParams p;
    HmInput in;
    HmOutputs out;
    std::vector<Ev> events;
    std::map<int, int> sounding;
    int64_t t = 0;
    int changes = 0;
    std::vector<int64_t> changeAt;
    Rig() {
        dsp.prepare(kSr);
        dsp.reset();
    }
    void tick() {
        dsp.tick(p, in, out, 64, [&](bool on, int note, float, float) {
            events.push_back({on, note, t});
            sounding[note] += on ? 1 : -1;
        });
        if (out.change > 0.5f) {
            ++changes;
            changeAt.push_back(t);
        }
        ++t;
    }
    void run(int64_t n) {
        for (int64_t i = 0; i < n; ++i) tick();
    }
    int soundingCount() const {
        int n = 0;
        for (const auto& [k, v] : sounding) {
            EXPECT(v == 0 || v == 1);
            n += v;
        }
        return n;
    }
};

static uint16_t mask(const char* name) {
    for (const auto& s : dsp::scales())
        if (std::string(s.name) == name) return s.mask;
    return 0xfff;
}

static void diatonic() {
    TEST("harmony master: diatonic triads and sevenths");
    const uint16_t major = mask("Major"), minor = mask("Natural Minor"), penta = mask("Major Pentatonic");
    const int majorTriads[7] = {dsp::ChordMajor, dsp::ChordMinor, dsp::ChordMinor, dsp::ChordMajor,
                                dsp::ChordMajor, dsp::ChordMinor, dsp::ChordDiminished};
    const int majorRoots[7] = {0, 2, 4, 5, 7, 9, 11};
    for (int d = 0; d < 7; ++d) {
        const auto h = HarmonyMasterDsp::build(0, major, d, -1, patch::kHmDiatonicTriad, -1, false);
        EXPECT(h.valid && h.chordRoot == majorRoots[d] && h.quality == majorTriads[d] && h.degree == d + 1);
    }
    const int majorSevenths[7] = {dsp::ChordMajor7, dsp::ChordMinor7, dsp::ChordMinor7, dsp::ChordMajor7,
                                  dsp::ChordDominant7, dsp::ChordMinor7, dsp::ChordHalfDiminished7};
    for (int d = 0; d < 7; ++d)
        EXPECT(HarmonyMasterDsp::build(0, major, d, -1, patch::kHmDiatonicSeventh, -1, false).quality == majorSevenths[d]);
    // A natural minor: i iv v are minor, III VI VII major.
    const int minorTriads[7] = {dsp::ChordMinor, dsp::ChordDiminished, dsp::ChordMajor, dsp::ChordMinor,
                                dsp::ChordMinor, dsp::ChordMajor, dsp::ChordMajor};
    for (int d = 0; d < 7; ++d) {
        const auto h = HarmonyMasterDsp::build(9, minor, d, -1, patch::kHmDiatonicTriad, -1, false);
        EXPECT(h.quality == minorTriads[d] && h.key == 9);
    }
    // Pentatonic: open stacks, roots on the five notes, degrees past 5 wrap.
    for (int d = 0; d < 7; ++d) {
        const auto h = HarmonyMasterDsp::build(0, penta, d, -1, patch::kHmDiatonicTriad, -1, false);
        EXPECT(h.valid && dsp::inScale(penta, h.chordRoot));
        EXPECT(dsp::popcount12(h.chord) == 3);
    }
    // Chromatic: major / dominant 7 on the semitone.
    EXPECT(HarmonyMasterDsp::build(0, 0xfff, 3, -1, patch::kHmDiatonicTriad, -1, false).quality == dsp::ChordMajor);
    EXPECT(HarmonyMasterDsp::build(0, 0xfff, 3, -1, patch::kHmDiatonicSeventh, -1, false).quality == dsp::ChordDominant7);
    // An explicit quality on a degree; an absolute root; a slash bass.
    const auto sus = HarmonyMasterDsp::build(0, major, 1, -1, dsp::ChordSus4, -1, false);
    EXPECT(sus.chordRoot == 2 && sus.quality == dsp::ChordSus4);
    const auto abs = HarmonyMasterDsp::build(0, major, 0, 5, dsp::ChordMajor7, 9, false);
    EXPECT(abs.chordRoot == 5 && abs.quality == dsp::ChordMajor7 && abs.bass == 9 && abs.degree == 4);
    const auto outside = HarmonyMasterDsp::build(0, major, 0, 8, patch::kHmDiatonicTriad, -1, false);
    EXPECT(outside.chordRoot == 8 && outside.quality == dsp::ChordMajor && outside.degree == 0);
}

static void adapt() {
    TEST("harmony master: scale policy");
    const uint16_t minor = mask("Natural Minor"), harmonic = mask("Harmonic Minor");
    // A minor + E major (degree 5 with an explicit Major).
    const auto keep = HarmonyMasterDsp::build(9, minor, 4, -1, dsp::ChordMajor, -1, false);
    EXPECT(keep.scale == minor);
    const auto adapted = HarmonyMasterDsp::build(9, minor, 4, -1, dsp::ChordMajor, -1, true);
    EXPECT(adapted.scale == harmonic);
    EXPECT(adapted.degree == 5);
}

static void detection() {
    TEST("harmony master: detection");
    Rig r;
    r.p.source = patch::HmSrcDetect;
    auto play = [&](std::initializer_list<int> notes) {
        for (int n : notes) r.dsp.noteOn(n);
        r.run((int64_t)(0.05 * kSr));
    };
    auto releaseAll = [&](std::initializer_list<int> notes) {
        for (int n : notes) r.dsp.noteOff(n);
        r.run((int64_t)(0.05 * kSr));
    };
    play({62, 65, 69});  // D F A
    EXPECT(r.dsp.context().chordRoot == 2 && r.dsp.context().quality == dsp::ChordMinor);
    releaseAll({62, 65, 69});
    EXPECT(r.dsp.context().chordRoot == 2);  // latched
    play({57, 60, 64, 67});  // A C E G over A: Am7
    EXPECT(r.dsp.context().chordRoot == 9 && r.dsp.context().quality == dsp::ChordMinor7);
    releaseAll({57, 60, 64, 67});
    play({48, 52, 55, 57});  // C E G A over C: C6
    EXPECT(r.dsp.context().chordRoot == 0 && r.dsp.context().quality == dsp::ChordMajor6 && r.dsp.context().bass == 0);
    releaseAll({48, 52, 55, 57});
    play({52, 60, 67});  // C/E
    EXPECT(r.dsp.context().chordRoot == 0 && r.dsp.context().quality == dsp::ChordMajor && r.dsp.context().bass == 4);
    releaseAll({52, 60, 67});
    play({55});
    EXPECT(r.dsp.context().chordRoot == 7 && r.dsp.context().quality == dsp::ChordUnison);
    releaseAll({55});
    play({50, 57});
    EXPECT(r.dsp.context().chordRoot == 2 && r.dsp.context().quality == dsp::ChordFifth);
    releaseAll({50, 57});

    // A strum over 20 ms: one change.
    const int before = r.changes;
    const int strum[4] = {48, 52, 55, 59};  // Cmaj7
    for (int n : strum) {
        r.dsp.noteOn(n);
        r.run((int64_t)(0.0066 * kSr));
    }
    r.run((int64_t)(0.05 * kSr));
    EXPECT(r.changes == before + 1);
    EXPECT(r.dsp.context().quality == dsp::ChordMajor7);

    // Latch off: back to the Manual chord when everything is released.
    r.p.latch = false;
    r.p.degree = 5;
    releaseAll({48, 52, 55, 59});
    EXPECT(r.dsp.context().chordRoot == 7);
}

static void progressionTransport() {
    TEST("harmony master: progression, transport advance");
    static HmProgression prog = HmProgression::defaults();  // I vi IV V, 4 beats each
    Rig r;
    r.dsp.setProgression(&prog);
    r.p.source = patch::HmSrcProgression;
    r.in.running = true;
    const double bpm = 120.0, ppqPerSample = bpm / 60.0 / kSr;
    std::vector<int> roots;
    for (int64_t i = 0; i < (int64_t)(16.0 / ppqPerSample) + 10; ++i) {
        r.in.ppq = (double)i * ppqPerSample;
        r.in.started = i == 0;
        r.tick();
        if (roots.empty() || roots.back() != r.dsp.context().chordRoot) roots.push_back(r.dsp.context().chordRoot);
    }
    EXPECT(roots.size() == 5 && roots[0] == 0 && roots[1] == 9 && roots[2] == 5 && roots[3] == 7 && roots[4] == 0);
    // Changes on the exact samples where the beat count crosses 4, 8, 12, 16.
    EXPECT(r.changeAt.size() == 4);
    for (size_t k = 0; k < r.changeAt.size(); ++k) {
        const int64_t at = r.changeAt[k];
        EXPECT((double)at * ppqPerSample >= 4.0 * (double)(k + 1) - 1e-9);
        EXPECT((double)(at - 1) * ppqPerSample < 4.0 * (double)(k + 1));
    }
    // Loop jump into the third slot.
    r.in.ppq = 9.5;
    r.tick();
    EXPECT(r.dsp.context().chordRoot == 5 && r.dsp.slot() == 2);
    // Transport stop: every note ends; the chord holds.
    r.in.running = false;
    r.tick();
    EXPECT(r.soundingCount() == 0);
    EXPECT(r.dsp.context().chordRoot == 5);
    r.in.running = true;
    r.tick();
    EXPECT(r.soundingCount() == 4);
}

static void progressionTriggerSelect() {
    TEST("harmony master: progression, trigger and select");
    static HmProgression prog = HmProgression::defaults();
    Rig r;
    r.dsp.setProgression(&prog);
    r.p.source = patch::HmSrcProgression;
    r.p.advance = patch::HmTrigger;
    r.run(4);
    EXPECT(r.dsp.slot() == 0);
    auto pulse = [&](float& jack) {
        jack = 1.0f;
        r.tick();
        jack = 0.0f;
        r.run(3);
    };
    pulse(r.in.next);
    EXPECT(r.dsp.slot() == 1 && r.dsp.context().chordRoot == 9);
    pulse(r.in.next);
    pulse(r.in.next);
    pulse(r.in.next);
    EXPECT(r.dsp.slot() == 0);  // wrapped
    pulse(r.in.next);
    pulse(r.in.reset);
    EXPECT(r.dsp.slot() == 0);
    r.p.advance = patch::HmSelect;
    r.p.slot = 4;
    r.tick();
    EXPECT(r.dsp.slot() == 3 && r.dsp.context().chordRoot == 7);
    r.p.slot = 6;  // wraps to the slot count
    r.tick();
    EXPECT(r.dsp.slot() == 1);
    // Transpose applies at the next slot change.
    r.in.transpose = 2.0f / 12.0f;
    r.tick();
    EXPECT(r.dsp.context().chordRoot == 9);
    r.p.slot = 1;
    r.tick();
    EXPECT(r.dsp.context().chordRoot == 2 && r.dsp.context().key == 2);
    // An empty progression behaves like Manual.
    static HmProgression empty;
    r.dsp.setProgression(&empty);
    r.p.degree = 4;
    r.in.transpose = 0.0f;
    r.tick();
    EXPECT(r.dsp.context().chordRoot == 5);
}

static void notesOutput() {
    TEST("harmony master: notes and pitch outputs");
    Rig r;
    r.p.degree = 1;  // C E G (C)
    r.run(4);
    EXPECT(r.soundingCount() == 4);  // C E G and C an octave up
    EXPECT_NEAR(r.out.root, 0.0, 1e-6);
    EXPECT_NEAR(r.out.tone[1], 4.0 / 12.0, 1e-6);
    EXPECT_NEAR(r.out.tone[3], 1.0, 1e-6);
    EXPECT_NEAR(r.out.bass, -1.0, 1e-6);
    // C (60 64 67 72) → Am (69 72 76 81): the common C5 is held.
    r.events.clear();
    r.p.degree = 6;
    r.tick();
    bool sawOff = false, onAfterOff = false;
    for (const auto& e : r.events) {
        if (!e.on) sawOff = true;
        else if (sawOff) onAfterOff = true;
        EXPECT(e.note != 72);  // held through
    }
    EXPECT(!onAfterOff);
    EXPECT(r.events.size() == 6);
    EXPECT(r.soundingCount() == 4);
    EXPECT(r.out.change > 0.5f);
    EXPECT_NEAR(r.out.degree, 5.0 / 6.0, 1e-6);
    // Release: nothing left.
    r.dsp.release([&](bool on, int note, float, float) { r.sounding[note] += on ? 1 : -1; });
    EXPECT(r.soundingCount() == 0);
    // No room: the change waits, nothing hangs.
    Rig q;
    q.run(2);
    q.p.degree = 2;
    q.dsp.tick(q.p, q.in, q.out, 0, [&](bool on, int note, float, float) { q.sounding[note] += on ? 1 : -1; });
    q.run(2);
    EXPECT(q.soundingCount() == 4 || q.soundingCount() == 3);
    for (int i = 0; i < 2000; ++i) {  // Degree modulated every sample
        q.p.degree = 1 + i % 7;
        q.tick();
    }
    EXPECT(q.soundingCount() >= 3 && q.soundingCount() <= 4);
}

int main() {
    diatonic();
    adapt();
    detection();
    progressionTransport();
    progressionTriggerSelect();
    notesOutput();
    return bleep::test::finish("harmony-master");
}
