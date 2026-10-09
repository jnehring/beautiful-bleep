// SPDX-License-Identifier: MIT
// Additive Osc: pitch, partial levels, band limit, reference saw, odd/even,
// comb, normalisation, stretch, decay, drawn spectrum, determinism
// (doc/specs/modules/additive-oscillator.md §8).
#include "AdditiveOscDsp.h"
#include "dsp/Wavetable.h"
#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <vector>

using namespace bleep;
using patch::AdditiveDrawn;
using patch::AdditiveOscDsp;
using patch::AdditiveOscFrame;
using patch::AdditiveOscParams;
using test::magnitudeAt;
using test::rms;
using test::zeroCrossingHz;

namespace {

constexpr double kSr = 48000.0;
constexpr double kC4 = 261.6255653005986;

struct Render {
    std::vector<float> outL, outR, odd, even, fund;
};

Render render(const AdditiveOscParams& p, int n, bool random = false, uint32_t seed = 1, int triggerAt = -1,
              const AdditiveDrawn* drawn = nullptr) {
    AdditiveOscDsp d;
    d.setPhases(random, seed);
    d.prepare(kSr);
    d.setDrawn(drawn);
    Render r;
    for (int i = 0; i < n; ++i) {
        if (i == triggerAt) d.trigger();
        const AdditiveOscFrame f = d.process(p);
        r.outL.push_back(f.outL), r.outR.push_back(f.outR), r.odd.push_back(f.odd), r.even.push_back(f.even);
        r.fund.push_back(f.fundamental);
    }
    return r;
}

std::vector<float> slice(const std::vector<float>& x, size_t from, size_t n) {
    return std::vector<float>(x.begin() + (long)from, x.begin() + (long)(from + n));
}
double db(double a, double b) { return 20.0 * std::log10(std::max(a, 1e-30) / std::max(b, 1e-30)); }

void pitchAndLevels() {
    TEST("partial 1 at C4, partial n at n·f0 with level 1/n (Saw)");
    AdditiveOscParams p;
    const Render r = render(p, 48000 + 4800);
    const auto x = slice(r.outL, 4800, 48000);
    EXPECT(std::fabs(1200.0 * std::log2(zeroCrossingHz(r.fund, kSr, 4800) / kC4)) < 0.1);
    const double m1 = magnitudeAt(x, kC4, kSr);
    for (int n : {2, 5, 10, 20}) EXPECT(std::fabs(db(magnitudeAt(x, n * kC4, kSr), m1) - db(1.0 / n, 1.0)) < 0.3);
    EXPECT(magnitudeAt(x, 33 * kC4, kSr) < m1 * 1e-4);  // Partials 32
}

void bandLimit() {
    TEST("nothing above 0.45 fs; full level below 0.40 fs");
    AdditiveOscParams p;
    p.pitch = (float)std::log2(2000.0 / kC4);
    p.partials = 64.0f;
    const Render r = render(p, 32768 + 4800);
    const auto x = slice(r.outL, 4800, 32768);
    const double m1 = magnitudeAt(x, 2000.0, kSr);
    EXPECT(std::fabs(db(magnitudeAt(x, 18000.0, kSr), m1) - db(1.0 / 9, 1.0)) < 0.3);  // 0.375 fs
    EXPECT(magnitudeAt(x, 22000.0, kSr) < m1 * 1e-5);
    std::vector<std::complex<double>> buf(x.begin(), x.end());
    dsp::wavetable::fft(buf.data(), (int)buf.size(), false);
    double above = 0.0, peak = 0.0;
    for (size_t i = 1; i < buf.size() / 2; ++i) {
        const double hz = (double)i * kSr / (double)buf.size(), m = std::abs(buf[i]);
        peak = std::max(peak, m);
        if (hz > 0.45 * kSr + 50.0) above = std::max(above, m);
    }
    EXPECT(db(above, peak) < -60.0);  // rectangular window leakage only
    // Sweep across the band limit: the output never jumps.
    AdditiveOscDsp d;
    d.setPhases(false, 1);
    d.prepare(kSr);
    double prev = 0.0, worst = 0.0;
    for (int i = 0; i < 48000; ++i) {
        p.pitch = (float)std::log2((2000.0 + 2000.0 * i / 48000.0) / kC4);
        const double y = d.process(p).outL;
        // Highest partial below Nyquist moves by at most 2·sin(π·0.45) per sample at level ≤ 1/9.
        if (i > 4800) worst = std::max(worst, std::fabs(y - prev));
        prev = y;
    }
    EXPECT(worst < 1.0);
}

void referenceSaw() {
    TEST("Saw, 64 partials, Aligned, Normalise Off = band-limited saw (−50 dB)");
    AdditiveOscParams p;
    p.pitch = -2.0f;  // C2: 64 partials reach 4.2 kHz
    p.partials = 64.0f;
    p.normalise = false;
    const Render r = render(p, 48000);
    const double f0 = kC4 / 4.0;
    double err = 0.0, ref = 0.0;
    for (int i = 4800; i < 48000; ++i) {
        double s = 0.0;
        for (int n = 1; n <= 64; ++n) s += std::sin(6.283185307179586 * n * f0 * i / kSr) / n;
        s *= 2.0 / 3.14159265358979323846;
        err += (r.outL[(size_t)i] - s) * (r.outL[(size_t)i] - s);
        ref += s * s;
    }
    EXPECT(10.0 * std::log10(err / ref) < -50.0);
}

void oddEven() {
    TEST("Odd/Even −1 and +1 remove partials; Odd + Even = Out");
    AdditiveOscParams p;
    p.oddEven = -1.0f;
    Render r = render(p, 24000 + 4800);
    auto x = slice(r.outL, 4800, 24000);
    double m1 = magnitudeAt(x, kC4, kSr);
    for (int n : {2, 4, 10}) EXPECT(db(magnitudeAt(x, n * kC4, kSr), m1) < -90.0);
    p.oddEven = 1.0f;
    r = render(p, 24000 + 4800);
    x = slice(r.outL, 4800, 24000);
    m1 = magnitudeAt(x, kC4, kSr);
    EXPECT(m1 > 0.1);  // the fundamental stays
    for (int n : {3, 5, 11}) EXPECT(db(magnitudeAt(x, n * kC4, kSr), m1) < -90.0);
    p.oddEven = 0.2f;
    r = render(p, 4800);
    double err = 0.0;
    for (size_t i = 0; i < r.outL.size(); ++i) err = std::max(err, (double)std::fabs(r.odd[i] + r.even[i] - r.outL[i]));
    EXPECT(err < 1e-5);
}

void comb() {
    TEST("Comb 100 %: notch centres silent; Comb Phase 1/Spacing moves them by one");
    AdditiveOscParams p;
    p.comb = 1.0f;
    p.combSpacing = 4.0f;
    Render r = render(p, 24000 + 4800);
    auto x = slice(r.outL, 4800, 24000);
    double m1 = magnitudeAt(x, kC4, kSr);
    for (int n : {4, 8, 12}) EXPECT(db(magnitudeAt(x, n * kC4, kSr), m1) < -90.0);
    EXPECT(db(magnitudeAt(x, 3 * kC4, kSr), m1) > -30.0);
    p.combPhase = 0.25f;
    r = render(p, 24000 + 4800);
    x = slice(r.outL, 4800, 24000);
    m1 = magnitudeAt(x, kC4, kSr);
    for (int n : {3, 7, 11}) EXPECT(db(magnitudeAt(x, n * kC4, kSr), m1) < -90.0);
}

void normalise() {
    TEST("Normalise On: RMS 0.3 ±1 dB across Partials and Tilt");
    for (float partials : {4.0f, 16.0f, 64.0f})
        for (float tilt : {-24.0f, 0.0f, 12.0f}) {
            AdditiveOscParams p;
            p.partials = partials;
            p.tilt = tilt;
            p.pitch = -1.0f;
            const Render r = render(p, 24000, true);
            const double level = rms(r.outL, 4800);
            EXPECT(std::fabs(db(level, 0.3)) < 1.0);
            for (float s : r.outL) EXPECT(std::fabs(s) < 1.5f);
        }
}

void stretch() {
    TEST("Stretch keeps partial 1 at f0 and moves partial 20 as the formula says");
    AdditiveOscParams p;
    p.stretch = 1.0f;
    p.partials = 24.0f;
    p.pitch = -1.0f;
    const double f0 = kC4 / 2.0;
    const Render r = render(p, 131072 + 4800);
    const auto x = slice(r.outL, 4800, 131072);
    auto peakCents = [&](double hz) {
        double best = 0.0, bestM = -1.0;
        for (double c = -6.0; c <= 6.0; c += 0.1)
            if (const double m = magnitudeAt(x, hz * std::exp2(c / 1200.0), kSr); m > bestM) bestM = m, best = c;
        return best;
    };
    EXPECT(std::fabs(peakCents(f0)) < 1.0);
    const double r20 = 20.0 * std::sqrt(1.0 + 0.0005 * 400.0) / std::sqrt(1.0005);
    EXPECT(std::fabs(peakCents(f0 * r20)) < 1.0);
}

void decay() {
    TEST("Decay: partial 1 falls 60 dB in Decay; Damp 0 keeps the ratios");
    AdditiveOscParams p;
    p.decay = 1.0f;
    p.damp = 0.0f;
    const Render r = render(p, 48000, false, 1, 0);
    const auto a = slice(r.fund, 4800, 960), b = slice(r.fund, 28800, 960);  // t = 0.1 s, 0.6 s
    EXPECT(std::fabs(db(rms(b), rms(a)) - (-60.0 * 0.5)) < 1.5);
    const auto la = slice(r.outL, 4800, 4800), lb = slice(r.outL, 28800, 4800);
    const double ra = db(magnitudeAt(la, 2 * kC4, kSr), magnitudeAt(la, kC4, kSr));
    const double rb = db(magnitudeAt(lb, 2 * kC4, kSr), magnitudeAt(lb, kC4, kSr));
    EXPECT(std::fabs(ra - rb) < 0.5);
    // No trigger: sustained.
    const Render s = render(p, 48000);
    EXPECT(std::fabs(db(rms(slice(s.fund, 40000, 960)), rms(slice(s.fund, 4800, 960)))) < 0.2);
}

void drawn() {
    TEST("Drawn base plays the drawn levels");
    AdditiveDrawn d{};
    d[2] = 1.0f;  // partial 3 only
    AdditiveOscParams p;
    p.base = 3;
    const Render r = render(p, 24000 + 4800, false, 1, -1, &d);
    const auto x = slice(r.outL, 4800, 24000);
    const double m3 = magnitudeAt(x, 3 * kC4, kSr);
    EXPECT(m3 > 0.1);
    EXPECT(db(magnitudeAt(x, kC4, kSr), m3) < -90.0);
    EXPECT(db(magnitudeAt(x, 2 * kC4, kSr), m3) < -90.0);
}

void determinism() {
    TEST("same Seed → identical renders (Chorus, Random phases); other Seed differs");
    AdditiveOscParams p;
    p.chorus = 30.0f;
    p.chorusRate = 2.0f;
    p.width = 1.0f;
    const Render a = render(p, 24000, true, 5), b = render(p, 24000, true, 5), c = render(p, 24000, true, 6);
    EXPECT(a.outL == b.outL && a.outR == b.outR);
    EXPECT(a.outL != c.outL);
    EXPECT(a.outL != a.outR);
    // Width keeps the mono sum within 1.5 dB.
    p.chorus = 0.0f;
    const Render w = render(p, 24000), m = render(AdditiveOscParams{}, 24000);
    std::vector<float> sum(w.outL.size());
    for (size_t i = 0; i < sum.size(); ++i) sum[i] = 0.5f * (w.outL[i] + w.outR[i]);
    EXPECT(std::fabs(db(rms(sum, 4800), rms(m.outL, 4800))) < 1.5);
}

void extremes() {
    TEST("extremes stay finite and bounded");
    for (float pitch : {-8.0f, 0.0f, 6.0f})
        for (float shift : {-1.0f, 1.0f}) {
            AdditiveOscParams p;
            p.pitch = pitch;
            p.partials = 64.0f;
            p.tilt = 12.0f;
            p.stretch = shift;
            p.shift = shift;
            p.chorus = 50.0f;
            p.chorusRate = 5.0f;
            p.width = 1.0f;
            p.base = 2;
            for (bool norm : {true, false}) {
                p.normalise = norm;
                const Render r = render(p, 9600, true, 3, 100);
                for (const auto* v : {&r.outL, &r.outR, &r.odd, &r.even, &r.fund}) {
                    EXPECT(test::allFinite(*v));
                    for (float s : *v) EXPECT(std::fabs(s) < 4.0f);
                }
            }
        }
}

}  // namespace

int main() {
    pitchAndLevels();
    bandLimit();
    referenceSaw();
    oddEven();
    comb();
    normalise();
    stretch();
    decay();
    drawn();
    determinism();
    extremes();
    return test::finish("additive-osc");
}
