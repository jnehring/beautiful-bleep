// SPDX-License-Identifier: GPL-3.0-or-later
// Resonator DSP (doc/specs/modules/resonator.md): up to four voices of a tuned
// body (the shared ModalBank, SympatheticStrings or a WaveguideString), fed by
// the input and by an internal noise-burst exciter on each strum. Voices take
// turns on strums (round robin); the newest one gets the input and follows
// the pitch, older ones ring out at their own pitch. Silent voices sleep.
//
// Memory is allocated in prepare(); tick() and set() never allocate.
#pragma once

#include "dsp/Clip.h"
#include "dsp/Drums.h"
#include "dsp/Exciter.h"
#include "dsp/ModalBank.h"
#include "dsp/Random.h"
#include "dsp/Smoothing.h"
#include "dsp/Waveguide.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum class ResonatorModel { Modal = 0, Sympathetic = 1, String = 2 };

struct ResonatorParams {
    float frequency = 0.0f;   ///< semitones around C4
    float structure = 0.25f;
    float brightness = 0.6f;
    float damping = 0.45f;
    float position = 0.3f;
    float inputGainDb = 0.0f;
    float exciter = 0.5f;
    float width = 1.0f;
    float dry = 0.0f;
    ResonatorModel model = ResonatorModel::Modal;
    int polyphony = 1;        ///< 1, 2 or 4
    int modes = 32;           ///< 16, 32 or 64 (Modal)
    bool inputOnsets = false; ///< Strum Source: onsets of In
    uint64_t seed = 1;
};

namespace resonator {

constexpr double kC4 = 261.6255653005986;

/// T60 of the fundamental for Damping 0..1: 30 s · 0.0017^damping.
inline float t60(float damping) noexcept {
    return 30.0f * std::pow(0.0017f, std::clamp(damping, 0.0f, 1.0f));
}

/// Eight intervals (semitones) for the sympathetic set at a Structure 0..1:
/// eight tunings in steps of ⅛, gliding into the next over the last fifth
/// of each step so sweeping Structure never jumps.
inline void sympatheticIntervals(float structure, uint64_t seed, float out[8]) noexcept {
    const float s = std::clamp(structure, 0.0f, 1.0f) * 8.0f;
    const int i = std::min((int)s, 7);
    const float t = std::clamp((s - (float)i - 0.8f) / 0.2f, 0.0f, 1.0f);
    float a[8], b[8];
    dsp::stringTuning((dsp::StringTuning)i, seed, a);
    dsp::stringTuning((dsp::StringTuning)std::min(i + 1, 7), seed, b);
    for (int k = 0; k < 8; ++k) out[k] = a[k] + t * (b[k] - a[k]);
}

}  // namespace resonator

class ResonatorDsp {
public:
    static constexpr int kVoices = 4;
    static constexpr int kSub = 16;  ///< coefficient update and ramp length

    struct Frame {
        float odd, even;
    };

    // Level calibration (see the tests): a default strum peaks around 0.5;
    // white noise in comes out at about its own level.
    static constexpr float kModalExciter = 0.07f;
    static constexpr float kModalInput = 2.0f;
    static constexpr float kStringExciter = 0.8f;
    static constexpr float kStringInput = 15.0f;
    static constexpr float kSympExciter = 28.0f;
    static constexpr float kSympInput = 10.0f;

