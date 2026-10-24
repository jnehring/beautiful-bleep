// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Wavetable banks: FFT, exact spectra, band-limited mipmaps, mip selection,
// bilinear morph, warps, factory banks and user tables.
#include "dsp/Wavetable.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <complex>
#include <cstdio>
#include <vector>

using namespace bleep::dsp;
using namespace bleep::dsp::wavetable;
using bleep::test::magnitudeAt;
using bleep::test::rms;
using bleep::test::zeroCrossingHz;

namespace {

constexpr double kSr = 48000.0;

void fftRoundTrip() {
    TEST("FFT round trip and a known bin");
    const int n = 1024;
    std::vector<std::complex<double>> x((size_t)n), y;
    for (int i = 0; i < n; ++i) x[(size_t)i] = {std::sin(0.37 * i) + 0.1 * i / n, std::cos(1.3 * i)};
    y = x;
    fft(y.data(), n, false);
    fft(y.data(), n, true);
    double err = 0.0;
    for (int i = 0; i < n; ++i) err = std::max(err, std::abs(y[(size_t)i] / (double)n - x[(size_t)i]));
    EXPECT(err < 1e-12);
    std::vector<float> c(256);
    for (int i = 0; i < 256; ++i) c[(size_t)i] = (float)(0.5 * std::sin(kTwoPi * 3 * i / 256.0));
    const Spectrum s = spectrumOfCycle(c.data(), c.size());
    EXPECT_NEAR(std::abs(s[3]), 0.5, 1e-6);
    EXPECT_NEAR(std::arg(s[3]), -0.25 * kTwoPi, 1e-6);  // a sine is −i
    EXPECT(std::abs(s[2]) < 1e-6);
}

void segmentSpectra() {
    TEST("piecewise-linear spectra are exact");
    // Rising saw 2φ − 1: S[n] = 2i / (π n).
    const Spectrum s = spectrumOfSegments({{0.0, 1.0, -1.0, 1.0}});
    for (int n : {1, 2, 7, 500, 1023}) {
        EXPECT_NEAR(s[(size_t)n].real(), 0.0, 1e-9);
        EXPECT_NEAR(s[(size_t)n].imag(), 2.0 / (3.14159265358979323846 * n), 1e-9);
    }
    // Same as the sampled function (smooth shape: triangle).
    const Spectrum a = spectrumOfSegments({{0.0, 0.5, -1.0, 1.0}, {0.5, 1.0, 1.0, -1.0}});
    const Spectrum b = spectrumOfFunction([](double p) { return p < 0.5 ? 4.0 * p - 1.0 : 3.0 - 4.0 * p; }, 1 << 15);
    for (int n = 1; n < 64; ++n) EXPECT(std::abs(a[(size_t)n] - b[(size_t)n]) < 1e-6);
    // Non-power-of-two DFT path agrees with the FFT path.
    std::vector<float> x(600);
    for (int i = 0; i < 600; ++i) x[(size_t)i] = (float)(std::sin(kTwoPi * i / 600.0) + 0.3 * std::cos(kTwoPi * 5 * i / 600.0));
    const Spectrum d = spectrumOfCycle(x.data(), x.size());
    EXPECT_NEAR(std::abs(d[1]), 1.0, 1e-5);
    EXPECT_NEAR(std::abs(d[5]), 0.3, 1e-5);
    EXPECT(std::abs(d[3]) < 1e-5);
}

/// Largest harmonic magnitude above `top` in a table, relative to the largest overall.
double energyAbove(const float* t, int size, int top) {
    std::vector<std::complex<double>> buf((size_t)size);
    for (int i = 0; i < size; ++i) buf[(size_t)i] = t[i];
    fft(buf.data(), size, false);
    double peak = 0.0, above = 0.0;
    for (int k = 1; k < size / 2; ++k) {
        const double m = std::abs(buf[(size_t)k]) * 2.0 / size;
        peak = std::max(peak, m);
        if (k > top) above = std::max(above, m);
    }
    return peak > 0.0 ? above / peak : 0.0;
}

void factoryMipmaps() {
    TEST("factory banks: every level band-limited, finite, peak ≈ 1");
    for (int b = 0; b < kNumFactoryBanks; ++b) {
        const auto& bank = factoryBank((FactoryBank)b);
        EXPECT(&bank == &factoryBank((FactoryBank)b));
        EXPECT(bank.cols() == 8 && bank.rows() == 8);
        double worst = 0.0;
        float peak = 0.0f;
        bool finite = true, silent = false;
        for (int f = 0; f < bank.frames(); ++f) {
            float framePeak = 0.0f;
            for (int i = 0; i < kSize; ++i) framePeak = std::max(framePeak, std::fabs(bank.table(f, 0)[i]));
            silent = silent || framePeak < 0.5f;
            peak = std::max(peak, framePeak);
            for (int l = 0; l < kLevels; ++l) {
                const float* t = bank.table(f, l);
                for (int i = -1; i < levelSize(l) + 3; ++i) finite = finite && std::isfinite(t[i]);
                worst = std::max(worst, energyAbove(t, levelSize(l), levelHarmonics(l)));
            }
        }
        if (worst >= 1e-5 || !finite || silent) std::printf("  bank %s: above %.2g finite %d silent %d\n",
                                                            factoryBankName((FactoryBank)b), worst, finite, silent);
        EXPECT(worst < 1e-5);  // < −100 dB
        EXPECT(finite);
        EXPECT(!silent);
        EXPECT_NEAR(peak, 1.0, 1e-4);
    }
}

void gridPointsExact() {
    TEST("grid points read exactly that frame; bilinear centre = mean of four");
    const auto& bank = factoryBank(FactoryBank::Harmonic);
    const Mip mip0{0, 0.0f};
    for (int f : {0, 9, 27, 63}) {
        const int c = f % 8, r = f / 8;
        bool exact = true;
        for (int i = 0; i < kSize; i += 7) {
            const double ph = (double)i / kSize;
            exact = exact && readXY(bank, (float)c, (float)r, ph, mip0, Interp::Cubic) == bank.table(f, 0)[i];
        }
        EXPECT(exact);
    }
    for (double ph : {0.1, 0.37, 0.8}) {
        const float centre = readXY(bank, 2.5f, 4.5f, ph, mip0, Interp::Linear);
        const float mean = 0.25f * (readFrame(bank, 4 * 8 + 2, ph, mip0, Interp::Linear) + readFrame(bank, 4 * 8 + 3, ph, mip0, Interp::Linear) +
                                    readFrame(bank, 5 * 8 + 2, ph, mip0, Interp::Linear) + readFrame(bank, 5 * 8 + 3, ph, mip0, Interp::Linear));
        EXPECT_NEAR(centre, mean, 1e-6);
    }
}

void mipSelection() {
    TEST("mip selection: in band and continuous");
    double prevPos = -1.0;
    for (double hz = 5.0; hz < 21000.0; hz *= 1.001) {
        const Mip m = selectMip(hz, kSr);
        // The brighter level never reaches past 0.45 fs.
        if (m.level > 0) EXPECT(levelHarmonics(m.level) * hz <= 0.45 * kSr * 1.0001);
        const double pos = m.level + m.frac;
        if (prevPos >= 0.0) EXPECT(pos >= prevPos - 1e-9 && pos - prevPos < 0.01);
        prevPos = pos;
    }
    EXPECT(selectMip(1.0, kSr).level == 0);
    EXPECT(selectMip(20000.0, kSr).level == kLevels - 1);
}

WavetableBank sawBank() {
    return WavetableBank::fromSpectra(1, 1, [](int, int) { return spectrumOfSegments({{0.0, 1.0, -1.0, 1.0}}); });
}

std::vector<float> play(const WavetableBank& bank, double hz, Interp interp, bool mipmapped, int n = 1 << 15, Warp warp = Warp::None,
                        float amount = 0.0f) {
    std::vector<float> y((size_t)n);
    double ph = 0.0;
    const Mip mip = mipmapped ? selectMip(hz * warpSlope(warp, amount), kSr) : Mip{0, 0.0f};
    for (auto& v : y) {
        v = readXY(bank, 0.0f, 0.0f, warpPhase(warp, ph, amount), mip, interp);
        ph += hz / kSr;
        ph -= std::floor(ph);
    }
    return y;
}

double worstAlias(const std::vector<float>& y, double hz) {
    double worst = 0.0;
    for (double f = 150.0; f < 21000.0; f += 397.0) {
        const double k = f / hz;
        if (std::fabs(k - std::round(k)) * hz < 60.0) continue;
        worst = std::max(worst, magnitudeAt(y, f, kSr));
    }
    return worst / magnitudeAt(y, hz, kSr);
}

void pitchAndAliasing() {
    TEST("pitch and aliasing");
    const auto& analog = factoryBank(FactoryBank::Analog);
    const Mip mip = selectMip(wavetable::kTwoPi, kSr);
    (void)mip;
    std::vector<float> y(48000);
    double ph = 0.0;
    const double c4 = 261.6255653005986;
    for (auto& v : y) {
        v = readXY(analog, 0.0f, 0.0f, ph, selectMip(c4, kSr), Interp::Cubic);
        ph += c4 / kSr;
        ph -= std::floor(ph);
    }
    EXPECT_NEAR(zeroCrossingHz(y, kSr) / c4, 1.0, 6e-5);  // ±0.1 cent

    const WavetableBank saw = sawBank();
    for (double hz : {440.0, 1975.5, 3520.0, 7040.0}) {
        const double mipped = worstAlias(play(saw, hz, Interp::Cubic, true), hz);
        const double raw = worstAlias(play(saw, hz, Interp::Nearest, false), hz);
        std::printf("  saw %.0f Hz: alias %.1f dB (mipmapped, cubic) vs %.1f dB (raw)\n", hz, 20 * std::log10(mipped + 1e-12),
                    20 * std::log10(raw + 1e-12));
        EXPECT(mipped < 1e-4);  // −80 dB
        EXPECT(mipped < 0.05 * raw);
    }
    // Warps: the slope-aware mip keeps the squeezed part of the cycle in band
    // (the warp's own kinks still alias a little, as on any phase distortion).
    for (Warp w : {Warp::Bend, Warp::Squash, Warp::Mirror}) {
        const double hz = 880.0;
        const double aware = worstAlias(play(saw, hz, Interp::Cubic, true, 1 << 15, w, 0.7f), hz);
        std::vector<float> y(1 << 15);
        double ph = 0.0;
        const Mip blind = selectMip(hz, kSr);
        for (auto& v : y) {
            v = readXY(saw, 0.0f, 0.0f, warpPhase(w, ph, 0.7f), blind, Interp::Cubic);
            ph += hz / kSr;
            ph -= std::floor(ph);
        }
        const double unaware = worstAlias(y, hz);
        std::printf("  warp %d at 880 Hz: alias %.1f dB (slope-aware mip) vs %.1f dB\n", (int)w, 20 * std::log10(aware + 1e-12),
                    20 * std::log10(unaware + 1e-12));
        EXPECT(aware < unaware);
    }
}

void brightnessSteps() {
    TEST("mip crossfade: RMS changes < 0.5 dB per semitone");
    const WavetableBank saw = sawBank();
    double prev = 0.0;
    double worst = 0.0;
    for (int note = 24; note <= 108; ++note) {
        const double hz = 440.0 * std::exp2((note - 69) / 12.0);
        const double r = 20.0 * std::log10(rms(play(saw, hz, Interp::Cubic, true, 8192)));
        if (note > 24) worst = std::max(worst, std::fabs(r - prev));
        prev = r;
    }
    std::printf("  worst step %.3f dB\n", worst);
    EXPECT(worst < 0.5);
}

void morphContinuity() {
    TEST("X/Y morph is continuous in every factory bank");
    for (int b = 0; b < kNumFactoryBanks; ++b) {
        const auto& bank = factoryBank((FactoryBank)b);
        const Mip mip = selectMip(200.0, kSr);
        float worst = 0.0f;
        for (double ph : {0.03, 0.26, 0.51, 0.77}) {
            float prev = readXY(bank, 0.0f, 3.3f, ph, mip, Interp::Cubic);
            for (float x = 0.001f; x <= 7.0f; x += 0.001f) {
                const float v = readXY(bank, x, 3.3f, ph, mip, Interp::Cubic);
                worst = std::max(worst, std::fabs(v - prev));
                prev = v;
            }
            prev = readXY(bank, 4.2f, 0.0f, ph, mip, Interp::Cubic);
            for (float yy = 0.001f; yy <= 7.0f; yy += 0.001f) {
                const float v = readXY(bank, 4.2f, yy, ph, mip, Interp::Cubic);
                worst = std::max(worst, std::fabs(v - prev));
                prev = v;
            }
        }
        if (worst >= 0.02f) std::printf("  bank %s: step %.4f\n", factoryBankName((FactoryBank)b), worst);
        EXPECT(worst < 0.02f);
    }
}

void warps() {
    TEST("warps: identity at 0, Squash holds, slopes");
    for (Warp w : {Warp::None, Warp::Bend, Warp::Sync, Warp::Mirror, Warp::Squash, Warp::Steps})
        for (double ph = 0.0; ph < 1.0; ph += 0.0173) EXPECT(warpPhase(w, ph, 0.0f) == ph);
    EXPECT(warpPhase(Warp::Squash, 0.5, 1.0f) == 1.0);
    EXPECT_NEAR(warpPhase(Warp::Squash, 0.05, 1.0f), 0.5, 1e-12);
    EXPECT_NEAR(warpPhase(Warp::Bend, 0.05, 1.0f), 0.5, 1e-12);
    EXPECT_NEAR(warpPhase(Warp::Mirror, 0.75, 1.0f), 0.5, 1e-12);
    EXPECT_NEAR(warpSlope(Warp::Sync, 1.0f), 8.0, 1e-12);
    EXPECT_NEAR(warpSlope(Warp::Bend, 1.0f), 10.0, 1e-9);
    // Measured slope never exceeds the reported one.
    for (Warp w : {Warp::Bend, Warp::Mirror, Warp::Squash}) {
        for (float a : {0.3f, 1.0f}) {
            double maxSlope = 0.0;
            for (double ph = 0.0; ph < 0.999; ph += 1e-4)
                maxSlope = std::max(maxSlope, std::fabs(warpPhase(w, ph + 1e-4, a) - warpPhase(w, ph, a)) / 1e-4);
            EXPECT(maxSlope <= warpSlope(w, a) * 1.001);
        }
    }
}

void userTables() {
    TEST("user tables: slicing, resampling, DC removal, normalising");
    // 3 cycles of 600 samples: a sine with DC and gain 0.4.
    std::vector<float> data(1800);
    for (size_t i = 0; i < data.size(); ++i) data[i] = (float)(0.3 + 0.4 * std::sin(kTwoPi * (double)i / 600.0));
    WavetableBank b = bankFromSamples(data.data(), data.size(), 600);
    EXPECT(b.cols() == 3 && b.rows() == 1);
    double err = 0.0, mean = 0.0;
    for (int i = 0; i < kSize; ++i) {
        err = std::max(err, std::fabs(b.table(1, 0)[i] - std::sin(kTwoPi * i / kSize)));
        mean += b.table(1, 0)[i];
    }
    EXPECT(err < 1e-4);
    EXPECT(std::fabs(mean / kSize) < 1e-6);
    // Auto: a multiple of 2048 → 2048-sample cycles; else one cycle.
    std::vector<float> two(4096), odd(1000);
    for (size_t i = 0; i < two.size(); ++i) two[i] = (float)std::sin(kTwoPi * (double)i / 2048.0 * 3.0);
    for (size_t i = 0; i < odd.size(); ++i) odd[i] = i < 500 ? 1.0f : -1.0f;
    const WavetableBank b2 = bankFromSamples(two.data(), two.size());
    EXPECT(b2.frames() == 2);
    const WavetableBank b1 = bankFromSamples(odd.data(), odd.size());
    EXPECT(b1.cols() == 1 && b1.rows() == 1);
    // A square normalised to its Gibbs peak: the plateau sits near 0.8.
    EXPECT(readXY(b1, 5.0f, 5.0f, 0.25, Mip{0, 0.0f}, Interp::Linear) > 0.7f);
    EXPECT(readXY(b1, 5.0f, 5.0f, 0.75, Mip{0, 0.0f}, Interp::Linear) < -0.7f);
    // 100 cycles → 64 frames in an 8 × 8 grid; 10 cycles → 8 × 2.
    std::vector<float> many(100 * 256);
    for (size_t i = 0; i < many.size(); ++i) many[i] = (float)std::sin(kTwoPi * (double)i / 256.0);
    EXPECT(bankFromSamples(many.data(), many.size(), 256).frames() == 64);
    const WavetableBank ten = bankFromSamples(many.data(), 10 * 256, 256);
    EXPECT(ten.cols() == 8 && ten.rows() == 2);
    EXPECT(bankFromSamples(nullptr, 0).empty());
}

}  // namespace

int main() {
    fftRoundTrip();
    segmentSpectra();
    factoryMipmaps();
    gridPointsExact();
    mipSelection();
    pitchAndAliasing();
    brightnessSteps();
    morphContinuity();
    warps();
    userTables();
    return bleep::test::finish("wavetable");
}
