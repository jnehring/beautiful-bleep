// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Vactrol cell and low-pass gate: asymmetry, slowing fall, memory, ping
// timing, response scale, LPG gain/cutoff laws.
#include "dsp/Vactrol.h"
#include "dsp/tests/TestUtil.h"

#include <cstdio>
#include <vector>

using namespace bleep;

static constexpr double kSr = 48000.0;

static dsp::Vactrol cell(dsp::VactrolCell type = dsp::VactrolCell::Classic, float scale = 1.0f) {
    dsp::Vactrol v;
    v.prepare(kSr);
    v.setCell(type);
    v.setResponse(scale);
    return v;
}

/// Samples until `pred(c)` holds, or -1.
template <typename F>
static int samplesUntil(dsp::Vactrol& v, float light, F pred, int limit = (int)(20 * kSr)) {
    for (int i = 0; i < limit; ++i)
        if (pred(v.process(light))) return i + 1;
    return -1;
}

static void asymmetry() {
    TEST("vactrol attack vs decay");
    for (auto type : {dsp::VactrolCell::Fast, dsp::VactrolCell::Classic, dsp::VactrolCell::SlowMemory}) {
        auto v = cell(type);
        const float rise = dsp::Vactrol::times(type).rise;
        const int up = samplesUntil(v, 1.0f, [](float c) { return c > 0.9f; });
        EXPECT(up > 0 && up <= (int)(5.0 * rise * kSr));
        const int down = samplesUntil(v, 0.0f, [](float c) { return c < 0.1f; });
        EXPECT(down >= 10 * up);
        std::printf("  cell %d: 0→0.9 in %.1f ms, 1→0.1 in %.1f ms\n", (int)type, up * 1000.0 / kSr, down * 1000.0 / kSr);
    }
}

static void slowingFall() {
    TEST("vactrol fall slows in the dark");
    auto v = cell();
    samplesUntil(v, 1.0f, [](float c) { return c > 0.999f; });
    samplesUntil(v, 0.0f, [](float c) { return c < 0.5f; });
    const int a = samplesUntil(v, 0.0f, [](float c) { return c < 0.25f; });
    const int b = samplesUntil(v, 0.0f, [](float c) { return c < 0.125f; });
    EXPECT(a < b);
}

/// Time for c^1.2 to fall 60 dB below its peak after a light pattern.
static double tailSeconds(dsp::Vactrol& v, int litSamples, float light = 1.0f) {
    float peak = 0.0f;
    for (int i = 0; i < litSamples; ++i) peak = std::max(peak, v.process(light));
    int n = 0;
    float c = v.value();
    for (; n < (int)(30 * kSr); ++n) {
        c = v.process(0.0f);
        peak = std::max(peak, c);
        if (std::pow(c, 1.2f) < 0.001f * std::pow(peak, 1.2f)) break;
    }
    return n / kSr;
}

static void memory() {
    TEST("vactrol memory");
    auto a = cell(), b = cell();
    const double afterPing = tailSeconds(a, (int)(0.002 * kSr));
    const double afterGate = tailSeconds(b, (int)(2.0 * kSr));
    std::printf("  tail after ping %.3f s, after 2 s gate %.3f s\n", afterPing, afterGate);
    EXPECT(afterGate > 1.3 * afterPing);
}

static void ping() {
    TEST("vactrol ping");
    auto v = cell();
    float c3 = 0.0f;
    for (int i = 0; i < (int)(0.003 * kSr); ++i) c3 = v.process(i < (int)(0.002 * kSr) ? 1.0f : 0.0f);
    std::printf("  ping: c after 3 ms %.3f\n", c3);
    EXPECT(c3 > 0.35f && c3 < 0.65f);
    auto w = cell();
    const double t = tailSeconds(w, (int)(0.002 * kSr));
    EXPECT_NEAR(t, 0.7, 0.14);
    // Two pings 50 ms apart give a higher peak than one.
    auto x = cell();
    float one = 0.0f, two = 0.0f;
    for (int i = 0; i < (int)(0.2 * kSr); ++i) one = std::max(one, x.process(i < 96 ? 1.0f : 0.0f));
    auto y = cell();
    for (int i = 0; i < (int)(0.2 * kSr); ++i) {
        const bool lit = i < 96 || (i >= 2400 && i < 2496);
        two = std::max(two, y.process(lit ? 1.0f : 0.0f));
    }
    EXPECT(two > one);
}

static void response() {
    TEST("vactrol response scale");
    EXPECT_NEAR(dsp::Vactrol::responseScale(0.0f), 0.25, 1e-6);
    EXPECT_NEAR(dsp::Vactrol::responseScale(0.5f), 1.0, 1e-6);
    EXPECT_NEAR(dsp::Vactrol::responseScale(1.0f), 4.0, 1e-5);
    auto base = cell();
    const double t1 = tailSeconds(base, 96);
    for (float scale : {0.25f, 4.0f}) {
        auto v = cell(dsp::VactrolCell::Classic, scale);
        const double t = tailSeconds(v, (int)(96 * scale));  // the flash scales with the cell
        EXPECT_NEAR(t / t1, scale, 0.1 * scale);
    }
}

