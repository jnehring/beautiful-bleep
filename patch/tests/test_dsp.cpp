// SPDX-License-Identifier: MIT
// Unit tests for the Bleep Patch DSP cores. No JUCE, no bus: pure C++.
#include "../modules/adsr/dsp/AdsrDsp.h"
#include "../modules/drum-grid/dsp/DrumGridDsp.h"
#include "../modules/filter/dsp/FilterDsp.h"
#include "../modules/oscillator/dsp/OscillatorDsp.h"
#include "../modules/function/dsp/FunctionDsp.h"
#include "../modules/noise/dsp/NoiseDsp.h"
#include "../modules/punch-drums/dsp/PunchDrumsDsp.h"
#include "../modules/lfo/dsp/LfoDsp.h"
#include "../modules/random/dsp/RandomDsp.h"
#include "../modules/ring-drums/dsp/RingDrumsDsp.h"
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
    p.mix = 0.0f; // dry: the input, exactly, delayed by the oversampling latency
    for (int i = 0; i <= FilterDsp::kLatency; ++i) {
        float frame[2] = {i == 0 ? 0.3f : 0.0f, i == 0 ? -0.2f : 0.0f};
        f.tick(p, 0.0f, frame, 2);
        EXPECT_NEAR(frame[0], i == FilterDsp::kLatency ? 0.3 : 0.0, 1e-7);
        EXPECT_NEAR(frame[1], i == FilterDsp::kLatency ? -0.2 : 0.0, 1e-7);
    }

    // Wet and dry line up: a pass-through filter at 50 % mix keeps a 1 kHz tone whole.
    {
        FilterDsp g;
        g.prepare(48000.0);
        FilterParams q;
        q.type = (int)FilterType::OnePoleAp;
        q.mix = 0.5f;
        q.cutoff = 1.0f;  // 20 kHz: the allpass barely shifts 1 kHz
        double in = 0.0, out = 0.0;
        for (int i = 0; i < 9600; ++i) {
            const float x = std::sin(i * 2.0f * 3.14159265f * 1000.0f / 48000.0f);
            float fr[2] = {x, x};
            g.tick(q, 0.0f, fr, 2);
            if (i >= 4800) in += (double)x * x, out += (double)fr[0] * fr[0];
        }
        EXPECT_NEAR(std::sqrt(out / in), 1.0, 0.02);
    }

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

/// Magnitude of one frequency in x (Goertzel), normalised to a sine's amplitude.
static double toneLevel(const std::vector<float>& x, double freq, double sampleRate) {
    const double w = 2.0 * 3.14159265358979 * freq / sampleRate, k = 2.0 * std::cos(w);
    double s1 = 0.0, s2 = 0.0;
    for (float v : x) {
        const double s0 = v + k * s1 - s2;
        s2 = s1, s1 = s0;
    }
    return 2.0 * std::sqrt(std::max(0.0, s1 * s1 + s2 * s2 - k * s1 * s2)) / (double)x.size();
}

static void filterAliasing() {
    g_test = "filter aliasing";
    // A hard-driven 7.3 kHz sine: its in-band harmonics are 7.3 and 21.9 kHz;
    // everything else in the output is harmonics above Nyquist folded back.
    const double f0 = 7300.0, sr = 48000.0;
    for (FilterType t : {FilterType::Svf, FilterType::LadderTanh}) {
        FilterDsp f;
        f.prepare(sr);
        FilterParams p;
        p.type = (int)t;
        p.cutoff = 1.0f;
        p.resonance = 0.0f;
        p.drive = 1.0f;
        std::vector<float> out;
        for (int i = 0; i < 48000; ++i) {
            const float x = 0.8f * (float)std::sin(2.0 * 3.14159265358979 * f0 * i / sr);
            float frame[2] = {x, x};
            f.tick(p, 0.0f, frame, 2);
            if (i >= 4800) out.push_back(frame[0]);
        }
        double total = 0.0;
        for (float v : out) total += (double)v * v / (double)out.size();
        const double h1 = toneLevel(out, f0, sr), h3 = toneLevel(out, 3.0 * f0, sr);
        const double alias = std::sqrt(std::max(0.0, total - 0.5 * (h1 * h1 + h3 * h3))) / h1;
        if (!(alias < 0.01)) std::printf("  type %d: aliases only %.1f dB down\n", (int)t, -20.0 * std::log10(alias));
        EXPECT(h1 > 0.1);
        EXPECT(alias < 0.01);  // below −40 dB
    }
}

