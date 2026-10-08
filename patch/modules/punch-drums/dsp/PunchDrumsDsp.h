// SPDX-License-Identifier: MIT
// Punch drums: drum voices built the way the drum machines of the mid
// eighties built them. Sine oscillators that restart on every hit and sweep
// down fast (kick, toms, snare body), with a noise click on top, and bright,
// slightly crunchy metal for the hats and cymbals, like the early samplers
// those machines used for them. Tight, hard, forward. See
// specs/modules/punch-drums.md.
//
// Every voice: prepare(), reset(), trigger(input, velocity), tick(params).
#pragma once

#include "dsp/Drums.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

namespace punch {

/// Square-wave frequencies of the metal sources, in Hz.
constexpr dsp::Metal::Freqs kHatHz{317.0f, 421.0f, 556.0f, 691.0f, 793.0f, 1033.0f};
constexpr dsp::Metal::Freqs kCrashHz{263.0f, 400.0f, 421.0f, 474.0f, 587.0f, 845.0f};
constexpr dsp::Metal::Freqs kRideHz{336.0f, 492.0f, 607.0f, 758.0f, 917.0f, 1213.0f};

inline float semis(float st) noexcept { return std::exp2(st / 12.0f); }

}  // namespace punch

class PunchKick {
public:
    struct Params {
        float tuneHz = 50.0f;
        float decay = 0.6f;
        float sweep = 0.5f;   ///< 0..1: depth of the pitch drop at the start
        float attack = 0.5f;  ///< 0..1: the noise click
        float drive = 0.3f;
    };

    void prepare(double sr) noexcept { sr_ = sr; }
    void reset() noexcept {
        amp_.reset();
        fast_.reset();
        slow_.reset();
        click_.reset();
        lp_.reset();
    }
    void trigger(int, float vel) noexcept {
        vel_ = std::max(vel, 0.01f);
        osc_.restart();
        amp_.trigger(vel);
        fast_.trigger(1.0f);
        slow_.trigger(1.0f);
        click_.trigger(vel);
    }
    float tick(const Params& p) noexcept {
        const float bend = 5.0f * fast_.process(dsp::decayCoef(0.03f, sr_)) + 0.6f * slow_.process(dsp::decayCoef(0.25f, sr_));
        const float body = osc_.process(p.tuneHz * (1.0f + p.sweep * bend), sr_) * amp_.process(dsp::decayCoef(p.decay, sr_));
        const float c = click_.process(dsp::decayCoef(0.012f, sr_));
        const float click = c * (0.6f * c + lp_.process(noise_.next(), 7000.0f, 0.7f, sr_).lp);
        return vel_ * dsp::softClip((body + 0.8f * p.attack * click) / vel_, p.drive);
    }

private:
    double sr_ = 48000.0;
    float vel_ = 1.0f;
    dsp::SweepOsc osc_;
    dsp::Decay amp_, fast_, slow_, click_;
    dsp::WhiteNoise noise_;
    dsp::Filter lp_;
};

class PunchSnare {
public:
    struct Params {
        float tuneHz = 200.0f;
        float tone = 0.5f;    ///< noise brightness
        float snappy = 0.6f;
        float decay = 0.3f;   ///< noise T60
    };

    void prepare(double sr) noexcept { sr_ = sr; }
    void reset() noexcept {
        a1_.reset();
        a2_.reset();
        bend_.reset();
        noiseEnv_.reset();
        lp_.reset();
        hp_.reset();
    }
    void trigger(int, float vel) noexcept {
        vel_ = std::max(vel, 0.01f);
        o1_.restart();
        o2_.restart();
        a1_.trigger(vel);
        a2_.trigger(vel);
        bend_.trigger(1.0f);
        noiseEnv_.trigger(vel);
    }
    float tick(const Params& p) noexcept {
        const float b = 1.0f + 0.4f * bend_.process(dsp::decayCoef(0.04f, sr_));
        const float body = 0.6f * o1_.process(p.tuneHz * b, sr_) * a1_.process(dsp::decayCoef(0.16f, sr_)) +
                           0.4f * o2_.process(p.tuneHz * 1.62f * b, sr_) * a2_.process(dsp::decayCoef(0.1f, sr_));
        float n = lp_.process(noise_.next(), 3000.0f * std::exp2(2.4f * p.tone), 0.7f, sr_).lp;
        n = hp_.process(n, 500.0f, 0.7f, sr_).hp;
        return 0.8f * vel_ * std::tanh(1.3f * body / vel_) + 1.2f * p.snappy * n * noiseEnv_.process(dsp::decayCoef(p.decay, sr_));
    }

private:
    double sr_ = 48000.0;
    float vel_ = 1.0f;
    dsp::SweepOsc o1_, o2_;
    dsp::Decay a1_, a2_, bend_, noiseEnv_;
    dsp::WhiteNoise noise_;
    dsp::Filter lp_, hp_;
};

