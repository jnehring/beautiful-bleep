// SPDX-License-Identifier: MIT
// Chord Quantizer: chromatic and diatonic chords, voicings, Anchor and
// Range, voice leading, Trig sampling, Strum timing, the Notes output, and
// Follow driven by a Harmony Master's context.
#include "ChordQuantizerDsp.h"
#include "HarmonyMasterDsp.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <map>
#include <vector>

using namespace bleep;
using patch::ChordQuantizerDsp;
using patch::CqInput;
using patch::CqOutputs;
using patch::CqParams;

static constexpr double kSr = 48000.0;

struct Ev {
    bool on;
    int note;
    int64_t at;
};

struct Rig {
    ChordQuantizerDsp dsp;
    CqParams p;
    CqInput in;
    CqOutputs out;
    std::vector<Ev> events;
    std::map<int, int> sounding;
    int64_t t = 0;
    int changes = 0;
    Rig() {
        dsp.prepare(kSr);
        dsp.reset();
    }
    void tick() {
        dsp.tick(p, in, out, 64, [&](bool on, int note, float, float) {
            events.push_back({on, note, t});
            sounding[note] += on ? 1 : -1;
        });
        if (out.change > 0.5f) ++changes;
        ++t;
    }
    void run(int64_t n) {
        for (int64_t i = 0; i < n; ++i) tick();
    }
    /// Voice outputs in semitones.
    std::vector<int> voices(int n = 4) const {
        std::vector<int> v;
        for (int i = 0; i < n; ++i) v.push_back((int)std::lround(out.voice[i] * 12.0f));
        return v;
    }
    int soundingCount() {
        int n = 0;
        for (const auto& [k, v] : sounding) {
            EXPECT(v == 0 || v == 1);
            n += v;
        }
        return n;
    }
};

static std::vector<int> pcs(const std::vector<int>& v) {
    std::vector<int> r;
    for (int x : v) r.push_back(dsp::pitchClass(x));
    std::sort(r.begin(), r.end());
    r.erase(std::unique(r.begin(), r.end()), r.end());
    return r;
}

static void chromatic() {
    TEST("chord quantizer: chromatic chords and inversions");
    CqParams p;
    p.voices = 3;
    for (int root : {0, 4, 9})
        for (int q : {dsp::ChordMajor, dsp::ChordMinor, dsp::ChordDominant7}) {
            p.chord = q;
            p.voices = q == dsp::ChordDominant7 ? 4 : 3;
            const auto d = ChordQuantizerDsp::define(p, (float)root + 0.2f, nullptr);
            EXPECT(d.root == root);
            const auto v = ChordQuantizerDsp::voice(p, d, (float)root, nullptr, 0);
            std::vector<int> got(v.pitch, v.pitch + v.count), want;
            for (int k = 0; k < dsp::chordQuality(q).count; ++k) want.push_back(root + dsp::chordQuality(q).intervals[k]);
            EXPECT(pcs(got) == pcs(want));
            EXPECT(v.lowest() == root);  // Anchor Bass on the input
        }
    // Inversions ±3 as Chord Osc (before Anchor moves the chord by octaves).
    p.chord = dsp::ChordMajor7;
    p.voices = 4;
    p.range = 4;
    for (int inv = -3; inv <= 3; ++inv) {
        p.inversion = inv;
        const auto d = ChordQuantizerDsp::define(p, 0.0f, nullptr);
        const auto v = ChordQuantizerDsp::voice(p, d, 0.0f, nullptr, 0);
        auto ref = dsp::buildChord(0, dsp::ChordMajor7, 4, inv, dsp::VoicingClose);
        int a[8], b[8];
        v.sorted(a);
        ref.sorted(b);
        const int shift = a[0] - b[0];
        EXPECT(shift % 12 == 0);
        for (int k = 0; k < 4; ++k) EXPECT(a[k] - b[k] == shift);
    }
}