// ---- Step Sequencer (doc/specs/modules/step-sequencer.md §8) -------------------

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

// ---- LFO (doc/specs/modules/lfo.md §8) -------------------------------------------

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

/// Noise: every colour at the same loudness, and the right spectral tilt.
static void noise() {
    g_test = "noise";
    NoiseDsp n;
    n.prepare(48000.0);
    // Energy below 300 Hz vs above 6 kHz, through two one-pole splits.
    struct Band {
        double rms = 0.0, low = 0.0, high = 0.0;
        float lp = 0.0f, hpIn = 0.0f, hp = 0.0f;
        void add(float x) {
            rms += (double)x * x;
            lp += 0.0385f * (x - lp);            // ≈ 300 Hz
            hp = 0.55f * (hp + x - hpIn);        // ≈ 6 kHz
            hpIn = x;
            low += (double)lp * lp;
            high += (double)hp * hp;
        }
    } bands[6];
    const float colours[6] = {-1.0f, -0.5f, 0.0f, 0.5f, 1.0f, 0.25f};
    constexpr int kN = 48000 * 4;
    float peak = 0.0f;
    for (int i = 0; i < kN; ++i) {
        const auto f = n.next();
        EXPECT_NEAR(NoiseDsp::colour(f, -1.0f), f.brown, 1e-7);
        EXPECT_NEAR(NoiseDsp::colour(f, 0.0f), f.white, 1e-7);
        EXPECT_NEAR(NoiseDsp::colour(f, 1.0f), f.violet, 1e-7);
        for (int c = 0; c < 6; ++c) bands[c].add(NoiseDsp::colour(f, colours[c]));
        peak = std::max({peak, std::fabs(f.white), std::fabs(f.pink), std::fabs(f.brown), std::fabs(f.blue)});
        if (g_failures) return;
    }
    for (int c = 0; c < 5; ++c) EXPECT_NEAR(std::sqrt(bands[c].rms / kN), 0.3, 0.04);
    EXPECT(peak < 2.0f);
    // Darker colours carry more low end and less top than brighter ones.
    for (int c = 0; c < 4; ++c) {
        EXPECT(bands[c].low / bands[c].high > 2.0 * bands[c + 1].low / bands[c + 1].high);
    }
    // Two sources never play the same noise.
    NoiseDsp a, b;
    a.prepare(48000.0);
    b.prepare(48000.0);
    double corr = 0.0;
    for (int i = 0; i < 48000; ++i) corr += (double)a.next().white * b.next().white;
    EXPECT(std::fabs(corr / 48000.0) < 0.005);
}

struct DrumRun {
    float peak = 0.0f;   ///< whole run
    float before = 0.0f; ///< peak before the trigger
    float end = 0.0f;    ///< peak in the last 100 ms
    bool finite = true;
    std::vector<float> out;
};

/// Runs a voice for `seconds`, triggering `input` at 10 ms.
template <class V>
static DrumRun drum(const typename V::Params& p, float seconds, float velocity = 1.0f, int input = 0) {
    V v;
    v.prepare(48000.0);
    v.reset();
    DrumRun r;
    const int n = (int)(seconds * 48000.0f);
    for (int i = 0; i < n; ++i) {
        if (i == 480) v.trigger(input, velocity);
        const float x = v.tick(p);
        r.out.push_back(x);
        r.finite = r.finite && std::isfinite(x);
        r.peak = std::max(r.peak, std::fabs(x));
        if (i < 480) r.before = std::max(r.before, std::fabs(x));
        if (i >= n - 4800) r.end = std::max(r.end, std::fabs(x));
    }
    return r;
}

/// Frequency from positive-going zero crossings between two times.
static double crossingHz(const std::vector<float>& x, double from, double to) {
    int count = 0, first = -1, last = -1;
    for (int i = (int)(from * 48000); i < (int)(to * 48000) && i < (int)x.size(); ++i)
        if (x[(size_t)i - 1] < 0.0f && x[(size_t)i] >= 0.0f) {
            if (first < 0) first = i;
            last = i;
            ++count;
        }
    return count > 1 ? (count - 1) * 48000.0 / (last - first) : 0.0;
}

