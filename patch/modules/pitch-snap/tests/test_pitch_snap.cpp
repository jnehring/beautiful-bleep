// SPDX-License-Identifier: GPL-3.0-or-later
#include "PitchSnapDsp.h"
#include "dsp/PitchTrack.h"
#include "dsp/tests/TestUtil.h"

#include <cstdint>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;
static double cents(double a, double b) { return 1200.0 * std::log2(a / b); }

struct Run {
    PitchSnapDsp dsp;
    PitchSnapParams p;
    std::vector<float> out, target, shift;
    Run() {
        dsp.prepare(kSr);
        p.scaleMask = 0xfff;  // chromatic unless a test says otherwise
    }
    template <class Src>
    void render(int n, Src&& src) {
        for (int i = 0; i < n; ++i) {
            const PitchSnapFrame f = dsp.tick(src(i), p);
            out.push_back(f.out);
            target.push_back(f.target);
            shift.push_back(f.shift);
        }
    }
    /// Pitch of the output after `from` samples, by the shared tracker run on the output.
    double outputHz(size_t from, double lo = 60.0, double hi = 2000.0) const {
        bleep::dsp::PitchTracker t;
        t.prepare(kSr);
        bleep::dsp::PitchTrackSettings s;
        s.minHz = (float)lo;
        s.maxHz = (float)hi;
        t.configure(s);
        for (size_t i = from; i < out.size(); ++i) t.push(out[i]);
        return t.hz();
    }
};

/// A phase-continuous tone whose frequency is f(i).
struct Osc {
    double ph = 0.0;
    template <class F>
    float next(F&& f, int i) {
        ph += f(i) / kSr;
        ph -= std::floor(ph);
        return 0.5f * (float)std::sin(2.0 * kPi * ph);
    }
};
static float saw(double& ph, double hz) {
    ph += hz / kSr;
    ph -= std::floor(ph);
    return 0.4f * (float)(2.0 * ph - 1.0);
}

static void snapsToNearestNote() {
    TEST("a sharp A (440 Hz + 39 cents) is pulled to 440 Hz, several notes tested");
    struct C { double note, detune; };
    for (C c : {C{440.0, 39.0}, C{220.0, -33.0}, C{329.63, 28.0}, C{110.0, 40.0}, C{660.0, -25.0}}) {
        Run r;
        Osc o;
        const double f = c.note * std::exp2(c.detune / 1200.0);
        r.render((int)(kSr * 1.2), [&](int i) { return o.next([&](int) { return f; }, i); });
        const double hz = r.outputHz((size_t)(kSr * 0.6));
        EXPECT_NEAR(cents(hz, c.note), 0.0, 6.0);
    }
}

static void scalePicksNotesInScale() {
    TEST("C major: a pitch between C and D is pulled down to C");
    Run r;
    r.p.scaleMask = bleep::dsp::scaleMask({0, 2, 4, 5, 7, 9, 11});
    Osc o;
    r.render((int)(kSr * 1.2), [&](int i) { return o.next([](int) { return 270.0; }, i); });
    EXPECT_NEAR(cents(r.outputHz((size_t)(kSr * 0.6)), 261.63), 0.0, 8.0);
    EXPECT_NEAR(r.target.back() * 12.0, 0.0, 0.001);
}

static void amountScalesTheCorrection() {
    TEST("amount 0 leaves the pitch alone, 50 % corrects half the error");
    const double f = 440.0 * std::exp2(40.0 / 1200.0);
    Run a;
    a.p.amount = 0.0f;
    Osc o1;
    a.render((int)(kSr * 1.2), [&](int i) { return o1.next([&](int) { return f; }, i); });
    EXPECT_NEAR(cents(a.outputHz((size_t)(kSr * 0.6)), f), 0.0, 4.0);
    Run b;
    b.p.amount = 0.5f;
    Osc o2;
    b.render((int)(kSr * 1.2), [&](int i) { return o2.next([&](int) { return f; }, i); });
    EXPECT_NEAR(cents(b.outputHz((size_t)(kSr * 0.6)), 440.0), 20.0, 6.0);
}

static void speedSlowsTheRetune() {
    TEST("a low speed takes time to arrive, a high speed is there at once");
    const double f = 440.0 * std::exp2(40.0 / 1200.0);
    auto at = [&](float speed, double seconds) {
        Run r;
        r.p.speed = speed;
        Osc o;
        r.render((int)(kSr * seconds), [&](int i) { return o.next([&](int) { return f; }, i); });
        return r.shift.back() * 1200.0;  // cents applied so far
    };
    EXPECT_NEAR(at(1.0f, 0.4), -40.0, 3.0);
    EXPECT(std::fabs(at(0.2f, 0.4)) < 25.0);
    EXPECT_NEAR(at(0.2f, 3.0), -40.0, 3.0);
}

