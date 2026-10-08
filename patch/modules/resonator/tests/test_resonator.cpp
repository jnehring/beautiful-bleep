// SPDX-License-Identifier: MIT
// Resonator: tuning, decay, structure tables, position, anti-aliasing,
// round robin, input onsets, levels and stability
// (specs/modules/resonator.md §8).
#include "ResonatorDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace bleep;
using patch::ResonatorDsp;
using patch::ResonatorModel;
using patch::ResonatorParams;

static double cents(double hz, double ref) { return 1200.0 * std::log2(hz / ref); }

/// Runs `n` samples, re-setting the params every sub-block like the module.
struct Rig {
    ResonatorDsp d;
    ResonatorParams p;
    double sr;
    int phase = 0;
    explicit Rig(const ResonatorParams& params, double sampleRate = 48000.0) : p(params), sr(sampleRate) {
        d.prepare(sampleRate);
        d.set(p);
    }
    ResonatorDsp::Frame tick(float in = 0.0f, float pitch = 0.0f) {
        if (phase == 0) d.set(p);
        phase = (phase + 1) % ResonatorDsp::kSub;
        return d.tick(in, pitch);
    }
    std::vector<float> run(int n, float in = 0.0f, float pitch = 0.0f, bool mix = true) {
        std::vector<float> y;
        y.reserve((size_t)n);
        for (int i = 0; i < n; ++i) {
            const auto f = tick(in, pitch);
            y.push_back(mix ? f.odd + f.even : f.odd);
        }
        return y;
    }
};

/// The frequency of the strongest component within ±25 cents of `ref`.
static double peakHz(const std::vector<float>& y, double ref, double sr) {
    double lo = ref * std::exp2(-25.0 / 1200.0), hi = ref * std::exp2(25.0 / 1200.0);
    for (int it = 0; it < 60; ++it) {
        const double a = lo + (hi - lo) * 0.382, b = lo + (hi - lo) * 0.618;
        if (test::magnitudeAt(y, a, sr) > test::magnitudeAt(y, b, sr)) hi = b;
        else lo = a;
    }
    return 0.5 * (lo + hi);
}

static void tuning() {
    TEST("tuning");
    for (double sr : {44100.0, 48000.0, 96000.0})
        for (ResonatorModel m : {ResonatorModel::Modal, ResonatorModel::String})
            for (float semis : {-36.0f, 0.0f, 36.0f}) {
                ResonatorParams p;
                p.model = m;
                p.structure = 0.0f;
                p.damping = 0.3f;
                p.brightness = 0.3f;
                p.position = 0.2f;
                p.frequency = semis;
                Rig r(p, sr);
                r.d.strum(0.0f);
                r.run((int)(0.05 * sr));
                const auto y = r.run((int)(semis < 0.0f ? 2.0 * sr : 0.5 * sr));
                const double f0 = 261.6255653 * std::exp2(semis / 12.0);
                const double c = cents(peakHz(y, f0, sr), f0);
                if (std::fabs(c) > 2.0) std::printf("  model %d, %.0f Hz at %.0f: %.2f cents\n", (int)m, f0, sr, c);
                EXPECT_NEAR(c, 0.0, 2.0);
            }
}

static void decay() {
    TEST("decay");
    const double sr = 48000.0;
    for (ResonatorModel m : {ResonatorModel::Modal, ResonatorModel::String, ResonatorModel::Sympathetic}) {
        ResonatorParams p;
        p.model = m;
        p.structure = m == ResonatorModel::Sympathetic ? 0.2f : 0.0f;  // fifths: one string at f0
        p.damping = 0.5f;
        p.brightness = 0.8f;
        p.position = 0.2f;
        Rig r(p, sr);
        r.d.strum(0.0f);
        r.run((int)(0.1 * sr));
        const auto a = r.run((int)(0.2 * sr));
        r.run((int)(0.3 * sr));
        const auto b = r.run((int)(0.2 * sr));
        const double ma = test::magnitudeAt(a, 261.6255653, sr), mb = test::magnitudeAt(b, 261.6255653, sr);
        const double t60 = 0.5 * 60.0 / (20.0 * std::log10(ma / mb));
        std::printf("  model %d: T60 %.3f s (formula %.3f s)\n", (int)m, t60, patch::resonator::t60(0.5f));
        EXPECT_NEAR(t60 / patch::resonator::t60(0.5f), 1.0, 0.1);
    }
}

