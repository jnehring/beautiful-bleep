// SPDX-License-Identifier: MIT
#include "FilterBankDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cstdlib>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;
static constexpr int kBands = FilterBankParams::kBands;

static double db(double g) { return 20.0 * std::log10(std::max(g, 1e-12)); }

static FilterBankOutputs allOutputs() {
    FilterBankOutputs o;
    o.band.fill(true);
    o.env.fill(true);
    return o;
}

struct Run {
    std::vector<float> sum, odd, even;
    std::array<std::vector<float>, kBands> band, env;
};

/// Renders a sine (mono input) through the bank; keeps the samples after `settle`.
static Run renderSine(const FilterBankParams& p, double hz, double amp = 0.5, int n = 24000, int settle = 9600,
                      bool sidechainIsInput = false) {
    FilterBankDsp d;
    d.prepare(kSr);
    const auto o = allOutputs();
    FilterBankFrame f;
    Run r;
    for (int i = 0; i < settle + n; ++i) {
        const float x = (float)(amp * std::sin(2.0 * kPi * hz * i / kSr));
        f.in[0] = f.in[1] = x;
        f.sidechain = sidechainIsInput ? x : 0.0f;
        d.tick(p, o, f, false);
        if (i < settle) continue;
        r.sum.push_back(f.sum[0]);
        r.odd.push_back(f.odd);
        r.even.push_back(f.even);
        for (int k = 0; k < kBands; ++k) {
            r.band[(size_t)k].push_back(f.band[(size_t)k]);
            r.env[(size_t)k].push_back(f.env[(size_t)k]);
        }
    }
    return r;
}
static void spectralTuning() {
    TEST("Spectral tuning, Shift and Spacing");
    const double table[kBands] = {55, 101.78, 188.36, 348.57, 645.05, 1193.71, 2209.05, 4088.02, 7565.21, 14000};
    FilterBankParams p;
    auto f = FilterBankDsp::frequencies(p);
    for (int k = 0; k < kBands; ++k) {
        if (std::getenv("FB_DEBUG")) std::printf("    band %d %.2f Hz\n", k + 1, f[(size_t)k]);
        EXPECT_NEAR(f[(size_t)k] / table[k], 1.0, 0.001);
    }
    EXPECT_NEAR(f[0], 55.0, 1e-9);
    EXPECT_NEAR(f[9], 14000.0, 1e-6);
    p.shift = 1.0f;
    const auto up = FilterBankDsp::frequencies(p);
    for (int k = 0; k < kBands; ++k) EXPECT_NEAR(up[(size_t)k] / f[(size_t)k], 2.0, 1e-9);
    p.shift = 0.0f;
    p.spacing = 0.5f;
    const auto half = FilterBankDsp::frequencies(p);
    const double m = std::sqrt(f[4] * f[5]);
    for (int k = 0; k < kBands; ++k) EXPECT_NEAR(std::log2(half[(size_t)k] / m), 0.5 * std::log2(f[(size_t)k] / m), 1e-9);
}

static void harmonicTuning() {
    TEST("Harmonic tuning: band k at 65.41 Hz × k");
    const auto f = FilterBankDsp::baseFrequencies(FilterBankParams::Harmonic, 0.0f, 0, 0);
    for (int k = 0; k < kBands; ++k) EXPECT_NEAR(f[(size_t)k], 65.40639 * (k + 1), 1e-3);
    const auto up = FilterBankDsp::baseFrequencies(FilterBankParams::Harmonic, 1.0f, 0, 0);
    EXPECT_NEAR(up[0], 130.8128, 1e-3);
    // Scale: C minor pentatonic from C2: C, D♯, F, G, A♯, C3, …
    const auto s = FilterBankDsp::baseFrequencies(FilterBankParams::Scale, 0.0f, 0, 12);
    const int semis[kBands] = {0, 3, 5, 7, 10, 12, 15, 17, 19, 22};
    for (int k = 0; k < kBands; ++k) EXPECT_NEAR(s[(size_t)k], 65.40639 * std::exp2(semis[k] / 12.0), 1e-3);
}

