// SPDX-License-Identifier: MIT
// Organic LFOs core (specs/modules/organic-lfos.md): eight slow LFOs fanned
// out from one rate, each wandering a little in speed and shape along seeded
// smooth-noise curves, so the group never lines up exactly but every render
// is the same. Free-running (noise clocks counted from the last reset) or
// locked to the bars, where everything is a pure function of the song
// position. Randomness is dsp/Random.h (uniform01, smoothNoise).
#pragma once

#include "dsp/Random.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"
#include "dsp/Waves.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

struct OrganicParams {
    float rate = 0.5f;     ///< Rate knob, normalised (Free: 0.002–20 Hz; Bars: a note value)
    float spread = 0.5f;   ///< −1..+1
    float drift = 0.3f;    ///< 0..1
    float twist = 0.0f;    ///< −1..+1
    float scatter = 1.0f;  ///< 0..1
    float level = 1.0f;    ///< 0..1
    bool bars = false;     ///< Lock = Bars
    bool anchor = true;
    bool unipolar = false;
    uint32_t seed = 1;
};

struct OrganicTime {
    bool running = false;
    bool started = false;
    double bpm = 120.0;
    double ppq = 0.0;
};

struct OrganicFrame {
    float out[8] = {};
    float sum = 0.0f, max = 0.0f;
};

class OrganicLfosDsp {
public:
    static constexpr int kLfos = 8;
    // Random streams: jitter, rate drift, start phases, shape drift, phase drift (Bars).
    static constexpr uint64_t kJitter = 1, kRateDrift = 0x100, kScatter = 3, kShapeDrift = 0x200, kPhaseDrift = 0x300;

    // ---- note values for Lock = Bars: 64 bars … 1/4T, longest at the knob's left
    static constexpr int kBarValues = 15;
    static int barIndex(float n) noexcept {
        return std::clamp((int)std::lround(std::clamp(n, 0.0f, 1.0f) * (kBarValues - 1)), 0, kBarValues - 1);
    }
    static double barBeats(float n) noexcept {
        const int i = barIndex(n);
        return i == 0 ? 256.0 : i == 1 ? 128.0 : dsp::noteValueBeats(i - 2);  // then 16 bars … 1/4T
    }
    static const char* barName(float n) noexcept {
        const int i = barIndex(n);
        return i == 0 ? "64 bars" : i == 1 ? "32 bars" : dsp::noteValues()[(size_t)(i - 2)].name;
    }

    /// Free rate: 0.002–20 Hz exponential (the declared knob).
    static double rateHz(float n) noexcept { return 0.002 * std::pow(10000.0, std::clamp((double)n, 0.0, 1.0)); }

    /// The seeded rate offset j_k (±0.03; 0 for LFO 1).
    static double jitter(uint32_t seed, int k) noexcept {
        return k == 0 ? 0.0 : (2.0 * dsp::uniform01(seed, (uint64_t)k, kJitter) - 1.0) * 0.03;
    }
    /// Rate multiple of LFO k for a Spread: 2^(Spread × 4 × g_k), g_k = k/7 + j_k.
    static double rateRatio(uint32_t seed, int k, float spread) noexcept {
        return std::exp2((double)std::clamp(spread, -1.0f, 1.0f) * 4.0 * ((double)k / 7.0 + jitter(seed, k)));
    }

