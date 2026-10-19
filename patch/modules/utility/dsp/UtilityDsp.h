// SPDX-License-Identifier: GPL-3.0-or-later
// Utility: the glue. Out = shape(X × ScaleX + Y × ScaleY + Offset), slewed,
// plus a comparator gate and an inverted copy.
#pragma once

#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

enum class UtilityMode { Through = 0, Rectify, Fold, Quantize, SampleHold };

struct UtilityParams {
    float scaleX = 1.0f;     ///< -1..1 attenuverter on X
    float scaleY = 0.0f;     ///< -1..1 attenuverter on Y (mixer)
    float offset = 0.0f;     ///< -1..1
    float slew = 0.0f;       ///< seconds
    float threshold = 0.0f;  ///< comparator threshold for the Gate output
    UtilityMode mode = UtilityMode::Through;
};

class UtilityDsp {
public:
    /// Triangle wavefolder: reflects everything outside -1..1 back inside.
    static float fold(float v) noexcept {
        const double t = dsp::wrap01(((double)v + 1.0) / 4.0);
        return (float)(1.0 - 4.0 * std::fabs(t - 0.5));
    }

    void reset() noexcept {
        slew_.reset(0.0f);
        clock_.reset();
        held_ = 0.0f;
    }

    void tick(const UtilityParams& p, float x, float y, float clock, double sampleRate, float& out, float& gate,
              float& inverted) noexcept {
        float v = x * p.scaleX + y * p.scaleY + p.offset;
        const bool clocked = clock_.process(clock) > 0;
        switch (p.mode) {
            case UtilityMode::Through: break;
            case UtilityMode::Rectify: v = std::fabs(v); break;
            case UtilityMode::Fold: v = fold(v); break;
            case UtilityMode::Quantize: v = std::round(v * 12.0f) / 12.0f; break;
            case UtilityMode::SampleHold:
                if (clocked) held_ = v;
                v = held_;
                break;
        }
        v = std::clamp(v, -10.0f, 10.0f);
        out = slew_.process(v, p.slew, sampleRate);
        gate = out > p.threshold ? 1.0f : 0.0f;
        inverted = -out;
    }

private:
    dsp::OnePole slew_;
    dsp::GateEdge clock_;
    float held_ = 0.0f;
};

}  // namespace bleep::patch