static void structure() {
    TEST("structure tables");
    auto ratios = [](float s, uint64_t seed) {
        ResonatorParams p;
        p.structure = s;
        p.seed = seed;
        p.modes = 64;
        Rig r(p);
        r.d.strum(0.0f);
        r.tick();
        std::vector<float> out;
        for (int k = 0; k < 64; ++k) out.push_back(r.d.bank(0).ratio(k));
        return out;
    };
    const auto h = ratios(0.0f, 1), bar = ratios(0.5f, 1), plate = ratios(0.75f, 1);
    for (int k = 0; k < 64; ++k) {
        EXPECT_NEAR(h[(size_t)k], k + 1.0, 1e-4);
        EXPECT_NEAR(bar[(size_t)k], dsp::modal::barRatio(k + 1), 1e-3);
        EXPECT_NEAR(plate[(size_t)k], dsp::modal::kPlateRatios[k], 1e-4);
    }
    EXPECT_NEAR(bar[1], 2.756, 1e-3);
    EXPECT_NEAR(plate[1], 1.5933, 1e-3);
    EXPECT(ratios(1.0f, 5) == ratios(1.0f, 5));
    EXPECT(ratios(1.0f, 5) != ratios(1.0f, 6));
}

static void position() {
    TEST("position 50 % cancels the even partials");
    const double sr = 48000.0;
    for (ResonatorModel m : {ResonatorModel::Modal, ResonatorModel::String}) {
        ResonatorParams p;
        p.model = m;
        p.structure = 0.0f;
        p.position = 0.5f;
        p.brightness = 1.0f;
        p.damping = 0.3f;
        p.frequency = -12.0f;
        Rig r(p, sr);
        r.d.strum(0.0f);
        r.run(4800);
        const auto y = r.run(48000, 0.0f, 0.0f, m == ResonatorModel::Modal);
        const double f0 = 261.6255653 / 2.0;
        const double db = 20.0 * std::log10(test::magnitudeAt(y, 2.0 * f0, sr) / test::magnitudeAt(y, f0, sr));
        std::printf("  model %d: 2nd partial %.1f dB below the fundamental\n", (int)m, -db);
        EXPECT(db < -30.0);
    }
}

static void antiAliasing() {
    TEST("anti-aliasing");
    for (double sr : {44100.0, 48000.0}) {
        ResonatorParams p;
        p.modes = 64;
        p.structure = 0.5f;
        Rig r(p, sr);
        r.d.strum(0.0f);
        for (float semis = 0.0f; semis <= 48.0f; semis += 0.25f) {
            r.p.frequency = semis;
            r.run(ResonatorDsp::kSub);
            const auto& b = r.d.bank(0);
            for (int k = 0; k < b.activeModes(); ++k) EXPECT(b.modeHz(k) < 0.45 * sr);
        }
    }
}

static void roundRobin() {
    TEST("round robin");
    ResonatorParams p;
    p.polyphony = 4;
    p.damping = 0.2f;
    Rig r(p);
    const float pitches[5] = {0.0f, 0.25f, 0.5f, 0.75f, 1.0f};
    const int expect[5] = {1, 2, 3, 0, 1};
    for (int s = 0; s < 5; ++s) {
        r.d.strum(pitches[s]);
        EXPECT(r.d.activeVoice() == expect[s]);
        r.run(2400, 0.0f, pitches[s]);
    }
    // Earlier voices keep the pitch they were strummed at; voice 1 took the fifth strum.
    EXPECT_NEAR(r.d.voicePitch(2), 0.25, 1e-6);
    EXPECT_NEAR(r.d.voicePitch(3), 0.5, 1e-6);
    EXPECT_NEAR(r.d.voicePitch(0), 0.75, 1e-6);
    EXPECT_NEAR(r.d.voicePitch(1), 1.0, 1e-6);
    for (int v = 0; v < 4; ++v) EXPECT(r.d.ringing(v));
    // In reaches only the active voice (after the 5 ms crossfade).
    EXPECT_NEAR(r.d.inputGain(1), 1.0, 1e-6);
    for (int v : {0, 2, 3}) EXPECT_NEAR(r.d.inputGain(v), 0.0, 1e-6);
}

