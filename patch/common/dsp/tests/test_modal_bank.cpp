// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// ModalBank: tuning, decay, ratio tables, position, culling, stability.
#include "dsp/ModalBank.h"
#include "dsp/Noise.h"
#include "dsp/Random.h"
#include "dsp/tests/TestUtil.h"

#include <chrono>
#include <cstdio>
#include <vector>

using namespace bleep;

static double cents(double hz, double ref) { return 1200.0 * std::log2(hz / ref); }

static void tuning() {
    TEST("modal tuning");
    for (double sr : {44100.0, 48000.0, 96000.0})
        for (double f0 : {32.703, 261.626, 2093.0}) {
            dsp::ModalBank bank;
            bank.prepare(sr);
            bank.setModeCount(32);
            dsp::ModalParams p;
            p.f0Hz = (float)f0;
            p.structure = 0.0f;
            p.brightness = 0.0f;
            p.t60 = 30.0f;
            bank.set(p);
            std::vector<float> fund, mix;
            for (int i = 0; i < (int)sr; ++i) {
                const auto o = bank.process(i == 0 ? 1.0f : 0.0f);
                fund.push_back(o.fundamental);
                mix.push_back(o.mix());
            }
            EXPECT_NEAR(cents(test::zeroCrossingHz(fund, sr), f0), 0.0, 2.0);
            EXPECT_NEAR(cents(test::zeroCrossingHz(mix, sr), f0), 0.0, 2.0);
            for (int k = 1; k <= bank.activeModes(); ++k) EXPECT_NEAR(bank.modeHz(k - 1), f0 * k, f0 * k * 1e-5);
        }
}

static double measureT60(dsp::ModalBank& bank, int mode, double sr, double t0, double t1) {
    double l0 = 0.0, l1 = 0.0;
    for (int i = 0; i < (int)(t1 * sr) + 1; ++i) {
        bank.process(i == 0 ? 1.0f : 0.0f);
        if (i == (int)(t0 * sr)) l0 = bank.modeLevel(mode);
        if (i == (int)(t1 * sr)) l1 = bank.modeLevel(mode);
    }
    return 60.0 * (t1 - t0) / (20.0 * std::log10(l0 / l1));
}

static void decay() {
    TEST("modal decay");
    const double sr = 48000.0;
    for (float t60 : {0.05f, 1.2f, 8.0f}) {
        dsp::ModalBank bank;
        bank.prepare(sr);
        dsp::ModalParams p;
        p.f0Hz = 220.0f;
        p.t60 = t60;
        bank.set(p);
        const double m = measureT60(bank, 0, sr, 0.01, 0.01 + std::min(1.0, (double)t60 * 0.5));
        EXPECT_NEAR(m, t60, 0.1 * t60);
    }
    // Dark: high modes die faster; bright: almost as slowly as the fundamental.
    for (float b : {0.0f, 1.0f}) {
        dsp::ModalBank bank;
        bank.prepare(sr);
        dsp::ModalParams p;
        p.f0Hz = 220.0f;
        p.t60 = 2.0f;
        p.brightness = b;
        bank.set(p);
        const double t5 = measureT60(bank, 4, sr, 0.01, 0.5);
        if (b < 0.5f) EXPECT_NEAR(t5, 2.0 / (1.0 + 0.5 * 4.0), 0.1);
        else EXPECT_NEAR(t5, 2.0, 0.2);
    }
}

static void structure() {
    TEST("modal structure tables");
    float r[64];
    dsp::modal::structureRatios(0.0f, 1, r, 64);
    EXPECT_NEAR(r[9], 10.0, 1e-4);
    dsp::modal::structureRatios(0.25f, 1, r, 64);
    EXPECT_NEAR(r[9], 10.0 * std::sqrt(1.0 + 0.0004 * 100.0) / std::sqrt(1.0004), 1e-3);
    dsp::modal::structureRatios(0.5f, 1, r, 64);
    EXPECT_NEAR(r[1], 2.756, 1e-4);
    EXPECT_NEAR(r[4], 13.34, 1e-3);
    EXPECT_NEAR(r[9], 49.0, 1e-3);
    dsp::modal::structureRatios(0.75f, 1, r, 64);
    EXPECT_NEAR(r[1], 1.5933, 1e-4);
    EXPECT_NEAR(r[5], 2.9173, 1e-4);
    float a[64], b[64], c[64];
    dsp::modal::structureRatios(1.0f, 7, a, 64);
    dsp::modal::structureRatios(1.0f, 7, b, 64);
    dsp::modal::structureRatios(1.0f, 8, c, 64);
    bool same = true, differ = false;
    for (int i = 0; i < 64; ++i) {
        same = same && a[i] == b[i];
        differ = differ || std::fabs(a[i] - c[i]) > 1e-3f;
    }
    EXPECT(same);
    EXPECT(differ);
    // Every structure, including in-between ones, keeps ratios non-decreasing.
    for (float s = 0.0f; s <= 1.0f; s += 0.05f) {
        dsp::modal::structureRatios(s, 3, r, 64, 0.1f);
        for (int i = 1; i < 64; ++i) EXPECT(r[i] >= r[i - 1]);
        EXPECT_NEAR(r[0], 1.0, 1e-6);
    }
}