/// Every drum voice: silent until triggered, sounds at a sane level, dies away.
template <class V>
static void drumBasics(const char* name, typename V::Params p = {}, float seconds = 4.0f, int input = 0) {
    g_test = name;
    const auto r = drum<V>(p, seconds, 1.0f, input);
    EXPECT(r.finite);
    EXPECT(r.before == 0.0f);
    EXPECT(r.peak > 0.3f && r.peak < 1.5f);
    EXPECT(r.end < 1e-3f * r.peak);
    const auto soft = drum<V>(p, seconds, 0.25f, input);
    EXPECT(soft.peak < 0.6f * r.peak && soft.peak > 0.05f * r.peak);
}

static void drums() {
    drumBasics<RingKick>("ring kick");
    drumBasics<RingSnare>("ring snare");
    drumBasics<RingClap>("ring clap");
    drumBasics<RingTom>("ring tom");
    drumBasics<RingRim>("ring rim");
    drumBasics<RingRim>("ring clave", {RingRim::Clave});
    drumBasics<RingCowbell>("ring cowbell");
    drumBasics<RingHats>("ring hats closed", {}, 2.0f, RingHats::Closed);
    drumBasics<RingHats>("ring hats open", {}, 4.0f, RingHats::Open);
    drumBasics<RingCymbal>("ring cymbal", {}, 6.0f);
    drumBasics<PunchKick>("punch kick");
    drumBasics<PunchSnare>("punch snare");
    drumBasics<PunchClap>("punch clap");
    drumBasics<PunchTom>("punch tom");
    drumBasics<PunchRim>("punch rim");
    drumBasics<PunchHats>("punch hats closed", {}, 2.0f, PunchHats::Closed);
    drumBasics<PunchHats>("punch hats open", {}, 4.0f, PunchHats::Open);
    drumBasics<PunchCymbal>("punch crash", {}, 8.0f);
    PunchCymbal::Params ride;
    ride.voice = PunchCymbal::Ride;
    drumBasics<PunchCymbal>("punch ride", ride, 10.0f);

    g_test = "drum pitch";
    {  // Without sweep, kicks and toms ring at Tune.
        RingKick::Params k;
        k.sweep = 0.0f;
        k.tone = 0.0f;
        k.tuneHz = 60.0f;
        EXPECT_NEAR(crossingHz(drum<RingKick>(k, 1.0f).out, 0.1, 0.6), 60.0, 0.5);
        PunchKick::Params pk;
        pk.sweep = 0.0f;
        pk.attack = 0.0f;
        pk.drive = 0.0f;
        pk.tuneHz = 45.0f;
        EXPECT_NEAR(crossingHz(drum<PunchKick>(pk, 1.0f).out, 0.1, 0.6), 45.0, 0.5);
        // With sweep the pitch starts higher and settles on Tune.
        pk.sweep = 1.0f;
        const auto swept = drum<PunchKick>(pk, 1.5f).out;
        EXPECT(crossingHz(swept, 0.0105, 0.03) > 1.8 * 45.0);
        EXPECT_NEAR(crossingHz(swept, 0.8, 1.4), 45.0, 1.5);
        RingTom::Params t;
        t.noise = 0.0f;
        t.bend = 0.0f;
        t.tuneHz = 200.0f;
        EXPECT_NEAR(crossingHz(drum<RingTom>(t, 1.0f).out, 0.05, 0.3), 200.0, 1.0);
    }

    g_test = "drum decay";
    {  // Decay sets how long a voice rings (−60 dB).
        auto ringsFor = [](const std::vector<float>& x) {
            float peak = 0.0f;
            for (float v : x) peak = std::max(peak, std::fabs(v));
            size_t last = 0;
            for (size_t i = 0; i < x.size(); ++i)
                if (std::fabs(x[i]) > 1e-3f * peak) last = i;
            return (double)(last - 480) / 48000.0;
        };
        RingKick::Params k;
        k.decay = 1.5f;
        EXPECT_NEAR(ringsFor(drum<RingKick>(k, 3.0f).out), 1.5, 0.1);
        PunchTom::Params t;
        t.decay = 0.3f;
        t.noise = 0.0f;
        EXPECT_NEAR(ringsFor(drum<PunchTom>(t, 1.0f).out), 0.3, 0.05);
    }

    g_test = "hats choke";
    {  // A closed hit cuts a ringing open hat.
        RingHats v;
        v.prepare(48000.0);
        RingHats::Params p;
        p.openDecay = 3.0f;
        v.trigger(RingHats::Open, 1.0f);
        float open = 0.0f, after = 0.0f;
        for (int i = 0; i < 9600; ++i) open = std::max(open, std::fabs(v.tick(p)));
        v.trigger(RingHats::Closed, 1.0f);
        for (int i = 0; i < 24000; ++i) {
            const float x = std::fabs(v.tick(p));
            if (i > 14400) after = std::max(after, x);
        }
        EXPECT(after < 1e-3f * open);
    }

    g_test = "clap bursts";
    {  // Four bursts → four separate peaks in the envelope before the tail.
        RingClap::Params p;
        p.spread = 0.015f;
        const auto r = drum<RingClap>(p, 0.5f);
        int peaks = 0;
        for (int b = 0; b < 4; ++b) {
            const int start = 480 + (int)(b * p.spread * 48000.0f);
            float early = 0.0f, late = 0.0f;
            for (int i = 0; i < 100; ++i) early = std::max(early, std::fabs(r.out[(size_t)(start + i)]));
            for (int i = 500; i < 700; ++i) late = std::max(late, std::fabs(r.out[(size_t)(start + i)]));
            if (b < 3 && early > 3.0f * late) ++peaks;
            if (b == 3 && early > 0.05f) ++peaks;
        }
        EXPECT(peaks == 4);
    }

    g_test = "drum reset";
    {  // reset() silences a ringing voice.
        RingCymbal v;
        v.prepare(48000.0);
        RingCymbal::Params p;
        v.trigger(0, 1.0f);
        for (int i = 0; i < 1000; ++i) v.tick(p);
        v.reset();
        float after = 0.0f;
        for (int i = 0; i < 1000; ++i) after = std::max(after, std::fabs(v.tick(p)));
        EXPECT(after == 0.0f);
    }
}

