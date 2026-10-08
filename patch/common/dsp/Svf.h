// SPDX-License-Identifier: MIT
// Zero-delay-feedback state-variable filter (topology-preserving transform,
// after Zavalishin, "The Art of VA Filter Design"). Stable and click-free
// when cutoff and resonance change every sample, including at audio rate.
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::dsp {

struct SvfOutputs {
    float lp, bp, hp;
    float notch() const noexcept { return lp + hp; }
};

class Svf {
public:
    void reset() noexcept { ic1_ = ic2_ = 0.0f; }

    /// Sets coefficients. cutoffHz is clamped below Nyquist; q > 0.
    void set(float cutoffHz, float q, double sampleRate) noexcept {
        const double nyquistGuard = 0.49 * sampleRate;
        const double f = std::clamp((double)cutoffHz, 5.0, nyquistGuard);
        g_ = (float)std::tan(3.14159265358979323846 * f / sampleRate);
        k_ = 1.0f / std::max(q, 0.05f);
        a1_ = 1.0f / (1.0f + g_ * (g_ + k_));
        a2_ = g_ * a1_;
        a3_ = g_ * a2_;
    }

    SvfOutputs process(float v0) noexcept {
        const float v3 = v0 - ic2_;
        const float v1 = a1_ * ic1_ + a2_ * v3;
        const float v2 = ic2_ + a2_ * ic1_ + a3_ * v3;
        ic1_ = 2.0f * v1 - ic1_;
        ic2_ = 2.0f * v2 - ic2_;
        return {v2, v1, v0 - k_ * v1 - v2};
    }

private:
    float g_ = 0.0f, k_ = 1.0f, a1_ = 0.0f, a2_ = 0.0f, a3_ = 0.0f;
    float ic1_ = 0.0f, ic2_ = 0.0f;
};

/// The same 12 dB/oct topology with saturating integrators: when driven or
/// pushed into resonance it growls and distorts instead of ringing cleanly,
/// and the saturation keeps self-oscillation bounded. A small offset in the
/// saturation adds the even harmonics of an imperfect analog stage.
class RoughSvf {
public:
    void reset() noexcept { ic1_ = ic2_ = 0.0f; }

    void set(float cutoffHz, float q, double sampleRate) noexcept {
        const double f = std::clamp((double)cutoffHz, 5.0, 0.45 * sampleRate);
        g_ = (float)std::tan(3.14159265358979323846 * f / sampleRate);
        k_ = 0.8f / std::max(q, 0.05f);  // a little less damping than the clean filter
        a1_ = 1.0f / (1.0f + g_ * (g_ + k_));
        a2_ = g_ * a1_;
        a3_ = g_ * a2_;
    }

    SvfOutputs process(float v0) noexcept {
        const float v3 = v0 - ic2_;
        const float v1 = a1_ * ic1_ + a2_ * v3;
        const float v2 = ic2_ + a2_ * ic1_ + a3_ * v3;
        ic1_ = saturate(2.0f * v1 - ic1_);
        ic2_ = saturate(2.0f * v2 - ic2_);
        return {v2, v1, v0 - k_ * v1 - v2};
    }

private:
    static float saturate(float x) noexcept {
        constexpr float kBias = 0.12f;
        return 1.4f * (std::tanh((x + kBias) / 1.4f) - std::tanh(kBias / 1.4f));
    }
    float g_ = 0.0f, k_ = 1.0f, a1_ = 0.0f, a2_ = 0.0f, a3_ = 0.0f;
    float ic1_ = 0.0f, ic2_ = 0.0f;
};

/// Continuous mode morph: 0 = LP, 1/3 = BP, 2/3 = HP, 1 = notch.
inline float morphSvf(const SvfOutputs& o, float morph) noexcept {
    const float m = std::clamp(morph, 0.0f, 1.0f) * 3.0f;
    const float outs[4] = {o.lp, o.bp, o.hp, o.notch()};
    const int i = std::min((int)m, 2);
    const float t = m - (float)i;
    return outs[i] + t * (outs[i + 1] - outs[i]);
}

}  // namespace bleep::dsp
