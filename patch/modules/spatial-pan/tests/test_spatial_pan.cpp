// SPDX-License-Identifier: GPL-3.0-or-later
// Spatial Pan: interaural time and level cues, mirror symmetry, the rear and
// distance roll-offs, Doppler, early reflections and bounds.
#include "SpatialDsp.h"

#include "dsp/tests/TestUtil.h"

#include <random>
#include <vector>

using namespace bleep;
using patch::SpatialDsp;
using patch::SpatialParams;

namespace {

constexpr double kSr = 48000.0;

struct Stereo {
    std::vector<float> l, r;
};

Stereo render(const std::vector<float>& in, const SpatialParams& p) {
    SpatialDsp d;
    d.prepare(kSr);
    Stereo o;
    for (float x : in) {
        const auto f = d.tick(x, p);
        o.l.push_back(f.l), o.r.push_back(f.r);
    }
    return o;
}
std::vector<float> sine(double hz, int n, float amp = 0.5f) {
    std::vector<float> v((size_t)n);
    for (int i = 0; i < n; ++i) v[(size_t)i] = amp * (float)std::sin(6.283185307179586 * hz * i / kSr);
    return v;
}
std::vector<float> impulse(int n) {
    std::vector<float> v((size_t)n, 0.0f);
    v[100] = 1.0f;
    return v;
}
SpatialParams dry(float az, float el = 0.0f, float dist = 1.0f) {
    SpatialParams p;
    p.azimuth = az, p.elevation = el, p.distance = dist, p.room = 0.0f, p.doppler = 0.0f;
    return p;
}
int firstAbove(const std::vector<float>& x, float thr) {
    for (size_t i = 0; i < x.size(); ++i)
        if (std::fabs(x[i]) > thr) return (int)i;
    return -1;
}

void itd() {
    TEST("a source at +90° reaches the right ear first by about 0.66 ms, and is louder there");
    const auto o = render(impulse(2000), dry(90.0f));
    const int r = firstAbove(o.r, 0.02f), l = firstAbove(o.l, 0.02f);
    const double ms = (l - r) / kSr * 1000.0;
    std::printf("  ITD %.3f ms\n", ms);
    EXPECT(ms > 0.5 && ms < 0.8);
    TEST("ITD grows with the lateral angle");
    double prev = -1.0;
    for (float az : {0.0f, 20.0f, 45.0f, 70.0f, 90.0f}) {
        const auto q = render(impulse(2000), dry(az));
        const double d = (firstAbove(q.l, 0.02f) - firstAbove(q.r, 0.02f)) / kSr * 1000.0;
        EXPECT(d >= prev - 0.03);
        prev = d;
    }
    TEST("a bigger head means a longer delay");
    SpatialParams big = dry(90.0f);
    big.headCm = 11.0f;
    const auto b = render(impulse(2000), big);
    EXPECT(firstAbove(b.l, 0.02f) - firstAbove(b.r, 0.02f) > l - r);
}

void ild() {
    TEST("head shadow: at +90° the far (left) ear loses highs; lows stay close");
    const auto lo = render(sine(250.0, 24000), dry(90.0f)), hi = render(sine(6000.0, 24000), dry(90.0f));
    auto tail = [](const std::vector<float>& x) { return std::vector<float>(x.begin() + 12000, x.end()); };
    const double lowDiff = 20.0 * std::log10(test::rms(tail(lo.r)) / test::rms(tail(lo.l)));
    const double highDiff = 20.0 * std::log10(test::rms(tail(hi.r)) / test::rms(tail(hi.l)));
    std::printf("  near/far: %.1f dB at 250 Hz, %.1f dB at 6 kHz\n", lowDiff, highDiff);
    EXPECT(highDiff > 6.0);
    EXPECT(lowDiff < 4.0);
    EXPECT(highDiff > lowDiff + 4.0);
}

void symmetry() {
    TEST("front: L = R; mirrored azimuths swap the ears exactly");
    const auto in = sine(1500.0, 6000);
    const auto c = render(in, dry(0.0f));
    for (size_t i = 0; i < in.size(); ++i) EXPECT_NEAR(c.l[i], c.r[i], 1e-5);
    const auto a = render(in, dry(50.0f, 20.0f)), b = render(in, dry(-50.0f, 20.0f));
    for (size_t i = 0; i < in.size(); i += 7) {
        EXPECT_NEAR(a.l[i], b.r[i], 1e-5);
        EXPECT_NEAR(a.r[i], b.l[i], 1e-5);
    }
}

void rearAndDistance() {
    TEST("behind is duller than in front; far is quieter and duller than near");
    auto noise = [] {
        std::mt19937 g(5);
        std::uniform_real_distribution<float> u(-1, 1);
        std::vector<float> v(24000);
        for (auto& x : v) x = u(g);
        return v;
    }();
    auto highShare = [&](const SpatialParams& p) {
        const auto o = render(noise, p);
        const std::vector<float> t(o.l.begin() + 4000, o.l.end());
        double hi = 0.0, all = 0.0;
        for (double f = 300.0; f < 20000.0; f *= 1.12) {
            const double m = std::pow(test::magnitudeAt(t, f, kSr), 2.0);
            all += m;
            if (f > 5000.0) hi += m;
        }
        return hi / all;
    };
    const double front = highShare(dry(0.0f)), back = highShare(dry(180.0f));
    std::printf("  high share front %.3f, back %.3f\n", front, back);
    EXPECT(back < front * 0.8);
    SpatialParams near = dry(0.0f, 0.0f, 0.5f), far = dry(0.0f, 0.0f, 12.0f);
    far.air = 1.0f;
    near.air = 1.0f;
    EXPECT(highShare(far) < highShare(near) * 0.7);
    const auto on = render(sine(500.0, 12000), near), of = render(sine(500.0, 12000), far);
    EXPECT(test::rms(of.l) < test::rms(on.l) * 0.4);
}

void doppler() {
    TEST("moving away at 34.3 m/s lowers a 1 kHz tone by 10 %; Doppler 0 leaves it alone");
    const int n = 48000 * 2;
    auto run = [&](float doppler) {
        SpatialDsp d;
        d.prepare(kSr);
        std::vector<float> out;
        const auto in = sine(1000.0, n);
        for (int i = 0; i < n; ++i) {
            SpatialParams p = dry(0.0f);
            p.doppler = doppler;
            p.distance = 1.0f + 34.3f * (float)i / (float)kSr * (i < 48000 + 9600 ? 1.0f : 0.0f);  // 1 s of travel... then holds
            p.distance = std::min(p.distance, 39.0f);
            out.push_back(d.tick(in[(size_t)i], p).l);
        }
        return out;
    };
    const auto moving = run(1.0f);
    const std::vector<float> mid(moving.begin() + 12000, moving.begin() + 36000);
    const double hz = test::zeroCrossingHz(mid, kSr);
    std::printf("  %.1f Hz\n", hz);
    EXPECT_NEAR(hz, 1000.0 / 1.1, 12.0);
    const auto still = run(0.0f);
    const std::vector<float> mid0(still.begin() + 12000, still.begin() + 36000);
    EXPECT_NEAR(test::zeroCrossingHz(mid0, kSr), 1000.0, 3.0);
}

void reflections() {
    TEST("Room adds delayed energy after the direct sound; Room 0 leaves silence behind it");
    auto p = dry(30.0f);
    const auto off = render(impulse(4000), p);
    double tail0 = 0.0;
    for (size_t i = 600; i < off.l.size(); ++i) tail0 += std::fabs(off.l[i]) + std::fabs(off.r[i]);
    p.room = 1.0f;
    const auto on = render(impulse(4000), p);
    double tail1 = 0.0;
    for (size_t i = 600; i < on.l.size(); ++i) tail1 += std::fabs(on.l[i]) + std::fabs(on.r[i]);
    EXPECT(tail0 < 0.5);  // the head-shadow filters ring a little
    EXPECT(tail1 > tail0 + 0.5);
    EXPECT(firstAbove(on.l, 0.02f) < 400);
}

void bounds() {
    TEST("wild automation of every position stays finite and bounded");
    std::mt19937 g(9);
    std::uniform_real_distribution<float> u(-1, 1);
    SpatialDsp d;
    d.prepare(kSr);
    float peak = 0.0f;
    for (int i = 0; i < 48000 * 3; ++i) {
        SpatialParams p;
        p.azimuth = 180.0f * u(g);
        p.elevation = 90.0f * u(g);
        p.distance = 0.1f + 20.0f * (u(g) * 0.5f + 0.5f);
        p.room = u(g) * 0.5f + 0.5f;
        p.size = u(g) * 0.5f + 0.5f;
        p.air = u(g) * 0.5f + 0.5f;
        p.headCm = 9.0f + 2.0f * u(g);
        p.doppler = u(g) * 0.5f + 0.5f;
        const auto f = d.tick(0.8f * u(g), p);
        EXPECT(std::isfinite(f.l) && std::isfinite(f.r));
        peak = std::max({peak, std::fabs(f.l), std::fabs(f.r)});
    }
    std::printf("  peak %.2f\n", peak);
    EXPECT(peak < 6.0f);
}

}  // namespace

int main() {
    itd();
    ild();
    symmetry();
    rearAndDistance();
    doppler();
    reflections();
    bounds();
    return test::finish("spatial-pan");
}