// ---- Drum Grid (doc/specs/modules/drum-grid.md) --------------------------------

/// Sets a track's row from a string: `.` Off, `x` On, `X` Accent.
static void gridRow(GridPattern& p, int track, const char* row) {
    for (int i = 0; row[i] && i < kGridSteps; ++i)
        p.cells[(size_t)track][(size_t)i] = row[i] == 'X' ? GridAccent : row[i] == 'x' ? GridOn : GridOff;
}

struct GridRun {
    std::vector<GridOutputs> outs;
    std::vector<int> stepAt;  ///< playing step per sample
    std::vector<int> slotAt;  ///< playing slot per sample
    /// Samples where output `track`'s gate rises.
    std::vector<int64_t> rises(int track) const {
        std::vector<int64_t> r;
        for (size_t i = 0; i < outs.size(); ++i)
            if (outs[i].gate[(size_t)track] > 0.5f && (i == 0 || outs[i - 1].gate[(size_t)track] < 0.5f)) r.push_back((int64_t)i);
        return r;
    }
    std::vector<int64_t> pulses(float GridOutputs::*m) const {
        std::vector<int64_t> r;
        for (size_t i = 0; i < outs.size(); ++i)
            if (outs[i].*m > 0.5f) r.push_back((int64_t)i);
        return r;
    }
};

/// Runs a grid for `n` samples at 48 kHz. `drive(i, inputs, time, params)` sets what changes.
template <class Drive>
static GridRun runGrid(DrumGridDsp& d, GridParams p, int64_t n, Drive&& drive) {
    GridRun r;
    for (int64_t i = 0; i < n; ++i) {
        GridInputs in;
        GridTime t;
        drive(i, in, t, p);
        GridOutputs o;
        d.tick(p, in, t, o);
        r.outs.push_back(o);
        r.stepAt.push_back(d.playingStep());
        r.slotAt.push_back(d.playingSlot());
    }
    return r;
}

static auto gridTransport(double bpm = 120.0) {
    return [bpm](int64_t i, GridInputs&, GridTime& t, GridParams&) {
        t.running = true;
        t.started = i == 0;
        t.bpm = bpm;
        t.ppq = (double)i * bpm / 60.0 / 48000.0;
    };
}

