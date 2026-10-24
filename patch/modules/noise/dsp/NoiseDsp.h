// SPDX-License-Identifier: GPL-3.0-only
// Noise: white, pink, brown and blue noise, plus a Colour knob that sweeps
// continuously brown → pink → white → blue → violet.
#pragma once

#include "dsp/Noise.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

class NoiseDsp {
public:
    using Frame = dsp::ColouredNoise::Frame;

    void prepare(double sampleRate) noexcept { noise_.prepare(sampleRate); }
    void reset() noexcept { noise_.reset(); }

    Frame next() noexcept { return noise_.next(); }

    /// −1 brown, −0.5 pink, 0 white, +0.5 blue, +1 violet; linear in between.
    static float colour(const Frame& f, float colour) noexcept {
        const float points[5] = {f.brown, f.pink, f.white, f.blue, f.violet};
        const float x = (std::clamp(colour, -1.0f, 1.0f) + 1.0f) * 2.0f;
        const int i = std::min((int)x, 3);
        const float t = x - (float)i;
        return points[i] + t * (points[i + 1] - points[i]);
    }

private:
    dsp::ColouredNoise noise_;
};

}  // namespace bleep::patch
