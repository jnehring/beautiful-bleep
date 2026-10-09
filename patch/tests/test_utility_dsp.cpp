// SPDX-License-Identifier: MIT
// Unit tests for the utility module cores: Attenuverter, CV Mixer, Audio
// Mixer, Multiplier, Crossfader, Logic, Quantizer, Switch, Notes to CV and
// Level Meter.
// Pure C++, like test_dsp.cpp.
#include "../modules/attenuverter/dsp/AttenuverterDsp.h"
#include "../modules/audio-mixer/dsp/AudioMixerDsp.h"
#include "../modules/crossfader/dsp/CrossfaderDsp.h"
#include "../modules/cv-mixer/dsp/CvMixerDsp.h"
#include "../modules/level-meter/dsp/LevelMeterDsp.h"
#include "../modules/logic/dsp/LogicDsp.h"
#include "../modules/multiplier/dsp/MultiplierDsp.h"
#include "../modules/notes-to-cv/dsp/NotesToCvDsp.h"
#include "../modules/quantizer/dsp/QuantizerDsp.h"
#include "../modules/switch/dsp/SwitchDsp.h"

#include <cmath>
#include <complex>
#include <cstdio>
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

constexpr double kPi = 3.14159265358979323846;

static void clipAndAttenuverter() {
    g_test = "clip";
    for (float x = -0.8f; x <= 0.8f; x += 0.05f) EXPECT(dsp::softClip(x) == x);
    for (float x = -10.0f; x <= 10.0f; x += 0.1f) EXPECT(std::fabs(dsp::softClip(x)) <= 1.0f);
    EXPECT(dsp::clip(1.5f, dsp::ClipOff) == 1.5f);
    EXPECT(dsp::clip(1.5f, dsp::ClipHard) == 1.0f);

    g_test = "attenuverter";
    const float in[4] = {0.5f, 1.0f, 0.2f, 1.0f}, scale[4] = {-1.0f, 0.0f, 2.0f, 1.0f}, offset[4] = {0.25f, 0.3f, 0.0f, 0.0f};
    AttenuverterFrame f;
    attenuverterTick(in, scale, offset, dsp::ClipOff, f);
    EXPECT_NEAR(f.out[0], -0.25, 1e-6);
    EXPECT_NEAR(f.out[1], 0.3, 1e-6);  // unpatched row: Scale + Offset with In = 1
    EXPECT_NEAR(f.out[2], 0.4, 1e-6);
    EXPECT_NEAR(f.sum, -0.25 + 0.3 + 0.4 + 1.0, 1e-6);
    const float big[4] = {1.5f, 1.5f, 1.5f, 1.5f}, one[4] = {1, 1, 1, 1}, zero[4] = {};
    attenuverterTick(big, one, zero, dsp::ClipOff, f);
    EXPECT(f.out[0] == 1.5f);
    for (int mode : {dsp::ClipSoft, dsp::ClipHard}) {
        attenuverterTick(big, one, zero, mode, f);
        for (float v : f.out) EXPECT(std::fabs(v) <= 1.0f);
        EXPECT(std::fabs(f.sum) <= 1.0f);
    }
}

static void cvMixer() {
    g_test = "cv mixer";
    const float c[4] = {0.2f, 0.3f, 0.0f, 0.0f};
    const bool active[4] = {true, true, false, false};
    EXPECT_NEAR(cvMix(c, active, CvMixSum, 0), 0.5, 1e-6);
    EXPECT_NEAR(cvMix(c, active, CvMixAverage, 0), 0.25, 1e-6);
    EXPECT_NEAR(cvMix(c, active, CvMixMax, 0), 0.3, 1e-6);
    EXPECT_NEAR(cvMix(c, active, CvMixMin, 0), 0.2, 1e-6);  // inactive zeros ignored
    const bool none[4] = {};
    EXPECT(cvMix(c, none, CvMixAverage, 0) == 0.0f);
    EXPECT(cvMix(c, none, CvMixMax, 0) == 0.0f);

    const float s[4] = {1.0f, 2.0f, 3.0f, 4.0f};
    const bool all[4] = {true, true, true, true};
    EXPECT_NEAR(cvMix(s, all, CvMixScan, 0.0f), 1.0, 1e-6);
    EXPECT_NEAR(cvMix(s, all, CvMixScan, 1.0f / 3.0f), 2.0, 1e-5);
    EXPECT_NEAR(cvMix(s, all, CvMixScan, 2.0f / 3.0f), 3.0, 1e-5);
    EXPECT_NEAR(cvMix(s, all, CvMixScan, 1.0f), 4.0, 1e-6);
    EXPECT_NEAR(cvMix(s, all, CvMixScan, 1.0f / 6.0f), 1.5, 1e-5);

    CvMixerParams p;
    p.clip = dsp::ClipOff;
    p.master = 2.0f;
    p.offset = 0.1f;
    CvMixerFrame f;
    cvMixerTick(c, active, p, f);
    EXPECT_NEAR(f.out, 1.1, 1e-6);
    EXPECT_NEAR(f.inv, -1.1, 1e-6);
    EXPECT_NEAR(f.abs, 1.1, 1e-6);
    p.clip = dsp::ClipSoft;
    cvMixerTick(c, active, p, f);
    EXPECT(f.out <= 1.0f && f.abs <= 1.0f);
}