class PunchClap {
public:
    struct Params {
        float toneHz = 1500.0f;
        float decay = 0.35f;
        float spread = 0.008f;
        int bursts = 4;
    };

    void prepare(double sr) noexcept { clap_.prepare(sr); }
    void reset() noexcept { clap_.reset(); }
    void trigger(int, float vel) noexcept { clap_.trigger(vel); }
    float tick(const Params& p) noexcept {
        dsp::Clap::Params c;
        c.toneHz = p.toneHz;
        c.q = 0.9f;
        c.decay = p.decay;
        c.spread = p.spread;
        c.bursts = p.bursts;
        c.tailLevel = 0.75f;
        c.highPassHz = 700.0f;
        return 2.4f * clap_.process(c);
    }

private:
    dsp::Clap clap_;
};

class PunchTom {
public:
    struct Params {
        float tuneHz = 110.0f;
        float decay = 0.45f;
        float bend = 0.5f;
        float noise = 0.2f;
    };

    void prepare(double sr) noexcept { sr_ = sr; }
    void reset() noexcept {
        amp_.reset();
        fast_.reset();
        slow_.reset();
        noiseEnv_.reset();
        lp_.reset();
    }
    void trigger(int, float vel) noexcept {
        vel_ = std::max(vel, 0.01f);
        osc_.restart();
        amp_.trigger(vel);
        fast_.trigger(1.0f);
        slow_.trigger(1.0f);
        noiseEnv_.trigger(vel);
    }
    float tick(const Params& p) noexcept {
        const float bend = 1.0f * fast_.process(dsp::decayCoef(0.05f, sr_)) + 0.3f * slow_.process(dsp::decayCoef(p.decay, sr_));
        const float body = osc_.process(p.tuneHz * (1.0f + p.bend * bend), sr_) * amp_.process(dsp::decayCoef(p.decay, sr_));
        const float n = lp_.process(noise_.next(), 4000.0f, 0.7f, sr_).lp * noiseEnv_.process(dsp::decayCoef(0.08f, sr_));
        return vel_ * dsp::softClip((body + 0.9f * p.noise * n) / vel_, 0.08f);
    }

private:
    double sr_ = 48000.0;
    float vel_ = 1.0f;
    dsp::SweepOsc osc_;
    dsp::Decay amp_, fast_, slow_, noiseEnv_;
    dsp::WhiteNoise noise_;
    dsp::Filter lp_;
};

class PunchRim {
public:
    struct Params {
        float tune = 0.0f;
        float decay = 1.0f;  ///< multiplier
    };

    void prepare(double sr) noexcept { sr_ = sr; }
    void reset() noexcept {
        for (auto& r : res_) r.reset();
        click_.reset();
        hp_.reset();
    }
    void trigger(int, float vel) noexcept {
        vel_ = std::max(vel, 0.01f);
        for (auto& r : res_) r.strike(vel);
        click_.trigger(vel);
    }
    float tick(const Params& p) noexcept {
        const float r = punch::semis(p.tune);
        float x = 0.5f * res_[0].process(500.0f * r, dsp::decayCoef(0.03f * p.decay, sr_), sr_) +
                  0.35f * res_[1].process(1720.0f * r, dsp::decayCoef(0.022f * p.decay, sr_), sr_) +
                  0.25f * res_[2].process(3260.0f * r, dsp::decayCoef(0.015f * p.decay, sr_), sr_);
        x += 0.4f * noise_.next() * click_.process(dsp::decayCoef(0.003f, sr_));
        return 0.9f * vel_ * std::tanh(3.0f * hp_.process(x, 420.0f * r, 0.7f, sr_).hp / vel_);
    }

private:
    double sr_ = 48000.0;
    float vel_ = 1.0f;
    dsp::Resonator res_[3];
    dsp::Decay click_;
    dsp::WhiteNoise noise_;
    dsp::Filter hp_;
};

