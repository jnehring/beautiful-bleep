// SPDX-License-Identifier: GPL-3.0-only
#include "SaturatorDsp.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep::patch;
using bleep::test::magnitudeAt;
static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

static std::vector<float> run(const SaturatorParams& p, double hz, double amp, int n = 48000, uint32_t seed = 1, int skip = 9600) {
    SaturatorDsp d;
    d.prepare(kSr, seed);
    std::vector<float> y;
    for (int i = 0; i < n; ++i) {
        const float v = d.tick((float)(amp * std::sin(2.0 * kPi * hz * i / kSr)), p);
        if (i >= skip) y.push_back(v);
    }
    return y;
}

static void gainStagingKeepsLevelsComparable() {
    TEST("Drive changes the colour, not the loudness: a 0.5 signal stays near 0.5 at every drive and character");
    for (int c = 0; c < 3; ++c)
        for (float drive : {0.0f, 0.3f, 0.6f, 1.0f}) {
            SaturatorParams p;
            p.drive = drive, p.character = c, p.sag = 0.0f, p.age = 0.0f;
            const auto y = run(p, 200.0, 0.5, 24000);
            double peak = 0.0;
            for (float v : y) peak = std::max(peak, (double)std::fabs(v));
            EXPECT(peak > 0.35 && peak < 0.75);
        }
}

static void driveAddsOddHarmonics() {
    TEST("drive makes a sine richer in harmonics");
    auto ratio = [](float drive) {
        SaturatorParams p;
        p.drive = drive, p.sag = 0.0f, p.age = 0.0f;
        const auto y = run(p, 500.0, 0.5, 24000, 1, 4800);
        return magnitudeAt(y, 1500.0, kSr) / magnitudeAt(y, 500.0, kSr);
    };
    EXPECT(ratio(0.9f) > 4.0 * ratio(0.05f));
}

static void biasMakesEvenHarmonics() {
    TEST("a symmetric curve makes only odd harmonics, Bias adds even ones, and no DC comes through");
    auto h2 = [](float bias, int character) {
        SaturatorParams p;
        p.drive = 0.6f, p.bias = bias, p.sag = 0.0f, p.age = 0.0f, p.character = character;
        const auto y = run(p, 500.0, 0.5, 24000, 1, 4800);
        return magnitudeAt(y, 1000.0, kSr) / magnitudeAt(y, 500.0, kSr);
    };
    EXPECT(h2(0.0f, SatTube) < 0.002);
    EXPECT(h2(0.6f, SatTube) > 0.05);
    EXPECT(h2(0.0f, SatDiode) > 0.02);  // the diode is asymmetric by itself
    SaturatorParams p;
    p.drive = 0.6f, p.bias = 0.8f;
    const auto y = run(p, 500.0, 0.5, 48000, 1, 24000);
    double mean = 0.0;
    for (float v : y) mean += v;
    EXPECT(std::fabs(mean / (double)y.size()) < 0.005);
}

static void aliasingIsSuppressed() {
    TEST("heavy drive on a high tone leaves far less aliasing than a naive tanh");
    // 7.1 kHz: the 7th harmonic (49.7 kHz) folds to 1.7 kHz at 48 kHz, where nothing else lives.
    SaturatorParams p;
    p.drive = 1.0f, p.sag = 0.0f, p.age = 0.0f;
    p.toneHz = 20000.0f;
    const auto y = run(p, 7100.0, 0.5, 48000, 1, 4800);
    std::vector<float> naive;
    for (int i = 0; i < 43200; ++i) naive.push_back((float)std::tanh(63.0 * 0.5 * std::sin(2.0 * kPi * 7100.0 * (i + 4800) / kSr)));
    const double alias = magnitudeAt(y, 1700.0, kSr) / magnitudeAt(y, 7100.0, kSr);
    const double naiveAlias = magnitudeAt(naive, 1700.0, kSr) / magnitudeAt(naive, 7100.0, kSr);
    EXPECT(alias < 0.1 * naiveAlias);
}

static void colorIsFrequencyDependent() {
    TEST("Color + drives the highs harder, Color − the lows");
    auto h3 = [](float color, double hz) {
        SaturatorParams p;
        p.drive = 0.5f, p.color = color, p.sag = 0.0f, p.age = 0.0f;
        const auto y = run(p, hz, 0.3, 24000, 1, 4800);
        return magnitudeAt(y, 3.0 * hz, kSr) / magnitudeAt(y, hz, kSr);
    };
    EXPECT(h3(1.0f, 2500.0) > 1.3 * h3(-1.0f, 2500.0));
    EXPECT(h3(-1.0f, 120.0) > 1.3 * h3(1.0f, 120.0));
}