static void crossfader() {
    g_test = "crossfader";
    float a, b;
    for (int curve : {CrossfadeEqualPower, CrossfadeLinear}) {
        crossfadeGains(0.0f, curve, a, b);
        EXPECT_NEAR(a, 1.0, 1e-6);
        EXPECT_NEAR(b, 0.0, 1e-6);
        crossfadeGains(1.0f, curve, a, b);
        EXPECT_NEAR(a, 0.0, 1e-6);
        EXPECT_NEAR(b, 1.0, 1e-6);
        crossfadeGains(1.7f, curve, a, b);  // clamped
        EXPECT_NEAR(b, 1.0, 1e-6);
    }
    crossfadeGains(0.5f, CrossfadeEqualPower, a, b);
    EXPECT_NEAR(a, 0.70711, 1e-4);
    EXPECT_NEAR(b, 0.70711, 1e-4);
    for (float f = 0.0f; f <= 1.0f; f += 0.01f) {
        crossfadeGains(f, CrossfadeEqualPower, a, b);
        EXPECT_NEAR(a * a + b * b, 1.0, 1e-5);
    }
    crossfadeGains(0.25f, CrossfadeLinear, a, b);
    EXPECT_NEAR(a, 0.75, 1e-6);
    EXPECT_NEAR(b, 0.25, 1e-6);
}

/// Magnitude of `freq` in a signal (single-bin DFT, Hann window).
static double magnitudeAt(const std::vector<float>& x, double freq, double sr) {
    std::complex<double> acc = 0.0;
    const size_t n = x.size();
    for (size_t i = 0; i < n; ++i) {
        const double w = 0.5 - 0.5 * std::cos(2.0 * kPi * (double)i / (double)(n - 1));
        acc += (double)x[i] * w * std::polar(1.0, -2.0 * kPi * freq * (double)i / sr);
    }
    return std::abs(acc) / (double)n * 4.0;
}

static void multiplier() {
    g_test = "multiplier";
    MultiplierDsp m;
    MultiplierSection s1, s2;
    MultiplierInputs in;
    float o1, o2;
    const float signs[4][2] = {{0.5f, 0.5f}, {-0.5f, 0.5f}, {0.5f, -0.5f}, {-0.5f, -0.5f}};
    for (const auto& q : signs) {
        in.x1 = q[0], in.y1 = q[1];
        m.tick(in, s1, s2, 1, o1, o2);
        EXPECT_NEAR(o1, q[0] * q[1], 1e-7);
    }
    in.x1 = 0.5f, in.y1 = 1.0f;  // Y unpatched reads 1: passes X × Gain
    s1.gain = -2.0f;
    m.tick(in, s1, s2, 1, o1, o2);
    EXPECT_NEAR(o1, -1.0, 1e-7);
    in.y2 = 0.5f;  // X2 unpatched takes Out 1
    m.tick(in, s1, s2, 1, o1, o2);
    EXPECT_NEAR(o2, -0.5, 1e-7);
    in.x2Patched = true, in.x2 = 0.25f;
    m.tick(in, s1, s2, 1, o1, o2);
    EXPECT_NEAR(o2, 0.125, 1e-7);

    g_test = "multiplier am";
    {  // Bias Y = 1: the carrier stays (AM); Bias Y = 0: suppressed (ring mod).
        const double sr = 48000.0;
        std::vector<float> am, ring;
        MultiplierSection am1, ring1;
        am1.biasY = 1.0f;
        MultiplierInputs i2;
        for (int n = 0; n < 9600; ++n) {
            i2.x1 = (float)std::sin(2.0 * kPi * 1000.0 * n / sr);
            i2.y1 = (float)std::sin(2.0 * kPi * 100.0 * n / sr);
            m.tick(i2, am1, s2, 1, o1, o2);
            am.push_back(o1);
            m.tick(i2, ring1, s2, 1, o1, o2);
            ring.push_back(o1);
        }
        EXPECT(magnitudeAt(am, 1000.0, sr) > 0.9);
        EXPECT(magnitudeAt(ring, 1000.0, sr) < 0.01);
        EXPECT(magnitudeAt(ring, 1100.0, sr) > 0.45);
    }

    g_test = "multiplier oversampling";
    {  // 18 kHz × 10 kHz at 48 kHz: the 28 kHz sum folds to 20 kHz.
        const double sr = 48000.0;
        double alias[3] = {}, diff[3] = {};
        const int factors[3] = {1, 2, 4};
        for (int k = 0; k < 3; ++k) {
            MultiplierDsp o;
            o.reset();
            std::vector<float> out;
            MultiplierInputs i2;
            MultiplierSection a, b;
            for (int n = 0; n < 4800 + 200; ++n) {
                i2.x1 = (float)std::sin(2.0 * kPi * 18000.0 * n / sr);
                i2.y1 = (float)std::sin(2.0 * kPi * 10000.0 * n / sr);
                o.tick(i2, a, b, factors[k], o1, o2);
                if (n >= 200) out.push_back(o1);  // past the filters' latency
            }
            alias[k] = magnitudeAt(out, 20000.0, sr);
            diff[k] = magnitudeAt(out, 8000.0, sr);
        }
        EXPECT(alias[0] > 0.4);
        EXPECT(alias[2] < alias[0] * 0.01);  // ≥ 40 dB lower
        EXPECT_NEAR(diff[2], diff[0], 0.02);
    }
}