/// Closed and open hats share one envelope, so a closed hit cuts an open one.
class PunchHats {
public:
    enum Input { Closed, Open };
    struct Params {
        float tune = 0.0f;
        float closedDecay = 0.05f;
        float openDecay = 0.4f;
        float tone = 0.5f;
        float crunch = 0.4f;
    };

    void prepare(double sr) noexcept { sr_ = sr; }
    void reset() noexcept {
        env_.reset();
        hp_.reset();
        crush_.reset();
    }
    void trigger(int input, float vel) noexcept {
        open_ = input == Open;
        env_.trigger(vel);
    }
    float tick(const Params& p) noexcept {
        float x = 0.65f * metal_.process(punch::kHatHz, punch::semis(p.tune), sr_) + 0.35f * noise_.next();
        x = hp_.process(x, 6000.0f * std::exp2(0.8f * p.tone), 0.8f, sr_).hp;
        x = crush_.process(x, p.crunch, sr_);
        return 1.8f * x * env_.process(dsp::decayCoef(open_ ? p.openDecay : p.closedDecay, sr_));
    }

private:
    double sr_ = 48000.0;
    bool open_ = false;
    dsp::Metal metal_;
    dsp::WhiteNoise noise_;
    dsp::Decay env_;
    dsp::Filter hp_;
    dsp::Crusher crush_;
};

/// Crash: a burst of bright noisy metal. Ride: a ping with a bell over a
/// quieter wash.
class PunchCymbal {
public:
    enum Voice { Crash, Ride };
    struct Params {
        int voice = Crash;
        float tune = 0.0f;
        float decay = 2.0f;
        float tone = 0.5f;
        float crunch = 0.3f;
    };

    void prepare(double sr) noexcept { sr_ = sr; }
    void reset() noexcept {
        env_.reset();
        hit_.reset();
        hp_.reset();
        bell_.reset();
        crush_.reset();
    }
    void trigger(int, float vel) noexcept {
        env_.trigger(vel);
        hit_.trigger(vel);
    }
    float tick(const Params& p) noexcept {
        const float r = punch::semis(p.tune);
        const float hp = 4000.0f * std::exp2(1.2f * p.tone);
        const float hit = hit_.process(dsp::decayCoef(0.08f, sr_));
        float x;
        if (p.voice == Ride) {
            const float m = metal_.process(punch::kRideHz, r, sr_);
            const float wash = hp_.process(0.6f * m + 0.4f * noise_.next(), hp, 0.7f, sr_).hp;
            const float bell = bell_.process(m, 2600.0f * r, 3.0f, sr_).bp;
            x = (0.7f * wash + 0.9f * bell) * env_.process(dsp::decayCoef(1.5f * p.decay, sr_)) + 0.4f * wash * hit;
        } else {
            const float m = metal_.process(punch::kCrashHz, r, sr_);
            const float wash = hp_.process(0.5f * m + 0.5f * noise_.next(), hp, 0.7f, sr_).hp;
            x = wash * (env_.process(dsp::decayCoef(p.decay, sr_)) + 1.2f * hit);
        }
        return 0.75f * crush_.process(x, p.crunch, sr_);
    }

private:
    double sr_ = 48000.0;
    dsp::Metal metal_;
    dsp::WhiteNoise noise_;
    dsp::Decay env_, hit_;
    dsp::Filter hp_, bell_;
    dsp::Crusher crush_;
};

}  // namespace bleep::patch