    /// The wave at phase p for a Twist t (−1 soft plateau, 0 sine, +1 sharp,
    /// lopsided peak), −1..+1.
    static float wave(double p, float t) noexcept {
        t = std::clamp(t, -1.0f, 1.0f);
        constexpr float kTwoPi = 6.28318530718f;
        if (t >= 0.0f) {
            // Skew so the rise takes 0.5 − 0.4·t of the cycle (trough at p = 0.75 as for a sine).
            const float a = 0.5f - 0.4f * t;
            const float q = (float)dsp::wrap01(p + 0.25);
            const float s = q < a ? 0.5f * q / a : 0.5f + 0.5f * (q - a) / (1.0f - a);
            const float x = -std::cos(kTwoPi * s);
            if (t < 1e-4f) return x;
            return (x < 0.0f ? -1.0f : 1.0f) * std::pow(std::fabs(x), 1.0f + 2.0f * t);
        }
        const float x = std::sin(kTwoPi * (float)p);
        const float g = 6.0f * -t;  // 0 at Twist 0: continuous with the sine
        return g < 1e-4f ? x : std::tanh(g * x) / std::tanh(g);
    }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        fadeStep_ = (float)(1.0 / (0.05 * sampleRate));
        reset();
    }
    void reset() noexcept {
        reset_.reset();
        seed_ = UINT32_MAX;
        bars_ = -1;
        vppq_ = 0.0;
        fade_ = 0.0f;
        last_.fill(0.0f);
        from_.fill(0.0f);
        restart_ = true;
    }

    /// LFO k's current rate (Hz), for the view's rate strip.
    double liveRate(int k) const noexcept { return live_[(size_t)k]; }

    void tick(const OrganicParams& p, float resetIn, const OrganicTime& t, OrganicFrame& f) noexcept {
        const bool resetEdge = reset_.process(resetIn) > 0;
        if (p.seed != seed_ || (int)p.bars != bars_) {  // a new seed or lock: crossfade over 50 ms
            if (seed_ != UINT32_MAX) {
                from_ = last_;
                fade_ = 1.0f;
            }
            seed_ = p.seed;
            bars_ = (int)p.bars;
            for (int k = 0; k < kLfos; ++k) start_[(size_t)k] = dsp::uniform01(seed_, (uint64_t)k, kScatter);
            spread_ = 2.0f;  // recompute the ratios
        }
        if (p.spread < spread_ || p.spread > spread_) {
            spread_ = p.spread;
            for (int k = 0; k < kLfos; ++k) ratio_[(size_t)k] = rateRatio(seed_, k, spread_);
        }
        const double drift = (double)std::clamp(p.drift, 0.0f, 1.0f);
        const double twist = (double)p.twist;
        float y[kLfos];

        if (p.bars) {
            // Everything is a function of the song position P (the transport's,
            // or a virtual one running on at the current tempo while stopped).
            const double beats = barBeats(p.rate);
            if (t.running) vppq_ = t.ppq;
            else vppq_ += t.bpm / 60.0 / sampleRate_;
            const double c1 = vppq_ / beats;
            const double hz1 = dsp::syncedHz(t.bpm, beats);
            for (int k = 0; k < kLfos; ++k) {
                const double r = ratio_[(size_t)k];
                const double ck = c1 * r;
                const bool anchored = k == 0 && p.anchor;
                const double s = anchored ? 0.0 : (double)std::clamp(p.scatter, 0.0f, 1.0f) * start_[(size_t)k];
                const double d = anchored ? 0.0 : drift * 0.5 * rateNoise_[(size_t)k].at(seed_, kPhaseDrift + (uint64_t)k, ck / 8.0);
                const double m = shapeNoise_[(size_t)k].at(seed_, kShapeDrift + (uint64_t)k, ck / 13.0);
                y[k] = wave(dsp::wrap01(ck + s + d), (float)std::clamp(twist + drift * 0.25 * m, -1.0, 1.0));
                live_[(size_t)k] = std::clamp(hz1 * r, 0.002, 50.0);
            }
        } else {
            if (resetEdge || t.started || restart_) {
                restart_ = false;
                for (int k = 0; k < kLfos; ++k) {
                    const bool anchored = k == 0 && p.anchor;
                    phase_[(size_t)k] = anchored ? 0.0 : (double)std::clamp(p.scatter, 0.0f, 1.0f) * start_[(size_t)k];
                    rateClock_[(size_t)k] = shapeClock_[(size_t)k] = 0.0;
                }
            }
            const double f1 = rateHz(p.rate);
            for (int k = 0; k < kLfos; ++k) {
                const double fk = std::clamp(f1 * ratio_[(size_t)k], 0.002, 50.0);
                const bool anchored = k == 0 && p.anchor;
                // Noise curves with a point every 8 (rate) and 13 (shape) cycles of this LFO.
                const double n = anchored ? 0.0 : rateNoise_[(size_t)k].at(seed_, kRateDrift + (uint64_t)k, rateClock_[(size_t)k]);
                const double m = shapeNoise_[(size_t)k].at(seed_, kShapeDrift + (uint64_t)k, shapeClock_[(size_t)k]);
                rateClock_[(size_t)k] += fk / (8.0 * sampleRate_);
                shapeClock_[(size_t)k] += fk / (13.0 * sampleRate_);
                const double hz = std::clamp(fk * std::exp2(drift * 0.35 * n), 0.002, 50.0);
                live_[(size_t)k] = hz;
                y[k] = wave(phase_[(size_t)k], (float)std::clamp(twist + drift * 0.25 * m, -1.0, 1.0));
                phase_[(size_t)k] = dsp::wrap01(phase_[(size_t)k] + hz / sampleRate_);
            }
        }

        // Outputs, Sum and Max, then Polarity and Level.
        const float level = std::clamp(p.level, 0.0f, 1.0f);
        auto out = [&](float v) { return (p.unipolar ? dsp::waves::unipolar(v) : v) * level; };
        float sum = 0.0f, hi = -1.0f;
        for (int k = 0; k < kLfos; ++k) {
            sum += y[k];
            hi = std::max(hi, y[k]);
            f.out[k] = out(y[k]);
        }
        // Eight unrelated waves sum to about √8: that reaches full scale; eight
        // in step would go past it and are held at ±1.
        constexpr float kTanh14 = 0.8853516482f;  // tanh(1.4)
        f.sum = out(std::clamp(std::tanh(1.4f * sum / std::sqrt((float)kLfos)) / kTanh14, -1.0f, 1.0f));
        f.max = out(hi);
        if (fade_ > 0.0f) {
            for (int k = 0; k < kLfos; ++k) f.out[k] += fade_ * (from_[(size_t)k] - f.out[k]);
            f.sum += fade_ * (from_[kLfos] - f.sum);
            f.max += fade_ * (from_[kLfos + 1] - f.max);
            fade_ = std::max(0.0f, fade_ - fadeStep_);
        }
        for (int k = 0; k < kLfos; ++k) last_[(size_t)k] = f.out[k];
        last_[kLfos] = f.sum;
        last_[kLfos + 1] = f.max;
    }

