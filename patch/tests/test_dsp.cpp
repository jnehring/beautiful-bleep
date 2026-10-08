// SPDX-License-Identifier: MIT
// Unit tests for the Bleep Patch DSP cores. No JUCE, no bus: pure C++.
#include "../modules/adsr/dsp/AdsrDsp.h"
#include "../modules/filter/dsp/FilterDsp.h"
#include "../modules/oscillator/dsp/OscillatorDsp.h"
#include "../modules/function/dsp/FunctionDsp.h"
#include "../modules/lfo/dsp/LfoDsp.h"
#include "../modules/random/dsp/RandomDsp.h"
#include "../modules/step-sequencer/dsp/StepSequencerDsp.h"
#include "../modules/utility/dsp/UtilityDsp.h"

#include <cmath>
#include <cstdio>
#include <functional>
#include <map>
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
    p.type = (int)FilterType::SvfSaturating;
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

// ---- Step Sequencer (specs/modules/step-sequencer.md §8) -------------------

struct SeqEvent {
    int64_t at;
    bool on;
    int note;
};

/// Runs a sequencer for `n` samples at 48 kHz. `drive(i, clock, reset, time)` sets the inputs.
template <class Drive>
static std::vector<SeqEvent> runSeq(StepSequencerDsp& d, const SeqParams& p, int64_t n, Drive&& drive,
                                    std::vector<SeqOutputs>* outs = nullptr, std::vector<int>* steps = nullptr) {
    std::vector<SeqEvent> ev;
    for (int64_t i = 0; i < n; ++i) {
        float clock = 0.0f, reset = 0.0f;
        bool clocked = false;
        SeqTime t;
        drive(i, clock, clocked, reset, t);
        SeqOutputs o;
        d.tick(p, clock, clocked, reset, 0.0f, t, o, [&](bool on, int note, float, float) { ev.push_back({i, on, note}); });
        if (outs) outs->push_back(o);
        if (steps && o.trigger > 0.0f) steps->push_back(d.playingStep());
    }
    return ev;
}

static auto transportAt(double bpm = 120.0) {
    return [bpm](int64_t i, float&, bool&, float&, SeqTime& t) {
        t.running = true;
        t.started = i == 0;
        t.bpm = bpm;
        t.ppq = (double)i * bpm / 60.0 / 48000.0;
    };
}

static void seqScales() {
    g_test = "seq-scales";
    const uint16_t major = dsp::scales()[1].mask, minorPent = dsp::scales()[12].mask, chroma = dsp::scales()[0].mask;
    EXPECT(dsp::scales().size() == 17);
    EXPECT(dsp::quantize(1.0f, major) == 0);   // tie between 0 and 2 goes down
    EXPECT(dsp::quantize(6.0f, major) == 5);   // tie between 5 and 7
    EXPECT(dsp::quantize(-1.0f, major) == -1); // B below C
    EXPECT(dsp::quantize(-2.0f, major) == -3); // tie between A and B goes down
    EXPECT(dsp::quantize(13.0f, major) == 12);
    EXPECT(dsp::quantize(1.0f, minorPent) == 0);
    EXPECT(dsp::quantize(2.0f, minorPent) == 3);
    EXPECT(dsp::quantize(0.5f, chroma) == 0);
    EXPECT(dsp::quantize(0.6f, chroma) == 1);
    for (const auto& sc : dsp::scales())
        for (int k = -30; k <= 40; ++k) EXPECT(dsp::inScale(sc.mask, dsp::quantize((float)k + 0.3f, sc.mask)));
    SeqParams p;
    p.root = 2;  // D major, quantized relative to the root: 3 above D ties E/F# and goes down to E
    EXPECT(StepSequencerDsp::pitchOf(p, 3.0f) == 4);
}

