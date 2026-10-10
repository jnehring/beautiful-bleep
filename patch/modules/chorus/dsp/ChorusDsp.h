// SPDX-License-Identifier: MIT
// Modulated delay voice: the engine of DaisySP's Chorus and Flanger (Copyright (c) 2020 Electrosmith, Corp,
// MIT, see ../LICENSE): a short delay line whose time swings with a triangle LFO, with feedback. Here the LFO
// is outside (so voices and channels share or offset it) and the delay is read with cubic interpolation.
#pragma once

#include "dsp/Delay.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

/// A triangle in -1 … +1 from a phase in cycles.
inline float triangleLfo(double phase) noexcept {
    const double f = phase - std::floor(phase);
    return (float)(4.0 * std::fabs(f - 0.5) - 1.0);
}

class ModDelayVoice {
public:
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        line_.resize((int)(0.06 * sampleRate));  // 60 ms covers 30 ms of delay and its swing
        reset();
    }
    void reset() { line_.clear(); }

    /// `lfo` -1 … +1. `delayMs` is the centre delay, `depth` 0 … 1 of it (at most 93 %, like DaisySP),
    /// `feedback` -1 … +1, `flanger` adds the one extra sample that DaisySP's Flanger has.
    float tick(float in, float lfo, float delayMs, float depth, float feedback, bool flanger) noexcept {
        const float delay = std::max(delayMs, 0.1f) * 0.001f * (float)sr_;
        const float swing = std::clamp(depth, 0.0f, 0.93f) * delay * lfo;
        const double d = std::max(0.0, (double)(delay + swing + (flanger ? 1.0f : 0.0f)) - 1.0);
        const float out = line_.readHermite(d);
        line_.write(in + out * std::clamp(feedback, -1.0f, 1.0f) * (flanger ? 0.97f : 0.9f));
        return out;
    }

private:
    double sr_ = 48000.0;
    dsp::RingDelay line_;
};

}  // namespace bleep::patch
