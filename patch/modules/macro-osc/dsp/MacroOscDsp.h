// SPDX-License-Identifier: GPL-3.0-or-later
// Macro Osc (doc/specs/modules/macro-oscillator.md): sixteen synthesis models
// behind one Model selector and three macro knobs, an Aux output per model,
// and a Trigger with a built-in decay envelope and low-pass gate.
//
// The engine here: pitch and FM, the model switch (a 5 ms equal-power
// crossfade, both models running; a change asked for during a fade waits for
// its end), control-rate updates every kControl samples, the envelope and the
// gate. Only the selected model (and the one fading out) runs; every model
// keeps its state while it isn't selected.
#pragma once

#include "MacroOscCommon.h"
#include "MacroOscPitched.h"
#include "MacroOscStruck.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

/// One sample's controls, in their own units.
struct MacroOscParams {
    int model = macro::VaPair;  ///< 0..15
    double pitch = 0.0;         ///< octaves from C4: Octave + Coarse/12 + Fine/1200 + Pitch
    float fm = 0.0f;            ///< the FM input
    float fmDepth = 0.0f;       ///< 0..1
    float tone = 0.5f, shape = 0.5f, blend = 0.0f;
    float decay = 0.4f;         ///< seconds
    float gateColour = 0.5f;    ///< 0 VCA … 1 low-pass
    float level = 0.8f;
};

struct MacroOscFrame {
    float out = 0.0f, aux = 0.0f, env = 0.0f;
};

class MacroOscDsp {
public:
    static constexpr float kFadeSeconds = 0.005f;
    static constexpr float kRiseSeconds = 0.0005f;
    static constexpr float kGateSmoothSeconds = 0.003f;

