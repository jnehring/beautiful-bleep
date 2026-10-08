// SPDX-License-Identifier: MIT
// Unit tests for the Bleep Patch DSP cores. No JUCE, no bus: pure C++.
#include "../modules/adsr/dsp/AdsrDsp.h"
#include "../modules/filter/dsp/FilterDsp.h"
#include "../modules/oscillator/dsp/OscillatorDsp.h"
#include "../modules/function/dsp/FunctionDsp.h"
#include "../modules/random/dsp/RandomDsp.h"
#include "../modules/utility/dsp/UtilityDsp.h"

#include <cmath>
#include <cstdio>
#include <functional>
#include <random>
#include <vector>

static int g_failures = 0;
static const char* g_test = "";

#define EXPECT(cond)                                                                   \
    do {                                                                               \
        if (!(cond)) {                                                                 \
            std::printf("  %s: %s:%d: EXPECT(%s)\n", g_test, __FILE__, __LINE__, #cond); \
            ++g_failures;                                                              \
        }                                                                              \
    } while (0)
#define EXPECT_NEAR(a, b, tol) EXPECT(std::fabs((double)(a) - (double)(b)) <= (tol))

using namespace bleep;
using namespace bleep::patch;

static void svfBasics() {
    g_test = "svf";
    dsp::Svf f;
    f.set(1000.0f, 0.707f, 48000.0);
    dsp::SvfOutputs o{};
    for (int i = 0; i < 48000; ++i) o = f.process(1.0f); // DC
    EXPECT_NEAR(o.lp, 1.0, 1e-3);
    EXPECT_NEAR(o.hp, 0.0, 1e-3);
    EXPECT_NEAR(o.bp, 0.0, 1e-3);
    EXPECT_NEAR(dsp::morphSvf(o, 0.0f), o.lp, 1e-7);
    EXPECT_NEAR(dsp::morphSvf(o, 1.0f), o.notch(), 1e-7);

    // Audio-rate cutoff modulation with high resonance stays bounded.
    std::mt19937 rng(7);
    std::uniform_real_distribution<float> u(-1.0f, 1.0f);
    float peak = 0.0f;
    for (int i = 0; i < 96000; ++i) {
        const float hz = FilterDsp::cutoffHz(0.5f + 0.5f * std::sin(i * 0.3f), 0.0f);
        f.set(hz, 25.0f, 48000.0);
        o = f.process(u(rng));
        peak = std::max(peak, std::fabs(o.lp));
        EXPECT(std::isfinite(o.lp) && std::isfinite(o.hp));
        if (g_failures) return;
    }
    EXPECT(peak < 100.0f);
}

static void filterMapping() {
    g_test = "filter";
    EXPECT_NEAR(FilterDsp::cutoffHz(0.0f, 0.0f), 20.0, 1e-3);
    EXPECT_NEAR(FilterDsp::cutoffHz(1.0f, 0.0f), 20000.0, 0.5);
    EXPECT_NEAR(FilterDsp::cutoffHz(0.5f, 1.0f), 2.0 * FilterDsp::cutoffHz(0.5f, 0.0f), 1e-2);
    EXPECT_NEAR(FilterDsp::q(0.0f), 0.5, 1e-6);
    EXPECT_NEAR(FilterDsp::q(1.0f), 25.0, 1e-4);

    FilterDsp f;
    f.prepare(48000.0);
    FilterParams p;
    p.mix = 0.0f; // dry: identity
    float frame[2] = {0.3f, -0.2f};
    f.tick(p, 0.0f, frame, 2);
    EXPECT_NEAR(frame[0], 0.3, 1e-7);
    EXPECT_NEAR(frame[1], -0.2, 1e-7);

    p.mix = 1.0f;
    p.cutoff = 0.0f; // 20 Hz low-pass: a 5 kHz tone almost vanishes, envelope stays low
    float env = 0.0f;
    for (int i = 0; i < 4800; ++i) {
        float fr[2] = {std::sin(i * 2.0f * 3.14159265f * 5000.0f / 48000.0f), 0.0f};
        env = f.tick(p, 0.0f, fr, 2);
    }
    EXPECT(env < 0.01f);
}

static void functionCycle() {
    g_test = "function cycle";
    FunctionDsp fn;
    fn.reset();
    FunctionParams p;
    p.rise = 0.5f;
    p.fall = 0.5f;
    SampleClock clk;
    clk.sampleRate = 1000.0;
    float out[4], eoc;
    int eocs = 0;
    float lo = 1.0f, hi = 0.0f;
    for (int i = 0; i < 3000; ++i) {
        fn.tick(p, 0.0f, clk, out, eoc);
        eocs += eoc > 0.5f;
        lo = std::min(lo, out[0]);
        hi = std::max(hi, out[0]);
    }
    EXPECT(eocs == 2 || eocs == 3);
    EXPECT(lo < 0.01f && hi > 0.99f);

    // Transport-locked: the phase comes from ppq.
    p.sync = 4; // 1/4 = one beat
    clk.locked = true;
    clk.ppq = 10.5; // half-way through a beat: peak of a symmetric slope
    fn.tick(p, 0.0f, clk, out, eoc);
    EXPECT_NEAR(out[0], 1.0, 1e-4);
    // Spread offsets B by a quarter cycle at spread = 1.
    p.spread = 1.0f;
    clk.ppq = 10.25;
    fn.tick(p, 0.0f, clk, out, eoc);
    EXPECT_NEAR(out[0], 0.5, 1e-4);
    EXPECT_NEAR(out[1], 1.0, 1e-4);
}

static void functionEnvelope() {
    g_test = "function envelope";
    FunctionDsp fn;
    fn.reset();
    FunctionParams p;
    p.cycle = false;
    p.rise = 0.01f;
    p.fall = 0.1f;
    SampleClock clk;
    clk.sampleRate = 1000.0;
    float out[4], eoc;
    fn.tick(p, 0.0f, clk, out, eoc);
    EXPECT_NEAR(out[0], 0.0, 1e-7);
    int peakAt = -1, eocAt = -1;
    for (int i = 0; i < 400; ++i) {
        fn.tick(p, i < 5 ? 1.0f : 0.0f, clk, out, eoc);
        if (peakAt < 0 && out[0] >= 0.999f) peakAt = i;
        if (eoc > 0.5f) eocAt = i;
    }
    EXPECT(peakAt >= 8 && peakAt <= 11);
    EXPECT(eocAt >= 105 && eocAt <= 113);
    EXPECT_NEAR(out[0], 0.0, 1e-7);
}

static void randomDeterminism() {
    g_test = "random";
    // Same inputs, same value.
    EXPECT(RandomDsp::stepValue(42, 17, 8, 0.3f) == RandomDsp::stepValue(42, 17, 8, 0.3f));
    // Locked loop repeats with the loop length.
    for (int s = 0; s < 64; ++s) EXPECT(RandomDsp::stepValue(5, s, 8, 1.0f) == RandomDsp::stepValue(5, s + 8, 8, 1.0f));
    // Always new: the next pass differs (with overwhelming probability).
    int same = 0;
    for (int s = 0; s < 64; ++s) same += RandomDsp::stepValue(5, s, 8, 0.0f) == RandomDsp::stepValue(5, s + 8, 8, 0.0f);
    EXPECT(same == 0);
    // Different seeds, different sequences.
    EXPECT(RandomDsp::stepValue(1, 3, 8, 0.0f) != RandomDsp::stepValue(2, 3, 8, 0.0f));
    // Values cover 0..1 roughly uniformly.
    double mean = 0.0;
    for (int s = 0; s < 4000; ++s) mean += RandomDsp::stepValue(9, s, 16, 0.0f);
    EXPECT_NEAR(mean / 4000.0, 0.5, 0.03);

    // Seeking: a transport-locked render starting mid-song equals the formula.
    RandomDsp r;
    r.prepare(48000.0);
    r.reset();
    RandomParams p;
    p.sync = 4; // one step per beat
    p.seed = 1234;
    float out, trig;
    for (int beat = 100; beat < 110; ++beat) {
        r.tick(p, 0.0f, false, 120.0, beat + 0.01, true, out, trig);
        EXPECT(trig == 1.0f);
        EXPECT_NEAR(out, RandomDsp::shapeValue(RandomDsp::stepValue(1234, beat, p.length, p.loop), p), 1e-7);
        r.tick(p, 0.0f, false, 120.0, beat + 0.5, true, out, trig);
        EXPECT(trig == 0.0f);
    }
    // Quantize snaps to semitones.
    p.quantize = true;
    const float q = RandomDsp::shapeValue(0.537, p);
    EXPECT_NEAR(q * 12.0f, std::round(q * 12.0f), 1e-5);
}

static void utilityShapes() {
    g_test = "utility";
    EXPECT_NEAR(UtilityDsp::fold(0.5f), 0.5, 1e-6);
    EXPECT_NEAR(UtilityDsp::fold(1.5f), 0.5, 1e-6);
    EXPECT_NEAR(UtilityDsp::fold(-1.5f), -0.5, 1e-6);
    EXPECT_NEAR(UtilityDsp::fold(3.0f), -1.0, 1e-6);

    UtilityDsp u;
    u.reset();
    UtilityParams p;
    p.scaleX = -0.5f;
    p.offset = 0.25f;
    float out, gate, inv;
    u.tick(p, 1.0f, 0.0f, 0.0f, 48000.0, out, gate, inv);
    EXPECT_NEAR(out, -0.25, 1e-6);
    EXPECT_NEAR(inv, 0.25, 1e-6);
    EXPECT(gate == 0.0f);

    p = UtilityParams{};
    p.mode = UtilityMode::SampleHold;
    u.reset();
    u.tick(p, 0.7f, 0.0f, 1.0f, 48000.0, out, gate, inv); // clock edge: sample 0.7
    u.tick(p, -0.3f, 0.0f, 1.0f, 48000.0, out, gate, inv); // still high: hold
    EXPECT_NEAR(out, 0.7, 1e-6);
    u.tick(p, -0.3f, 0.0f, 0.0f, 48000.0, out, gate, inv);
    u.tick(p, -0.3f, 0.0f, 1.0f, 48000.0, out, gate, inv); // next edge
    EXPECT_NEAR(out, -0.3, 1e-6);
}

static void oscillator() {
    g_test = "oscillator";
    OscillatorDsp o;
    o.prepare(48000.0);
    o.reset();
    OscillatorParams p;
    p.pitch = 9.0f / 12.0f;  // A4 = 440 Hz
    EXPECT_NEAR(OscillatorDsp::frequency(p.pitch), 440.0, 0.01);
    int crossings = 0;
    float last = 0.0f, peak = 0.0f;
    for (int i = 0; i < 48000; ++i) {
        const auto f = o.tick(p, 0.0f, 0.0f);
        if (last < 0.0f && f.sine >= 0.0f) ++crossings;
        last = f.sine;
        peak = std::max(peak, std::fabs(f.saw));
    }
    EXPECT(crossings >= 439 && crossings <= 441);  // one second of 440 Hz
    EXPECT(peak < 1.2f);  // band-limited saw: small polyBLEP overshoot only

    // Deep through-zero FM stays finite and bounded.
    p.fmDepth = 1.0f;
    for (int i = 0; i < 48000; ++i) {
        const auto f = o.tick(p, std::sin(i * 0.05f), 0.0f);
        EXPECT(std::isfinite(f.out) && std::fabs(f.out) <= 1.5f);
        if (g_failures) return;
    }
}

static void adsr() {
    g_test = "adsr";
    AdsrDsp env;
    env.prepare(1000.0);  // 1 sample = 1 ms
    env.reset();
    AdsrParams p;
    p.attack = 0.010f;
    p.decay = 0.050f;
    p.sustain = 0.5f;
    p.release = 0.100f;
    p.velocityAmount = 0.0f;
    AdsrFrame f{};
    for (int i = 0; i < 10; ++i) f = env.tick(p, 1.0f, 0.0f, 1.0f);
    EXPECT_NEAR(f.env, 1.0, 1e-4);  // attack done after 10 ms
    for (int i = 0; i < 200; ++i) f = env.tick(p, 1.0f, 0.0f, 1.0f);
    EXPECT_NEAR(f.env, 0.5, 1e-3);  // sustain
    EXPECT(f.active > 0.5f);
    int end = -1;
    for (int i = 0; i < 300 && end < 0; ++i) {
        f = env.tick(p, 0.0f, 0.0f, 1.0f);
        if (f.end > 0.5f) end = i;
    }
    EXPECT(end >= 85 && end <= 105);  // −80 dB after the release time (from full level; sustain 0.5 is a bit sooner)
    EXPECT(f.active < 0.5f);

    // Velocity scales the level when the amount is up.
    p.velocityAmount = 1.0f;
    env.reset();
    for (int i = 0; i < 20; ++i) f = env.tick(p, 1.0f, 0.0f, 0.5f);
    EXPECT(f.env <= 0.5f + 1e-4f);
}

static void roughFilter() {
    g_test = "rough filter";
    FilterDsp f;
    f.prepare(48000.0);
    FilterParams p;
    p.type = 1;
    p.resonance = 1.0f;
    p.drive = 1.0f;
    std::mt19937 rng(3);
    std::uniform_real_distribution<float> u(-1.0f, 1.0f);
    float peak = 0.0f;
    for (int i = 0; i < 96000; ++i) {
        p.cutoff = 0.5f + 0.5f * std::sin(i * 0.001f);
        float frame[2] = {u(rng), u(rng)};
        f.tick(p, 0.0f, frame, 2);
        EXPECT(std::isfinite(frame[0]));
        peak = std::max(peak, std::fabs(frame[0]));
        if (g_failures) return;
    }
    EXPECT(peak < 20.0f);  // saturation keeps full resonance bounded
}

int main() {
    svfBasics();
    filterMapping();
    functionCycle();
    functionEnvelope();
    randomDeterminism();
    utilityShapes();
    oscillator();
    adsr();
    roughFilter();
    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all DSP tests passed\n");
    return 0;
}
