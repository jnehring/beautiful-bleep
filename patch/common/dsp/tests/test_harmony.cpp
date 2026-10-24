// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Harmony.h: the context, quantizing and transposing, Scale Policy Adapt,
// chord tones and the per-chunk bus.
#include "dsp/Harmony.h"
#include "dsp/tests/TestUtil.h"

#include <cstring>
#include <type_traits>

using namespace bleep::dsp;

static_assert(std::is_trivially_copyable_v<HarmonyState>);
static_assert(kHarmonyBuses == 4);

static void context() {
    TEST("context");
    const HarmonyState none{};
    EXPECT(!none.valid);
    const uint16_t major = scales()[1].mask;
    HarmonyState h = makeHarmony(0, major, 2, ChordMinor);  // C major, Dm
    EXPECT(h.valid && h.key == 0 && h.chordRoot == 2 && h.bass == 2 && h.degree == 2);
    EXPECT(h.chord == chordMask(ChordMinor) && h.quality == ChordMinor);
    EXPECT(makeHarmony(0, major, 1, ChordMajor).degree == 0);  // C♯ is not in C major
    EXPECT(makeHarmony(9, scales()[2].mask, 4, ChordMajor, 8).bass == 8);
    const HarmonyState m = makeHarmonyMask(0, major, 7, (uint16_t)((1 << 0) | (1 << 4) | (1 << 7) | (1 << 10)));
    EXPECT(m.quality == ChordDominant7 && m.degree == 5);
    HarmonyState c = h;
    c.serial = 7;
    EXPECT(sameHarmony(h, c));
    c.chordRoot = 4;
    EXPECT(!sameHarmony(h, c));
    const HarmonyState t = transposed(makeHarmony(0, major, 11, ChordMajor, 3), 3);
    EXPECT(t.key == 3 && t.chordRoot == 2 && t.bass == 6 && t.scale == major);
    EXPECT(absoluteChord(h) == (uint16_t)((1 << 2) | (1 << 5) | (1 << 9)));
    EXPECT(absoluteScale(makeHarmony(2, major, 2, ChordMajor)) == rotateMask(major, 2));
}

static void quantizing() {
    TEST("quantize");
    const uint16_t major = scales()[1].mask;
    const HarmonyState g7 = makeHarmony(0, major, 7, ChordDominant7);  // G B D F
    EXPECT(scaleSemis(g7, 1.0f) == 0);    // tie C / D goes down
    EXPECT(scaleSemis(g7, 6.4f) == 7);
    EXPECT(chordSemis(g7, 1.0f) == 2);    // D is nearer than B
    EXPECT(chordSemis(g7, 0.0f) == -1);   // B below
    EXPECT(chordSemis(g7, 12.6f) == 14);
    EXPECT_NEAR(quantizeToScale(g7, 6.4f / 12.0f), 7.0f / 12.0f, 1e-6);
    EXPECT_NEAR(quantizeToChord(g7, 1.0f / 12.0f), 2.0f / 12.0f, 1e-6);
    // D major: quantized relative to the key.
    const HarmonyState d = makeHarmony(2, major, 2, ChordMajor);
    EXPECT(scaleSemis(d, 5.0f) == 4);     // F → E (tie E / F♯ goes down)
    EXPECT(scaleSemis(d, 5.6f) == 6);
    // Chord tones preferred: within a semitone of a chord tone, the chord wins.
    const HarmonyState dm = makeHarmony(0, major, 2, ChordMinor);  // D F A in C major
    EXPECT(chordPreferredSemis(dm, 3.0f) == 2);
    EXPECT(chordPreferredSemis(dm, 4.4f) == 5);
    EXPECT(chordPreferredSemis(dm, 7.0f) == 7);  // F and A are 2 away: the scale's G
    EXPECT_NEAR(quantizeChordPreferred(dm, 4.4f / 12.0f), 5.0f / 12.0f, 1e-6);
    // Root in the nearest octave.
    EXPECT(rootSemis(dm, 13.0f) == 14);
    EXPECT(rootSemis(dm, -5.0f) == -10);
    EXPECT(rootSemis(dm, 8.0f) == 2);  // tie between 2 and 14 goes down
    EXPECT_NEAR(quantizeToRoot(dm, -0.4f), -10.0f / 12.0f, 1e-6);
}

