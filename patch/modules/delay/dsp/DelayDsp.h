// SPDX-License-Identifier: GPL-3.0-or-later
// Simple stereo delay (doc/specs/modules/delay.md): one delay line per side, a tape-style time follower
// (a time change bends the pitch of the repeats, never clicks), and a feedback path with a low cut, a high cut
// and a soft limiter (on the repeats, not the input) so that 100 % feedback holds instead of growing.
#pragma once

#include "dsp/Delay.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::patch {

constexpr float kDelayMaxSeconds = 4.0f;  ///< the longest time, free or synced

/// The note values a synced time can take (names from dsp::noteValues()).
inline const std::array<const char*, 14>& delayRateNames() {
    static const std::array<const char*, 14> names{"1/32", "1/16T", "1/16", "1/16.", "1/8T", "1/8", "1/8.",
                                                   "1/4T", "1/4",   "1/4.", "1/2T",  "1/2", "1/2.", "1/1"};
    return names;
}
/// Length in quarter notes of delayRateNames()[index] (index clamped).
inline double delayRateBeats(int index) noexcept {
    const int i = std::clamp(index, 0, (int)delayRateNames().size() - 1);
    return dsp::noteValueBeats(dsp::noteValueIndex(delayRateNames()[(size_t)i]));
}

/// Linear below 0.8, then bends smoothly towards ±1.
inline float delayLimit(float x) noexcept {
    const float a = std::fabs(x);
    if (a <= 0.8f) return x;
    const float y = 0.8f + 0.2f * std::tanh((a - 0.8f) * 5.0f);
    return x < 0.0f ? -y : y;
}

struct DelayParams {
    float timeL = 0.3f, timeR = 0.3f;  ///< seconds
    float feedback = 0.4f;             ///< 0 … 2
    float lowCutHz = 20.0f;            ///< high-pass in the feedback path (20 = off)
    float highCutHz = 20000.0f;        ///< low-pass in the feedback path (20000 = off)
    bool pingPong = false;
    float mix = 0.5f;
};

class DelayDsp {
public:
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        for (auto& l : line_) l.resize((int)(kDelayMaxSeconds * sampleRate) + 8);
        for (auto& t : time_) t.prepare(sampleRate, 0.12f, 0.5);
        reset();
    }
    void reset() {
        for (auto& l : line_) l.clear();
        for (auto& t : time_) t.reset(0.3 * sr_);
        std::fill(std::begin(hp_), std::end(hp_), 0.0f);
        std::fill(std::begin(lp_), std::end(lp_), 0.0f);
    }
    /// Jumps the time followers to the new times (after a reset, so the first repeats start in tune).
    void snapTimes(const DelayParams& p) {
        time_[0].reset(clampSamples(p.timeL));
        time_[1].reset(clampSamples(p.timeR));
    }

    void tick(const DelayParams& p, float inL, float inR, float& outL, float& outR) noexcept {
        // NaN or inf in the lines would recirculate through the feedback for good: start again from silence.
        if (!std::isfinite(inL)) inL = 0.0f;
        if (!std::isfinite(inR)) inR = 0.0f;
        const double dl = time_[0].process(clampSamples(p.timeL));
        const double dr = time_[1].process(clampSamples(p.timeR));
        const float wl = line_[0].readHermite(dl - 1.0);  // read before write: d - 1 is a delay of d samples
        const float wr = line_[1].readHermite(dr - 1.0);
        if (!std::isfinite(wl) || !std::isfinite(wr)) {
            for (auto& l : line_) l.clear();
            std::fill(std::begin(hp_), std::end(hp_), 0.0f);
            std::fill(std::begin(lp_), std::end(lp_), 0.0f);
            outL = inL;
            outR = inR;
            return;
        }
        const float fb = std::clamp(p.feedback, 0.0f, 2.0f);
        float fl, fr;
        if (p.pingPong) {  // each side feeds the other; the input enters the left line only
            fl = filter(1, wr, p) * fb;
            fr = filter(0, wl, p) * fb;
            line_[0].write(0.5f * (inL + inR) + delayLimit(fl));
            line_[1].write(delayLimit(fr));
        } else {
            fl = filter(0, wl, p) * fb;
            fr = filter(1, wr, p) * fb;
            line_[0].write(inL + delayLimit(fl));
            line_[1].write(inR + delayLimit(fr));
        }
        outL = inL + p.mix * (wl - inL);
        outR = inR + p.mix * (wr - inR);
    }

private:
    double clampSamples(float seconds) const noexcept {
        return std::clamp((double)seconds * sr_, 1.0, (double)kDelayMaxSeconds * sr_);
    }
    /// The feedback filter of side `ch`: high-pass, then low-pass (one pole each).
    float filter(int ch, float x, const DelayParams& p) noexcept {
        const float hpA = std::exp(-6.2831853f * std::clamp(p.lowCutHz, 20.0f, 20000.0f) / (float)sr_);
        const float lpA = std::exp(-6.2831853f * std::clamp(p.highCutHz, 20.0f, 20000.0f) / (float)sr_);
        // High-pass: input minus its one-pole low-pass; 20 Hz is treated as off.
        float y = x;
        if (p.lowCutHz > 20.5f) {
            hp_[ch] = (1.0f - hpA) * x + hpA * hp_[ch];
            y = x - hp_[ch];
        }
        if (p.highCutHz < 19500.0f) {
            lp_[ch] = (1.0f - lpA) * y + lpA * lp_[ch];
            y = lp_[ch];
        }
        return y;
    }

    double sr_ = 48000.0;
    dsp::RingDelay line_[2];
    dsp::TapeTime time_[2];
    float hp_[2] = {0, 0}, lp_[2] = {0, 0};
};

}  // namespace bleep::patch