static void onsets() {
    TEST("input onsets");
    ResonatorParams p;
    p.inputOnsets = true;
    p.polyphony = 4;
    Rig r(p);
    const double sr = 48000.0;
    for (int i = 0; i < (int)(2.0 * sr); ++i) {
        const int t = i % 12000;  // 4 Hz
        // A click, and a second one 10 ms later that the hold-off swallows.
        const float in = (t < 48 || (t >= 480 && t < 528)) ? 0.5f : 0.0f;
        r.tick(in);
    }
    std::printf("  strums from a 4 Hz click train over 2 s: %d\n", (int)r.d.strumCount());
    EXPECT(r.d.strumCount() == 8);
}

static void levels() {
    TEST("levels");
    const double sr = 48000.0;
    for (ResonatorModel m : {ResonatorModel::Modal, ResonatorModel::Sympathetic, ResonatorModel::String}) {
        ResonatorParams p;
        p.model = m;
        Rig a(p);
        a.d.strum(0.0f);
        float peak = 0.0f;
        for (int i = 0; i < (int)sr; ++i) {
            const auto f = a.tick();
            peak = std::max(peak, std::max(std::fabs(f.odd), std::fabs(f.even)));
        }
        Rig b(p);
        dsp::WhiteNoise n(7u);
        std::vector<float> y;
        for (int i = 0; i < (int)sr; ++i) {
            const auto f = b.tick(0.5f * n.next());  // RMS ≈ 0.29
            y.push_back(0.5f * (f.odd + f.even));
        }
        std::printf("  model %d: strum peak %.2f, noise in (rms 0.29) → rms %.3f\n", (int)m, peak,
                    test::rms(y, 24000));
        EXPECT(peak > 0.2f && peak < 1.0f);
        EXPECT(test::rms(y, 24000) > 0.05 && test::rms(y, 24000) < 1.0);
    }
}

static void stability() {
    TEST("stability and sleep");
    const double sr = 48000.0;
    for (ResonatorModel m : {ResonatorModel::Modal, ResonatorModel::Sympathetic, ResonatorModel::String}) {
        ResonatorParams p;
        p.model = m;
        p.damping = 0.0f;
        p.inputGainDb = 12.0f;
        p.brightness = 1.0f;
        p.polyphony = 4;
        Rig r(p);
        dsp::WhiteNoise n(3u);
        float peak = 0.0f;
        bool finite = true;
        for (int i = 0; i < (int)(3 * sr); ++i) {
            if (i % 4800 == 0) r.d.strum((float)((i / 4800) % 5) * 0.2f);
            const auto f = r.tick(n.next());
            finite = finite && std::isfinite(f.odd) && std::isfinite(f.even);
            peak = std::max(peak, std::max(std::fabs(f.odd), std::fabs(f.even)));
        }
        EXPECT(finite);
        EXPECT(peak <= 1.0f);
        // Silence: with a short decay every voice falls asleep.
        r.p.damping = 0.9f;
        r.run((int)(3 * sr));
        for (int v = 0; v < 4; ++v) EXPECT(!r.d.ringing(v));
        const auto f = r.tick();
        EXPECT(f.odd == 0.0f && f.even == 0.0f);
    }
}

static void modelSwitch() {
    TEST("model switch dips instead of clicking");
    ResonatorParams p;
    p.damping = 0.2f;
    Rig r(p);
    r.d.strum(0.0f);
    r.run(4800);
    float prev = r.tick().odd, maxStep = 0.0f;
    r.p.model = ResonatorModel::String;
    for (int i = 0; i < 960; ++i) {
        const float y = r.tick().odd;
        maxStep = std::max(maxStep, std::fabs(y - prev));
        prev = y;
    }
    std::printf("  max step across the switch %.4f\n", maxStep);
    EXPECT(r.d.model() == ResonatorModel::String);
    EXPECT(maxStep < 0.1f);
}

int main() {
    tuning();
    decay();
    structure();
    position();
    antiAliasing();
    roundRobin();
    onsets();
    levels();
    stability();
    modelSwitch();
    return test::finish("resonator");
}
