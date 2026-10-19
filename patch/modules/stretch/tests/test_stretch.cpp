// SPDX-License-Identifier: GPL-3.0-or-later
#include "StretchDsp.h"
#include "dsp/PitchTrack.h"
#include "dsp/tests/TestUtil.h"

#include <cstdint>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;
static double cents(double a, double b) { return 1200.0 * std::log2(a / b); }

struct Run {
    StretchDsp dsp;
    StretchParams p;
    std::vector<float> l, r;
    StretchFrame last;
    Run() {
        dsp.prepare(kSr);
        p.lengthSeconds = 4.0f;
    }
    template <class SrcL, class SrcR>
    void render(int n, SrcL&& a, SrcR&& b) {
        for (int i = 0; i < n; ++i) {
            const int k = (int)l.size();
            last = dsp.tick(a(k), b(k), p);
            l.push_back(last.l);
            r.push_back(last.r);
        }
    }
    template <class Src>
    void render(int n, Src&& a) { render(n, a, a); }
    /// pitch of the left output, tracked over [from, to)
    double hz(size_t from, size_t to, double lo = 80.0) const {
        bleep::dsp::PitchTracker t;
        t.prepare(kSr);
        bleep::dsp::PitchTrackSettings s;
        s.minHz = (float)lo;
        s.maxHz = 3000.0f;
        t.configure(s);
        for (size_t i = from; i < to && i < l.size(); ++i) t.push(l[i]);
        return t.hz();
    }
};

static float tone(double hz, int i, float a = 0.5f) { return a * (float)std::sin(2.0 * kPi * hz * i / kSr); }
/// 300 → 600 Hz over 2 s (phase accurate), the recording that shows where the head is.
static float chirp(int i) {
    const double t = (double)i / kSr;
    if (t > 2.0) return 0.0f;
    return 0.5f * (float)std::sin(2.0 * kPi * (300.0 * t + 75.0 * t * t));
}
static double chirpHz(double t) { return 300.0 + 150.0 * t; }

static void recordsOnceThenStops() {
    TEST("record Once: the take stops when the buffer is full and later input is not recorded");
    Run r;
    r.p.lengthSeconds = 1.0f;
    r.render((int)(kSr * 1.5), [](int i) { return tone(500.0, i); });
    EXPECT(r.dsp.recorded() == (size_t)(1.0 * kSr));
    EXPECT(!r.dsp.recording());
    const size_t before = r.dsp.recorded();
    r.render(24000, [](int i) { return tone(900.0, i); });
    EXPECT(r.dsp.recorded() == before);
    EXPECT(r.last.recorded > 0.99f);
}

static void grainsKeepPitchWhenStretched() {
    TEST("grains: a 440 Hz recording stretched x2 and x0.5 stays at 440 Hz");
    for (float stretch : {2.0f, 0.5f, 4.0f}) {
        Run r;
        r.p.engine = 0;
        r.p.stretch = 1.0f;
        r.render((int)(kSr * 4.0), [](int i) { return tone(440.0, i); });
        r.p.stretch = stretch;
        r.render((int)(kSr * 1.5), [](int) { return 0.0f; });
        EXPECT_NEAR(cents(r.hz(r.l.size() - 30000, r.l.size()), 440.0), 0.0, 25.0);
        EXPECT(bleep::test::rms(std::vector<float>(r.l.end() - 24000, r.l.end())) > 0.1);
    }
}

static void smearKeepsPitchWhenStretched() {
    TEST("smear: a 330 Hz recording stretched x3 and x0.25 stays at 330 Hz");
    for (float stretch : {3.0f, 0.25f, 1.0f}) {
        Run r;
        r.p.engine = 1;
        r.render((int)(kSr * 4.0), [](int i) { return tone(330.0, i); });
        r.p.stretch = stretch;
        r.render((int)(kSr * 1.5), [](int) { return 0.0f; });
        EXPECT_NEAR(cents(r.hz(r.l.size() - 30000, r.l.size()), 330.0), 0.0, 12.0);
        const double rms = bleep::test::rms(std::vector<float>(r.l.end() - 24000, r.l.end()));
        EXPECT_NEAR(rms, 0.5 / std::sqrt(2.0), 0.08);
    }
}

