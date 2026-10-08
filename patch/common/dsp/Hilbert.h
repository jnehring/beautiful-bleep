// SPDX-License-Identifier: MIT
// IIR Hilbert transformer and single-sideband frequency shifter
// (specs/modules/frequency-shifter.md §4.1).
//
// Two parallel chains of 8 allpass sections in z⁻² (the polyphase half-band
// design rotated by fs/4, as in Niemitalo's and de Soras' HIIR Hilbert
// filters). Coefficients come from the elliptic-function design for a given
// transition band, computed in prepare() for the actual sample rate: with the
// band edge at 15 Hz the two outputs differ by 90° ± 0.05° from 15 Hz to
// fs/2 − 15 Hz. Both outputs share the same (frequency-dependent) delay, so
// they are phase-coherent with each other but not with the dry input.
#pragma once

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::dsp {

class HilbertTransformer {
public:
    static constexpr int kCoefs = 16;  // 8 per chain

    /// lowHz: lower edge of the 90° band (the upper edge mirrors it below fs/2).
    void prepare(double sampleRate, double lowHz = 15.0) noexcept {
        design(coefs_.data(), kCoefs, std::clamp(lowHz / sampleRate, 1e-5, 0.1));
        reset();
    }
    void reset() noexcept {
        for (auto& s : state_) s = {};
        delayed_ = 0.0;
    }

    /// i: in-phase, q: lags i by 90° (for cos in, i ≈ cos and q ≈ sin of the
    /// same, delayed, phase).
    void process(float x, float& i, float& q) noexcept {
        double a = x, b = x;
        for (int k = 0; k < kCoefs; k += 2) {
            a = state_[(size_t)k].process(a, coefs_[(size_t)k]);
            b = state_[(size_t)k + 1].process(b, coefs_[(size_t)k + 1]);
        }
        i = (float)a;
        q = (float)delayed_;
        delayed_ = b;
    }

    const std::array<double, kCoefs>& coefficients() const noexcept { return coefs_; }

private:
    // y[n] = c·(x[n] + y[n−2]) − x[n−2]: allpass (c − z⁻²)/(1 − c·z⁻²).
    struct Stage {
        double x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0;
        double process(double x, double c) noexcept {
            double y = c * (x + y2) - x2;
            if (std::fabs(y) < 1e-20) y = 0.0;
            x2 = x1;
            x1 = x;
            y2 = y1;
            y1 = y;
            return y;
        }
    };

    // Elliptic polyphase design (after Laurent de Soras, HIIR, WTFPL):
    // coefficients for a half-band of the given normalised transition width.
    static void design(double* c, int n, double transition) noexcept {
        constexpr double pi = 3.14159265358979323846;
        double k = std::tan((1.0 - transition * 2.0) * pi / 4.0);
        k *= k;
        const double kk = std::pow(1.0 - k * k, 0.25);
        const double e = 0.5 * (1.0 - kk) / (1.0 + kk);
        const double e4 = e * e * e * e;
        const double q = e * (1.0 + e4 * (2.0 + e4 * (15.0 + 150.0 * e4)));
        const int order = n * 2 + 1;
        for (int idx = 0; idx < n; ++idx) {
            const int cc = idx + 1;
            double num = 0.0, den = 0.0, term = 0.0;
            int i = 0;
            double sign = 1.0;
            do {
                term = std::pow(q, (double)(i * (i + 1))) * std::sin((i * 2 + 1) * cc * pi / order) * sign;
                num += term;
                sign = -sign;
                ++i;
            } while (std::fabs(term) > 1e-100 && i < 64);
            num *= std::pow(q, 0.25);
            i = 1;
            sign = -1.0;
            do {
                term = std::pow(q, (double)(i * i)) * std::cos(i * 2 * cc * pi / order) * sign;
                den += term;
                sign = -sign;
                ++i;
            } while (std::fabs(term) > 1e-100 && i < 64);
            den += 0.5;
            const double ww = num / den, w2 = ww * ww;
            const double x = std::sqrt((1.0 - w2 * k) * (1.0 - w2 / k)) / (1.0 + w2);
            c[idx] = (1.0 - x) / (1.0 + x);
        }
    }

    std::array<double, kCoefs> coefs_{};
    std::array<Stage, kCoefs> state_{};
    double delayed_ = 0.0;
};

/// Quadrature sine/cosine oscillator: double-precision phase, 4096-point table
/// with linear interpolation (error ≈ −110 dB). Negative frequencies run the
/// phase backwards, so a shift can sweep through zero.
class QuadratureOsc {
public:
    void reset(double phaseCycles = 0.0) noexcept { phase_ = phaseCycles - std::floor(phaseCycles); }
    /// Sets the phase in cycles [0, 1) (e.g. derived from the song position).
    void setPhase(double cycles) noexcept { reset(cycles); }
    double phase() const noexcept { return phase_; }
    /// Outputs the current cos/sin, then advances by hz.
    void process(double hz, double sampleRate, float& c, float& s) noexcept {
        lookup(phase_, c, s);
        phase_ += hz / sampleRate;
        phase_ -= std::floor(phase_);
    }
    static void lookup(double cycles, float& c, float& s) noexcept {
        const auto& t = table();
        const double p = (cycles - std::floor(cycles)) * kSize;
        const int i = std::min((int)p, kSize - 1);
        const float f = (float)(p - i);
        s = t[(size_t)i] + f * (t[(size_t)i + 1] - t[(size_t)i]);
        const int j = (i + kSize / 4) & (kSize - 1);
        c = t[(size_t)j] + f * (t[(size_t)j + 1] - t[(size_t)j]);
    }

private:
    static constexpr int kSize = 4096;
    static const std::array<float, kSize + 1>& table() noexcept {
        static const std::array<float, kSize + 1> t = [] {
            std::array<float, kSize + 1> a{};
            for (int i = 0; i <= kSize; ++i) a[(size_t)i] = (float)std::sin(6.28318530717958647692 * i / kSize);
            return a;
        }();
        return t;
    }
    double phase_ = 0.0;
};

/// Single-sideband frequency shifter for one channel: Hilbert pair times a
/// quadrature oscillator. up = I·cos φ − Q·sin φ moves every component up by
/// hz, down = I·cos φ + Q·sin φ moves it down; negative hz swaps them, and
/// components pushed below 0 Hz reflect back (through-zero shifting).
class FrequencyShifter {
public:
    struct Out {
        float up, down;
    };
    void prepare(double sampleRate, double lowHz = 15.0) noexcept {
        sr_ = sampleRate;
        hilbert_.prepare(sampleRate, lowHz);
        osc_.reset();
    }
    void reset() noexcept {
        hilbert_.reset();
        osc_.reset();
    }
    QuadratureOsc& oscillator() noexcept { return osc_; }
    Out process(float x, double shiftHz) noexcept {
        float i, q, c, s;
        hilbert_.process(x, i, q);
        osc_.process(shiftHz, sr_, c, s);
        return {i * c - q * s, i * c + q * s};
    }

private:
    double sr_ = 48000.0;
    HilbertTransformer hilbert_;
    QuadratureOsc osc_;
};

}  // namespace bleep::dsp
