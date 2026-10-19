// SPDX-License-Identifier: GPL-3.0-or-later
// ADSR: attack, decay, sustain, release with velocity amount and retrigger.
// Attack rises linearly (it's short and should be punchy); decay and release
// fall exponentially and reach silence (−80 dB) after their set time.
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
    }
    Stage stage() const noexcept { return stage_; }

    /// One sample. `gate` and `retrigger` are gate/trigger inputs, `velocity` 0..1.
    AdsrFrame tick(const AdsrParams& p, float gate, float retrigger, float velocity) noexcept {
        const bool high = gate >= 0.5f;
        if ((high && !gate_) || (high && retrigger >= 0.5f)) {
            stage_ = Stage::Attack;  // from the current level: no click
            peak_ = 1.0f - std::clamp(p.velocityAmount, 0.0f, 1.0f) * (1.0f - std::clamp(velocity, 0.0f, 1.0f));
        } else if (!high && gate_ && stage_ != Stage::Idle) {
            stage_ = Stage::Release;
        }
        gate_ = high;

        AdsrFrame f{0.0f, 0.0f, 0.0f};
        switch (stage_) {
            case Stage::Attack: {
                level_ += peak_ / (float)(std::max(p.attack, 0.0005f) * sampleRate_);
                if (level_ >= peak_) {
                    level_ = peak_;
                    stage_ = Stage::Decay;
                }
                break;
            }
            case Stage::Decay: {
                const float target = std::clamp(p.sustain, 0.0f, 1.0f) * peak_;
                level_ = target + (level_ - target) * coefficient(p.decay);
                if (std::fabs(level_ - target) < 1e-5f) {
                    level_ = target;
                    stage_ = Stage::Sustain;
                }
                break;
            }
            case Stage::Sustain: level_ = std::clamp(p.sustain, 0.0f, 1.0f) * peak_; break;
            case Stage::Release:
                level_ *= coefficient(p.release);
                if (level_ < 1e-4f) {  // −80 dB
                    level_ = 0.0f;
                    stage_ = Stage::Idle;
                    f.end = 1.0f;
                }
                break;
            case Stage::Idle: level_ = 0.0f; break;
        }
        f.env = level_;
        f.active = stage_ != Stage::Idle ? 1.0f : 0.0f;
        return f;
    }

private:
    /// Per-sample factor that falls by 80 dB in `seconds`.
    float coefficient(float seconds) const noexcept {
        return (float)std::exp(std::log(1e-4) / (std::max(seconds, 0.0005f) * sampleRate_));
    }

    double sampleRate_ = 48000.0;
    Stage stage_ = Stage::Idle;
    float level_ = 0.0f;
    float peak_ = 1.0f;
    bool gate_ = false;
};

}  // namespace bleep::patch
