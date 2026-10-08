// SPDX-License-Identifier: MIT
#include "dsp/Hilbert.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep::dsp;

static constexpr double kPi = 3.14159265358979323846;

// For a sine, I and Q 90° apart with equal gain trace a circle: the envelope
// √(I² + Q²) is constant. Its ripple bounds the phase error: ±ε rad of phase
// error gives about ±ε/2 relative ripple (plus any gain mismatch).
static double envelopeRipple(double hz, double sr) {
    HilbertTransformer h;
    h.prepare(sr);
    const int n = (int)(sr * 2.0);
    double lo = 1e9, hi = 0.0;
    for (int i = 0; i < n; ++i) {
        float a, b;
        h.process((float)std::sin(2.0 * kPi * hz * i / sr), a, b);
        if (i > n / 2) {
            const double e = std::sqrt((double)a * a + (double)b * b);
            lo = std::min(lo, e);
            hi = std::max(hi, e);
        }
    }
    return (hi - lo) / (hi + lo);
}

static void ninetyDegrees() {
    TEST("Hilbert pair is 90 degrees apart, 20 Hz - 20 kHz");
    for (double sr : {44100.0, 48000.0, 96000.0})
        for (double hz : {20.0, 50.0, 200.0, 1000.0, 5000.0, 12000.0, 20000.0}) {
            const double r = envelopeRipple(hz, sr);
            if (r > 0.002) std::printf("  ripple %.5f at %g Hz, fs %g\n", r, hz, sr);
            EXPECT(r < 0.002);  // < ±0.25°
        }
}

static void quadratureSign() {
    TEST("Q lags I");
    HilbertTransformer h;
    h.prepare(48000.0);
    // cos in: after settling, I ≈ cos(φ), Q ≈ sin(φ) of the same running phase,
    // so Q at a zero crossing of I (rising) is negative... check via the
    // cross product sign: I·Q' − Q·I' > 0 for a counter-clockwise rotation.
    double cross = 0.0;
    float pi = 0.0f, pq = 0.0f;
    for (int i = 0; i < 48000; ++i) {
        float a, b;
        h.process((float)std::cos(2.0 * kPi * 1000.0 * i / 48000.0), a, b);
        if (i > 24000) cross += (double)pi * b - (double)pq * a;
        pi = a;
        pq = b;
    }
    EXPECT(cross > 0.0);
}

static void shiftAndSuppress(double inHz, double shift, double minDb, double sr = 48000.0) {
    FrequencyShifter fs;
    fs.prepare(sr);
    std::vector<float> up, down;
    const int n = (int)sr;
    for (int i = 0; i < n + 4800; ++i) {
        const auto o = fs.process((float)std::sin(2.0 * kPi * inHz * i / sr), shift);
        if (i >= 4800) {
            up.push_back(o.up);
            down.push_back(o.down);
        }
    }
    using bleep::test::magnitudeAt;
    const double want = magnitudeAt(up, inHz + shift, sr), other = magnitudeAt(up, std::fabs(inHz - shift), sr);
    const double wantD = magnitudeAt(down, std::fabs(inHz - shift), sr), otherD = magnitudeAt(down, inHz + shift, sr);
    const double db = 20.0 * std::log10(want / std::max(other, 1e-12));
    const double dbD = 20.0 * std::log10(wantD / std::max(otherD, 1e-12));
    if (db < minDb || dbD < minDb) std::printf("  %g Hz shift %g: up %.1f dB, down %.1f dB\n", inHz, shift, db, dbD);
    EXPECT(db > minDb);
    EXPECT(dbD > minDb);
    EXPECT_NEAR(want, 0.5, 0.02);  // full level in the wanted sideband
}

static void sidebandSuppression() {
    TEST("single sideband: unwanted sideband suppressed");
    shiftAndSuppress(1000.0, 100.0, 40.0);
    shiftAndSuppress(100.0, 30.0, 35.0);
    shiftAndSuppress(10000.0, 100.0, 35.0);
    shiftAndSuppress(5000.0, 1500.0, 40.0, 96000.0);
    shiftAndSuppress(300.0, 200.0, 40.0, 44100.0);
}

static void movesBySomeHz() {
    TEST("frequency shifter moves a sine by the shift");
    FrequencyShifter fs;
    fs.prepare(48000.0);
    std::vector<float> up, down;
    for (int i = 0; i < 48000; ++i) {
        const auto o = fs.process((float)std::sin(2.0 * kPi * 1000.0 * i / 48000.0), 137.0);
        up.push_back(o.up);
        down.push_back(o.down);
    }
    EXPECT_NEAR(bleep::test::zeroCrossingHz(up, 48000.0, 4800), 1137.0, 0.5);
    EXPECT_NEAR(bleep::test::zeroCrossingHz(down, 48000.0, 4800), 863.0, 0.5);

    TEST("through zero: -300 Hz on 200 Hz gives 100 Hz");
    fs.reset();
    up.clear();
    for (int i = 0; i < 48000; ++i) up.push_back(fs.process((float)std::sin(2.0 * kPi * 200.0 * i / 48000.0), -300.0).up);
    EXPECT_NEAR(bleep::test::zeroCrossingHz(up, 48000.0, 4800), 100.0, 0.5);

    TEST("shift 0 passes the signal (delayed) at full level");
    fs.reset();
    up.clear();
    for (int i = 0; i < 48000; ++i) up.push_back(fs.process((float)std::sin(2.0 * kPi * 500.0 * i / 48000.0), 0.0).up);
    EXPECT_NEAR(bleep::test::rms(up, 4800), std::sqrt(0.5), 0.005);
}

static void oscillatorAccuracy() {
    TEST("quadrature oscillator table accuracy");
    double err = 0.0;
    for (int i = 0; i < 100000; ++i) {
        const double ph = i * 0.0000123456;
        float c, s;
        QuadratureOsc::lookup(ph, c, s);
        err = std::max(err, std::fabs(c - std::cos(2.0 * kPi * ph)));
        err = std::max(err, std::fabs(s - std::sin(2.0 * kPi * ph)));
    }
    EXPECT(err < 1e-6);
}

int main() {
    ninetyDegrees();
    quadratureSign();
    sidebandSuppression();
    movesBySomeHz();
    oscillatorAccuracy();
    return bleep::test::finish("hilbert");
}
