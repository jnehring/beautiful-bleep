// SPDX-License-Identifier: MIT
// Formant Osc: pitch, harmonic bursts, formant peak position (Ratio and
// Fixed), sweeping through zero, click-free modulation, aliasing, stereo,
// Body, Sync (specs/modules/formant-oscillator.md §8).
#include "FormantOscDsp.h"
#include "dsp/Wavetable.h"
#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <functional>
#include <vector>

using namespace bleep;
using patch::FormantOscDsp;
using patch::FormantOscFrame;
using patch::FormantOscParams;
using test::magnitudeAt;
using test::zeroCrossingHz;

namespace {

constexpr double kSr = 48000.0;
constexpr double kC4 = 261.6255653005986;

struct Render {
    std::vector<float> outL, outR, formant, square, sub;
};

Render render(FormantOscParams p, int n, int quality = 1, const std::function<void(int, FormantOscParams&)>& mod = {},
              const std::vector<int>& syncAt = {}) {
    FormantOscDsp d;
    d.prepare(kSr);
    d.setOversampling(quality);
    Render r;
    size_t next = 0;
    for (int i = 0; i < n; ++i) {
        if (mod) mod(i, p);
        const bool sync = next < syncAt.size() && syncAt[next] == i;
        if (sync) ++next;
        const FormantOscFrame f = d.process(p, sync);
        r.outL.push_back(f.outL), r.outR.push_back(f.outR), r.formant.push_back(f.formant);
        r.square.push_back(f.square), r.sub.push_back(f.sub);
    }
    return r;
}

std::vector<float> tail(const std::vector<float>& x, size_t n) { return std::vector<float>(x.end() - (long)n, x.end()); }

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

/// Strongest bin away from the harmonics of f0, in dB below the strongest bin.
double worstNonHarmonicDb(const std::vector<float>& x, double f0, int guard = 10) {
    const auto m = spectrum(x);
    const double binHz = kSr / (double)x.size();
    double peak = 1e-30, worst = 1e-30;
    for (size_t i = 1; i < m.size(); ++i) {
        const double hz = (double)i * binHz;
        peak = std::max(peak, m[i]);
        if (hz > 20000.0 || hz < 20.0) continue;
        if (std::fabs(hz - std::round(hz / f0) * f0) <= guard * binHz) continue;
        worst = std::max(worst, m[i]);
    }
    return 20.0 * std::log10(worst / peak);
}

int strongestHarmonic(const std::vector<float>& x, double f0, int maxN = 40) {
    int best = 1;
    double bestM = 0.0;
    for (int k = 1; k <= maxN && k * f0 < 20000.0; ++k)
        if (const double m = magnitudeAt(x, k * f0, kSr); m > bestM) bestM = m, best = k;
    return best;
}

double maxStep(const std::vector<float>& x, size_t from = 1) {
    double s = 0.0;
    for (size_t i = std::max<size_t>(from, 1); i < x.size(); ++i) s = std::max(s, (double)std::fabs(x[i] - x[i - 1]));
    return s;
}

void pitchAndHarmonic() {
    TEST("fundamental at 0 V is C4; Reset 100 % bursts are harmonic");
    FormantOscParams p;
    const Render r = render(p, 65536 + 4800);
    EXPECT(std::fabs(1200.0 * std::log2(zeroCrossingHz(r.square, kSr, 4800) / kC4)) < 0.1);
    EXPECT(std::fabs(1200.0 * std::log2(zeroCrossingHz(r.sub, kSr, 4800) / (kC4 / 2))) < 0.5);
    EXPECT(worstNonHarmonicDb(tail(r.formant, 65536), kC4) < -80.0);
}

void formantPeak() {
    TEST("the formant peak sits on the harmonic nearest the formant");
    for (float F : {1.0f, 2.0f, 3.0f}) {
        FormantOscParams p;
        p.narrow = 0.0f;
        p.formant = F;
        const Render r = render(p, 16384 + 4800);
        EXPECT(std::abs(strongestHarmonic(tail(r.formant, 16384), kC4) - (int)std::lround(std::exp2(F))) <= 1);
    }
    for (float pitch : {-1.0f, -0.5f, 0.0f, 0.5f, 1.0f}) {  // C3 … C5, formant fixed at 2 octaves above C4
        FormantOscParams p;
        p.narrow = 0.0f;
        p.fixed = true;
        p.formant = 2.0f;
        p.pitch = pitch;
        const double f0 = kC4 * std::exp2(pitch);
        const Render r = render(p, 16384 + 4800);
        EXPECT(std::abs(strongestHarmonic(tail(r.formant, 16384), f0) - (int)std::lround(4.0 * kC4 / f0)) <= 1);
    }
}

void throughZero() {
    TEST("sweeping Formant through zero has no jump (Cosine start)");
    FormantOscParams p;
    p.pitch = -2.0f;  // C2
    const int n = 48000;
    const Render r = render(p, n, 1, [n](int i, FormantOscParams& q) { q.formant = -1.0f + 2.0f * (float)i / (float)n; });
    EXPECT(maxStep(r.formant) < 0.05);
    EXPECT(test::allFinite(r.outL));
}

void clickFree() {
    TEST("Roll, Narrow and Reset jumping with a fast square: no click");
    FormantOscParams p;
    p.pitch = -2.0f;
    const Render ref = render(p, 24000);
    const double base = maxStep(ref.outL, 100);
    const Render r = render(p, 24000, 1, [](int i, FormantOscParams& q) {
        const bool hi = (i / 240) % 2 == 1;  // 100 Hz square
        q.roll = hi ? 0.4f : 0.0f;
        q.narrow = hi ? 0.8f : 0.2f;
        q.reset = hi ? 0.3f : 1.0f;
    });
    EXPECT(maxStep(r.outL, 100) < base + 0.1);
}

void aliasing() {
    TEST("C6 with Narrow 90 %: low aliasing (Normal and High)");
    for (int q : {1, 2}) {
        FormantOscParams p;
        p.pitch = 2.0f;
        p.narrow = 0.9f;
        const double f0 = kC4 * 4.0;
        const Render r = render(p, 65536 + 4800, q);
        const double db = worstNonHarmonicDb(tail(r.formant, 65536), f0);
        if (db > (q == 1 ? -60.0 : -80.0)) std::printf("  alias at %dx: %.1f dB\n", q, db);
        EXPECT(db < (q == 1 ? -60.0 : -80.0));
    }
}

void stereoBodySync() {
    TEST("Spread 0: L = R; Body 0: Out = square at half level; Sync restarts cleanly");
    FormantOscParams p;
    Render r = render(p, 8000);
    EXPECT(r.outL == r.outR);
    p.spread = 0.3f;
    r = render(p, 8000);
    EXPECT(r.outL != r.outR);
    p = FormantOscParams{};
    p.body = 0.0f;
    r = render(p, 8000);
    double err = 0.0;
    for (size_t i = 0; i < r.outL.size(); ++i) err = std::max(err, (double)std::fabs(r.outL[i] - 0.5f * r.square[i]));
    EXPECT(err < 1e-6);
    // After a Sync (Reset 100 %) the oscillator plays exactly like a fresh one.
    p = FormantOscParams{};
    p.pitch = 0.23f;
    const Render a = render(p, 12000, 1, {}, {5000});
    const Render fresh = render(p, 7000);
    err = 0.0;
    for (size_t i = 5100; i < 12000; ++i) err = std::max(err, (double)std::fabs(a.outL[i] - fresh.outL[i - 5000]));
    EXPECT(err < 1e-4);
    EXPECT(maxStep(a.outL, 4990) < 0.5);
}

void bounds() {
    TEST("extremes stay finite and bounded");
    for (int q : {1, 2})
        for (float narrow : {0.0f, 1.0f})
            for (float pitch : {-6.0f, 0.0f, 5.0f}) {
                FormantOscParams p;
                p.pitch = pitch;
                p.narrow = narrow;
                p.formant = 6.0f;
                p.formantCv = 2.0f;
                p.fm = 1.0f;
                p.fmDepth = 1.0f;
                p.spread = -1.0f;
                p.body = 1.0f;
                const Render r = render(p, 9600, q);
                for (const auto* v : {&r.outL, &r.outR, &r.formant, &r.square, &r.sub}) {
                    EXPECT(test::allFinite(*v));
                    for (float s : *v) EXPECT(std::fabs(s) < 2.0f);
                }
            }
}

}  // namespace

int main() {
    pitchAndHarmonic();
    formantPeak();
    throughZero();
    clickFree();
    aliasing();
    stereoBodySync();
    bounds();
    return test::finish("formant-osc");
}
