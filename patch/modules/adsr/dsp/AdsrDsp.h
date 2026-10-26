// SPDX-License-Identifier: GPL-3.0-only
// ADSR: attack, decay, sustain, release with velocity amount and retrigger.
// Attack rises linearly (it's short and should be punchy); decay and release
// fall exponentially and reach silence (−80 dB) after their set time. Each
// stage has a curve (−1..1, 0 = those defaults): positive bends it late (slow
// start, quick finish), negative bends it early (quick start, slow finish).
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::patch {

struct AdsrParams {
    float attack = 0.01f;   ///< seconds
    float decay = 0.3f;     ///< seconds
    float sustain = 0.7f;   ///< 0..1
    float release = 0.5f;   ///< seconds
    float velocityAmount = 0.5f;  ///< 0: velocity ignored, 1: level = velocity
    float attackCurve = 0.0f;   ///< −1..1
    float decayCurve = 0.0f;    ///< −1..1
    float releaseCurve = 0.0f;  ///< −1..1
};

struct AdsrFrame {
    float env;     ///< 0..1
    float end;     ///< trigger when the release finishes
    float active;  ///< gate: high while the envelope runs
};

class AdsrDsp {
public:
    enum class Stage { Idle, Attack, Decay, Sustain, Release };

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        stage_ = Stage::Idle;
        level_ = 0.0f;
        gate_ = false;
        peak_ = 1.0f;
        phase_ = 0.0f;
        from_ = 0.0f;
    }
    Stage stage() const noexcept { return stage_; }

    /// One sample. `gate` and `retrigger` are gate/trigger inputs, `velocity` 0..1.
    AdsrFrame tick(const AdsrParams& p, float gate, float retrigger, float velocity) noexcept {
        const bool high = gate >= 0.5f;
        if ((high && !gate_) || (high && retrigger >= 0.5f)) {
            stage_ = Stage::Attack;  // from the current level: no click
            from_ = level_;
            phase_ = 0.0f;
            peak_ = 1.0f - std::clamp(p.velocityAmount, 0.0f, 1.0f) * (1.0f - std::clamp(velocity, 0.0f, 1.0f));
        } else if (!high && gate_ && stage_ != Stage::Idle) {
            stage_ = Stage::Release;
            from_ = level_;
            phase_ = 0.0f;
        }
        gate_ = high;

        AdsrFrame f{0.0f, 0.0f, 0.0f};
        switch (stage_) {
            case Stage::Attack: {
                // Same slope as a straight ramp from the current level, shaped by the curve.
                const float span = std::max(peak_ - from_, 0.0f);
                phase_ += peak_ / (float)(std::max(p.attack, 0.0005f) * sampleRate_) / std::max(span, 1e-6f);
                if (span <= 0.0f || phase_ >= 1.0f) {
                    level_ = peak_;
                    enterDecay();
                } else {
                    level_ = from_ + span * warp(phase_, p.attackCurve);
                }
                break;
            }
            case Stage::Decay: {
                const float target = std::clamp(p.sustain, 0.0f, 1.0f) * peak_;
                // −80 dB at the set time; the tail runs on to 1e-5 as the recursive form did.
                phase_ += 1.0f / (float)(1.25 * std::max(p.decay, 0.0005f) * sampleRate_);
                level_ = target + (from_ - target) * std::pow(1e-5f, warp(std::min(phase_, 1.0f), p.decayCurve));
                if (phase_ >= 1.0f || std::fabs(level_ - target) < 1e-5f) {
                    level_ = target;
                    stage_ = Stage::Sustain;
                }
                break;
            }
            case Stage::Sustain: level_ = std::clamp(p.sustain, 0.0f, 1.0f) * peak_; break;
            case Stage::Release: {
                // From the current level down to −80 dB; a lower start takes proportionally less time.
                const float f0 = std::max(from_, 1e-4f);
                const float seconds = std::max(p.release, 0.0005f) * (1.0f + std::log(f0) / std::log(1e4f));
                phase_ += 1.0f / (std::max(seconds, 0.0005f) * (float)sampleRate_);
                level_ = f0 * std::pow(1e-4f / f0, warp(std::min(phase_, 1.0f), p.releaseCurve));
                if (phase_ >= 1.0f || level_ < 1e-4f) {
                    level_ = 0.0f;
                    stage_ = Stage::Idle;
                    f.end = 1.0f;
                }
                break;
            }
            case Stage::Idle: level_ = 0.0f; break;
        }
        f.env = level_;
        f.active = stage_ != Stage::Idle ? 1.0f : 0.0f;
        return f;
    }

private:
    void enterDecay() noexcept {
        stage_ = Stage::Decay;
        from_ = level_;
        phase_ = 0.0f;
    }
    /// Bends a 0..1 progress: 0 leaves it straight, positive is late, negative early.
    static float warp(float x, float curve) noexcept {
        return std::pow(x, std::pow(4.0f, std::clamp(curve, -1.0f, 1.0f)));
    }

    double sampleRate_ = 48000.0;
    Stage stage_ = Stage::Idle;
    float level_ = 0.0f;
    float peak_ = 1.0f;
    float from_ = 0.0f;   ///< level at the start of the current stage
    float phase_ = 0.0f;  ///< 0..1 progress through the current stage
    bool gate_ = false;
};

}  // namespace bleep::patch