static void logic() {
    g_test = "logic truth tables";
    LogicParams p;
    for (int c3 = 0; c3 < 2; ++c3)
        for (int bits = 0; bits < 8; ++bits) {
            LogicDsp l;
            l.reset();
            p.cPatched = c3 == 1;
            LogicInputs in{(float)(bits & 1), (float)((bits >> 1) & 1), (float)((bits >> 2) & 1), 0.0f, 0.0f};
            LogicFrame f;
            l.tick(in, p, f);
            const bool a = bits & 1, b = (bits >> 1) & 1, c = p.cPatched && ((bits >> 2) & 1);
            const bool all = a && b && (!p.cPatched || c), any = a || b || c, odd = (a + b + c) % 2 == 1;
            EXPECT(f.andOut == (all ? 1.0f : 0.0f));
            EXPECT(f.orOut == (any ? 1.0f : 0.0f));
            EXPECT(f.xorOut == (odd ? 1.0f : 0.0f));
            EXPECT(f.nandOut == 1.0f - f.andOut);
            EXPECT(f.norOut == 1.0f - f.orOut);
            EXPECT(f.notA == (a ? 0.0f : 1.0f));
        }

    g_test = "logic hysteresis";
    {
        LogicDsp l;
        l.reset();
        p = {};
        p.threshold = 0.0f;
        p.hysteresis = 0.1f;
        LogicFrame f;
        int rises = 0;
        for (int n = 0; n < 48000; ++n) {
            // A slow sine (2 cycles) plus a fast ripple smaller than the hysteresis.
            const float x = (float)(-std::cos(2.0 * kPi * 2.0 * n / 48000.0) + 0.04 * std::sin(2.0 * kPi * 3000.0 * n / 48000.0));
            l.tick({x, 0, 0, 0, 0}, p, f);
            rises += f.rise > 0.0f;
        }
        EXPECT(rises == 2);
    }

    g_test = "logic flip-flop";
    {
        LogicDsp l;
        l.reset();
        p = {};
        p.flipFromA = true;
        LogicFrame f;
        int ffRises = 0, aRises = 0;
        bool ff = false;
        for (int n = 0; n < 1000; ++n) {
            const float clock = (n / 10) % 2 ? 1.0f : 0.0f;
            l.tick({clock, 0, 0, 0, 0}, p, f);
            aRises += f.rise > 0.0f;
            if (f.ff > 0.5f && !ff) ++ffRises;
            ff = f.ff > 0.5f;
        }
        EXPECT(ffRises * 2 == aRises);
        // Reset wins over a toggle on the same sample.
        p.flipFromA = false;
        LogicDsp r;
        r.reset();
        r.tick({0, 0, 0, 1, 0}, p, f);
        EXPECT(f.ff == 1.0f);
        r.tick({0, 0, 0, 0, 0}, p, f);
        r.tick({0, 0, 0, 1, 1}, p, f);
        EXPECT(f.ff == 0.0f);
    }

    g_test = "logic edges";
    {
        LogicDsp l;
        l.reset();
        p = {};
        LogicFrame f;
        std::vector<int> rise, fall, change;
        for (int n = 0; n < 100; ++n) {
            const float a = n >= 10 && n < 30 ? 1.0f : 0.0f;
            const float b = n >= 20 && n < 40 ? 1.0f : 0.0f;
            l.tick({a, b, 0, 0, 0}, p, f);
            if (f.rise > 0) rise.push_back(n);
            if (f.fall > 0) fall.push_back(n);
            if (f.change > 0) change.push_back(n);
        }
        EXPECT(rise == std::vector<int>{10});
        EXPECT(fall == std::vector<int>{30});
        EXPECT((change == std::vector<int>{10, 20, 30, 40}));
    }
}

