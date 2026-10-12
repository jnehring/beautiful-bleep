// SPDX-License-Identifier: MIT
// Wheel core (doc/specs/modules/wheel.md §4): the wheel's position scaled to a
// range, then smoothed. The spring is the view's (and a panel's) business: the
// engine only sees the position.
#pragma once

#include "dsp/Smoothing.h"

#include <algorithm>

namespace bleep::patch {

struct WheelParams {
    float value = 0.5f;   ///< 0..1, the wheel's position (with modulation)
    float min = -1.0f;    ///< output at the bottom
    float max = 1.0f;     ///< output at the top
    float smooth = 0.0f;  ///< seconds
};

/// The wheel's position mapped to its range, before smoothing.
inline float wheelTarget(const WheelParams& p) noexcept {
    return p.min + (p.max - p.min) * std::clamp(p.value, 0.0f, 1.0f);
}

class WheelDsp {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept { started_ = false; }
    float tick(const WheelParams& p) noexcept {
        const float target = wheelTarget(p);
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
