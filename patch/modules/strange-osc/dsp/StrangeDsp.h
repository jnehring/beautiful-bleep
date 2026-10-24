// SPDX-License-Identifier: GPL-3.0-only
// Strange Osc (doc/specs/modules/strange-osc.md): a continuous chaotic system
// run as an oscillator. Four attractors are integrated with RK4 in double;
// pitch is time-scaling (the integration step follows the frequency), *Tame*
// slides one bifurcation parameter from the chaotic regime to a periodic one,
// and every axis is centred and scaled to about ±1 by values measured at
// both ends of that slide. The start state is a pure function of the seed.
#pragma once

#include "dsp/Random.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

struct StrangeFrame {
    float x = 0.0f, y = 0.0f, z = 0.0f;
};

class StrangeDsp {
public:
    enum Type { Lorenz, Rossler, Thomas, Halvorsen, kTypes };

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    /// Starts again at the seed's start point (cached: the warm-up runs only when type or seed change).
    void reset(int type, uint64_t seed) noexcept {
        type = std::clamp(type, 0, (int)kTypes - 1);
        if (type != startType_ || seed != startSeed_) {
            startType_ = type;
            startSeed_ = seed;
            const Info& n = info(type);
            const double a = dsp::uniform01(seed, 0, 0x73747261), b = dsp::uniform01(seed, 1, 0x73747261),
                         c = dsp::uniform01(seed, 2, 0x73747261);
            s_ = {n.start[0] + (a - 0.5) * 0.2 * n.half0[0], n.start[1] + (b - 0.5) * 0.2 * n.half0[1],
                  n.start[2] + (c - 0.5) * 0.2 * n.half0[2]};
            type_ = type;
            for (int i = 0; i < 4000; ++i) step(n.dtMax, n.p0, 0.0);  // settle onto the attractor, chaotic regime
            start_ = s_;
        }
        s_ = start_;
        type_ = type;
    }
    int type() const noexcept { return type_; }

    /// One sample: `hz` loops per second, tame 0…1, force = an external drive added to x'.
    StrangeFrame tick(double hz, float tame, double force) noexcept {
        const Info& n = info(type_);
        const double t = std::clamp((double)tame, 0.0, 1.0);
        const double p = n.p0 + (n.p1 - n.p0) * t;
        const double rate = n.rate0 + (n.rate1 - n.rate0) * t;  // loops per time unit
        double dt = std::max(hz, 0.0) / (rate * sampleRate_);
        const int steps = std::clamp((int)std::ceil(dt / n.dtMax), 1, 24);
        dt = std::min(dt / steps, n.dtMax);
        const double f = force * rate * (n.half0[0] + (n.half1[0] - n.half0[0]) * t);
        for (int i = 0; i < steps; ++i) step(dt, p, f);
        if (!std::isfinite(s_.x + s_.y + s_.z) || std::fabs(s_.x) + std::fabs(s_.y) + std::fabs(s_.z) > 1e5) {
            const int ty = type_;
            startType_ = -1;  // a bad state: rebuild the start
            reset(ty, startSeed_);
        }
        auto norm = [&](double v, int k) {
            const double mid = n.mid0[k] + (n.mid1[k] - n.mid0[k]) * t, half = n.half0[k] + (n.half1[k] - n.half0[k]) * t;
            return (float)std::clamp((v - mid) / half, -1.5, 1.5);
        };
        return {norm(s_.x, 0), norm(s_.y, 1), norm(s_.z, 2)};
    }

    static const char* name(int type) noexcept {
        static const char* names[] = {"Lorenz", "Rössler", "Thomas", "Halvorsen"};
        return names[std::clamp(type, 0, (int)kTypes - 1)];
    }

private:
    struct V {
        double x, y, z;
    };
    /// Per attractor: the bifurcation parameter at Tame 0 and 1, the loop rate (zero crossings of the mean per time
    /// unit), centre and half-range of each axis at both ends (measured), the stable step and a start point.
    struct Info {
        double p0, p1, rate0, rate1, dtMax;
        double mid0[3], half0[3], mid1[3], half1[3], start[3];
    };
    static const Info& info(int t) noexcept {
        static const Info table[kTypes] = {
            // Lorenz: ρ 28 → 160
            {28.0, 160.0, 0.314, 0.866, 0.01, {0, 0, 24.9}, {18.6, 25.2, 21.2}, {0, 0, 160.0}, {39.6, 72.4, 56.5}, {1, 1, 25}},
            // Rössler: c 5.7 → 3.0
            {5.7, 3.0, 0.17, 0.174, 0.04, {1.17, -1.48, 11.4}, {10.3, 9.3, 11.4}, {0.65, -0.8, 2.9}, {5.35, 4.8, 2.9}, {1, 1, 0.1}},
            // Thomas: b 0.17 → 0.32
            {0.17, 0.32, 0.034, 0.088, 0.1, {0.1, 0.1, 0.1}, {4.2, 4.2, 4.2}, {-2.27, -2.27, -2.27}, {0.39, 0.39, 0.39}, {0.1, 0.0, -0.5}},
            // Halvorsen: a 1.89 → 3.0
            {1.89, 3.0, 0.64, 0.38, 0.02, {-2.9, -2.9, -2.9}, {9.2, 9.2, 9.2}, {-1.4, -1.4, -1.4}, {6.95, 6.95, 6.95}, {-1.48, -1.51, 2.04}},
        };
        return table[std::clamp(t, 0, (int)kTypes - 1)];
    }

    V deriv(const V& v, double p, double f) const noexcept {
        switch (type_) {
            case Lorenz: return {10.0 * (v.y - v.x) + f, v.x * (p - v.z) - v.y, v.x * v.y - (8.0 / 3.0) * v.z};
            case Rossler: return {-v.y - v.z + f, v.x + 0.2 * v.y, 0.2 + v.z * (v.x - p)};
            case Thomas: return {std::sin(v.y) - p * v.x + f, std::sin(v.z) - p * v.y, std::sin(v.x) - p * v.z};
            default:
                return {-p * v.x - 4.0 * v.y - 4.0 * v.z - v.y * v.y + f, -p * v.y - 4.0 * v.z - 4.0 * v.x - v.z * v.z,
                        -p * v.z - 4.0 * v.x - 4.0 * v.y - v.x * v.x};
        }
    }
    void step(double h, double p, double f) noexcept {
        const V k1 = deriv(s_, p, f);
        const V k2 = deriv({s_.x + 0.5 * h * k1.x, s_.y + 0.5 * h * k1.y, s_.z + 0.5 * h * k1.z}, p, f);
        const V k3 = deriv({s_.x + 0.5 * h * k2.x, s_.y + 0.5 * h * k2.y, s_.z + 0.5 * h * k2.z}, p, f);
        const V k4 = deriv({s_.x + h * k3.x, s_.y + h * k3.y, s_.z + h * k3.z}, p, f);
        s_.x += h / 6.0 * (k1.x + 2.0 * k2.x + 2.0 * k3.x + k4.x);
        s_.y += h / 6.0 * (k1.y + 2.0 * k2.y + 2.0 * k3.y + k4.y);
        s_.z += h / 6.0 * (k1.z + 2.0 * k2.z + 2.0 * k3.z + k4.z);
    }

    double sampleRate_ = 48000.0;
    int type_ = 0, startType_ = -1;
    uint64_t startSeed_ = 0;
    V s_{1, 1, 25}, start_{1, 1, 25};
};

}  // namespace bleep::patch