static void diatonic() {
    TEST("chord quantizer: diatonic stacks");
    CqParams p;
    p.mode = patch::CqDiatonic;
    p.voices = 4;
    p.stack = dsp::StackTriad;
    const int roots[7] = {0, 2, 4, 5, 7, 9, 11};
    const int triads[7] = {dsp::ChordMajor, dsp::ChordMinor, dsp::ChordMinor, dsp::ChordMajor,
                           dsp::ChordMajor, dsp::ChordMinor, dsp::ChordDiminished};
    const int sevenths[7] = {dsp::ChordMajor7, dsp::ChordMinor7, dsp::ChordMinor7, dsp::ChordMajor7,
                             dsp::ChordDominant7, dsp::ChordMinor7, dsp::ChordHalfDiminished7};
    for (int d = 0; d < 7; ++d) {
        p.stack = dsp::StackTriad;
        auto c = ChordQuantizerDsp::define(p, (float)roots[d] + 0.4f, nullptr);
        EXPECT(c.root == roots[d] && dsp::findChordQuality(c.mask()) == triads[d]);
        p.stack = dsp::StackSeventh;
        c = ChordQuantizerDsp::define(p, (float)roots[d] - 0.4f, nullptr);
        EXPECT(c.root == roots[d] && dsp::findChordQuality(c.mask()) == sevenths[d]);
    }
    // C♯ (not in the scale) rounds down to C.
    p.stack = dsp::StackTriad;
    EXPECT(ChordQuantizerDsp::define(p, 1.0f, nullptr).root == 0);
    // A 5-note scale stacks without errors.
    p.scale = 11;  // Major Pentatonic
    for (int s = -24; s <= 24; ++s) {
        const auto c = ChordQuantizerDsp::define(p, (float)s, nullptr);
        EXPECT(c.count == 3 && dsp::inScale(dsp::scales()[11].mask, c.root));
    }
}

static void voicings() {
    TEST("chord quantizer: voicings, fallback, range, anchor");
    CqParams p;
    p.chord = dsp::ChordMajor7;
    p.voices = 4;
    p.range = 4;
    auto build = [&](int voicing, float target) {
        p.voicing = voicing;
        const auto d = ChordQuantizerDsp::define(p, 0.0f, nullptr);
        const auto v = ChordQuantizerDsp::voice(p, d, target, nullptr, 0);
        int s[8];
        v.sorted(s);
        return std::vector<int>(s, s + v.count);
    };
    EXPECT((build(0, 0.0f) == std::vector<int>{0, 4, 7, 11}));    // Close
    EXPECT((build(1, -5.0f) == std::vector<int>{-5, 0, 4, 11}));  // Drop 2
    EXPECT((build(2, -8.0f) == std::vector<int>{-8, 0, 7, 11}));  // Drop 3
    EXPECT((build(4, 0.0f) == std::vector<int>{0, 7, 16, 23}));   // Open: 2nd and 4th up
    const auto spread = build(3, -12.0f);                          // Spread: wide, ≥ a fourth apart
    EXPECT(spread.size() == 4 && spread[0] == -12);
    for (size_t k = 1; k < spread.size(); ++k) EXPECT(spread[k] - spread[k - 1] >= 5);
    // Too few voices: Close.
    p.voices = 2;
    EXPECT((build(2, 0.0f) == std::vector<int>{0, 4}));
    // Range 1 folds Open into one octave above the bass.
    p.voices = 4;
    p.range = 1;
    for (int x : build(4, 0.0f)) EXPECT(x >= 0 && x <= 12);
    // Anchor: bass, centre, top nearest the input.
    p.range = 2;
    p.voicing = 0;
    const auto d = ChordQuantizerDsp::define(p, 0.0f, nullptr);
    p.anchor = dsp::AnchorBass;
    EXPECT(ChordQuantizerDsp::voice(p, d, 12.0f, nullptr, 0).lowest() == 12);
    p.anchor = dsp::AnchorTop;
    EXPECT(ChordQuantizerDsp::voice(p, d, 23.0f, nullptr, 0).highest() == 23);
    p.anchor = dsp::AnchorCentre;
    EXPECT_NEAR(dsp::anchorPitch(ChordQuantizerDsp::voice(p, d, 17.0f, nullptr, 0), dsp::AnchorCentre), 17.5, 0.01);
}

