// SPDX-License-Identifier: MIT
// Dial core (doc/specs/modules/dial.md §4): the dial's position, stepped and
// scaled to a range, then smoothed.
#pragma once

#include "dsp/Smoothing.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

struct DialParams {
    float value = 0.5f;   ///< 0..1, the dial's position (with modulation)
    float min = 0.0f;     ///< output at the left end
    float max = 1.0f;     ///< output at the right end
    float smooth = 0.0f;  ///< seconds
    int steps = 0;        ///< 0: continuous, else 2..24 detents
};

/// The dial's position mapped to its range, before smoothing.
inline float dialTarget(const DialParams& p) noexcept {
    float v = std::clamp(p.value, 0.0f, 1.0f);
    if (p.steps >= 2) v = std::round(v * (float)(p.steps - 1)) / (float)(p.steps - 1);
    return p.min + (p.max - p.min) * v;
}

class DialDsp {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept { started_ = false; }
    float tick(const DialParams& p) noexcept {
        const float target = dialTarget(p);
        if (!started_) {  // no glide up from 0 when the module starts
            smoother_.reset(target);
            started_ = true;
        }
        return smoother_.process(target, p.smooth, sampleRate_);
    }

private:
    double sampleRate_ = 48000.0;
    dsp::OnePole smoother_;
    bool started_ = false;
};

}  // namespace bleep::patch
