// SPDX-License-Identifier: GPL-3.0-only
// Spectrum core (doc/specs/modules/spectrum.md §4): a windowed FFT every quarter of its
// length, shown on a logarithmic frequency axis (averaged, tilted, with a peak line), and
// three measurements of the same spectrum: the strongest partial, the spectral centroid and
// the flux (how much new energy arrived), the last as a trigger.
#pragma once

#include "dsp/Fft.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstdint>
#include <vector>

namespace bleep::patch {

constexpr int kSpectrumBins = 256;           ///< display columns, 20 Hz upwards, log spaced
constexpr float kSpectrumLowHz = 20.0f;
constexpr int kSpectrumSizes = 4;            ///< 1024, 2048, 4096, 8192
constexpr size_t kSpectrumMaxSize = 8192;
constexpr float kSpectrumMiddleC = 261.6255653f;
inline float spectrumHzToPitch(float hz) noexcept { return hz > 1e-3f ? std::log2(hz / kSpectrumMiddleC) : -4.0f; }

enum SpectrumPeak { PeakOff = 0, PeakFall, PeakHold };

struct SpectrumParams {
    int size = 2;             ///< index into 1024 << size
    float average = 0.15f;    ///< seconds
    float tilt = 0.0f;        ///< dB per octave about 1 kHz, display only
    int peak = PeakFall;
    float sensitivity = 0.5f; ///< flux trigger, 0..1
};

struct SpectrumOutputs {
    float dominant = -4.0f, centroid = -4.0f, flux = 0.0f, trigger = 0.0f;
};

class SpectrumDsp {
public:
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        for (int s = 0; s < kSpectrumSizes; ++s) {
            const size_t n = (size_t)1024 << s;
            fft_[(size_t)s].prepare(n);
            auto& w = window_[(size_t)s];
            w.assign(n, 0.0f);
            double sum = 0.0;
            for (size_t i = 0; i < n; ++i) {
                w[i] = 0.5f - 0.5f * (float)std::cos(6.283185307179586 * (double)i / (double)n);
                sum += w[i];
            }
            norm_[(size_t)s] = (float)(2.0 / sum);
            buildMap(s);
        }
        ring_.assign(kSpectrumMaxSize, 0.0f);
        work_.assign(kSpectrumMaxSize, {});
        for (auto& v : avgPow_) v.assign(kSpectrumMaxSize / 2 + 1, 0.0f);
        amp_.assign(kSpectrumMaxSize / 2 + 1, 0.0f);
        prevAmp_.assign(kSpectrumMaxSize / 2 + 1, 0.0f);
        triggerLen_ = std::max(1, (int)(sampleRate * 0.002));
        slew_ = (float)(1.0 - std::exp(-1.0 / (0.01 * sampleRate)));
        reset();
    }
    void reset() noexcept {
        std::fill(ring_.begin(), ring_.end(), 0.0f);
        for (auto& v : avgPow_) std::fill(v.begin(), v.end(), 0.0f);
        std::fill(prevAmp_.begin(), prevAmp_.end(), 0.0f);
        display_.fill(-200.0f);
        peaks_.fill(-200.0f);
        write_ = 0;
        sinceHop_ = 0;
        hops_ = 0;
        out_ = {};
        fluxMean_ = 0.0f;
        refractory_ = 0;
        triggerLeft_ = 0;
        domTarget_ = cenTarget_ = -4.0f;
        lastSize_ = -1;
    }
    /// Clears the peak line.
    void resetPeaks() noexcept { peaks_.fill(-200.0f); }

    /// One sample in; returns the outputs (held between analyses, glided for the pitches).
    const SpectrumOutputs& tick(const SpectrumParams& p, float x) noexcept {
        ring_[write_] = x;
        write_ = (write_ + 1) % kSpectrumMaxSize;
        const size_t n = (size_t)1024 << std::clamp(p.size, 0, kSpectrumSizes - 1);
        if (p.size != lastSize_) {
            lastSize_ = p.size;
            sinceHop_ = 0;
            std::fill(prevAmp_.begin(), prevAmp_.end(), 0.0f);
        }
        if (++sinceHop_ >= n / 4) {
            sinceHop_ = 0;
            analyse(p, std::clamp(p.size, 0, kSpectrumSizes - 1));
        }
        out_.dominant += (domTarget_ - out_.dominant) * slew_;
        out_.centroid += (cenTarget_ - out_.centroid) * slew_;
        out_.trigger = triggerLeft_ > 0 ? 1.0f : 0.0f;
        if (triggerLeft_ > 0) --triggerLeft_;
        return out_;
    }

    // ---- display (valid after hops() changes) -------------------------------------------------
    uint32_t hops() const noexcept { return hops_; }
    const std::array<float, kSpectrumBins>& display() const noexcept { return display_; }
    const std::array<float, kSpectrumBins>& peaks() const noexcept { return peaks_; }
    float binHz(int b) const noexcept { return centreHz_[(size_t)b]; }
    /// Highest frequency on the display axis.
    float topHz() const noexcept { return centreHz_[kSpectrumBins - 1]; }
    bool valid() const noexcept { return valid_; }

private:
    void buildMap(int s) {
        const size_t n = (size_t)1024 << s;
        const double top = std::min(20000.0, 0.95 * 0.5 * sr_);
        const double ratio = std::pow(top / kSpectrumLowHz, 1.0 / kSpectrumBins);
        for (int b = 0; b < kSpectrumBins; ++b) {
            const double f0 = kSpectrumLowHz * std::pow(ratio, b), f1 = f0 * ratio;
            auto& m = map_[(size_t)s][(size_t)b];
            m.lo = (int)std::ceil(f0 * (double)n / sr_);
            m.hi = (int)std::floor(f1 * (double)n / sr_);
            m.centre = (float)std::sqrt(f0 * f1);
            if (s == 0) centreHz_[(size_t)b] = m.centre;
        }
    }