static void position() {
    TEST("modal position");
    const double sr = 48000.0;
    dsp::ModalBank bank;
    bank.prepare(sr);
    dsp::ModalParams p;
    p.f0Hz = 200.0f;
    p.structure = 0.0f;
    p.position = 0.5f;
    p.brightness = 1.0f;
    bank.set(p);
    std::vector<float> odd, even;
    for (int i = 0; i < 24000; ++i) {
        const auto o = bank.process(i == 0 ? 1.0f : 0.0f);
        odd.push_back(o.odd);
        even.push_back(o.even);
    }
    EXPECT(test::rms(even) < test::rms(odd) * 0.0316);  // −30 dB
}

static void culling() {
    TEST("modal culling");
    const double sr = 48000.0;
    dsp::ModalBank bank;
    bank.prepare(sr);
    bank.setModeCount(64);
    dsp::ModalParams p;
    p.structure = 0.0f;
    p.f0Hz = 5000.0f;
    bank.set(p);
    EXPECT(bank.activeModes() == 4);
    for (int i = 0; i < 64; ++i)
        if (bank.modeGain(i) > 0.0f) EXPECT(bank.modeHz(i) < 0.45 * sr);
    // Sweep up while ringing: nothing above 0.45 fs, nothing explodes.
    std::vector<float> y;
    p.f0Hz = 100.0f;
    bank.set(p);
    for (int i = 0; i < 48000; ++i) {
        if (i % 8 == 0) {
            p.f0Hz = 100.0f * std::exp2(8.0f * (float)i / 48000.0f);
            bank.set(p, 8);
        }
        y.push_back(bank.process(i % 4800 == 0 ? 1.0f : 0.0f).mix());
    }
    EXPECT(test::allFinite(y));
    EXPECT(test::magnitudeAt(std::vector<float>(y.end() - 4096, y.end()), 23000.0, sr) < 1e-3);
}

static void resonantGain() {
    TEST("modal resonant input");
    const double sr = 48000.0;
    dsp::ModalBank bank;
    bank.prepare(sr);
    bank.setInput(dsp::ModalBank::Input::Resonant);
    dsp::ModalParams p;
    p.f0Hz = 300.0f;
    p.t60 = 1.0f;
    p.structure = 0.0f;
    bank.set(p);
    std::vector<float> f;
    for (int i = 0; i < 96000; ++i)
        f.push_back(bank.process((float)std::sin(2.0 * 3.141592653589793 * 300.0 * i / sr)).fundamental);
    const double amp = test::rms(f, 72000) * std::sqrt(2.0);
    EXPECT_NEAR(amp, bank.modeGain(0), 0.05 * bank.modeGain(0));
}

static void stability() {
    TEST("modal stability");
    const double sr = 48000.0;
    for (int mode = 0; mode < 2; ++mode) {
        dsp::ModalBank bank;
        bank.prepare(sr);
        bank.setModeCount(64);
        bank.setInput(mode ? dsp::ModalBank::Input::Resonant : dsp::ModalBank::Input::Struck);
        dsp::WhiteNoise n(123);
        float peak = 0.0f;
        bool finite = true;
        for (int i = 0; i < 4 * 48000; ++i) {
            if (i % 8 == 0) {
                dsp::ModalParams p;
                p.f0Hz = 20.0f * std::exp2(10.0f * (float)dsp::uniform01(1, (uint64_t)i, 1));
                p.structure = (float)dsp::uniform01(1, (uint64_t)i, 2);
                p.brightness = (float)dsp::uniform01(1, (uint64_t)i, 3);
                p.t60 = 0.01f + 30.0f * (float)dsp::uniform01(1, (uint64_t)i, 4);
                p.position = (float)dsp::uniform01(1, (uint64_t)i, 5);
                p.stretch = 0.3f * ((float)dsp::uniform01(1, (uint64_t)i, 6) - 0.5f);
                bank.setSeed(i % 3);
                bank.setModeCount(i % 5 == 0 ? 16 : 64);
                bank.set(p, (i / 8) % 2 ? 8 : 0);
            }
            const float y = bank.process(mode ? n.next() : (i % 1000 == 0 ? 1.0f : 0.0f)).mix();
            finite = finite && std::isfinite(y);
            peak = std::max(peak, std::fabs(y));
        }
        EXPECT(finite);
        EXPECT(peak < (mode ? 64.0f : 200.0f));
    }
}

static void cpu() {
    const double sr = 48000.0;
    for (int modes : {16, 32, 64}) {
        dsp::ModalBank bank;
        bank.prepare(sr);
        bank.setModeCount(modes);
        dsp::ModalParams p;
        p.f0Hz = 55.0f;
        p.structure = 0.0f;
        bank.set(p);
        float acc = 0.0f;
        const int n = 480000;
        const auto t0 = std::chrono::steady_clock::now();
        for (int i = 0; i < n; ++i) {
            if (i % 32 == 0) {
                p.f0Hz = 55.0f + (float)(i % 3);
                bank.set(p, 32);
            }
            acc += bank.process(i % 9600 == 0 ? 1.0f : 0.0f).mix();
        }
        const double ns = std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - t0).count() / n;
        std::printf("  modal %d modes: %.1f ns/sample (%.2f %% of a core at 48 kHz)%s\n", modes, ns, ns * sr * 1e-7,
                    std::isfinite(acc) ? "" : " !");
    }
}

int main() {
    tuning();
    decay();
    structure();
    position();
    culling();
    resonantGain();
    stability();
    cpu();
    return test::finish("modal_bank");
}
