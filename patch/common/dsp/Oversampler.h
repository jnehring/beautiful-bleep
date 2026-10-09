// SPDX-License-Identifier: MIT
// 2× and 4× oversampling with linear-phase half-band FIR stages, for
// nonlinear processing such as the Multiplier (doc/specs/modules/multiplier.md
// §4.3). Each stage delays by (kTaps − 1) / 2 = 47 samples at its own rate:
// Upsampler + Downsampler together delay by latency(factor) base samples.
//
// The stages are polyphase: every second tap of a half-band filter is zero,
// so interpolation computes one short dot product per input sample (the other
// phase is the centre tap alone) and decimation one per output sample.
#pragma once

#include <array>
#include <cmath>

namespace bleep::dsp {

/// Windowed-sinc low-pass at a quarter of its sample rate, unity DC gain
/// (direct form; the resamplers below use the same taps in polyphase form).
class HalfbandFir {
public:
    static constexpr int kTaps = 95;

    HalfbandFir() noexcept { reset(); }
    void reset() noexcept {
        buf_.fill(0.0f);
        pos_ = 0;
    }
    float process(float x) noexcept {
        buf_[(size_t)pos_] = buf_[(size_t)(pos_ + kTaps)] = x;
        const float* b = &buf_[(size_t)pos_];  // b[k] = x[n − (kTaps − 1) + k]
        // Half-band: every second tap is exactly zero, so only the centre tap
        // and the odd distances from it contribute (half the multiplies).
        const auto& h = taps();
        constexpr int m = (kTaps - 1) / 2;
        float y = h[(size_t)m] * b[m];
        for (int k = (m + 1) & 1; k < kTaps; k += 2) y += h[(size_t)k] * b[k];
        if (++pos_ == kTaps) pos_ = 0;
        return y;
    }
    /// Feeds a sample whose output is not needed (decimation).
    void push(float x) noexcept {
        buf_[(size_t)pos_] = buf_[(size_t)(pos_ + kTaps)] = x;
        if (++pos_ == kTaps) pos_ = 0;
    }

    static const std::array<float, kTaps>& taps() noexcept {
        static const std::array<float, kTaps> h = [] {
            std::array<float, kTaps> t{};
            constexpr double pi = 3.14159265358979323846;
            const int m = (kTaps - 1) / 2;
            double sum = 0.0;
            for (int n = 0; n < kTaps; ++n) {
                const double k = n - m;
                // Every second tap of a half-band filter is exactly zero.
                const double sinc = n == m ? 0.5 : ((n - m) % 2 == 0 ? 0.0 : std::sin(0.5 * pi * k) / (pi * k));
                const double w = 0.42 - 0.5 * std::cos(2.0 * pi * n / (kTaps - 1)) + 0.08 * std::cos(4.0 * pi * n / (kTaps - 1));
                t[(size_t)n] = (float)(sinc * w);
                sum += sinc * w;
            }
            for (auto& v : t) v = (float)(v / sum);
            return t;
        }();
        return h;
    }

private:
    std::array<float, 2 * kTaps> buf_{};
    int pos_ = 0;
};

/// The half-band taps in polyphase form: the 48 even-indexed taps, and the
/// centre tap that forms the other phase on its own.
namespace halfband {

constexpr int kPhaseTaps = 48;  ///< h[0], h[2], … h[94]
constexpr int kCentre = 23;     ///< the centre tap h[47] meets x[n − 23] of the even phase

inline const std::array<float, kPhaseTaps>& even() noexcept {
    static const std::array<float, kPhaseTaps> e = [] {
        std::array<float, kPhaseTaps> t{};
        for (int k = 0; k < kPhaseTaps; ++k) t[(size_t)k] = HalfbandFir::taps()[(size_t)(2 * k)];
        return t;
    }();
    return e;
}
inline float centre() noexcept { return HalfbandFir::taps()[47]; }

/// The last kPhaseTaps values, readable as one contiguous block (newest first).
struct Ring {
    std::array<float, 2 * kPhaseTaps> buf{};
    int pos = 0;
    void reset() noexcept { buf.fill(0.0f), pos = 0; }
    void push(float x) noexcept {
        pos = pos == 0 ? kPhaseTaps - 1 : pos - 1;
        buf[(size_t)pos] = buf[(size_t)(pos + kPhaseTaps)] = x;
    }
    /// x[n − k] for k = 0 … kPhaseTaps − 1.
    const float* recent() const noexcept { return &buf[(size_t)pos]; }
    float dot() const noexcept {
        const float* x = recent();
        const auto& h = even();
        // Eight independent sums, so the compiler can vectorise.
        float s[8] = {};
        for (int k = 0; k < kPhaseTaps; k += 8)
            for (int j = 0; j < 8; ++j) s[j] += h[(size_t)(k + j)] * x[k + j];
        return ((s[0] + s[1]) + (s[2] + s[3])) + ((s[4] + s[5]) + (s[6] + s[7]));
    }
};

/// One sample → two at twice the rate.
struct Up {
    Ring ring;
    void reset() noexcept { ring.reset(); }
    void process(float x, float* out) noexcept {
        ring.push(x);
        out[0] = 2.0f * ring.dot();
        out[1] = 2.0f * centre() * ring.recent()[kCentre];
    }
};

/// Two samples → one at half the rate.
struct Down {
    Ring evens, odds;
    void reset() noexcept { evens.reset(), odds.reset(); }
    float process(const float* in) noexcept {
        evens.push(in[0]);
        const float y = evens.dot() + centre() * odds.recent()[kCentre];
        odds.push(in[1]);
        return y;
    }
};

}  // namespace halfband

/// One input sample → `factor` samples (1, 2 or 4).
class Upsampler {
public:
    void reset() noexcept { a_.reset(), b_.reset(); }
    void process(float x, int factor, float* out) noexcept {
        if (factor <= 1) {
            out[0] = x;
            return;
        }
        float u[2];
        a_.process(x, u);
        if (factor == 2) {
            out[0] = u[0], out[1] = u[1];
            return;
        }
        b_.process(u[0], out);
        b_.process(u[1], out + 2);
    }

private:
    halfband::Up a_, b_;
};

/// `factor` samples (1, 2 or 4) → one output sample.
class Downsampler {
public:
    void reset() noexcept { a_.reset(), b_.reset(); }
    float process(const float* in, int factor) noexcept {
        if (factor <= 1) return in[0];
        if (factor == 2) return a_.process(in);
        const float v[2] = {b_.process(in), b_.process(in + 2)};
        return a_.process(v);
    }

private:
    halfband::Down a_, b_;  // a_: 2× → 1×, b_: 4× → 2×
};

/// Delay of an Upsampler + Downsampler round trip, in base samples.
inline double oversamplerLatency(int factor) noexcept { return factor <= 1 ? 0.0 : factor == 2 ? 47.0 : 70.5; }

}  // namespace bleep::dsp
