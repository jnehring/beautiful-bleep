// SPDX-License-Identifier: GPL-3.0-only
// Spectrum: the strongest partial and centroid as pitch signals, the display's level and
// frequency axis, tilt, peak line, flux triggers on onsets only, and determinism
// (doc/specs/modules/spectrum.md §8).
#include "SpectrumDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <functional>

using namespace bleep;
using patch::SpectrumDsp;
using patch::SpectrumOutputs;
using patch::SpectrumParams;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;
using Signal = std::function<double(double)>;

static int triggers = 0;
static SpectrumOutputs run(SpectrumDsp& d, const SpectrumParams& p, double from, double seconds, const Signal& x) {
    triggers = 0;
    SpectrumOutputs o;
    float prev = 0.0f;
    const int64_t n0 = (int64_t)std::llround(from * kSr), n1 = n0 + (int64_t)(seconds * kSr);
    for (int64_t n = n0; n < n1; ++n) {
        o = d.tick(p, (float)x((double)n / kSr));
        if (o.trigger > 0.5f && prev < 0.5f) ++triggers;
        prev = o.trigger;
    }
    return o;
}
static float hzOf(float pitch) { return patch::kSpectrumMiddleC * std::pow(2.0f, pitch); }
static int binOf(const SpectrumDsp& d, double hz) {
    int best = 0;
    for (int b = 0; b < patch::kSpectrumBins; ++b)
        if (std::fabs(std::log(d.binHz(b) / hz)) < std::fabs(std::log(d.binHz(best) / hz))) best = b;
    return best;
}

static void dominantFollowsSine() {
    TEST("dominant frequency");
    for (double f : {110.0, 440.0, 1000.0, 5000.0, 12000.0}) {
        SpectrumDsp d;
        d.prepare(kSr);
        SpectrumParams p;
        const auto o = run(d, p, 0.0, 1.0, [&](double t) { return 0.5 * std::sin(2 * kPi * f * t); });
        EXPECT_NEAR(hzOf(o.dominant), f, f * 0.004);
        EXPECT(d.valid());
    }
}

static void dominantPicksStrongest() {
    TEST("the stronger of two partials");
    SpectrumDsp d;
    d.prepare(kSr);
    SpectrumParams p;
    const auto o = run(d, p, 0.0, 1.0, [](double t) { return 0.2 * std::sin(2 * kPi * 300.0 * t) + 0.6 * std::sin(2 * kPi * 2000.0 * t); });
    EXPECT_NEAR(hzOf(o.dominant), 2000.0, 8.0);
    EXPECT(hzOf(o.centroid) > 1200.0 && hzOf(o.centroid) < 2100.0);
}

static void silenceInvalid() {
    TEST("silence is not a frequency");
    SpectrumDsp d;
    d.prepare(kSr);
    SpectrumParams p;
    run(d, p, 0.0, 0.5, [](double t) { return 0.5 * std::sin(2 * kPi * 440.0 * t); });
    const auto o = run(d, p, 0.5, 3.0, [](double) { return 0.0; });
    EXPECT(!d.valid());
    EXPECT(std::isfinite(o.dominant) && std::isfinite(o.centroid));
}

static void centroidRisesWithBrightness() {
    TEST("centroid");
    SpectrumDsp d1, d2;
    d1.prepare(kSr);
    d2.prepare(kSr);
    SpectrumParams p;
    auto saw = [](double f, int harmonics) {
        return [=](double t) {
            double v = 0.0;
            for (int h = 1; h <= harmonics; ++h) v += std::sin(2 * kPi * f * h * t) / h;
            return 0.3 * v;
        };
    };
    const auto dull = run(d1, p, 0.0, 1.0, saw(200.0, 4)), bright = run(d2, p, 0.0, 1.0, saw(200.0, 40));
    EXPECT(bright.centroid > dull.centroid + 0.3f);
}

static void displayLevelAndAxis() {
    TEST("display: a full-scale sine reads about 0 dB at its frequency");
    SpectrumDsp d;
    d.prepare(kSr);
    SpectrumParams p;
    p.average = 0.05f;
    run(d, p, 0.0, 1.0, [](double t) { return std::sin(2 * kPi * 1000.0 * t); });
    const int b = binOf(d, 1000.0);
    EXPECT(d.display()[(size_t)b] > -2.0f && d.display()[(size_t)b] < 1.0f);
    EXPECT(d.display()[(size_t)binOf(d, 100.0)] < -60.0f);
    EXPECT(d.display()[(size_t)binOf(d, 10000.0)] < -60.0f);
    EXPECT_NEAR(d.binHz(0), 20.0 * std::pow(std::min(20000.0, 0.95 * 24000.0) / 20.0, 0.5 / 256.0), 0.5);
}

