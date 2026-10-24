// SPDX-License-Identifier: GPL-3.0-only
// Audio Console core (doc/specs/modules/audio-console.md §4): up to 32 channel strips with filters, a
// three-band EQ, pan, fader, mute, solo and up to four aux sends; aux returns; a master strip with the same
// processing and a limiter. Every strip also hands out the signals the recorder and the direct outputs take.
#pragma once

#include "AudioMixerDsp.h"  // PeakLimiter, AudioMixerDsp::panGains
#include "dsp/Gain.h"
#include "dsp/Smoothing.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

constexpr int kConsoleChannels = 32;
constexpr int kConsoleAux = 4;

/// A second-order section (RBJ cookbook), transposed direct form II.
struct ConsoleBiquad {
    float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f, a1 = 0.0f, a2 = 0.0f, z1 = 0.0f, z2 = 0.0f;

    void reset() noexcept { z1 = z2 = 0.0f; }
    float process(float x) noexcept {
        const float y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        return y;
    }
    void set(double nb0, double nb1, double nb2, double na0, double na1, double na2) noexcept {
        b0 = (float)(nb0 / na0), b1 = (float)(nb1 / na0), b2 = (float)(nb2 / na0);
        a1 = (float)(na1 / na0), a2 = (float)(na2 / na0);
    }
    static double w0(double fs, double f) { return 2.0 * 3.14159265358979323846 * std::min(f, 0.45 * fs) / fs; }
    void highPass(double fs, double f, double q = 0.70710678) noexcept {
        const double w = w0(fs, f), c = std::cos(w), a = std::sin(w) / (2.0 * q);
        set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + a, -2 * c, 1 - a);
    }
    void lowPass(double fs, double f, double q = 0.70710678) noexcept {
        const double w = w0(fs, f), c = std::cos(w), a = std::sin(w) / (2.0 * q);
        set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + a, -2 * c, 1 - a);
    }
    void peak(double fs, double f, double db, double q) noexcept {
        const double A = std::pow(10.0, db / 40.0), w = w0(fs, f), c = std::cos(w), a = std::sin(w) / (2.0 * q);
        set(1 + a * A, -2 * c, 1 - a * A, 1 + a / A, -2 * c, 1 - a / A);
    }
    void lowShelf(double fs, double f, double db) noexcept {
        const double A = std::pow(10.0, db / 40.0), w = w0(fs, f), c = std::cos(w);
        const double al = std::sin(w) / 2.0 * std::sqrt((A + 1 / A) * (1 / 0.8 - 1) + 2), t = 2 * std::sqrt(A) * al;
        set(A * ((A + 1) - (A - 1) * c + t), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - t),
            (A + 1) + (A - 1) * c + t, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - t);
    }
    void highShelf(double fs, double f, double db) noexcept {
        const double A = std::pow(10.0, db / 40.0), w = w0(fs, f), c = std::cos(w);
        const double al = std::sin(w) / 2.0 * std::sqrt((A + 1 / A) * (1 / 0.8 - 1) + 2), t = 2 * std::sqrt(A) * al;
        set(A * ((A + 1) + (A - 1) * c + t), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - t),
            (A + 1) - (A - 1) * c + t, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - t);
    }
};

constexpr float kConsoleHpOff = 20.5f;     ///< the high-pass is off at or below this (Hz)
constexpr float kConsoleLpOff = 19500.0f;  ///< the low-pass is off at or above this (Hz)
constexpr float kConsoleEqOff = 0.05f;     ///< a band under this many dB is flat

/// What a strip needs from the controls, in units. The same for a channel and for the master.
struct ConsoleStripParams {
    float levelDb = 0.0f, pan = 0.0f;  ///< pan: -1..+1 (balance for a stereo strip)
    float hpHz = 20.0f, lpHz = 20000.0f;
    float loDb = 0.0f, midDb = 0.0f, hiDb = 0.0f;
    bool mute = false;
};