static void quantizer() {
    g_test = "quantizer ramp";
    for (const auto& scale : dsp::scales()) {
        QuantizerDsp q;
        q.prepare(48000.0);
        q.reset();
        QuantizerParams p;
        p.mask = scale.mask;
        p.hysteresis = 0.0f;
        QuantizerInputs in;
        QuantizerFrame f;
        std::vector<int> notes;
        for (int n = 0; n <= 24000; ++n) {
            in.in = -1.0f + 2.0f * (float)n / 24000.0f;
            q.tick(in, p, f);
            if (notes.empty() || notes.back() != q.note()) notes.push_back(q.note());
        }
        std::vector<int> expected;
        for (int s = -12; s <= 12; ++s)
            if (dsp::inScale(scale.mask, s)) expected.push_back(s);
        EXPECT(notes == expected);
    }

    g_test = "quantizer rounding";
    {
        const uint16_t major = dsp::scales()[1].mask;
        EXPECT(QuantizerDsp::round(1.0f, major, RoundNearest) == 0);  // tie goes down
        EXPECT(QuantizerDsp::round(1.0f, major, RoundUp) == 2);
        EXPECT(QuantizerDsp::round(3.9f, major, RoundDown) == 2);
        EXPECT(QuantizerDsp::round(4.0f, major, RoundDown) == 4);
        EXPECT(QuantizerDsp::round(5.5f, major, RoundUp) == 7);
        EXPECT(QuantizerDsp::round(-0.5f, major, RoundDown) == -1);  // B below the root
    }

    g_test = "quantizer transpose and shift";
    {
        QuantizerDsp q;
        q.prepare(48000.0);
        q.reset();
        QuantizerParams p;
        p.mask = dsp::scales()[1].mask;  // C major
        QuantizerInputs in;
        QuantizerFrame f;
        in.transpose = 1.0f / 12.0f;  // C + 1 semitone → nearest in scale: C (tie down)
        q.tick(in, p, f);
        EXPECT(q.note() == 0);
        in.transpose = 1.5f / 12.0f;  // → D
        q.tick(in, p, f);
        EXPECT(q.note() == 2);
        in.shift = 1.0f / 12.0f;  // after quantizing: D# (out of scale)
        q.tick(in, p, f);
        EXPECT_NEAR(f.out, 3.0 / 12.0, 1e-6);
    }

    g_test = "quantizer root";
    {
        QuantizerDsp q;
        q.prepare(48000.0);
        q.reset();
        QuantizerParams p;
        p.mask = dsp::scales()[1].mask;
        p.root = 4;  // E major: E F# G# A B C# D#
        QuantizerInputs in;
        QuantizerFrame f;
        in.in = 5.0f / 12.0f;  // F → nearest is E (tie with F#, goes down)
        q.tick(in, p, f);
        EXPECT(q.note() == 4);
        in.in = 7.6f / 12.0f;  // G+ → G#
        q.tick(in, p, f);
        EXPECT(q.note() == 8);
    }

    g_test = "quantizer hysteresis";
    for (float h : {0.0f, 0.1f}) {
        QuantizerDsp q;
        q.prepare(48000.0);
        q.reset();
        QuantizerParams p;
        p.hysteresis = h;  // chromatic: boundary between 0 and 1 at 0.5
        QuantizerInputs in;
        QuantizerFrame f;
        int changes = 0;
        for (int n = 0; n < 4800; ++n) {
            in.in = (0.5f + 0.05f * (float)std::sin(n * 0.05)) / 12.0f;
            q.tick(in, p, f);
            changes += f.trigger > 0.0f;
        }
        if (h == 0.0f) EXPECT(changes > 10);
        else EXPECT(changes <= 1);
    }

    g_test = "quantizer clock and gate";
    {
        QuantizerDsp q;
        q.prepare(48000.0);
        q.reset();
        QuantizerParams p;
        QuantizerInputs in;
        in.clockPatched = true;
        QuantizerFrame f;
        int triggers = 0, lowGate = 0;
        for (int n = 0; n < 4800; ++n) {
            in.in = (float)n / 4800.0f;  // rises a full octave
            in.clock = n % 1200 == 600 ? 1.0f : 0.0f;
            q.tick(in, p, f);
            triggers += f.trigger > 0.0f;
            lowGate += f.gate < 0.5f;
        }
        EXPECT(triggers == 4);       // one per clock, each a new note
        EXPECT(lowGate == 4 * 48);  // 1 ms low per change
    }
}

