// SPDX-License-Identifier: MIT
// Saturator: an analogue-style saturation stage that avoids the usual digital tells.
//
//   in → pre-emphasis → [ 2×/4× oversampled: bias + drive → shaper (ADAA) ] → post-emphasis → DC block → tone → out
//
// - Aliasing is removed by oversampling plus first-order antiderivative anti-aliasing (ADAA) of the shaper.
// - The shaper is smooth and asymmetric (a bias shifts the operating point, which makes even harmonics).
// - Colour is a frequency-dependent drive: the highs (or lows) are boosted into the shaper and restored after it.
// - Sag is a power-supply model: loud passages lower the gain and push the bias, then recover slowly.
// - Age is slow random drift of bias and gain, different on each channel.
// - Tape adds a little memory (the shaper hears a lagged copy of its own output), a cheap hysteresis.
#pragma once

#include "dsp/Oversampler.h"
#include "dsp/Svf.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum SaturatorCharacter { SatTube = 0, SatTape, SatDiode };

struct SaturatorParams {
    float drive = 0.4f;     ///< 0 … 1 (0 … 36 dB before the shaper)
    float bias = 0.0f;      ///< −1 … 1: operating point, asymmetry
    float color = 0.0f;     ///< −1 … 1: lows … highs drive the shaper harder (±12 dB)
    float sag = 0.0f;       ///< 0 … 1
    float age = 0.0f;       ///< 0 … 1
    float toneHz = 20000.0f;
    float level = 1.0f;
    float mix = 1.0f;
    int character = SatTube;
    int quality = 1;        ///< 0: 2× oversampling, 1: 4×
};

namespace sat {

constexpr double kLn2 = 0.6931471805599453;

inline double logCosh(double u) noexcept {
    const double a = std::fabs(u);
    return a + std::log1p(std::exp(-2.0 * a)) - kLn2;
}

/// The shaper f(u) of a character, and its antiderivative F(u) (F(0) = 0) for ADAA.
///   Tube:  tanh, symmetric until a bias is applied.
///   Tape:  u / √(1 + u²), a softer knee and a slower approach to the rails.
///   Diode: u / (1 + u) above zero (a long, soft shoulder), tanh below: asymmetric by itself.
inline double shape(int c, double u) noexcept {
    switch (c) {
        case SatTape: return u / std::sqrt(1.0 + u * u);
        case SatDiode: return u >= 0.0 ? u / (1.0 + u) : std::tanh(u);
        default: return std::tanh(u);
    }
}
inline double shapeIntegral(int c, double u) noexcept {
    switch (c) {
        case SatTape: return std::sqrt(1.0 + u * u) - 1.0;
        case SatDiode: return u >= 0.0 ? u - std::log1p(u) : logCosh(u);
        default: return logCosh(u);
    }
}

/// How strongly a character reacts to Bias, to the sag's bias shift and to its own memory.
constexpr double kBiasScale[3] = {1.0, 0.6, 0.6};
constexpr double kSagBias[3] = {1.0, 0.2, 0.5};
constexpr double kMemory[3] = {0.0, 0.2, 0.0};

}  // namespace sat

class SaturatorDsp {
public:
    void prepare(double sampleRate, uint32_t seed) {
        sr_ = sampleRate;
        seed_ = seed ? seed : 1u;
        const double twoPi = 6.283185307179586;
        aPre_ = (float)(1.0 - std::exp(-twoPi * kSplitHz / sr_));
        dcR_ = (float)(1.0 - twoPi * 10.0 / sr_);
        att_ = (float)std::exp(-1.0 / (0.004 * sr_));
        rel_ = (float)std::exp(-1.0 / (0.150 * sr_));
        // Two slow noise sources (0.4 Hz and 0.1 Hz), normalised to about unit standard deviation.
        a1_ = (float)(1.0 - std::exp(-twoPi * 0.4 / sr_));
        a2_ = (float)(1.0 - std::exp(-twoPi * 0.1 / sr_));
        norm1_ = (float)(1.0 / std::sqrt(a1_ / (2.0 - a1_) / 3.0));
        norm2_ = (float)(1.0 / std::sqrt(a2_ / (2.0 - a2_) / 3.0));
        reset();
    }

    void reset() {
        up_.reset();
        down_.reset();
        svf_.reset();
        preLp_ = postLp_ = env_ = dcX_ = dcY_ = 0.0f;
        n1_ = n2_ = 0.0f;
        rng_ = seed_;
        x1_ = f1_ = mem_ = 0.0;
        dry_.fill(0.0f);
        pos_ = 0;
        lastDrive_ = lastColor_ = lastTone_ = -1000.0f;
        lastChar_ = -1;
        factor_ = 0;
    }

    /// Latency of the wet path in base samples: the oversampler plus half an oversampled sample for ADAA.
    static double latency(int quality) noexcept {
        const int f = quality == 0 ? 2 : 4;
        return dsp::oversamplerLatency(f) + 0.5 / f;
    }

