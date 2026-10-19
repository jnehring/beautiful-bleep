// SPDX-License-Identifier: GPL-3.0-or-later
// Modal Voice DSP (doc/specs/modules/modal-voice.md): exciters (bow, blow,
// mallet, external audio) drive the shared modal bank, and a small room
// places it. Everything runs sample by sample, so the bow's and the jet's
// feedback from the body is one sample long. A gate-driven contour envelope
// swells the bow and the breath. Silent voices sleep.
//
// Memory (the room) is allocated in prepare(); tick() never allocates.
#pragma once

#include "dsp/Clip.h"
#include "dsp/Drums.h"
#include "dsp/Exciter.h"
#include "dsp/ModalBank.h"
#include "dsp/Room.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

struct ModalVoiceParams {
    // Exciter
    float bow = 0.0f, bowTimbre = 0.5f;
    float blow = 0.0f, blowTimbre = 0.4f;
    float strike = 0.8f, strikeTimbre = 0.5f;
    float contour = 0.3f;
    float extLevel = 1.0f;
    // Resonator
    float coarse = 0.0f;  ///< semitones
    float fine = 0.0f;    ///< cents
    float geometry = 0.25f, brightness = 0.55f, damping = 0.4f, position = 0.3f;
    // Space
    float size = 0.4f, space = 0.2f;
    int partials = 32;
    uint64_t seed = 1;
};

namespace modalvoice {

constexpr double kC4 = 261.6255653005986;

/// T60 of the fundamental for Damping 0..1: 20 s · 0.002^damping.
inline float t60(float damping) noexcept {
    return 20.0f * std::pow(0.002f, std::clamp(damping, 0.0f, 1.0f));
}

/// The bow/blow envelope (Contour): attack 400 ms · (1 − C)³ + 2 ms, release
/// T60 1.5 s · (1 − C)² + 30 ms; from C = 0.5 up the attack overshoots to 1
/// and decays over about 200 ms to a sustain of 1 − (C − 0.5). A new gate
/// starts from the current value (no click).
class Contour {
public:
    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        decayA_ = (float)std::exp(-1.0 / (0.067 * sampleRate));  // ≈ 95 % in 200 ms
    }
    void reset() noexcept {
        v_ = 0.0f;
        stage_ = Idle;
    }
    void set(float contour) noexcept {
        const float c = std::clamp(contour, 0.0f, 1.0f);
        if (!dsp::differs(c, contour_)) return;
        contour_ = c;
        const float k = 1.0f - c;
        attackStep_ = (float)(1.0 / ((0.4 * k * k * k + 0.002) * sr_));
        releaseA_ = dsp::decayCoef(1.5f * k * k + 0.03f, sr_);
        sustain_ = c > 0.5f ? 1.0f - (c - 0.5f) : 1.0f;
    }
    float process(bool gate) noexcept {
        if (gate && (stage_ == Idle || stage_ == Release)) stage_ = Attack;
        if (!gate && stage_ != Idle) stage_ = Release;
        switch (stage_) {
            case Attack:
                v_ += attackStep_;
                if (v_ >= 1.0f) v_ = 1.0f, stage_ = Decay;
                break;
            case Decay: v_ = sustain_ + decayA_ * (v_ - sustain_); break;
            case Release:
                v_ *= releaseA_;
                if (v_ < 1e-5f) v_ = 0.0f, stage_ = Idle;
                break;
            case Idle: break;
        }
        return v_;
    }
    bool idle() const noexcept { return stage_ == Idle; }

private:
    enum Stage { Idle, Attack, Decay, Release };
    double sr_ = 48000.0;
    float v_ = 0.0f, contour_ = -1.0f, attackStep_ = 0.001f, releaseA_ = 0.999f, decayA_ = 0.999f, sustain_ = 1.0f;
    Stage stage_ = Idle;
};

}  // namespace modalvoice

class ModalVoiceDsp {
public:
    static constexpr int kSub = 16;
    static constexpr float kFloor = 1e-4f;  ///< −80 dB

    // Level calibration (see the tests): a default strike peaks around 0.5,
    // a bow at 80 % and a singing blow sit around 0.2–0.4 RMS.
    static constexpr float kBowSpeed = 0.5f;
    static constexpr float kStrike = 3.0f;
    static constexpr float kBody = 0.5f;
    static constexpr float kExt = 2.0f;
    static constexpr float kBreath = 0.4f;  ///< breath noise straight to the output

    struct Frame {
        float l, r, exciter;
        bool active;
    };

