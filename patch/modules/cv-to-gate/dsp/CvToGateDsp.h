// SPDX-License-Identifier: GPL-3.0-only
// CV to Gate core: a comparator with hysteresis and an optional fixed pulse length.
#pragma once

namespace bleep::patch {

constexpr float kCvToGateHysteresis = 0.02f;

class CvToGateDsp {
public:
    void reset() noexcept { high_ = false; remaining_ = 0; out_ = false; }

    /// lengthSamples <= 0: the gate follows the input. Otherwise each rising crossing fires a pulse of
    /// that many samples; a crossing during a pulse restarts it.
    float tick(float in, float threshold, int lengthSamples) noexcept {
        const bool wasHigh = high_;
        high_ = high_ ? in > threshold - kCvToGateHysteresis : in > threshold;
        if (lengthSamples <= 0) {
            remaining_ = 0;
            return high_ ? 1.0f : 0.0f;
        }
        if (high_ && !wasHigh) remaining_ = lengthSamples;
        if (remaining_ > 0) {
            --remaining_;
            return 1.0f;
        }
        return 0.0f;
    }

private:
    bool high_ = false, out_ = false;
    int remaining_ = 0;
};

}  // namespace bleep::patch
