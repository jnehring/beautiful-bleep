// SPDX-License-Identifier: MIT
// Low Pass Gate: cell asymmetry and memory, ping decay, response scaling,
// modes, bleed, gain bound, Active (specs/modules/low-pass-gate.md §8).
#include "LowPassGateDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace bleep;
using patch::LowPassGateDsp;
using patch::LowPassGateParams;

static constexpr double kSr = 48000.0;

static LowPassGateDsp make(const LowPassGateParams& p) {
    LowPassGateDsp d;
    d.prepare(kSr);
    d.set(p);
    return d;
}

/// Openness after a step: samples until c crosses `level` (rising or falling).
static int samplesUntil(LowPassGateDsp& d, float cv, float level, bool rising, int limit) {
    for (int i = 0; i < limit; ++i) {
        const auto f = d.tick(0.0f, 0.0f, cv);
        if (rising ? f.light >= level : f.light <= level) return i;
    }
    return limit;
}

static void asymmetry() {
    TEST("asymmetry");
    LowPassGateParams p;
    auto d = make(p);
    const int rise = samplesUntil(d, 1.0f, 0.9f, true, 48000);
    for (int i = 0; i < 4800; ++i) d.tick(0.0f, 0.0f, 1.0f);  // settle open
    const int fall = samplesUntil(d, 0.0f, 0.1f, false, 480000);
    std::printf("  rise to 0.9: %.1f ms, fall to 0.1: %.1f ms\n", rise * 1000.0 / kSr, fall * 1000.0 / kSr);
    const double tauRise = dsp::Vactrol::times(dsp::VactrolCell::Classic).rise;
    EXPECT(rise <= 5.0 * tauRise * kSr);
    EXPECT(fall >= 10 * rise);
}

static void slowsInTheDark() {
    TEST("fall slows as c decreases");
    LowPassGateParams p;
    auto d = make(p);
    for (int i = 0; i < 4800; ++i) d.tick(0.0f, 0.0f, 0.5f);
    const int a = samplesUntil(d, 0.0f, 0.25f, false, 480000);
    const int b = samplesUntil(d, 0.0f, 0.125f, false, 480000);
    std::printf("  0.5→0.25: %d, 0.25→0.125: %d samples\n", a, b);
    EXPECT(a < b);
}

/// Samples until the Both-mode gain on a DC input falls below `db`.
static int tailTo(LowPassGateDsp& d, double db, int limit = 20 * 48000) {
    const float floor = (float)std::pow(10.0, db / 20.0);
    bool opened = false;
    for (int i = 0; i < limit; ++i) {
        const float y = d.tick(1.0f, 1.0f, 0.0f).l;
        if (y > floor) opened = true;
        else if (opened) return i;
    }
    return limit;
}

static void memory() {
    TEST("memory: a long gate leaves a longer tail than a ping");
    LowPassGateParams p;
    auto a = make(p);
    for (int i = 0; i < (int)(2.0 * kSr); ++i) a.tick(1.0f, 1.0f, 1.0f);
    const int afterGate = tailTo(a, -60.0);
    auto b = make(p);
    b.ping(1.0f);
    const int afterPing = tailTo(b, -60.0);
    std::printf("  tail to -60 dB: after gate %.0f ms, after ping %.0f ms\n", afterGate * 1000.0 / kSr,
                afterPing * 1000.0 / kSr);
    EXPECT(afterGate > afterPing);
}