static void seqTransport() {
    g_test = "seq-transport";
    for (int rate = 0; rate < StepSequencerDsp::kNumRates; ++rate) {
        StepSequencerDsp d;
        d.prepare(48000.0);
        d.reset();
        SeqParams p;
        p.rate = rate;
        const double stepSamples = StepSequencerDsp::rateBeats(rate) * 24000.0;
        auto ev = runSeq(d, p, (int64_t)(stepSamples * 6.5), transportAt());
        int k = 0;
        for (const auto& e : ev)
            if (e.on) {
                EXPECT(std::llabs(e.at - (int64_t)std::ceil(stepSamples * k - 1e-6)) <= 1);
                ++k;
            }
        EXPECT(k == 7);
    }
    // A loop jump back to bar 1 plays step 1 again.
    StepSequencerDsp d;
    d.prepare(48000.0);
    d.reset();
    SeqParams p;
    std::vector<int> steps;
    runSeq(d, p, 30000, [](int64_t i, float&, bool&, float&, SeqTime& t) {
        t.running = true;
        t.bpm = 120.0;
        const int64_t j = i < 15000 ? i : i - 15000;  // jump back at 15000
        t.ppq = (double)j / 24000.0;
    }, nullptr, &steps);
    EXPECT(steps.size() >= 4 && steps[0] == 0 && steps[1] == 1 && steps[2] == 2 && steps[3] == 0);
    // Stopping the transport ends the note.
    StepSequencerDsp s;
    s.prepare(48000.0);
    s.reset();
    p.gateLength = 1.0f;
    auto ev = runSeq(s, p, 9000, [](int64_t i, float&, bool&, float&, SeqTime& t) {
        t.running = i < 3000;
        t.bpm = 120.0;
        t.ppq = (double)i / 24000.0;
    });
    EXPECT(ev.size() == 2 && ev[1].at == 3000 && !ev[1].on);
}

static void seqClock() {
    g_test = "seq-clock";
    StepSequencerDsp d;
    d.prepare(48000.0);
    d.reset();
    SeqParams p;
    p.length = 4;
    std::vector<int> steps;
    // Pulses every 1000 samples; Reset with the 6th pulse.
    auto ev = runSeq(d, p, 8000, [](int64_t i, float& clock, bool& clocked, float& reset, SeqTime&) {
        clocked = true;
        clock = i % 1000 == 0 ? 1.0f : 0.0f;
        reset = i == 5000 ? 1.0f : 0.0f;
    }, nullptr, &steps);
    const std::vector<int> want{0, 1, 2, 3, 0, 0, 1, 2};
    EXPECT(steps == want);
    // Swing 75 %: every second step starts half a step late.
    StepSequencerDsp s;
    s.prepare(48000.0);
    s.reset();
    p.swing = 0.75f;
    ev = runSeq(s, p, 6000, [](int64_t i, float& clock, bool& clocked, float&, SeqTime&) {
        clocked = true;
        clock = i % 1000 == 0 ? 1.0f : 0.0f;
    });
    std::vector<int64_t> ons;
    for (const auto& e : ev)
        if (e.on) ons.push_back(e.at);
    // The first gap isn't known yet at the second pulse (default period); from then on 1000.
    EXPECT(ons.size() >= 5 && ons[0] == 0 && ons[2] == 2000 && ons[3] == 3500 && ons[4] == 4000);
}

static void seqDirections() {
    g_test = "seq-directions";
    auto order = [](int direction, int length, int count) {
        StepSequencerDsp d;
        d.prepare(48000.0);
        d.reset();
        SeqParams p;
        p.length = length;
        p.direction = direction;
        std::vector<int> steps;
        runSeq(d, p, (int64_t)count * 100, [](int64_t i, float& clock, bool& clocked, float&, SeqTime&) {
            clocked = true;
            clock = i % 100 == 0 ? 1.0f : 0.0f;
        }, nullptr, &steps);
        return steps;
    };
    EXPECT((order(SeqForward, 4, 6) == std::vector<int>{0, 1, 2, 3, 0, 1}));
    EXPECT((order(SeqBackward, 4, 6) == std::vector<int>{3, 2, 1, 0, 3, 2}));
    EXPECT((order(SeqPingPong, 4, 9) == std::vector<int>{0, 1, 2, 3, 2, 1, 0, 1, 2}));
    EXPECT((order(SeqPingPong, 1, 3) == std::vector<int>{0, 0, 0}));
    const auto r = order(SeqRandom, 5, 200);
    EXPECT(r.size() == 200);
    std::vector<int> seen(5, 0);
    for (size_t i = 0; i < r.size(); ++i) {
        EXPECT(r[i] >= 0 && r[i] < 5);
        if (i) EXPECT(r[i] != r[i - 1]);
        seen[(size_t)r[i]]++;
    }
    for (int c : seen) EXPECT(c > 10);
    EXPECT(order(SeqRandom, 5, 50) == order(SeqRandom, 5, 50));  // seeded
}

