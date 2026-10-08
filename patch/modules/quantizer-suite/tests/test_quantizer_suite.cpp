// SPDX-License-Identifier: MIT
// Quantizer Suite: masks and hysteresis, Transpose across octaves, the
// normalled diatonic seventh, every Arp order, Follow targets (also driven by
// a Harmony Master), sampling, slew timing and the Notes output.
#include "HarmonyMasterDsp.h"
#include "QuantizerSuiteDsp.h"

#include "dsp/tests/TestUtil.h"

#include <map>
#include <vector>

using namespace bleep;
using patch::QsInput;
using patch::QsOutputs;
using patch::QsParams;
using patch::QuantizerSuiteDsp;

static constexpr double kSr = 48000.0;

struct Ev {
    int ch;
    bool on;
    int note;
    int64_t at;
};

struct Rig {
    QuantizerSuiteDsp dsp;
    QsParams p;
    QsInput in;
    QsOutputs out;
    std::vector<Ev> events;
    std::map<std::pair<int, int>, int> sounding;
    int64_t t = 0;
    Rig() {
        dsp.prepare(kSr);
        dsp.reset();
        for (int k = 0; k < 4; ++k) {
            p.ch[k].mode = k == 0 ? patch::QsQuantize : patch::QsTranspose;
            p.ch[k].steps = 2 * k;
        }
    }
    void tick() {
        dsp.tick(p, in, out, 64, [&](int ch, bool on, int note, float, float) {
            events.push_back({ch, on, note, t});
            sounding[{ch, note}] += on ? 1 : -1;
        });
        ++t;
    }
    void run(int64_t n) {
        for (int64_t i = 0; i < n; ++i) tick();
    }
    void all(float v) {
        for (float& x : in.in) x = v;
    }
    int semis(int k) const { return (int)std::lround(out.out[k] * 12.0f); }
    int soundingCount() {
        int n = 0;
        for (const auto& [k, v] : sounding) {
            EXPECT(v == 0 || v == 1);
            n += v;
        }
        return n;
    }
    void pulse(int k) {
        in.trig[k] = 1.0f;
        tick();
        in.trig[k] = 0.0f;
        tick();
    }
};

static void quantize() {
    TEST("quantizer suite: scale and mask, hysteresis");
    Rig r;
    r.p.ch[0].scale = 1;                      // C major
    r.p.ch[0].mask = dsp::scaleMask({0, 4, 7});  // C E G allowed
    r.in.in[0] = 5.4f / 12.0f;                // F + a bit → E (nearest of C E G)
    r.tick();
    EXPECT(r.semis(0) == 4);
    r.p.ch[0].mask = 0;                       // empty: only the root
    r.in.in[0] = 0.4f;                        // ~4.8 semitones
    r.tick();
    EXPECT(r.semis(0) == 0);
    for (int sc = 0; sc < 17; ++sc)
        for (uint16_t m : {(uint16_t)0xfff, dsp::scaleMask({0, 2, 7}), dsp::scaleMask({1, 6, 11})}) {
            const uint16_t a = QuantizerSuiteDsp::allowed(dsp::scales()[(size_t)sc].mask, m);
            EXPECT(a != 0 && (a & ~dsp::scales()[(size_t)sc].mask & m) == 0);
            for (int s = -12; s <= 12; ++s) EXPECT(dsp::inScale(a, dsp::quantize((float)s + 0.3f, a)));
        }
    // Hysteresis: from C, the input must pass the C–D midpoint by 10 % of a semitone.
    Rig h;
    h.p.ch[0].scale = 1;
    h.p.hysteresis = 0.1f;
    h.in.in[0] = 0.0f;
    h.tick();
    h.in.in[0] = 1.05f / 12.0f;
    h.tick();
    EXPECT(h.semis(0) == 0);
    h.in.in[0] = 1.15f / 12.0f;
    h.tick();
    EXPECT(h.semis(0) == 2);
    h.in.in[0] = 0.95f / 12.0f;  // back: must pass 0.9
    h.tick();
    EXPECT(h.semis(0) == 2);
    h.in.in[0] = 0.85f / 12.0f;
    h.tick();
    EXPECT(h.semis(0) == 0);
}

