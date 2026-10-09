// SPDX-License-Identifier: MIT
// Ring drums: drum voices built the way the classic analog drum machines of
// the early eighties built them. Struck resonators that ring and die away
// (kick, toms, snare body, rim), band-passed noise (snare, clap) and six
// detuned square waves for the metal (cowbell, hats, cymbal). Deep, round,
// a little soft. See doc/specs/modules/ring-drums.md.
//
// Every voice: prepare(), reset(), trigger(input, velocity), tick(params).
#pragma once

#include "dsp/Drums.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

namespace ring {

/// The six square-wave frequencies of the metal source, in Hz.
constexpr dsp::Metal::Freqs kMetalHz{205.3f, 304.4f, 369.6f, 522.7f, 540.0f, 800.0f};

inline float semis(float st) noexcept { return std::exp2(st / 12.0f); }

}  // namespace ring

class RingKick {
public:
    struct Params {
        float tuneHz = 50.0f;
        float decay = 0.8f;   ///< T60, seconds
        float sweep = 0.3f;   ///< 0..1: how far the pitch starts above tune
        float tone = 0.3f;    ///< 0..1: the click of the strike
        float drive = 0.0f;
    };

    void prepare(double sr) noexcept { sr_ = sr; }
    void reset() noexcept {
        body_.reset();
        sweep_.reset();
        click_.reset();
        lp_.reset();
    }
    void trigger(int, float vel) noexcept {
        vel_ = std::max(vel, 0.01f);
        body_.strike(vel);
        sweep_.trigger(1.0f);
        click_.trigger(vel);
    }
    float tick(const Params& p) noexcept {
        const float hz = p.tuneHz * (1.0f + 1.5f * p.sweep * sweep_.process(decayCoef(0.09f)));
        const float body = body_.process(hz, decayCoef(p.decay), sr_);
        const float click = lp_.process(click_.process(decayCoef(0.004f)), 400.0f + 4000.0f * p.tone, 0.7f, sr_).lp;
        return vel_ * dsp::softClip((body + 1.2f * p.tone * click) / vel_, p.drive);
    }

private:
    float decayCoef(float t) const noexcept { return dsp::decayCoef(t, sr_); }
    double sr_ = 48000.0;
    float vel_ = 1.0f;
    dsp::Resonator body_;
    dsp::Decay sweep_, click_;
    dsp::Filter lp_;
};

class RingSnare {
public:
    struct Params {
        float tuneHz = 180.0f;
        float tone = 0.5f;    ///< 0 = low head, 1 = high head
        float snappy = 0.6f;  ///< noise level
        float decay = 0.25f;  ///< noise T60, seconds
    };

    void prepare(double sr) noexcept { sr_ = sr; }
    void reset() noexcept {
        lo_.reset();
        hi_.reset();
        noiseEnv_.reset();
        hp_.reset();
        lp_.reset();
    }
    void trigger(int, float vel) noexcept {
        lo_.strike(vel);
        hi_.strike(vel);
        noiseEnv_.trigger(vel);
    }
    float tick(const Params& p) noexcept {
        const float bodyT = std::clamp(0.5f * p.decay, 0.05f, 0.4f);
        const float lo = lo_.process(p.tuneHz, dsp::decayCoef(bodyT, sr_), sr_);
        const float hi = hi_.process(p.tuneHz * 1.84f, dsp::decayCoef(0.7f * bodyT, sr_), sr_);
        const float body = 0.8f * ((1.0f - p.tone) * lo + p.tone * hi);
        float n = hp_.process(noise_.next(), 1800.0f, 0.7f, sr_).hp;
        n = lp_.process(n, 9000.0f, 0.7f, sr_).lp;
        return 0.9f * body + 1.45f * p.snappy * n * noiseEnv_.process(dsp::decayCoef(p.decay, sr_));
    }

private:
    double sr_ = 48000.0;
    dsp::Resonator lo_, hi_;
    dsp::Decay noiseEnv_;
    dsp::WhiteNoise noise_;
    dsp::Filter hp_, lp_;
};

class RingClap {
public:
    struct Params {
        float toneHz = 1100.0f;
        float decay = 0.3f;
        float spread = 0.011f;
        int bursts = 4;
    };

    void prepare(double sr) noexcept { clap_.prepare(sr); }
    void reset() noexcept { clap_.reset(); }
    void trigger(int, float vel) noexcept { clap_.trigger(vel); }
    float tick(const Params& p) noexcept {
        dsp::Clap::Params c;
        c.toneHz = p.toneHz;
        c.q = 1.6f;
        c.decay = p.decay;
        c.spread = p.spread;
        c.bursts = p.bursts;
        c.tailLevel = 0.55f;
        return 1.45f * clap_.process(c);
    }

private:
    dsp::Clap clap_;
};

class RingTom {
public:
    struct Params {
        float tuneHz = 140.0f;
        float decay = 0.4f;
        float bend = 0.3f;   ///< 0..1: how far the pitch falls during the note
        float noise = 0.3f;  ///< 0 = a pure ringing tone, like a hand drum
    };

    void prepare(double sr) noexcept { sr_ = sr; }
    void reset() noexcept {
        body_.reset();
        bend_.reset();
        noiseEnv_.reset();
        lp_.reset();
    }
    void trigger(int, float vel) noexcept {
        body_.strike(vel);
        bend_.trigger(1.0f);
        noiseEnv_.trigger(vel);
    }
    float tick(const Params& p) noexcept {
        const float hz = p.tuneHz * (1.0f + 0.5f * p.bend * bend_.process(dsp::decayCoef(p.decay, sr_)));
        const float body = body_.process(hz, dsp::decayCoef(p.decay, sr_), sr_);
        const float n = lp_.process(noise_.next(), std::min(p.tuneHz * 10.0f, 12000.0f), 0.7f, sr_).lp;
        return body + 0.8f * p.noise * n * noiseEnv_.process(dsp::decayCoef(0.4f * p.decay, sr_));
    }

private:
    double sr_ = 48000.0;
    dsp::Resonator body_;
    dsp::Decay bend_, noiseEnv_;
    dsp::WhiteNoise noise_;
    dsp::Filter lp_;
};

