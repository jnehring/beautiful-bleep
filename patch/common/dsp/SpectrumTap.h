// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Input/output spectrum for module views: the audio thread pushes samples, the
// message thread asks for log-spaced magnitudes (20 Hz ... 20 kHz).
#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <complex>
#include <cstdint>
#include <vector>

namespace bleep::dsp {

/// The last kSize input and output samples (mono), written by the audio
/// thread and read by the view's spectrum on the message thread.
class SpectrumTap {
public:
    static constexpr int kSize = 4096;
    void push(float in, float out) noexcept {
        const uint32_t w = write_.load(std::memory_order_relaxed);
        in_[w % kSize].store(in, std::memory_order_relaxed);
        out_[w % kSize].store(out, std::memory_order_relaxed);
        write_.store(w + 1, std::memory_order_release);
    }
    /// Log-spaced magnitudes in dB (20 Hz … 20 kHz) of the newest kSize samples.
    void spectrum(bool output, double sampleRate, std::vector<float>& bins) const {
        const uint32_t w = write_.load(std::memory_order_acquire);
        std::vector<std::complex<float>> x(kSize);
        const auto& src = output ? out_ : in_;
        for (int i = 0; i < kSize; ++i) {
            const float hann = 0.5f - 0.5f * std::cos(6.2831853f * (float)i / (float)(kSize - 1));
            x[(size_t)i] = src[(w + (uint32_t)i) % kSize].load(std::memory_order_relaxed) * hann;
        }
        fft(x);
        const int n = (int)bins.size();
        for (int b = 0; b < n; ++b) {
            const double f0 = 20.0 * std::pow(1000.0, (double)b / n), f1 = 20.0 * std::pow(1000.0, (double)(b + 1) / n);
            int k0 = (int)(f0 / sampleRate * kSize), k1 = (int)(f1 / sampleRate * kSize);
            k0 = std::clamp(k0, 1, kSize / 2 - 1);
            k1 = std::clamp(std::max(k1, k0 + 1), 2, kSize / 2);
            float peak = 0.0f;
            for (int k = k0; k < k1; ++k) peak = std::max(peak, std::abs(x[(size_t)k]));
            bins[(size_t)b] = 20.0f * std::log10(std::max(peak * 4.0f / kSize, 1e-6f));  // full-scale sine ≈ 0 dB
        }
    }

private:
    static void fft(std::vector<std::complex<float>>& a) {
        const size_t n = a.size();
        for (size_t i = 1, j = 0; i < n; ++i) {
            size_t bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) std::swap(a[i], a[j]);
        }
        for (size_t len = 2; len <= n; len <<= 1) {
            const float ang = -6.2831853f / (float)len;
            const std::complex<float> wl(std::cos(ang), std::sin(ang));
            for (size_t i = 0; i < n; i += len) {
                std::complex<float> w(1.0f, 0.0f);
                for (size_t j = 0; j < len / 2; ++j) {
                    const auto u = a[i + j], v = a[i + j + len / 2] * w;
                    a[i + j] = u + v;
                    a[i + j + len / 2] = u - v;
                    w *= wl;
                }
            }
        }
    }
    std::array<std::atomic<float>, kSize> in_{}, out_{};
    std::atomic<uint32_t> write_{0};
};

}  // namespace bleep::dsp