static void tiltIsDisplayOnly() {
    TEST("tilt shifts the display, not the measurement");
    SpectrumDsp a, b;
    a.prepare(kSr);
    b.prepare(kSr);
    SpectrumParams p, q;
    q.tilt = 6.0f;
    auto tone = [](double t) { return 0.5 * std::sin(2 * kPi * 4000.0 * t); };
    const auto oa = run(a, p, 0.0, 0.6, tone), ob = run(b, q, 0.0, 0.6, tone);
    const int bin = binOf(a, 4000.0);
    EXPECT_NEAR(b.display()[(size_t)bin] - a.display()[(size_t)bin], 12.0, 0.7);  // two octaves above 1 kHz
    EXPECT_NEAR(oa.dominant, ob.dominant, 1e-4);
}

static void peakLine() {
    TEST("peak line");
    SpectrumDsp d;
    d.prepare(kSr);
    SpectrumParams p;
    p.peak = patch::PeakHold;
    p.average = 0.05f;
    run(d, p, 0.0, 0.5, [](double t) { return 0.5 * std::sin(2 * kPi * 1000.0 * t); });
    run(d, p, 0.5, 1.0, [](double) { return 0.0; });
    const int b = binOf(d, 1000.0);
    EXPECT(d.peaks()[(size_t)b] > -10.0f);
    EXPECT(d.display()[(size_t)b] < -60.0f);
    d.resetPeaks();
    EXPECT(d.peaks()[(size_t)b] < -100.0f);
    p.peak = patch::PeakFall;
    run(d, p, 1.5, 0.5, [](double t) { return 0.5 * std::sin(2 * kPi * 1000.0 * t); });
    run(d, p, 2.0, 2.0, [](double) { return 0.0; });
    EXPECT(d.peaks()[(size_t)b] < -6.0f - 20.0f);  // fell by more than 20 dB in two seconds
}

static void averaging() {
    TEST("averaging calms noise");
    auto spread = [](float avg) {
        SpectrumDsp d;
        d.prepare(kSr);
        SpectrumParams p;
        p.average = avg;
        uint32_t s = 12345;
        run(d, p, 0.0, 2.0, [&](double) { s = s * 1664525u + 1013904223u; return ((double)(s >> 8) / 8388608.0 - 1.0) * 0.3; });
        double lo = 1e9, hi = -1e9;
        for (int b = 150; b < 250; ++b) { lo = std::min(lo, (double)d.display()[(size_t)b]); hi = std::max(hi, (double)d.display()[(size_t)b]); }
        return hi - lo;
    };
    EXPECT(spread(1.0f) < spread(0.0f) * 0.6);
}

static void fluxTriggersOnOnsets() {
    TEST("flux triggers on onsets, not on a steady tone");
    SpectrumDsp d;
    d.prepare(kSr);
    SpectrumParams p;
    p.size = 1;
    p.average = 0.0f;
    run(d, p, 0.0, 1.0, [](double t) { return 0.4 * std::sin(2 * kPi * 440.0 * t); });
    EXPECT(triggers <= 1);
    // Four notes of different pitches, 0.4 s apart.
    run(d, p, 1.0, 2.4, [](double t) {
        const int k = (int)((t - 1.0) / 0.4);
        const double f = 330.0 * std::pow(2.0, k * 4 / 12.0);
        return 0.4 * std::sin(2 * kPi * f * t) * std::exp(-(t - 1.0 - k * 0.4) * 10.0);  // struck, then dying away
    });
    EXPECT(triggers >= 5 && triggers <= 7);
}

static void sensitivity() {
    TEST("sensitivity changes how many triggers");
    auto count = [](float sens) {
        SpectrumDsp d;
        d.prepare(kSr);
        SpectrumParams p;
        p.size = 1;
        p.average = 0.0f;
        p.sensitivity = sens;
        run(d, p, 0.0, 3.0, [](double t) {
            const int k = (int)(t / 0.25);
            return (0.1 + 0.3 * ((k * 7) % 3) / 2.0) * std::sin(2 * kPi * (200.0 + 90.0 * (k % 5)) * t);
        });
        return triggers;
    };
    EXPECT(count(1.0f) >= count(0.0f));
}

static void determinism() {
    TEST("same input, same outputs");
    auto render = [] {
        SpectrumDsp d;
        d.prepare(kSr);
        SpectrumParams p;
        return run(d, p, 0.0, 0.7, [](double t) { return 0.3 * std::sin(2 * kPi * 777.0 * t) + 0.2 * std::sin(2 * kPi * 123.0 * t * t); });
    };
    const auto a = render(), b = render();
    EXPECT(a.dominant == b.dominant && a.centroid == b.centroid && a.flux == b.flux);
}

int main() {
    dominantFollowsSine();
    dominantPicksStrongest();
    silenceInvalid();
    centroidRisesWithBrightness();
    displayLevelAndAxis();
    tiltIsDisplayOnly();
    peakLine();
    averaging();
    fluxTriggersOnOnsets();
    sensitivity();
    determinism();
    return test::finish("spectrum");
}
