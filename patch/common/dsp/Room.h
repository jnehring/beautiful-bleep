// SPDX-License-Identifier: MIT
// A small stereo room: a feedback delay network of 4 (or 8) lines with a
// Householder mixing matrix, a one-pole damping filter per line, two slow
// modulated lines against metallic ringing and an early-reflection tap pair
// (doc/specs/modules/modal-voice.md 4.4). Cheap enough to run per voice inside a
// Voice Cell; a board reverb can use the 8-line version.
//
// Lines are 13–41 ms scaled by size (0.5× … 2.5×); RT60 runs from 0.3 s to
// 4 s with size. Memory is allocated in prepare(); about 160 kB for 4 lines
// at 96 kHz. When the input is silent and the tail has died (−90 dB) it
// sleeps and process() costs almost nothing.
#pragma once

#include "Random.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace bleep::dsp {

struct RoomParams {
    float size = 0.4f;     ///< 0..1: booth → hall (line lengths and RT60)
    float damping = 0.5f;  ///< 0..1: high-frequency loss in the tail (bigger rooms are darker too)
    float amount = 0.2f;   ///< 0..1: wet level
    float decay = 0.0f;    ///< seconds; ≤ 0 takes the RT60 from size
};

template <int N = 4>
class Room {
    static_assert(N == 4 || N == 8, "Room: 4 or 8 lines");

public:
    struct Out {
        float l, r;
    };

    /// Allocates (not RT-safe).
    void prepare(double sampleRate, uint64_t seed = 1) {
        sr_ = sampleRate;
        const double maxSamples = kMaxScale * 41.0 * 0.001 * sr_ + kModMs * 0.001 * sr_ + 8.0;
        size_t n = 16;
        while ((double)n < maxSamples) n <<= 1;
        for (auto& l : lines_) l.assign(n, 0.0f);
        mask_ = n - 1;
        for (int i = 0; i < 2; ++i) {
            lfoPhase_[i] = uniform01(seed, (uint64_t)i, 0xf0);
            lfoInc_[i] = (0.1 + 0.2 * uniform01(seed, (uint64_t)i, 0xf1)) / sr_;
        }
        lenSmooth_ = (float)std::exp(-1.0 / (0.08 * sr_));
        set(params_);
        for (int i = 0; i < N; ++i) len_[i] = target_[i];
        reset();
    }
    void reset() noexcept {
        for (auto& l : lines_) std::fill(l.begin(), l.end(), 0.0f);
        for (int i = 0; i < N; ++i) lp_[i] = 0.0f;
        energy_ = 0.0f;
        sleeping_ = true;
    }

    void set(const RoomParams& p) noexcept {
        params_ = p;
        const float size = std::clamp(p.size, 0.0f, 1.0f);
        const float scale = 0.5f + (kMaxScale - 0.5f) * size;
        const float rt60 = p.decay > 0.0f ? p.decay : 0.3f * std::pow(4.0f / 0.3f, size);
        const float fc = 16000.0f * std::exp2(-5.0f * std::clamp(p.damping, 0.0f, 1.0f)) / (1.0f + size);
        damp_ = (float)std::exp(-6.28318530717958647692 * std::min((double)fc, 0.45 * sr_) / sr_);
        for (int i = 0; i < N; ++i) {
            target_[i] = (float)(kBaseMs[i] * scale * 0.001 * sr_);
            gain_[i] = (float)std::pow(10.0, -3.0 * target_[i] / (rt60 * sr_));
        }
        amount_ = std::clamp(p.amount, 0.0f, 1.0f);
    }

