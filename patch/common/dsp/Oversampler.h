// SPDX-License-Identifier: MIT
// 2× and 4× oversampling with linear-phase half-band FIR stages, for
// nonlinear processing such as the Multiplier (specs/modules/multiplier.md
// §4.3). Each stage delays by (kTaps − 1) / 2 samples at its own rate.
#pragma once

#include <array>
#include <cmath>

namespace bleep::dsp {

/// Windowed-sinc low-pass at a quarter of its sample rate, unity DC gain.
class HalfbandFir {
public:
    static constexpr int kTaps = 95;

    HalfbandFir() noexcept { reset(); }
    void reset() noexcept {
        buf_.fill(0.0f);
        pos_ = 0;
    }
    /// Stores a sample whose output is not needed (decimation).
    void push(float x) noexcept {
        buf_[(size_t)pos_] = buf_[(size_t)(pos_ + kTaps)] = x;
        if (++pos_ == kTaps) pos_ = 0;
    }
    float process(float x) noexcept {
        buf_[(size_t)pos_] = buf_[(size_t)(pos_ + kTaps)] = x;
        const float* b = &buf_[(size_t)pos_];  // b[k] = x[n − (kTaps − 1) + k]
        const auto& h = taps();
        // Half-band: every tap an odd distance from the centre is zero.
        constexpr int m = (kTaps - 1) / 2;
        float y = h[(size_t)m] * b[m];
        for (int k = (m + 1) % 2; k < kTaps; k += 2) y += h[(size_t)k] * b[k];
        if (++pos_ == kTaps) pos_ = 0;
        return y;
    }

    static const std::array<float, kTaps>& taps() noexcept {
        static const std::array<float, kTaps> h = [] {
            std::array<float, kTaps> t{};
            constexpr double pi = 3.14159265358979323846;
            const int m = (kTaps - 1) / 2;
            double sum = 0.0;
            for (int n = 0; n < kTaps; ++n) {
                const double k = n - m;
                const double sinc = n == m ? 0.5 : std::sin(0.5 * pi * k) / (pi * k);
                const double w = 0.42 - 0.5 * std::cos(2.0 * pi * n / (kTaps - 1)) + 0.08 * std::cos(4.0 * pi * n / (kTaps - 1));
                t[(size_t)n] = (float)(sinc * w);
                sum += sinc * w;
            }
            for (int n = 0; n < kTaps; ++n)
                t[(size_t)n] = n != m && (n - m) % 2 == 0 ? 0.0f : (float)(t[(size_t)n] / sum);
            return t;
        }();
        return h;
    }

private:
    std::array<float, 2 * kTaps> buf_{};
    int pos_ = 0;
};

/// One input sample → `factor` samples (1, 2 or 4).
class Upsampler {
public:
    void reset() noexcept { a_.reset(), b_.reset(); }
    void process(float x, int factor, float* out) noexcept {
        if (factor <= 1) {
            out[0] = x;
            return;
        }
        const float u0 = 2.0f * a_.process(x), u1 = 2.0f * a_.process(0.0f);
        if (factor == 2) {
            out[0] = u0, out[1] = u1;
            return;
        }
        out[0] = 2.0f * b_.process(u0), out[1] = 2.0f * b_.process(0.0f);
        out[2] = 2.0f * b_.process(u1), out[3] = 2.0f * b_.process(0.0f);
    }

private:
    HalfbandFir a_, b_;
};

/// `factor` samples (1, 2 or 4) → one output sample.
class Downsampler {
public:
    void reset() noexcept { a_.reset(), b_.reset(); }
    float process(const float* in, int factor) noexcept {
        if (factor <= 1) return in[0];
        float s0 = in[0], s1 = in[1];
        if (factor == 4) {
            s0 = b_.process(in[0]);
            b_.push(in[1]);
            s1 = b_.process(in[2]);
            b_.push(in[3]);
        }
        const float y = a_.process(s0);
        a_.push(s1);
        return y;
    }

private:
    HalfbandFir a_, b_;  // a_: 2× → 1×, b_: 4× → 2×
};

}  // namespace bleep::dsp
