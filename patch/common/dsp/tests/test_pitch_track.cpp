// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "dsp/PitchTrack.h"
#include "dsp/tests/TestUtil.h"

#include <cstdint>
#include <vector>

using namespace bleep::dsp;

static constexpr double kPi = 3.14159265358979323846;

static double cents(double a, double b) { return 1200.0 * std::log2(a / b); }

/// Runs the tracker over n samples of src(i); returns the pitch after the run.
template <class Src>
static float run(PitchTracker& t, int n, Src&& src) {
    for (int i = 0; i < n; ++i) t.push(src(i));
    return t.hz();
}

static void sinesAtSeveralPitches() {
    TEST("sine waves from 55 Hz to 2 kHz at 44.1, 48 and 96 kHz are tracked within 3 cents (8 at 2 kHz)");
    for (double sr : {44100.0, 48000.0, 96000.0})
        for (double f : {55.0, 82.4, 110.0, 220.0, 440.0, 880.0, 1760.0, 2000.0}) {
            PitchTracker t;
            t.prepare(sr);
            PitchTrackSettings s;
            s.minHz = 50.0f;
            s.maxHz = 2400.0f;
            t.configure(s);
            const float hz = run(t, (int)(sr * 0.5), [&](int i) { return 0.5f * (float)std::sin(2.0 * kPi * f * i / sr); });
            EXPECT(t.voiced());
            EXPECT(t.confidence() > 0.9f);
            EXPECT_NEAR(cents(hz, f), 0.0, f > 1900.0 ? 8.0 : 3.0);
        }
}

static void richTones() {
    TEST("a saw and a tone with a weak fundamental keep their fundamental");
    const double sr = 48000.0;
    for (double f : {110.0, 196.0, 330.0}) {
        PitchTracker t;
        t.prepare(sr);
        PitchTrackSettings s;
        s.minHz = 70.0f;
        t.configure(s);
        double ph = 0.0;
        float hz = run(t, (int)sr, [&](int) {
            ph += f / sr;
            ph -= std::floor(ph);
            return 0.5f * (float)(2.0 * ph - 1.0);
        });
        EXPECT_NEAR(cents(hz, f), 0.0, 5.0);
        PitchTracker u;
        u.prepare(sr);
        u.configure(s);
        hz = run(u, (int)sr, [&](int i) {  // harmonics 2–5 louder than the fundamental
            double v = 0.15 * std::sin(2.0 * kPi * f * i / sr);
            for (int h = 2; h <= 5; ++h) v += 0.3 / h * 1.6 * std::sin(2.0 * kPi * f * h * i / sr + h);
            return (float)v;
        });
        EXPECT_NEAR(cents(hz, f), 0.0, 5.0);
    }
}

static void noiseAndSilence() {
    TEST("noise and silence are not voiced");
    const double sr = 48000.0;
    PitchTracker t;
    t.prepare(sr);
    uint32_t r = 12345;
    int voicedFrames = 0, frames = 0;
    for (int i = 0; i < (int)sr * 2; ++i) {
        r = r * 1664525u + 1013904223u;
        if (t.push(0.5f * ((float)(r >> 8) / 8388608.0f - 1.0f))) {
            ++frames;
            voicedFrames += t.voiced() ? 1 : 0;
        }
    }
    EXPECT(frames > 100);
    EXPECT(voicedFrames * 20 < frames);  // at most a few false positives
    PitchTracker q;
    q.prepare(sr);
    run(q, 24000, [](int) { return 0.0f; });
    EXPECT(!q.voiced());
    EXPECT(q.confidence() == 0.0f);
}

static void followsAGlide() {
    TEST("a sweep from 200 to 400 Hz is followed, ending near 400 Hz");
    const double sr = 48000.0;
    PitchTracker t;
    t.prepare(sr);
    double ph = 0.0;
    const int n = (int)sr;
    float hz = run(t, n, [&](int i) {
        ph += (200.0 + 200.0 * i / n) / sr;
        return 0.5f * (float)std::sin(2.0 * kPi * ph);
    });
    EXPECT_NEAR(cents(hz, 400.0), 0.0, 60.0);  // an estimate lags the audio by about a window
}

static void octaveGuard() {
    TEST("octave guard: a one-hop half-pitch glitch is ignored, a real octave jump arrives after the guard time");
    const double sr = 48000.0;
    auto make = [&](float guard) {
        PitchTracker t;
        t.prepare(sr);
        PitchTrackSettings s;
        s.minHz = 60.0f;
        s.guardSeconds = guard;
        t.configure(s);
        return t;
    };
    // 220 Hz with a 12 ms burst of 110 Hz in the middle
    auto sig = [&](int i) {
        const double t = (double)i / sr;
        const bool burst = t > 0.5 && t < 0.52;
        return 0.5f * (float)std::sin(2.0 * kPi * (burst ? 110.0 : 220.0) * t + (burst ? 0.0 : 0.0));
    };
    auto off = make(0.0f);
    auto on = make(0.06f);
    float minOff = 1e9f, minOn = 1e9f;
    for (int i = 0; i < (int)(sr * 0.8); ++i) {
        off.push(sig(i));
        on.push(sig(i));
        if (i > (int)(sr * 0.4) && off.hz() > 0.0f) {
            minOff = std::min(minOff, off.hz());
            minOn = std::min(minOn, on.hz());
        }
    }
    EXPECT(minOn > 200.0f);  // the guard never let go of 220 Hz
    // a lasting jump to 440 Hz must be accepted after the guard time
    auto g = make(0.06f);
    float hz = run(g, (int)(sr * 0.5), [&](int i) { return 0.5f * (float)std::sin(2.0 * kPi * 220.0 * i / sr); });
    EXPECT_NEAR(cents(hz, 220.0), 0.0, 5.0);
    double ph = 0.0;
    hz = run(g, (int)(sr * 0.5), [&](int) {
        ph += 440.0 / sr;
        return 0.5f * (float)std::sin(2.0 * kPi * ph);
    });
    EXPECT_NEAR(cents(hz, 440.0), 0.0, 8.0);
}

static void voteRemovesOutliers() {
    TEST("vote: the median of 5 ignores a single wrong estimate");
    const double sr = 48000.0;
    PitchTracker t;
    t.prepare(sr);
    PitchTrackSettings s;
    s.vote = 5;
    t.configure(s);
    // alternate 300 Hz with a tiny stretch of 330 Hz now and then
    double ph = 0.0;
    float lo = 1e9f, hi = 0.0f;
    for (int i = 0; i < (int)sr; ++i) {
        const bool bump = (i % 9600) > 9400;
        ph += (bump ? 330.0 : 300.0) / sr;
        t.push(0.5f * (float)std::sin(2.0 * kPi * ph));
        if (i > 24000 && t.hz() > 0.0f) {
            lo = std::min(lo, t.hz());
            hi = std::max(hi, t.hz());
        }
    }
    EXPECT(hi < 320.0f);
    EXPECT(lo > 290.0f);
}

int main() {
    sinesAtSeveralPitches();
    richTones();
    noiseAndSilence();
    followsAGlide();
    octaveGuard();
    voteRemovesOutliers();
    return bleep::test::finish("pitch_track");
}