static void bandsAndNeighbours(bool steep, double minRejectDb) {
    FilterBankParams p;
    p.steep = steep;
    p.edges = false;
    const auto f = FilterBankDsp::frequencies(p);
    for (int k = 0; k < kBands; ++k) {
        const Run r = renderSine(p, f[(size_t)k]);
        const double own = db(bleep::test::magnitudeAt(r.band[(size_t)k], f[(size_t)k], kSr) / 0.25);
        if (std::fabs(own) > 0.5) std::printf("  band %d: %.2f dB\n", k + 1, own);
        EXPECT(std::fabs(own) <= 0.5);
        for (int n : {k - 1, k + 1}) {
            if (n < 0 || n >= kBands) continue;
            const double other = db(bleep::test::magnitudeAt(r.band[(size_t)n], f[(size_t)k], kSr) / 0.25);
            // Band 10's lower skirt is wider in hertz next to Nyquist.
            EXPECT(own - other >= (n == kBands - 1 ? minRejectDb - 2.5 : minRejectDb));
        }
    }
}

static void bandGains() {
    TEST("a sine at f_k: 0 dB at Band k, neighbours well below");
    bandsAndNeighbours(false, 9.0);   // 12 dB/oct, Q 2.2
    bandsAndNeighbours(true, 11.5);   // 24 dB/oct
    // Edge bands as low/high-pass: still about 0 dB at their centres.
    FilterBankParams p;
    const auto f = FilterBankDsp::frequencies(p);
    for (int k : {0, 9}) {
        const Run r = renderSine(p, f[(size_t)k]);
        EXPECT_NEAR(db(bleep::test::magnitudeAt(r.band[(size_t)k], f[(size_t)k], kSr) / 0.25), 0.0, 1.0);
    }
}

static void flatSum(bool steep, double lo, double hi) {
    FilterBankParams p;
    p.steep = steep;
    double mn = 1e9, mx = -1e9;
    for (int i = 0; i <= 40; ++i) {
        const double hz = 60.0 * std::pow(12000.0 / 60.0, i / 40.0);
        const Run r = renderSine(p, hz, 0.5, 12000, 9600);
        const double g = db(bleep::test::magnitudeAt(r.sum, hz, kSr) / 0.25);
        if (std::getenv("FB_DEBUG")) std::printf("    %8.1f Hz %6.2f dB\n", hz, g);
        mn = std::min(mn, g);
        mx = std::max(mx, g);
    }
    if (mn < lo || mx > hi) std::printf("  sum %s: %.2f … %.2f dB\n", steep ? "24" : "12", mn, mx);
    EXPECT(mn >= lo && mx <= hi);
}

static void sumIsNearlyFlat() {
    TEST("default settings: the sum is nearly flat from 60 Hz to 12 kHz");
    flatSum(false, -2.5, 3.0);
    flatSum(true, -1.0, 2.0);
}

static void oddEven() {
    TEST("Odd/Even −100 %: even bands silent; Odd + Even = the sum");
    FilterBankParams p;
    p.oddEven = -1.0f;
    const Run r = renderSine(p, 1196.0);  // band 6: even
    EXPECT(bleep::test::rms(r.band[5]) < 1e-6);
    EXPECT(bleep::test::rms(r.even) < 1e-6);
    EXPECT(bleep::test::rms(r.band[4]) > 0.01);
    p.oddEven = 0.3f;
    const Run s = renderSine(p, 700.0);
    double err = 0.0;
    for (size_t i = 0; i < s.sum.size(); ++i) err = std::max(err, (double)std::fabs(s.odd[i] + s.even[i] - s.sum[i]));
    EXPECT(err < 1e-5);
}

static void tilt() {
    TEST("Tilt +6 dB/oct");
    FilterBankParams p;
    p.tilt = 6.0f;
    FilterBankDsp d;
    d.prepare(kSr);
    FilterBankFrame f;
    const auto o = allOutputs();
    for (int i = 0; i < 4800; ++i) d.tick(p, o, f, false);
    const double expect = 6.0 * std::log2(d.frequency(9) / d.frequency(4));
    EXPECT_NEAR(db(d.effectiveGain(9) / d.effectiveGain(4)), expect, 0.05);
}