    /// Allocates (strings, shared wavetable banks): not on the audio thread.
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        va_.prepare(sr_), fold_.prepare(sr_), fm_.prepare(sr_), warp_.prepare(sr_), grain_.prepare(sr_);
        harmonic_.prepare(sr_), table_.prepare(sr_), chord_.prepare(sr_), vowel_.prepare(sr_);
        noise_.prepare(sr_), dust_.prepare(sr_), pluck_.prepare(sr_), modal_.prepare(sr_);
        kick_.prepare(sr_), snare_.prepare(sr_), metal_.prepare(sr_);
        fadeStep_ = (float)(1.0 / (kFadeSeconds * sr_));
        riseSamples_ = std::max(1, (int)std::lround(kRiseSeconds * sr_));
        smoothA_ = (float)std::exp(-1.0 / (kGateSmoothSeconds * sr_));
        reset();
    }
    void reset() noexcept {
        va_.reset(), fold_.reset(), fm_.reset(), warp_.reset(), grain_.reset();
        harmonic_.reset(), table_.reset(), chord_.reset(), vowel_.reset();
        noise_.reset(), dust_.reset(), pluck_.reset(), modal_.reset();
        kick_.reset(), snare_.reset(), metal_.reset();
        gate_.reset();
        env_ = envSmooth_ = 0.0f;
        riseLeft_ = 0;
        prev_ = pending_ = -1;
        fade_ = 1.0f;
        counter_ = 0;
        primed_ = false;
        reseed();
    }

    /// Quality: 0 Eco (1×, 8 modes), 1 Normal (2×, 16), 2 High (4×, 24).
    void setQuality(int q) noexcept {
        q = std::clamp(q, 0, 2);
        if (q == quality_) return;
        quality_ = q;
        fold_.activate(), fm_.activate(), warp_.activate();  // new factor: clear the decimators
    }
    int quality() const noexcept { return quality_; }

    /// Seed setting and voice index (−1 outside Voice Cells): reseeds the noise if they changed.
    void setSeed(uint32_t seed, int voice) noexcept {
        if (seed == seed_ && voice == voice_) return;
        seed_ = seed, voice_ = voice;
        reseed();
    }
    /// Rewinds every noise source (transport start), so renders repeat.
    void reseed() noexcept {
        auto s = [&](uint64_t m) noexcept { return dsp::hash3(seed_, (uint64_t)(voice_ + 1), 0x3ac0 + m); };
        vowel_.reseed(s(macro::Vowel));
        noise_.reseed(s(macro::NoiseBand));
        dust_.reseed(s(macro::Dust));
        pluck_.reseed(s(macro::Pluck));
        modal_.reseed(s(macro::Modal));
        kick_.reseed(s(macro::Kick));
        snare_.reseed(s(macro::Snare));
    }

    /// Trigger patched: the envelope and the gate are in use.
    void setGated(bool g) noexcept { gated_ = g; }
    void setWantAux(bool w) noexcept { wantAux_ = w; }

    int model() const noexcept { return cur_; }
    int fadingFrom() const noexcept { return fade_ < 1.0f ? prev_ : -1; }
    double hz() const noexcept { return baseHz_; }
    float env() const noexcept { return gated_ ? env_ : 0.0f; }

    MacroOscFrame process(const MacroOscParams& p, bool trigger, float accent) noexcept {
        using namespace macro;
        // Model selection and crossfade.
        const int want = std::clamp(p.model, 0, kModels - 1);
        if (!primed_) {
            cur_ = want;
            primed_ = true;
            activate(cur_);
            counter_ = 0;
        }
        if (fade_ >= 1.0f && pending_ >= 0) {
            if (pending_ != cur_) startFade(pending_);
            pending_ = -1;
        }
        if (want != cur_) {
            if (fade_ >= 1.0f) startFade(want);
            else pending_ = want;
        } else if (fade_ < 1.0f) {
            pending_ = -1;
        }

        // Inputs.
        MacroIn in;
        in.sampleRate = sr_;
        in.os = quality_ == 0 ? 1 : quality_ == 1 ? 2 : 4;
        in.modes = quality_ == 0 ? 8 : quality_ == 1 ? 16 : 24;
        baseHz_ = std::clamp(dsp::osc::pitchToHz(std::isfinite(p.pitch) ? p.pitch : 0.0), 1.0, 0.45 * sr_);
        in.baseHz = baseHz_;
        const float fm = std::isfinite(p.fm) ? std::clamp(p.fm, -4.0f, 4.0f) : 0.0f;
        const float depth = std::clamp(p.fmDepth, 0.0f, 1.0f);
        in.hz = std::clamp(dsp::osc::linearFm(baseHz_, depth, fm), -0.45 * sr_, 0.45 * sr_);
        in.shape = std::clamp(p.shape, 0.0f, 1.0f);
        in.blend = std::clamp(p.blend, 0.0f, 1.0f);
        in.decay = std::clamp(p.decay, 0.005f, 10.0f);
        in.gated = gated_;
        in.wantAux = wantAux_;
        accent = std::isfinite(accent) ? std::clamp(accent, 0.0f, 1.0f) : 1.0f;
        in.accent = accent;
        in.strike = trigger;
        const float toneKnob = std::clamp(p.tone, 0.0f, 1.0f);
        const float toneFm = std::clamp(toneKnob + depth * fm, 0.0f, 1.0f);

        // Envelope: jumps to Accent over 0.5 ms, falls to −60 dB in Decay.
        if (trigger && gated_) {
            riseLeft_ = riseSamples_;
            riseStep_ = (accent - env_) / (float)riseSamples_;
        }
        if (riseLeft_ > 0) {
            env_ += riseStep_;
            --riseLeft_;
        } else {
            if (counter_ == 0 || trigger) envCoef_ = t60Coef(in.decay, sr_);
            env_ *= envCoef_;
            if (env_ < 1e-7f) env_ = 0.0f;
        }

        // Models.
        const bool controlNow = counter_ == 0;
        if (++counter_ >= kControl) counter_ = 0;
        float gatedOut = 0.0f, gatedAux = 0.0f, rawOut = 0.0f, rawAux = 0.0f;
        auto run = [&](int m, float weight) noexcept {
            in.tone = usesFm(m) ? toneKnob : toneFm;
            if (controlNow || trigger) control(m, in);
            const MacroOut o = tick(m, in);
            if (isStruck(m)) rawOut += weight * o.out, rawAux += weight * o.aux;
            else gatedOut += weight * o.out, gatedAux += weight * o.aux;
        };
        if (fade_ < 1.0f) {
            const float t = fade_;
            run(prev_, std::cos(1.5707963f * t));
            run(cur_, std::sin(1.5707963f * t));
            fade_ = std::min(1.0f, fade_ + fadeStep_);
        } else {
            run(cur_, 1.0f);
        }

        // Low-pass gate on the pitched and noise models.
        if (gated_) {
            envSmooth_ = env_ + smoothA_ * (envSmooth_ - env_);
            const float c = std::clamp(p.gateColour, 0.0f, 1.0f);
            const float e = std::max(envSmooth_, 0.0f);
            const float vca = c >= 1.0f ? 1.0f : std::pow(e, 3.0f * (1.0f - c));
            gate_.set(20.0f * std::exp2(10.0f * (1.0f - c + c * e)), sr_);
            gatedOut = vca * gate_.process(gatedOut, 0);
            gatedAux = wantAux_ ? vca * gate_.process(gatedAux, 1) : 0.0f;
        }

        const float level = std::clamp(p.level, 0.0f, 1.0f);
        MacroOscFrame f;
        f.out = safe(level * (gatedOut + rawOut));
        f.aux = wantAux_ ? safe(level * (gatedAux + rawAux)) : 0.0f;
        f.env = gated_ ? env_ : 0.0f;
        return f;
    }