    /// One sample through the whole chain.
    float tick(float in, const SaturatorParams& p) noexcept {
        const int f = p.quality == 0 ? 2 : 4;
        const int c = std::clamp(p.character, 0, 2);
        if (f != factor_) {
            factor_ = f;
            up_.reset();
            down_.reset();
            x1_ = f1_ = mem_ = 0.0;
        }
        if (p.drive != lastDrive_ || c != lastChar_) {
            lastDrive_ = p.drive;
            lastChar_ = c;
            g_ = std::pow(10.0f, std::clamp(p.drive, 0.0f, 1.0f) * 36.0f / 20.0f);
            // Level compensation: a signal at 0.5 comes out near 0.5 at any drive and character.
            const double h = 0.5 * g_;
            comp_ = (float)(0.5 / (0.5 * (sat::shape(c, h) - sat::shape(c, -h))));
        }
        if (p.color != lastColor_) {
            lastColor_ = p.color;
            k_ = std::pow(10.0f, std::clamp(p.color, -1.0f, 1.0f) * 12.0f / 20.0f);
            aPost_ = (float)(1.0 - std::exp(-6.283185307179586 * kSplitHz / (k_ * sr_)));
        }
        if (p.toneHz != lastTone_) {
            lastTone_ = p.toneHz;
            svf_.set(p.toneHz, 0.7071f, sr_);
        }

        // Slow drift, a different one on each channel (seed).
        n1_ += a1_ * (noise() - n1_);
        n2_ += a2_ * (noise() - n2_);
        const float d1 = std::clamp(0.5f * norm1_ * n1_, -1.0f, 1.0f);
        const float d2 = std::clamp(0.5f * norm2_ * n2_, -1.0f, 1.0f);

        // Pre-emphasis: lows + k × highs.
        preLp_ += aPre_ * (in - preLp_);
        const float pre = preLp_ + k_ * (in - preLp_);

        // Sag: the supply follows the drive level and gives way under load.
        const float level = std::fabs(pre) * g_;
        env_ = level > env_ ? level + att_ * (env_ - level) : level + rel_ * (env_ - level);
        const float s = env_ * env_ / (1.0f + env_ * env_);  // only a signal that pushes the stage sags it
        const float gain = g_ * (1.0f - 0.45f * p.sag * s) * std::exp2(p.age * 0.4f * d2);
        const float bias = (p.bias + 0.5f * p.sag * s * (float)sat::kSagBias[c]) * (float)sat::kBiasScale[c] + 0.15f * p.age * d1;
        const double offset = 0.9 * bias * std::sqrt((double)g_);

        // The shaper, oversampled, with first-order ADAA.
        float os[4];
        up_.process(pre, f, os);
        const double memK = sat::kMemory[c];
        const double am = 1.0 - std::exp(-6.283185307179586 * 1200.0 / (sr_ * f));
        for (int j = 0; j < f; ++j) {
            const double u = (double)gain * os[j] + offset + memK * mem_;
            const double fu = sat::shapeIntegral(c, u), du = u - x1_;
            const double y = std::fabs(du) < 1e-5 ? sat::shape(c, 0.5 * (u + x1_)) : (fu - f1_) / du;
            x1_ = u;
            f1_ = fu;
            mem_ += am * (y - mem_);
            os[j] = (float)y;
        }
        const float w = down_.process(os, f);

        // Post-emphasis is the exact inverse of the pre-emphasis; the DC the bias made goes away here.
        postLp_ += aPost_ * (w - postLp_);
        float x = postLp_ + (w - postLp_) / k_;
        const float dc = x - dcX_ + dcR_ * dcY_;
        dcX_ = x;
        dcY_ = dc;
        x = p.toneHz >= 19999.0f ? dc : svf_.process(dc).lp;
        const float wet = x * comp_ * p.level;

        // The dry signal, delayed like the wet one (4-point Lagrange), so Mix stays in phase.
        dry_[(size_t)pos_] = in;
        const double delay = latency(p.quality);
        const int whole = (int)std::floor(delay);
        const float t = (float)(delay - whole);
        auto at = [&](int k) { return dry_[(size_t)((pos_ - k + kDelay) % kDelay)]; };
        const float dryOut = -t * (t - 1.0f) * (t - 2.0f) / 6.0f * at(whole - 1) +
                             (t + 1.0f) * (t - 1.0f) * (t - 2.0f) / 2.0f * at(whole) -
                             (t + 1.0f) * t * (t - 2.0f) / 2.0f * at(whole + 1) +
                             (t + 1.0f) * t * (t - 1.0f) / 6.0f * at(whole + 2);
        pos_ = (pos_ + 1) % kDelay;
        return dryOut + p.mix * (wet - dryOut);
    }

private:
    static constexpr double kSplitHz = 700.0;
    static constexpr int kDelay = 128;

    float noise() noexcept {  // xorshift32 → −1 … 1
        rng_ ^= rng_ << 13;
        rng_ ^= rng_ >> 17;
        rng_ ^= rng_ << 5;
        return (float)((double)rng_ * (2.0 / 4294967295.0) - 1.0);
    }

    double sr_ = 48000.0;
    uint32_t seed_ = 1u, rng_ = 1u;
    float aPre_ = 0.0f, aPost_ = 0.0f, dcR_ = 0.999f, att_ = 0.0f, rel_ = 0.0f;
    float a1_ = 0.0f, a2_ = 0.0f, norm1_ = 1.0f, norm2_ = 1.0f;
    float g_ = 1.0f, k_ = 1.0f, comp_ = 1.0f;
    float lastDrive_ = -1000.0f, lastColor_ = -1000.0f, lastTone_ = -1000.0f;
    int lastChar_ = -1, factor_ = 0;
    float preLp_ = 0.0f, postLp_ = 0.0f, env_ = 0.0f, dcX_ = 0.0f, dcY_ = 0.0f, n1_ = 0.0f, n2_ = 0.0f;
    double x1_ = 0.0, f1_ = 0.0, mem_ = 0.0;
    dsp::Upsampler up_;
    dsp::Downsampler down_;
    dsp::Svf svf_;
    std::array<float, kDelay> dry_{};
    int pos_ = 0;
};

}  // namespace bleep::patch
