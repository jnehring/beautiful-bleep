// SPDX-License-Identifier: GPL-3.0-or-later
// Pitch Follower DSP (doc/specs/modules/pitch-follower.md): the shared tracker
// (common/dsp/PitchTrack.h) plus what makes its answer usable as a control
// signal: a V/oct output with glide that holds still while the pitch is unknown,
// a gate that closes after a hold time, a confidence signal and an envelope.
#pragma once

#include "dsp/PitchTrack.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

constexpr float kC4Hz = 261.6255653f;  ///< 0 V/oct

inline float hzToVolts(float hz) noexcept { return std::log2(std::max(hz, 1.0f) / kC4Hz); }
inline float voltsToHz(float volts) noexcept { return kC4Hz * std::exp2(volts); }

struct PitchFollowerParams {
    float minHz = 60.0f, maxHz = 1500.0f;
    float confidence = 0.75f;  ///< clarity needed to count as a pitch
    float glide = 0.03f;       ///< seconds
    float hold = 0.25f;        ///< seconds the gate stays open after the pitch is lost
    int guard = 0;             ///< 0 off, 1 light, 2 firm
    int vote = 0;              ///< 0 off, 1 … 4: median of 3, 5, 7, 9
    float release = 0.15f;     ///< envelope fall time, seconds
};

struct PitchFollowerFrame {
    float pitch = 0.0f;       ///< V/oct
    float gate = 0.0f;
    float confidence = 0.0f;  ///< 0 … 1, 0 while silent
    float env = 0.0f;
};

class PitchFollowerDsp {
public:
    static constexpr float kGuardSeconds[3] = {0.0f, 0.03f, 0.08f};

    void prepare(double sampleRate) {
        sr_ = sampleRate;
        tracker_.prepare(sampleRate);
        applied_ = {};
        applied_.guard = -1;  // force configure
        reset();
    }
    void reset() {
        tracker_.reset();
        volts_ = target_ = 0.0f;
        gateOpen_ = false;
        sinceVoiced_ = 1e9f;
        env_ = 0.0f;
        conf_ = 0.0f;
        haveTarget_ = false;
    }

    void tick(float x, const PitchFollowerParams& p, PitchFollowerFrame& f) noexcept {
        configure(p);
        const bool fresh = tracker_.push(x);
        const float dt = 1.0f / (float)sr_;
        if (fresh) {
            conf_ = tracker_.confidence();
            if (tracker_.voiced() && tracker_.hz() > 0.0f) {
                target_ = hzToVolts(tracker_.hz());
                if (!haveTarget_ || !gateOpen_) volts_ = target_;  // a new note starts at its pitch, no glide from the last one
                haveTarget_ = true;
                sinceVoiced_ = 0.0f;
                gateOpen_ = true;
            }
        }
        sinceVoiced_ += dt;
        if (gateOpen_ && sinceVoiced_ > p.hold + tracker_.hopSeconds() * 1.5f) gateOpen_ = false;
        if (!gateOpen_ && sinceVoiced_ > p.hold + 0.1f) conf_ *= 1.0f - std::min(1.0f, dt * 40.0f);

        const float a = 1.0f - std::exp(-dt / std::max(p.glide, 0.002f));
        volts_ += a * (target_ - volts_);

        const float rect = std::fabs(x);
        const float rel = 1.0f - std::exp(-dt / std::max(p.release, 0.001f));
        env_ += (rect > env_ ? 1.0f - std::exp(-dt / 0.002f) : rel) * (rect - env_);

        f.pitch = volts_;
        f.gate = gateOpen_ ? 1.0f : 0.0f;
        f.confidence = std::clamp(conf_, 0.0f, 1.0f);
        f.env = env_;
    }

    float hz() const noexcept { return voltsToHz(volts_); }
    const dsp::PitchTracker& tracker() const noexcept { return tracker_; }

private:
    void configure(const PitchFollowerParams& p) noexcept {
        if (p.minHz == applied_.minHz && p.maxHz == applied_.maxHz && p.confidence == applied_.confidence &&
            p.guard == applied_.guard && p.vote == applied_.vote)
            return;
        applied_ = p;
        dsp::PitchTrackSettings s;
        s.minHz = p.minHz;
        s.maxHz = p.maxHz;
        s.minConfidence = p.confidence;
        s.guardSeconds = kGuardSeconds[std::clamp(p.guard, 0, 2)];
        s.vote = p.vote <= 0 ? 1 : 1 + 2 * std::min(p.vote, 4);
        tracker_.configure(s);
    }

    double sr_ = 48000.0;
    dsp::PitchTracker tracker_;
    PitchFollowerParams applied_;
    float volts_ = 0.0f, target_ = 0.0f, sinceVoiced_ = 1e9f, env_ = 0.0f, conf_ = 0.0f;
    bool gateOpen_ = false, haveTarget_ = false;
};

}  // namespace bleep::patch
