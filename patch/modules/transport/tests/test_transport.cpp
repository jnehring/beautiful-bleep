// SPDX-License-Identifier: GPL-3.0-only
// Transport: MIDI clock out from the song position, MIDI clock in to tempo, tap tempo.
#include "TransportDsp.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep::patch;
static constexpr double kSr = 48000.0;

struct Msg {
    int status;
    int64_t at;
};

/// Runs the clock out for `seconds` of a transport at `bpm` that plays from `ppq0` while `playingFrom ≤ n < playingTo`.
static std::vector<Msg> runOut(double bpm, double ppq0, int64_t playingFrom, int64_t playingTo, int64_t total,
                               bool enabled = true) {
    MidiClockOut out;
    std::vector<Msg> msgs;
    double ppq = ppq0;
    for (int64_t n = 0; n < total; ++n) {
        const bool playing = n >= playingFrom && n < playingTo;
        out.tick(enabled, playing, ppq, [&](int s) { msgs.push_back({s, n}); });
        if (playing) ppq += bpm / 60.0 / kSr;
    }
    return msgs;
}

static int count(const std::vector<Msg>& m, int status) {
    int n = 0;
    for (const auto& x : m) n += x.status == status;
    return n;
}

static void startThenTwentyFourPerBeat() {
    TEST("Start at the downbeat, then 24 clock pulses per beat");
    const auto m = runOut(120.0, 0.0, 0, 1 << 30, (int64_t)(kSr * 2.0));  // two seconds = four beats
    EXPECT(m.size() > 2);
    EXPECT(m[0].status == kMidiStart);
    EXPECT(m[1].status == kMidiClock);
    EXPECT(m[1].at == m[0].at);                    // the downbeat pulse follows Start at once
    EXPECT(std::abs(count(m, kMidiClock) - 96) <= 1);
    EXPECT(count(m, kMidiStart) == 1);
}

static void pulsesAreEven() {
    TEST("the pulses are evenly spaced (a tick is 1/48 s at 120 BPM)");
    const auto m = runOut(120.0, 0.0, 0, 1 << 30, (int64_t)kSr);
    std::vector<int64_t> at;
    for (const auto& x : m)
        if (x.status == kMidiClock) at.push_back(x.at);
    for (size_t i = 1; i < at.size(); ++i) EXPECT(std::abs((at[i] - at[i - 1]) - 1000) <= 1);
}

static void continueMidSong() {
    TEST("starting away from the beginning sends Continue, not Start");
    const auto m = runOut(120.0, 8.0, 0, 1 << 30, 20000);
    EXPECT(m[0].status == kMidiContinue);
    EXPECT(count(m, kMidiStart) == 0);
}

static void stopSendsStop() {
    TEST("stopping sends Stop once and no more pulses");
    const auto m = runOut(120.0, 0.0, 0, 24000, 48000);
    EXPECT(count(m, kMidiStop) == 1);
    for (const auto& x : m)
        if (x.status == kMidiClock) EXPECT(x.at < 24000);
}

static void disabledIsSilent() {
    TEST("switched off, nothing is sent");
    EXPECT(runOut(120.0, 0.0, 0, 1 << 30, 48000, false).empty());
}

static void switchingOffStops() {
    TEST("switching sync out off while playing ends with Stop");
    MidiClockOut out;
    std::vector<int> s;
    double ppq = 0.0;
    for (int n = 0; n < 4000; ++n) {
        out.tick(n < 2000, true, ppq, [&](int x) { s.push_back(x); });
        ppq += 2.0 / kSr;
    }
    EXPECT(!s.empty() && s.back() == kMidiStop);
}

static void jumpBackDoesNotBurst() {
    TEST("a loop jump back sends no burst of pulses");
    MidiClockOut out;
    int pulses = 0;
    double ppq = 3.9;
    for (int n = 0; n < 100; ++n) {
        if (n == 50) ppq = 0.0;
        out.tick(true, true, ppq, [&](int s) { pulses += s == kMidiClock; });
        ppq += 2.0 / kSr;
    }
    EXPECT(pulses <= 3);
}