static void switchModule() {
    const float in[8] = {1, 2, 3, 4, 5, 6, 7, 8};
    const bool patched[8] = {true, true, true, true, true, true, true, true};
    auto make = [](SwitchDsp& s) { s.prepare(48000.0), s.reset(); };

    g_test = "switch select";
    {
        SwitchDsp s;
        make(s);
        SwitchParams p;
        p.fade = 0.0f;
        SwitchClock clk;
        SwitchFrame f;
        for (int k = 0; k < 4; ++k) {
            p.select = 0.25f * (float)k + 0.125f;  // slot centres
            s.tick(in, patched, 0.0f, clk, p, f);
            EXPECT(f.out == in[k]);
            EXPECT_NEAR(f.position, k / 3.0, 1e-6);
        }
        p.select = 0.125f;  // back from the last slot to the first: End
        s.tick(in, patched, 0.0f, clk, p, f);
        EXPECT(f.end == 1.0f && f.gate == 0.0f && f.changed == 1.0f);
        s.tick(in, patched, 0.0f, clk, p, f);
        EXPECT(f.gate == 1.0f && f.changed == 0.0f);
        // Hysteresis: 1 % past a border doesn't move the step.
        p.select = 0.2525f;
        s.tick(in, patched, 0.0f, clk, p, f);
        EXPECT(f.out == 1.0f);
        p.select = 0.26f;
        s.tick(in, patched, 0.0f, clk, p, f);
        EXPECT(f.out == 2.0f);
    }

    g_test = "switch levels";
    {
        SwitchDsp s;
        make(s);
        SwitchParams p;
        p.fade = 0.0f;
        p.level[0] = 0.5f;
        const bool none[8] = {};
        SwitchClock clk;
        SwitchFrame f;
        s.tick(in, patched, 0.0f, clk, p, f);
        EXPECT(f.out == 0.5f);  // patched: In × Level
        SwitchDsp t;
        make(t);
        t.tick(in, none, 0.0f, clk, p, f);
        EXPECT(f.out == 0.5f);  // unpatched: the Level itself
    }

    g_test = "switch split";
    for (bool hold : {false, true}) {
        SwitchDsp s;
        make(s);
        SwitchParams p;
        p.fade = 0.0f;
        p.hold = hold;
        SwitchClock clk;
        SwitchFrame f;
        s.tick(in, patched, 0.7f, clk, p, f);
        EXPECT(f.outs[0] == 0.7f && f.outs[1] == 0.0f);
        p.select = 0.6f;  // step 3
        s.tick(in, patched, 0.3f, clk, p, f);
        EXPECT(f.outs[2] == 0.3f);
        EXPECT(f.outs[0] == (hold ? 0.7f : 0.0f));
    }

    g_test = "switch orders";
    {
        auto run = [](int order, int length, int steps) {
            std::vector<int> pos;
            for (int k = 0; k <= steps; ++k) pos.push_back(SwitchDsp::stepAt(order, length, k));
            return pos;
        };
        EXPECT((run(SwitchForward, 4, 5) == std::vector<int>{0, 1, 2, 3, 0, 1}));
        EXPECT((run(SwitchBackward, 4, 5) == std::vector<int>{3, 2, 1, 0, 3, 2}));
        EXPECT((run(SwitchPingPong, 4, 7) == std::vector<int>{0, 1, 2, 3, 2, 1, 0, 1}));
        EXPECT((run(SwitchPingPong, 2, 3) == std::vector<int>{0, 1, 0, 1}));
        int r = 0, w = 0;
        for (int k = 1; k < 500; ++k) {
            const int r2 = SwitchDsp::randomMove(SwitchRandom, 8, r, k, 7);
            EXPECT(r2 != r && r2 >= 0 && r2 < 8);
            r = r2;
            const int w2 = SwitchDsp::randomMove(SwitchWalk, 5, w, k, 7);
            EXPECT(std::abs(w2 - w) == 1 && w2 >= 0 && w2 < 5);
            w = w2;
        }
    }

    g_test = "switch stepping";
    {
        SwitchDsp s;
        make(s);
        SwitchParams p;
        p.fade = 0.0f;
        SwitchClock clk;
        SwitchFrame f;
        std::vector<float> outs;
        int ends = 0;
        for (int n = 0; n < 10; ++n) {
            clk.step = 1.0f;
            s.tick(in, patched, 0.0f, clk, p, f);
            outs.push_back(f.out);
            ends += f.end > 0.0f;
            clk.step = 0.0f;
            s.tick(in, patched, 0.0f, clk, p, f);
        }
        EXPECT((outs == std::vector<float>{2, 3, 4, 1, 2, 3, 4, 1, 2, 3}));
        EXPECT(ends == 2);
        clk.step = clk.reset = 1.0f;  // Reset wins
        s.tick(in, patched, 0.0f, clk, p, f);
        EXPECT(f.out == 1.0f);
    }

    g_test = "switch transport";
    {
        // The step is a function of the song position: a loop jump lands on
        // the same step as the first pass, for every direction.
        for (int order : {SwitchForward, SwitchBackward, SwitchPingPong}) {
            SwitchDsp s;
            make(s);
            SwitchParams p;
            p.fade = 0.0f;
            p.order = order;
            p.length = 5;
            SwitchClock clk;
            clk.transport = clk.playing = true;
            SwitchFrame f;
            std::vector<float> first;
            for (int64_t k = 0; k < 12; ++k) {
                clk.tick = k;
                s.tick(in, patched, 0.0f, clk, p, f);
                first.push_back(f.out);
            }
            clk.tick = 3;  // loop back
            s.tick(in, patched, 0.0f, clk, p, f);
            EXPECT(f.out == first[3]);
            clk.playing = false;  // stopped: holds
            clk.tick = 9;
            s.tick(in, patched, 0.0f, clk, p, f);
            EXPECT(f.out == first[3]);
        }
    }

    g_test = "switch fade";
    {
        SwitchDsp s;
        make(s);
        SwitchParams p;
        p.fade = 0.002f;  // 96 samples
        p.curve = SwitchLinear;
        SwitchClock clk;
        SwitchFrame f;
        s.tick(in, patched, 0.0f, clk, p, f);
        p.select = 0.3f;  // step 2
        std::vector<float> out;
        for (int n = 0; n < 100; ++n) {
            s.tick(in, patched, 0.0f, clk, p, f);
            out.push_back(f.out);
        }
        EXPECT_NEAR(out[0], 1.0, 0.02);
        EXPECT_NEAR(out[47], 1.5, 0.02);
        EXPECT(out[96] == 2.0f && out[99] == 2.0f);

        // Interrupted fades continue from the current mix and never jump;
        // with the linear curve the gains always add up to exactly 1.
        const float ones[8] = {1, 1, 1, 1, 1, 1, 1, 1};
        for (int curve : {SwitchLinear, SwitchEqualPower}) {
            SwitchDsp t;
            make(t);
            p.curve = curve;
            float prev = 1.0f, maxStep = 0.0f, worst = 0.0f;
            for (int n = 0; n < 2000; ++n) {
                p.select = (float)((n / 30) % 4) * 0.25f + 0.1f;  // a new step every 30 samples
                t.tick(ones, patched, 0.0f, clk, p, f);
                maxStep = std::max(maxStep, std::fabs(f.out - prev));
                worst = std::max(worst, std::fabs(f.out - 1.0f));
                prev = f.out;
            }
            EXPECT(maxStep < 0.05f);
            if (curve == SwitchLinear) EXPECT(worst < 1e-5f);
        }
    }

    g_test = "switch glide";
    {
        SwitchDsp s;
        make(s);
        SwitchParams p;
        p.fade = 0.002f;
        p.glide = true;
        SwitchClock clk;
        SwitchFrame f;
        s.tick(in, patched, 0.0f, clk, p, f);
        p.select = 0.9f;  // step 4: from 1 to 4 along a line
        std::vector<float> out;
        for (int n = 0; n < 100; ++n) {
            s.tick(in, patched, 0.0f, clk, p, f);
            out.push_back(f.out);
        }
        EXPECT_NEAR(out[47], 2.5, 0.05);
        EXPECT(out[99] == 4.0f);
    }
}

