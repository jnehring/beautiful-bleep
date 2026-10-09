// SPDX-License-Identifier: MIT
// Macro Osc models 10–16 (doc/specs/modules/macro-oscillator.md 4.2): the noise
// models (Noise Band, Dust) and the struck ones (Pluck, Modal, Kick, Snare,
// Metal), built from the shared physical-model and drum parts:
// WaveguideString + NoiseBurst (Pluck), ModalBank + Mallet (Modal),
// Resonator / Decay / Metal / Filter from Drums.h (Kick, Snare, Metal).
//
// Every noise comes from a seeded Rng (MacroOscCommon.h), reseeded from
// (Seed, voice) at transport start, so renders repeat and voices differ.
// Struck models add energy on a retrigger instead of restarting.
#pragma once

#include "MacroOscCommon.h"
#include "dsp/Clip.h"
#include "dsp/Drums.h"
#include "dsp/Exciter.h"
#include "dsp/ModalBank.h"
#include "dsp/Svf.h"
#include "dsp/Waveguide.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::patch::macro {

// ---- 10 Noise Band ---------------------------------------------------------------

/// White noise (optionally sample-rate reduced by Blend, down to ≈ 90 Hz)
/// into a resonant ZDF SVF at f: Q 0.5…40 (Tone), LP → BP → HP (Shape).
/// Each response is normalised to about the same loudness. Aux: the other
/// side (HP for LP, notch for BP, LP for HP).
struct NoiseBandModel {
    dsp::Svf svf;
    Rng rng;
    float held = 0.0f, nLp = 1.0f, nBp = 1.0f, k = 1.0f;
    double clock = 0.0;

    void prepare(double) noexcept {}
    void reset() noexcept {
        svf.reset();
        held = 0.0f;
        clock = 0.0;
    }
    void reseed(uint64_t seed) noexcept { rng.seed(seed); }
    void activate() noexcept {}
    void control(const MacroIn& in) noexcept {
        const double sr = in.sampleRate;
        const float hz = (float)std::clamp(in.baseHz, 20.0, 0.45 * sr);
        const float q = 0.5f * std::pow(80.0f, std::clamp(in.tone, 0.0f, 1.0f));
        svf.set(hz, q, sr);
        k = 1.0f / q;
        // White noise keeps ≈ 2·hz/sr of its power below hz: make up for it.
        const float share = std::clamp(2.0f * hz / (float)sr, 1e-4f, 1.0f);
        nLp = std::min(1.0f / std::sqrt(share * (1.0f + 0.25f * q)), 30.0f);
        nBp = std::min(1.0f / std::sqrt(share * k), 60.0f) * k;
    }
    MacroOut tick(const MacroIn& in) noexcept {
        const float blend = std::clamp(in.blend, 0.0f, 1.0f);
        if (blend <= 0.0f) {
            held = rng.bipolar();
        } else {
            clock += std::exp2(-9.0 * (double)blend);
            if (clock >= 1.0) {
                clock -= std::floor(clock);
                held = rng.bipolar();
            }
        }
        const dsp::SvfOutputs o = svf.process(0.5f * held);
        const float lp = nLp * o.lp, bp = nBp * o.bp, hp = 1.6f * o.hp;
        const float notch = 1.6f * (0.5f * held - k * o.bp);
        const float m = 2.0f * std::clamp(in.shape, 0.0f, 1.0f);
        const float out = m < 1.0f ? lp + m * (bp - lp) : bp + (m - 1.0f) * (hp - bp);
        float aux = 0.0f;
        if (in.wantAux) aux = m < 1.0f ? hp + m * (notch - hp) : notch + (m - 1.0f) * (lp - notch);
        return {dsp::softClip(out), dsp::softClip(aux)};
    }
};

// ---- 11 Dust -------------------------------------------------------------------

/// Random impulses at 1…20 000 per second (Tone, exponential), random
/// heights, a share of them negative (Blend: 0 % none, 100 % half), through a
/// slightly resonant low-pass from f / 8 to f × 128 (Shape: dark → bright),
/// normalised so one impulse peaks near its height. Aux: the raw impulses.
struct DustModel {
    dsp::Svf svf;
    Rng rng;
    float gain = 1.0f;

