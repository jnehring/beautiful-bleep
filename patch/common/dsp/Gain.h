// SPDX-License-Identifier: MIT
// Decibel helpers for faders (doc/specs/modules/audio-mixer.md §4.1).
#pragma once

#include <cmath>

namespace bleep::dsp {

/// The bottom of a fader's travel: this level and below is silence.
constexpr float kFaderFloorDb = -60.0f;

/// dB → linear gain; kFaderFloorDb and below give 0.
inline float faderGain(float db) noexcept {
    return db <= kFaderFloorDb + 1e-3f ? 0.0f : std::pow(10.0f, db / 20.0f);
}

/// A gain that moves linearly to its target over a fixed number of samples
/// (click-free mutes, spec §7.7).
class LinearRamp {
public:
    void reset(float value) noexcept { value_ = target_ = value; step_ = 0.0f; left_ = 0; }
    void setTarget(float target, int samples) noexcept {
        if (!(target < target_ || target > target_)) return;  // unchanged (no -Wfloat-equal)
        target_ = target;
        left_ = samples > 0 ? samples : 0;
        if (left_ == 0) value_ = target;
        else step_ = (target - value_) / (float)left_;
    }
    float next() noexcept {
        if (left_ > 0 && --left_ > 0) value_ += step_;
        else value_ = target_;
        return value_;
    }
    float value() const noexcept { return value_; }

private:
    float value_ = 0.0f, target_ = 0.0f, step_ = 0.0f;
    int left_ = 0;
};

}  // namespace bleep::dsp