    /// One stereo sample in; the wet room (× amount) out. Add the dry
    /// signal yourself.
    Out process(float inL, float inR) noexcept {
        if (!(amount_ > 0.0f)) inL = inR = 0.0f;  // bypassed: let the tail die, then sleep
        const bool silentIn = std::fabs(inL) + std::fabs(inR) < 1e-9f;
        if (sleeping_) {
            if (silentIn) return {0.0f, 0.0f};
            sleeping_ = false;
        }
        // Read every line (fractional, smoothed lengths; two modulated).
        float x[N];
        for (int i = 0; i < N; ++i) {
            len_[i] = target_[i] + lenSmooth_ * (len_[i] - target_[i]);
            float d = len_[i];
            if (i < 2) {
                lfoPhase_[i] += lfoInc_[i];
                if (lfoPhase_[i] >= 1.0) lfoPhase_[i] -= 1.0;
                d += (float)(kModMs * 0.001 * sr_ * std::sin(6.28318530717958647692 * lfoPhase_[i]));
            }
            x[i] = readLinear(i, d);
        }
        // Damping and decay.
        for (int i = 0; i < N; ++i) {
            lp_[i] = (1.0f - damp_) * x[i] + damp_ * lp_[i];
            x[i] = lp_[i] * gain_[i];
        }
        // Outputs: alternate lines to the two sides, plus early reflections.
        float l = 0.0f, r = 0.0f;
        for (int i = 0; i < N; i += 2) {
            l += x[i] * ((i & 2) ? -1.0f : 1.0f);
            r += x[i + 1] * ((i & 2) ? -1.0f : 1.0f);
        }
        const float er = 0.35f;
        l += er * readLinear(1, 0.31f * len_[1]);
        r += er * readLinear(0, 0.43f * len_[0]);
        // Householder mix: y = x − (2/N) Σx; then inject the input.
        float sum = 0.0f;
        for (int i = 0; i < N; ++i) sum += x[i];
        sum *= 2.0f / (float)N;
        float e = 0.0f;
        for (int i = 0; i < N; ++i) {
            float y = x[i] - sum + kInGain * ((i & 1) ? inR : inL) * ((i & 2) ? -1.0f : 1.0f);
            if (std::fabs(y) < 1e-20f) y = 0.0f;
            lines_[(size_t)i][pos_] = y;
            e += y * y;
        }
        pos_ = (pos_ + 1) & mask_;
        // Sleep once the tail is below −90 dB and nothing comes in.
        energy_ = e + kEnergyLeak * (energy_ - e);
        if (silentIn && energy_ < 1e-9f) {
            reset();
            return {0.0f, 0.0f};
        }
        const float outGain = amount_ * kOutGain;
        return {l * outGain, r * outGain};
    }

    bool sleeping() const noexcept { return sleeping_; }

private:
    static constexpr float kMaxScale = 2.5f;
    static constexpr double kModMs = 0.3;
    static constexpr float kInGain = 0.5f;
    static constexpr float kOutGain = 2.0f / (float)N;
    static constexpr float kEnergyLeak = 0.999f;
    // Mutually prime-ish lengths between 13 and 41 ms.
    static constexpr double kBaseMs[8] = {13.0, N == 4 ? 19.7 : 16.9, N == 4 ? 29.3 : 20.3, N == 4 ? 41.0 : 23.9,
                                          27.7, 31.3, 36.1, 41.0};

    float readLinear(int line, float d) const noexcept {
        d = std::max(d, 1.0f);
        const int i = (int)d;
        const float t = d - (float)i;
        const auto& b = lines_[(size_t)line];
        const float a = b[(pos_ - (size_t)i) & mask_], c = b[(pos_ - (size_t)i - 1) & mask_];
        return a + t * (c - a);
    }

    double sr_ = 48000.0;
    RoomParams params_;
    std::array<std::vector<float>, N> lines_;
    size_t mask_ = 0, pos_ = 0;
    float len_[N] = {}, target_[N] = {}, gain_[N] = {}, lp_[N] = {};
    float damp_ = 0.5f, amount_ = 0.0f, lenSmooth_ = 0.999f, energy_ = 0.0f;
    double lfoPhase_[2] = {}, lfoInc_[2] = {};
    bool sleeping_ = true;
};

}  // namespace bleep::dsp