    void analyse(const SpectrumParams& p, int s) noexcept {
        const size_t n = (size_t)1024 << s;
        auto& x = work_;
        for (size_t i = 0; i < n; ++i)
            x[i] = ring_[(write_ + kSpectrumMaxSize - n + i) % kSpectrumMaxSize] * window_[(size_t)s][i];
        fft_[(size_t)s].forward(x.data());
        const size_t half = n / 2;
        const float hopSec = (float)(n / 4) / (float)sr_;
        const float alpha = p.average <= hopSec ? 1.0f : 1.0f - std::exp(-hopSec / p.average);
        auto& avg = avgPow_[(size_t)s];
        const float scale = norm_[(size_t)s];
        double sumA = 0.0, sumFA = 0.0, flux = 0.0;
        float best = 0.0f;
        size_t bestK = 0;
        const size_t kLo = std::max<size_t>(1, (size_t)std::ceil(kSpectrumLowHz * (double)n / sr_));
        const size_t kHi = std::min(half - 1, (size_t)(0.95 * 0.5 * sr_ * (double)n / sr_));
        for (size_t k = 0; k <= half; ++k) {
            const float a = std::abs(x[k]) * scale;
            avg[k] += (a * a - avg[k]) * alpha;
            const float sm = std::sqrt(avg[k]);
            if (k >= kLo && k <= kHi) {
                amp_[k] = sm;
                sumA += sm;
                sumFA += (double)sm * (double)k;
                if (sm > best) { best = sm; bestK = k; }
                flux += std::max(0.0f, a - prevAmp_[k]);
            }
            prevAmp_[k] = a;
        }
        // Display columns.
        for (int b = 0; b < kSpectrumBins; ++b) {
            const auto& m = map_[(size_t)s][(size_t)b];
            float v;
            if (m.hi >= m.lo) {
                v = 0.0f;
                for (int k = std::max(m.lo, 0); k <= std::min<int>(m.hi, (int)half); ++k) v = std::max(v, std::sqrt(avg[(size_t)k]));
            } else {  // narrower than one FFT bin: interpolate between the neighbours
                const double pos = (double)m.centre * (double)n / sr_;
                const size_t k = std::min((size_t)pos, half - 1);
                const float u = (float)(pos - (double)k);
                v = std::sqrt(avg[k]) * (1.0f - u) + std::sqrt(avg[k + 1]) * u;
            }
            float db = 20.0f * std::log10(std::max(v, 1e-9f));
            db += p.tilt * std::log2(m.centre / 1000.0f);
            display_[(size_t)b] = db;
            float& pk = peaks_[(size_t)b];
            if (p.peak == PeakOff) pk = db;
            else if (p.peak == PeakFall) pk = std::max(db, pk - 12.0f * hopSec);
            else pk = std::max(db, pk);
        }
        // Measurements.
        valid_ = best > 0.001f && bestK > 1;  // louder than -60 dBFS
        if (valid_) {
            const float a = std::log(std::max(amp_[bestK - 1], 1e-9f)), b = std::log(std::max(amp_[bestK], 1e-9f)),
                        c = std::log(std::max(amp_[bestK + 1], 1e-9f));
            const float den = a - 2.0f * b + c;
            const float d = den < -1e-9f ? std::clamp(0.5f * (a - c) / den, -0.5f, 0.5f) : 0.0f;
            const double hz = ((double)bestK + (double)d) * sr_ / (double)n;
            domTarget_ = spectrumHzToPitch((float)hz);
            cenTarget_ = spectrumHzToPitch((float)(sumFA / sumA * sr_ / (double)n));
        }
        const float f = sumA > 1e-3 ? (float)std::min(1.0, flux / sumA) : 0.0f;
        out_.flux += (f - out_.flux) * 0.5f;
        const float factor = 1.0f + (1.0f - std::clamp(p.sensitivity, 0.0f, 1.0f)) * 4.0f;
        if (refractory_ > 0) --refractory_;
        if (sumA > 0.002 && refractory_ == 0 && f > fluxMean_ * factor + 0.05f && hops_ > 4) {
            triggerLeft_ = triggerLen_;
            refractory_ = std::max(1, (int)(0.06f / hopSec));
        }
        fluxMean_ += (f - fluxMean_) * 0.1f;
        ++hops_;
    }

    struct Map { int lo = 0, hi = -1; float centre = 0.0f; };

    double sr_ = 48000.0;
    std::array<dsp::Fft, kSpectrumSizes> fft_;
    std::array<std::vector<float>, kSpectrumSizes> window_, avgPow_;
    std::array<float, kSpectrumSizes> norm_{};
    std::array<std::array<Map, kSpectrumBins>, kSpectrumSizes> map_{};
    std::array<float, kSpectrumBins> centreHz_{};
    std::vector<float> ring_, amp_, prevAmp_;
    std::vector<std::complex<float>> work_;
    std::array<float, kSpectrumBins> display_{}, peaks_{};
    size_t write_ = 0, sinceHop_ = 0;
    uint32_t hops_ = 0;
    int lastSize_ = -1, triggerLen_ = 96, triggerLeft_ = 0, refractory_ = 0;
    float slew_ = 0.002f, fluxMean_ = 0.0f, domTarget_ = -4.0f, cenTarget_ = -4.0f;
    bool valid_ = false;
    SpectrumOutputs out_;
};

}  // namespace bleep::patch