static void characterChangesTheSound() {
    TEST("the three characters sound different");
    auto h3 = [](int c) {
        SaturatorParams p;
        p.drive = 0.6f, p.character = c, p.sag = 0.0f, p.age = 0.0f;
        const auto y = run(p, 500.0, 0.5, 24000, 1, 4800);
        return magnitudeAt(y, 1500.0, kSr) / magnitudeAt(y, 500.0, kSr);
    };
    EXPECT(std::fabs(h3(SatTube) - h3(SatTape)) > 0.01);
    EXPECT(std::fabs(h3(SatTube) - h3(SatDiode)) > 0.01);
}

static void sagCompressesLoudPassages() {
    TEST("Sag lowers loud passages and leaves quiet ones alone");
    auto level = [](float sag, double amp) {
        SaturatorParams p;
        p.drive = 0.3f, p.sag = sag, p.age = 0.0f;
        return bleep::test::rms(run(p, 200.0, amp, 24000, 1, 12000));
    };
    EXPECT(level(1.0f, 0.9) < 0.97 * level(0.0f, 0.9));
    EXPECT(std::fabs(level(1.0f, 0.02) / level(0.0f, 0.02) - 1.0) < 0.03);
}

static void ageDriftsSlowlyAndDiffersPerSide() {
    TEST("Age makes the level wander slowly, a different way on each side; without it nothing moves");
    auto windows = [](float age, uint32_t seed) {
        SaturatorParams p;
        p.drive = 0.4f, p.age = age, p.sag = 0.0f;
        const auto y = run(p, 300.0, 0.4, 48000 * 12, seed, 0);
        std::vector<double> w;
        for (size_t s = 4800; s + 4800 <= y.size(); s += 9600)
            w.push_back(bleep::test::rms(std::vector<float>(y.begin() + (long)s, y.begin() + (long)s + 4800)));
        return w;
    };
    auto spread = [](const std::vector<double>& w) { return *std::max_element(w.begin(), w.end()) - *std::min_element(w.begin(), w.end()); };
    EXPECT(spread(windows(0.0f, 1)) < 1e-4);
    EXPECT(spread(windows(1.0f, 1)) > 3e-3);
    EXPECT(windows(1.0f, 1) != windows(1.0f, 7));
}

static void dryPathStaysInPhase() {
    TEST("Mix 0 is the input, delayed by the reported latency");
    for (int q : {0, 1}) {
        SaturatorParams p;
        p.mix = 0.0f, p.quality = q;
        const auto y = run(p, 300.0, 0.5, 9600, 1, 0);
        const double lat = SaturatorDsp::latency(q);
        double worst = 0.0;
        for (int i = 400; i < 9600; ++i) worst = std::max(worst, std::fabs((double)y[(size_t)i] - 0.5 * std::sin(2.0 * kPi * 300.0 * (i - lat) / kSr)));
        EXPECT(worst < 2e-3);
    }
}

static void staysFiniteAndBounded() {
    TEST("everything at once stays finite and bounded");
    for (int c = 0; c < 3; ++c)
        for (int q : {0, 1}) {
            SaturatorParams p;
            p.drive = 1.0f, p.bias = 1.0f, p.color = 1.0f, p.sag = 1.0f, p.age = 1.0f, p.character = c, p.quality = q;
            for (float amp : {0.01f, 1.0f, 4.0f}) {
                const auto y = run(p, 1000.0, amp, 24000, 3, 0);
                for (float v : y) EXPECT(std::isfinite(v) && std::fabs(v) < 2.5f);
            }
        }
}

int main() {
    gainStagingKeepsLevelsComparable();
    driveAddsOddHarmonics();
    biasMakesEvenHarmonics();
    aliasingIsSuppressed();
    colorIsFrequencyDependent();
    characterChangesTheSound();
    sagCompressesLoudPassages();
    ageDriftsSlowlyAndDiffersPerSide();
    dryPathStaysInPhase();
    staysFiniteAndBounded();
    return bleep::test::finish("saturator");
}