static void voiceLeading() {
    TEST("chord quantizer: voice leading");
    Rig r;
    r.p.voices = 3;
    r.p.lead = patch::CqLeadSmooth;
    std::vector<int> prev;
    bool first = true;
    for (int root : {0, 5, 7, 0, 5, 7, 0}) {
        r.in.pitch = (float)root / 12.0f;
        r.run(4);
        const auto v = r.voices(3);
        EXPECT(pcs(v) == pcs({root, root + 4, root + 7}));
        if (!first)
            for (int k = 0; k < 3; ++k) EXPECT(std::abs(v[(size_t)k] - prev[(size_t)k]) <= 2);
        prev = v;
        first = false;
    }
    // Deterministic: the same sequence again gives the same voices.
    Rig a, b;
    for (Rig* x : {&a, &b}) {
        x->p.voices = 4;
        x->p.chord = dsp::ChordMinor7;
        x->p.lead = patch::CqLeadSmooth;
    }
    for (int root : {2, 7, 0, 9, 4, 5}) {
        a.in.pitch = b.in.pitch = (float)root / 12.0f;
        a.run(3);
        b.run(3);
        EXPECT(a.voices() == b.voices());
    }
    // Smooth + Top keeps a common top note: C (top G) → Em (has G).
    Rig s;
    s.p.voices = 3;
    s.p.lead = patch::CqLeadSmoothTop;
    s.p.anchor = dsp::AnchorTop;
    s.in.pitch = 0.0f;
    s.run(3);
    const int top = s.voices(3)[2];
    EXPECT(dsp::pitchClass(top) == 7);
    s.p.chord = dsp::ChordMinor;
    s.in.pitch = 4.0f / 12.0f;
    s.run(3);
    EXPECT(s.voices(3)[2] == top);
}

static void trigSampling() {
    TEST("chord quantizer: trig samples and holds");
    Rig r;
    r.p.voices = 3;
    r.in.trigPatched = true;
    r.in.pitch = 0.0f;
    r.run(10);  // before the first pulse: continuous
    EXPECT(r.voices(1)[0] == 0);
    r.in.trig = 1.0f;
    r.tick();
    r.in.trig = 0.0f;
    for (int k = 0; k < 100; ++k) {  // the input moves, nothing changes
        r.in.pitch = (float)(k % 12) / 12.0f;
        r.tick();
    }
    EXPECT(r.voices(1)[0] == 0);
    r.in.pitch = 5.0f / 12.0f;
    r.in.trig = 1.0f;
    r.tick();
    r.in.trig = 0.0f;
    r.tick();
    EXPECT(r.voices(1)[0] == 5);
    // A pulse with the same chord: no Change, but the notes retrigger.
    const int changes = r.changes;
    r.events.clear();
    r.in.trig = 1.0f;
    r.tick();
    r.in.trig = 0.0f;
    r.tick();
    EXPECT(r.changes == changes);
    EXPECT(r.events.size() == 6 && !r.events[0].on && r.events[5].on);
    EXPECT(r.soundingCount() == 3);
}

static void strum() {
    TEST("chord quantizer: strum timing");
    Rig r;
    r.p.voices = 4;
    r.p.chord = dsp::ChordMajor7;
    r.p.strum = 0.03f;
    r.in.pitch = 0.0f;
    r.run(4000);
    r.events.clear();
    r.in.pitch = 5.0f / 12.0f;  // → Fmaj7: every voice moves
    const int64_t t0 = r.t;
    std::vector<int64_t> changeAt;
    for (int i = 0; i < 4000; ++i) {
        r.tick();
        if (r.out.change > 0.5f) changeAt.push_back(r.t - 1);
    }
    std::vector<int64_t> ons;
    for (const auto& e : r.events)
        if (e.on) ons.push_back(e.at - t0);
    const int64_t gap = (int64_t)std::llround(0.03 * kSr / 3.0);
    EXPECT(ons.size() == 4);
    for (size_t k = 0; k < ons.size(); ++k) EXPECT(ons[k] == (int64_t)k * gap);
    EXPECT(changeAt.size() == 1 && changeAt[0] == t0);
    // Legato: each note-on comes before the note-off it replaces.
    for (size_t k = 0; k + 1 < r.events.size(); k += 2) EXPECT(r.events[k].on && !r.events[k + 1].on);
    EXPECT(r.soundingCount() == 4);
}