private:
    /// dsp::smoothNoise with its four points cached until t moves to the next
    /// integer (same values, a fraction of the hashing).
    struct NoiseCurve {
        int64_t at0 = INT64_MIN;
        uint64_t key = 0;
        double y[4] = {};
        double at(uint32_t seed, uint64_t stream, double t) noexcept {
            const double fl = std::floor(t);
            const int64_t i = (int64_t)fl;
            const uint64_t k = ((uint64_t)seed << 32) ^ stream;
            if (i != at0 || k != key) {
                at0 = i;
                key = k;
                for (int j = 0; j < 4; ++j) y[j] = dsp::noisePoint(seed, i - 1 + j, stream);
            }
            return std::clamp(dsp::catmullRom(y[0], y[1], y[2], y[3], t - fl), -1.0, 1.0);
        }
    };

    double sampleRate_ = 48000.0;
    std::array<NoiseCurve, kLfos> rateNoise_, shapeNoise_;
    std::array<double, kLfos> ratio_{};
    float spread_ = 2.0f;
    dsp::GateEdge reset_;
    uint32_t seed_ = UINT32_MAX;
    int bars_ = -1;
    bool restart_ = true;
    double vppq_ = 0.0;
    std::array<double, kLfos> phase_{}, rateClock_{}, shapeClock_{}, start_{}, live_{};
    std::array<float, kLfos + 2> last_{}, from_{};
    float fade_ = 0.0f, fadeStep_ = 1.0f / 2400.0f;
};

}  // namespace bleep::patch
