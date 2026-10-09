// SPDX-License-Identifier: MIT
// Perc Voice DSP (doc/specs/modules/perc-voice.md): one percussion voice from
// eight partials. Tone picks the partial ratios (sine → membrane → bar →
// seeded metal), three engines turn them into sound (FM, struck modal
// resonators, a resonant noise bank), and Click, Sweep, Decay and Damp shape
// the hit. Two internal voices hand over on retriggers so nothing clicks.
//
// Everything is per sample and allocation-free. Frequencies, amplitudes and
// decays are recomputed every 8 samples from the effective knob values; the
// pitch envelope (sweep and click blip) runs per sample.
#pragma once

#include "dsp/Clip.h"
#include "dsp/Drums.h"
#include "dsp/Exciter.h"
#include "dsp/Noise.h"
#include "dsp/Random.h"
#include "dsp/Svf.h"
#include "dsp/Vactrol.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

namespace perc {

constexpr int kPartials = 8;
constexpr float kPi = 3.14159265358979323846f;
constexpr float kTwoPi = 6.28318530717958647692f;

/// Circular-membrane (Bessel) and free-bar mode ratios.
constexpr float kMembrane[kPartials] = {1.0f, 1.59f, 2.14f, 2.30f, 2.65f, 2.92f, 3.16f, 3.50f};
constexpr float kBar[kPartials] = {1.0f, 2.76f, 5.40f, 8.93f, 13.34f, 18.64f, 24.81f, 31.87f};

/// The seeded Metal table: 1, then seven ratios in 1.3 … 9 (log-uniform), sorted.
inline void metalRatios(uint64_t seed, float* out) noexcept {
    out[0] = 1.0f;
    for (int k = 1; k < kPartials; ++k)
        out[k] = 1.3f * std::pow(9.0f / 1.3f, (float)dsp::uniform01(seed, (uint64_t)k, 0x3e7a1));
    std::sort(out + 1, out + kPartials);
}

/// Ratios and the fade-in of partials 2–8 for a Tone 0..1: membrane below
/// ⅓ (partials 2–8 fading in from silence), then membrane → bar → metal,
/// interpolated in log frequency.
inline void toneRatios(float tone, const float* metal, float* ratio, float& upperFade) noexcept {
    tone = std::clamp(tone, 0.0f, 1.0f);
    upperFade = std::min(tone * 3.0f, 1.0f);
    const float* a = kMembrane;
    const float* b = kMembrane;
    float t = 0.0f;
    if (tone > 2.0f / 3.0f) {
        a = kBar, b = metal, t = (tone - 2.0f / 3.0f) * 3.0f;
    } else if (tone > 1.0f / 3.0f) {
        a = kMembrane, b = kBar, t = (tone - 1.0f / 3.0f) * 3.0f;
    }
    for (int k = 0; k < kPartials; ++k)
        ratio[k] = t <= 0.0f ? a[k] : std::exp((1.0f - t) * std::log(a[k]) + t * std::log(b[k]));
}

/// sin and cos of w in [0, π] (polynomials; error below 1e-7).
inline void sinCos(float w, float& s, float& c) noexcept {
    float sign = 1.0f;
    if (w > 0.5f * kPi) {
        w = kPi - w;
        sign = -1.0f;
    }
    const float x2 = w * w;
    s = w * (1.0f + x2 * (-1.0f / 6.0f + x2 * (1.0f / 120.0f + x2 * (-1.0f / 5040.0f +
                                                                      x2 * (1.0f / 362880.0f - x2 / 39916800.0f)))));
    c = sign * (1.0f + x2 * (-0.5f + x2 * (1.0f / 24.0f + x2 * (-1.0f / 720.0f +
                                                               x2 * (1.0f / 40320.0f - x2 / 3628800.0f)))));
}

/// sin(2π p) for any p (polynomial after folding; error below 4e-6).
inline float sin2pi(float p) noexcept {
    p -= std::floor(p + 0.5f);  // −0.5 … 0.5
    float x = kTwoPi * p;
    if (x > 0.5f * kPi) x = kPi - x;
    else if (x < -0.5f * kPi) x = -kPi - x;
    const float x2 = x * x;
    return x * (1.0f + x2 * (-1.0f / 6.0f + x2 * (1.0f / 120.0f + x2 * (-1.0f / 5040.0f + x2 / 362880.0f))));
}

}  // namespace perc

enum class PercEngine { FM = 0, Modal = 1, Noise = 2 };

