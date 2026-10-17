// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Small per-sample smoothing primitives.
#pragma once

#include <cmath>

namespace bleep::dsp {

/// One-pole low-pass; time is the 63 % rise time in seconds (0 = bypass).
class OnePole {
public:
    void reset(float value = 0.0f) noexcept { z_ = value; }
    float process(float x, float timeSeconds, double sampleRate) noexcept {
        if (timeSeconds <= 0.0f) return z_ = x;
        const float a = (float)std::exp(-1.0 / (timeSeconds * sampleRate));
        z_ = x + a * (z_ - x);
        return z_;
    }
    float value() const noexcept { return z_; }

private:
    float z_ = 0.0f;
};

/// Detects rising and falling edges of a gate (high at >= 0.5).
class GateEdge {
public:
    void reset(bool high = false) noexcept { high_ = high; }
    /// Returns +1 on a rising edge, -1 on a falling edge, 0 otherwise.
    int process(float x) noexcept {
        const bool h = x >= 0.5f;
        const int edge = h == high_ ? 0 : (h ? 1 : -1);
        high_ = h;
        return edge;
    }
    bool high() const noexcept { return high_; }

private:
    bool high_ = false;
};

/// Peak envelope follower with separate attack and release times.
class EnvelopeFollower {
public:
    void reset() noexcept { env_ = 0.0f; }
    void prepare(double sampleRate, float attackSeconds, float releaseSeconds) noexcept {
        att_ = (float)std::exp(-1.0 / (attackSeconds * sampleRate));
        rel_ = (float)std::exp(-1.0 / (releaseSeconds * sampleRate));
    }
    float process(float x) noexcept {
        const float a = std::fabs(x);
        env_ = a + (a > env_ ? att_ : rel_) * (env_ - a);
        return env_;
    }

private:
    float env_ = 0.0f, att_ = 0.0f, rel_ = 0.0f;
};

}  // namespace bleep::dsp