/// The filters and the three-band EQ of one stereo strip. Coefficients are set once per block.
class ConsoleTone {
public:
    void reset() noexcept {
        for (int c = 0; c < 2; ++c) hp_[c].reset(), lp_[c].reset(), lo_[c].reset(), mid_[c].reset(), hi_[c].reset();
    }
    void update(double fs, const ConsoleStripParams& p) noexcept {
        useHp_ = p.hpHz > kConsoleHpOff;
        useLp_ = p.lpHz < kConsoleLpOff;
        useLo_ = std::fabs(p.loDb) >= kConsoleEqOff;
        useMid_ = std::fabs(p.midDb) >= kConsoleEqOff;
        useHi_ = std::fabs(p.hiDb) >= kConsoleEqOff;
        for (int c = 0; c < 2; ++c) {
            if (useHp_) hp_[c].highPass(fs, p.hpHz);
            if (useLp_) lp_[c].lowPass(fs, p.lpHz);
            if (useLo_) lo_[c].lowShelf(fs, 100.0, p.loDb);
            if (useMid_) mid_[c].peak(fs, 1000.0, p.midDb, 0.9);
            if (useHi_) hi_[c].highShelf(fs, 8000.0, p.hiDb);
        }
    }
    bool active() const noexcept { return useHp_ || useLp_ || useLo_ || useMid_ || useHi_; }
    float process(int c, float x) noexcept {
        if (useHp_) x = hp_[c].process(x);
        if (useLp_) x = lp_[c].process(x);
        if (useLo_) x = lo_[c].process(x);
        if (useMid_) x = mid_[c].process(x);
        if (useHi_) x = hi_[c].process(x);
        return x;
    }

private:
    ConsoleBiquad hp_[2], lp_[2], lo_[2], mid_[2], hi_[2];
    bool useHp_ = false, useLp_ = false, useLo_ = false, useMid_ = false, useHi_ = false;
};

struct ConsoleChannelParams {
    ConsoleStripParams strip;
    float sendDb[kConsoleAux] = {dsp::kFaderFloorDb, dsp::kFaderFloorDb, dsp::kFaderFloorDb, dsp::kFaderFloorDb};
    bool solo = false, stereo = false;
};

struct ConsoleParams {
    int channels = 8, aux = 2, directs = 0;
    ConsoleChannelParams ch[kConsoleChannels];
    bool sendPre[kConsoleAux] = {};
    float returnDb[kConsoleAux] = {}, returnBal[kConsoleAux] = {};
    bool returnMute[kConsoleAux] = {};
    ConsoleStripParams master;
    bool limiter = true, mono = false, directPre = false;
    bool tapPost = false;  ///< the channel recorder tap: false = the input as it arrived, true = after filters, EQ and fader
};

struct ConsoleInputs {
    float l[kConsoleChannels] = {}, r[kConsoleChannels] = {};
    float returnL[kConsoleAux] = {}, returnR[kConsoleAux] = {};
};

struct ConsoleFrame {
    float outL = 0.0f, outR = 0.0f, level = 0.0f;
    float sendL[kConsoleAux] = {}, sendR[kConsoleAux] = {};
    float directL[kConsoleChannels] = {}, directR[kConsoleChannels] = {};
    float tapL[kConsoleChannels] = {}, tapR[kConsoleChannels] = {};  ///< what a channel's recorder track gets
    float peak[kConsoleChannels] = {};                                ///< per channel after the fader
    float auxPeak[kConsoleAux] = {};                                  ///< the send bus, for the meter
};

class AudioConsoleDsp {
public:
    void prepare(double sampleRate) {
        fs_ = sampleRate;
        rampSamples_ = std::max(1, (int)std::lround(sampleRate * 0.005));
        smooth_ = 1.0f - (float)std::exp(-1.0 / (0.005 * sampleRate));
        limiter_.prepare(sampleRate);
        follower_.prepare(sampleRate, 0.01f, 0.2f);
        reset();
    }
    void reset() {
        for (auto& s : strip_) s = Strip();
        masterTone_.reset();
        masterGain_ = 1.0f;
        masterMute_.reset(1.0f);
        limiter_.reset();
        follower_.reset();
    }

    /// Once per block (the engine's 32-sample chunk): the filters and the EQ follow the controls.
    void update(const ConsoleParams& p) noexcept {
        for (int k = 0; k < p.channels; ++k) strip_[k].tone.update(fs_, p.ch[k].strip);
        masterTone_.update(fs_, p.master);
    }