static void driftLeavesVibrato() {
    TEST("drift keeps vibrato alive, no drift flattens it");
    auto depth = [](float drift) {
        Run r;
        r.p.drift = drift;
        r.p.driftTime = 0.4f;
        Osc o;
        // 440 Hz + 18 cents, vibrato ±30 cents at 5.5 Hz
        r.render((int)(kSr * 2.0), [&](int i) {
            return o.next([&](int k) { return 440.0 * std::exp2((18.0 + 30.0 * std::sin(2.0 * kPi * 5.5 * k / kSr)) / 1200.0); }, i);
        });
        // measure the pitch of the output in 20 ms steps over the last second
        bleep::dsp::PitchTracker t;
        t.prepare(kSr);
        bleep::dsp::PitchTrackSettings s;
        s.minHz = 100.0f;
        t.configure(s);
        double lo = 1e9, hi = -1e9;
        for (size_t i = 0; i < r.out.size(); ++i) {
            t.push(r.out[i]);
            if (i > (size_t)(kSr * 1.0) && t.hz() > 0.0f) {
                const double c = cents(t.hz(), 440.0);
                lo = std::min(lo, c);
                hi = std::max(hi, c);
            }
        }
        return (hi - lo) * 0.5;
    };
    const double flat = depth(0.0f), kept = depth(1.0f);
    std::printf("vibrato depth: drift 0 -> %.1f ct, drift 1 -> %.1f ct (input 30)\n", flat, kept);
    EXPECT(kept > 15.0);
    EXPECT(kept > flat + 8.0);
}

static void offsetAddsAnInterval() {
    TEST("the offset shifts the target: +12 semitones is an octave above the note");
    Run r;
    r.p.offsetSemis = 12.0f;
    Osc o;
    r.render((int)(kSr * 1.2), [&](int i) { return o.next([](int) { return 220.0 * std::exp2(20.0 / 1200.0); }, i); });
    EXPECT_NEAR(cents(r.outputHz((size_t)(kSr * 0.6), 60.0, 2400.0), 440.0), 0.0, 8.0);
    EXPECT_NEAR(r.target.back(), (double)(-9 + 12) / 12.0 - 0.0, 0.5);  // A3 is −9 st from C4, +12 offset
}

static void formantPreserveSwitch() {
    TEST("both formant modes land on the note with a saw wave and keep the level");
    for (bool formant : {true, false}) {
        Run r;
        r.p.formant = formant;
        double ph = 0.0;
        const double f = 196.0 * std::exp2(35.0 / 1200.0);
        r.render((int)(kSr * 1.5), [&](int) { return saw(ph, f); });
        EXPECT_NEAR(cents(r.outputHz((size_t)(kSr * 0.8)), 196.0), 0.0, 8.0);
        std::vector<float> tail(r.out.end() - 24000, r.out.end());
        const double level = bleep::test::rms(tail);
        EXPECT(level > 0.15 && level < 0.35);  // the saw's own RMS is about 0.23
    }
}

static void noiseGoesThrough() {
    TEST("noise is not pitched: it passes through at its level");
    Run r;
    uint32_t s = 5;
    std::vector<float> in;
    r.render((int)kSr, [&](int) {
        s = s * 1664525u + 1013904223u;
        const float v = 0.3f * ((float)(s >> 8) / 8388608.0f - 1.0f);
        in.push_back(v);
        return v;
    });
    std::vector<float> tail(r.out.end() - 24000, r.out.end()), tin(in.end() - 24000, in.end());
    EXPECT_NEAR(bleep::test::rms(tail), bleep::test::rms(tin), 0.02);
    EXPECT(bleep::test::allFinite(r.out));
}

static void finiteEverywhere() {
    TEST("loud, switching input stays finite and bounded");
    Run r;
    Osc o;
    r.render((int)(kSr * 2.0), [&](int i) {
        const double f = 100.0 + 700.0 * ((i / 6000) % 5) / 4.0;
        return 3.0f * o.next([&](int) { return f; }, i);
    });
    EXPECT(bleep::test::allFinite(r.out));
    float peak = 0.0f;
    for (float v : r.out) peak = std::max(peak, std::fabs(v));
    EXPECT(peak < 12.0f);
}

int main() {
    snapsToNearestNote();
    scalePicksNotesInScale();
    amountScalesTheCorrection();
    speedSlowsTheRetune();
    driftLeavesVibrato();
    offsetAddsAnInterval();
    formantPreserveSwitch();
    noiseGoesThrough();
    finiteEverywhere();
    return bleep::test::finish("pitch_snap");
}
