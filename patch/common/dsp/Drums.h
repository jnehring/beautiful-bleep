// SPDX-License-Identifier: MIT
// Building blocks for the drum voices: decays, ringing resonators,
// band-limited squares, a six-oscillator metal source and a hand clap.
#pragma once

#include "Lofi.h"
#include "Noise.h"
#include "Svf.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::dsp {

constexpr double kTwoPi = 6.28318530717958647692;

/// a != b, without -Wfloat-equal: for caching coefficients.
inline bool differs(float a, float b) noexcept { return a < b || a > b; }

/// Per-sample multiplier that falls by 60 dB in t60 seconds.
inline float decayCoef(float t60, double sampleRate) noexcept {
    return (float)std::exp(-6.907755278982137 / (std::max((double)t60, 1e-4) * sampleRate));
}

/// Soft clip that keeps ±1 at ±1: drive 0 is clean. Voices divide by the
/// hit's velocity before and multiply after, so velocity changes the
/// loudness, not the amount of distortion.
inline float softClip(float x, float drive) noexcept {
    if (drive <= 0.0f) return x;
    const float g = 1.0f + 8.0f * drive;
    return std::tanh(x * g) / std::tanh(g);
}

/// Exponential decay: jumps to a level on trigger, then falls.
class Decay {
public:
    void reset() noexcept { v_ = 0.0f; }
    void trigger(float level) noexcept { v_ = level; }
    float process(float coef) noexcept {
        const float o = v_;
        v_ = v_ * coef;
        if (v_ < 1e-9f) v_ = 0.0f;
        return o;
    }
    float value() const noexcept { return v_; }

private:
    float v_ = 0.0f;
};

/// A ringing resonator (complex one-pole): struck, it rings as a sine that
/// starts at zero phase and dies away. Its amplitude doesn't depend on the
/// frequency, so the pitch can sweep while it rings, and a second strike adds
/// to the ringing like a real resonant circuit.
class Resonator {
public:
    void reset() noexcept { re_ = im_ = 0.0f; }
    void strike(float amount) noexcept { re_ += amount; }
    float process(float hz, float coef, double sampleRate) noexcept {
        if (differs(hz, hz_)) {
            hz_ = hz;
            const double w = kTwoPi * std::clamp((double)hz, 1.0, 0.45 * sampleRate) / sampleRate;
            c_ = (float)std::cos(w);
            s_ = (float)std::sin(w);
        }
        const float re = coef * (re_ * c_ - im_ * s_);
        im_ = coef * (re_ * s_ + im_ * c_);
        re_ = re;
        if (std::fabs(re_) + std::fabs(im_) < 1e-9f) re_ = im_ = 0.0f;
        return im_;
    }

private:
    float re_ = 0.0f, im_ = 0.0f;
    float hz_ = -1.0f, c_ = 1.0f, s_ = 0.0f;
};

/// Sine oscillator whose phase restarts on trigger, for swept drums.
class SweepOsc {
public:
    void restart() noexcept { ph_ = 0.0; }
    float process(float hz, double sampleRate) noexcept {
        const float o = (float)std::sin(kTwoPi * ph_);
        ph_ += hz / sampleRate;
        ph_ -= std::floor(ph_);
        return o;
    }

private:
    double ph_ = 0.0;
};

/// Band-limited square (polyBLEP), free running.
class Square {
public:
    explicit Square(double phase = 0.0) noexcept : ph_(phase) {}
    float process(double inc) noexcept {
        ph_ += inc;
        ph_ -= std::floor(ph_);
        float s = ph_ < 0.5 ? 1.0f : -1.0f;
        s += blep(ph_, inc);
        s -= blep(ph_ + 0.5 - std::floor(ph_ + 0.5), inc);
        return s;
    }

private:
    static float blep(double t, double dt) noexcept {
        if (t < dt) {
            t /= dt;
            return (float)(t + t - t * t - 1.0);
        }
        if (t > 1.0 - dt) {
            t = (t - 1.0) / dt;
            return (float)(t * t + t + t + 1.0);
        }
        return 0.0f;
    }
    double ph_;
};