static void transpose() {
    TEST("quantizer suite: transpose across octaves");
    for (int sc : {11, 1, 15}) {  // 5-, 7- and 8-note scales
        const uint16_t m = dsp::scales()[(size_t)sc].mask;
        for (int steps = -14; steps <= 14; ++steps)
            for (int s : {0, 3, 7, 11}) {
                Rig r;
                r.p.ch[1].mode = patch::QsTranspose;
                r.p.ch[1].scale = sc;
                r.p.ch[1].steps = steps;
                r.in.in[1] = (float)s / 12.0f;
                r.tick();
                const int q = dsp::quantize((float)s, m);
                EXPECT(r.semis(1) == dsp::scaleNote(m, dsp::scaleIndexOf(m, q) + steps));
            }
    }
    // +2 in C major: C → E, A → C an octave up.
    Rig r;
    r.p.ch[1].steps = 2;
    r.in.in[1] = 9.0f / 12.0f;
    r.tick();
    EXPECT(r.semis(1) == 12);
}

static void normalledSeventh() {
    TEST("quantizer suite: one melody, four diatonic voices");
    Rig r;
    for (int s : {0, 2, 5, 9}) {  // C, D, F, A
        r.all((float)s / 12.0f);  // the module normals In B–D to In A
        r.tick();
        const uint16_t m = dsp::scales()[1].mask;
        for (int k = 0; k < 4; ++k) EXPECT(r.semis(k) == dsp::scaleNote(m, dsp::scaleIndexOf(m, s) + 2 * k));
    }
    r.all(0.0f);
    r.tick();
    EXPECT(r.semis(0) == 0 && r.semis(1) == 4 && r.semis(2) == 7 && r.semis(3) == 11);
}

static std::vector<int> arpSequence(int order, int n, uint32_t seed = 0, bool resetAfter3 = false) {
    Rig r;
    r.p.ch[0].mode = patch::QsArp;
    r.p.ch[0].chord = 0;  // Triad: C E G
    r.p.ch[0].order = order;
    r.p.ch[0].steps = 0;
    r.p.seed = seed;
    r.in.trigFed[0] = true;
    std::vector<int> seq;
    for (int i = 0; i < n; ++i) {
        if (resetAfter3 && i == 3) {
            r.in.reset = 1.0f;
            r.tick();
            r.in.reset = 0.0f;
        }
        r.pulse(0);
        seq.push_back(r.semis(0));
    }
    return seq;
}

static void arp() {
    TEST("quantizer suite: arpeggio orders");
    EXPECT((arpSequence(patch::QsUp, 7) == std::vector<int>{0, 4, 7, 0, 4, 7, 0}));
    EXPECT((arpSequence(patch::QsDown, 4) == std::vector<int>{7, 4, 0, 7}));
    EXPECT((arpSequence(patch::QsUpDown, 7) == std::vector<int>{0, 4, 7, 4, 0, 4, 7}));
    EXPECT((arpSequence(patch::QsConverge, 4) == std::vector<int>{0, 7, 4, 0}));
    const auto a = arpSequence(patch::QsRandom, 64, 5), b = arpSequence(patch::QsRandom, 64, 5),
               c = arpSequence(patch::QsRandom, 64, 6);
    EXPECT(a == b && a != c);
    for (size_t i = 1; i < a.size(); ++i) EXPECT(a[i] != a[i - 1]);
    EXPECT((arpSequence(patch::QsUp, 5, 0, true) == std::vector<int>{0, 4, 7, 0, 4}));
    // Seventh over 2 octaves, chromatic scale: major quality chords.
    int tones[patch::kQsMaxArp];
    const int n = QuantizerSuiteDsp::arpTones(2, 0xfff, 0, 1, 2, tones);
    EXPECT(n == 8 && tones[0] == 2 && tones[1] == 6 && tones[2] == 9 && tones[3] == 12 && tones[7] == 24);
    // Transport-driven (no Trig anywhere): one step per 1/16, phase-locked.
    Rig r;
    r.p.ch[0].mode = patch::QsArp;
    r.in.running = true;
    const double ppqPerSample = 2.0 / kSr;
    std::vector<int64_t> changes;
    for (int64_t i = 0; i < (int64_t)(1.0 / ppqPerSample) + 2; ++i) {
        r.in.ppq = (double)i * ppqPerSample;
        r.in.started = i == 0;
        r.tick();
        if (r.out.change[0] > 0.5f) changes.push_back(i);
    }
    EXPECT(changes.size() == 4);
    for (int64_t at : changes) {
        const double q = (double)at * ppqPerSample / 0.25;
        EXPECT(std::fabs(q - std::round(q)) * 0.25 <= ppqPerSample + 1e-12);
    }
    // Stop: the note ends.
    r.in.running = false;
    r.run(2);
    bool ch0 = false;
    for (const auto& [k, v] : r.sounding)
        if (k.first == 0 && v > 0) ch0 = true;
    EXPECT(!ch0);
}

