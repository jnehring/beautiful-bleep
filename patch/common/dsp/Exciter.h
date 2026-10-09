// SPDX-License-Identifier: MIT
// Exciters for the physical models (doc/specs/modules/modal-voice.md 4.2,
// resonator.md 4.5): a bow (stick-slip friction against the body's
// velocity), a blow (pitch-tracked breath noise plus a jet that couples with
// the body), a mallet (felt → wood → tick → seeded scrape) and a generic
// noise burst with a click. All are per-sample, allocation-free and
// reproducible where they are seeded.
//
// Units. Bow and Blow output a force per sample to feed a body every sample
// (ModalBank::Input::Struck or a waveguide's excite). Mallet outputs a force
// pulse whose samples sum to about `level` (unit area: the low modes of a
// struck body ring at about level × their gain whatever the hardness; harder
// mallets add highs). NoiseBurst outputs audio at a peak of about `level`.
#pragma once

#include "Noise.h"
#include "Random.h"
#include "Svf.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

/// Stick-slip friction curve: force for a relative velocity dv between bow
/// and body. `slope` is the inverse bow pressure (5 slips easily and sounds
/// airy, 1 grips and sounds scratchy). F = dv · (|dv| · slope + 0.75)⁻⁴,
/// clamped to ±1. Usable inside any modal or waveguide loop.
inline float bowFriction(float dv, float slope) noexcept {
    const float d = std::fabs(dv) * slope + 0.75f;
    const float d2 = d * d;
    return std::clamp(dv / (d2 * d2), -1.0f, 1.0f);
}

/// Bow: friction against the body's velocity at the bow point, plus a
/// little low-passed noise for the hair. Feed its output into the body each
/// sample and pass the body's velocity back next sample.
///
///   const float coupling = bowCoupling(bank.admittance());   // after bank.set()
///   const float f = bow.process(env * level, bank.velocity(), timbre);
///   const auto y = bank.process(f * coupling, 0.0f);          // struck input
///
/// The body locks to its own pitch (within a few cents; bowed bodies run
/// slightly flat) at every timbre; a 32-mode body's mix is about 2–5 ×
/// bowVelocity RMS, so scale it before the limiter. Works on bars and
/// plates too (bowed metal).
class Bow {
public:
    void prepare(double sampleRate) noexcept {
        noiseA_ = (float)std::exp(-2.0 * 3.14159265358979323846 * 40.0 / sampleRate);
        noiseNorm_ = std::sqrt((1.0f + noiseA_) / (1.0f - noiseA_));  // back to about white's level
    }
    void reset() noexcept { noiseZ_ = 0.0f; }
    /// bowVelocity: 0..1 (envelope × level; 0 lifts the bow). bodyVelocity:
    /// the body's velocity at the bow point (one sample old). timbre 0..1:
    /// pressure and roughness. Returns the friction force. When the body
    /// locks in, its velocity at the bow point swings around bowVelocity,
    /// so the body's level is proportional to it.
    float process(float bowVelocity, float bodyVelocity, float timbre) noexcept {
        noiseZ_ = (1.0f - noiseA_) * noise_.next() + noiseA_ * noiseZ_;
        const float hair = 1.0f + (0.02f + 0.08f * timbre) * noiseZ_ * noiseNorm_;
        const float vb = bowVelocity * hair;
        if (!(bowVelocity > 1e-6f)) return 0.0f;  // bow lifted
        const float slope = 5.0f - 3.0f * std::clamp(timbre, 0.0f, 1.0f);
        // Friction on the velocity relative to the bow's own speed, scaled
        // back by it: the regime (airy … scratchy) depends on the timbre only
        // and the level follows the bow speed.
        constexpr float kRef = 0.2f;  // the curve is used as it is at a bow speed of 0.2
        return (vb / kRef) * bowFriction(kRef * (vb - bodyVelocity) / vb, slope);
    }

private:
    WhiteNoise noise_;
    float noiseA_ = 0.995f, noiseNorm_ = 20.0f, noiseZ_ = 0.0f;
};

/// How much to scale a bow's force into a ModalBank (Struck), given the
/// bank's admittance(): keeps the one-sample friction loop well below the
/// gain where it would chatter, while the resonance still builds up.
inline float bowCoupling(float admittance) noexcept { return 0.1f / std::max(admittance, 0.05f); }

