// SPDX-License-Identifier: GPL-3.0-or-later
// Audio Console: unity and pan, mute and solo, the sends (post and pre fader), filters and EQ against their analytic
// response, direct outputs, the recorder taps, channels beyond the count (doc/specs/modules/audio-console.md §8).
#include "AudioConsoleDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <vector>

using namespace bleep;
using patch::AudioConsoleDsp;
using patch::ConsoleFrame;
using patch::ConsoleInputs;
using patch::ConsoleParams;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

struct Run {
    std::vector<float> outL, outR, send1L, direct1L, tap1L, peak1;
};

/// Runs `n` samples of a sine on channel 1 (and `other` on channel 2) through the console.
static Run run(AudioConsoleDsp& d, ConsoleParams& p, double hz, int n, float amp = 0.5f, float other = 0.0f) {
    Run r;
    ConsoleInputs in;
    ConsoleFrame f;
    for (int i = 0; i < n; ++i) {
        if (i % 32 == 0) d.update(p);
        const float x = amp * (float)std::sin(2.0 * kPi * hz * i / kSr);
        in.l[0] = in.r[0] = x;
        in.l[1] = in.r[1] = other;
        d.tick(in, p, f);
        r.outL.push_back(f.outL);
        r.outR.push_back(f.outR);
        r.send1L.push_back(f.sendL[0]);
        r.direct1L.push_back(f.directL[0]);
        r.tap1L.push_back(f.tapL[0]);
        r.peak1.push_back(f.peak[0]);
    }
    return r;
}

static ConsoleParams basic() {
    ConsoleParams p;
    p.channels = 2;
    p.aux = 2;
    p.limiter = false;
    return p;
}

static double gainAt(double hz, const std::vector<float>& out, double amp = 0.5) {
    std::vector<float> tail(out.begin() + (long)out.size() / 2, out.end());
    return test::magnitudeAt(tail, hz, kSr) / (amp / 2.0);
}

static void unityAndPan() {
    TEST("a mono channel at the centre keeps its loudness: -3 dB per side, both sides equal");
    AudioConsoleDsp d;
    d.prepare(kSr);
    ConsoleParams p = basic();
    const Run r = run(d, p, 1000.0, 9600);
    float maxOut = 0.0f;
    bool same = true;
    for (size_t i = 4800; i < r.outL.size(); ++i) {
        maxOut = std::max(maxOut, std::fabs(r.outL[i]));
        same = same && std::fabs(r.outL[i] - r.outR[i]) < 1e-6f;
    }
    EXPECT_NEAR(maxOut, 0.5 * 0.70710678, 0.01);
    EXPECT(same);
}

static void panHardLeft() {
    TEST("pan hard left puts everything on the left");
    AudioConsoleDsp d;
    d.prepare(kSr);
    ConsoleParams p = basic();
    p.ch[0].strip.pan = -1.0f;
    const Run r = run(d, p, 1000.0, 9600);
    EXPECT(test::rms(r.outR, 4800) < 1e-4);
    EXPECT(test::rms(r.outL, 4800) > 0.3);
}

static void faderAndMute() {
    TEST("the fader scales the channel; mute silences it, the send follows the mute");
    AudioConsoleDsp d;
    d.prepare(kSr);
    ConsoleParams p = basic();
    p.ch[0].strip.levelDb = -6.0f;
    p.ch[0].sendDb[0] = 0.0f;
    const Run a = run(d, p, 1000.0, 9600);
    EXPECT_NEAR(test::rms(a.outL, 4800), 0.5 * 0.70710678 * 0.70710678 * std::pow(10.0, -6.0 / 20.0), 0.005);  // sine rms x pan x fader
    EXPECT_NEAR(test::rms(a.send1L, 4800), test::rms(a.outL, 4800), 0.002);
    p.ch[0].strip.mute = true;
    const Run b = run(d, p, 1000.0, 9600);
    EXPECT(test::rms(b.outL, 4800) < 1e-4);
    EXPECT(test::rms(b.send1L, 4800) < 1e-4);
}

static void soloKeepsSends() {
    TEST("solo removes the other channels from the main bus but not from the sends");
    AudioConsoleDsp d;
    d.prepare(kSr);
    ConsoleParams p = basic();
    p.ch[1].solo = true;
    p.ch[0].sendDb[0] = 0.0f;
    const Run r = run(d, p, 1000.0, 9600, 0.5f, 0.0f);  // channel 1 sounds, channel 2 (soloed) is silent
    EXPECT(test::rms(r.outL, 4800) < 1e-4);
    EXPECT(test::rms(r.send1L, 4800) > 0.1);
}

static void sendPoints() {
    TEST("a post-fader send follows the fader, a pre-fader send does not");
    AudioConsoleDsp d;
    d.prepare(kSr);
    ConsoleParams p = basic();
    p.ch[0].sendDb[0] = 0.0f;
    p.ch[0].strip.levelDb = dsp::kFaderFloorDb;
    const Run post = run(d, p, 1000.0, 9600);
    EXPECT(test::rms(post.send1L, 4800) < 1e-3);
    p.sendPre[0] = true;
    const Run pre = run(d, p, 1000.0, 9600);
    EXPECT(test::rms(pre.send1L, 4800) > 0.2);
    EXPECT(test::rms(pre.outL, 4800) < 1e-3);
}

