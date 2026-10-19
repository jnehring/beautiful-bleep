// SPDX-License-Identifier: GPL-3.0-or-later
// Room Print: the FFT, the partitioned convolver against direct convolution
// (zero latency, any chunking), balance, the built-in responses, the shaping
// (stretch, trim, damping, resampling) and bounds.
#include "RoomPrintDsp.h"

#include "dsp/tests/TestUtil.h"

#include <random>
#include <vector>

using namespace bleep;
namespace rp = patch::roomprint;

namespace {

constexpr double kSr = 48000.0;

void fftCheck() {
    TEST("FFT matches a direct DFT and inverts");
    std::mt19937 g(1);
    std::uniform_real_distribution<float> u(-1, 1);
    std::vector<rp::cf> x(rp::kN), ref(rp::kN);
    for (auto& v : x) v = rp::cf(u(g), u(g));
    for (int k : {0, 1, 7, 300, 777, 1023}) {
        std::complex<double> s = 0;
        for (int n = 0; n < rp::kN; ++n) s += std::complex<double>(x[(size_t)n]) * std::polar(1.0, -6.283185307179586 * k * n / rp::kN);
        ref[(size_t)k] = rp::cf((float)s.real(), (float)s.imag());
    }
    auto y = x;
    rp::Fft::instance().forward(y.data());
    for (int k : {0, 1, 7, 300, 777, 1023}) EXPECT(std::abs(y[(size_t)k] - ref[(size_t)k]) < 2e-3);
    rp::Fft::instance().inverse(y.data());
    for (int n = 0; n < rp::kN; ++n) EXPECT(std::abs(y[(size_t)n] - x[(size_t)n]) < 1e-4);
}

std::shared_ptr<const rp::Ir> irFrom(const std::vector<float>& h, const rp::Shape& sh = {}, double rate = kSr) {
    rp::Stereo s;
    s.rate = rate;
    s.l = h;
    s.r = h;
    return rp::buildIr(s, sh, kSr);
}

struct Out {
    std::vector<float> l, r;
};

Out run(const rp::Ir* ir, const rp::RoomParams& p, const std::vector<float>& inL, const std::vector<float>* inR, int extra = 0) {
    rp::RoomPrintDsp d;
    d.prepare(kSr);
    Out o;
    for (size_t i = 0; i < inL.size() + (size_t)extra; ++i) {
        const float l = i < inL.size() ? inL[i] : 0.0f, r = inR && i < inR->size() ? (*inR)[i] : 0.0f;
        const auto f = d.tick(ir, p, l, r, inR != nullptr);
        o.l.push_back(f.l), o.r.push_back(f.r);
    }
    return o;
}

std::vector<float> directConv(const std::vector<float>& x, const std::vector<float>& h, size_t n) {
    std::vector<float> y(n, 0.0f);
    for (size_t i = 0; i < n; ++i) {
        double s = 0.0;
        for (size_t k = 0; k < h.size() && k <= i; ++k)
            if (i - k < x.size()) s += (double)h[k] * x[i - k];
        y[i] = (float)s;
    }
    return y;
}

void convolution() {
    TEST("the convolver equals direct convolution with the prepared response: no latency");
    std::mt19937 g(3);
    std::uniform_real_distribution<float> u(-1, 1);
    std::vector<float> h(14000);  // 0.29 s: a head and 26 partitions
    for (size_t i = 0; i < h.size(); ++i) h[i] = u(g) * std::exp(-4.0f * (float)i / (float)h.size());
    h[0] = 1.0f;
    const auto ir = irFrom(h);
    EXPECT(ir->partitions > 20);
    std::vector<float> x(9000);
    for (float& v : x) v = u(g);
    rp::RoomParams p;
    p.mix = 1.0f;
    const size_t total = x.size() + 6000;
    const auto o = run(ir.get(), p, x, nullptr, 6000);
    const auto ref = directConv(x, ir->samples[0], total);
    double worst = 0.0, peak = 0.0;
    for (size_t i = 0; i < total; ++i) {
        worst = std::max(worst, (double)std::fabs(o.l[i] - ref[i]));
        peak = std::max(peak, (double)std::fabs(ref[i]));
    }
    std::printf("  worst error %.2e of peak %.3f\n", worst, peak);
    EXPECT(worst < 2e-4 * std::max(1.0, peak));
    // The first output sample already has the direct part: an impulse in gives h[0] out at once.
    std::vector<float> imp(2000, 0.0f);
    imp[0] = 1.0f;
    const auto oi = run(ir.get(), p, imp, nullptr);
    EXPECT_NEAR(oi.l[0], ir->samples[0][0], 1e-5);
    EXPECT_NEAR(oi.l[700], ir->samples[0][700], 1e-4);
    EXPECT_NEAR(oi.r[1500], ir->samples[1][1500], 1e-4);
}

void stereoInputs() {
    TEST("with both inputs patched, each side runs through its own channel; mono feeds both");
    std::vector<float> hl(6000, 0.0f), hr(6000, 0.0f);
    hl[0] = 1.0f;
    hl[3000] = 0.5f;
    hr[100] = 1.0f;
    rp::Stereo s;
    s.l = hl, s.r = hr;
    s.rate = kSr;
    rp::Shape sh;
    const auto ir = rp::buildIr(s, sh, kSr);
    std::vector<float> a(200, 0.0f), b(200, 0.0f);
    a[0] = 1.0f;  // left input: an impulse; right: silent
    rp::RoomParams p;
    p.mix = 1.0f;
    const auto st = run(ir.get(), p, a, &b, 5000);
    double rsum = 0.0, lsum = 0.0;
    for (size_t i = 0; i < st.l.size(); ++i) rsum += std::fabs(st.r[i]), lsum += std::fabs(st.l[i]);
    EXPECT(rsum < 1e-6 * lsum + 1e-6);  // the silent right input produces no right output
    EXPECT(lsum > 0.1);
    const auto mono = run(ir.get(), p, a, nullptr, 5000);
    double msum = 0.0;
    for (float v : mono.r) msum += std::fabs(v);
    EXPECT(msum > 0.1);
}

void balance() {
    TEST("Early/Late 0 keeps only the first part, 100 % only the tail");
    const auto ir = rp::buildIr(rp::makeSynthetic(1, kSr), rp::Shape{}, kSr);
    std::vector<float> imp(60000, 0.0f);
    imp[0] = 1.0f;
    rp::RoomParams p;
    p.mix = 1.0f;
    auto energy = [&](const Out& o, size_t a, size_t b) {
        double e = 0.0;
        for (size_t i = a; i < b; ++i) e += (double)o.l[i] * o.l[i];
        return e;
    };
    p.balance = 0.0f;
    const auto early = run(ir.get(), p, imp, nullptr);
    p.balance = 1.0f;
    const auto late = run(ir.get(), p, imp, nullptr);
    p.balance = 0.5f;
    const auto both = run(ir.get(), p, imp, nullptr);
    EXPECT(energy(early, 12000, 60000) < 0.003 * energy(early, 0, 3000));  // nothing after ~120 ms (the gain glides in over a moment)
    EXPECT(energy(late, 0, 1500) < 0.05 * energy(both, 0, 1500));
    EXPECT(energy(late, 12000, 60000) > 0.8 * energy(both, 12000, 60000));
}

void predelayAndMix() {
    TEST("predelay shifts the wet sound; mix 0 is the dry input untouched");
    const auto ir = rp::buildIr(rp::makeSynthetic(3, kSr), rp::Shape{}, kSr);
    std::vector<float> imp(8000, 0.0f);
    imp[0] = 1.0f;
    rp::RoomParams p;
    p.mix = 1.0f;
    p.balance = 0.5f;
    const auto a = run(ir.get(), p, imp, nullptr);
    p.predelay = 0.05f;
    const auto b = run(ir.get(), p, imp, nullptr);
    auto first = [](const Out& o) {
        for (size_t i = 0; i < o.l.size(); ++i)
            if (std::fabs(o.l[i]) > 1e-3f) return (int)i;
        return -1;
    };
    EXPECT(first(a) < 60);
    EXPECT_NEAR(first(b) - first(a), 2400, 40);
    p.mix = 0.0f;
    const auto d = run(ir.get(), p, imp, nullptr);
    for (size_t i = 0; i < imp.size(); ++i) EXPECT(d.l[i] == imp[i]);
}

void synthetic() {
    TEST("the ten built-in responses: finite, normalised, decaying, within 4 s, repeatable, different from each other");
    std::vector<std::vector<float>> all;
    for (int i = 0; i < rp::kSynthCount; ++i) {
        const auto ir = rp::buildIr(rp::makeSynthetic(i, kSr), rp::Shape{}, kSr);
        const auto& y = ir->samples[0];
        EXPECT(ir->length > 4800 && ir->length <= (int)(4.0 * kSr));
        EXPECT(test::allFinite(y));
        double e = 0.0;
        for (int ch = 0; ch < 2; ++ch)
            for (float v : ir->samples[(size_t)ch]) e += (double)v * v;
        EXPECT_NEAR(e * 0.5, 1.0, 1e-3);
        // the last quarter carries much less energy than the first quarter (Swell grows instead: reversed)
        double first = 0.0, last = 0.0;
        for (size_t k = 0; k < y.size() / 4; ++k) first += (double)y[k] * y[k], last += (double)y[y.size() - 1 - k] * y[y.size() - 1 - k];
        if (i != 7 && i != 5) EXPECT(last < 0.2 * first);
        const auto again = rp::buildIr(rp::makeSynthetic(i, kSr), rp::Shape{}, kSr);
        EXPECT(again->samples[0] == y);
        all.push_back(y);
        std::printf("  %-10s %.2f s\n", rp::synthNames()[i], ir->length / kSr);
    }
    for (size_t i = 0; i < all.size(); ++i)
        for (size_t j = i + 1; j < all.size(); ++j) EXPECT(all[i] != all[j]);
    TEST("left and right differ (decorrelated)");
    const auto h = rp::buildIr(rp::makeSynthetic(1, kSr), rp::Shape{}, kSr);
    double diff = 0.0;
    for (size_t i = 0; i < h->samples[0].size(); ++i) diff += std::fabs(h->samples[0][i] - h->samples[1][i]);
    EXPECT(diff > 1.0);
}

void shaping() {
    TEST("stretch 2 halves the length and doubles the speed; trim cuts; a 44.1 kHz response keeps its duration");
    std::vector<float> h(24000, 0.0f);
    for (size_t i = 0; i < h.size(); ++i) h[i] = std::sin(0.3f * (float)i) * std::exp(-3.0f * (float)i / (float)h.size());
    rp::Shape sh;
    const auto base = irFrom(h);
    sh.stretch = 2.0f;
    const auto fast = irFrom(h, sh);
    EXPECT(std::abs(fast->length * 2 - base->length) < 8);
    sh.stretch = 1.0f;
    sh.trimEnd = 0.5f;
    EXPECT(std::abs(irFrom(h, sh)->length - base->length / 2) < 8);
    sh.trimEnd = 1.0f;
    sh.trimStart = 0.5f;
    EXPECT(std::abs(irFrom(h, sh)->length - base->length / 2) < 8);
    sh = rp::Shape{};
    std::vector<float> h44(22050, 0.0f);
    h44[0] = 1.0f;
    h44[10000] = 0.5f;
    const auto r = irFrom(h44, sh, 44100.0);
    EXPECT(std::abs(r->length - 24000) < 8);
    // the second spike lands at 10000 × 48000/44100 ≈ 10884
    size_t pos = 5000;
    for (size_t i = 5000; i < r->samples[0].size(); ++i)
        if (std::fabs(r->samples[0][i]) > std::fabs(r->samples[0][pos])) pos = i;
    EXPECT(std::abs((int)pos - 10884) < 3);
    TEST("damping: high damping removes highs from the tail and keeps the start; low damping the lows");
    const auto noise = rp::makeSynthetic(3, kSr);
    rp::Shape d;
    const auto plain = rp::buildIr(noise, d, kSr);
    d.dampHigh = 1.0f;
    const auto hi = rp::buildIr(noise, d, kSr);
    d = {};
    d.dampLow = 1.0f;
    const auto lo = rp::buildIr(noise, d, kSr);
    auto band = [&](const rp::Ir& ir, size_t from, size_t n, double f0, double f1) {
        std::vector<float> w(ir.samples[0].begin() + (long)from, ir.samples[0].begin() + (long)(from + n));
        double e = 0.0;
        for (double f = f0; f < f1; f += 211.0) e += std::pow(test::magnitudeAt(w, f, kSr), 2.0);
        return e;
    };
    const size_t t0 = 48000, n = 16384;
    std::printf("  tail highs %.2e damped vs %.2e plain; mids %.2e vs %.2e\n", band(*hi, t0, n, 6000, 12000), band(*plain, t0, n, 6000, 12000), band(*hi, t0, n, 300, 2000), band(*plain, t0, n, 300, 2000));
    EXPECT(band(*hi, t0, n, 6000, 12000) < 0.2 * band(*plain, t0, n, 6000, 12000));
    EXPECT(band(*hi, t0, n, 300, 2000) > 0.5 * band(*plain, t0, n, 300, 2000));
    EXPECT(band(*lo, t0, n, 40, 200) < 0.25 * band(*plain, t0, n, 40, 200) + 1e-12);
    EXPECT(band(*hi, 0, 2048, 6000, 12000) > 0.5 * band(*plain, 0, 2048, 6000, 12000));
    TEST("a silent or empty response gives an empty Ir (dry only), not a crash");
    rp::Stereo empty;
    EXPECT(rp::buildIr(empty, rp::Shape{}, kSr)->length == 0);
    rp::Stereo silent;
    silent.l.assign(5000, 0.0f);
    EXPECT(rp::buildIr(silent, rp::Shape{}, kSr)->length == 0);
    rp::RoomParams p;
    p.mix = 0.5f;
    const auto o = run(rp::buildIr(silent, rp::Shape{}, kSr).get(), p, std::vector<float>(2000, 0.5f), nullptr);
    EXPECT_NEAR(o.l[1999], 0.25f, 1e-5);
}

void bounds() {
    TEST("loud noise through every built-in response stays finite and within a sane peak");
    std::mt19937 g(2);
    std::uniform_real_distribution<float> u(-1, 1);
    std::vector<float> x(48000);
    for (float& v : x) v = u(g);
    for (int i = 0; i < rp::kSynthCount; ++i) {
        const auto ir = rp::buildIr(rp::makeSynthetic(i, kSr), rp::Shape{}, kSr);
        rp::RoomParams p;
        p.mix = 1.0f;
        p.width = 2.0f;
        const auto o = run(ir.get(), p, x, nullptr);
        float peak = 0.0f;
        for (float v : o.l) peak = std::max(peak, std::fabs(v));
        EXPECT(test::allFinite(o.l) && test::allFinite(o.r));
        EXPECT(peak < 12.0f);
    }
}

}  // namespace

int main() {
    fftCheck();
    convolution();
    stereoInputs();
    balance();
    predelayAndMix();
    synthetic();
    shaping();
    bounds();
    return test::finish("room-print");
}