static void seqTies() {
    g_test = "seq-ties";
    StepSequencerDsp d;
    d.prepare(48000.0);
    d.reset();
    SeqPattern pat{};
    pat[0] = {SeqTie, 0, 100};
    pat[1] = {SeqOn, 2, 100};
    pat[2] = {SeqTie, 4, 100};
    pat[3] = {SeqTie, 4, 100};
    pat[4] = {SeqOff, 0, 100};
    d.setPattern(pat);
    SeqParams p;
    p.length = 5;
    std::vector<SeqOutputs> outs;
    auto ev = runSeq(d, p, 30000, transportAt(), &outs);
    std::vector<SeqEvent> want{{0, true, 60},     {6000, true, 62},  {6000, false, 60},
                               {9000, false, 62}, {12000, true, 64}, {24000, false, 64}};
    EXPECT(ev.size() == want.size());
    for (size_t i = 0; i < std::min(ev.size(), want.size()); ++i)
        EXPECT(ev[i].at == want[i].at && ev[i].on == want[i].on && ev[i].note == want[i].note);
    EXPECT(outs[5999].gate == 1.0f && outs[6000].gate == 1.0f && outs[8999].gate == 1.0f && outs[9000].gate == 0.0f);
    EXPECT(outs[23999].gate == 1.0f && outs[24000].gate == 0.0f);
    EXPECT(outs[13000].pitch == 4.0f / 12.0f && outs[25000].pitch == 4.0f / 12.0f);  // Off holds the pitch
    EXPECT(outs[0].trigger == 1.0f && outs[6000].trigger == 0.0f && outs[18000].trigger == 0.0f);
}

static void seqVariation() {
    g_test = "seq-variation";
    SeqPattern pat{};
    for (int i = 0; i < kSeqSteps; ++i) pat[(size_t)i] = {(uint8_t)(i % 3 ? SeqOn : SeqOff), (int8_t)(i % 7), 90};
    auto run = [&](float variation, uint32_t seed) {
        StepSequencerDsp d;
        d.prepare(48000.0);
        d.reset();
        d.setPattern(pat);
        SeqParams p;
        p.variation = variation;
        p.seed = seed;
        p.scale = 0;
        return runSeq(d, p, 6000 * 64, transportAt());
    };
    const auto plain = run(0.0f, 1), a = run(0.7f, 1), b = run(0.7f, 1), c = run(0.7f, 2);
    auto notes = [](const std::vector<SeqEvent>& ev) {
        std::vector<int> n;
        for (const auto& e : ev)
            if (e.on) n.push_back(e.note);
        return n;
    };
    std::vector<int> stored;
    for (int k = 0; k < 64; ++k)
        if (k % 16 % 3) stored.push_back(60 + k % 16 % 7);
    EXPECT(notes(plain) == stored);
    EXPECT(notes(a) == notes(b));
    EXPECT(notes(a) != notes(plain));
    EXPECT(notes(a) != notes(c));
    EXPECT(notes(a).size() == notes(plain).size());  // Variation never adds or removes gates
}

static void seqNoHangingNotes() {
    g_test = "seq-hanging";
    std::mt19937 rng(7);
    for (int round = 0; round < 40; ++round) {
        StepSequencerDsp d;
        d.prepare(48000.0);
        d.reset();
        std::map<int, int> sounding;
        bool bad = false;
        auto emit = [&](bool on, int note, float, float) {
            if (on) {
                if (sounding[note]++ > 0) bad = true;
            } else if (--sounding[note] < 0) {
                bad = true;
            }
        };
        SeqParams p;
        SeqTime t;
        t.bpm = 140.0;
        double ppq = 0.0;
        for (int64_t i = 0; i < 200000; ++i) {
            if (i % 4000 == 0) {
                SeqPattern pat{};
                for (auto& s : pat) s = {(uint8_t)(rng() % 3), (int8_t)((int)(rng() % 25) - 12), (uint8_t)(1 + rng() % 127)};
                d.setPattern(pat);
                p.length = 1 + (int)(rng() % 32);
                p.direction = (int)(rng() % 4);
                p.gateLength = (float)(rng() % 100) / 100.0f;
                p.swing = 0.5f + (float)(rng() % 25) / 100.0f;
                p.variation = (float)(rng() % 2) * 0.5f;
                p.scale = (int)(rng() % 17);
            }
            const bool clocked = (i / 50000) % 2 == 1;
            t.running = (i / 23000) % 3 != 2;
            t.started = false;
            if (t.running) ppq += t.bpm / 60.0 / 48000.0;
            if (i % 70000 == 0) ppq = 0.0;  // loop jump
            t.ppq = ppq;
            SeqOutputs o;
            d.tick(p, i % 1500 < 3 ? 1.0f : 0.0f, clocked, i % 9000 == 0 ? 1.0f : 0.0f, 0.0f, t, o, emit);
        }
        // Stop: transport off, clock unpatched.
        t.running = false;
        SeqOutputs o;
        d.tick(p, 0.0f, false, 0.0f, 0.0f, t, o, emit);
        d.tick(p, 0.0f, false, 0.0f, 0.0f, t, o, emit);
        int left = 0;
        for (const auto& [note, count] : sounding) left += count;
        EXPECT(!bad);
        EXPECT(left == 0);
        if (g_failures) return;
    }
}

