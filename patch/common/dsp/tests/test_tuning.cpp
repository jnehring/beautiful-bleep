// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Microtonal tunings (Scales.h): equal divisions, scale-file parsing, nearest-step
// rounding, and the tuned path of the Quantizer core.
#include "TestUtil.h"
#include "QuantizerDsp.h"

#include <cmath>

using namespace bleep;

static void edoSteps() {
    TEST("19 divisions");
    const auto t = dsp::Tuning::edo(19);
    EXPECT_NEAR(t.pitch(0), 0.0, 1e-6);
    EXPECT_NEAR(t.pitch(19), 1.0, 1e-5);
    EXPECT_NEAR(t.pitch(-19), -1.0, 1e-5);
    EXPECT_NEAR(t.pitch(1), 1.0 / 19.0, 1e-5);
    EXPECT(t.index(0.5f / 19.0f + 0.001f) == 1);
    EXPECT(t.index(0.5f / 19.0f - 0.001f) == 0);
    EXPECT(t.index(0.7f / 19.0f, 1) == 0);   // down
    EXPECT(t.index(0.2f / 19.0f, 2) == 1);   // up
    EXPECT(t.index(-0.2f / 19.0f, 1) == -1); // below the root
    EXPECT(t.index(3.0f / 19.0f, 2) == 3);   // on a step: up stays
}

static void edo12MatchesSemitones() {
    TEST("12 divisions are semitones");
    const auto t = dsp::Tuning::edo(12);
    for (float s = -30.0f; s < 30.0f; s += 0.13f) {
        const int a = t.index(s / 12.0f), b = (int)std::floor(s + 0.5f);
        if (std::fabs(s - std::floor(s) - 0.5f) > 0.02f) EXPECT(a == b);
    }
}

static void parseFile() {
    TEST("scale file");
    dsp::Tuning t;
    std::string err;
    const char* text =
        "! just.scl\n!\nFive-note just scale\n 5\n!\n 9/8\n 5/4\n 3/2\n 1200.0 cents\n 2/1\n";
    // 5 pitch lines: the last is the period; here a line with "1200.0" comes before 2/1, so it must be rejected (not rising).
    EXPECT(!dsp::Tuning::parse(text, t, &err));
    const char* ok = "! x\nFour notes\n4\n9/8\n5/4\n702.0\n2\n";
    EXPECT(dsp::Tuning::parse(ok, t, &err));
    EXPECT(t.count == 4);
    EXPECT_NEAR(t.period, 1200.0, 0.01);
    EXPECT_NEAR(t.cents[1], 203.91, 0.01);
    EXPECT_NEAR(t.cents[2], 386.31, 0.01);
    EXPECT_NEAR(t.cents[3], 702.0, 0.01);
    EXPECT(t.index(0.595f) == 3);  // 714 cents
    EXPECT(dsp::Tuning::parse("x\r\n2\r\n300.0\r\n3/1\r\n", t));  // CRLF, period of a twelfth
    EXPECT_NEAR(t.period, 1901.955, 0.01);
    EXPECT(!dsp::Tuning::parse("", t));
    EXPECT(!dsp::Tuning::parse("x\n3\n100.0\n", t));
    EXPECT(!dsp::Tuning::parse("x\n2\n200.0\n100.0\n", t));
    EXPECT(!dsp::Tuning::parse("x\n1\n0/1\n", t));
    EXPECT(!dsp::Tuning::parse("x\n0\n", t));
}

static void quantizerTuned() {
    TEST("quantizer on 24 divisions");
    patch::QuantizerDsp q;
    q.prepare(48000.0);
    q.reset();
    const auto t = dsp::Tuning::edo(24);
    patch::QuantizerParams p;
    p.tuning = &t;
    p.hysteresis = 0.0f;
    patch::QuantizerInputs in;
    patch::QuantizerFrame f;
    in.in = 0.30f / 12.0f;  // 0.3 semitones: nearest quarter tone is 0.5
    for (int i = 0; i < 4; ++i) q.tick(in, p, f);
    EXPECT_NEAR(f.out, 0.5f / 12.0f, 1e-5);
    in.in = 1.1f / 12.0f;
    for (int i = 0; i < 4; ++i) q.tick(in, p, f);
    EXPECT_NEAR(f.out, 1.0f / 12.0f, 1e-5);
    p.root = 2;  // the grid moves with the root
    in.in = 2.4f / 12.0f;
    for (int i = 0; i < 4; ++i) q.tick(in, p, f);
    EXPECT_NEAR(f.out, 2.5f / 12.0f, 1e-5);
    p.tuning = nullptr;  // back to 12 notes
    p.root = 0;
    in.in = 3.1f / 12.0f;
    for (int i = 0; i < 4; ++i) q.tick(in, p, f);
    EXPECT_NEAR(f.out, 3.0f / 12.0f, 1e-5);
}

int main() {
    edoSteps();
    edo12MatchesSemitones();
    parseFile();
    quantizerTuned();
    return test::finish("tuning");
}