static DrumGridDsp makeGrid(const GridBank& b) {
    DrumGridDsp d;
    d.prepare(48000.0);
    d.reset();
    d.setBank(b);
    return d;
}

static void gridTransportTiming() {
    g_test = "grid-transport";
    GridBank b;
    b.patterns[0].length = 4;
    gridRow(b.patterns[0], 0, "xxxx");
    gridRow(b.patterns[0], 1, "X.x.");
    GridParams p;
    // At every rate, track 1 rises once per step (120 BPM: a quarter is 24000 samples).
    for (int rate = 0; rate < DrumGridDsp::kNumRates; ++rate) {
        auto d = makeGrid(b);
        p.rate = rate;
        const double step = DrumGridDsp::rateBeats(rate) * 24000.0;
        const auto r = runGrid(d, p, (int64_t)(step * 6.5), gridTransport());
        const auto rises = r.rises(0);
        EXPECT(rises.size() == 7);
        for (size_t k = 0; k < rises.size(); ++k) EXPECT(std::llabs(rises[k] - (int64_t)std::ceil(step * (double)k - 1e-6)) <= 1);
    }
    // Accent and velocity: step 1 accented, step 3 plain, at 1/16 (6000 samples).
    auto d = makeGrid(b);
    p = GridParams{};
    p.velocity = 0.6f;
    const auto r = runGrid(d, p, 24000, gridTransport());
    EXPECT(r.outs[10].gate[1] > 0.5f && r.outs[10].accent[1] > 0.5f && r.outs[10].accentAny > 0.5f);
    EXPECT_NEAR(r.outs[10].velocity[1], 1.0, 1e-6);
    EXPECT(r.outs[12010].gate[1] > 0.5f && r.outs[12010].accent[1] < 0.5f && r.outs[12010].accentAny < 0.5f);
    EXPECT_NEAR(r.outs[12010].velocity[1], 0.6, 1e-6);
    EXPECT_NEAR(r.outs[18010].velocity[1], 0.6, 1e-6);  // holds over an Off step
    EXPECT(r.outs[1499].gate[0] > 0.5f && r.outs[1500].gate[0] < 0.5f);  // 25 % of 6000
    EXPECT((r.pulses(&GridOutputs::stepClock) == std::vector<int64_t>{0, 6000, 12000, 18000}));
    EXPECT(r.pulses(&GridOutputs::end).empty());
    // Stopping the transport closes the gates.
    auto s = makeGrid(b);
    p.gateLength = 1.0f;
    const auto st = runGrid(s, p, 3000, [](int64_t i, GridInputs& in, GridTime& t, GridParams& pp) {
        gridTransport()(i, in, t, pp);
        t.running = i < 2000;
    });
    EXPECT(st.outs[1999].gate[0] > 0.5f && st.outs[2000].gate[0] < 0.5f && st.outs[2000].running < 0.5f);
}

