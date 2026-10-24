// SPDX-License-Identifier: GPL-3.0-only
#include "TunerDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cstdint>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

struct Run {
    TunerDsp dsp;
    TunerParams p;
    TunerFrame f;
    std::vector<float> cents, gate;
    Run() { dsp.prepare(kSr); }
    template <class Src>
    void render(int n, Src&& src) {
        for (int i = 0; i < n; ++i) {
            dsp.tick(src(i), p, f);
            cents.push_back(f.cents);
            gate.push_back(f.inTune);
        }
    }
};
static float tone(double hz, int i) { return 0.5f * (float)std::sin(2.0 * kPi * hz * i / kSr); }

static void noteMath() {
    TEST("note arithmetic around the reference A");
    NoteReading n = nearestNote(440.0f, 440.0f);
    EXPECT(n.midi == 69);
    EXPECT_NEAR(n.cents, 0.0, 0.01);
    n = nearestNote(261.6256f, 440.0f);
    EXPECT(n.midi == 60);
    EXPECT_NEAR(n.cents, 0.0, 0.05);
    n = nearestNote(440.0f * std::exp2(30.0f / 1200.0f), 440.0f);
    EXPECT(n.midi == 69);
    EXPECT_NEAR(n.cents, 30.0, 0.1);
    n = nearestNote(440.0f * std::exp2(-70.0f / 1200.0f), 440.0f);
    EXPECT(n.midi == 68);
    EXPECT_NEAR(n.cents, 30.0, 0.1);
    n = nearestNote(432.0f, 432.0f);
    EXPECT(n.midi == 69);
    EXPECT_NEAR(noteHz(57, 440.0f), 220.0, 0.01);
}

static void readsNotesAndCents() {
    TEST("pure tones read the right note and cents at several pitches");
    struct Case { double hz; int midi; double cents; };
    const Case cases[] = {{82.41, 40, 0.0},  {110.0, 45, 0.0},   {196.0, 55, 0.0},     {247.0, 59, -4.0},
                          {330.0, 64, 20.0}, {440.0, 69, 0.0},   {466.16, 70, 0.0},    {880.0, 81, -25.0},
                          {1174.66, 86, 0.0}};
    for (const auto& c : cases) {
        const double hz = c.hz * std::exp2(c.cents / 1200.0);
        Run r;
        r.render((int)(kSr * 0.6), [&](int i) { return tone(hz, i); });
        EXPECT(r.dsp.midi() == c.midi);
        EXPECT(r.dsp.haveNote());
    }
    // exact cents check on an A4 that is 12 cents sharp
    Run r;
    r.render((int)(kSr * 0.6), [&](int i) { return tone(440.0 * std::exp2(12.0 / 1200.0), i); });
    EXPECT_NEAR(r.f.cents, 12.0, 1.5);
}

static void referenceMoves() {
    TEST("the reference A shifts the reading");
    Run r;
    r.p.referenceA = 432.0f;
    r.render((int)(kSr * 0.6), [](int i) { return tone(432.0, i); });
    EXPECT_NEAR(r.f.cents, 0.0, 1.5);
    Run q;
    q.render((int)(kSr * 0.6), [](int i) { return tone(432.0, i); });
    EXPECT_NEAR(q.f.cents, -31.8, 2.0);
}

static void inTuneGate() {
    TEST("in tune gate: opens inside the tolerance, stays shut outside, closes in silence");
    Run r;
    r.p.tolerance = 5.0f;
    r.render((int)(kSr * 0.6), [](int i) { return tone(220.0, i); });
    EXPECT(r.f.inTune > 0.5f);
    Run s;
    s.render((int)(kSr * 0.6), [](int i) { return tone(220.0 * std::exp2(20.0 / 1200.0), i); });
    EXPECT(s.f.inTune < 0.5f);
    r.render((int)(kSr * 0.4), [](int) { return 0.0f; });
    EXPECT(r.f.inTune < 0.5f);
    EXPECT(r.dsp.haveNote());  // the reading is held for the display
}

static void noiseIsIgnored() {
    TEST("noise opens no gate");
    Run r;
    uint32_t s = 9;
    r.render((int)(kSr * 1.0), [&](int) {
        s = s * 1664525u + 1013904223u;
        return 0.4f * ((float)(s >> 8) / 8388608.0f - 1.0f);
    });
    int open = 0;
    for (float g : r.gate) open += g > 0.5f;
    EXPECT(open < 500);
}

static void changeOfNoteIsImmediate() {
    TEST("a new note shows at once instead of sliding from the old one");
    Run r;
    r.p.damping = 0.5f;
    r.render((int)(kSr * 0.6), [](int i) { return tone(220.0, i); });
    double ph = 0.0;
    r.render((int)(kSr * 0.25), [&](int) {
        ph += 330.0 / kSr;
        return 0.5f * (float)std::sin(2.0 * kPi * ph);
    });
    EXPECT(r.dsp.midi() == 64);
}

int main() {
    noteMath();
    readsNotesAndCents();
    referenceMoves();
    inTuneGate();
    noiseIsIgnored();
    changeOfNoteIsImmediate();
    return bleep::test::finish("tuner");
}