/// Steady-state gain of one algorithm for a sine at freq (after settling).
static double filterGain(FilterType type, float hz, double freq, float resonance = 0.0f, float morph = 0.0f,
                         float gain = 0.0f) {
    FilterDsp f;
    f.prepare(48000.0);
    FilterParams p;
    p.type = (int)type;
    p.cutoff = std::log(hz / 20.0f) / std::log(1000.0f);
    p.resonance = resonance;
    p.morph = morph;
    p.gain = gain;
    double in = 0.0, out = 0.0;
    for (int i = 0; i < 48000; ++i) {
        const float x = freq == 0.0 ? 0.1f : 0.1f * (float)std::sin(2.0 * 3.14159265358979 * freq * i / 48000.0);
        float frame[2] = {x, x};
        f.tick(p, 0.0f, frame, 2);
        if (i >= 24000) {
            in += (double)x * x;
            out += (double)frame[0] * frame[0];
        }
    }
    return std::sqrt(out / in);
}

static void filterAlgorithms() {
    g_test = "filter algorithms";
    // Every algorithm stays finite and bounded at full resonance and drive,
    // with audio-rate cutoff modulation and every morph position.
    for (int t = 0; t < va::kNumTypes; ++t) {
        for (float morph : {0.0f, 0.5f, 1.0f}) {
            FilterDsp f;
            f.prepare(48000.0);
            FilterParams p;
            p.type = t;
            p.resonance = 1.0f;
            p.drive = 1.0f;
            p.morph = morph;
            p.gain = 24.0f;
            std::mt19937 rng(11);
            std::uniform_real_distribution<float> u(-1.0f, 1.0f);
            float peak = 0.0f;
            for (int i = 0; i < 48000; ++i) {
                p.cutoff = 0.5f + 0.5f * std::sin(i * (i < 24000 ? 0.0005f : 0.3f));
                float frame[2] = {u(rng), std::sin(i * 0.05f)};
                f.tick(p, 0.0f, frame, 2);
                peak = std::max({peak, std::fabs(frame[0]), std::fabs(frame[1])});
                if (!std::isfinite(frame[0]) || !std::isfinite(frame[1])) break;
            }
            if (!(std::isfinite(peak) && peak < 100.0f))
                std::printf("  type %d morph %.1f: peak %g\n", t, morph, peak);
            EXPECT(std::isfinite(peak) && peak < 100.0f);
        }
    }

    // Low-pass responses: unity at DC (shelf/compensation aside), far down two octaves above.
    for (FilterType t : {FilterType::Svf, FilterType::OnePoleLp, FilterType::Ladder, FilterType::LadderFeedbackHp,
                         FilterType::LadderNonlinear, FilterType::Diode, FilterType::NaiveOnePole, FilterType::Biquad,
                         FilterType::SvfAtanh, FilterType::SvfHyperbolic}) {
        g_test = "filter low-pass";
        const double pass = filterGain(t, 1000.0f, 50.0), stop = filterGain(t, 1000.0f, 8000.0);
        if (!(pass > 0.85 && pass < 1.15 && stop < 0.2)) std::printf("  type %d: pass %g stop %g\n", (int)t, pass, stop);
        EXPECT(pass > 0.85 && pass < 1.15);
        EXPECT(stop < 0.2);
    }
    for (FilterType t : {FilterType::OnePoleHp}) {
        g_test = "filter high-pass";
        EXPECT(filterGain(t, 1000.0f, 50.0) < 0.1);
        EXPECT_NEAR(filterGain(t, 1000.0f, 15000.0), 1.0, 0.05);
    }
    g_test = "filter ladder modes";
    EXPECT(filterGain(FilterType::Ladder, 1000.0f, 8000.0, 0.0f, 2.0f / 3.0f) > 0.85);  // HP passes highs
    EXPECT(filterGain(FilterType::Ladder, 1000.0f, 100.0, 0.0f, 2.0f / 3.0f) < 0.01);  // −24 dB/oct
    EXPECT(filterGain(FilterType::Ladder, 1000.0f, 1000.0, 0.0f, 1.0f) < 0.05);        // notch at the cutoff
    EXPECT(filterGain(FilterType::Ladder, 1000.0f, 1000.0, 0.0f, 1.0f / 3.0f) > 0.9);  // BP peak, unit gain

    g_test = "filter allpass";
    for (FilterType t : {FilterType::OnePoleAp, FilterType::SvfAllpass})
        for (double freq : {100.0, 1000.0, 10000.0}) EXPECT_NEAR(filterGain(t, 1000.0f, freq, 0.5f), 1.0, 0.02);

    g_test = "filter shelves";
    EXPECT_NEAR(filterGain(FilterType::OnePoleLowShelf, 1000.0f, 20.0, 0.0f, 0.0f, 12.0f), std::pow(10.0, 0.6), 0.1);
    EXPECT_NEAR(filterGain(FilterType::OnePoleLowShelf, 1000.0f, 15000.0, 0.0f, 0.0f, 12.0f), 1.0, 0.05);
    EXPECT_NEAR(filterGain(FilterType::OnePoleHighShelf, 1000.0f, 15000.0, 0.0f, 0.0f, -12.0f), std::pow(10.0, -0.6), 0.03);
    EXPECT_NEAR(filterGain(FilterType::SvfBandShelf, 1000.0f, 1000.0, 0.0f, 0.0f, 6.0f), std::pow(10.0, 0.3), 0.05);
    EXPECT_NEAR(filterGain(FilterType::SvfUnitBp, 1000.0f, 1000.0, 0.7f), 1.0, 0.03);

    g_test = "filter phaser";
    // 1-pole phaser: four allpasses at −45° each (ω = tan 22.5°) sum to −180°, a notch;
    // at the cutoff they sum to −360°, a peak.
    EXPECT(filterGain(FilterType::Phaser1, 1000.0f, 1000.0 * std::tan(3.14159265358979 / 8.0)) < 0.05);
    EXPECT(filterGain(FilterType::Phaser1, 1000.0f, 1000.0) > 0.95);
    // Flanger: delay 1/cutoff → notches at odd multiples of cutoff / 2.
    EXPECT(filterGain(FilterType::Flanger, 1000.0f, 500.0) < 0.05);
    EXPECT(filterGain(FilterType::Flanger, 1000.0f, 1000.0) > 0.95);
}