static std::vector<float> sine(double hz, int n, float amp = 1.0f) {
    std::vector<float> x;
    for (int i = 0; i < n; ++i) x.push_back(amp * (float)std::sin(2.0 * 3.141592653589793 * hz * i / kSr));
    return x;
}

static void lpg() {
    TEST("low-pass gate");
    dsp::LowPassGate g;
    g.prepare(kSr);
    dsp::LowPassGate::Params p;
    // VCA: pure gain c^1.4, no spectral change.
    p.mode = dsp::LpgMode::VCA;
    g.set(p);
    for (float c : {0.1f, 0.5f, 1.0f}) {
        EXPECT_NEAR(g.process(0.7f, c), 0.7 * std::pow(c, 1.4), 1e-5);
        std::vector<float> y;
        for (float v : sine(15000.0, 4800)) y.push_back(g.process(v, c));
        EXPECT_NEAR(test::rms(y), std::pow(c, 1.4) * std::sqrt(0.5), 1e-3);
    }
    // LP: unity at DC, cutoff law.
    p.mode = dsp::LpgMode::LP;
    p.maxHz = 8000.0f;
    g.set(p);
    g.reset();
    float y = 0.0f;
    for (int i = 0; i < 48000; ++i) y = g.process(1.0f, 0.3f);
    EXPECT_NEAR(y, 1.0, 1e-3);
    EXPECT_NEAR(g.cutoffHz(1.0f), 8000.0, 1.0);
    EXPECT_NEAR(g.cutoffHz(0.0f), 30.0, 1e-3);
    EXPECT_NEAR(g.cutoffHz(0.5f), 30.0 * std::pow(8000.0 / 30.0, std::pow(0.5, 0.7)), 0.5);
    // The cutoff really is there: −3 dB at f(c) for Q 0.5 … the SVF at k = 2 gives −6 dB.
    {
        g.reset();
        std::vector<float> out;
        const double fc = g.cutoffHz(0.6f);
        for (float v : sine(fc, 48000)) out.push_back(g.process(v, 0.6f));
        EXPECT_NEAR(test::rms(out, 24000) / std::sqrt(0.5), 0.5, 0.02);
    }
    // Both: gain c^1.2, never above 1 for a full-scale sine (no resonance).
    p.mode = dsp::LpgMode::Both;
    g.set(p);
    for (float c : {0.2f, 0.8f, 1.0f, 1.2f}) {
        g.reset();
        float peak = 0.0f;
        for (float v : sine(200.0, 24000)) peak = std::max(peak, std::fabs(g.process(v, c)));
        EXPECT(peak <= 1.0f + 1e-3f);
        EXPECT_NEAR(g.gain(c), std::pow(std::min(c, 1.0f), 1.2f), 1e-5);
    }
    // Closed with no bleed: exactly silent.
    g.reset();
    float sum = 0.0f;
    for (float v : sine(200.0, 4800)) sum += std::fabs(g.process(v, 0.0f));
    EXPECT(sum == 0.0f);
    // Bleed 100 %: about −24 dB at low frequencies.
    p.bleed = 1.0f;
    g.set(p);
    g.reset();
    std::vector<float> leak;
    for (float v : sine(100.0, 48000)) leak.push_back(g.process(v, 0.0f));
    EXPECT_NEAR(20.0 * std::log10(test::rms(leak, 24000) / std::sqrt(0.5)), -24.0, 1.5);
    // Stereo channels share coefficients and stay identical for equal input.
    p.bleed = 0.0f;
    p.resonance = 0.8f;
    g.set(p);
    g.reset();
    bool same = true;
    for (float v : sine(300.0, 4800)) {
        float l = v, r = v;
        g.process(l, r, 0.7f);
        same = same && l == r;
    }
    EXPECT(same);
    // fastTan is accurate below 0.45 fs.
    for (double x = 0.01; x < 3.14159265 * 0.45; x += 0.01)
        EXPECT_NEAR(dsp::LowPassGate::fastTan((float)x) / std::tan(x), 1.0, 1e-4);
}

static void lpgStability() {
    TEST("low-pass gate stability");
    dsp::LowPassGate g;
    g.prepare(kSr);
    auto v = cell(dsp::VactrolCell::Fast, 0.25f);
    dsp::LowPassGate::Params p;
    p.resonance = 1.0f;
    p.maxHz = 20000.0f;
    g.set(p);
    bool finite = true;
    float peak = 0.0f;
    for (int i = 0; i < 4 * 48000; ++i) {
        const float light = (i / 300) % 2 ? 1.2f : 0.0f;
        const float c = v.process(light);
        const float x = (i % 97) < 48 ? 1.0f : -1.0f;
        const float y = g.process(x, c);
        finite = finite && std::isfinite(y);
        peak = std::max(peak, std::fabs(y));
    }
    EXPECT(finite);
    EXPECT(peak < 8.0f);
}

int main() {
    asymmetry();
    slowingFall();
    memory();
    ping();
    response();
    lpg();
    lpgStability();
    return bleep::test::finish("vactrol");
}
