// SPDX-License-Identifier: GPL-3.0-or-later
// Level Meter core (doc/specs/modules/level-meter.md §4): peak and RMS detectors
// per channel, the Level output on a dB scale and the Clip gate.
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::patch {

/// The meter scale's bottom, per Floor setting.
constexpr float kLevelMeterFloors[] = {-24.0f, -36.0f, -48.0f, -60.0f, -72.0f, -96.0f};
constexpr int kLevelMeterDefaultFloor = 3;  // −60 dB
/// The Clip gate stays high this long after the last sample over 0 dBFS.
constexpr double kClipHoldSeconds = 0.05;

/// Linear amplitude → dB; silence gives −200 dB.
inline float levelToDb(float x) noexcept { return x > 1e-10f ? 20.0f * std::log10(x) : -200.0f; }

/// dB → 0..1 on a scale from floorDb (0) to 0 dBFS (1), clamped.
inline float levelToUnit(float x, float floorDb) noexcept {
    return std::clamp((levelToDb(x) - floorDb) / -floorDb, 0.0f, 1.0f);
}

struct LevelMeterParams {
    float response = 0.3f;    ///< seconds: RMS window and peak release
    float floorDb = -60.0f;   ///< Level output: this level and below give 0
    bool peakMode = false;    ///< Level follows the peak detector instead of RMS
};

struct LevelMeterFrame {
    float level = 0.0f;           ///< 0..1, dB scale
    float clip = 0.0f;            ///< gate
    float peakL = 0.0f, peakR = 0.0f;  ///< |x| this sample
    float rmsL = 0.0f, rmsR = 0.0f;    ///< linear RMS
    bool clipped = false;         ///< a sample over 0 dBFS this sample
};

class LevelMeterDsp {
public:
    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        response_ = -1.0f;
        reset();
    }
    void reset() noexcept {
        msL_ = msR_ = envL_ = envR_ = 0.0f;
        clipLeft_ = 0;
    }

    void tick(float l, float r, const LevelMeterParams& p, LevelMeterFrame& f) noexcept {
        if (p.response < response_ || p.response > response_) {  // only when Response moves (no -Wfloat-equal)
            response_ = p.response;
            const double t = std::max(1e-3, (double)p.response);
            coef_ = (float)(1.0 - std::exp(-1.0 / (t * sampleRate_)));
            // The peak falls 60 dB over Response.
            release_ = (float)std::pow(10.0, -3.0 / (t * sampleRate_));
        }
        const float al = std::fabs(l), ar = std::fabs(r);
        msL_ += (l * l - msL_) * coef_;
        msR_ += (r * r - msR_) * coef_;
        envL_ = std::max(al, envL_ * release_);
        envR_ = std::max(ar, envR_ * release_);

        f.peakL = al;
        f.peakR = ar;
        f.rmsL = std::sqrt(std::max(0.0f, msL_));
        f.rmsR = std::sqrt(std::max(0.0f, msR_));
        f.level = levelToUnit(p.peakMode ? std::max(envL_, envR_) : std::max(f.rmsL, f.rmsR), p.floorDb);

        f.clipped = al > 1.0f || ar > 1.0f;
        if (f.clipped) clipLeft_ = (int)(kClipHoldSeconds * sampleRate_);
        else if (clipLeft_ > 0) --clipLeft_;
        f.clip = f.clipped || clipLeft_ > 0 ? 1.0f : 0.0f;
    }

private:
    double sampleRate_ = 48000.0;
    float response_ = -1.0f, coef_ = 0.0f, release_ = 0.0f;
    float msL_ = 0.0f, msR_ = 0.0f, envL_ = 0.0f, envR_ = 0.0f;
    int clipLeft_ = 0;
};

}  // namespace bleep::patch