/// Feeds a steady clock of `bpm` with `jitter` samples of timing noise; returns every reported tempo.
static std::vector<double> feed(double bpm, int jitter, int pulses, MidiClockIn* in = nullptr) {
    MidiClockIn local;
    MidiClockIn& f = in ? *in : local;
    f.prepare(kSr);
    std::vector<double> out;
    const double spacing = kSr * 60.0 / (bpm * 24.0);
    unsigned seed = 7;
    for (int i = 0; i < pulses; ++i) {
        seed = seed * 1664525u + 1013904223u;
        const int j = jitter ? (int)((seed >> 16) % (unsigned)(2 * jitter + 1)) - jitter : 0;
        const double t = f.clock((int64_t)std::llround(i * spacing) + j);
        if (t > 0.0) out.push_back(t);
    }
    return out;
}

static void followsSteadyClock() {
    TEST("a steady clock gives its tempo after one beat");
    const auto t = feed(120.0, 0, 60);
    EXPECT(!t.empty());
    EXPECT_NEAR(t.front(), 120.0, 0.2);
    EXPECT(t.size() == 1);  // no further reports while nothing changes
}

static void jitterWashesOut() {
    TEST("block jitter of ±5 ms stays within 1 BPM after two bars");
    const auto t = feed(133.0, 240, 400);
    EXPECT(!t.empty());
    EXPECT_NEAR(t.back(), 133.0, 1.0);
}

static void followsTempoChange() {
    TEST("a tempo change is picked up within a few beats");
    MidiClockIn f;
    f.prepare(kSr);
    double last = 0.0;
    int64_t at = 0;
    for (int i = 0; i < 400; ++i) {
        const double bpm = i < 150 ? 100.0 : 140.0;
        at += (int64_t)std::llround(kSr * 60.0 / (bpm * 24.0));
        if (const double t = f.clock(at); t > 0.0) last = t;
    }
    EXPECT_NEAR(last, 140.0, 0.5);
}

static void gapRestarts() {
    TEST("after the clock stops for a second, the average starts afresh");
    MidiClockIn f;
    f.prepare(kSr);
    int64_t at = 0;
    for (int i = 0; i < 60; ++i) {
        at += 1000;
        f.clock(at);
    }
    at += (int64_t)kSr;
    double first = 0.0;
    for (int i = 0; i < 60 && first == 0.0; ++i) {
        at += 1500;  // 80 BPM
        first = f.clock(at);
    }
    EXPECT_NEAR(first, 80.0, 0.3);
}

static void insaneClockIgnored() {
    TEST("a clock faster than 400 BPM is not reported");
    EXPECT(feed(900.0, 0, 200).empty());
}

static void tapTempo() {
    TEST("taps half a second apart give 120 BPM; a pause starts over");
    TapTempo t;
    t.prepare(kSr);
    EXPECT(t.tap(0) == 0.0);
    EXPECT_NEAR(t.tap(24000), 120.0, 0.1);
    EXPECT_NEAR(t.tap(48000), 120.0, 0.1);
    EXPECT_NEAR(t.tap(72000), 120.0, 0.1);
    EXPECT(t.tap(72000 + 5 * 48000) == 0.0);
    EXPECT_NEAR(t.tap(72000 + 5 * 48000 + 16000), 180.0, 0.1);
}

int main() {
    startThenTwentyFourPerBeat();
    pulsesAreEven();
    continueMidSong();
    stopSendsStop();
    disabledIsSilent();
    switchingOffStops();
    jumpBackDoesNotBurst();
    followsSteadyClock();
    jitterWashesOut();
    followsTempoChange();
    gapRestarts();
    insaneClockIgnored();
    tapTempo();
    return bleep::test::finish("transport");
}
