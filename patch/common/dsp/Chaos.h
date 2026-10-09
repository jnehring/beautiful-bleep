// SPDX-License-Identifier: MIT
// Small chaotic and neural building blocks: a leaky integrate-and-fire neuron
// (doc/specs/modules/neuron.md) and chaotic attractors for slow, never-repeating
// drift. No randomness: the same inputs (and seed) give the same outputs,
// sample for sample.
#pragma once

#include "Random.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

// ---- Leaky integrate-and-fire neuron ---------------------------------------------

struct NeuronParams {
    float leak = 0.1f;        ///< membrane time constant in seconds (0 = the membrane follows the sum)
    float threshold = 0.5f;   ///< firing / comparing level
    float hysteresis = 0.0f;  ///< 0..1; h = hysteresis × 0.5, the gate band is threshold ± h/2
    float pulse = 0.01f;      ///< Spike mode: gate length and refractory time in seconds
    bool spike = false;       ///< false: Compare (Schmitt trigger); true: integrate and fire
};

struct NeuronFrame {
    float membrane = 0.0f;
    bool gate = false;
    bool spike = false;  ///< a rising gate edge, in either mode
};

/// neuron.md 4.1–4.2. The membrane m follows the input sum with a one-pole
/// low-pass of time constant Leak: m += (s − m)(1 − e^(−dt/Leak)).
/// Compare: gate high above threshold + h/2, low below threshold − h/2.
/// Spike: crossing threshold + h/2 upward fires — the gate is high for Pulse,
/// the membrane is reset to 0 and held there (refractory). With θ > 0 and a
/// constant sum s > θ the rate is 1 / (Pulse − Leak · ln(1 − θ/s)) (to
/// within a sample per period).
class LifNeuron {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        m_ = 0.0;
        gate_ = false;
        refractory_ = 0;
        lastLeak_ = -1.0f;
    }

    float membrane() const noexcept { return (float)m_; }
    bool gate() const noexcept { return gate_; }

    NeuronFrame tick(float sum, const NeuronParams& p) noexcept {
        const double h = std::clamp((double)p.hysteresis, 0.0, 1.0) * 0.5;
        const double upper = (double)p.threshold + 0.5 * h, lower = (double)p.threshold - 0.5 * h;
        const bool was = gate_;
        if (p.spike && refractory_ > 0) {
            --refractory_;  // still inside the pulse: held at 0
            m_ = 0.0;
            gate_ = true;
        } else {
            integrate(sum, p.leak);
            if (p.spike) {
                gate_ = false;
                // The gate is low for at least one sample between pulses, so
                // every firing is a visible edge (θ ≤ 0: period = Pulse + 1 sample).
                if (m_ > upper && !was) fire(p.pulse);
            } else {
                refractory_ = 0;
                if (m_ > upper) gate_ = true;
                else if (m_ < lower) gate_ = false;
            }
        }
        return {(float)m_, gate_, gate_ && !was};
    }

private:
    void integrate(float sum, float leak) noexcept {
        if (leak <= 0.0f) {
            m_ = (double)sum;
            return;
        }
        if (leak < lastLeak_ || leak > lastLeak_) {
            lastLeak_ = leak;
            coeff_ = 1.0 - std::exp(-1.0 / ((double)leak * sampleRate_));
        }
        m_ += ((double)sum - m_) * coeff_;
    }
    void fire(float pulse) noexcept {
        gate_ = true;
        m_ = 0.0;
        // This sample is the first of the pulse; refractory_ counts the rest.
        refractory_ = std::max<int64_t>(1, (int64_t)std::llround((double)pulse * sampleRate_)) - 1;
    }

    double sampleRate_ = 48000.0;
    double m_ = 0.0, coeff_ = 0.0;
    float lastLeak_ = -1.0f;
    int64_t refractory_ = 0;
    bool gate_ = false;
};

/// neuron.md 4.3: Out = clamp(sharp · (m − threshold), 0, 1) with a soft knee
/// over the top 5 % so it doesn't kink at 1.
inline float neuronOut(float membrane, float threshold, float sharp) noexcept {
    const float x = std::max(0.0f, sharp * (membrane - threshold));
    if (x < 0.95f) return x;
    if (x >= 1.05f) return 1.0f;
    const float d = x - 0.95f;
    return 0.95f + d - d * d * 5.0f;  // slope 1 at 0.95, 0 at 1.05, reaching 1
}

// ---- Chaotic attractors -------------------------------------------------------------