    void prepare(double) noexcept {}
    void reset() noexcept { svf.reset(); }
    void reseed(uint64_t seed) noexcept { rng.seed(seed); }
    void activate() noexcept {}
    void control(const MacroIn& in) noexcept {
        const double sr = in.sampleRate;
        const double fc = std::clamp(in.baseHz * std::exp2(10.0 * (double)std::clamp(in.shape, 0.0f, 1.0f) - 3.0), 20.0, 0.45 * sr);
        svf.set((float)fc, 1.3f, sr);
        gain = (float)std::clamp(sr / (2.6 * fc), 1.0, 400.0);
    }
    MacroOut tick(const MacroIn& in) noexcept {
        const double density = std::exp2(14.29 * (double)std::clamp(in.tone, 0.0f, 1.0f));  // 1 … 20 000 /s
        const float p = (float)std::min(density / in.sampleRate, 1.0);
        float imp = 0.0f;
        if (rng.unit() < p) {
            const float h = 0.4f + 0.6f * rng.unit();
            imp = rng.unit() < 0.5f * std::clamp(in.blend, 0.0f, 1.0f) ? -h : h;
        }
        const float y = gain * svf.process(imp).lp;
        return {dsp::softClip(0.8f * y), imp};
    }
};

// ---- 12 Pluck ------------------------------------------------------------------

/// The shared waveguide string (Waveguide.h: Thiran fractional delay, loop
/// low-pass, compensated tuning and T60) struck by a noise burst (Exciter.h)
/// one period long. Tone: exciter colour; Shape: damping (the loop's
/// low-pass); Blend: pluck position (a comb on the exciter). T60 = Decay.
/// Unstruck (Trigger unpatched) a quiet stream of noise, coloured like the
/// exciter, keeps the string sounding (bowed / blown). Aux: the exciter.
struct PluckModel {
    dsp::WaveguideString string;
    dsp::NoiseBurst burst;
    Rng rng;
    uint64_t seed = 1, strikes = 0;
    float colourA = 0.5f, lp = 0.0f, inGain = 0.0f;
    double lastHz = 0.0;

    void prepare(double sampleRate) {
        string.prepare(sampleRate, 16.0f, true);
        burst.prepare(sampleRate);
    }
    void reset() noexcept {
        string.reset();
        burst.reset();
        lp = 0.0f;
        strikes = 0;
    }
    void reseed(uint64_t s) noexcept {
        seed = s;
        rng.seed(s);
        strikes = 0;
    }
    void activate() noexcept {}
    static float colourHz(float tone) noexcept { return 300.0f * std::exp2(6.0f * std::clamp(tone, 0.0f, 1.0f)); }
    void control(const MacroIn& in) noexcept {
        const double sr = in.sampleRate;
        dsp::StringParams p;
        lastHz = std::clamp(std::fabs(in.hz), 16.0, 0.45 * sr);
        p.hz = (float)lastHz;
        p.t60 = std::max(in.decay, 0.02f);
        p.brightness = 1.0f - 0.85f * std::clamp(in.shape, 0.0f, 1.0f);
        p.position = 0.06f + 0.44f * std::clamp(in.blend, 0.0f, 1.0f);
        string.set(p);
        colourA = (float)std::exp(-6.283185307 * std::min((double)colourHz(in.tone), 0.45 * sr) / sr);
        inGain = 6.0f * (1.0f - string.loopGain());
        if (in.strike) {
            const float length = (float)std::clamp(1.0 / lastHz, 0.001, 0.03);
            burst.trigger(in.accent, length, colourHz(in.tone), 0.25f * in.tone,
                          dsp::hash3(seed, strikes++, 0x91c));
        }
    }
    MacroOut tick(const MacroIn& in) noexcept {
        float e = burst.process();
        if (!in.gated) {
            lp = (1.0f - colourA) * rng.bipolar() + colourA * lp;
            e += inGain * lp;
        }
        return {0.55f * string.process(e), e};
    }
};

// ---- 13 Modal ------------------------------------------------------------------

/// The shared modal bank (ModalBank.h) with 8 / 16 / 24 modes by Quality.
/// Tone: material, stiff string → bar → plate → bell; Shape: brightness (high
/// mode level and the mallet's hardness); Blend: inharmonic stretch 0…+15 %.
/// T60 = Decay. Unstruck, quiet noise into the resonant input keeps it
/// singing. Aux: the odd modes.
struct ModalModel {
    dsp::ModalBank bank;
    dsp::Mallet mallet;
    Rng rng;
    float noiseGain = 0.0f;

