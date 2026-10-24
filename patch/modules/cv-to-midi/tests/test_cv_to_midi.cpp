// SPDX-License-Identifier: GPL-3.0-only
#include "CvToMidiDsp.h"
#include "dsp/tests/TestUtil.h"

using namespace bleep::patch;

static void sevenBit() {
    TEST("7 bit: 0…1 maps to 0…127, only changes are sent");
    CvToMidiLane lane;
    lane.reset();
    CvToMidiLaneParams p;
    p.cc = 74;
    CvToMidiMessages m;
    lane.tick(0.5f, p, m);
    EXPECT(m.count == 1 && m.cc[0] == 74 && m.data[0] == 64);
    lane.tick(0.5f, p, m);
    EXPECT(m.count == 0);
    lane.tick(0.5001f, p, m);  // same quantised value
    EXPECT(m.count == 0);
    lane.tick(1.5f, p, m);     // clamped
    EXPECT(m.count == 1 && m.data[0] == 127);
    lane.tick(-3.0f, p, m);
    EXPECT(m.count == 1 && m.data[0] == 0);
}

static void bipolarAndRange() {
    TEST("bipolar input and a restricted data range");
    CvToMidiLaneParams p;
    p.bipolar = true;
    EXPECT(CvToMidiLane::quantise(-1.0f, p) == 0);
    EXPECT(CvToMidiLane::quantise(0.0f, p) == 64);
    EXPECT(CvToMidiLane::quantise(1.0f, p) == 127);
    p.bipolar = false;
    p.minData = 20;
    p.maxData = 100;
    EXPECT(CvToMidiLane::quantise(0.0f, p) == 20);
    EXPECT(CvToMidiLane::quantise(1.0f, p) == 100);
    p.minData = 100;  // min above max inverts
    p.maxData = 20;
    EXPECT(CvToMidiLane::quantise(0.0f, p) == 100);
    EXPECT(CvToMidiLane::quantise(1.0f, p) == 20);
}

static void fourteenBit() {
    TEST("14 bit: MSB on cc, LSB on cc + 32; falls back to 7 bit from CC 32");
    CvToMidiLane lane;
    lane.reset();
    CvToMidiLaneParams p;
    p.cc = 1;
    p.hires = true;
    CvToMidiMessages m;
    lane.tick(1.0f, p, m);
    EXPECT(m.count == 2 && m.cc[0] == 1 && m.cc[1] == 33 && m.data[0] == 127 && m.data[1] == 127);
    lane.tick(0.25f, p, m);
    const int v = (m.data[0] << 7) | m.data[1];
    EXPECT(m.count == 2 && std::abs(v - 4096) <= 1);
    CvToMidiLane other;
    other.reset();
    p.cc = 40;
    other.tick(1.0f, p, m);
    EXPECT(m.count == 1 && m.cc[0] == 40);
}

static void rateLimit() {
    TEST("rate limit: no faster than the gap, the latest value still arrives");
    CvToMidiLane lane;
    lane.reset();
    CvToMidiLaneParams p;
    p.minGapSamples = 100;
    CvToMidiMessages m;
    int sent = 0, lastData = -1;
    for (int i = 0; i < 1000; ++i) {
        lane.tick(i < 500 ? (float)i / 500.0f : 1.0f, p, m);
        if (m.count) {
            ++sent;
            lastData = m.data[0];
        }
    }
    EXPECT(sent <= 11);
    EXPECT(lastData == 127);
}

static void resend() {
    TEST("resend and reset send the value again");
    CvToMidiLane lane;
    lane.reset();
    CvToMidiLaneParams p;
    CvToMidiMessages m;
    lane.tick(0.3f, p, m);
    lane.tick(0.3f, p, m);
    EXPECT(m.count == 0);
    lane.resend();
    lane.tick(0.3f, p, m);
    EXPECT(m.count == 1);
}

static void notANumber() {
    TEST("NaN input maps to 0");
    CvToMidiLaneParams p;
    EXPECT(CvToMidiLane::quantise(std::nanf(""), p) == 0);
}

int main() {
    sevenBit();
    bipolarAndRange();
    fourteenBit();
    rateLimit();
    resend();
    notANumber();
    return bleep::test::finish("cv-to-midi");
}
