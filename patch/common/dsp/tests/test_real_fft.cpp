// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "dsp/RealFft.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep::dsp;

static constexpr double kPi = 3.14159265358979323846;

static void matchesDft() {
    TEST("forward transform equals the direct DFT");
    for (int n : {8, 64, 256}) {
        RealFft fft;
        fft.prepare(n);
        std::vector<float> re((size_t)n), im((size_t)n, 0.0f);
        for (int i = 0; i < n; ++i) re[(size_t)i] = (float)std::sin(0.3 * i) + 0.5f * (float)std::cos(1.7 * i);
        const std::vector<float> src = re;
        fft.forward(re.data(), im.data());
        for (int k : {0, 1, n / 4, n / 2 - 1}) {
            double sr = 0.0, si = 0.0;
            for (int i = 0; i < n; ++i) {
                sr += src[(size_t)i] * std::cos(2.0 * kPi * k * i / n);
                si -= src[(size_t)i] * std::sin(2.0 * kPi * k * i / n);
            }
            EXPECT_NEAR(re[(size_t)k], sr, 1e-3);
            EXPECT_NEAR(im[(size_t)k], si, 1e-3);
        }
    }
}

static void roundTrip() {
    TEST("inverse(forward(x)) returns x");
    RealFft fft;
    fft.prepare(2048);
    std::vector<float> re(2048), im(2048, 0.0f);
    for (int i = 0; i < 2048; ++i) re[(size_t)i] = (float)std::sin(0.01 * i * i);
    const std::vector<float> src = re;
    fft.forward(re.data(), im.data());
    fft.inverse(re.data(), im.data());
    double worst = 0.0;
    for (int i = 0; i < 2048; ++i) worst = std::max(worst, (double)std::fabs(re[(size_t)i] - src[(size_t)i]) + std::fabs(im[(size_t)i]));
    EXPECT(worst < 1e-4);
}

static void packedPair() {
    TEST("two real signals in one transform are told apart");
    const int n = 512;
    RealFft fft;
    fft.prepare(n);
    std::vector<float> a((size_t)n), b((size_t)n), ar((size_t)n), ai((size_t)n, 0.0f), br((size_t)n), bi((size_t)n, 0.0f);
    for (int i = 0; i < n; ++i) {
        a[(size_t)i] = (float)std::sin(2.0 * kPi * 5.0 * i / n);
        b[(size_t)i] = (float)std::cos(2.0 * kPi * 9.0 * i / n) * 0.5f;
    }
    ar = a;
    br = b;
    fft.forward(ar.data(), ai.data());
    fft.forward(br.data(), bi.data());
    std::vector<float> zr = a, zi = b;
    fft.forward(zr.data(), zi.data());
    for (int k = 0; k <= n / 2; ++k) {
        float xr, xi, yr, yi;
        fft.splitPacked(zr.data(), zi.data(), k, xr, xi, yr, yi);
        EXPECT_NEAR(xr, ar[(size_t)k], 1e-3);
        EXPECT_NEAR(xi, ai[(size_t)k], 1e-3);
        EXPECT_NEAR(yr, br[(size_t)k], 1e-3);
        EXPECT_NEAR(yi, bi[(size_t)k], 1e-3);
    }
}

int main() {
    matchesDft();
    roundTrip();
    packedPair();
    return bleep::test::finish("real_fft");
}
