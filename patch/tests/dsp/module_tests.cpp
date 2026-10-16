// SPDX-License-Identifier: MIT
// module_tests.cpp — small modules: Function, Random, Utility, Oscillator, ADSR, LFO and Noise.

#include "dsp_test.h"

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


void runModuleTests() {
    functionCycle();
    functionEnvelope();
    randomDeterminism();
    utilityShapes();
    oscillator();
    adsr();
    lfoBasics();
    noise();
}