struct PercParams {
    float pitchHz = 55.0f;
    float tone = 0.2f;
    float morph = 0.5f;
    float click = 0.3f;
    float decay = 0.4f;   ///< seconds, T60 of the body
    float damp = 0.4f;
    float sweep = 0.4f;
    float spread = 0.2f;
    float level = 0.8f;
    int drive = 0;        ///< Clean, Warm, Hot
    bool track = false;   ///< follow the pitch input live
    uint64_t seed = 1;
};

/// What a hit samples at its trigger.
struct PercHit {
    PercEngine engine = PercEngine::Modal;
    float accent = 0.7f;
    float pitch = 0.0f;   ///< octaves (1 V/oct input)
};

class PercVoiceDsp {
public:
    static constexpr int kSub = 8;          ///< samples per coefficient update
    static constexpr float kFloor = 1e-4f;  ///< −80 dB: a voice ends below this

    struct Frame {
        float l, r, env;
        bool active;
    };
    /// The current partial set, for the view.
    struct Partials {
        float ratio[perc::kPartials];
        float amp[perc::kPartials];
        float decay[perc::kPartials];  ///< T60_k / Decay
    };

    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        fadeStep_ = (float)(1.0 / (0.003 * sampleRate));
        chokeStep_ = (float)(1.0 / (0.005 * sampleRate));
        for (auto& v : voice_) v.burst.prepare(sampleRate);
        metalSeed_ = ~0ull;
        reset();
    }
    void reset() noexcept {
        for (auto& v : voice_) v.clear();
        cur_ = 0;
        sub_ = 0;
        count_ = 0;
    }
    /// Transport start: the per-strike noise restarts its sequence.
    void resetCount() noexcept { count_ = 0; }

    void strike(const PercHit& hit, const PercParams& p) noexcept {
        Voice* v = &voice_[cur_];
        const bool restrike = hit.engine == PercEngine::Modal && v->alive && v->engine == PercEngine::Modal &&
                              v->fade >= 1.0f && !v->fading;
        if (!restrike) {
            if (v->alive) v->fading = true;  // hand over: the old hit fades in 3 ms
            cur_ ^= 1;
            v = &voice_[cur_];
            v->clear();
            v->engine = hit.engine;
        }
        const float a = std::clamp(hit.accent, 0.0f, 1.0f);
        v->alive = true;
        v->fade = 1.0f;
        v->fading = false;
        v->choke = 1.0f;
        v->vel = 0.4f + 0.6f * a;
        v->clickScale = 0.5f + a;
        v->sweepDepth = 0.6f + 0.4f * a;
        v->indexScale = 0.7f + 0.6f * a;
        v->dull = 0.8f * (1.0f - a);
        v->pitch = hit.pitch;
        v->sweepEnv = 1.0f;
        v->indexEnv = 1.0f;
        v->hitEnv = restrike ? std::min(v->hitEnv + 1.0f, 1.5f) : 1.0f;
        for (float& e : v->env) e = 1.0f;
        v->blipLeft = v->blipLen = std::max(1, (int)(0.002 * sr_));
        // Click: 1–6 ms of seeded noise, band-passed at 2–8 kHz (higher with Tone).
        const uint64_t strikeSeed = dsp::hash3(p.seed, count_++, 0x9e7c);
        const float tone = std::clamp(p.tone, 0.0f, 1.0f);
        const float clickLevel = std::clamp(p.click, 0.0f, 1.0f) * v->clickScale;
        v->clickLevel = clickLevel;
        if (clickLevel > 0.0f) {
            v->burst.trigger(clickLevel, 0.006f - 0.005f * tone, 16000.0f, 0.0f, strikeSeed);
            v->clickBp.set(2000.0f * std::pow(4.0f, tone), 1.2f, sr_);
            v->clickBp.reset();
        }
        v->noise = dsp::WhiteNoise((uint32_t)dsp::hash3(strikeSeed, 1, 0x40) | 1u);
        update(*v, p);
        if (v->engine == PercEngine::Modal) {
            // The impulse: every resonator starts at its amplitude (zero phase).
            for (int k = 0; k < perc::kPartials; ++k) v->re[k] += v->vel * v->amp[k];
        }
    }

    /// Fades every sounding hit out over 5 ms.
    void choke() noexcept {
        for (auto& v : voice_)
            if (v.alive) v.choking = true;
    }

    Frame tick(const PercParams& p, float pitchIn) noexcept {
        if (sub_ == 0) {
            if (p.seed != metalSeed_) {
                metalSeed_ = p.seed;
                perc::metalRatios(p.seed, metal_);
            }
            for (auto& v : voice_)
                if (v.alive) update(v, p);
        }
        sub_ = (sub_ + 1) % kSub;

        float l = 0.0f, r = 0.0f, env = 0.0f;
        bool any = false;
        for (auto& v : voice_) {
            if (!v.alive) continue;
            if (p.track) v.pitch = pitchIn;
            float vl = 0.0f, vr = 0.0f;
            run(v, p, vl, vr);
            float g = v.fade * v.choke;
            if (v.fading) {
                v.fade -= fadeStep_;
                if (v.fade <= 0.0f) v.clear();
            }
            if (v.choking) {
                v.choke -= chokeStep_;
                if (v.choke <= 0.0f) v.clear();
            }
            l += vl * g;
            r += vr * g;
            env = std::max(env, v.envOut * g);
            any = any || v.alive;
        }
        // Drive: the hit's own velocity is divided out, so it changes the
        // loudness, not the amount of distortion.
        if (p.drive > 0) {
            static constexpr float amounts[3] = {0.0f, 0.35f, 0.8f};
            const float d = amounts[std::clamp(p.drive, 0, 2)];
            const float vel = std::max(voice_[cur_].vel, 0.1f);
            l = vel * dsp::softClip(l / vel, d);
            r = vel * dsp::softClip(r / vel, d);
        }
        const float level = std::clamp(p.level, 0.0f, 1.0f);
        return {dsp::softClip(l * level), dsp::softClip(r * level), std::min(env, 1.0f), any};
    }

    bool active() const noexcept { return voice_[0].alive || voice_[1].alive; }

    /// The partial set of the newest hit (or of the knobs when silent).
    Partials partials(const PercParams& p) noexcept {
        Voice v;
        v.engine = voice_[cur_].alive ? voice_[cur_].engine : PercEngine::Modal;
        v.pitch = voice_[cur_].pitch;
        if (p.seed != metalSeed_) {
            metalSeed_ = p.seed;
            perc::metalRatios(p.seed, metal_);
        }
        update(v, p);
        Partials out{};
        for (int k = 0; k < perc::kPartials; ++k) {
            out.ratio[k] = v.ratio[k];
            out.amp[k] = v.amp[k];
            out.decay[k] = v.t60[k] / std::max(p.decay, 1e-3f);
        }
        return out;
    }

