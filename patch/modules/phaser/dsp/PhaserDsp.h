// SPDX-License-Identifier: GPL-3.0-only
// Phaser: a cascade of first-order allpass stages swept by an LFO, with feedback from the last stage back
// to the input. Mixed with the dry signal, every pair of stages makes one notch. Textbook design.
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::patch {

class PhaserDsp {
public:
    static constexpr int kMaxStages = 12;

    void prepare(double sampleRate) {
        sr_ = sampleRate;
        reset();
    }
    void reset() {
        for (float& z : z_) z = 0.0f;
        fb_ = 0.0f;
        coefficient_ = 0.0f;
        lastHz_ = -1.0f;
    }

    /// One sample. `hz` is the allpass break frequency now (the module sweeps it), `stages` 2 … 12,
    /// `feedback` -0.95 … +0.95. Returns the wet signal (allpass chain output).
    float tick(float in, float hz, int stages, float feedback) noexcept {
        if (hz != lastHz_) {  // tan() only when the sweep moved
            lastHz_ = hz;
            const float t = std::tan(3.14159265f * std::clamp(hz, 10.0f, 0.45f * (float)sr_) / (float)sr_);
            coefficient_ = (t - 1.0f) / (t + 1.0f);
        }
        float x = in + softClip(feedback * fb_);
        for (int s = 0; s < stages; ++s) {
            const float y = coefficient_ * x + z_[s];
            z_[s] = x - coefficient_ * y;
            x = y;
        }
        fb_ = x;
        return x;
    }

private:
    static float softClip(float x) noexcept {
        return x < -3.0f ? -1.0f : x > 3.0f ? 1.0f : x * (27.0f + x * x) / (27.0f + 9.0f * x * x);
    }
    double sr_ = 48000.0;
    float z_[kMaxStages]{}, fb_ = 0.0f, coefficient_ = 0.0f, lastHz_ = -1.0f;
};

}  // namespace bleep::patch
