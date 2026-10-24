// SPDX-License-Identifier: GPL-3.0-only
#include "SpectralBlendDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cstdint>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

struct Run {
    SpectralBlendDsp dsp;
    SpectralBlendParams p;
    std::vector<float> out;
    explicit Run(int sizeIndex = 2) {
        dsp.prepare(kSr);
        dsp.setSize(SpectralBlendDsp::sizeFor(sizeIndex));
    }
    template <class A, class B>
    void render(int n, A&& a, B&& b) {
        for (int i = 0; i < n; ++i) out.push_back(dsp.tick(a(i), b(i), p));
    }
    std::vector<float> tail(int n) const { return std::vector<float>(out.end() - n, out.end()); }
};

static float noiseAt(uint32_t& s) {
    s = s * 1664525u + 1013904223u;
    return ((float)(s >> 8) / 8388608.0f - 1.0f);
}
static float sine(double hz, int i, float amp = 0.5f) { return amp * (float)std::sin(2.0 * kPi * hz * i / kSr); }

static void identityIsADelay() {
    TEST("magnitude A + phase A is A delayed by one FFT size");
    for (int idx : {0, 1, 2, 3}) {
        Run r(idx);
        r.p.magnitude = 0.0f;
        r.p.phase = 0.0f;
        uint32_t s = 1;
        std::vector<float> in;
        r.render(40000, [&](int) { const float v = 0.3f * noiseAt(s); in.push_back(v); return v; }, [](int) { return 0.0f; });
        const int lat = SpectralBlendDsp::sizeFor(idx);
        double err = 0.0;
        for (int i = 20000; i < 40000; ++i) err = std::max(err, (double)std::fabs(r.out[(size_t)i] - in[(size_t)(i - lat)]));
        EXPECT(err < 2e-3);
    }
}

static void secondInputTakesOver() {
    TEST("magnitude B + phase B is B delayed");
    Run r;
    r.p.magnitude = 1.0f;
    r.p.phase = 1.0f;
    uint32_t s = 2;
    std::vector<float> b;
    r.render(40000, [](int i) { return sine(300.0, i); }, [&](int) { const float v = 0.3f * noiseAt(s); b.push_back(v); return v; });
    double err = 0.0;
    for (int i = 20000; i < 40000; ++i) err = std::max(err, (double)std::fabs(r.out[(size_t)i] - b[(size_t)(i - 2048)]));
    EXPECT(err < 2e-3);
}

static void crossSynthesis() {
    TEST("magnitude of a tone with the phase of noise: a pitched, noisy cloud around the tone");
    Run r;
    r.p.magnitude = 0.0f;
    r.p.phase = 1.0f;
    uint32_t s = 3;
    r.render(48000, [](int i) { return sine(1000.0, i); }, [&](int) { return 0.4f * noiseAt(s); });
    const auto t = r.tail(16384);
    const double at = bleep::test::magnitudeAt(t, 1000.0, kSr), far = bleep::test::magnitudeAt(t, 6000.0, kSr);
    EXPECT(at > 8.0 * far);
    EXPECT(bleep::test::rms(t) > 0.05);
    EXPECT(bleep::test::allFinite(r.out));
}

static void magnitudeMorph() {
    TEST("the magnitude morph moves the level of a bin from A to B");
    Run r;
    r.p.magnitude = 0.5f;
    r.p.phase = 0.0f;
    r.render(48000, [](int i) { return sine(1000.0, i, 0.5f); }, [](int i) { return sine(1000.0, i, 0.1f); });
    const double half = bleep::test::magnitudeAt(r.tail(16384), 1000.0, kSr);
    Run a;
    a.p.magnitude = 0.0f;
    a.p.phase = 0.0f;
    a.render(48000, [](int i) { return sine(1000.0, i, 0.5f); }, [](int i) { return sine(1000.0, i, 0.1f); });
    const double full = bleep::test::magnitudeAt(a.tail(16384), 1000.0, kSr);
    EXPECT_NEAR(half / full, 0.6, 0.06);  // linear: (0.5 + 0.1) / 2 over 0.5
    Run g;
    g.p.magnitude = 0.5f;
    g.p.phase = 0.0f;
    g.p.geometric = true;
    g.render(48000, [](int i) { return sine(1000.0, i, 0.5f); }, [](int i) { return sine(1000.0, i, 0.1f); });
    EXPECT_NEAR(bleep::test::magnitudeAt(g.tail(16384), 1000.0, kSr) / full, std::sqrt(0.2), 0.06);  // geometric mean
}

static void tiltBiasesAcrossFrequency() {
    TEST("tilt: low bins follow A and high bins follow B");
    auto ratio = [](float tilt) {
        Run r;
        r.p.magnitude = 1.0f;  // B's level…
        r.p.phase = 0.0f;
        r.p.tilt = tilt;
        r.p.pivotHz = 1200.0f;
        auto a = [](int i) { return sine(300.0, i, 0.4f) + sine(4000.0, i, 0.4f); };
        auto b = [](int i) { return sine(300.0, i, 0.08f) + sine(4000.0, i, 0.08f); };
        r.render(48000, a, b);
        const auto t = r.tail(16384);
        return bleep::test::magnitudeAt(t, 300.0, kSr) / bleep::test::magnitudeAt(t, 4000.0, kSr);
    };
    EXPECT_NEAR(ratio(0.0f), 1.0, 0.1);
    EXPECT(ratio(1.0f) > 3.5);    // 0.4 / 0.08 = 5 at the extremes
    EXPECT(ratio(-1.0f) < 0.3);
}

