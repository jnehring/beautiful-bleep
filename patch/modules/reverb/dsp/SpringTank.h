// SPDX-License-Identifier: GPL-3.0-only
// SpringTank: the "Spring" character of the Verb. A dispersive loop, one per
// channel: a delay line (the length of the coil), a chain of 36 first-order
// allpasses (the dispersion: low frequencies travel slower than highs, so every
// round trip smears the note into a falling chirp), a damping low-pass, a
// low-band gain for Bass, and a tanh at the write point (the coil's limit).
//
// What makes it boingy: Mod Depth does two things. A slow wobble of the line
// length, and an "excitation push": the level of what enters the coil
// shortens the line for a moment, which then sags back with the signal's
// envelope, so every hit bends upward and falls: a stretched-and-released
// coil. The two channels are coils of different length, so a mono input
// still gives a stereo tail.
#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace bleep::patch {

struct SpringParams {
    float size = 0.5f;            ///< 0 … 1: the coil's length, 22 … 122 ms per round trip
    float decaySeconds = 2.5f;    ///< T60 of the mid band (1e9 = lossless)
    float damping = 0.4f;         ///< 0 … 1
    float bass = 1.0f;            ///< low T60 × 0.5 … 2
    float dispersion = 0.7f;      ///< 0 … 1 (the Diffusion knob): chirp amount
    float modRate = 0.6f;         ///< Hz
    float modDepth = 0.25f;       ///< 0 … 1
    double preDelaySamples = 0.0;
    bool freeze = false;
};

class SpringTank {
public:
    static constexpr int kStages = 36;

    void prepare(double sampleRate) {
        sr_ = sampleRate;
        const size_t lineSize = (size_t)(0.36 * sampleRate) + 8, preSize = (size_t)(1.0 * sampleRate) + 8;
        for (auto& c : ch_) {
            c.line.assign(lineSize, 0.0f);
            c.pre.assign(preSize, 0.0f);
        }
        const double w = std::tan(3.14159265358979323846 * 220.0 / sampleRate);
        lowG_ = (float)(w / (1.0 + w));
        clear();
    }

    void clear() noexcept {
        for (size_t i = 0; i < 2; ++i) {
            auto& c = ch_[i];
            std::fill(c.line.begin(), c.line.end(), 0.0f);
            std::fill(c.pre.begin(), c.pre.end(), 0.0f);
            c.z.fill(0.0f);
            c.dampZ = c.lowZ = c.env = 0.0f;
            c.write = c.preWrite = 0;
            c.phase = i ? 0.37 : 0.0;
            c.t = c.pd = -1.0;
            c.a = -2.0f;
        }
    }

    void restartModulation() noexcept {
        ch_[0].phase = 0.0;
        ch_[1].phase = 0.37;
    }

    /// Per-block (every 8 samples) coefficients.
    void update(const SpringParams& p) noexcept {
        const float dec = std::max(0.05f, p.decaySeconds);
        // Gain per round trip for a T60 of `dec`: the loop time differs per channel.
        for (size_t i = 0; i < 2; ++i) {
            auto& c = ch_[i];
            const double loop = loopSeconds(p.size, i);
            const double g = p.freeze ? 1.0 : std::pow(10.0, -3.0 * loop / dec);
            c.gain = (float)std::min(g, 1.0);
            const double bass = std::clamp((double)p.bass, 0.5, 2.0);
            c.lowRatio = p.freeze ? 1.0f : (float)std::pow(std::max(g, 1e-6), 1.0 / bass - 1.0);
        }
        const double fc = p.freeze ? 0.45 * sr_ : 14000.0 * std::pow(0.05, std::clamp((double)p.damping, 0.0, 1.0));
        const double w = std::tan(3.14159265358979323846 * std::min(fc, 0.45 * sr_) / sr_);
        dampG_ = p.freeze ? 1.0f : (float)(w / (1.0 + w));
        aTarget_ = -(0.1f + 0.8f * std::clamp(p.dispersion, 0.0f, 1.0f));
        phaseStep_ = std::clamp((double)p.modRate, 0.0, 20.0) / sr_;
        depth_ = std::clamp(p.modDepth, 0.0f, 1.0f);
        inGain_ = p.freeze ? 0.0f : 0.5f;
    }