    /// Allocates the room (not RT-safe).
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        bank_.prepare(sampleRate);
        bank_.setInput(dsp::ModalBank::Input::Struck);
        bow_.prepare(sampleRate);
        blow_.prepare(sampleRate);
        mallet_.prepare(sampleRate);
        room_.prepare(sampleRate, 1);
        env_.prepare(sampleRate);
        holdLen_ = (int)(0.05 * sampleRate);
        malletScale_ = (float)(0.0005 * sampleRate);
        reset();
    }
    void reset() noexcept {
        bank_.reset();
        bow_.reset();
        blow_.reset();
        mallet_.reset();
        room_.reset();
        env_.reset();
        last_ = 0.0f;
        hold_ = 0;
        sleeping_ = true;
        gate_ = false;
    }
    void resetCount() noexcept { mallet_.resetCount(); }

    /// Once per kSub samples. pitch: octaves (1 V/oct, 0 = C4).
    void set(const ModalVoiceParams& p, float pitch) noexcept {
        p_ = p;
        env_.set(p.contour);
        mallet_.setSeed(p.seed);
        if (!std::isfinite(pitch)) pitch = 0.0f;
        f0_ = std::clamp((float)(modalvoice::kC4 * std::exp2(std::clamp(pitch, -10.0f, 10.0f) +
                                                            (p.coarse + p.fine / 100.0f) / 12.0f)),
                         16.0f, 0.45f * (float)sr_);
        dsp::RoomParams rp;
        rp.size = p.size;
        rp.damping = 0.5f;
        rp.amount = p.space;
        room_.set(rp);
        if (sleeping_) return;
        updateBank();
    }

    /// Gate level for bow and blow; velocity sampled by the caller.
    void gate(bool high, float velocity) noexcept {
        if (high && !gate_) {
            vel_ = std::clamp(velocity, 0.0f, 1.0f);
            wake();
        }
        gate_ = high;
    }
    void strike(float velocity) noexcept {
        const float level = std::clamp(p_.strike, 0.0f, 1.0f) * std::clamp(velocity, 0.0f, 1.0f);
        if (!(level > 0.0f)) return;
        vel_ = std::clamp(velocity, 0.0f, 1.0f);
        wake();
        mallet_.strike(level, p_.strikeTimbre);
    }

    /// One sample. ext: the Ext In signal (0 when unpatched).
    Frame tick(float ext) noexcept {
        if (!std::isfinite(ext)) ext = 0.0f;
        const float extIn = std::clamp(ext, -10.0f, 10.0f) * std::clamp(p_.extLevel, 0.0f, 1.0f) * vel_;
        if (sleeping_) {
            if (extIn == 0.0f && !gate_) return {0.0f, 0.0f, 0.0f, false};
            wake();
        }
        const float e = env_.process(gate_);

        // Exciters (the ones at 0 cost nothing).
        float bowF = 0.0f, blowE = 0.0f;
        const float bowV = e * std::clamp(p_.bow, 0.0f, 1.0f) * vel_ * kBowSpeed;
        if (bowV > 0.0f) bowF = bow_.process(bowV, bank_.velocity(), p_.bowTimbre);
        const float flow = e * std::clamp(p_.blow, 0.0f, 1.0f) * vel_;
        if (flow > 0.0f || blowActive_) {
            blowE = blow_.process(flow, p_.blowTimbre, f0_, last_);
            blowActive_ = flow > 0.0f;
        }
        const float mal = mallet_.process();

        const auto y = bank_.process(bowF * coupling_ + kStrike * mal + extIn * extScale_, blowE);
        last_ = y.mix();
        // Two pickups: odd partials lean left, even right (60/40); the
        // fundamental sits in the middle.
        const float oddUpper = y.odd - y.fundamental;
        float l = kBody * (0.6f * oddUpper + 0.5f * y.fundamental + 0.4f * y.even) + kBreath * blowE;
        float r = kBody * (0.4f * oddUpper + 0.5f * y.fundamental + 0.6f * y.even) + kBreath * blowE;
        if (!std::isfinite(l) || !std::isfinite(r)) {  // never expected; recover quietly
            bank_.reset();
            l = r = 0.0f;
        }
        l = dsp::softClip(l);
        r = dsp::softClip(r);
        const auto wet = room_.process(l, r);
        l += wet.l;
        r += wet.r;

        const bool loud = std::fabs(l) > kFloor || std::fabs(r) > kFloor;
        if (gate_ || loud || mallet_.active() || extIn != 0.0f) hold_ = holdLen_;
        else if (hold_ > 0) --hold_;
        const bool active = hold_ > 0;
        if (!active) sleep();  // below −80 dB (body and room) for 50 ms
        const float exciter = 0.2f * bowF + blowE + mal * malletScale_ + extIn;
        return {std::clamp(l, -2.0f, 2.0f), std::clamp(r, -2.0f, 2.0f), std::clamp(exciter, -10.0f, 10.0f), active};
    }

    bool sleeping() const noexcept { return sleeping_; }
    const dsp::ModalBank& bank() const noexcept { return bank_; }
    float f0() const noexcept { return f0_; }

private:
    void updateBank() noexcept {
        bank_.setModeCount(p_.partials);
        bank_.setSeed(p_.seed);
        dsp::ModalParams mp;
        mp.f0Hz = f0_;
        mp.structure = p_.geometry;
        mp.brightness = p_.brightness;
        mp.t60 = modalvoice::t60(p_.damping);
        mp.position = p_.position;
        bank_.set(mp, kSub);
        coupling_ = dsp::bowCoupling(bank_.admittance());
        extScale_ = kExt * std::sqrt(2.0f * (1.0f - dsp::decayCoef(mp.t60, sr_)));
    }
    void wake() noexcept {
        if (!sleeping_) return;
        sleeping_ = false;
        hold_ = holdLen_;
        updateBank();
    }
    void sleep() noexcept {
        sleeping_ = true;
        if (!room_.sleeping()) room_.reset();
        env_.reset();
        bank_.reset();
        blow_.reset();
        blowActive_ = false;
        last_ = 0.0f;
    }

    double sr_ = 48000.0;
    ModalVoiceParams p_;
    dsp::ModalBank bank_;
    dsp::Bow bow_;
    dsp::Blow blow_;
    dsp::Mallet mallet_;
    dsp::Room<4> room_;
    modalvoice::Contour env_;
    float f0_ = 261.63f, coupling_ = 1.0f, extScale_ = 0.0f, last_ = 0.0f, vel_ = 1.0f, malletScale_ = 24.0f;
    int hold_ = 0, holdLen_ = 2400;
    bool sleeping_ = true, gate_ = false, blowActive_ = false;
};

}  // namespace bleep::patch
