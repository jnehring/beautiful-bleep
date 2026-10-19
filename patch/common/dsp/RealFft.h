// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// A small radix-2 FFT for the spectral modules (Spectral Blend, Stretch): in place on
// separate real and imaginary arrays, tables made once in prepare() (off the audio
// thread), no allocation afterwards. Two real signals can share one transform
// (packed as re + j·im) and are told apart again with splitPacked(); the inverse of
// two Hermitian spectra packs the same way (see joinPacked()).
//
// Convention: forward is X[k] = Σ x[n]·e^(−2πjkn/N) with no scaling; inverse() divides
// by N, so inverse(forward(x)) == x.
#pragma once

#include <cmath>
#include <cstdint>
#include <utility>
#include <vector>

namespace bleep::dsp {

class RealFft {
public:
    /// n: a power of two, 8 … 65536. Allocates.
    void prepare(int n) {
        n_ = n;
        int bits = 0;
        while ((1 << bits) < n) ++bits;
        n_ = 1 << bits;
        cos_.resize((size_t)n_ / 2);
        sin_.resize((size_t)n_ / 2);
        for (int i = 0; i < n_ / 2; ++i) {
            const double a = -6.283185307179586 * (double)i / (double)n_;
            cos_[(size_t)i] = (float)std::cos(a);
            sin_[(size_t)i] = (float)std::sin(a);
        }
        rev_.resize((size_t)n_);
        for (int i = 0; i < n_; ++i) {
            int r = 0;
            for (int b = 0; b < bits; ++b)
                if (i & (1 << b)) r |= 1 << (bits - 1 - b);
            rev_[(size_t)i] = r;
        }
    }
    int size() const noexcept { return n_; }

    void forward(float* re, float* im) const noexcept { run(re, im, false); }
    void inverse(float* re, float* im) const noexcept {
        run(re, im, true);
        const float s = 1.0f / (float)n_;
        for (int i = 0; i < n_; ++i) {
            re[i] *= s;
            im[i] *= s;
        }
    }

    /// After forward() of a + j·b: the spectra of a and b at bin k (0 … N/2).
    void splitPacked(const float* zr, const float* zi, int k, float& ar, float& ai, float& br, float& bi) const noexcept {
        const int m = (n_ - k) & (n_ - 1);
        ar = 0.5f * (zr[k] + zr[m]);
        ai = 0.5f * (zi[k] - zi[m]);
        br = 0.5f * (zi[k] + zi[m]);
        bi = 0.5f * (zr[m] - zr[k]);
    }

private:
    void run(float* re, float* im, bool inv) const noexcept {
        for (int i = 0; i < n_; ++i) {
            const int j = rev_[(size_t)i];
            if (j > i) {
                std::swap(re[i], re[j]);
                std::swap(im[i], im[j]);
            }
        }
        const float sgn = inv ? -1.0f : 1.0f;  // conjugated twiddles for the inverse
        for (int len = 2; len <= n_; len <<= 1) {
            const int half = len >> 1, step = n_ / len;
            for (int i = 0; i < n_; i += len) {
                for (int k = 0; k < half; ++k) {
                    const float wr = cos_[(size_t)(k * step)], wi = sgn * sin_[(size_t)(k * step)];
                    const int a = i + k, b = a + half;
                    const float tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
        }
    }

    int n_ = 0;
    std::vector<float> cos_, sin_;
    std::vector<int> rev_;
};

}  // namespace bleep::dsp