// ---- LFO (specs/modules/lfo.md §8) -------------------------------------------

static void lfoBasics() {
    g_test = "lfo";
    // Free rate: 2 Hz → a Cycle pulse every 24000 samples, starting at 0.
    LfoDsp d;
    d.prepare(48000.0);
    d.reset();
    LfoParams p;
    p.rateHz = 2.0f;
    LfoTime t;
    LfoFrame f;
    std::vector<int> cycles;
    float lo = 1e9f, hi = -1e9f;
    for (int i = 0; i < 48000; ++i) {
        d.tick(p, 0.0f, t, f);
        if (f.cycle > 0.0f) cycles.push_back(i);
        lo = std::min(lo, f.out);
        hi = std::max(hi, f.out);
    }
    EXPECT(cycles.size() == 2 && cycles[0] == 0 && std::abs(cycles[1] - 24000) <= 1);
    EXPECT(lo >= -1.0f && hi <= 1.0f && hi > 0.999f && lo < -0.999f);

    // Wave values at the quarter phases.
    const double ph[4] = {0.0, 0.25, 0.5, 0.75};
    const float sine[4] = {0, 1, 0, -1}, tri[4] = {0, 1, 0, -1}, saw[4] = {-1, -0.5f, 0, 0.5f};
    for (int k = 0; k < 4; ++k) {
        EXPECT_NEAR(LfoDsp::value(LfoSine, ph[k], 0.5f, 1, 0), sine[k], 1e-6);
        EXPECT_NEAR(LfoDsp::value(LfoTriangle, ph[k], 0.5f, 1, 0), tri[k], 1e-6);
        EXPECT_NEAR(LfoDsp::value(LfoSawUp, ph[k], 0.5f, 1, 0), saw[k], 1e-6);
        EXPECT_NEAR(LfoDsp::value(LfoSawDown, ph[k], 0.5f, 1, 0), -saw[k], 1e-6);
    }
    EXPECT(LfoDsp::value(LfoSquare, 0.2, 0.25f, 1, 0) == 1.0f && LfoDsp::value(LfoSquare, 0.3, 0.25f, 1, 0) == -1.0f);

    // Random: per cycle, seeded; Smooth is continuous and meets the next value.
    EXPECT(LfoDsp::randomAt(1, 5) == LfoDsp::randomAt(1, 5));
    EXPECT(LfoDsp::randomAt(1, 5) != LfoDsp::randomAt(2, 5));
    EXPECT(LfoDsp::value(LfoRandomStep, 0.1, 0.5f, 1, 3) == LfoDsp::value(LfoRandomStep, 0.9, 0.5f, 1, 3));
    EXPECT_NEAR(LfoDsp::value(LfoRandomSmooth, 0.0, 0.5f, 1, 3), LfoDsp::randomAt(1, 3), 1e-6);
    EXPECT_NEAR(LfoDsp::value(LfoRandomSmooth, 0.999999, 0.5f, 1, 3), LfoDsp::randomAt(1, 4), 1e-4);
    {
        LfoDsp r;
        r.prepare(48000.0);
        r.reset();
        LfoParams q;
        q.wave = LfoRandomSmooth;
        q.rateHz = 5.0f;
        float last = 0.0f, maxStep = 0.0f;
        for (int i = 0; i < 48000; ++i) {
            r.tick(q, 0.0f, t, f);
            if (i) maxStep = std::max(maxStep, std::fabs(f.out - last));
            last = f.out;
        }
        EXPECT(maxStep < 0.01f);
    }

    // Unipolar stays in 0..1.
    {
        LfoDsp u;
        u.prepare(48000.0);
        u.reset();
        LfoParams q;
        q.unipolar = true;
        q.rateHz = 7.0f;
        for (int w = 0; w < kLfoWaves; ++w) {
            q.wave = w;
            for (int i = 0; i < 9000; ++i) {
                u.tick(q, 0.0f, t, f);
                EXPECT(f.out >= 0.0f && f.out <= 1.0f && f.random >= 0.0f && f.random <= 1.0f);
                if (g_failures) return;
            }
        }
    }

    // Sync: phase = frac(ppq / beats), also after a loop jump.
    for (int sync = 1; sync < 10; ++sync) {
        LfoDsp s;
        s.prepare(48000.0);
        s.reset();
        LfoParams q;
        q.sync = sync;
        q.wave = LfoSawUp;
        LfoTime ts;
        ts.running = true;
        ts.bpm = 120.0;
        const double beats = dsp::syncBeats(sync);
        float first = 0.0f;
        for (int i = 0; i < 60000; ++i) {
            const int j = i < 30000 ? i : i - 30000;  // loop jump back to 0
            ts.ppq = 0.37 + j / 24000.0;
            ts.started = i == 0;
            s.tick(q, 0.0f, ts, f);
            const double expect = std::fmod(ts.ppq / beats, 1.0);
            EXPECT_NEAR(s.phase(), expect, 1e-9);
            if (i == 100) first = f.out;
            if (i == 30100) EXPECT(f.out == first);
            if (g_failures) return;
        }
    }

    // Reset restarts the cycle; Fade ramps from 0 to full.
    {
        LfoDsp r;
        r.prepare(48000.0);
        r.reset();
        LfoParams q;
        q.wave = LfoSquare;
        q.fade = 0.5f;
        for (int i = 0; i < 1000; ++i) r.tick(q, 0.0f, t, f);
        r.tick(q, 1.0f, t, f);
        EXPECT(f.cycle == 1.0f && r.phase() == 0.0);
        EXPECT(f.out > 0.0f && f.out < 0.001f);
        for (int i = 0; i < 12000; ++i) r.tick(q, 0.0f, t, f);
        EXPECT_NEAR(f.out, 0.5, 0.01);  // a quarter of a second into a half-second fade (square is high)
        for (int i = 0; i < 12100; ++i) r.tick(q, 0.0f, t, f);
        EXPECT(std::fabs(f.out) == 1.0f);
    }
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
    lfoBasics();
    filterAlgorithms();
    seqScales();
    seqTransport();
    seqClock();
    seqDirections();
    seqTies();
    seqVariation();
    seqNoHangingNotes();
    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all DSP tests passed\n");
    return 0;
}
