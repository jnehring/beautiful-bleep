// SPDX-License-Identifier: MIT
// Overdrive, bit crush and sample-rate reduction. The overdrive curve and its gain staging are Émilie Gillet's
// (Plaits, 2014, as ported into DaisySP's Overdrive); the sample-rate reduction (hold N samples, N from the
// squared factor times 96) is DaisySP's Decimator. Copyright (c) 2020 Electrosmith, Corp and 2016 Emilie
// Gillet, MIT, see ../LICENSE. The bit crusher here rounds to 2^(bits-1) levels (any fractional bit depth,
// so it can be swept); DaisySP truncates.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

struct CrunchParams {
    float drive = 0.0f;   ///< 0 … 1
    float bits = 16.0f;   ///< 1 … 16; 16 is off
    float rate = 0.0f;    ///< 0 … 1 sample-rate reduction; 0 is off
    float toneHz = 20000.0f;
};

inline float softLimit(float x) noexcept { return x * (27.0f + x * x) / (27.0f + 9.0f * x * x); }
inline float softClip(float x) noexcept { return x < -3.0f ? -1.0f : x > 3.0f ? 1.0f : softLimit(x); }

/// The overdrive's pre and post gain. `forDrive` is Plaits' curve for its drive 0 … 1 (silent at 0, huge near 1);
/// `forKnob` maps our Drive knob onto its useful part (Plaits' 0.1 … 0.6) and sets the post gain so that a signal
/// at 0.5 comes out at 0.5 at any drive: the knob changes the colour, not the loudness.
struct OverdriveGains {
    float pre = 1.0f, post = 1.0f;
    static OverdriveGains forKnob(float knob) noexcept {
        OverdriveGains g = forDrive(0.1f + 0.5f * std::clamp(knob, 0.0f, 1.0f));
        g.post = 0.5f / softClip(0.5f * g.pre);
        return g;
    }
    static OverdriveGains forDrive(float drive) noexcept {
        drive = std::clamp(drive, 0.0f, 1.0f);
        const float d = 2.0f * drive, d2 = d * d;
        const float preA = d * 0.5f;
        const float preB = d2 * d2 * d * 24.0f;
        OverdriveGains g;
        g.pre = preA + (preB - preA) * d2;
        const float squashed = d * (2.0f - d);
        g.post = 1.0f / softClip(0.33f + squashed * (g.pre - 0.33f));
        return g;
    }
};

class CrunchDsp {
public:
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        reset();
    }
    void reset() {
        held_ = 0.0f;
        count_ = 0;
        lp_ = 0.0f;
        lastDrive_ = -1.0f;
    }

    float tick(float in, const CrunchParams& p) noexcept {
        if (p.drive != lastDrive_) {
            lastDrive_ = p.drive;
            gains_ = OverdriveGains::forKnob(p.drive);
        }
        // At Drive 0 the curve is nearly linear: clean, not bypassed.
        float x = softClip(gains_.pre * in) * gains_.post;
        // Sample-rate reduction: hold each sample for N + 1 samples.
        const uint32_t hold = (uint32_t)(p.rate * p.rate * 96.0f);
        if (++count_ > hold) {
            count_ = 0;
            held_ = x;
        }
        x = held_;
        // Bit crush: round to 2^(bits-1) levels.
        if (p.bits < 15.999f) {
            const float levels = std::exp2(std::clamp(p.bits, 1.0f, 16.0f) - 1.0f);
            x = std::round(x * levels) / levels;
        }
        // A one-pole low-pass tames what the crush leaves above the tone.
        const float a = 1.0f - std::exp(-6.2831853f * std::min(p.toneHz, 0.45f * (float)sr_) / (float)sr_);
        lp_ += a * (x - lp_);
        return p.toneHz >= 19999.0f ? x : lp_;
    }

private:
    double sr_ = 48000.0;
    float held_ = 0.0f, lp_ = 0.0f, lastDrive_ = -1.0f;
    uint32_t count_ = 0;
    OverdriveGains gains_;
};

}  // namespace bleep::patch