private:
    struct Voice {
        PercEngine engine = PercEngine::Modal;
        bool alive = false, fading = false, choking = false;
        float fade = 1.0f, choke = 1.0f;
        float vel = 1.0f, dull = 0.0f, clickScale = 1.0f, sweepDepth = 1.0f, indexScale = 1.0f, clickLevel = 0.0f;
        float pitch = 0.0f;
        float sweepEnv = 0.0f, sweepCoef = 0.0f, indexEnv = 0.0f, indexCoef = 0.0f;
        float hitEnv = 0.0f, envOut = 0.0f;
        int blipLeft = 0, blipLen = 1, quiet = 0;
        float baseHz = 0.0f, lastHz = -1.0f;
        float ratio[perc::kPartials] = {}, amp[perc::kPartials] = {}, t60[perc::kPartials] = {};
        float coef[perc::kPartials] = {}, env[perc::kPartials] = {};
        float panL[perc::kPartials] = {}, panR[perc::kPartials] = {};
        float ng[perc::kPartials] = {};  ///< roll-off below Nyquist (0.40 … 0.45 fs)
        // FM
        double phase[perc::kPartials] = {};
        double carrier[2] = {};
        float detune = 1.0f;
        // Modal
        float re[perc::kPartials] = {}, im[perc::kPartials] = {}, rc[perc::kPartials] = {}, rs[perc::kPartials] = {};
        // Noise bank (TPT band-passes, coefficients per sample from a Padé tan)
        float s1[perc::kPartials] = {}, s2[perc::kPartials] = {}, bpK = 1.0f, bpNorm[perc::kPartials] = {};
        dsp::WhiteNoise noise{1u};
        dsp::NoiseBurst burst;
        dsp::Svf clickBp;

        void clear() noexcept {
            alive = fading = choking = false;
            fade = choke = 1.0f;
            sweepEnv = indexEnv = hitEnv = envOut = 0.0f;
            blipLeft = quiet = 0;
            lastHz = -1.0f;
            for (int k = 0; k < perc::kPartials; ++k) {
                phase[k] = 0.0;
                re[k] = im[k] = s1[k] = s2[k] = env[k] = 0.0f;
            }
            carrier[0] = carrier[1] = 0.0;
            burst.reset();
            clickBp.reset();
        }
    };

    /// Ratios, amplitudes, decays and pans from the knobs (every kSub samples).
    void update(Voice& v, const PercParams& p) noexcept {
        float fade = 1.0f;
        perc::toneRatios(p.tone, metal_, v.ratio, fade);
        v.baseHz = std::clamp(p.pitchHz * std::exp2(std::clamp(v.pitch, -10.0f, 10.0f)), 5.0f, 0.45f * (float)sr_);
        const float morph = std::clamp(p.morph, 0.0f, 1.0f);
        const float decay = std::max(p.decay, 0.005f);
        const float damp = 3.0f * std::clamp(p.damp, 0.0f, 1.0f);
        // Amplitude tilt per engine; partials 2–8 fade in over Tone 0–⅓.
        // Soft hits (low accent) are duller as well as quieter.
        const float tilt = (v.engine == PercEngine::Modal ? -2.0f + 3.0f * morph
                            : v.engine == PercEngine::FM  ? -1.0f
                                                          : -0.5f) - v.dull;
        float sum = 0.0f, power = 0.0f;
        for (int k = 0; k < perc::kPartials; ++k) {
            const float a = (k == 0 ? 1.0f : fade) * std::pow((float)(k + 1), tilt);
            v.amp[k] = a;
            sum += a;
            power += a * a;
        }
        const float norm = v.engine == PercEngine::FM ? 1.0f / sum : 1.0f / std::sqrt(power);
        const float spread = std::clamp(p.spread, 0.0f, 1.0f);
        for (int k = 0; k < perc::kPartials; ++k) {
            v.amp[k] *= norm;
            v.t60[k] = decay * std::pow(1.0f / v.ratio[k], damp);
            v.coef[k] = dsp::decayCoef(v.t60[k], sr_);
            // Odd partials lean left, even right; the fundamental stays centred.
            const bool odd = (k % 2) == 0;
            v.panL[k] = k == 0 || odd ? 1.0f : 1.0f - spread;
            v.panR[k] = k == 0 || !odd ? 1.0f : 1.0f - spread;
        }
        v.detune = std::exp2(spread * 8.0f / 1200.0f);  // FM: ±8 cents between the sides
        // Sweep falls to 5 % in Decay / 8; the FM index decays with half the Decay.
        v.sweepCoef = (float)std::exp(-3.0 / (decay / 8.0 * sr_));
        v.indexCoef = dsp::decayCoef(0.5f * decay, sr_);
        v.bpK = 1.0f / (40.0f * std::pow(0.7f / 40.0f, morph));  // Q 40 … 0.7
        // Noise bank: white noise through a unit-peak band-pass of width
        // f/Q has an RMS of √(π · bw / (3 fs)); bring it to about 0.35.
        for (int k = 0; k < perc::kPartials; ++k) {
            const float bw = std::min(v.baseHz * v.ratio[k], 0.45f * (float)sr_) * v.bpK;
            v.bpNorm[k] = std::min(0.35f / std::sqrt(perc::kPi * bw / (3.0f * (float)sr_)), 60.0f);
        }
        v.lastHz = -1.0f;  // the resonators pick up new decays
    }

    void run(Voice& v, const PercParams& p, float& outL, float& outR) noexcept {
        // Pitch envelope: sweep (up to +3 octaves) and the click's +2 octave blip.
        float oct = 3.0f * std::clamp(p.sweep, 0.0f, 1.0f) * v.sweepDepth * v.sweepEnv;
        v.sweepEnv *= v.sweepCoef;
        if (v.sweepEnv < 1e-5f) v.sweepEnv = 0.0f;
        if (v.blipLeft > 0) {
            oct += 2.0f * std::min(v.clickLevel, 1.0f) * (float)v.blipLeft / (float)v.blipLen;
            --v.blipLeft;
        }
        const float hz = v.baseHz * (oct > 0.0f ? std::exp2(oct) : 1.0f);
        const float nyq = 0.45f * (float)sr_;

        // Click burst (also excites Modal and Noise Bank bodies).
        float click = 0.0f;
        if (v.burst.active()) click = v.clickBp.process(v.burst.process()).bp * 1.5f;

        float l = 0.0f, r = 0.0f, alive = 0.0f;
        switch (v.engine) {
            case PercEngine::FM: {
                float mod = 0.0f;
                for (int k = 0; k < perc::kPartials; ++k) {
                    const float f = hz * v.ratio[k];
                    const float g = f < nyq ? std::min(1.0f, (nyq - f) / (0.05f * (float)sr_)) : 0.0f;
                    v.phase[k] += f / sr_;
                    v.phase[k] -= std::floor(v.phase[k]);
                    mod += v.amp[k] * g * v.env[k] * perc::sin2pi((float)v.phase[k]);
                    v.env[k] *= v.coef[k];
                }
                const float index = 8.0f * std::clamp(p.morph, 0.0f, 1.0f) * v.indexScale * v.indexEnv;
                v.indexEnv *= v.indexCoef;
                const float pm = index * mod / perc::kTwoPi;
                const float body = v.vel * v.env[0];
                const double inc = std::min(hz, nyq) / sr_;
                v.carrier[0] += inc / v.detune;
                v.carrier[1] += inc * v.detune;
                v.carrier[0] -= std::floor(v.carrier[0]);
                v.carrier[1] -= std::floor(v.carrier[1]);
                l = body * perc::sin2pi((float)v.carrier[0] + pm);
                r = body * perc::sin2pi((float)v.carrier[1] + pm);
                alive = body;
                break;
            }
            case PercEngine::Modal: {
                const bool moving = dsp::differs(hz, v.lastHz);
                v.lastHz = hz;
                const float in = 0.05f * click;
                for (int k = 0; k < perc::kPartials; ++k) {
                    if (moving) {
                        const float f = hz * v.ratio[k];
                        if (f < nyq) {
                            float s, c;
                            perc::sinCos(perc::kTwoPi * f / (float)sr_, s, c);
                            const float g = v.coef[k];
                            v.rc[k] = g * c;
                            v.rs[k] = g * s;
                            v.ng[k] = std::min(1.0f, (nyq - f) / (0.05f * (float)sr_));
                        } else {
                            v.rc[k] = v.rs[k] = v.ng[k] = 0.0f;
                        }
                    }
                    const float re = v.rc[k] * v.re[k] - v.rs[k] * v.im[k] + in * v.amp[k];
                    const float im = v.rs[k] * v.re[k] + v.rc[k] * v.im[k];
                    v.re[k] = re;
                    v.im[k] = im;
                    l += kModalGain * v.panL[k] * v.ng[k] * im;
                    r += kModalGain * v.panR[k] * v.ng[k] * im;
                    alive = std::max(alive, std::fabs(re) + std::fabs(im));
                }
                break;
            }
            case PercEngine::Noise: {
                const float n = v.noise.next();
                const float x = n + 2.0f * click;
                for (int k = 0; k < perc::kPartials; ++k) {
                    const float f = std::min(hz * v.ratio[k], nyq);
                    const float g = std::min(1.0f, (nyq - hz * v.ratio[k]) / (0.05f * (float)sr_));
                    if (g <= 0.0f) continue;
                    // TPT band-pass at f, unit peak gain, then normalised so
                    // white noise gives about the same level at any width.
                    const float t = dsp::LowPassGate::fastTan(perc::kPi * f / (float)sr_);
                    const float a1 = 1.0f / (1.0f + t * (t + v.bpK));
                    const float v3 = x - v.s2[k];
                    const float v1 = a1 * v.s1[k] + t * a1 * v3;
                    const float v2 = v.s2[k] + t * v1;
                    v.s1[k] = 2.0f * v1 - v.s1[k];
                    v.s2[k] = 2.0f * v2 - v.s2[k];
                    const float y = kNoiseGain * v.bpK * v1 * v.bpNorm[k] * v.amp[k] * v.env[k] * g * v.vel;
                    v.env[k] *= v.coef[k];
                    l += v.panL[k] * y;
                    r += v.panR[k] * y;
                    alive = std::max(alive, v.amp[k] * v.env[k] * v.vel);
                }
                break;
            }
        }
        l += click;
        r += click;
        v.hitEnv *= v.coef[0];
        v.envOut = std::min(v.vel * v.hitEnv, 1.0f);
        // The hit ends once the body is below −80 dB and the click is over.
        if (alive < kFloor && !v.burst.active() && v.blipLeft == 0) {
            if (++v.quiet > kSub * 4) v.clear();
        } else {
            v.quiet = 0;
        }
        outL = l;
        outR = r;
    }

    static constexpr float kModalGain = 0.7f, kNoiseGain = 0.8f;

    double sr_ = 48000.0;
    Voice voice_[2];
    int cur_ = 0, sub_ = 0;
    uint64_t count_ = 0, metalSeed_ = ~0ull;
    float metal_[perc::kPartials] = {1, 1.5f, 2, 3, 4, 5, 6, 7};
    float fadeStep_ = 0.007f, chokeStep_ = 0.004f;
};

}  // namespace bleep::patch