private:
    static float safe(float x) noexcept { return std::isfinite(x) ? std::clamp(x, -4.0f, 4.0f) : 0.0f; }

    void startFade(int m) noexcept {
        prev_ = cur_;
        cur_ = m;
        fade_ = 0.0f;
        activate(m);
        counter_ = 0;  // control update for the new model now
    }

    template <class F>
    auto with(int m, F&& f) noexcept {
        using namespace macro;
        switch (m) {
            case VaPair: return f(va_);
            case Fold: return f(fold_);
            case Fm: return f(fm_);
            case PhaseWarp: return f(warp_);
            case Grain: return f(grain_);
            case Harmonic: return f(harmonic_);
            case Table: return f(table_);
            case Chord: return f(chord_);
            case Vowel: return f(vowel_);
            case NoiseBand: return f(noise_);
            case Dust: return f(dust_);
            case Pluck: return f(pluck_);
            case Modal: return f(modal_);
            case Kick: return f(kick_);
            case Snare: return f(snare_);
            default: return f(metal_);
        }
    }
    void activate(int m) noexcept {
        with(m, [](auto& x) noexcept { x.activate(); });
    }
    void control(int m, const macro::MacroIn& in) noexcept {
        with(m, [&](auto& x) noexcept { x.control(in); });
    }
    macro::MacroOut tick(int m, const macro::MacroIn& in) noexcept {
        return with(m, [&](auto& x) noexcept { return x.tick(in); });
    }

    double sr_ = 48000.0, baseHz_ = dsp::osc::kC4Hz;
    macro::VaPairModel va_;
    macro::FoldModel fold_;
    macro::FmModel fm_;
    macro::PhaseWarpModel warp_;
    macro::GrainModel grain_;
    macro::HarmonicModel harmonic_;
    macro::TableModel table_;
    macro::ChordModel chord_;
    macro::VowelModel vowel_;
    macro::NoiseBandModel noise_;
    macro::DustModel dust_;
    macro::PluckModel pluck_;
    macro::ModalModel modal_;
    macro::KickModel kick_;
    macro::SnareModel snare_;
    macro::MetalModel metal_;
    macro::GateFilter gate_;

    int cur_ = 0, prev_ = -1, pending_ = -1, quality_ = 1, counter_ = 0;
    float fade_ = 1.0f, fadeStep_ = 0.004f;
    float env_ = 0.0f, envSmooth_ = 0.0f, envCoef_ = 0.999f, riseStep_ = 0.0f, smoothA_ = 0.99f;
    int riseLeft_ = 0, riseSamples_ = 24;
    uint32_t seed_ = 1;
    int voice_ = -1;
    bool gated_ = false, wantAux_ = true, primed_ = false;
};

}  // namespace bleep::patch