static void follow() {
    TEST("quantizer suite: follow targets");
    const dsp::HarmonyState g7 = dsp::makeHarmony(0, dsp::scales()[1].mask, 7, dsp::ChordDominant7);  // G7 in C
    Rig r;
    auto& c = r.p.ch[0];
    c.mode = patch::QsFollow;
    c.harmony = &g7;
    c.steps = 0;
    for (int s = -12; s <= 12; ++s) {  // Chord: only chord tones
        r.dsp.reset();
        c.target = patch::QsChord;
        r.in.in[0] = (float)s / 12.0f;
        r.tick();
        EXPECT(dsp::inScale(dsp::absoluteChord(g7), r.semis(0)));
    }
    // Chord + Scale: a passing E stays E, a G♯ lands on G (chord tone within a semitone wins), C♯ → B or D.
    c.target = patch::QsChordScale;
    r.dsp.reset();
    r.in.in[0] = 4.4f / 12.0f;  // ~E: F is a chord tone 0.6 away → F
    r.tick();
    EXPECT(r.semis(0) == 5);
    r.dsp.reset();
    r.in.in[0] = 9.0f / 12.0f;  // A: no chord tone within 1 → A (scale)
    r.tick();
    EXPECT(r.semis(0) == 9);
    // Root: the chord root in the nearest octave.
    c.target = patch::QsRoot;
    r.dsp.reset();
    r.in.in[0] = 2.0f / 12.0f;
    r.tick();
    EXPECT(r.semis(0) == 7 || r.semis(0) == -5);
    r.in.in[0] = 6.0f / 12.0f;
    r.tick();
    EXPECT(r.semis(0) == 7);
    // Steps in Chord: +1 chord tone.
    c.target = patch::QsChord;
    c.steps = 1;
    r.dsp.reset();
    r.in.in[0] = 7.0f / 12.0f;  // G → B
    r.tick();
    EXPECT(r.semis(0) == 11);
    // No bus: acts as Quantize.
    c.harmony = nullptr;
    r.in.in[0] = 6.4f / 12.0f;
    r.tick();
    EXPECT(r.semis(0) == 7);
}

static void harmonyMasterDrivesFollow() {
    TEST("quantizer suite: a Harmony Master drives Follow on the sample of a change");
    patch::HarmonyMasterDsp hm;
    hm.prepare(kSr);
    hm.reset();
    patch::HmParams hp;  // Manual, C major, diatonic triads
    patch::HmInput hin;
    patch::HmOutputs ho;
    Rig r;
    r.p.ch[0].mode = patch::QsFollow;
    r.p.ch[0].target = patch::QsChord;
    r.p.ch[0].steps = 0;
    r.p.ch[1].mode = patch::QsFollow;
    r.p.ch[1].target = patch::QsRoot;
    r.in.in[0] = r.in.in[1] = 3.0f / 12.0f;  // D♯
    for (int i = 0; i < 400; ++i) {
        hp.degree = i < 200 ? 1 : 5;  // C → G on sample 200
        hm.tick(hp, hin, ho, 64, [](bool, int, float, float) {});
        dsp::HarmonyState ctx = hm.context();
        ctx.valid = true;
        r.p.ch[0].harmony = r.p.ch[1].harmony = &ctx;
        r.tick();
        if (i == 199) EXPECT(r.semis(0) == 4 && r.semis(1) == 0);      // E of C, root C
        if (i == 200) {
            EXPECT(r.semis(0) == 2 && r.semis(1) == 7);                 // D of G, root G
            EXPECT(r.out.change[0] > 0.5f && r.out.change[1] > 0.5f);  // re-quantized on that sample
        }
    }
}

