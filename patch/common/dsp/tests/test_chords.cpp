// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Chords.h: table, building (tones, inversion, voicing), diatonic stacks,
// voice leading and detection.
#include "dsp/Chords.h"
#include "dsp/tests/TestUtil.h"

#include <cstring>
#include <set>
#include <string>
#include <vector>

using namespace bleep::dsp;

static std::vector<int> sortedOf(const ChordVoicing& v) {
    int p[kMaxChordVoices];
    const int n = v.sorted(p);
    return std::vector<int>(p, p + n);
}
static std::vector<int> intervalsOf(const ScaleChord& c) { return std::vector<int>(c.intervals, c.intervals + c.count); }

static void table() {
    TEST("table");
    EXPECT(kNumChordQualities >= 24);
    std::set<std::string> ids;
    for (int i = 0; i < kNumChordQualities; ++i) {
        const auto& q = chordQualities()[(size_t)i];
        ids.insert(q.id);
        EXPECT(q.count >= 1 && q.count <= kMaxChordTones);
        EXPECT(q.intervals[0] == 0);
        for (int k = 1; k < q.count; ++k) EXPECT(q.intervals[k] > q.intervals[k - 1]);
        EXPECT(chordQualityIndex(q.id) == i);
        EXPECT(findChordQuality(chordMask(i)) == i);  // no two entries share a pitch-class set
    }
    EXPECT((int)ids.size() == kNumChordQualities);
    EXPECT(chordQualityIndex("major7") == ChordMajor7);
    EXPECT(chordQualityIndex("nope") == -1);
    // Chord Osc's list order (chord-oscillator.md 4.2).
    EXPECT(std::strcmp(chordQuality(0).label, "Unison") == 0);
    EXPECT(std::strcmp(chordQuality(kNumChordOscQualities - 1).label, "Quartal") == 0);
    EXPECT(chordMask(ChordMajor) == 0x091);
    EXPECT(chordMask(ChordAdd9) == ((1 << 0) | (1 << 4) | (1 << 7) | (1 << 2)));
    char buf[32];
    EXPECT(std::string(chordName(2, ChordMinor7, -1, buf, sizeof buf)) == "Dm7");
    EXPECT(std::string(chordName(4, ChordMajor, 8, buf, sizeof buf)) == "E/G♯");
    EXPECT(std::string(chordName(9, ChordMinor7, 0, buf, sizeof buf)) == "Am7/C");
    EXPECT(rotateMask(0x091, 2) == ((1 << 2) | (1 << 6) | (1 << 9)));
    EXPECT(rotateMask(0x800, 1) == 0x001);
}

static void tones() {
    TEST("tone count");
    auto build = [](int quality, int voices) { return sortedOf(buildChord(0, quality, voices, 0)); };
    // Cmaj9: fewer voices drop fifth, extension, seventh, third.
    EXPECT((build(ChordMajor9, 0) == std::vector<int>{0, 4, 7, 11, 14}));
    EXPECT((build(ChordMajor9, 4) == std::vector<int>{0, 4, 11, 14}));
    EXPECT((build(ChordMajor9, 3) == std::vector<int>{0, 4, 11}));
    EXPECT((build(ChordMajor9, 2) == std::vector<int>{0, 4}));
    EXPECT((build(ChordMajor9, 1) == std::vector<int>{0}));
    // More voices double root, fifth, third an octave up.
    EXPECT((build(ChordMajor, 4) == std::vector<int>{0, 4, 7, 12}));
    EXPECT((build(ChordMajor, 5) == std::vector<int>{0, 4, 7, 12, 19}));
    EXPECT((build(ChordMajor, 6) == std::vector<int>{0, 4, 7, 12, 16, 19}));
    EXPECT((build(ChordUnison, 3) == std::vector<int>{0, 12, 24}));
    EXPECT((build(ChordMajor, 20).size() == (size_t)kMaxChordVoices));
    // Voices keep stacking order: voice 1 is the third.
    const ChordVoicing v = buildChord(5, ChordMinor7, 0, 2);
    EXPECT(v.pitch[1] == 5 + 3 + 12 && v.role[1] == RoleThird && v.tone[1] == 1);
    EXPECT(v.role[0] == RoleRoot && v.role[2] == RoleFifth && v.role[3] == RoleSeventh);
}

