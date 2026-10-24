// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Oversampler: the half-band shortcut (only the non-zero taps) matches the
// full convolution, and 2×/4× round trips pass the audio band.
#include "dsp/Oversampler.h"
#include "dsp/tests/TestUtil.h"

#include <array>
#include <random>

using namespace bleep;

static void zeroTaps() {
    TEST("half-band zero taps");
    const auto& h = dsp::HalfbandFir::taps();
    constexpr int m = (dsp::HalfbandFir::kTaps - 1) / 2;
    for (int k = 0; k < dsp::HalfbandFir::kTaps; ++k)
        if (k != m && ((k - m) % 2) == 0) EXPECT(h[(size_t)k] == 0.0f);
}

/// The filter before the half-band shortcut, verbatim: every tap multiplied.
class FullHalfband {
public:
    float process(float x) noexcept {
        constexpr int n = dsp::HalfbandFir::kTaps;
        buf_[(size_t)pos_] = buf_[(size_t)(pos_ + n)] = x;
        const float* b = &buf_[(size_t)pos_];
        const auto& h = dsp::HalfbandFir::taps();
        float y = 0.0f;
        for (int k = 0; k < n; ++k) y += h[(size_t)k] * b[k];
        if (++pos_ == n) pos_ = 0;
        return y;
    }

private:
    std::array<float, 2 * dsp::HalfbandFir::kTaps> buf_{};
    int pos_ = 0;
};

static void matchesFullConvolution() {
    TEST("matches the full convolution");
    dsp::HalfbandFir f;
    FullHalfband ref;
    std::mt19937 rng(7);
    std::uniform_real_distribution<float> u(-1.0f, 1.0f);
    double worst = 0.0;
    for (int i = 0; i < 20000; ++i) {
        const float x = u(rng);
        worst = std::max(worst, (double)std::fabs(f.process(x) - ref.process(x)));
    }
    EXPECT(worst < 1e-6);  // only the summation order differs
}

static void roundTrip() {
    TEST("round trip");
    for (int factor : {2, 4}) {
        dsp::Upsampler up;
        dsp::Downsampler down;
        std::vector<float> out;
        float buf[4];
        for (int i = 0; i < 48000; ++i) {
            up.process(std::sin(2.0f * 3.14159265f * 1000.0f * (float)i / 48000.0f), factor, buf);
            out.push_back(down.process(buf, factor));
        }
        EXPECT_NEAR(test::magnitudeAt(out, 1000.0, 48000.0), 0.5, 0.01);
        EXPECT(test::allFinite(out));
    }
}

static void latency() {
    TEST("round-trip latency");
    for (int factor : {2, 4}) {
        dsp::Upsampler up;
        dsp::Downsampler down;
        float buf[4], peak = 0.0f;
        int at = -1;
        for (int i = 0; i < 400; ++i) {
            up.process(i == 0 ? 1.0f : 0.0f, factor, buf);
            const float y = down.process(buf, factor);
            if (std::fabs(y) > peak) peak = std::fabs(y), at = i;
        }
        EXPECT_NEAR(at, dsp::oversamplerLatency(factor), 0.5);
    }
}

int main() {
    zeroTaps();
    matchesFullConvolution();
    roundTrip();
    latency();
    return test::finish("oversampler");
}