static void sampling() {
    TEST("quantizer suite: sampling and slew");
    Rig r;
    r.p.ch[0].sample = patch::QsTrigger;
    r.in.trigFed[0] = true;
    r.in.in[0] = 0.0f;
    r.pulse(0);
    r.in.in[0] = 5.0f / 12.0f;
    r.run(10);
    EXPECT(r.semis(0) == 0);
    r.pulse(0);
    EXPECT(r.semis(0) == 5);
    // A pulse on the same note: Change fires and the note retriggers.
    r.events.clear();
    r.in.trig[0] = 1.0f;
    r.tick();
    EXPECT(r.out.change[0] > 0.5f);
    r.in.trig[0] = 0.0f;
    r.tick();
    int offs = 0, ons = 0;
    for (const auto& e : r.events)
        if (e.ch == 0) (e.on ? ons : offs)++;
    EXPECT(offs == 1 && ons == 1 && !r.events[0].on);
    // Track & Hold.
    r.p.ch[0].sample = patch::QsTrackHold;
    r.in.trig[0] = 1.0f;
    r.in.in[0] = 7.0f / 12.0f;
    r.tick();
    EXPECT(r.semis(0) == 7);
    r.in.trig[0] = 0.0f;
    r.in.in[0] = 0.0f;
    r.run(5);
    EXPECT(r.semis(0) == 7);
    // Slew: 0.1 s for any jump; a new change restarts from the current value.
    Rig s;
    s.p.ch[0].slew = 0.1f;
    s.tick();
    s.in.in[0] = 1.0f;  // an octave
    const int64_t n = (int64_t)(0.1 * kSr);
    s.run(n / 2);
    EXPECT_NEAR(s.out.out[0], 0.5, 0.01);
    s.run(n / 2);
    EXPECT_NEAR(s.out.out[0], 1.0, 1e-5);
    s.in.in[0] = 2.0f;
    s.run(n / 2);
    EXPECT_NEAR(s.out.out[0], 1.5, 0.01);
    s.in.in[0] = 0.0f;  // mid-glide: from 1.5 to 0 in 0.1 s
    s.run(n / 2);
    EXPECT_NEAR(s.out.out[0], 0.75, 0.01);
}

static void notes() {
    TEST("quantizer suite: notes");
    Rig r;
    r.all(0.0f);
    r.run(2);
    EXPECT(r.soundingCount() == 4);
    for (const auto& e : r.events) EXPECT(e.on && e.note == 60 + (e.ch == 0 ? 0 : e.ch == 1 ? 4 : e.ch == 2 ? 7 : 11));
    r.events.clear();
    r.all(2.0f / 12.0f);
    r.tick();
    EXPECT(r.events.size() == 8);
    for (size_t i = 0; i + 1 < r.events.size(); i += 2)
        EXPECT(r.events[i].on && !r.events[i + 1].on && r.events[i].ch == r.events[i + 1].ch);
    r.p.ch[2].notes = false;
    r.tick();
    EXPECT(r.soundingCount() == 3);
    r.p.ch[2].notes = true;
    r.tick();
    EXPECT(r.soundingCount() == 4);
    // Out of MIDI range: folded by octaves.
    r.all(9.0f);
    r.tick();
    for (const auto& [k, v] : r.sounding)
        if (v > 0) EXPECT(k.second >= 0 && k.second <= 127);
    r.dsp.release([&](int ch, bool on, int note, float, float) { r.sounding[{ch, note}] += on ? 1 : -1; });
    EXPECT(r.soundingCount() == 0);
    // Every sample a new note on all channels and little room: nothing hangs.
    Rig q;
    for (int i = 0; i < 3000; ++i) {
        q.all((float)((i * 7) % 25 - 12) / 12.0f);
        q.dsp.tick(q.p, q.in, q.out, (i % 3) * 2, [&](int ch, bool on, int note, float, float) {
            q.sounding[{ch, note}] += on ? 1 : -1;
        });
    }
    EXPECT(q.soundingCount() <= 4);
}

int main() {
    quantize();
    transpose();
    normalledSeventh();
    arp();
    follow();
    harmonyMasterDrivesFollow();
    sampling();
    notes();
    return bleep::test::finish("quantizer-suite");
}