static void inversionsAndVoicings() {
    TEST("inversions and voicings");
    auto cmaj7 = [](int inversion, int voicing) { return sortedOf(buildChord(0, ChordMajor7, 0, inversion, voicing)); };
    EXPECT((cmaj7(0, VoicingClose) == std::vector<int>{0, 4, 7, 11}));
    EXPECT((cmaj7(1, VoicingClose) == std::vector<int>{4, 7, 11, 12}));
    EXPECT((cmaj7(2, VoicingClose) == std::vector<int>{7, 11, 12, 16}));
    EXPECT((cmaj7(4, VoicingClose) == std::vector<int>{12, 16, 19, 23}));
    EXPECT((cmaj7(-1, VoicingClose) == std::vector<int>{-1, 0, 4, 7}));
    EXPECT((cmaj7(-2, VoicingClose) == std::vector<int>{-5, -1, 0, 4}));
    EXPECT((cmaj7(0, VoicingDrop2) == std::vector<int>{-5, 0, 4, 11}));
    EXPECT((cmaj7(0, VoicingDrop3) == std::vector<int>{-8, 0, 7, 11}));
    EXPECT((cmaj7(0, VoicingDrop24) == std::vector<int>{-12, -5, 4, 11}));
    EXPECT((cmaj7(0, VoicingOpen) == std::vector<int>{-12, 4, 7, 11}));
    EXPECT((cmaj7(0, VoicingWide) == std::vector<int>{-12, -1, 4, 19}));
    EXPECT((cmaj7(0, VoicingSpread) == std::vector<int>{-12, -5, 4, 11}));
    EXPECT((cmaj7(0, VoicingOpenUp) == std::vector<int>{0, 7, 16, 23}));
    EXPECT((cmaj7(1, VoicingDrop2) == std::vector<int>{-1, 4, 7, 12}));  // E G B C: B drops
    // Spread on the first inversion: E down, then C, G, B each >= a fourth above the last.
    EXPECT((cmaj7(1, VoicingSpread) == std::vector<int>{-8, 0, 7, 23}));
    // Triads: Drop 2 works, Drop 3 / Drop 2+4 fall back to Close.
    EXPECT((sortedOf(buildChord(0, ChordMajor, 0, 0, VoicingDrop2)) == std::vector<int>{-8, 0, 7}));
    EXPECT((sortedOf(buildChord(0, ChordMajor, 0, 0, VoicingDrop3)) == std::vector<int>{0, 4, 7}));
    ChordVoicing t = buildChord(0, ChordMajor, 0, 0);
    EXPECT(!applyVoicing(t, VoicingDrop24));
    EXPECT(applyVoicing(t, VoicingOpen));
    // Explicit intervals and a root.
    const int fourths[] = {0, 5, 10};
    EXPECT((sortedOf(buildChord(-3, fourths, 3, 0, 1)) == std::vector<int>{2, 7, 9}));
    // Anchor and range helpers.
    ChordVoicing c = buildChord(0, ChordMajor, 0, 0);
    EXPECT(octaveShiftTo(c, AnchorBass, 13.0f) == 12);
    EXPECT(octaveShiftTo(c, AnchorTop, 1.0f) == -12);
    EXPECT(octaveShiftTo(c, AnchorBass, 6.0f) == 0);  // tie goes down
    foldIntoRange(c, 20, 40);
    EXPECT((sortedOf(c) == std::vector<int>{24, 28, 31}));
}