static void notesToCv() {
    g_test = "notes to cv basic";
    NotesToCvParams p;
    p.retrigger = true;
    {
        NotesToCvDsp n;
        n.prepare(48000.0);
        n.reset();
        NotesToCvFrame f;
        n.noteOn(0, 64, 4.0f / 12.0f, 0.8f, p);
        n.tick(p, f);
        EXPECT_NEAR(f.pitch, 4.0 / 12.0, 1e-6);
        EXPECT(f.gate == 1.0f && f.trigger == 1.0f);
        EXPECT_NEAR(f.velocity, 0.8, 1e-6);
        n.tick(p, f);
        EXPECT(f.trigger == 0.0f);
        n.noteOff(0, 64, 0.3f, p);
        n.tick(p, f);
        EXPECT(f.gate == 0.0f);
        EXPECT_NEAR(f.pitch, 4.0 / 12.0, 1e-6);  // holds
        EXPECT_NEAR(f.release, 0.3, 1e-6);
    }

    g_test = "notes to cv priority";
    auto play = [&](int priority) {
        NotesToCvParams q = p;
        q.priority = priority;
        NotesToCvDsp n;
        n.prepare(48000.0);
        n.reset();
        NotesToCvFrame f;
        std::vector<int> active;
        n.noteOn(0, 60, 0.0f, 1.0f, q);
        active.push_back(n.activeNote());
        n.noteOn(0, 67, 7.0f / 12.0f, 1.0f, q);
        active.push_back(n.activeNote());
        n.noteOn(0, 64, 4.0f / 12.0f, 1.0f, q);
        active.push_back(n.activeNote());
        n.noteOff(0, 64, 0.0f, q);
        active.push_back(n.activeNote());
        n.noteOff(0, 60, 0.0f, q);
        active.push_back(n.activeNote());
        n.tick(q, f);
        return active;
    };
    EXPECT((play(PriorityLast) == std::vector<int>{60, 67, 64, 67, 67}));
    EXPECT((play(PriorityLowest) == std::vector<int>{60, 60, 60, 60, 67}));
    EXPECT((play(PriorityHighest) == std::vector<int>{60, 67, 67, 67, 67}));
    EXPECT((play(PriorityFirst) == std::vector<int>{60, 60, 60, 60, 67}));

    g_test = "notes to cv retrigger";
    for (bool retrigger : {true, false}) {
        NotesToCvParams q = p;
        q.retrigger = retrigger;
        NotesToCvDsp n;
        n.prepare(48000.0);
        n.reset();
        NotesToCvFrame f;
        n.noteOn(0, 60, 0.0f, 1.0f, q);
        n.tick(q, f);
        n.noteOn(0, 62, 2.0f / 12.0f, 1.0f, q);
        n.tick(q, f);
        EXPECT(f.trigger == 1.0f);
        EXPECT(f.gate == (retrigger ? 0.0f : 1.0f));
        n.tick(q, f);
        EXPECT(f.gate == 1.0f);
    }

    g_test = "notes to cv glide";
    {
        NotesToCvParams q = p;
        q.glide = 0.05f;
        q.glideLegatoOnly = true;
        NotesToCvDsp n;
        n.prepare(48000.0);
        n.reset();
        NotesToCvFrame f;
        n.noteOn(0, 60, 0.0f, 1.0f, q);
        n.tick(q, f);
        n.noteOff(0, 60, 0.0f, q);
        n.noteOn(0, 72, 1.0f, 1.0f, q);  // detached: jumps
        n.tick(q, f);
        EXPECT_NEAR(f.pitch, 1.0, 1e-6);
        n.noteOn(0, 74, 14.0f / 12.0f, 1.0f, q);  // legato: glides
        n.tick(q, f);
        EXPECT(f.pitch > 1.0f && f.pitch < 1.02f);
    }

    g_test = "notes to cv channel and release";
    {
        NotesToCvParams q = p;
        q.channel = 2;
        NotesToCvDsp n;
        n.prepare(48000.0);
        n.reset();
        NotesToCvFrame f;
        n.noteOn(0, 60, 0.0f, 1.0f, q);
        EXPECT(n.heldCount() == 0);
        n.noteOn(2, 60, 0.0f, 1.0f, q);
        n.noteOn(2, 62, 0.0f, 1.0f, q);
        n.tick(q, f);  // the retrigger gap
        n.tick(q, f);
        EXPECT(f.gate == 1.0f);
        EXPECT_NEAR(f.count, 2.0 / 16.0, 1e-6);
        n.releaseAll(q);
        n.tick(q, f);
        EXPECT(f.gate == 0.0f);
    }
}

