// SPDX-License-Identifier: GPL-3.0-only
// Feed-forward compressor/limiter: level detector (peak or RMS, stereo-linked), a soft-knee gain computer in
// the dB domain and attack/release smoothing of the gain reduction. Textbook design (Giannoulis, Massberg
// and Reiss, "Digital Dynamic Range Compressor Design", JAES 2012, for the knee and the ballistics).
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::patch {

struct CompressorParams {
    float thresholdDb = -18.0f;
    float ratio = 4.0f;       ///< 1 … 40; 40 and up act as a limiter (infinite ratio)
    float attackMs = 10.0f;
    float releaseMs = 120.0f;
    float kneeDb = 6.0f;
    float makeupDb = 0.0f;
    float link = 1.0f;        ///< 0 = each channel on its own, 1 = both follow the louder
    bool rms = false;
};

class CompressorDsp {
public:
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        rmsCoeff_ = (float)std::exp(-1.0 / (0.01 * sampleRate));  // 10 ms power average
        reset();
    }
    void reset() {
        for (int c = 0; c < 2; ++c) power_[c] = 0.0f, grDb_[c] = 0.0f;
    }

    /// One stereo frame: `key` is what the detector listens to (the input itself or a sidechain), `x` what is
    /// gained. Returns the gain reduction in dB (0 … negative) of the louder side.
    float tick(const float key[2], const float x[2], float out[2], const CompressorParams& p) noexcept {
        if (p.attackMs != lastAttack_) {
            lastAttack_ = p.attackMs;
            attack_ = (float)std::exp(-1.0 / (std::max((double)p.attackMs, 0.01) * 0.001 * sr_));
        }
        if (p.releaseMs != lastRelease_) {
            lastRelease_ = p.releaseMs;
            release_ = (float)std::exp(-1.0 / (std::max((double)p.releaseMs, 1.0) * 0.001 * sr_));
        }
        float level[2];
        for (int c = 0; c < 2; ++c) {
            float a;
            if (p.rms) {
                power_[c] = key[c] * key[c] + rmsCoeff_ * (power_[c] - key[c] * key[c]);
                a = std::sqrt(power_[c]);
            } else {
                a = std::fabs(key[c]);
            }
            level[c] = 20.0f * std::log10(std::max(a, 1e-6f));
        }
        const float louder = std::max(level[0], level[1]);
        float worst = 0.0f;
        for (int c = 0; c < 2; ++c) {
            const float lv = level[c] + p.link * (louder - level[c]);
            const float target = gainReductionDb(lv, p);  // <= 0
            // Ballistics: attack while the reduction deepens, release while it relaxes.
            const float k = target < grDb_[c] ? attack_ : release_;
            grDb_[c] = target + k * (grDb_[c] - target);
            out[c] = x[c] * std::pow(10.0f, (grDb_[c] + p.makeupDb) * 0.05f);
            worst = std::min(worst, grDb_[c]);
        }
        return worst;
    }

    /// The static curve: how many dB the level `lv` is turned down by.
    static float gainReductionDb(float lv, const CompressorParams& p) noexcept {
        const float slope = p.ratio >= 40.0f ? 0.0f : 1.0f / std::max(p.ratio, 1.0f);
        const float over = lv - p.thresholdDb;
        const float knee = std::max(p.kneeDb, 0.0f);
        float out;
        if (2.0f * over < -knee) out = lv;
        else if (knee > 0.0f && 2.0f * std::fabs(over) <= knee) {
            const float t = over + knee * 0.5f;
            out = lv + (slope - 1.0f) * t * t / (2.0f * knee);
        } else out = p.thresholdDb + over * slope;
        return out - lv;
    }

private:
    double sr_ = 48000.0;
    float rmsCoeff_ = 0.998f, attack_ = 0.99f, release_ = 0.999f, lastAttack_ = -1.0f, lastRelease_ = -1.0f;
    float power_[2]{}, grDb_[2]{};
};

}  // namespace bleep::patch