    void process(float inL, float inR, float& outL, float& outR, const SpringParams& p) noexcept {
        const float in[2] = {inL, inR};
        float out[2];
        for (size_t i = 0; i < 2; ++i) out[i] = channel(ch_[i], i, in[i], p);
        outL = out[0];
        outR = out[1];
    }

private:
    struct Channel {
        std::vector<float> line, pre;
        std::array<float, kStages> z{};
        float dampZ = 0.0f, lowZ = 0.0f, env = 0.0f, gain = 0.9f, lowRatio = 1.0f, a = -2.0f;
        double phase = 0.0, t = -1.0, pd = -1.0;
        size_t write = 0, preWrite = 0;
    };

    /// The coil's round trip in seconds (the second channel is a longer coil).
    static double loopSeconds(float size, size_t channel) noexcept {
        return (0.022 + 0.1 * std::clamp((double)size, 0.0, 1.0)) * (channel ? 1.13 : 1.0);
    }

    static float readLinear(const std::vector<float>& buf, size_t write, double delay) noexcept {
        const size_t n = buf.size();
        const double d = std::clamp(delay, 1.0, (double)(n - 3));
        const size_t whole = (size_t)d;
        const float frac = (float)(d - (double)whole);
        const float a = buf[(write + n - whole) % n], b = buf[(write + n - whole - 1) % n];
        return a + frac * (b - a);
    }

    float channel(Channel& c, size_t index, float x, const SpringParams& p) noexcept {
        if (c.a < -1.5f) c.a = aTarget_;
        const double target = loopSeconds(p.size, index) * sr_;
        if (c.t < 0.0) c.t = target, c.pd = p.preDelaySamples;
        c.t += 0.0006 * (target - c.t);
        c.pd += 0.002 * (p.preDelaySamples - c.pd);
        c.a += 0.002f * (aTarget_ - c.a);

        // Pre-delay.
        c.preWrite = (c.preWrite + 1) % c.pre.size();
        c.pre[c.preWrite] = x;
        const float fed = (c.pd < 1.0 ? x : readLinear(c.pre, c.preWrite, c.pd)) * inGain_;

        // The excitation push and the slow wobble shorten or stretch the coil.
        const float level = std::fabs(fed) * 2.0f;
        c.env += (level > c.env ? 0.03f : 0.00025f) * (level - c.env);
        c.phase += phaseStep_;
        c.phase -= std::floor(c.phase);
        const double wobble = std::sin(6.283185307179586 * c.phase);
        const double push = std::min(1.0f, 3.0f * c.env);
        const double delay = c.t * (1.0 - depth_ * (0.12 * push + 0.03 * (0.5 + 0.5 * wobble)));

        // Round trip: the line, the dispersion chain, damping, Bass, gain.
        float s = readLinear(c.line, c.write, delay);
        for (auto& z : c.z) {
            const float y = c.a * s + z;
            z = s - c.a * y;
            s = y;
        }
        const float wet = s;
        const float v = (s - c.dampZ) * dampG_;
        const float lp = v + c.dampZ;
        c.dampZ = lp + v;
        const float lv = (lp - c.lowZ) * lowG_;
        const float low = lv + c.lowZ;
        c.lowZ = low + lv;
        const float loop = c.gain * ((lp - low) + c.lowRatio * low);
        c.write = (c.write + 1) % c.line.size();
        c.line[c.write] = std::tanh(fed + loop);
        return wet;
    }

    double sr_ = 48000.0, phaseStep_ = 0.0;
    float lowG_ = 0.03f, dampG_ = 0.5f, aTarget_ = -0.6f, depth_ = 0.25f, inGain_ = 0.5f;
    Channel ch_[2];
};

}  // namespace bleep::patch