    /// Allocates the strings (not RT-safe).
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        for (auto& v : voices_) {
            v.bank.prepare(sampleRate);
            v.bank.setInput(dsp::ModalBank::Input::Struck);
            v.string.prepare(sampleRate, 16.0f, true);
            v.symp.prepare(sampleRate, 16.0f);
            v.burst.prepare(sampleRate);
        }
        fast_.prepare(sampleRate, 0.0005f, 0.010f);
        slow_.prepare(sampleRate, 0.030f, 0.150f);
        rampStep_ = (float)(1.0 / (0.005 * sampleRate));
        sleepAfter_ = (int)(0.05 * sampleRate);
        holdoffLen_ = (int)(0.03 * sampleRate);
        dipLen_ = std::max(1, (int)(0.0025 * sampleRate));
        reset();
    }
    void reset() noexcept {
        for (auto& v : voices_) clearVoice(v);
        voices_[0].inGain = 1.0f;
        active_ = 0;
        strums_ = 0;
        holdoff_ = 0;
        armed_ = true;
        dip_ = 0;
        fast_.reset();
        slow_.reset();
        model_ = pendingModel_ = p_.model;
    }
    void resetCount() noexcept { strums_ = 0; }

    /// Once per kSub samples (and before the first tick).
    void set(const ResonatorParams& p) noexcept {
        if (p.model != pendingModel_) {
            pendingModel_ = p.model;
            bool silent = true;
            for (const auto& v : voices_) silent = silent && v.sleeping;
            if (silent && dip_ == 0) switchModel();  // nothing rings: switch at once
            else if (dip_ == 0) dip_ = 2 * dipLen_;  // fade out, switch at the bottom, fade in
        }
        p_ = p;
        p_.model = model_;
        p_.polyphony = p.polyphony >= 4 ? 4 : p.polyphony >= 2 ? 2 : 1;
        inGain_ = std::pow(10.0f, std::clamp(p.inputGainDb, -24.0f, 24.0f) / 20.0f);
        const float t60 = resonator::t60(p.damping);
        for (int i = 0; i < kVoices; ++i) {
            Voice& v = voices_[i];
            if (v.sleeping) continue;
            const float hz = std::clamp((float)(resonator::kC4 * std::exp2((p.frequency + 12.0f * v.pitch) / 12.0f)),
                                        16.0f, 0.4f * (float)sr_);
            switch (model_) {
                case ResonatorModel::Modal: {
                    v.bank.setModeCount(p.modes);
                    v.bank.setSeed(p.seed);
                    dsp::ModalParams mp;
                    mp.f0Hz = hz;
                    mp.structure = p.structure;
                    mp.brightness = p.brightness;
                    mp.t60 = t60;
                    mp.position = p.position;
                    v.bank.set(mp, kSub);
                    // Energy-normalised input: noise in gives about the same
                    // level at any decay; transients ring longer but softer.
                    v.inScale = kModalInput * std::sqrt(2.0f * (1.0f - dsp::decayCoef(t60, sr_)));
                    break;
                }
                case ResonatorModel::String: {
                    dsp::StringParams sp;
                    sp.hz = hz;
                    sp.t60 = t60;
                    sp.brightness = p.brightness;
                    sp.dispersion = p.structure;
                    sp.position = p.position;
                    v.string.set(sp);
                    v.inScale = kStringInput * (1.0f - v.string.loopGain());
                    break;
                }
                case ResonatorModel::Sympathetic: {
                    float semis[8];
                    resonator::sympatheticIntervals(p.structure, p.seed, semis);
                    bool changed = false;
                    for (int k = 0; k < 8; ++k) changed = changed || dsp::differs(semis[k], v.semis[k]);
                    if (changed) {
                        for (int k = 0; k < 8; ++k) v.semis[k] = semis[k];
                        v.symp.setIntervals(semis, 8);
                    }
                    v.symp.set(hz, t60, p.brightness, p.position);
                    v.inScale = kSympInput;
                    break;
                }
            }
            v.hz = hz;
        }
    }

    /// A strum: the next voice (round robin) takes the pitch (octaves) and
    /// the input, and the exciter fires on it.
    void strum(float pitch) noexcept {
        const int n = p_.polyphony;
        if (n > 1) active_ = (active_ + 1) % n;
        else active_ = 0;
        Voice& v = voices_[active_];
        v.pitch = pitch;
        wake(v);
        const float level = std::clamp(p_.exciter, 0.0f, 1.0f);
        if (level > 0.0f) {
            const float tone = 500.0f * std::pow(32.0f, std::clamp(p_.brightness, 0.0f, 1.0f));
            v.burst.trigger(level, 0.003f, tone, 0.5f, dsp::hash3(p_.seed, strums_, 0x57a));
        }
        ++strums_;
        set(paramsForSet());
    }

    /// One sample. in: the input (before Input Gain); pitch: octaves.
    Frame tick(float in, float pitch) noexcept {
        if (!std::isfinite(in)) in = 0.0f;
        if (!std::isfinite(pitch)) pitch = 0.0f;
        const float x = std::clamp(in * inGain_, -40.0f, 40.0f);
        lastIn_ = x;

        if (p_.inputOnsets) {
            const float f = fast_.process(x), s = slow_.process(x);
            // An onset: the fast envelope jumps 6 dB above the slow one. It
            // re-arms once the two have come back together (or it is quiet).
            if (holdoff_ > 0) --holdoff_;
            if (f < 1.4f * s || f < kOnsetFloor) armed_ = true;
            if (armed_ && holdoff_ == 0 && f > kOnsetFloor && f > 2.0f * s) {
                strum(pitch);
                holdoff_ = holdoffLen_;
                armed_ = false;
            }
        }
        voices_[active_].pitch = pitch;

        float odd = 0.0f, even = 0.0f, fund = 0.0f;
        for (int i = 0; i < kVoices; ++i) {
            Voice& v = voices_[i];
            const float target = i == active_ ? 1.0f : 0.0f;
            v.inGain += std::clamp(target - v.inGain, -rampStep_, rampStep_);
            const float xv = x * v.inGain;
            if (v.sleeping) {
                if (xv == 0.0f) continue;
                wake(v);
                set(paramsForSet());
            }
            const float exc = v.burst.active() ? v.burst.process() : 0.0f;
            float o = 0.0f, e = 0.0f;
            switch (model_) {
                case ResonatorModel::Modal: {
                    const auto y = v.bank.process(exc * kModalExciter + xv * v.inScale, 0.0f);
                    o = y.odd;
                    e = y.even;
                    fund += y.fundamental;
                    break;
                }
                case ResonatorModel::String: {
                    v.string.process(exc * kStringExciter + xv * v.inScale);
                    v.string.pickups(o, e);
                    break;
                }
                case ResonatorModel::Sympathetic: {
                    const auto y = v.symp.process(exc * kSympExciter + xv * v.inScale);
                    o = y.odd;
                    e = y.even;
                    break;
                }
            }
            if (!std::isfinite(o) || !std::isfinite(e)) {  // never expected; recover quietly
                clearVoice(v);
                continue;
            }
            odd += o;
            even += e;
            // Sleep after 50 ms below −100 dB with nothing coming in.
            const float level = std::fabs(o) + std::fabs(e);
            v.level = std::max(level, v.level * 0.9995f);
            if (level < 1e-5f && xv == 0.0f && !v.burst.active()) {
                if (++v.quiet > sleepAfter_) clearVoice(v);
            } else {
                v.quiet = 0;
            }
        }
        // The fundamental (in Odd) goes half to each side so low notes stay centred.
        odd -= 0.5f * fund;
        even += 0.5f * fund;
        const float w = std::clamp(p_.width, 0.0f, 1.0f);
        float l = 0.5f * (1.0f + w) * odd + 0.5f * (1.0f - w) * even;
        float r = 0.5f * (1.0f + w) * even + 0.5f * (1.0f - w) * odd;
        l = dsp::softClip(l);
        r = dsp::softClip(r);
        if (dip_ > 0) {
            --dip_;
            if (dip_ == dipLen_) switchModel();
            const float g = (float)std::abs(dip_ - dipLen_) / (float)dipLen_;
            l *= g;
            r *= g;
        }
        const float dry = std::clamp(p_.dry, 0.0f, 1.0f) * x;
        return {std::clamp(l + dry, -10.0f, 10.0f), std::clamp(r + dry, -10.0f, 10.0f)};
    }

    // ---- for the view and the tests ----------------------------------------
    int activeVoice() const noexcept { return active_; }
    uint64_t strumCount() const noexcept { return strums_; }
    ResonatorModel model() const noexcept { return model_; }
    bool ringing(int i) const noexcept { return !voices_[i].sleeping; }
    float voiceLevel(int i) const noexcept { return voices_[i].sleeping ? 0.0f : voices_[i].level; }
    float voiceHz(int i) const noexcept { return voices_[i].hz; }
    float voicePitch(int i) const noexcept { return voices_[i].pitch; }
    const dsp::ModalBank& bank(int i) const noexcept { return voices_[i].bank; }
    const dsp::SympatheticStrings& sympathetic(int i) const noexcept { return voices_[i].symp; }
    float interval(int voice, int k) const noexcept { return voices_[voice].semis[k]; }
    float inputGain(int i) const noexcept { return voices_[i].inGain; }