static void gridTempoAndClock() {
    g_test = "grid-tempo-clock";
    GridBank b;
    gridRow(b.patterns[0], 0, "xxxxxxxxxxxxxxxx");
    GridParams p;
    p.source = GridTempo;
    p.tempo = 120.0f;
    {  // No transport needed; 1/16 at 120 BPM is 6000 samples.
        auto d = makeGrid(b);
        const auto r = runGrid(d, p, 30000, [](int64_t, GridInputs&, GridTime&, GridParams&) {});
        EXPECT((r.rises(0) == std::vector<int64_t>{0, 6000, 12000, 18000, 24000}));
    }
    {  // A tempo sweep never skips or doubles a step.
        auto d = makeGrid(b);
        const auto r = runGrid(d, p, 480000, [](int64_t i, GridInputs&, GridTime&, GridParams& pp) {
            pp.tempo = (float)(120.0 + 100.0 * std::sin((double)i / 30000.0));
        });
        int last = -1, bad = 0;
        for (size_t i = 0; i < r.stepAt.size(); ++i)
            if (r.stepAt[i] != last) {
                if (last >= 0 && r.stepAt[i] != (last + 1) % 16) ++bad;
                last = r.stepAt[i];
            }
        EXPECT(bad == 0);
    }
    // Clock: 24 PPQN at 1/16 is 6 pulses per step; "per step" ignores Rate.
    for (int ppqn : {0, 3}) {
        auto d = makeGrid(b);
        p.ppqn = ppqn;
        const auto r = runGrid(d, p, 12100, [](int64_t i, GridInputs& in, GridTime&, GridParams&) {
            in.clockPatched = true;
            in.clock = i % 500 == 0 ? 1.0f : 0.0f;
        });
        const auto want = ppqn == 0 ? std::vector<int64_t>{0, 500, 1000} : std::vector<int64_t>{0, 3000, 6000, 9000, 12000};
        auto got = r.pulses(&GridOutputs::stepClock);
        if (ppqn == 0) got.resize(3);
        EXPECT(got == want);
    }
    bool exact = false;
    EXPECT(DrumGridDsp::pulsesPerStep(2, 8, &exact) == 1 && !exact);  // 4 PPQN at 1/16T
    EXPECT(DrumGridDsp::pulsesPerStep(4, 7, &exact) == 12 && exact);  // 48 PPQN at 1/16
    // Swing 75 %: even steps (2, 4, …) start half a step late, in Tempo mode too.
    {
        auto d = makeGrid(b);
        p = GridParams{};
        p.source = GridTempo;
        p.swing = 0.75f;
        const auto r = runGrid(d, p, 25000, [](int64_t, GridInputs&, GridTime&, GridParams&) {});
        EXPECT((r.rises(0) == std::vector<int64_t>{0, 9000, 12000, 21000, 24000}));
    }
}

static void gridRunReset() {
    g_test = "grid-run-reset";
    GridBank b;
    gridRow(b.patterns[0], 0, "xxxxxxxxxxxxxxxx");
    GridParams p;
    p.source = GridTempo;
    // Run low: silent. Rising at 10000: step 1 at once. Falling at 22000: gates close.
    auto d = makeGrid(b);
    p.gateLength = 1.0f;
    auto r = runGrid(d, p, 30000, [](int64_t i, GridInputs& in, GridTime&, GridParams&) {
        in.runPatched = true;
        in.run = i >= 10000 && i < 22000 ? 1.0f : 0.0f;
    });
    EXPECT((r.rises(0) == std::vector<int64_t>{10000, 16001}));  // 100 %: the gate drops for a sample
    EXPECT(r.stepAt[10000] == 0 && r.stepAt[16000] == 1);
    EXPECT(r.outs[21999].gate[0] > 0.5f && r.outs[22000].gate[0] < 0.5f && r.outs[22000].running < 0.5f);
    // Clock: Reset with a pulse plays step 1.
    auto c = makeGrid(b);
    p = GridParams{};
    r = runGrid(c, p, 5100, [](int64_t i, GridInputs& in, GridTime&, GridParams&) {
        in.clockPatched = true;
        in.clock = i % 1000 == 0 ? 1.0f : 0.0f;
        in.reset = i == 3000 ? 1.0f : 0.0f;
    });
    std::vector<int> steps;
    for (int64_t at : r.pulses(&GridOutputs::stepClock)) steps.push_back(r.stepAt[(size_t)at]);
    EXPECT((steps == std::vector<int>{0, 1, 2, 0, 1, 2}));
    // Transport: Run's rising edge waits for the next boundary, which is step 1.
    auto t = makeGrid(b);
    r = runGrid(t, p, 20000, [](int64_t i, GridInputs& in, GridTime& tt, GridParams& pp) {
        gridTransport()(i, in, tt, pp);
        in.runPatched = true;
        in.run = i >= 7000 ? 1.0f : 0.0f;
    });
    EXPECT((r.rises(0) == std::vector<int64_t>{12000, 18000}));
    EXPECT(r.stepAt[12000] == 0);
}