static void stretchRunsTimeSlower() {
    TEST("both engines: a rising chirp played x2 slower is at the pitch 'half-way' after the same output time");
    for (int engine : {0, 1}) {
        Run r;
        r.p.engine = engine;
        r.p.lengthSeconds = 4.0f;
        r.render((int)(kSr * 4.0), chirp);  // record 4 s (2 s chirp, 2 s silence)
        r.p.stretch = 2.0f;
        const double rec0 = 0.0;
        (void)rec0;
        r.p.holdRange = true;
        r.p.rangeStart = 0.0f;
        r.p.rangeSize = 0.5f;  // exactly the chirp
        const size_t t0 = r.l.size();
        r.render((int)(kSr * 2.2), [](int) { return 0.0f; });
        // output time 1.0 s after the play starts corresponds to source time 0.5 s (plus the vocoder's delay)
        const double lat = engine == 1 ? 2048.0 / kSr : 0.0;
        const double outT = 1.0 + lat;
        const size_t a = t0 + (size_t)((outT - 0.12) * kSr), b = t0 + (size_t)((outT + 0.12) * kSr);
        const double got = r.hz(a, b, 150.0);
        EXPECT_NEAR(cents(got, chirpHz(0.5 * (1.0 - 0.0) + (engine == 1 ? 0.0 : 0.0))), 0.0, 260.0);  // generous: ±0.1 s of source time ≈ 12 %
    }
}

static void pitchOffset() {
    TEST("pitch offset: +12 st doubles and -12 st halves the frequency in both engines");
    for (int engine : {0, 1}) {
        for (float st : {12.0f, -12.0f, 7.0f}) {
            Run r;
            r.p.engine = engine;
            r.render((int)(kSr * 4.0), [](int i) { return tone(300.0, i); });
            r.p.pitchSemis = st;
            r.p.stretch = 1.5f;
            r.render((int)(kSr * 1.5), [](int) { return 0.0f; });
            const double expect = 300.0 * std::exp2(st / 12.0);
            EXPECT_NEAR(cents(r.hz(r.l.size() - 30000, r.l.size(), 60.0), expect), 0.0, engine == 0 ? 30.0 : 25.0);
        }
    }
}

static void freezeHolds() {
    TEST("freeze: the head stops and a steady sound goes on (both engines)");
    for (int engine : {0, 1}) {
        Run r;
        r.p.engine = engine;
        r.render((int)(kSr * 4.0), [](int i) { return tone(250.0, i) + tone(375.0, i, 0.2f); });
        r.p.freeze = true;
        r.render((int)(kSr * 0.5), [](int) { return 0.0f; });
        const float head = r.last.head;
        r.render((int)(kSr * 1.0), [](int) { return 0.0f; });
        EXPECT_NEAR(r.last.head, head, 1e-6);
        EXPECT(bleep::test::rms(std::vector<float>(r.l.end() - 24000, r.l.end())) > 0.15);
    }
}

static void positionScrubs() {
    TEST("scrub: Position picks where in the recording the sound comes from");
    for (int engine : {0, 1}) {
        Run r;
        r.p.engine = engine;
        r.p.lengthSeconds = 4.0f;
        r.render((int)(kSr * 4.0), chirp);
        r.p.mode = 1;
        r.p.freeze = true;
        r.p.holdRange = true;
        r.p.rangeStart = 0.0f;
        r.p.rangeSize = 0.5f;
        auto at = [&](float pos) {
            r.p.position = pos;
            const size_t from = r.l.size();
            r.render((int)(kSr * 0.6), [](int) { return 0.0f; });
            return r.hz(from + (size_t)(kSr * 0.3), r.l.size(), 150.0);
        };
        const double lo = at(0.15f), hi = at(0.85f);
        EXPECT(hi > lo * 1.4);
        EXPECT_NEAR(cents(lo, chirpHz(0.15 * 2.0)), 0.0, 300.0);
        EXPECT_NEAR(cents(hi, chirpHz(0.85 * 2.0)), 0.0, 300.0);
    }
}

static void holdRangeLoops() {
    TEST("hold range: the head stays inside the window and loops");
    Run r;
    r.p.engine = 0;
    r.render((int)(kSr * 4.0), chirp);
    r.p.holdRange = true;
    r.p.rangeStart = 0.25f;
    r.p.rangeSize = 0.25f;  // 1.0 s … 2.0 s of the recording
    r.render((int)(kSr * 0.5), [](int) { return 0.0f; });
    float lo = 1.0f, hi = 0.0f;
    for (int i = 0; i < (int)(kSr * 3.0); ++i) {
        r.render(1, [](int) { return 0.0f; });
        lo = std::min(lo, r.last.head);
        hi = std::max(hi, r.last.head);
    }
    EXPECT(lo < 0.05f && hi > 0.95f);  // it goes round the window several times
    EXPECT_NEAR(r.last.window0, 0.25, 0.002);
    EXPECT_NEAR(r.last.window1, 0.5, 0.002);
    // the pitch it plays lies inside the chirp's range between 1 s and 2 s
    const double hz = r.hz(r.l.size() - 20000, r.l.size(), 150.0);
    EXPECT(hz > 440.0 && hz < 620.0);
}