static void diatonic() {
    TEST("diatonic");
    const uint16_t major = scales()[1].mask, minor = scales()[2].mask, harmonic = scales()[3].mask;
    const uint16_t chromatic = scales()[0].mask, pent = scales()[11].mask;
    const int majorTriads[7] = {ChordMajor, ChordMinor, ChordMinor, ChordMajor, ChordMajor, ChordMinor, ChordDiminished};
    const int majorSevenths[7] = {ChordMajor7, ChordMinor7, ChordMinor7, ChordMajor7, ChordDominant7, ChordMinor7,
                                  ChordHalfDiminished7};
    const int minorTriads[7] = {ChordMinor, ChordDiminished, ChordMajor, ChordMinor, ChordMinor, ChordMajor, ChordMajor};
    const int minorSevenths[7] = {ChordMinor7, ChordHalfDiminished7, ChordMajor7, ChordMinor7, ChordMinor7, ChordMajor7,
                                  ChordDominant7};
    const int majorRoots[7] = {0, 2, 4, 5, 7, 9, 11}, minorRoots[7] = {0, 2, 3, 5, 7, 8, 10};
    for (int d = 0; d < 7; ++d) {
        EXPECT(diatonicTriad(major, d).quality == majorTriads[d]);
        EXPECT(diatonicTriad(major, d).root == majorRoots[d]);
        EXPECT(diatonicSeventh(major, d).quality == majorSevenths[d]);
        EXPECT(diatonicTriad(minor, d).quality == minorTriads[d]);
        EXPECT(diatonicTriad(minor, d).root == minorRoots[d]);
        EXPECT(diatonicSeventh(minor, d).quality == minorSevenths[d]);
    }
    EXPECT(diatonicTriad(major, 7).root == 12);  // past the octave
    EXPECT(diatonicTriad(major, -1).root == -1 && diatonicTriad(major, -1).quality == ChordDiminished);
    EXPECT(diatonicTriad(harmonic, 4).quality == ChordMajor);       // V in harmonic minor
    EXPECT(diatonicSeventh(harmonic, 4).quality == ChordDominant7);
    EXPECT(diatonicSeventh(harmonic, 0).quality == ChordMinorMajor7);
    EXPECT(diatonicTriad(chromatic, 3).quality == ChordMajor && diatonicTriad(chromatic, 3).root == 3);
    EXPECT(diatonicSeventh(chromatic, 0).quality == ChordDominant7);
    EXPECT((intervalsOf(scaleChord(chromatic, 0, StackTriad)) == std::vector<int>{0, 2, 4}));  // a cluster
    // Pentatonic "triads" become open stacks; no table entry.
    const ScaleChord p = diatonicTriad(pent, 0);
    EXPECT((intervalsOf(p) == std::vector<int>{0, 4, 9}) && p.quality == -1);
    // Chord Osc 4.4 stacks in C major on D.
    EXPECT(scaleChord(major, 1, StackNinth).quality == ChordMinor9);
    EXPECT((intervalsOf(scaleChord(major, 1, StackQuartal)) == std::vector<int>{0, 5, 10, 15}));
    EXPECT(scaleChord(major, 1, StackSus2).quality == ChordSus2);
    EXPECT(scaleChord(major, 1, StackSixth).quality == ChordMinor6);
    EXPECT(scaleChord(major, 1, StackAdd9).quality == ChordMinorAdd9);
    // Scale steps.
    EXPECT(scaleSize(major) == 7 && scaleSize(pent) == 5 && scaleSize(0) == 12);
    EXPECT(scaleNote(major, 9) == 16 && scaleNote(major, -2) == -3);
    EXPECT(scaleIndexOf(major, 16) == 9 && scaleIndexOf(major, -3) == -2 && scaleIndexOf(major, 6) == 3);
    EXPECT(scaleDegree(major, 9) == 6 && scaleDegree(major, 1) == 0 && scaleDegree(major, -12) == 1);
}