static void audioMixer() {
    g_test = "fader";
    EXPECT(dsp::faderGain(dsp::kFaderFloorDb) == 0.0f);
    EXPECT_NEAR(dsp::faderGain(0.0f), 1.0, 1e-6);
    EXPECT_NEAR(dsp::faderGain(6.0f), 1.9953, 1e-3);

    g_test = "pan";
    float l, r;
    AudioMixerDsp::panGains(0.0f, false, l, r);
    EXPECT_NEAR(l, 0.70711, 1e-4);
    EXPECT_NEAR(r, 0.70711, 1e-4);
    AudioMixerDsp::panGains(-1.0f, false, l, r);
    EXPECT_NEAR(l, 1.0, 1e-6);
    EXPECT_NEAR(r, 0.0, 1e-6);
    for (float pan = -1.0f; pan <= 1.0f; pan += 0.05f) {
        AudioMixerDsp::panGains(pan, false, l, r);
        EXPECT_NEAR(l * l + r * r, 1.0, 1e-5);
    }
    AudioMixerDsp::panGains(0.0f, true, l, r);
    EXPECT(l == 1.0f && r == 1.0f);
    AudioMixerDsp::panGains(1.0f, true, l, r);
    EXPECT_NEAR(l, 0.0, 1e-6);
    EXPECT(r == 1.0f);

    auto settle = [](AudioMixerDsp& m, const AudioMixerInputs& in, const AudioMixerParams& p) {
        AudioMixerFrame f;
        for (int n = 0; n < 1000; ++n) m.tick(in, p, f);
        return f;
    };

    g_test = "mixer levels and mutes";
    {
        AudioMixerDsp m;
        m.prepare(48000.0);
        AudioMixerParams p;
        p.limiter = false;
        AudioMixerInputs in;
        in.l[0] = in.r[0] = 0.25f;
        in.stereo[0] = true;
        auto f = settle(m, in, p);
        EXPECT_NEAR(f.outL, 0.25, 1e-6);
        p.ch[0].levelDb = 6.0f;
        f = settle(m, in, p);
        EXPECT_NEAR(f.outL, 0.25 * 1.9953, 1e-3);
        p.ch[0].levelDb = dsp::kFaderFloorDb;
        f = settle(m, in, p);
        EXPECT(f.outL == 0.0f);
        p.ch[0].levelDb = 0.0f;
        p.ch[0].mute = true;
        f = settle(m, in, p);
        EXPECT(f.outL == 0.0f);
        p.ch[0].mute = false;
        in.muteGate[0] = true;
        f = settle(m, in, p);
        EXPECT(f.outL == 0.0f);
    }

    g_test = "mixer solo and send";
    {
        AudioMixerDsp m;
        m.prepare(48000.0);
        AudioMixerParams p;
        p.limiter = false;
        AudioMixerInputs in;
        in.l[0] = in.r[0] = 0.1f;
        in.l[1] = in.r[1] = 0.2f;
        in.stereo[0] = in.stereo[1] = true;
        p.ch[0].sendDb = 0.0f;
        p.ch[1].solo = true;
        auto f = settle(m, in, p);
        EXPECT_NEAR(f.outL, 0.2, 1e-6);   // channel 1 soloed out
        EXPECT_NEAR(f.sendL, 0.1, 1e-6);  // but its send keeps running
        p.ch[0].levelDb = -60.0f;         // post-fader send follows the fader
        f = settle(m, in, p);
        EXPECT(f.sendL == 0.0f);
        p.ch[0].preFader = true;
        f = settle(m, in, p);
        EXPECT_NEAR(f.sendL, 0.1, 1e-6);
    }

    g_test = "mixer mute ramp";
    {
        AudioMixerDsp m;
        m.prepare(48000.0);
        AudioMixerParams p;
        p.limiter = false;
        AudioMixerInputs in;
        in.l[0] = in.r[0] = 1.0f;
        in.stereo[0] = true;
        settle(m, in, p);
        p.ch[0].mute = true;
        AudioMixerFrame f;
        float prev = 1.0f, maxStep = 0.0f;
        for (int n = 0; n < 480; ++n) {
            m.tick(in, p, f);
            maxStep = std::max(maxStep, std::fabs(f.outL - prev));
            prev = f.outL;
        }
        EXPECT(f.outL == 0.0f);
        EXPECT(maxStep < 0.01f);
    }

    g_test = "limiter";
    {
        AudioMixerDsp m;
        m.prepare(48000.0);
        AudioMixerParams p;
        AudioMixerInputs in;
        AudioMixerFrame f;
        float peak = 0.0f;
        for (int n = 0; n < 48000; ++n) {
            in.l[0] = 4.0f * (float)std::sin(2.0 * kPi * 440.0 * n / 48000.0);  // +12 dB
            m.tick(in, p, f);
            peak = std::max({peak, std::fabs(f.outL), std::fabs(f.outR)});
        }
        EXPECT(peak <= PeakLimiter::kCeiling + 1e-5f);
        EXPECT(peak > 0.5f);
        EXPECT(f.level > 0.3f && f.level <= 1.0f);
        // Off is bit-exact.
        AudioMixerDsp off;
        off.prepare(48000.0);
        p.limiter = false;
        in.l[0] = 0.3f;
        in.stereo[0] = false;
        f = settle(off, in, p);
        EXPECT(f.outL == 0.3f * std::cos(0.785398163397448f));
    }
}

