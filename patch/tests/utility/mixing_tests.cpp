// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// mixing_tests.cpp — the signal path: Attenuverter, CV Mixer, Crossfader, Multiplier, Audio Mixer and Level Meter.

#include "utility_test.h"


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


void runMixingTests() {
    clipAndAttenuverter();
    cvMixer();
    crossfader();
    multiplier();
    audioMixer();
    levelMeter();
}