static void voiceLeading() {
    TEST("voice leading");
    int maj[3] = {0, 4, 7};
    // C → F with minimal movement: C F A (1 + 2 semitones).
    int prev[3] = {0, 4, 7};
    ChordVoicing f = leadChord(prev, 3, 5, maj, 3, 0, VoicingClose);
    EXPECT((sortedOf(f) == std::vector<int>{0, 5, 9}));
    EXPECT(voiceLeadCost(prev, 3, f, {}) == 3.0f);
    // C → F → G → C following an input (Chord Quantizer 8): each voice moves <= 2.
    const int roots[4] = {0, 5, 7, 0};
    std::vector<int> last{0, 4, 7};
    for (int k = 1; k < 4; ++k) {
        VoiceLeadOptions o;
        o.useTarget = true;
        o.anchor = AnchorCentre;
        o.target = (float)roots[k];
        const ChordVoicing c = leadChord(last.data(), 3, roots[k], maj, 3, 0, VoicingClose, o);
        const auto s = sortedOf(c);
        EXPECT(s.size() == 3);
        for (size_t i = 0; i < s.size(); ++i) EXPECT(std::abs(s[i] - last[i]) <= 2);
        last = s;
    }
    // A cheaper total wins unless the top voice is kept.
    ChordVoicing a, b;
    a.count = b.count = 3;
    const int pa[3] = {1, 4, 9}, pb[3] = {-2, 2, 7};
    for (int i = 0; i < 3; ++i) a.pitch[i] = pa[i], b.pitch[i] = pb[i];
    const ChordVoicing cands[2] = {a, b};
    EXPECT(leadVoices(prev, 3, cands, 2) == 0);
    VoiceLeadOptions top;
    top.keepTop = true;
    EXPECT(leadVoices(prev, 3, cands, 2, top) == 1);
    // Unisons are penalised; ties go to the lower candidate.
    ChordVoicing u = a, w = a;
    const int pu[3] = {0, 4, 4}, pw[3] = {0, 4, 5};
    for (int i = 0; i < 3; ++i) u.pitch[i] = pu[i], w.pitch[i] = pw[i];
    EXPECT(voiceLeadCost(prev, 3, u, {}) == 3.0f + 3.0f);
    const ChordVoicing tie[2] = {f, [] {
        ChordVoicing t;
        t.count = 3;
        t.pitch[0] = 1, t.pitch[1] = 4, t.pitch[2] = 9;
        return t;
    }()};
    EXPECT(leadVoices(prev, 3, tie, 2) == 0);
    // No previous chord: root position.
    EXPECT((sortedOf(leadChord(prev, 0, 7, maj, 3, 0, VoicingClose)) == std::vector<int>{7, 11, 14}));
    // Drop 2 candidates stay Drop 2.
    int seventh[4] = {0, 4, 7, 11}, p4[4] = {-5, 0, 4, 11};
    const ChordVoicing d = leadChord(p4, 4, 5, seventh, 4, 0, VoicingDrop2);
    const auto ds = sortedOf(d);
    EXPECT(ds.size() == 4 && ds[3] - ds[0] > 12);
}

static void detection() {
    TEST("detection");
    auto det = [](std::vector<int> notes) { return detectChordFromNotes(notes.data(), (int)notes.size()); };
    DetectedChord d = det({60, 64, 67});
    EXPECT(d.valid && d.root == 0 && d.quality == ChordMajor && d.bass == 0);
    d = det({57, 60, 64, 67});  // A C E G over A
    EXPECT(d.root == 9 && d.quality == ChordMinor7 && d.bass == 9);
    d = det({60, 64, 67, 69});  // C E G A over C
    EXPECT(d.root == 0 && d.quality == ChordMajor6 && d.bass == 0);
    d = det({64, 67, 72});  // first inversion
    EXPECT(d.root == 0 && d.quality == ChordMajor && d.bass == 4);
    d = det({62, 65, 69, 72});
    EXPECT(d.root == 2 && d.quality == ChordMinor7);
    d = det({59, 62, 65, 69});
    EXPECT(d.root == 11 && d.quality == ChordHalfDiminished7);
    d = det({55, 59, 62, 65});
    EXPECT(d.root == 7 && d.quality == ChordDominant7);
    d = det({60, 67});
    EXPECT(d.root == 0 && d.quality == ChordFifth);
    d = det({62, 74});
    EXPECT(d.root == 2 && d.quality == ChordUnison);
    d = det({60, 64, 67, 71, 74});
    EXPECT(d.root == 0 && d.quality == ChordMajor9);
    d = det({62, 67, 69});  // D G A over D: Dsus4
    EXPECT(d.root == 2 && d.quality == ChordSus4);
    EXPECT(!det({}).valid);
    // Scores follow the formula (× 100).
    EXPECT(chordScore(0x091, 0, 0, ChordMajor) == 600 + 50 - 3);
    EXPECT(chordScore(0x091, 0, 9, ChordMinor) == 400 - 100 - 150 - 3);
    // Symmetric chords: the root in the scale wins a tie (C aug in C major: C, E or G♯).
    const uint16_t aug = (uint16_t)((1 << 0) | (1 << 4) | (1 << 8));
    d = detectChord(aug, 2, scales()[1].mask, 0);  // bass outside the chord: no bass bonus
    EXPECT(d.quality == ChordAugmented && d.root == 0);
    d = detectChord(aug, 2, scales()[1].mask, 4);  // E major: E and G♯ in the scale, E first
    EXPECT(d.quality == ChordAugmented && d.root == 4);
}

int main() {
    table();
    tones();
    inversionsAndVoicings();
    diatonic();
    voiceLeading();
    detection();
    return bleep::test::finish("chords");
}
