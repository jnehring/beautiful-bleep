// SPDX-License-Identifier: GPL-3.0-or-later
// Dual Osc: tuning, B tracking, linear vs exponential FM, hard sync period
// and aliasing, folder transparency and bounds, stereo, determinism
// (doc/specs/modules/dual-oscillator.md §8).
#include "DualOscDsp.h"
#include "dsp/Wavetable.h"
#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <vector>

using namespace bleep;
using patch::DualOscDsp;
using patch::DualOscFrame;
using patch::DualOscParams;
using test::magnitudeAt;
using test::zeroCrossingHz;

namespace {

constexpr double kSr = 48000.0;

struct Render {
    std::vector<float> a, b, mix, outL, outR, ring, sub;
};

Render render(const DualOscParams& p, int n, int quality = 2, float fm = 0.0f, uint32_t seed = 1,
              const std::vector<int>& syncAt = {}) {
    DualOscDsp d;
    d.prepare(kSr);
    d.setOversampling(quality);
    d.resetDrift(seed);
    Render r;
    size_t next = 0;
    for (int i = 0; i < n; ++i) {
        const bool sync = next < syncAt.size() && syncAt[next] == i;
        if (sync) ++next;
        const DualOscFrame f = d.process(p, fm, 0.0f, sync);
        r.a.push_back(f.a), r.b.push_back(f.b), r.mix.push_back(f.mix), r.outL.push_back(f.outL);
        r.outR.push_back(f.outR), r.ring.push_back(f.ring), r.sub.push_back(f.sub);
    }
    return r;
}

DualOscParams quiet() {
    DualOscParams p;
    p.drift = 0.0f;
    p.shapeA = 0.0f;
    p.shapeB = 0.0f;
    return p;
}

std::vector<float> tail(const std::vector<float>& x, size_t n) { return std::vector<float>(x.end() - (long)n, x.end()); }

/// Magnitude spectrum (Blackman-Harris, −92 dB side lobes); a full-scale sine
/// peaks near 0.5. n must be a power of two.
std::vector<double> spectrum(const std::vector<float>& x) {
    const size_t n = x.size();
    std::vector<std::complex<double>> buf(n);
    double wsum = 0.0;
    for (size_t i = 0; i < n; ++i) {
        const double t = 6.283185307179586 * (double)i / (double)n;
        const double w = 0.35875 - 0.48829 * std::cos(t) + 0.14128 * std::cos(2 * t) - 0.01168 * std::cos(3 * t);
        buf[i] = w * x[i];
        wsum += w;
    }
    dsp::wavetable::fft(buf.data(), (int)n, false);
    std::vector<double> m(n / 2);
    for (size_t i = 0; i < n / 2; ++i) m[i] = std::abs(buf[i]) / wsum;
    return m;
}

/// The strongest bin that is not within `guard` bins of a harmonic of f0 (dB
/// relative to the strongest bin), below `maxHz`.
double worstNonHarmonicDb(const std::vector<float>& x, double f0, double maxHz = 20000.0, int guard = 10) {
    const auto m = spectrum(x);
    const double binHz = kSr / (double)x.size();
    double peak = 1e-30, worst = 1e-30;
    for (size_t i = 1; i < m.size(); ++i) {
        const double hz = (double)i * binHz;
        peak = std::max(peak, m[i]);
        if (hz > maxHz || hz < 20.0) continue;
        const double h = std::round(hz / f0) * f0;
        if (std::fabs(hz - h) <= guard * binHz) continue;
        worst = std::max(worst, m[i]);
    }
    return 20.0 * std::log10(worst / peak);
}

void tuning() {
    TEST("A at 0 V plays C4, B at Octave −1 plays C3, B Track off ignores Pitch");
    DualOscParams p = quiet();
    p.pitchA = 0.0f;
    p.pitchB = -1.0f;
    Render r = render(p, 96000);
    const double fa = zeroCrossingHz(r.a, kSr, 4800), fb = zeroCrossingHz(r.b, kSr, 4800);
    EXPECT(std::fabs(1200.0 * std::log2(fa / 261.6255653)) < 0.1);
    EXPECT(std::fabs(1200.0 * std::log2(fb / 130.8127827)) < 0.1);
    // Pitch +1 octave reaches A only when B doesn't track (the module adds it to pitchB).
    p.pitchA = 1.0f;
    r = render(p, 48000);
    EXPECT(std::fabs(1200.0 * std::log2(zeroCrossingHz(r.a, kSr, 4800) / 523.2511306)) < 0.1);
    EXPECT(std::fabs(1200.0 * std::log2(zeroCrossingHz(r.b, kSr, 4800) / 130.8127827)) < 0.1);
    // B Range Low: ÷ 100.
    p.pitchB = 0.0f;
    p.lowRange = true;
    r = render(p, 96000 * 2);
    EXPECT_NEAR(zeroCrossingHz(r.b, kSr, 100), 2.616, 0.01);
}

void linearFmHoldsPitch() {
    TEST("linear FM keeps the pitch, exponential FM raises it");
    DualOscParams p = quiet();
    p.pitchA = 0.0f;
    p.pitchB = 0.0f;
    p.fmDepth = 0.5f;  // through zero: 1 ± 2
    Render r = render(p, 65536);
    // Harmonic: the spectrum has energy only at multiples of fA0.
    EXPECT(worstNonHarmonicDb(tail(r.a, 32768), 261.6255653) < -70.0);
    // Slow modulator: the mean frequency of A.
    p.pitchB = (float)std::log2(200.0 / 261.6255653);
    p.lowRange = true;  // 2 Hz: four seconds are eight whole modulator cycles
    p.fmDepth = 0.2f;
    const double lin = zeroCrossingHz(render(p, 48000 * 4 + 100).a, kSr, 100);
    EXPECT(std::fabs(lin / 261.6255653 - 1.0) < 0.005);
    p.expFm = true;
    const double ex = zeroCrossingHz(render(p, 48000 * 4 + 100).a, kSr, 100);
    EXPECT(ex / 261.6255653 > 1.05);
}

void hardSync() {
    TEST("hard sync: A repeats with B's period at any A pitch; low aliasing");
    // Aliasing limits below 20 kHz (most of it sits above 15 kHz): Normal −55 dB, High −75 dB.
    for (float pa : {0.3f, 1.1f, 2.37f}) {
        DualOscParams p = quiet();
        p.shapeA = 2.0f / 3.0f;                              // saw
        p.pitchB = (float)std::log2(150.0 / 261.6255653);  // 150 Hz: period 320 samples
        p.pitchA = pa;
        p.sync = 1.0f;
        const Render r = render(p, 9600);
        double err = 0.0;
        for (size_t i = 4800; i + 320 < r.a.size(); ++i) err = std::max(err, (double)std::fabs(r.a[i + 320] - r.a[i]));
        EXPECT(err < 2e-3);
    }
    // Aliasing of a synced saw (B at C3), Normal and High.
    for (int q : {2, 4})
        for (float pa : {1.0f, 2.37f, 3.0f}) {
            DualOscParams p = quiet();
            p.shapeA = 2.0f / 3.0f;
            p.pitchB = -1.0f;
            p.pitchA = pa;
            p.sync = 1.0f;
            const Render r = render(p, 65536 + 4096, q);
            const double db = worstNonHarmonicDb(tail(r.a, 65536), 130.8127827);
            if (db > (q == 2 ? -55.0 : -75.0)) std::printf("  sync alias at %dx, pitch %.2f: %.1f dB\n", q, pa, db);
            EXPECT(db < (q == 2 ? -55.0 : -75.0));
        }
}

void folder() {
    TEST("Fold 0 passes the mix; folded output bounded; DC blocked");
    DualOscParams p = quiet();
    p.balance = 0.0f;
    Render r = render(p, 48000);
    dsp::fold::DcBlocker dc;
    dc.prepare(kSr);
    double err = 0.0;
    for (size_t i = 0; i < r.mix.size(); ++i) {
        const float m = dc.process(r.mix[i]);
        if (i > 4800) err = std::max(err, (double)std::fabs(r.outL[i] - m));
    }
    EXPECT(err < 0.015);  // the folder's ADAA adds half an oversampled sample
    for (float fold : {0.3f, 0.7f, 1.0f})
        for (float sym : {-0.8f, 0.0f, 0.6f}) {
            p = quiet();
            p.shapeA = 2.0f / 3.0f;
            p.pitchA = (float)std::log2(300.0 / 261.6255653);  // 160 samples
            p.pitchB = p.pitchA - 1.0f;                        // 320 samples: one second is 150 cycles
            p.fold = fold;
            p.symmetry = sym;
            r = render(p, 96000);
            double peak = 0.0, mean = 0.0;
            for (size_t i = 48000; i < r.outL.size(); ++i) {
                peak = std::max(peak, (double)std::fabs(r.outL[i]));
                mean += r.outL[i];
            }
            mean /= 48000.0;
            EXPECT(peak <= 1.3);  // folded corners overshoot a little once band-limited
            EXPECT(std::fabs(mean) < 1e-3);
            EXPECT(test::allFinite(r.outL));
        }
}

void stereo() {
    TEST("Width 0: L = R; Width 100 %: mono sum keeps the fundamental");
    DualOscParams p = quiet();
    p.shapeA = 0.5f;
    p.shapeB = 0.3f;
    p.fold = 0.4f;
    p.symmetry = 0.3f;
    p.pitchB = 0.37f;  // not harmonic to A: the fundamental is A's alone
    Render r = render(p, 24000);
    bool same = true;
    for (size_t i = 0; i < r.outL.size(); ++i) same = same && r.outL[i] == r.outR[i];
    EXPECT(same);
    const double mono = magnitudeAt(tail(r.outL, 16384), 261.6255653, kSr);
    p.width = 1.0f;
    r = render(p, 24000);
    std::vector<float> sum(r.outL.size());
    for (size_t i = 0; i < sum.size(); ++i) sum[i] = 0.5f * (r.outL[i] + r.outR[i]);
    const double wide = magnitudeAt(tail(sum, 16384), 261.6255653, kSr);
    EXPECT(std::fabs(20.0 * std::log10(wide / mono)) < 3.0);
    bool differ = false;
    for (size_t i = 12000; i < r.outL.size(); ++i) differ = differ || r.outL[i] != r.outR[i];
    EXPECT(differ);
}

void subAndSyncInput() {
    TEST("Sub is an octave below A; external Sync restarts both cores");
    DualOscParams p = quiet();
    Render r = render(p, 48000);
    EXPECT(std::fabs(1200.0 * std::log2(zeroCrossingHz(r.sub, kSr, 4800) / 130.8127827)) < 1.0);
    // Two renders with different start histories line up after a Sync edge.
    p.pitchB = 0.37f;
    const Render x = render(p, 12000, 2, 0.0f, 1, {3000, 9000});
    const Render y = render(p, 12000, 2, 0.0f, 1, {5000, 9000});
    double err = 0.0;
    for (size_t i = 9200; i < 12000; ++i) err = std::max(err, (double)std::fabs(x.a[i] - y.a[i]) + std::fabs(x.b[i] - y.b[i]));
    EXPECT(err < 1e-4);
}

void determinism() {
    TEST("same Seed → identical renders with Drift; other Seed differs");
    DualOscParams p;
    p.drift = 1.0f;
    const Render a = render(p, 48000, 2, 0.0f, 7), b = render(p, 48000, 2, 0.0f, 7), c = render(p, 48000, 2, 0.0f, 8);
    EXPECT(a.outL == b.outL);
    EXPECT(a.outL != c.outL);
    for (const auto* v : {&a.a, &a.b, &a.mix, &a.outL, &a.ring, &a.sub}) {
        EXPECT(test::allFinite(*v));
        for (float s : *v) EXPECT(std::fabs(s) < 2.0f);
    }
}

void extremes() {
    TEST("extreme settings stay finite and bounded");
    DualOscParams p;
    p.pitchA = 6.0f;
    p.pitchB = 5.0f;
    p.fmDepth = 1.0f;
    p.sync = 0.6f;
    p.fold = 1.0f;
    p.symmetry = 1.0f;
    p.width = 1.0f;
    for (bool ex : {false, true}) {
        p.expFm = ex;
        const Render r = render(p, 24000, 4, 1.0f);
        for (const auto* v : {&r.a, &r.b, &r.mix, &r.outL, &r.outR, &r.ring, &r.sub}) {
            EXPECT(test::allFinite(*v));
            for (float s : *v) EXPECT(std::fabs(s) < 3.0f);
        }
    }
}

}  // namespace

int main() {
    tuning();
    linearFmHoldsPitch();
    hardSync();
    folder();
    stereo();
    subAndSyncInput();
    determinism();
    extremes();
    return test::finish("dual-osc");
}