static void pingDecay() {
    TEST("ping decay");
    LowPassGateParams p;
    auto d = make(p);
    d.ping(1.0f);
    float peakC = 0.0f;
    int peakAt = 0;
    for (int i = 0; i < 480; ++i) {
        const auto f = d.tick(1.0f, 1.0f, 0.0f);
        if (f.light > peakC) peakC = f.light, peakAt = i;
    }
    auto e = make(p);
    e.ping(1.0f);
    const int t = tailTo(e, -60.0);
    std::printf("  peak c %.2f at %.1f ms, -60 dB after %.0f ms\n", peakC, peakAt * 1000.0 / kSr, t * 1000.0 / kSr);
    EXPECT(peakC > 0.35f && peakC < 0.75f);
    EXPECT(peakAt < (int)(0.004 * kSr));
    EXPECT_NEAR(t / kSr, 0.7, 0.14);
    // Two pings 50 ms apart swell higher than one.
    auto two = make(p);
    two.ping(1.0f);
    float peak1 = 0.0f, peak2 = 0.0f;
    for (int i = 0; i < 2400; ++i) peak1 = std::max(peak1, two.tick(0.0f, 0.0f, 0.0f).light);
    two.ping(1.0f);
    for (int i = 0; i < 2400; ++i) peak2 = std::max(peak2, two.tick(0.0f, 0.0f, 0.0f).light);
    EXPECT(peak2 > peak1);
}

static void responseScaling() {
    TEST("response scales the times");
    auto fallTime = [](float response) {
        LowPassGateParams p;
        p.response = response;
        auto d = make(p);
        for (int i = 0; i < 12 * 48000; ++i) d.tick(0.0f, 0.0f, 0.3f);  // memory full
        return samplesUntil(d, 0.0f, 0.15f, false, 50 * 48000);
    };
    const double mid = fallTime(0.5f), lo = fallTime(0.0f), hi = fallTime(1.0f);
    std::printf("  fall 0.3→0.15: 0 %% %.0f, 50 %% %.0f, 100 %% %.0f samples\n", lo, mid, hi);
    EXPECT_NEAR(lo / mid, 0.25, 0.03);
    EXPECT_NEAR(hi / mid, 4.0, 0.4);
}

static std::vector<float> sineThrough(LowPassGateParams p, float cv, double hz, float amp = 1.0f) {
    auto d = make(p);
    for (int i = 0; i < 9600; ++i) d.tick(0.0f, 0.0f, cv);
    std::vector<float> y;
    for (int i = 0; i < 9600; ++i) y.push_back(d.tick(amp * (float)std::sin(2.0 * M_PI * hz * i / kSr), 0.0f, cv).l);
    return y;
}

static void modes() {
    TEST("modes");
    LowPassGateParams p;
    // VCA: no spectral change; the gain is c^1.4.
    p.mode = 1;
    for (float cv : {0.2f, 0.6f, 1.0f}) {
        const double lo = test::magnitudeAt(sineThrough(p, cv, 200.0), 200.0, kSr);
        const double hi = test::magnitudeAt(sineThrough(p, cv, 8000.0), 8000.0, kSr);
        EXPECT_NEAR(lo / hi, 1.0, 0.01);
        EXPECT_NEAR(lo / 0.5, std::pow(cv, 1.4), 0.02);
    }
    // LP: unity gain at DC whatever the openness.
    p.mode = 0;
    for (float cv : {0.0f, 0.5f, 1.0f}) {
        auto d = make(p);
        float y = 0.0f;
        for (int i = 0; i < 48000; ++i) y = d.tick(1.0f, 1.0f, cv).l;
        EXPECT_NEAR(y, 1.0, 1e-3);
    }
    // Both: cutoff and gain follow the table.
    p.mode = 2;
    auto d = make(p);
    for (int i = 0; i < 48000; ++i) d.tick(0.0f, 0.0f, 0.5f);
    const float c = d.openness();
    const float fmax = 1000.0f * std::pow(20.0f, 0.75f);
    EXPECT_NEAR(d.cutoffHz(), 30.0f * std::pow(fmax / 30.0f, std::pow(c, 0.7f)), 1.0);
    EXPECT_NEAR(d.gain(), std::pow(c, 1.2f), 1e-4);
    // A closed LP gate darkens: 2 kHz is cut far more than 100 Hz.
    p.mode = 0;
    const double low = test::magnitudeAt(sineThrough(p, 0.1f, 100.0), 100.0, kSr);
    const double high = test::magnitudeAt(sineThrough(p, 0.1f, 2000.0), 2000.0, kSr);
    EXPECT(high < 0.1 * low);
}