/// Blow: breath noise band-passed around a pitch-tracking centre
/// (f0 · 2^(6 · timbre − 1), Q 0.7), plus a jet above timbre 0.6 that feeds
/// back the body's output through a delay (a fraction of the period, like a
/// flute's air jet) and a steep tanh saturating at ± flow, so bright
/// settings make the body sing on its own at a level that follows the flow.
///
///   const float e = blow.process(env * level, timbre, f0, lastOut);
///   lastOut = bank.process(0.0f, e).mix();   // resonant input
///
/// With the resonant input a body sings at about 0.5 × flow; long decays
/// (T60 of seconds) speak slowly, like a big pipe. The breath noise mostly
/// passes the body only in its resonances, so mix some of the exciter
/// straight to the output for audible breath.
class Blow {
public:
    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        reset();
    }
    void reset() noexcept {
        bp_.reset();
        for (float& v : jet_) v = 0.0f;
        pos_ = 0;
    }
    /// Jet delay as a fraction of the period. The default ¾ locks onto the
    /// fundamental when the feedback is ModalBank's output (odd + even) and
    /// the excitation goes into its resonant input; other values lock onto
    /// other modes (overblown registers).
    void setJetDelay(float fractionOfPeriod) noexcept { jetFrac_ = std::clamp(fractionOfPeriod, 0.0f, 2.0f); }

    /// flow: 0..1 (envelope × level). timbre 0..1. f0Hz: the body's pitch.
    /// feedback: the body's output (last sample). Returns the excitation.
    float process(float flow, float timbre, float f0Hz, float feedback) noexcept {
        const float centre = std::clamp(f0Hz * std::exp2(6.0f * timbre - 1.0f), 20.0f, 0.45f * (float)sr_);
        if (differs(centre, centre_)) {
            centre_ = centre;
            bp_.set(centre, 0.7f, sr_);
        }
        float out = flow * bp_.process(noise_.next()).bp;
        // Jet.
        jet_[pos_] = feedback;
        const float g = std::clamp((timbre - 0.6f) / 0.4f, 0.0f, 1.0f);
        if (g > 0.0f && flow > 0.0f) {
            const float period = (float)sr_ / std::max(f0Hz, 20.0f);
            const int d = std::clamp((int)(jetFrac_ * period + 0.5f), 0, kJet - 1);
            const float y = jet_[(pos_ - d) & (kJet - 1)];
            // The jet deflects with the body's (delayed) motion and saturates
            // at ± the flow: a steep tanh, so it starts singing from a low g.
            out += flow * std::tanh(kJetGain * g * y);
        }
        pos_ = (pos_ + 1) & (kJet - 1);
        return out;
    }

private:
    static constexpr int kJet = 4096;  // ¾ period of 20 Hz at 96 kHz fits
    static constexpr float kJetGain = 30.0f;
    static bool differs(float a, float b) noexcept { return a < b || a > b; }
    double sr_ = 48000.0;
    Svf bp_;
    WhiteNoise noise_;
    float centre_ = -1.0f, jetFrac_ = 0.75f;
    float jet_[kJet] = {};
    int pos_ = 0;
};

/// Mallet: a force pulse on each strike. Timbre 0..1:
///   0–0.4    raised-cosine pulse 8 ms → 1 ms (soft felt → wood)
///   0.4–0.7  1 ms → 0.1 ms plus a one-sample click rising to half the level (hard → tick)
///   0.7–1    the tick plus a 5–40 ms burst of sparse seeded impulses (scrape)
/// The scrape comes from uniform01(seed, strike count, …), so renders repeat
/// (clear the count with resetCount() on transport start). Strikes overlap:
/// a new one never cuts a running pulse short.
class Mallet {
public:
    void prepare(double sampleRate) noexcept { sr_ = sampleRate; }
    void reset() noexcept {
        len_ = left_ = 0;
        scrapeLeft_ = 0;
        click_ = 0.0f;
    }
    void setSeed(uint64_t seed) noexcept { seed_ = seed; }
    void resetCount() noexcept { count_ = 0; }
    uint64_t strikeCount() const noexcept { return count_; }