static void transposing() {
    TEST("transpose");
    const uint16_t major = scales()[1].mask;
    const HarmonyState c = makeHarmony(0, major, 0, ChordMajor);
    EXPECT(scaleStepSemis(c, 4.0f, 2) == 7);    // E + 2 → G
    EXPECT(scaleStepSemis(c, 9.0f, 2) == 12);   // A + 2 → C an octave up
    EXPECT(scaleStepSemis(c, 0.0f, -1) == -1);  // C − 1 → B below
    EXPECT(scaleStepSemis(c, 0.0f, 7) == 12);
    EXPECT(scaleStepSemis(c, 4.4f, 0) == 4);
    const HarmonyState d = makeHarmony(2, major, 2, ChordMajor);
    EXPECT(scaleStepSemis(d, 4.0f, 1) == 6);    // E + 1 in D major → F♯
    EXPECT(scaleStepSemis(d, -1.0f, 1) == 1);   // B + 1 → C♯
    EXPECT(chordStepSemis(c, 4.0f, 1) == 7);
    EXPECT(chordStepSemis(c, 7.0f, 1) == 12);
    EXPECT(chordStepSemis(c, 0.0f, -1) == -5);
    const HarmonyState am = makeHarmony(0, major, 9, ChordMinor);  // A C E
    EXPECT(chordStepSemis(am, 0.0f, 1) == 4);
    EXPECT(chordStepSemis(am, 0.0f, 3) == 12);
    EXPECT_NEAR(transposeInScale(c, 4.0f / 12.0f, 2), 7.0f / 12.0f, 1e-6);
    EXPECT_NEAR(transposeInChord(am, 0.0f, -1), -3.0f / 12.0f, 1e-6);
}

static void adapt() {
    TEST("adapt scale");
    const uint16_t natural = scales()[2].mask, harmonic = scales()[3].mask, major = scales()[1].mask;
    // A minor + E major → A harmonic minor (G replaced by G♯).
    EXPECT(adaptScale(natural, 9, 4, chordMask(ChordMajor)) == harmonic);
    // Chord inside the scale: unchanged.
    EXPECT(adaptScale(major, 0, 2, chordMask(ChordMinor)) == major);
    // C major + D major: F♯ replaces F.
    EXPECT(adaptScale(major, 0, 2, chordMask(ChordMajor)) == scaleMask({0, 2, 4, 6, 7, 9, 11}));
    // C major + C minor: E♭ replaces its lower neighbour D (the lower one first).
    EXPECT(adaptScale(major, 0, 0, chordMask(ChordMinor)) == scaleMask({0, 3, 4, 5, 7, 9, 11}));
    // The published scale always contains the chord.
    for (int k = 0; k < 12; ++k)
        for (int r = 0; r < 12; ++r)
            for (int q = 0; q < kNumChordQualities; ++q) {
                const uint16_t s = adaptScale(scales()[1].mask, k, r, chordMask(q));
                EXPECT((rotateMask(s, k) & rotateMask(chordMask(q), r)) == rotateMask(chordMask(q), r));
            }
}

static void tones() {
    TEST("tones");
    int t[4];
    harmonyTones(makeHarmony(0, 0xab5, 0, ChordMajor), t);
    EXPECT(t[0] == 0 && t[1] == 4 && t[2] == 7 && t[3] == 12);
    harmonyTones(makeHarmony(0, 0xab5, 0, ChordFifth), t);
    EXPECT(t[0] == 0 && t[1] == 7 && t[2] == 12 && t[3] == 19);
    harmonyTones(makeHarmony(0, 0xab5, 0, ChordMajor9), t);
    EXPECT(t[0] == 0 && t[1] == 4 && t[2] == 7 && t[3] == 11);
    harmonyTones(makeHarmony(0, 0xab5, 0, ChordUnison), t);
    EXPECT(t[0] == 0 && t[1] == 12 && t[2] == 24 && t[3] == 24);
    harmonyTones(makeHarmonyMask(0, 0xab5, 0, (uint16_t)((1 << 0) | (1 << 4) | (1 << 9))), t);  // not in the table
    EXPECT(t[0] == 0 && t[1] == 4 && t[2] == 9 && t[3] == 12);
}

static void bus() {
    TEST("bus");
    HarmonyBus b[kHarmonyBuses];
    EXPECT(!b[2].at(0).valid);  // nobody publishes
    const HarmonyState s0 = makeHarmony(0, 0xab5, 0, ChordMajor), s1 = makeHarmony(0, 0xab5, 5, ChordMajor),
                       s2 = makeHarmony(0, 0xab5, 7, ChordMajor);
    b[0].begin(s0);
    b[0].publish(10, s1);
    b[0].publish(20, s2);
    EXPECT(b[0].at(0).chordRoot == 0 && b[0].at(9).chordRoot == 0);
    EXPECT(b[0].at(10).chordRoot == 5 && b[0].at(19).chordRoot == 5);
    EXPECT(b[0].at(20).chordRoot == 7 && b[0].at(31).chordRoot == 7);
    EXPECT(b[0].changesAt(10) && !b[0].changesAt(11));
    b[0].publish(20, s1);  // same sample: replaces
    EXPECT(b[0].numChanges == 2 && b[0].at(25).chordRoot == 5);
    b[0].begin();
    EXPECT(b[0].numChanges == 0 && b[0].at(0).chordRoot == 5);
    for (int i = 0; i < 12; ++i) b[0].publish(i, makeHarmony(0, 0xab5, i, ChordMajor));
    EXPECT(b[0].numChanges == HarmonyBus::kMaxChanges && b[0].current().chordRoot == 11 && b[0].at(11).chordRoot == 11);
    EXPECT(b[0].at(3).chordRoot == 3);
}

int main() {
    context();
    quantizing();
    transposing();
    adapt();
    tones();
    bus();
    return bleep::test::finish("harmony");
}