static void levelMeter() {
    g_test = "level scale";
    EXPECT_NEAR(levelToUnit(1.0f, -60.0f), 1.0, 1e-6);
    EXPECT_NEAR(levelToUnit(0.001f, -60.0f), 0.0, 1e-5);   // −60 dB
    EXPECT(levelToUnit(0.0f, -60.0f) == 0.0f);
    EXPECT(levelToUnit(2.0f, -60.0f) == 1.0f);
    EXPECT_NEAR(levelToUnit(0.1f, -40.0f), 0.5, 1e-5);     // −20 dB

    const double sr = 48000.0;
    g_test = "level meter rms";
    {
        LevelMeterDsp m;
        m.prepare(sr);
        LevelMeterParams p;
        p.response = 0.1f;
        LevelMeterFrame f;
        for (int n = 0; n < (int)sr; ++n) {
            const float x = (float)std::sin(2 * kPi * 1000.0 * n / sr);
            m.tick(x, 0.5f * x, p, f);
        }
        EXPECT_NEAR(f.rmsL, 0.70711, 0.01);
        EXPECT_NEAR(f.rmsR, 0.35355, 0.005);
        EXPECT_NEAR(f.level, (-3.0103 + 60.0) / 60.0, 0.003);  // the louder channel
        EXPECT(f.clip == 0.0f);
    }
    g_test = "level meter peak";
    {
        LevelMeterDsp m;
        m.prepare(sr);
        LevelMeterParams p;
        p.response = 0.5f;
        p.peakMode = true;
        LevelMeterFrame f;
        m.tick(0.0f, 0.0f, p, f);
        EXPECT(f.level == 0.0f);
        m.tick(-0.5f, 0.0f, p, f);
        EXPECT_NEAR(f.level, levelToUnit(0.5f, -60.0f), 1e-6);  // instant attack
        EXPECT(f.peakL == 0.5f);
        for (int n = 0; n < (int)(0.5 * sr) - 1; ++n) m.tick(0.0f, 0.0f, p, f);
        // 60 dB down after Response: −66 dB, below the floor.
        EXPECT(f.level == 0.0f);
        m.reset();
        m.tick(1.0f, 0.0f, p, f);
        for (int n = 0; n < (int)(0.25 * sr) - 1; ++n) m.tick(0.0f, 0.0f, p, f);
        EXPECT_NEAR(f.level, 0.5, 0.01);                    // −30 dB halfway
    }
    g_test = "level meter clip";
    {
        LevelMeterDsp m;
        m.prepare(sr);
        LevelMeterParams p;
        LevelMeterFrame f;
        m.tick(0.999f, -0.999f, p, f);
        EXPECT(f.clip == 0.0f && !f.clipped);
        m.tick(0.0f, -1.2f, p, f);
        EXPECT(f.clip == 1.0f && f.clipped);
        for (int n = 0; n < (int)(0.04 * sr); ++n) m.tick(0.0f, 0.0f, p, f);
        EXPECT(f.clip == 1.0f && !f.clipped);
        for (int n = 0; n < (int)(0.02 * sr); ++n) m.tick(0.0f, 0.0f, p, f);
        EXPECT(f.clip == 0.0f);
    }
}

int main() {
    clipAndAttenuverter();
    cvMixer();
    crossfader();
    multiplier();
    logic();
    quantizer();
    switchModule();
    notesToCv();
    audioMixer();
    levelMeter();
    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all utility DSP tests passed\n");
    return 0;
}