static void filtersAndEq() {
    TEST("high-pass, low-pass and the three EQ bands follow their curves");
    {
        AudioConsoleDsp d;
        d.prepare(kSr);
        ConsoleParams p = basic();
        p.ch[0].strip.hpHz = 1000.0f;
        const Run lo = run(d, p, 100.0, 24000), at = run(d, p, 1000.0, 24000);
        EXPECT(gainAt(100.0, lo.outL) < 0.7071 * 0.02);   // two octaves below a 12 dB/oct corner: -40 dB
        EXPECT_NEAR(gainAt(1000.0, at.outL), 0.7071 * 0.7071, 0.05);  // -3 dB at the corner
    }
    {
        AudioConsoleDsp d;
        d.prepare(kSr);
        ConsoleParams p = basic();
        p.ch[0].strip.loDb = 12.0f;
        const Run lo = run(d, p, 30.0, 48000), hi = run(d, p, 5000.0, 24000);
        EXPECT_NEAR(gainAt(30.0, lo.outL) / 0.7071, std::pow(10.0, 12.0 / 20.0), 0.35);
        EXPECT_NEAR(gainAt(5000.0, hi.outL) / 0.7071, 1.0, 0.03);
    }
    {
        AudioConsoleDsp d;
        d.prepare(kSr);
        ConsoleParams p = basic();
        p.ch[0].strip.midDb = -12.0f;
        const Run mid = run(d, p, 1000.0, 24000);
        EXPECT_NEAR(gainAt(1000.0, mid.outL) / 0.7071, std::pow(10.0, -12.0 / 20.0), 0.02);
    }
    {
        AudioConsoleDsp d;
        d.prepare(kSr);
        ConsoleParams p = basic();
        p.ch[0].strip.hiDb = 12.0f;
        const Run hi = run(d, p, 14000.0, 24000);
        EXPECT_NEAR(gainAt(14000.0, hi.outL) / 0.7071, std::pow(10.0, 12.0 / 20.0), 0.5);
    }
}

static void neutralIsBypass() {
    TEST("flat EQ and open filters change nothing");
    AudioConsoleDsp d;
    d.prepare(kSr);
    ConsoleParams p = basic();
    const Run r = run(d, p, 440.0, 4800);
    bool exact = true;
    for (size_t i = 2400; i < r.outL.size(); ++i) exact = exact && std::fabs(r.outL[i] - r.tap1L[i] * 0.70710678f) < 1e-3f;
    EXPECT(exact);
}

static void directsAndTaps() {
    TEST("direct outputs and recorder taps: pre or post fader");
    AudioConsoleDsp d;
    d.prepare(kSr);
    ConsoleParams p = basic();
    p.directs = 1;
    p.ch[0].strip.levelDb = -20.0f;
    const Run post = run(d, p, 1000.0, 9600);
    EXPECT_NEAR(test::rms(post.direct1L, 4800) / test::rms(post.tap1L, 4800), 0.1, 0.01);   // post-fader direct, input tap
    p.directPre = true;
    p.tapPost = true;
    const Run pre = run(d, p, 1000.0, 9600);
    EXPECT_NEAR(test::rms(pre.direct1L, 4800) / test::rms(pre.tap1L, 4800), 10.0, 1.0);   // pre-fader direct, post-fader tap
}

static void channelsBeyondCountAreSilent() {
    TEST("channels above the count are silent");
    AudioConsoleDsp d;
    d.prepare(kSr);
    ConsoleParams p = basic();
    p.channels = 1;
    const Run r = run(d, p, 1000.0, 4800, 0.5f, 0.9f);
    EXPECT_NEAR(test::rms(r.outL, 2400), 0.5 * 0.70710678 * 0.70710678, 0.01);  // only channel 1 is heard
}

static void returnsAndMaster() {
    TEST("a return joins the master bus; master mute silences everything");
    AudioConsoleDsp d;
    d.prepare(kSr);
    ConsoleParams p = basic();
    ConsoleInputs in;
    ConsoleFrame f;
    in.returnL[0] = in.returnR[0] = 0.5f;
    for (int i = 0; i < 4800; ++i) {
        if (i % 32 == 0) d.update(p);
        d.tick(in, p, f);
    }
    EXPECT_NEAR(f.outL, 0.5 * 0.70710678 * 1.4142, 0.02);   // stereo return, balance centre: unchanged
    p.master.mute = true;
    for (int i = 0; i < 4800; ++i) {
        if (i % 32 == 0) d.update(p);
        d.tick(in, p, f);
    }
    EXPECT(std::fabs(f.outL) < 1e-5f);
}

int main() {
    unityAndPan();
    panHardLeft();
    faderAndMute();
    soloKeepsSends();
    sendPoints();
    filtersAndEq();
    neutralIsBypass();
    directsAndTaps();
    channelsBeyondCountAreSilent();
    returnsAndMaster();
    return test::finish("audio-console");
}