static void gridGatesAndMutes() {
    g_test = "grid-gates";
    GridBank b;
    gridRow(b.patterns[0], 0, "xx..");
    gridRow(b.patterns[0], 1, "x...");
    gridRow(b.patterns[0], 2, "x...");
    b.patterns[0].length = 4;
    GridParams p;
    p.source = GridTempo;
    p.gateLength = 1.0f;
    // Back-to-back steps at 100 %: two rising edges.
    auto d = makeGrid(b);
    auto r = runGrid(d, p, 12000, [](int64_t, GridInputs&, GridTime&, GridParams&) {});
    EXPECT((r.rises(0) == std::vector<int64_t>{0, 6001}));
    // Mute closes a sounding gate at once; Solo plays only soloed tracks.
    auto m = makeGrid(b);
    GridBank muted = b;
    muted.mute = 1u << 1;
    r = runGrid(m, p, 6000, [&](int64_t i, GridInputs&, GridTime&, GridParams&) {
        if (i == 3000) m.setBank(muted);
    });
    EXPECT(r.outs[2999].gate[1] > 0.5f && r.outs[3000].gate[1] < 0.5f && r.outs[3000].gate[0] > 0.5f);
    GridBank solo = b;
    solo.solo = 1u << 2;
    solo.mute = 1u << 2;  // solo wins over mute
    auto s = makeGrid(solo);
    r = runGrid(s, p, 100, [](int64_t, GridInputs&, GridTime&, GridParams&) {});
    EXPECT(r.outs[10].gate[0] < 0.5f && r.outs[10].gate[1] < 0.5f && r.outs[10].gate[2] > 0.5f);
}

static void gridPatterns() {
    g_test = "grid-patterns";
    GridBank b;
    b.patterns[0].length = 4;
    gridRow(b.patterns[0], 0, "xxxx");
    b.patterns[1].length = 3;
    gridRow(b.patterns[1], 1, "xxx");
    GridParams p;
    p.source = GridTempo;
    {  // At End: chosen during step 2, switches when slot 1 wraps (step 5 = 24000).
        auto d = makeGrid(b);
        GridBank next = b;
        next.current = 1;
        const auto r = runGrid(d, p, 50000, [&](int64_t i, GridInputs&, GridTime&, GridParams&) {
            if (i == 7000) d.setBank(next);
        });
        EXPECT(r.slotAt[23999] == 0 && r.slotAt[24000] == 1 && r.stepAt[24000] == 0);
        EXPECT(r.stepAt[42000] == 0);  // slot 2 is 3 steps long
        EXPECT((r.pulses(&GridOutputs::end) == std::vector<int64_t>{24000, 42000}));
        EXPECT(r.rises(1).front() == 24000 && r.rises(0).back() == 18000);
    }
    {  // Immediate: the next step, keeping the position modulo the new length.
        auto d = makeGrid(b);
        p.switchMode = GridImmediate;
        GridBank next = b;
        next.current = 1;
        const auto r = runGrid(d, p, 20000, [&](int64_t i, GridInputs&, GridTime&, GridParams&) {
            if (i == 7000) d.setBank(next);
        });
        EXPECT(r.slotAt[11999] == 0 && r.slotAt[12000] == 1 && r.stepAt[12000] == 2);
        EXPECT(r.stepAt[18000] == 0);
    }
    {  // The Pattern input: 0..1 → slots 1..16, only read at the end; an empty slot is silent.
        EXPECT(DrumGridDsp::slotFor(0.0f) == 0 && DrumGridDsp::slotFor(0.07f) == 1 && DrumGridDsp::slotFor(1.0f) == 15);
        auto d = makeGrid(b);
        p.switchMode = GridAtEnd;
        const auto r = runGrid(d, p, 30000, [](int64_t i, GridInputs& in, GridTime&, GridParams&) {
            in.patternPatched = true;
            in.pattern = i < 5000 ? 0.0f : (i < 6000 ? 0.07f : 0.5f);  // a blip to slot 2, then slot 9
        });
        EXPECT(r.slotAt[24000] == 8);
        bool any = false;
        for (size_t i = 24000; i < r.outs.size(); ++i) any = any || r.outs[i].gate[0] > 0.5f || r.outs[i].gate[1] > 0.5f;
        EXPECT(!any);
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
    filterAliasing();
    lfoBasics();
    filterAlgorithms();
    seqScales();
    seqTransport();
    seqClock();
    seqDirections();
    seqTies();
    seqVariation();
    seqNoHangingNotes();
    gridTransportTiming();
    gridTempoAndClock();
    gridRunReset();
    gridGatesAndMutes();
    gridPatterns();
    noise();
    drums();
    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all DSP tests passed\n");
    return 0;
}