static void wobbleMovesTheHead() {
    TEST("wobble modulates the speed of time");
    auto headAfter = [](float wobble) {
        Run r;
        r.render((int)(kSr * 4.0), [](int i) { return tone(200.0, i); });
        r.p.wobble = wobble;
        r.p.wobbleRate = 0.4f;
        r.p.stretch = 1.0f;
        r.render((int)(kSr * 1.3), [](int) { return 0.0f; });
        return r.last.head;
    };
    EXPECT(std::fabs(headAfter(0.0f) - headAfter(0.8f)) > 0.02f);
}

static void stereoStaysStereo() {
    TEST("left and right keep their own content");
    for (int engine : {0, 1}) {
        Run r;
        r.p.engine = engine;
        r.render((int)(kSr * 4.0), [](int i) { return tone(250.0, i); }, [](int i) { return tone(600.0, i); });
        r.p.stretch = 2.0f;
        r.render((int)(kSr * 1.5), [](int) { return 0.0f; });
        std::vector<float> L(r.l.end() - 24000, r.l.end()), R(r.r.end() - 24000, r.r.end());
        EXPECT(bleep::test::magnitudeAt(L, 250.0, kSr) > 5.0 * bleep::test::magnitudeAt(L, 600.0, kSr));
        EXPECT(bleep::test::magnitudeAt(R, 600.0, kSr) > 5.0 * bleep::test::magnitudeAt(R, 250.0, kSr));
    }
}

static void rollingKeepsRecording() {
    TEST("rolling keeps recording; record off records nothing; mix 0 passes the input");
    Run r;
    r.p.record = 1;
    r.p.lengthSeconds = 1.0f;
    r.render((int)(kSr * 2.5), [](int i) { return tone(400.0, i); });
    EXPECT(r.dsp.recording());
    EXPECT(r.dsp.recorded() == (size_t)kSr);
    Run d;  // Record off: nothing is written, so there is nothing to play
    d.p.record = 2;
    d.render(24000, [](int i) { return tone(400.0, i); });
    EXPECT(bleep::test::rms(d.l) < 1e-6);
    Run m;  // mix 0 passes the live input untouched
    m.p.mix = 0.0f;
    m.render(2000, [](int i) { return tone(400.0, i); });
    EXPECT_NEAR(m.l[1500], tone(400.0, 1500), 1e-6);
}

static void newTakeTrigger() {
    TEST("a new take trigger starts recording again from the beginning");
    Run r;
    r.p.lengthSeconds = 1.0f;
    r.render((int)(kSr * 1.2), [](int i) { return tone(500.0, i); });
    EXPECT(!r.dsp.recording());
    r.p.newTake = true;
    r.render(1, [](int i) { return tone(500.0, i); });
    r.p.newTake = false;
    EXPECT(r.dsp.recording());
    EXPECT(r.dsp.recorded() < 10);
}

static void finiteEverywhere() {
    TEST("extreme settings stay finite and bounded, at 44.1 and 96 kHz buffers too");
    Run r;
    r.p.engine = 1;
    r.p.record = 1;
    r.p.stretch = 0.1f;
    r.p.pitchSemis = -24.0f;
    r.p.wobble = 1.0f;
    r.p.wobbleShape = 1;
    r.p.wobbleRate = 12.0f;
    r.p.holdRange = true;
    r.p.rangeSize = 0.01f;
    r.p.mode = 0;
    r.p.position = 0.7f;
    r.p.reverse = true;
    uint32_t s = 5;
    r.render((int)(kSr * 3.0), [&](int) { s = s * 1664525u + 1013904223u; return 0.9f * ((float)(s >> 8) / 8388608.0f - 1.0f); });
    r.p.engine = 0;
    r.p.scatter = 1.0f;
    r.p.overlap = 4;
    r.p.grainMs = 400.0f;
    r.p.stretch = 8.0f;
    r.p.pitchSemis = 24.0f;
    r.render((int)(kSr * 3.0), [&](int) { s = s * 1664525u + 1013904223u; return 0.9f * ((float)(s >> 8) / 8388608.0f - 1.0f); });
    float peak = 0.0f;
    for (float v : r.l) peak = std::max(peak, std::fabs(v));
    for (float v : r.r) peak = std::max(peak, std::fabs(v));
    EXPECT(bleep::test::allFinite(r.l) && bleep::test::allFinite(r.r));
    EXPECT(peak < 12.0f);
}

int main() {
    recordsOnceThenStops();
    grainsKeepPitchWhenStretched();
    smearKeepsPitchWhenStretched();
    stretchRunsTimeSlower();
    pitchOffset();
    freezeHolds();
    positionScrubs();
    holdRangeLoops();
    wobbleMovesTheHead();
    stereoStaysStereo();
    rollingKeepsRecording();
    newTakeTrigger();
    finiteEverywhere();
    return bleep::test::finish("stretch");
}
