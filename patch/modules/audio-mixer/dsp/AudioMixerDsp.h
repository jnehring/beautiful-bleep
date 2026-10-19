// SPDX-License-Identifier: GPL-3.0-or-later
// Audio Mixer core (doc/specs/modules/audio-mixer.md §4): four stereo channels
// with fader, pan, mute/solo and a send; a return, a master fader and a
// lookahead peak limiter.
#pragma once

#include "dsp/Gain.h"
#include "dsp/Smoothing.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace bleep::patch {

constexpr int kMixerChannels = 4;

/// Lookahead peak limiter, linked stereo. The gain is the minimum of the
/// required gains over the lookahead window, released slowly, then averaged
/// over the window: it reaches each peak's gain before the peak leaves the
/// delay line, so the ceiling is never exceeded.
class PeakLimiter {
public:
    static constexpr float kCeiling = 0.96605f;  // −0.3 dBFS

    void prepare(double sampleRate) {
        n_ = std::max(1, (int)std::lround(sampleRate * 0.001));
        release_ = (float)std::exp(-1.0 / (0.05 * sampleRate));
        dl_.assign((size_t)n_, 0.0f);
        dr_.assign((size_t)n_, 0.0f);
        need_.assign((size_t)n_, 1.0f);
        box_.assign((size_t)n_, 1.0f);
        reset();
    }
    void reset() {
        std::fill(dl_.begin(), dl_.end(), 0.0f);
        std::fill(dr_.begin(), dr_.end(), 0.0f);
        std::fill(need_.begin(), need_.end(), 1.0f);
        std::fill(box_.begin(), box_.end(), 1.0f);
        sum_ = (double)n_;
        pos_ = 0;
        held_ = 1.0f;
        reduction_ = 1.0f;
    }
    int latency() const noexcept { return n_ - 1; }
    float gainReduction() const noexcept { return reduction_; }

    void process(float& l, float& r) noexcept {
        const float peak = std::max(std::fabs(l), std::fabs(r));
        need_[(size_t)pos_] = peak > kCeiling ? kCeiling / peak : 1.0f;
        float h = 1.0f;
        for (float g : need_) h = std::min(h, g);
        held_ = h < held_ ? h : h + release_ * (held_ - h);
        sum_ += (double)held_ - (double)box_[(size_t)pos_];
        box_[(size_t)pos_] = held_;
        const float gain = std::min(1.0f, (float)(sum_ / n_));
        // The delay line: the sample written n_ − 1 samples ago leaves now.
        dl_[(size_t)pos_] = l, dr_[(size_t)pos_] = r;
        const int out = (pos_ + 1) % n_;
        l = dl_[(size_t)out] * gain;
        r = dr_[(size_t)out] * gain;
        reduction_ = gain;
        pos_ = out;
    }

private:
    int n_ = 48, pos_ = 0;
    float release_ = 0.0f, held_ = 1.0f, reduction_ = 1.0f;
    double sum_ = 48.0;
    std::vector<float> dl_, dr_, need_, box_;
};

struct MixerChannelParams {
    float levelDb = 0.0f, pan = 0.0f, sendDb = dsp::kFaderFloorDb;
    bool mute = false, solo = false, preFader = false;
};

struct AudioMixerParams {
    MixerChannelParams ch[kMixerChannels];
    float returnDb = 0.0f, masterDb = 0.0f;
    bool limiter = true;
    bool mono = false;  ///< every channel and the return summed to mono; no pan, Out L = Out R
};

struct AudioMixerInputs {
    float l[kMixerChannels] = {}, r[kMixerChannels] = {};
    bool stereo[kMixerChannels] = {};
    bool muteGate[kMixerChannels] = {};
    float returnL = 0.0f, returnR = 0.0f;
};

struct AudioMixerFrame {
    float outL = 0.0f, outR = 0.0f, sendL = 0.0f, sendR = 0.0f, level = 0.0f;
    float peak[kMixerChannels] = {};  ///< per channel after the fader, for the meters
};

class AudioMixerDsp {
public:
    void prepare(double sampleRate) {
        rampSamples_ = std::max(1, (int)std::lround(sampleRate * 0.005));
        limiter_.prepare(sampleRate);
        follower_.prepare(sampleRate, 0.01f, 0.2f);
        reset();
    }
    void reset() {
        for (auto& m : mute_) m.reset(1.0f);
        for (auto& s : solo_) s.reset(1.0f);
        limiter_.reset();
        follower_.reset();
    }

    /// Equal-power pan for mono; cosine balance for stereo (spec §4.2).
    static void panGains(float pan, bool stereo, float& gl, float& gr) noexcept {
        constexpr float quarterPi = 0.785398163397448f;
        pan = std::clamp(pan, -1.0f, 1.0f);
        if (!stereo) {
            const float t = (pan + 1.0f) * quarterPi;
            gl = std::cos(t), gr = std::sin(t);
            return;
        }
        gl = pan > 0.0f ? std::cos(pan * 2.0f * quarterPi) : 1.0f;
        gr = pan < 0.0f ? std::cos(-pan * 2.0f * quarterPi) : 1.0f;
    }

    void tick(const AudioMixerInputs& in, const AudioMixerParams& p, AudioMixerFrame& f) noexcept {
        bool anySolo = false;
        for (const auto& c : p.ch) anySolo = anySolo || c.solo;
        float busL = 0.0f, busR = 0.0f, sendL = 0.0f, sendR = 0.0f;
        for (int k = 0; k < kMixerChannels; ++k) {
            const auto& c = p.ch[k];
            const bool muted = c.mute || in.muteGate[k];
            const bool soloedOut = anySolo && !c.solo;
            // The send ignores Solo (spec §4.3); both follow Mute.
            mute_[k].setTarget(muted ? 0.0f : 1.0f, rampSamples_);
            solo_[k].setTarget(soloedOut ? 0.0f : 1.0f, rampSamples_);
            const float m = mute_[k].next(), s = solo_[k].next();
            float xl = in.l[k], xr = in.stereo[k] ? in.r[k] : in.l[k];
            const float level = dsp::faderGain(c.levelDb);
            float gl, gr;
            if (p.mono) {
                xl = xr = 0.5f * (xl + xr);
                gl = gr = 1.0f;
            } else {
                panGains(c.pan, in.stereo[k], gl, gr);
            }
            const float yl = xl * level * gl * m, yr = xr * level * gr * m;
            busL += yl * s, busR += yr * s;
            f.peak[k] = std::max(std::fabs(xl * level * m), std::fabs(xr * level * m));
            const float send = dsp::faderGain(c.sendDb) * m;
            if (c.preFader) {
                sendL += xl * gl * send, sendR += xr * gr * send;
            } else {
                sendL += yl * send, sendR += yr * send;
            }
        }
        const float ret = dsp::faderGain(p.returnDb), master = dsp::faderGain(p.masterDb);
        float retL = in.returnL, retR = in.returnR;
        if (p.mono) retL = retR = 0.5f * (retL + retR);
        float l = (busL + retL * ret) * master, r = (busR + retR * ret) * master;
        if (p.limiter) limiter_.process(l, r);
        f.outL = l, f.outR = r;
        f.sendL = sendL, f.sendR = sendR;
        f.level = std::min(1.0f, follower_.process(std::max(std::fabs(l), std::fabs(r))));
    }

    float gainReduction() const noexcept { return limiter_.gainReduction(); }

private:
    int rampSamples_ = 240;
    dsp::LinearRamp mute_[kMixerChannels], solo_[kMixerChannels];
    PeakLimiter limiter_;
    dsp::EnvelopeFollower follower_;
};

}  // namespace bleep::patch