    void prepare(double sampleRate) noexcept {
        bank.prepare(sampleRate);
        mallet.prepare(sampleRate);
    }
    void reset() noexcept {
        bank.reset();
        mallet.reset();
        mallet.resetCount();
    }
    void reseed(uint64_t s) noexcept {
        rng.seed(s);
        mallet.setSeed(s);
        mallet.resetCount();
    }
    void activate() noexcept {}
    void control(const MacroIn& in) noexcept {
        bank.setModeCount(in.modes);
        dsp::ModalParams p;
        p.f0Hz = (float)std::clamp(std::fabs(in.hz), 16.0, 0.45 * in.sampleRate);
        p.structure = 0.25f + 0.75f * std::clamp(in.tone, 0.0f, 1.0f);
        p.brightness = std::clamp(in.shape, 0.0f, 1.0f);
        p.t60 = std::max(in.decay, 0.02f);
        p.position = 0.27f;
        p.stretch = 0.15f * std::clamp(in.blend, 0.0f, 1.0f);
        bank.set(p, kControl);
        // White noise reaches a mode only within its bandwidth (≈ 1 / T60): make up for it.
        noiseGain = 0.25f * std::sqrt(p.t60 * (float)in.sampleRate);
        if (in.strike) mallet.strike(in.accent, 0.15f + 0.6f * std::clamp(in.shape, 0.0f, 1.0f));
    }
    MacroOut tick(const MacroIn& in) noexcept {
        const float x = mallet.process();
        const float r = in.gated ? 0.0f : noiseGain * rng.bipolar();
        const auto o = bank.process(x * 6.0f, r);
        return {dsp::softClip(0.5f * o.mix()), dsp::softClip(0.5f * o.odd)};
    }
};

// ---- 14 Kick -------------------------------------------------------------------

/// A ringing resonator (Drums.h) whose pitch falls from up to 4 octaves above
/// f (Tone, latched at the strike) with a speed set by Shape (80 ms … 4 ms),
/// plus a 2 ms noise click, through a soft clip (Blend). T60 = Decay.
/// Aux: the click.
struct KickModel {
    dsp::Resonator body;
    dsp::Decay pitchEnv, click;
    Rng rng;
    float sweep = 2.0f, pitchCoef = 0.999f, bodyCoef = 0.9999f, clickCoef = 0.99f;

    void prepare(double sampleRate) noexcept { clickCoef = t60Coef(0.004f, sampleRate); }
    void reset() noexcept {
        body.reset();
        pitchEnv.reset();
        click.reset();
    }
    void reseed(uint64_t s) noexcept { rng.seed(s); }
    void activate() noexcept {}
    void control(const MacroIn& in) noexcept {
        bodyCoef = t60Coef(in.decay, in.sampleRate);
        if (in.strike) {
            sweep = 4.0f * std::clamp(in.tone, 0.0f, 1.0f);
            const float t = 0.08f * std::pow(0.05f, std::clamp(in.shape, 0.0f, 1.0f));
            pitchCoef = t60Coef(t, in.sampleRate);
            body.strike(in.accent);
            pitchEnv.trigger(1.0f);
            click.trigger(in.accent);
        }
    }
    MacroOut tick(const MacroIn& in) noexcept {
        const float pe = pitchEnv.process(pitchCoef);
        const float hz = (float)std::min(in.baseHz * std::exp2((double)(sweep * pe)), 0.45 * in.sampleRate);
        const float b = body.process(hz, bodyCoef, in.sampleRate);
        const float c = click.value() > 0.0f ? 0.35f * click.process(clickCoef) * rng.bipolar() : 0.0f;
        return {0.9f * dsp::softClip(b + c, std::clamp(in.blend, 0.0f, 1.0f)), c};
    }
};

// ---- 15 Snare ------------------------------------------------------------------

/// Two ringing resonators at f and 1.75 f (Shape: their balance) and white
/// noise through a band-pass at 1.5…12 kHz (Blend) under its own decay
/// (Tone: snappy, the noise level, latched at the strike). The body rings
/// for 0.6 × Decay, the noise for 0.75 × Decay. Aux: the noise alone.
struct SnareModel {
    dsp::Resonator r1, r2;
    dsp::Decay noiseEnv;
    dsp::Filter bp;
    Rng rng;
    float snappy = 0.5f, bodyCoef = 0.999f, noiseCoef = 0.999f;