class RingRim {
public:
    enum Voice { Rim, Clave };
    struct Params {
        int voice = Rim;
        float tune = 0.0f;   ///< semitones
        float decay = 1.0f;  ///< multiplier on the voice's own decay
    };

    void prepare(double sr) noexcept { sr_ = sr; }
    void reset() noexcept {
        a_.reset();
        b_.reset();
        hp_.reset();
    }
    void trigger(int, float vel) noexcept {
        vel_ = std::max(vel, 0.01f);
        a_.strike(vel);
        b_.strike(vel);
    }
    float tick(const Params& p) noexcept {
        const float r = ring::semis(p.tune);
        if (p.voice == Clave) {
            b_.process(1.0f, 0.0f, sr_);  // keep the unused resonator quiet
            return 0.9f * a_.process(2450.0f * r, dsp::decayCoef(0.09f * p.decay, sr_), sr_);
        }
        const float x = a_.process(455.0f * r, dsp::decayCoef(0.035f * p.decay, sr_), sr_) +
                        b_.process(1667.0f * r, dsp::decayCoef(0.025f * p.decay, sr_), sr_);
        return 0.7f * vel_ * std::tanh(2.5f * hp_.process(x, 350.0f * r, 0.7f, sr_).hp / vel_);
    }

private:
    double sr_ = 48000.0;
    float vel_ = 1.0f;
    dsp::Resonator a_, b_;
    dsp::Filter hp_;
};

class RingCowbell {
public:
    struct Params {
        float tune = 0.0f;   ///< semitones
        float decay = 0.4f;  ///< tail T60
        float tone = 0.5f;   ///< band-pass centre, dark … bright
    };

    void prepare(double sr) noexcept { sr_ = sr; }
    void reset() noexcept {
        hit_.reset();
        tail_.reset();
        bp_.reset();
    }
    void trigger(int, float vel) noexcept {
        hit_.trigger(0.7f * vel);
        tail_.trigger(0.3f * vel);
    }
    float tick(const Params& p) noexcept {
        const float r = ring::semis(p.tune);
        const float x = 0.5f * (a_.process(540.0 * r / sr_) + b_.process(800.0 * r / sr_));
        const float env = hit_.process(dsp::decayCoef(0.035f, sr_)) + tail_.process(dsp::decayCoef(p.decay, sr_));
        const float y = bp_.process(x, r * 700.0f * std::exp2(2.0f * p.tone), 1.4f, sr_).bp;
        return 1.1f * y * env;
    }

private:
    double sr_ = 48000.0;
    dsp::Square a_{0.0}, b_{0.3};
    dsp::Decay hit_, tail_;
    dsp::Filter bp_;
};

/// Closed and open hats share one envelope, so a closed hit cuts an open one.
class RingHats {
public:
    enum Input { Closed, Open };
    struct Params {
        float tune = 0.0f;
        float closedDecay = 0.06f;
        float openDecay = 0.5f;
        float tone = 0.5f;  ///< high-pass, full … thin
    };

    void prepare(double sr) noexcept { sr_ = sr; }
    void reset() noexcept {
        env_.reset();
        bp_.reset();
        hp_.reset();
    }
    void trigger(int input, float vel) noexcept {
        open_ = input == Open;
        env_.trigger(vel);
    }
    float tick(const Params& p) noexcept {
        const float x = bp_.process(metal_.process(ring::kMetalHz, ring::semis(p.tune), sr_), 8000.0f, 0.9f, sr_).bp;
        const float e = env_.process(dsp::decayCoef(open_ ? p.openDecay : p.closedDecay, sr_));
        return 6.0f * hp_.process(x * e, 5000.0f * std::exp2(p.tone), 0.7f, sr_).hp;
    }

private:
    double sr_ = 48000.0;
    bool open_ = false;
    dsp::Metal metal_;
    dsp::Decay env_;
    dsp::Filter bp_, hp_;
};

/// Metal split in two bands: a low clang that dies first and a long sizzle.
class RingCymbal {
public:
    struct Params {
        float tune = 0.0f;
        float decay = 2.0f;
        float tone = 0.5f;  ///< low band … high band
    };

    void prepare(double sr) noexcept { sr_ = sr; }
    void reset() noexcept {
        low_.reset();
        high_.reset();
        bp_.reset();
        hp_.reset();
    }
    void trigger(int, float vel) noexcept {
        low_.trigger(vel);
        high_.trigger(vel);
    }
    float tick(const Params& p) noexcept {
        const float m = metal_.process(ring::kMetalHz, ring::semis(p.tune), sr_);
        const float lo = bp_.process(m, 3400.0f, 1.2f, sr_).bp * low_.process(dsp::decayCoef(0.4f * p.decay, sr_));
        const float hi = hp_.process(m, 8000.0f, 0.7f, sr_).hp * high_.process(dsp::decayCoef(p.decay, sr_));
        return 3.2f * ((1.0f - p.tone) * lo + 1.6f * p.tone * hi);
    }

private:
    double sr_ = 48000.0;
    dsp::Metal metal_;
    dsp::Decay low_, high_;
    dsp::Filter bp_, hp_;
};

}  // namespace bleep::patch