    void tick(const ConsoleInputs& in, const ConsoleParams& p, ConsoleFrame& f) noexcept {
        bool anySolo = false;
        for (int k = 0; k < p.channels; ++k) anySolo = anySolo || p.ch[k].solo;
        float busL = 0.0f, busR = 0.0f;
        float sendL[kConsoleAux] = {}, sendR[kConsoleAux] = {};
        for (int k = 0; k < kConsoleChannels; ++k) {
            if (k >= p.channels) {
                f.peak[k] = f.tapL[k] = f.tapR[k] = f.directL[k] = f.directR[k] = 0.0f;
                continue;
            }
            const auto& c = p.ch[k];
            auto& s = strip_[k];
            float xl = in.l[k], xr = c.stereo ? in.r[k] : in.l[k];
            if (!c.stereo) f.tapL[k] = xl, f.tapR[k] = xl;
            else f.tapL[k] = xl, f.tapR[k] = xr;
            if (s.tone.active()) xl = s.tone.process(0, xl), xr = c.stereo ? s.tone.process(1, xr) : xl;
            s.mute.setTarget(c.strip.mute ? 0.0f : 1.0f, rampSamples_);
            s.solo.setTarget(anySolo && !c.solo ? 0.0f : 1.0f, rampSamples_);
            const float m = s.mute.next(), so = s.solo.next();
            s.gain += (dsp::faderGain(c.strip.levelDb) - s.gain) * smooth_;
            float gl, gr;
            if (p.mono) {
                xl = xr = 0.5f * (xl + xr);
                gl = gr = 1.0f;
            } else {
                AudioMixerDsp::panGains(c.strip.pan, c.stereo, gl, gr);
            }
            const float fl = xl * s.gain * m, fr = xr * s.gain * m;
            f.peak[k] = std::max(std::fabs(fl), std::fabs(fr));
            if (p.tapPost) {
                f.tapL[k] = fl;
                f.tapR[k] = c.stereo ? fr : fl;
            }
            if (k < p.directs) {
                f.directL[k] = p.directPre ? xl : fl;
                f.directR[k] = p.directPre ? xr : fr;
            } else {
                f.directL[k] = f.directR[k] = 0.0f;
            }
            busL += fl * gl * so, busR += fr * gr * so;
            for (int j = 0; j < p.aux; ++j) {
                s.send[j] += (dsp::faderGain(c.sendDb[j]) - s.send[j]) * smooth_;
                if (p.sendPre[j]) sendL[j] += xl * gl * s.send[j] * m, sendR[j] += xr * gr * s.send[j] * m;
                else sendL[j] += fl * gl * s.send[j], sendR[j] += fr * gr * s.send[j];
            }
        }
        for (int j = 0; j < kConsoleAux; ++j) {
            if (j >= p.aux) {
                f.sendL[j] = f.sendR[j] = f.auxPeak[j] = 0.0f;
                continue;
            }
            f.sendL[j] = sendL[j], f.sendR[j] = sendR[j];
            f.auxPeak[j] = std::max(std::fabs(sendL[j]), std::fabs(sendR[j]));
            if (!p.returnMute[j]) {
                float gl, gr;
                AudioMixerDsp::panGains(p.returnBal[j], true, gl, gr);
                const float g = dsp::faderGain(p.returnDb[j]);
                busL += in.returnL[j] * g * gl, busR += in.returnR[j] * g * gr;
            }
        }
        float l = busL, r = busR;
        if (masterTone_.active()) l = masterTone_.process(0, l), r = masterTone_.process(1, r);
        float gl, gr;
        AudioMixerDsp::panGains(p.master.pan, true, gl, gr);
        masterMute_.setTarget(p.master.mute ? 0.0f : 1.0f, rampSamples_);
        masterGain_ += (dsp::faderGain(p.master.levelDb) - masterGain_) * smooth_;
        const float mm = masterMute_.next();
        l *= masterGain_ * gl * mm, r *= masterGain_ * gr * mm;
        if (p.mono) l = r = 0.5f * (l + r);
        if (p.limiter) limiter_.process(l, r);
        f.outL = l, f.outR = r;
        f.level = std::min(1.0f, follower_.process(std::max(std::fabs(l), std::fabs(r))));
    }

    float gainReduction() const noexcept { return limiter_.gainReduction(); }

private:
    struct Strip {
        ConsoleTone tone;
        dsp::LinearRamp mute, solo;
        float gain = 1.0f, send[kConsoleAux] = {};
        Strip() {
            mute.reset(1.0f);
            solo.reset(1.0f);
        }
    };
    double fs_ = 48000.0;
    int rampSamples_ = 240;
    float smooth_ = 0.004f, masterGain_ = 1.0f;
    Strip strip_[kConsoleChannels];
    ConsoleTone masterTone_;
    dsp::LinearRamp masterMute_;
    PeakLimiter limiter_;
    dsp::EnvelopeFollower follower_;
};

}  // namespace bleep::patch
