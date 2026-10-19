// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// A small in-place radix-2 FFT with tables built once (prepare), so the audio
// thread never allocates. Sizes are powers of two up to the size given to
// prepare().
#pragma once

#include <cmath>
#include <complex>
#include <cstddef>
#include <utility>
#include <vector>

namespace bleep::dsp {

class Fft {
public:
    /// Builds the tables for `n` points (a power of two).
    void prepare(size_t n) {
        n_ = n;
        cos_.assign(n / 2, 0.0f);
        sin_.assign(n / 2, 0.0f);
        for (size_t i = 0; i < n / 2; ++i) {
            const double a = -6.283185307179586 * (double)i / (double)n;
            cos_[i] = (float)std::cos(a);
            sin_[i] = (float)std::sin(a);
        }
        rev_.assign(n, 0);
        size_t bits = 0;
        while (((size_t)1 << bits) < n) ++bits;
        for (size_t i = 0; i < n; ++i) {
            size_t r = 0;
            for (size_t b = 0; b < bits; ++b)
                if (i & ((size_t)1 << b)) r |= (size_t)1 << (bits - 1 - b);
            rev_[i] = r;
        }
    }
    size_t size() const noexcept { return n_; }

    /// Forward transform of `a` (n_ values) in place.
    void forward(std::complex<float>* a) const noexcept {
        for (size_t i = 0; i < n_; ++i)
            if (i < rev_[i]) std::swap(a[i], a[rev_[i]]);
        for (size_t len = 2; len <= n_; len <<= 1) {
            const size_t half = len / 2, stride = n_ / len;
            for (size_t i = 0; i < n_; i += len)
                for (size_t j = 0; j < half; ++j) {
                    const std::complex<float> w(cos_[j * stride], sin_[j * stride]);
                    const auto u = a[i + j], v = a[i + j + half] * w;
                    a[i + j] = u + v;
                    a[i + j + half] = u - v;
                }
        }
    }

private:
    size_t n_ = 0;
    std::vector<float> cos_, sin_;
    std::vector<size_t> rev_;
};

}  // namespace bleep::dsp