static void blurWidensPartials() {
    TEST("blur spreads a partial over its neighbours");
    auto side = [](float blur) {
        Run r;
        r.p.magnitude = 0.0f;
        r.p.phase = 0.0f;
        r.p.blur = blur;
        r.render(48000, [](int i) { return sine(2000.0, i); }, [](int) { return 0.0f; });
        const auto t = r.tail(16384);
        return bleep::test::magnitudeAt(t, 2000.0, kSr);
    };
    EXPECT(side(1.0f) < 0.8 * side(0.0f));
}

static void gateRemovesQuietPartials() {
    TEST("spectral gate removes components under the threshold and keeps loud ones");
    Run r;
    r.p.magnitude = 0.0f;
    r.p.phase = 0.0f;
    r.p.gateDb[0] = r.p.gateDb[1] = r.p.gateDb[2] = -30.0f;
    r.render(48000, [](int i) { return sine(1000.0, i, 0.5f) + sine(2500.0, i, 0.5f * 0.01f); }, [](int) { return 0.0f; });
    const auto t = r.tail(16384);
    EXPECT(bleep::test::magnitudeAt(t, 1000.0, kSr) > 0.2);
    EXPECT(bleep::test::magnitudeAt(t, 2500.0, kSr) < 0.0005);
    Run inv;
    inv.p.magnitude = 0.0f;
    inv.p.phase = 0.0f;
    inv.p.invertGate = true;
    inv.p.gateDb[0] = inv.p.gateDb[1] = inv.p.gateDb[2] = -30.0f;
    inv.render(48000, [](int i) { return sine(1000.0, i, 0.5f) + sine(2500.0, i, 0.5f * 0.01f); }, [](int) { return 0.0f; });
    const auto u = inv.tail(16384);
    EXPECT(bleep::test::magnitudeAt(u, 1000.0, kSr) < 0.02);
    EXPECT(bleep::test::magnitudeAt(u, 2500.0, kSr) > 0.001);
}

static void freezeHoldsASound() {
    TEST("freeze: the sound goes on after the input stops");
    Run r;
    r.p.magnitude = 0.0f;
    r.p.phase = 0.0f;
    r.render(24000, [](int i) { return sine(800.0, i) + sine(1210.0, i, 0.3f); }, [](int) { return 0.0f; });
    r.p.freeze = true;
    r.render(48000, [](int) { return 0.0f; }, [](int) { return 0.0f; });
    const auto t = r.tail(24000);
    EXPECT(bleep::test::rms(t) > 0.15);
    EXPECT(bleep::test::magnitudeAt(t, 800.0, kSr) > 0.15);
    EXPECT(bleep::test::allFinite(r.out));
    r.p.freeze = false;
    r.render(24000, [](int) { return 0.0f; }, [](int) { return 0.0f; });
    EXPECT(bleep::test::rms(r.tail(8000)) < 0.01);  // released: back to silence
}

static void smearLingers() {
    TEST("smear makes a short burst ring on");
    auto tailLevel = [](float smear) {
        Run r;
        r.p.magnitude = 0.0f;
        r.p.phase = 0.0f;
        r.p.smear = smear;
        r.render(6000, [](int i) { return sine(1500.0, i); }, [](int) { return 0.0f; });
        r.render(30000, [](int) { return 0.0f; }, [](int) { return 0.0f; });
        return bleep::test::rms(r.tail(8000));
    };
    EXPECT(tailLevel(0.0f) < 0.001);
    EXPECT(tailLevel(0.7f) > 0.01);
}

static void mixAndLevel() {
    TEST("level scales and mix 0 passes A (delayed)");
    Run r;
    r.p.mix = 0.0f;
    r.p.level = 0.5f;
    r.render(24000, [](int i) { return sine(500.0, i, 0.8f); }, [](int) { return 0.0f; });
    EXPECT_NEAR(bleep::test::rms(r.tail(8000)), 0.5 * 0.8 / std::sqrt(2.0), 0.01);
}

static void finiteWithAnything() {
    TEST("outputs stay finite and bounded for extreme settings");
    for (int idx : {0, 3}) {
        Run r(idx);
        r.p.magnitude = 0.7f;
        r.p.phase = 0.3f;
        r.p.tilt = -0.8f;
        r.p.geometric = true;
        r.p.blur = 1.0f;
        r.p.smear = 0.9f;
        r.p.gateDb[1] = -50.0f;
        uint32_t s = 4;
        r.render(60000, [&](int) { return 0.9f * noiseAt(s); }, [&](int) { return 0.9f * noiseAt(s); });
        r.p.freeze = true;
        r.render(30000, [&](int) { return 0.9f * noiseAt(s); }, [&](int) { return 0.0f; });
        float peak = 0.0f;
        for (float v : r.out) peak = std::max(peak, std::fabs(v));
        EXPECT(bleep::test::allFinite(r.out));
        EXPECT(peak < 20.0f);
    }
}

int main() {
    identityIsADelay();
    secondInputTakesOver();
    crossSynthesis();
    magnitudeMorph();
    tiltBiasesAcrossFrequency();
    blurWidensPartials();
    gateRemovesQuietPartials();
    freezeHoldsASound();
    smearLingers();
    mixAndLevel();
    finiteWithAnything();
    return bleep::test::finish("spectral_blend");
}
