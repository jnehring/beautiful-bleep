// SPDX-License-Identifier: MIT
// Chord Osc: chord intervals (spectrum), tone dropping and doubling,
// inversions, voicings and the range guard, Scale mode qualities and
// quantizing, Latch, click-free changes, levels, the Root output against the
// Oscillator, seeded detune and aliasing.
#include "ChordOscDsp.h"
#include "OscillatorDsp.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <set>
#include <vector>

using namespace bleep;
using bleep::test::magnitudeAt;
using patch::ChordOscDsp;
using patch::ChordOscParams;

namespace {

constexpr double kSr = 48000.0;

double hz(float semis) { return dsp::osc::kC4Hz * std::pow(2.0, semis / 12.0); }

/// Renders `n` samples of Out L (or Root) and returns them.
std::vector<float> render(ChordOscDsp& d, const ChordOscParams& p, int n, int which = 0) {
    std::vector<float> out((size_t)n);
    for (int i = 0; i < n; ++i) {
        const auto f = d.tick(p, 0.0f, false, 0.0f);
        out[(size_t)i] = which == 0 ? f.l : which == 1 ? f.r : f.root;
    }
    return out;
}

/// The sounding voice pitches (semitones from C4), sorted.
std::vector<int> voicePitches(ChordOscDsp& d) {
    const auto info = d.info();
    std::vector<int> v;
    for (int k = 0; k < info.count; ++k) v.push_back((int)std::lround(info.pitch[k] * 12.0f));
    std::sort(v.begin(), v.end());
    return v;
}

std::vector<int> pitchesFor(ChordOscParams p) {
    ChordOscDsp d;
    d.prepare(kSr);
    d.reset();
    d.tick(p, 0.0f, false, 0.0f);
    return voicePitches(d);
}

ChordOscParams sine() {
    ChordOscParams p;
    p.shape = 0.0f;
    return p;
}

void chromaticChords() {
    TEST("every chromatic chord at C4 plays exactly its intervals");
    for (int q = 0; q < dsp::kNumChordOscQualities; ++q) {
        const auto& cq = dsp::chordQuality(q);
        ChordOscParams p = sine();
        p.chord = q;
        p.voices = cq.count;
        ChordOscDsp d;
        d.prepare(kSr);
        d.reset();
        const auto x = render(d, p, 16384);
        std::vector<int> want(cq.intervals, cq.intervals + cq.count);
        std::sort(want.begin(), want.end());
        EXPECT(voicePitches(d) == want);
        const double each = 0.5 / std::sqrt((double)cq.count);
        for (int iv : want) EXPECT(magnitudeAt(x, hz((float)iv), kSr) > 0.8 * each);
        // A semitone that isn't in the chord stays quiet.
        for (int s = 1; s < 12; ++s)
            if (std::find(want.begin(), want.end(), s) == want.end() &&
                std::find(want.begin(), want.end(), s + 12) == want.end())
                EXPECT(magnitudeAt(x, hz((float)s), kSr) < 0.02 * each);
    }
}

void dropAndDouble() {
    TEST("tone dropping and doubling on a 5-tone chord (Major 9)");
    ChordOscParams p;
    p.chord = dsp::ChordMajor9;  // 0 4 7 11 14
    const std::vector<std::vector<int>> want = {
        {0}, {0, 4}, {0, 4, 11}, {0, 4, 11, 14}, {0, 4, 7, 11, 14}, {0, 4, 7, 11, 12, 14}};
    for (int v = 1; v <= 6; ++v) {
        p.voices = v;
        EXPECT(pitchesFor(p) == want[(size_t)v - 1]);
    }
}

void inversionsAndVoicings() {
    TEST("inversions, voicings and the range guard");
    ChordOscParams p;
    p.chord = dsp::ChordMajor7;  // 0 4 7 11
    p.voices = 4;
    const std::vector<std::pair<int, std::vector<int>>> inv = {
        {1, {4, 7, 11, 12}}, {2, {7, 11, 12, 16}}, {3, {11, 12, 16, 19}}, {4, {12, 16, 19, 23}},
        {-1, {-1, 0, 4, 7}}, {-2, {-5, -1, 0, 4}}, {-3, {-8, -5, -1, 0}}, {-4, {-12, -8, -5, -1}}};
    for (const auto& [i, w] : inv) {
        p.inversion = i;
        EXPECT(pitchesFor(p) == w);
    }
    p.inversion = 0;
    const std::vector<std::vector<int>> voicings = {
        {0, 4, 7, 11}, {-5, 0, 4, 11}, {-8, 0, 7, 11}, {-12, -5, 4, 11}, {-12, 4, 7, 11}, {-12, -1, 4, 19}};
    for (int v = 0; v < 6; ++v) {
        p.voicing = v;
        EXPECT(pitchesFor(p) == voicings[(size_t)v]);
    }
    // Voicings that need more voices fall back to Close.
    p.voices = 2;
    p.voicing = 3;  // Drop 2+4 needs 4
    EXPECT(pitchesFor(p) == (std::vector<int>{0, 4}));
    // Range guard: every voice within 16 Hz … 8 kHz.
    p.voices = 6;
    p.voicing = 5;  // Wide: about three octaves
    for (float pitch : {-5.0f, -4.0f, 3.0f, 4.0f, 5.0f}) {
        p.pitch = pitch;
        for (int s : pitchesFor(p)) {
            EXPECT(hz((float)s) >= 15.9);
            EXPECT(hz((float)s) <= 8000.0);
        }
    }
}

void scaleMode() {
    TEST("Scale mode: diatonic qualities, ties go down, 5-note scales wrap");
    ChordOscParams p;
    p.scaleMode = true;
    p.scale = dsp::scales()[1].mask;  // Major
    p.stack = dsp::StackTriad;
    p.voices = 3;
    const int degrees[7] = {0, 2, 4, 5, 7, 9, 11};
    const int want[7] = {dsp::ChordMajor, dsp::ChordMinor,  dsp::ChordMinor,     dsp::ChordMajor,
                         dsp::ChordMajor, dsp::ChordMinor, dsp::ChordDiminished};
    for (int i = 0; i < 7; ++i) {
        p.pitch = (float)degrees[i] / 12.0f;
        ChordOscDsp d;
        d.prepare(kSr);
        d.reset();
        d.tick(p, 0.0f, false, 0.0f);
        EXPECT(d.info().quality == want[i]);
        EXPECT(d.info().rootPc == degrees[i]);
        EXPECT(d.info().degree == i);
    }
    // C♯ lies between C and D: ties go down, to C.
    p.pitch = 1.0f / 12.0f;
    EXPECT(pitchesFor(p) == (std::vector<int>{0, 4, 7}));
    // In D major (key 2) a seventh on the 5th degree is A7.
    p.key = 2;
    p.stack = dsp::StackSeventh;
    p.voices = 4;
    p.pitch = 9.0f / 12.0f;
    EXPECT(pitchesFor(p) == (std::vector<int>{9, 13, 16, 19}));
    // Major pentatonic on A (degree 4): steps wrap past the octave → A D G.
    p.key = 0;
    p.scale = dsp::scales()[11].mask;
    p.stack = dsp::StackTriad;
    p.voices = 3;
    EXPECT(pitchesFor(p) == (std::vector<int>{9, 14, 19}));
}

void latch() {
    TEST("Latch holds the chord between pulses; a pulse uses the new pitch");
    ChordOscDsp d;
    d.prepare(kSr);
    d.reset();
    ChordOscParams p;
    p.voices = 3;
    d.tick(p, 0.0f, true, 1.0f);  // pulse: C major
    d.tick(p, 0.0f, true, 0.0f);
    p.chord = dsp::ChordMinor;
    p.pitch = 2.0f / 12.0f;
    for (int i = 0; i < 1000; ++i) d.tick(p, 0.0f, true, 0.0f);
    EXPECT(voicePitches(d) == (std::vector<int>{0, 4, 7}));
    EXPECT(d.info().latched);
    d.tick(p, 0.0f, true, 1.0f);  // pulse on the same sample as the change
    EXPECT(voicePitches(d) == (std::vector<int>{2, 5, 9}));
    // Unpatched: follows continuously again.
    p.chord = dsp::ChordMajor;
    d.tick(p, 0.0f, false, 0.0f);
    EXPECT(voicePitches(d) == (std::vector<int>{2, 6, 9}));
    EXPECT(!d.info().latched);
}

void clickFree() {
    TEST("chord and voice-count changes are click-free; voices fade over 5 ms");
    ChordOscDsp d;
    d.prepare(kSr);
    d.reset();
    ChordOscParams p = sine();
    p.voices = 4;
    p.chord = dsp::ChordMajor7;
    float maxStep = 0.0f, prev = 0.0f;
    for (int i = 0; i < 48000; ++i) {
        if (i % 4800 == 0) p.chord = (p.chord + 7) % dsp::kNumChordOscQualities;
        if (i % 3000 == 0) p.voices = 1 + (i / 3000) % 6;
        const float y = d.tick(p, 0.0f, false, 0.0f).l;
        if (i > 0) maxStep = std::max(maxStep, std::fabs(y - prev));
        prev = y;
    }
    // A sum of six sines up to ~1.6 kHz moves less than ~0.3 per sample; a click would jump further.
    EXPECT(maxStep < 0.35f);

    // The fade: one voice → six, the new voices reach full level after 5 ms (240 samples).
    ChordOscDsp e;
    e.prepare(kSr);
    e.reset();
    ChordOscParams q = sine();
    q.chord = dsp::ChordUnison;
    q.voices = 1;
    for (int i = 0; i < 100; ++i) e.tick(q, 0.0f, false, 0.0f);
    q.voices = 6;  // six voices on one tone: doublings of the root, octaves up
    std::vector<float> x;
    for (int i = 0; i < 480; ++i) x.push_back(e.tick(q, 0.0f, false, 0.0f).l);
    // The voices above the root ramp: the first ms is quieter than the last.
    double early = 0.0, late = 0.0;
    for (int i = 0; i < 48; ++i) early = std::max(early, (double)std::fabs(x[(size_t)i]));
    for (int i = 400; i < 480; ++i) late = std::max(late, (double)std::fabs(x[(size_t)i]));
    EXPECT(late > early);
}

void levels() {
    TEST("levels: Out bounded, Root equals the Oscillator, Stereo 0 is mono");
    ChordOscDsp d;
    d.prepare(kSr);
    d.reset();
    ChordOscParams p;
    p.shape = 1.0f;  // square
    p.voices = 6;
    p.chord = dsp::ChordMajor9;
    float peak = 0.0f;
    bool mono = true;
    for (int i = 0; i < 96000; ++i) {
        const auto f = d.tick(p, 0.0f, false, 0.0f);
        peak = std::max(peak, std::fabs(f.l));
        mono = mono && f.l == f.r;
    }
    EXPECT(peak <= std::sqrt(6.0f) * 1.05f);  // Σ / √n
    EXPECT(mono);

    // Root vs Oscillator, same pitch, shape, pulse width and FM.
    ChordOscDsp c;
    c.prepare(kSr);
    c.reset();
    patch::OscillatorDsp o;
    o.prepare(kSr);
    o.reset();
    ChordOscParams q;
    q.shape = 0.55f;
    q.pulseWidth = 0.3f;
    q.fmDepth = 0.2f;
    q.tune = 13.0f;
    q.octave = -1;
    q.inversion = 2;
    q.voicing = 4;
    patch::OscillatorParams op;
    op.shape = q.shape;
    op.pulseWidth = q.pulseWidth;
    op.fmDepth = q.fmDepth;
    double worst = 0.0;
    for (int i = 0; i < 48000; ++i) {
        q.pitch = 0.3f * std::sin((float)i * 0.0003f);
        const float fm = std::sin((float)i * 0.05f);
        op.pitch = -1.0f + 13.0f / 1200.0f + q.pitch;
        const float a = c.tick(q, fm, false, 0.0f).root;
        const float b = o.tick(op, fm, 0.0f).out;
        worst = std::max(worst, (double)std::fabs(a - b));
    }
    EXPECT(worst < 1e-6);
}

void detune() {
    TEST("seeded detune: same seed same offsets, different seeds differ");
    bool differ = false;
    for (int k = 0; k < 6; ++k) {
        EXPECT(ChordOscDsp::detuneOffset(7, k) == ChordOscDsp::detuneOffset(7, k));
        EXPECT(std::fabs(ChordOscDsp::detuneOffset(7, k)) <= 1.0f);
        differ = differ || ChordOscDsp::detuneOffset(7, k) != ChordOscDsp::detuneOffset(8, k);
    }
    EXPECT(differ);
    ChordOscParams p;
    p.detune = 30.0f;
    p.stereo = 0.7f;
    ChordOscDsp a, b;
    a.prepare(kSr), b.prepare(kSr);
    a.reset(), b.reset();
    EXPECT(render(a, p, 4800) == render(b, p, 4800));
}

void stereo() {
    TEST("pan positions: centre first, alternating sides");
    EXPECT(ChordOscDsp::panPosition(0, 1) == 0.0f);
    EXPECT(ChordOscDsp::panPosition(0, 3) == 0.0f);
    EXPECT(ChordOscDsp::panPosition(1, 3) < 0.0f);
    EXPECT(ChordOscDsp::panPosition(2, 3) > 0.0f);
    std::set<float> used;
    for (int k = 0; k < 6; ++k) used.insert(ChordOscDsp::panPosition(k, 6));
    EXPECT(used.size() == 6);
    EXPECT(std::fabs(ChordOscDsp::panPosition(0, 6)) < 0.25f);
}

void aliasing() {
    TEST("aliasing of a saw voice at C7 (polyBLEP)");
    ChordOscDsp d;
    d.prepare(kSr);
    d.reset();
    ChordOscParams p;
    p.chord = dsp::ChordUnison;
    p.voices = 1;
    p.pitch = 3.0f;  // C7, 2093 Hz
    const auto x = render(d, p, 32768);
    const double f0 = hz(36.0f);
    const double fund = magnitudeAt(x, f0, kSr);
    // Harmonics above Nyquist fold back to h·f0 − m·sr; measure the strongest
    // of those that land in the band below 10 kHz, away from real harmonics
    // (polyBLEP leaves stronger aliases just below Nyquist, where they hide).
    double worst = 0.0;
    for (int h = 10; h < 80; ++h) {
        double f = std::fmod(h * f0, kSr);
        if (f > kSr / 2) f = kSr - f;
        const double nearest = std::round(f / f0) * f0;
        if (h * f0 < kSr / 2 || std::fabs(f - nearest) < 60.0 || f < 40.0 || f > 10000.0) continue;
        worst = std::max(worst, magnitudeAt(x, f, kSr));
    }
    std::printf("  saw C7: strongest alias %.1f dB\n", 20.0 * std::log10(worst / fund));
    EXPECT(worst < fund * 0.00316);  // −50 dB
}

}  // namespace

int main() {
    chromaticChords();
    dropAndDouble();
    inversionsAndVoicings();
    scaleMode();
    latch();
    clickFree();
    levels();
    detune();
    stereo();
    aliasing();
    return bleep::test::finish("chord-osc");
}