    void prepare(double) noexcept {}
    void reset() noexcept {
        r1.reset(), r2.reset();
        noiseEnv.reset();
        bp.reset();
    }
    void reseed(uint64_t s) noexcept { rng.seed(s); }
    void activate() noexcept {}
    void control(const MacroIn& in) noexcept {
        bodyCoef = t60Coef(0.6f * in.decay, in.sampleRate);
        noiseCoef = t60Coef(0.75f * in.decay, in.sampleRate);
        if (in.strike) {
            snappy = std::clamp(in.tone, 0.0f, 1.0f);
            const float bal = std::clamp(in.shape, 0.0f, 1.0f);
            r1.strike(in.accent * (1.0f - 0.7f * bal));
            r2.strike(in.accent * (0.3f + 0.7f * bal));
            noiseEnv.trigger(in.accent);
        }
    }
    MacroOut tick(const MacroIn& in) noexcept {
        const double sr = in.sampleRate;
        const float f = (float)std::min(in.baseHz, 0.2 * sr);
        const float body = r1.process(f, bodyCoef, sr) + r2.process(1.75f * f, bodyCoef, sr);
        float noise = 0.0f;
        if (noiseEnv.value() > 0.0f) {
            const float centre = 1500.0f * std::exp2(3.0f * std::clamp(in.blend, 0.0f, 1.0f));
            noise = 2.2f * noiseEnv.process(noiseCoef) * bp.process(rng.bipolar(), std::min(centre, 0.45f * (float)sr), 0.8f, sr).bp;
        }
        return {dsp::softClip(0.7f * body * (1.0f - 0.6f * snappy) + snappy * noise), noise};
    }
};

// ---- 16 Metal ------------------------------------------------------------------

/// Six detuned polyBLEP squares (Drums.h Metal, the 808 ratios spread by
/// Shape: ratio^(0.5…1.5)) through a high-pass at 300 Hz…12 kHz (Tone,
/// latched at the strike) plus a ringing band-pass at 5.3 f (Blend), under a
/// decay of Decay. Aux: the unfiltered metal under the same decay.
struct MetalModel {
    static constexpr float kRatio[6] = {1.0f, 1.4827f, 1.8003f, 2.546f, 2.630f, 3.897f};
    dsp::Metal metal;
    dsp::Filter hp1, hp2, ring;
    dsp::Decay env;
    dsp::Metal::Freqs hz{};
    float hpHz = 2000.0f, coef = 0.999f;

    void prepare(double) noexcept {}
    void reset() noexcept {
        hp1.reset(), hp2.reset(), ring.reset();
        env.reset();
        metal = dsp::Metal{};
    }
    void activate() noexcept {}
    void control(const MacroIn& in) noexcept {
        coef = t60Coef(in.decay, in.sampleRate);
        const float spread = 0.5f + std::clamp(in.shape, 0.0f, 1.0f);
        for (size_t i = 0; i < hz.size(); ++i)
            hz[i] = std::min((float)in.baseHz * std::pow(kRatio[i], spread), 0.45f * (float)in.sampleRate);
        if (in.strike) {
            hpHz = 300.0f * std::exp2(5.3f * std::clamp(in.tone, 0.0f, 1.0f));
            env.trigger(in.accent);
        }
    }
    MacroOut tick(const MacroIn& in) noexcept {
        if (env.value() <= 0.0f) return {};
        const double sr = in.sampleRate;
        const float e = env.process(coef);
        const float raw = metal.process(hz, 1.0f, sr);
        const float hpf = std::min(hpHz, 0.45f * (float)sr);
        float y = hp2.process(hp1.process(raw, hpf, 0.7f, sr).hp, hpf, 0.7f, sr).hp;
        const float r = std::clamp(in.blend, 0.0f, 1.0f);
        if (r > 0.0f) {
            const float rc = std::min(5.3f * (float)in.baseHz, 0.45f * (float)sr);
            y += r * 0.6f * ring.process(raw, rc, 8.0f, sr).bp;
        }
        return {dsp::softClip(1.6f * e * y), e * raw};
    }
};

}  // namespace bleep::patch::macro