static void bleed() {
    TEST("bleed");
    LowPassGateParams p;
    auto d = make(p);
    d.ping(1.0f);
    std::vector<float> tail;
    for (int i = 0; i < 20 * 48000; ++i) tail.push_back(d.tick(0.5f, 0.5f, 0.0f).l);
    EXPECT(tail.back() == 0.0f);
    p.bleed = 1.0f;
    const double through = test::magnitudeAt(sineThrough(p, 0.0f, 100.0), 100.0, kSr) / 0.5;
    std::printf("  bleed 100 %%: %.1f dB at 100 Hz\n", 20.0 * std::log10(through));
    EXPECT_NEAR(20.0 * std::log10(through), -24.0, 2.0);
}

static void gainBound() {
    TEST("gain never exceeds 1");
    LowPassGateParams p;
    for (int mode = 0; mode < 3; ++mode)
        for (double hz : {50.0, 1000.0, 5000.0}) {
            p.mode = mode;
            p.resonance = 0.0f;
            float peak = 0.0f;
            for (float v : sineThrough(p, 1.0f, hz)) peak = std::max(peak, std::fabs(v));
            EXPECT(peak <= 1.001f);
        }
    // With Resonance the Both mode stays bounded by its compensation.
    p.mode = 2;
    p.resonance = 1.0f;
    float peak = 0.0f;
    for (double hz : {200.0, 2000.0, 8000.0})
        for (float cv : {0.3f, 0.7f, 1.0f})
            for (float v : sineThrough(p, cv, hz)) peak = std::max(peak, std::fabs(v));
    std::printf("  Both, resonance 100 %%: peak %.2f\n", peak);
    EXPECT(peak < 6.0f);
    // Drive keeps a full-scale input within ±1 and changes the waveform.
    p = LowPassGateParams();
    p.drive = 1.0f;
    const auto y = sineThrough(p, 1.0f, 200.0);
    float dp = 0.0f;
    for (float v : y) dp = std::max(dp, std::fabs(v));
    EXPECT(test::allFinite(y));
    EXPECT(dp <= 1.05f);
}

static void active() {
    TEST("active");
    LowPassGateParams p;
    auto d = make(p);
    EXPECT(!d.tick(0.0f, 0.0f, 0.0f).active);
    d.ping(1.0f);
    int lastLoud = -1, fell = -1;
    for (int i = 0; i < 20 * 48000; ++i) {
        const auto f = d.tick(1.0f, 1.0f, 0.0f);
        if (std::fabs(f.l) > 1e-4f || f.light > 0.001f) lastLoud = i;
        if (!f.active) {
            fell = i;
            break;
        }
    }
    std::printf("  active fell %.1f ms after the output went quiet\n", (fell - lastLoud) * 1000.0 / kSr);
    EXPECT(fell > 0);
    EXPECT(fell - lastLoud <= (int)(0.06 * kSr));
}

static void modeSwitchIsSmooth() {
    TEST("mode switch is click-free");
    LowPassGateParams p;
    auto d = make(p);
    float prev = 0.0f, maxStep = 0.0f;
    for (int i = 0; i < 48000; ++i) {
        if (i % 4800 == 0) {
            p.mode = (p.mode + 1) % 3;
            d.set(p);
        }
        const float y = d.tick(0.5f, 0.5f, 1.0f).l;  // DC: any jump would be a click
        if (i > 4800) maxStep = std::max(maxStep, std::fabs(y - prev));
        prev = y;
    }
    EXPECT(maxStep < 0.01f);
}

int main() {
    asymmetry();
    slowsInTheDark();
    memory();
    pingDecay();
    responseScaling();
    modes();
    bleed();
    gainBound();
    active();
    modeSwitchIsSmooth();
    return test::finish("low-pass-gate");
}