private:
    struct Voice {
        dsp::ModalBank bank;
        dsp::WaveguideString string;
        dsp::SympatheticStrings symp;
        dsp::NoiseBurst burst;
        float pitch = 0.0f, hz = 261.63f, inGain = 0.0f, inScale = 0.0f, level = 0.0f;
        float semis[8] = {-99, -99, -99, -99, -99, -99, -99, -99};
        int quiet = 0;
        bool sleeping = true;
    };

    ResonatorParams paramsForSet() const noexcept {
        ResonatorParams p = p_;
        p.model = pendingModel_;
        return p;
    }
    void wake(Voice& v) noexcept { v.sleeping = false, v.quiet = 0; }
    void clearVoice(Voice& v) noexcept {
        if (!v.sleeping) {
            v.bank.reset();
            v.string.reset();
            v.symp.reset();
        }
        v.burst.reset();
        v.sleeping = true;
        v.quiet = 0;
        v.level = 0.0f;
    }
    void switchModel() noexcept {
        for (auto& v : voices_) {
            v.sleeping = false;  // force a full clear
            clearVoice(v);
        }
        model_ = pendingModel_;
        p_.model = model_;
    }

    double sr_ = 48000.0;
    ResonatorParams p_;
    Voice voices_[kVoices];
    ResonatorModel model_ = ResonatorModel::Modal, pendingModel_ = ResonatorModel::Modal;
    int active_ = 0, holdoff_ = 0, holdoffLen_ = 1440, sleepAfter_ = 2400, dip_ = 0, dipLen_ = 120;
    uint64_t strums_ = 0;
    bool armed_ = true;
    static constexpr float kOnsetFloor = 0.003f;  // −50 dB
    float inGain_ = 1.0f, rampStep_ = 0.004f, lastIn_ = 0.0f;
    dsp::EnvelopeFollower fast_, slow_;
};

}  // namespace bleep::patch