/// Six detuned squares: the inharmonic clang behind hats, cymbals and bells.
class Metal {
public:
    using Freqs = std::array<float, 6>;
    float process(const Freqs& hz, float ratio, double sampleRate) noexcept {
        float sum = 0.0f;
        for (size_t i = 0; i < osc_.size(); ++i) sum += osc_[i].process(hz[i] * ratio / sampleRate);
        return sum * (1.0f / 6.0f);
    }

private:
    std::array<Square, 6> osc_{Square(0.0), Square(0.37), Square(0.71), Square(0.13), Square(0.52), Square(0.89)};
};

/// A state-variable filter that only recomputes its coefficients on change.
class Filter {
public:
    void reset() noexcept { f_.reset(); }
    SvfOutputs process(float x, float hz, float q, double sampleRate) noexcept {
        if (differs(hz, hz_) || differs(q, q_)) {
            hz_ = hz;
            q_ = q;
            f_.set(hz, q, sampleRate);
        }
        return f_.process(x);
    }

private:
    Svf f_;
    float hz_ = -1.0f, q_ = -1.0f;
};

/// Reduces a signal to a lower bit depth and sample rate, like an early
/// sampler. Crunch 0 is clean.
class Crusher {
public:
    void reset() noexcept { held_ = 0.0f; dec_.reset(); }
    float process(float x, float crunch, double sampleRate) noexcept {
        if (crunch <= 0.0f) return x;
        if (dec_.advance((1.0 - 0.6 * crunch) * 44100.0 / sampleRate))  // down to ~18 kHz
            held_ = quantizeSteps(x, std::exp2(15.0f - 9.0f * crunch));  // 16 bits … 7 bits (sign included)
        return held_;
    }

private:
    float held_ = 0.0f;
    Decimator dec_;
};

/// Hand clap: band-passed noise opened by a few quick bursts, then a short
/// diffuse tail, as if several hands clapped a few milliseconds apart.
class Clap {
public:
    struct Params {
        float toneHz = 1000.0f;   ///< band-pass centre
        float q = 1.5f;
        float decay = 0.25f;      ///< tail, T60 seconds
        float spread = 0.010f;    ///< seconds between bursts
        int bursts = 4;
        float tailLevel = 0.6f;
        float highPassHz = 0.0f;  ///< 0 = off
    };

    void prepare(double sampleRate) noexcept { sr_ = sampleRate; }
    void reset() noexcept {
        t_ = -1.0;
        burst_.reset();
        tail_.reset();
        bp_.reset();
        hp_.reset();
    }
    void trigger(float velocity) noexcept {
        vel_ = velocity;
        t_ = 0.0;
        next_ = 0;
    }

    float process(const Params& p) noexcept {
        if (t_ >= 0.0) {
            const int bursts = std::max(p.bursts, 1);
            if (next_ < bursts && t_ >= next_ * (double)p.spread) {
                burst_.trigger(vel_ * (next_ == bursts - 1 ? 1.0f : 0.8f));
                if (next_ == bursts - 1) tail_.trigger(vel_ * p.tailLevel);
                ++next_;
            }
            t_ += 1.0 / sr_;
            if (next_ >= bursts) t_ = -1.0;
        }
        const float env = burst_.process(decayCoef(std::max(p.spread * 0.9f, 0.002f), sr_)) +
                          tail_.process(decayCoef(p.decay, sr_));
        float x = noise_.next();
        x = bp_.process(x, p.toneHz, p.q, sr_).bp;
        if (p.highPassHz > 0.0f) x = hp_.process(x, p.highPassHz, 0.7f, sr_).hp;
        return x * env;
    }

private:
    double sr_ = 48000.0;
    double t_ = -1.0;
    int next_ = 0;
    float vel_ = 1.0f;
    Decay burst_, tail_;
    WhiteNoise noise_;
    Filter bp_, hp_;
};

}  // namespace bleep::dsp
