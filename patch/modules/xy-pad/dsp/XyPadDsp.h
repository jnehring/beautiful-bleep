// SPDX-License-Identifier: GPL-3.0-only
// XY Pad core (doc/specs/modules/xy-pad.md §4): two positions scaled to one
// range, each smoothed.
#pragma once

#include "dsp/Smoothing.h"

#include <algorithm>

namespace bleep::patch {

struct XyPadParams {
    float x = 0.5f, y = 0.5f;  ///< 0..1, the point (with modulation)
    float min = 0.0f;          ///< output at the left / bottom edge
    float max = 1.0f;          ///< output at the right / top edge
    float smooth = 0.0f;       ///< seconds
};

inline float xyTarget(float pos, const XyPadParams& p) noexcept {
    return p.min + (p.max - p.min) * std::clamp(pos, 0.0f, 1.0f);
}

class XyPadDsp {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept { started_ = false; }
    void tick(const XyPadParams& p, float& outX, float& outY) noexcept {
        const float tx = xyTarget(p.x, p), ty = xyTarget(p.y, p);
        if (!started_) {  // no glide up from 0 when the module starts
            sx_.reset(tx);
            sy_.reset(ty);
            started_ = true;
        }
        outX = sx_.process(tx, p.smooth, sampleRate_);
        outY = sy_.process(ty, p.smooth, sampleRate_);
    }

private:
    double sampleRate_ = 48000.0;
    dsp::OnePole sx_, sy_;
    bool started_ = false;
};

}  // namespace bleep::patch