static void notesGate() {
    TEST("chord quantizer: gate mode and release");
    Rig r;
    r.p.voices = 3;
    r.in.gatePatched = true;
    r.run(10);
    EXPECT(r.soundingCount() == 0);
    r.in.gate = 1.0f;
    r.run(10);
    EXPECT(r.soundingCount() == 3);
    r.in.pitch = 2.0f / 12.0f;  // a change while high: legato
    r.run(10);
    EXPECT(r.soundingCount() == 3);
    r.in.gate = 0.0f;
    r.run(2);
    EXPECT(r.soundingCount() == 0);
    r.in.gatePatched = false;  // continuous
    r.run(2);
    EXPECT(r.soundingCount() == 3);
    r.dsp.release([&](bool on, int note, float, float) { r.sounding[note] += on ? 1 : -1; });
    EXPECT(r.soundingCount() == 0);
}

static void follow() {
    TEST("chord quantizer: follow");
    // The context's chord, placed by the input.
    const dsp::HarmonyState h = dsp::makeHarmony(9, dsp::scales()[2].mask, 2, dsp::ChordMinor7, 5);  // Dm7/F in A minor
    CqParams p;
    p.mode = patch::CqFollow;
    p.voices = 4;
    const auto d = ChordQuantizerDsp::define(p, 14.0f, &h);
    EXPECT(dsp::pitchClass(d.root) == 2 && d.mask() == dsp::chordMask(dsp::ChordMinor7));
    const auto v = ChordQuantizerDsp::voice(p, d, 14.0f, nullptr, 0);
    EXPECT(dsp::pitchClass(v.lowest()) == 5);  // slash bass lowest
    EXPECT(std::abs(v.lowest() - 14) <= 6);
    // No bus: Diatonic with the module's own Root/Scale.
    const auto n = ChordQuantizerDsp::define(p, 2.0f, nullptr);
    EXPECT(n.root == 2 && dsp::findChordQuality(n.mask()) == dsp::ChordMinor);
    // Diatonic with a bus takes key and scale from it.
    p.mode = patch::CqDiatonic;
    const auto k = ChordQuantizerDsp::define(p, 11.0f, &h);  // B in A minor: B dim
    EXPECT(k.root == 11 && dsp::findChordQuality(k.mask()) == dsp::ChordDiminished);
}

static void harmonyMasterDrivesFollow() {
    TEST("chord quantizer: a Harmony Master progression drives Follow");
    static patch::HmProgression prog = patch::HmProgression::defaults();  // I vi IV V
    patch::HarmonyMasterDsp hm;
    hm.prepare(kSr);
    hm.reset();
    hm.setProgression(&prog);
    patch::HmParams hp;
    hp.source = patch::HmSrcProgression;
    patch::HmInput hin;
    hin.running = true;
    patch::HmOutputs ho;
    Rig r;
    r.p.mode = patch::CqFollow;
    r.p.voices = 3;
    r.in.trigPatched = true;
    r.in.pitch = 0.0f;
    const double ppqPerSample = 2.0 / kSr;
    std::vector<int> roots;
    int lastNote = -1;
    for (int64_t i = 0; i < (int64_t)(16.0 / ppqPerSample); ++i) {
        hin.ppq = (double)i * ppqPerSample;
        hin.started = i == 0;
        hm.tick(hp, hin, ho, 64, [](bool, int, float, float) {});
        dsp::HarmonyState ctx = hm.context();
        ctx.valid = true;
        r.in.harmony = &ctx;
        // A trigger on every beat, on the same sample as the chord changes.
        const bool beat = std::floor(hin.ppq) != std::floor(hin.ppq - ppqPerSample) || i == 0;
        r.in.trig = beat ? 1.0f : 0.0f;
        r.tick();
        if (beat) {
            const int root = dsp::pitchClass(r.dsp.chord().root);
            if (root != lastNote) roots.push_back(root);
            lastNote = root;
            EXPECT(root == hm.context().chordRoot);  // same sample: the new chord
            EXPECT(pcs(r.voices(3)) == pcs({root, root + (hm.context().quality == dsp::ChordMinor ? 3 : 4), root + 7}));
        }
    }
    EXPECT((roots == std::vector<int>{0, 9, 5, 7}));
}

int main() {
    chromatic();
    diatonic();
    voicings();
    voiceLeading();
    trigSampling();
    strum();
    notesGate();
    follow();
    harmonyMasterDrivesFollow();
    return bleep::test::finish("chord-quantizer");
}