static void scanWindow() {
    TEST("Scan with Width 1 passes one band at a time, in order");
    for (int k = 0; k < kBands; ++k) {
        const float scan = (float)k / 9.0f;
        for (int n = 0; n < kBands; ++n) EXPECT_NEAR(FilterBankDsp::window(n, scan, 1.0f), n == k ? 1.0f : 0.0f, 1e-6);
    }
    for (int n = 0; n < kBands; ++n) EXPECT_NEAR(FilterBankDsp::window(n, 0.0f, 10.0f), 1.0f, 1e-6);  // Width 10: off
    // Between two bands the two share the window.
    EXPECT_NEAR(FilterBankDsp::window(3, 3.5f / 9.0f, 1.0f) + FilterBankDsp::window(4, 3.5f / 9.0f, 1.0f), 1.0f, 1e-5);
}

static void envelopes() {
    TEST("envelopes: a 1 kHz burst lights band 6; release time");
    FilterBankParams p;
    p.release = 0.08f;
    FilterBankDsp d;
    d.prepare(kSr);
    const auto o = allOutputs();
    FilterBankFrame f;
    const int burst = 9600;
    std::array<float, kBands> atEnd{};
    float relStart = 0.0f;
    int fallAt = -1;
    for (int i = 0; i < burst + 24000; ++i) {
        f.in[0] = f.in[1] = i < burst ? (float)(0.2 * std::sin(2.0 * kPi * 1000.0 * i / kSr)) : 0.0f;
        d.tick(p, o, f, false);
        if (i == burst - 1) atEnd = f.env, relStart = f.env[5];
        if (i >= burst + 48 && fallAt < 0 && f.env[5] < relStart / 2.718281828f) fallAt = i - burst;
    }
    int loudest = 0;
    for (int k = 1; k < kBands; ++k)
        if (atEnd[(size_t)k] > atEnd[(size_t)loudest]) loudest = k;
    EXPECT(loudest == 5);
    EXPECT(fallAt > 0);
    EXPECT_NEAR(fallAt / kSr, 0.08, 0.008);
}

static void vocode() {
    TEST("Vocode: silent sidechain silences, sidechain = input expands");
    FilterBankParams p;
    p.vocode = 1.0f;
    p.sidechain = true;
    const Run silent = renderSine(p, 1193.71);
    EXPECT(bleep::test::rms(silent.sum) < 1e-4);
    const Run same = renderSine(p, 1193.71, 0.5, 24000, 9600, true);
    const Run plain = renderSine(FilterBankParams{}, 1193.71);
    // Per band: the loud band (6, 1194 Hz) gets louder, the quiet ones quieter.
    EXPECT(bleep::test::rms(same.band[5]) > 1.5 * bleep::test::rms(plain.band[5]));
    EXPECT(bleep::test::rms(same.band[2]) < 0.5 * bleep::test::rms(plain.band[2]));
    EXPECT(bleep::test::rms(same.sum) > bleep::test::rms(plain.sum));
}

static void staysBelowTop() {
    TEST("no band above 0.45 fs");
    for (double sr : {44100.0, 48000.0, 96000.0}) {
        FilterBankParams p;
        p.tuning = FilterBankParams::Harmonic;
        p.pitch = 4.0f;
        p.shift = 2.0f;
        p.spacing = 2.0f;
        FilterBankDsp d;
        d.prepare(sr);
        FilterBankFrame f;
        const auto o = allOutputs();
        bool finite = true;
        for (int i = 0; i < 4800; ++i) {
            f.in[0] = f.in[1] = (float)std::sin(i * 0.37);
            d.tick(p, o, f, true);
            finite = finite && std::isfinite(f.sum[0]) && std::fabs(f.sum[0]) < 10.0f;
        }
        EXPECT(finite);
        for (int k = 0; k < kBands; ++k) EXPECT(d.frequency(k) <= 0.45 * sr + 1e-6);
    }
}

int main() {
    spectralTuning();
    harmonicTuning();
    bandGains();
    sumIsNearlyFlat();
    oddEven();
    tilt();
    scanWindow();
    envelopes();
    vocode();
    staysBelowTop();
    return bleep::test::finish("filter-bank");
}
