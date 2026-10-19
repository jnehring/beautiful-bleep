// SPDX-License-Identifier: GPL-3.0-or-later
// Envelope Follower core (doc/specs/modules/envelope-follower.md): a peak or
// RMS detector with separate attack and release, a gain, and a gate with
// hysteresis on the result.
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::patch {

enum EnvelopeDetector { DetectPeak = 0, DetectRms = 1 };
/// What the peak detector sees: |x|, only the positive or negative half, or x itself (a signed slew).
enum EnvelopeRectify { RectifyFull = 0, RectifyPositive = 1, RectifyNegative = 2, RectifyNone = 3 };

/// The gate closes this far below the threshold (fraction of the threshold).
constexpr float kEnvelopeHysteresis = 0.8f;

struct EnvelopeFollowerParams {
    float attack = 0.01f;   ///< seconds (63 % rise time)
    float release = 0.2f;   ///< seconds
    float gain = 1.0f;
    float threshold = 0.3f; ///< on the output scale (after gain)
    int detector = DetectPeak;
    int rectify = RectifyFull;
};

struct EnvelopeFollowerFrame {
    float env = 0.0f;       ///< detector × gain
    float inverted = 0.0f;  ///< −env for a signed follower, otherwise 1 − env clamped to 0..1
    float gate = 0.0f;
    float trigger = 0.0f;   ///< one sample on the gate's rising edge
};

class EnvelopeFollowerDsp {
public:
    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        attack_ = release_ = -1.0f;
        reset();
    }
    void reset() noexcept {
        state_ = 0.0f;
        gate_ = false;
    }

    void tick(float x, const EnvelopeFollowerParams& p, EnvelopeFollowerFrame& f) noexcept {
        if (p.attack < attack_ || p.attack > attack_) {  // only when a time moves (no -Wfloat-equal)
            attack_ = p.attack;
            aCoef_ = coef(p.attack);
        }
        if (p.release < release_ || p.release > release_) {
            release_ = p.release;
            rCoef_ = coef(p.release);
        }
        float target;
        bool signedMode = false;
        if (p.detector == DetectRms) {
            target = x * x;
        } else {
            switch (p.rectify) {
                case RectifyPositive: target = std::max(x, 0.0f); break;
                case RectifyNegative: target = std::max(-x, 0.0f); break;
                case RectifyNone: target = x; signedMode = true; break;
                default: target = std::fabs(x); break;
            }
        }
        // Rising is the attack and falling the release; for a signed follower that
        // means upwards and downwards, whatever the sign.
        state_ += (target - state_) * (target > state_ ? aCoef_ : rCoef_);
        const float detected = p.detector == DetectRms ? std::sqrt(std::max(state_, 0.0f)) : state_;
        f.env = detected * p.gain;
        f.inverted = signedMode && p.detector == DetectPeak ? -f.env : std::clamp(1.0f - f.env, 0.0f, 1.0f);

        const float level = std::fabs(f.env);
        const bool was = gate_;
        if (!gate_ && level >= p.threshold) gate_ = true;
        else if (gate_ && level < p.threshold * kEnvelopeHysteresis) gate_ = false;
        f.gate = gate_ ? 1.0f : 0.0f;
        f.trigger = gate_ && !was ? 1.0f : 0.0f;
    }

private:
    /// One-pole coefficient for a 63 % time; 0 s jumps straight to the target.
    float coef(float seconds) const noexcept {
        if (seconds <= 1e-5f) return 1.0f;
        return (float)(1.0 - std::exp(-1.0 / ((double)seconds * sampleRate_)));
    }

    double sampleRate_ = 48000.0;
    float attack_ = -1.0f, release_ = -1.0f, aCoef_ = 1.0f, rCoef_ = 1.0f;
    float state_ = 0.0f;
    bool gate_ = false;
};

}  // namespace bleep::patch