/// A slow chaotic attractor for drifting modulation, integrated with RK4 in
/// double. `rateHz` is roughly the number of loops around the attractor per
/// second (0.001 Hz … audio rate; large steps are split into sub-steps, so it
/// stays stable at any rate). Outputs x, y, z are normalised to about −1..+1
/// (clamped). The start point is a pure function of the seed, so a render
/// from reset() repeats exactly; different seeds diverge within a few loops.
class Attractor {
public:
    enum Type {
        Lorenz,  ///< two lobes, irregular flips between them: σ 10, ρ 28, β 8/3
        Thomas   ///< cyclically symmetric, smooth and lazy: b 0.208186
    };

    struct Frame {
        float x = 0.0f, y = 0.0f, z = 0.0f;
    };

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void setType(Type t) noexcept {
        if (t != type_) {
            type_ = t;
            reset(seed_);
        }
    }
    Type type() const noexcept { return type_; }

    /// Restarts at the seed's start point (on the attractor, after a warm-up).
    void reset(uint64_t seed = 1) noexcept {
        seed_ = seed;
        const double a = uniform01(seed, 0, 0x6c6f72), b = uniform01(seed, 1, 0x6c6f72), c = uniform01(seed, 2, 0x6c6f72);
        if (type_ == Lorenz) s_ = {a * 2.0 - 1.0 + 0.1, b * 2.0 - 1.0, 20.0 + c * 5.0};
        else s_ = {a * 2.0 - 1.0 + 0.1, b * 2.0 - 1.0, c * 2.0 - 1.0};
        for (int i = 0; i < 2000; ++i) rk4(dtMax());  // settle onto the attractor
    }

    /// One sample at `rateHz` loops per second.
    Frame tick(double rateHz) noexcept {
        double dt = std::max(rateHz, 0.0) * timePerLoop() / sampleRate_;
        const int steps = std::min(64, std::max(1, (int)std::ceil(dt / dtMax())));
        dt = std::min(dt / steps, dtMax());  // above ~64 sub-steps per sample the rate saturates
        for (int i = 0; i < steps; ++i) rk4(dt);
        if (!std::isfinite(s_.x) || !std::isfinite(s_.y) || !std::isfinite(s_.z)) reset(seed_);
        return frame();
    }

    Frame frame() const noexcept {
        auto c = [](double v) { return (float)std::clamp(v, -1.0, 1.0); };
        if (type_ == Lorenz) return {c(s_.x / 20.0), c(s_.y / 27.0), c((s_.z - 25.0) / 25.0)};
        return {c(s_.x / 4.5), c(s_.y / 4.5), c(s_.z / 4.5)};
    }

private:
    struct V {
        double x, y, z;
    };
    // Attractor time units for one loop (Lorenz: about 0.7; Thomas: about 30).
    double timePerLoop() const noexcept { return type_ == Lorenz ? 0.7 : 30.0; }
    // Largest stable, accurate RK4 step.
    double dtMax() const noexcept { return type_ == Lorenz ? 0.01 : 0.1; }

    V deriv(const V& v) const noexcept {
        if (type_ == Lorenz) return {10.0 * (v.y - v.x), v.x * (28.0 - v.z) - v.y, v.x * v.y - (8.0 / 3.0) * v.z};
        constexpr double b = 0.208186;
        return {std::sin(v.y) - b * v.x, std::sin(v.z) - b * v.y, std::sin(v.x) - b * v.z};
    }
    void rk4(double h) noexcept {
        const V k1 = deriv(s_);
        const V k2 = deriv({s_.x + 0.5 * h * k1.x, s_.y + 0.5 * h * k1.y, s_.z + 0.5 * h * k1.z});
        const V k3 = deriv({s_.x + 0.5 * h * k2.x, s_.y + 0.5 * h * k2.y, s_.z + 0.5 * h * k2.z});
        const V k4 = deriv({s_.x + h * k3.x, s_.y + h * k3.y, s_.z + h * k3.z});
        s_.x += h / 6.0 * (k1.x + 2.0 * k2.x + 2.0 * k3.x + k4.x);
        s_.y += h / 6.0 * (k1.y + 2.0 * k2.y + 2.0 * k3.y + k4.y);
        s_.z += h / 6.0 * (k1.z + 2.0 * k2.z + 2.0 * k3.z + k4.z);
    }

    double sampleRate_ = 48000.0;
    Type type_ = Lorenz;
    uint64_t seed_ = 1;
    V s_{0.1, 0.0, 20.0};
};

}  // namespace bleep::dsp