    void strike(float level, float timbre) noexcept {
        timbre = std::clamp(timbre, 0.0f, 1.0f);
        const float ms = timbre < 0.4f ? 8.0f * std::pow(1.0f / 8.0f, timbre / 0.4f)
                                       : std::max(0.1f, std::pow(0.1f, std::min((timbre - 0.4f) / 0.3f, 1.0f)));
        const float clickShare = timbre < 0.4f ? 0.0f : 0.5f * std::min((timbre - 0.4f) / 0.3f, 1.0f);
        // Carry what is left of a running pulse into the click so nothing is lost.
        float carry = 0.0f;
        if (left_ > 0) carry = level_ * (float)left_ / (float)std::max(len_, 1);
        len_ = left_ = std::max(1, (int)std::lround(ms * 0.001 * sr_));
        level_ = level * (1.0f - clickShare);
        click_ += level * clickShare + carry;
        if (timbre > 0.7f) {
            const float s = (timbre - 0.7f) / 0.3f;
            scrapeLen_ = scrapeLeft_ = std::max(1, (int)((0.005f + 0.035f * s) * sr_));
            scrapeProb_ = (float)((200.0 + 2800.0 * s) / sr_);
            scrapeLevel_ = level * (0.08f + 0.12f * s);
            scrapeIndex_ = 0;
        }
        strikeSeed_ = hash3(seed_, count_, 0x5c4a);
        ++count_;
    }

    float process() noexcept {
        float out = click_;
        click_ = 0.0f;
        if (left_ > 0) {
            const float ph = (float)(len_ - left_ + 0.5f) / (float)len_;
            out += level_ * (1.0f - std::cos(kTwoPiF * ph)) / (float)len_;
            --left_;
        }
        if (scrapeLeft_ > 0) {
            const uint64_t i = (uint64_t)scrapeIndex_++;
            if (uniform01(strikeSeed_, i, 1) < (double)scrapeProb_) {
                const float env = (float)scrapeLeft_ / (float)scrapeLen_;
                const float sign = uniform01(strikeSeed_, i, 2) < 0.5 ? -1.0f : 1.0f;
                out += sign * scrapeLevel_ * env * (0.3f + 0.7f * (float)uniform01(strikeSeed_, i, 3));
            }
            --scrapeLeft_;
        }
        return out;
    }
    bool active() const noexcept { return left_ > 0 || scrapeLeft_ > 0; }

private:
    static constexpr float kTwoPiF = 6.28318530717958647692f;
    double sr_ = 48000.0;
    uint64_t seed_ = 1, count_ = 0, strikeSeed_ = 0;
    int len_ = 0, left_ = 0, scrapeLen_ = 1, scrapeLeft_ = 0, scrapeIndex_ = 0;
    float level_ = 0.0f, click_ = 0.0f, scrapeProb_ = 0.0f, scrapeLevel_ = 0.0f;
};

/// A burst of white noise under a raised-cosine window, low-passed by a
/// one-pole, plus an optional one-sample click of the same polarity: the
/// generic "strum" exciter of the Resonator. Peak about `level`; seeded per
/// trigger so it repeats.
class NoiseBurst {
public:
    void prepare(double sampleRate) noexcept { sr_ = sampleRate; }
    void reset() noexcept {
        left_ = 0;
        lp_ = 0.0f;
        click_ = 0.0f;
    }
    /// lengthSeconds of noise, toneHz the low-pass cutoff, click 0..1 the
    /// level of the one-sample click relative to `level`.
    void trigger(float level, float lengthSeconds, float toneHz, float click, uint64_t seed) noexcept {
        len_ = left_ = std::max(1, (int)(lengthSeconds * sr_));
        level_ = level;
        click_ += level * click;
        lpA_ = (float)std::exp(-6.28318530717958647692 * std::clamp((double)toneHz, 10.0, 0.45 * sr_) / sr_);
        // Make up for the low-pass's loss on white noise so the peak stays ~level.
        lpNorm_ = std::sqrt((1.0f + lpA_) / (1.0f - lpA_));
        noise_ = WhiteNoise((uint32_t)hash3(seed, 0, 0xb0) | 1u);
    }
    float process() noexcept {
        float out = click_;
        click_ = 0.0f;
        if (left_ > 0) {
            const float ph = (float)(len_ - left_ + 0.5f) / (float)len_;
            const float win = 0.5f - 0.5f * std::cos(6.28318530717958647692f * ph);
            lp_ = (1.0f - lpA_) * noise_.next() + lpA_ * lp_;
            out += level_ * win * lp_ * lpNorm_;
            --left_;
        } else {
            lp_ = 0.0f;
        }
        return out;
    }
    bool active() const noexcept { return left_ > 0; }

private:
    double sr_ = 48000.0;
    WhiteNoise noise_;
    int len_ = 1, left_ = 0;
    float level_ = 0.0f, click_ = 0.0f, lp_ = 0.0f, lpA_ = 0.0f, lpNorm_ = 1.0f;
};

}  // namespace bleep::dsp
