// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// A bank of up to 64 ringing modes, the body of the physical models
// (Resonator, Modal Voice, Macro Osc's Modal, Perc Voice). Each mode is a
// complex one-pole (a rotation times a decay, like dsp::Resonator in
// Drums.h): stable for any per-sample change of pitch or decay, exactly in
// tune, and its level doesn't depend on its frequency, so pitch sweeps keep
// the energy. See doc/specs/modules/resonator.md section 4.2.
//
// Usage: prepare(), then set(params) once per sub-block (cheap when only the
// pitch moves; the coefficients can ramp linearly over the block), then
// process(excitation) per sample.
#pragma once

#include "Random.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

namespace modal {

constexpr int kMaxModes = 64;

/// Zeros of the Bessel functions J_m (circular membrane / plate modes),
/// the 64 lowest, divided by the lowest (2.4048).
constexpr float kPlateRatios[kMaxModes] = {
    1.0000f, 1.5933f, 2.1355f, 2.2954f, 2.6531f, 2.9173f, 3.1555f, 3.5001f, 3.5985f, 3.6475f, 4.0589f,
    4.1317f, 4.2304f, 4.6010f, 4.6101f, 4.8319f, 4.9033f, 5.0836f, 5.1308f, 5.4121f, 5.5404f, 5.5531f,
    5.6508f, 5.9765f, 6.0194f, 6.1526f, 6.1631f, 6.2087f, 6.4827f, 6.5286f, 6.6690f, 6.7462f, 6.8490f,
    6.9436f, 7.0707f, 7.1694f, 7.3253f, 7.4024f, 7.4682f, 7.5145f, 7.6045f, 7.6652f, 7.8592f, 7.8925f,
    8.0710f, 8.1314f, 8.1569f, 8.1569f, 8.3143f, 8.4500f, 8.6451f, 8.6522f, 8.6605f, 8.7678f, 8.7811f,
    8.8204f, 8.9992f, 9.1301f, 9.1678f, 9.2200f, 9.2388f, 9.3906f, 9.4643f, 9.5413f};

/// Free-bar modes: measured first five, then ((2k + 1) / 3)².
inline float barRatio(int k) noexcept {
    constexpr float first[5] = {1.0f, 2.756f, 5.404f, 8.933f, 13.34f};
    if (k <= 5) return first[k - 1];
    const float m = (2.0f * (float)k + 1.0f) / 3.0f;
    return m * m;
}

/// Stiff string: k · √(1 + B k²) (divided by r₁ in the tables, so the
/// fundamental stays at f0).
inline float stiffRatio(int k, float b = 0.0004f) noexcept {
    const float kf = (float)k;
    return kf * std::sqrt(1.0f + b * kf * kf);
}

/// Seeded inharmonic (bell-like) set: r₁ = 1, rₖ = rₖ₋₁ · (1.15 + 0.6 u).
inline void bellRatios(uint64_t seed, float* out, int n) noexcept {
    float r = 1.0f;
    for (int k = 1; k <= n; ++k) {
        if (k > 1) r *= 1.15f + 0.6f * (float)uniform01(seed, (uint64_t)k, 1);
        out[k - 1] = r;
    }
}

/// Mode ratios for a structure 0..1: harmonic (0) → stiff string (¼) →
/// free bar (½) → plate (¾) → seeded bell (1), interpolated in
/// log-frequency between neighbours. `stretch` (about ±0.15) raises every
/// ratio to the power 1 + stretch (inharmonic stretch, r₁ stays 1).
/// Ratios are non-decreasing in k for every structure.
inline void structureRatios(float structure, uint64_t seed, float* out, int n, float stretch = 0.0f) noexcept {
    n = std::clamp(n, 0, kMaxModes);
    const float s = std::clamp(structure, 0.0f, 1.0f) * 4.0f;
    const int seg = std::min((int)s, 3);
    const float t = s - (float)seg;
    float bell[kMaxModes];
    if (seg == 3) bellRatios(seed, bell, n);
    auto table = [&](int which, int k) -> float {
        switch (which) {
            case 0: return (float)k;
            case 1: return stiffRatio(k) / stiffRatio(1);
            case 2: return barRatio(k);
            case 3: return kPlateRatios[k - 1];
            default: return bell[k - 1];
        }
    };
    const float e = 1.0f + stretch;
    for (int k = 1; k <= n; ++k) {
        const float a = table(seg, k);
        const float b = table(seg + 1, k);
        float r = t <= 0.0f ? a : std::exp((1.0f - t) * std::log(a) + t * std::log(b));
        if (stretch < 0.0f || stretch > 0.0f) r = std::pow(r, e);
        out[k - 1] = r;
    }
}

}  // namespace modal

struct ModalParams {
    float f0Hz = 261.63f;     ///< fundamental (mode 1)
    float structure = 0.25f;  ///< 0..1, see modal::structureRatios
    float brightness = 0.6f;  ///< 0..1: high-mode level tilt and decay
    float t60 = 1.2f;         ///< seconds, decay of the fundamental
    float position = 0.3f;    ///< 0..1: excitation point (0.5 cancels even modes)
    float stretch = 0.0f;     ///< inharmonic stretch, about −0.15..+0.15
};

class ModalBank {
public:
    /// How the excitation is scaled into each mode.
    enum class Input {
        Struck,    ///< a unit impulse rings mode k at amplitude aₖ (strikes, bows)
        Resonant,  ///< a steady sine in tune with mode k gives amplitude aₖ (filtering audio)
    };
    struct Out {
        float odd;          ///< modes 1, 3, 5, … (includes the fundamental)
        float even;         ///< modes 2, 4, 6, …
        float fundamental;  ///< mode 1 alone, to centre it if wanted
        float mix() const noexcept { return odd + even; }
    };

    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        f0_ = -1.0f;  // force a recompute
        shapeDirty_ = true;
    }
    void reset() noexcept {
        for (int i = 0; i < modal::kMaxModes; ++i) re_[i] = im_[i] = 0.0f;
        velocity_ = 0.0f;
    }

    /// 1..64; 16 / 32 / 64 are the usual quality steps. Cost is linear in the
    /// number of modes below 0.45 × sample rate.
    void setModeCount(int n) noexcept {
        n = std::clamp(n, 1, modal::kMaxModes);
        if (n == count_) return;
        for (int i = n; i < modal::kMaxModes; ++i) {
            re_[i] = im_[i] = 0.0f;
            a_[i] = b_[i] = g_[i] = w_[i] = 0.0f;
            ta_[i] = tb_[i] = tg_[i] = tw_[i] = 0.0f;
            da_[i] = db_[i] = dg_[i] = dw_[i] = 0.0f;
        }
        count_ = n;
        ratioDirty_ = true;
    }
    void setSeed(uint64_t seed) noexcept {
        if (seed == seed_) return;
        seed_ = seed;
        ratioDirty_ = true;
    }
    void setInput(Input mode) noexcept {
        input_ = mode;
    }

    /// New targets. rampSamples > 0 moves the coefficients linearly to them
    /// over that many process() calls (a convex mix of stable poles, so it
    /// stays stable); 0 jumps. Costs one sin/cos per mode when only f0
    /// changes, more when structure / brightness / damping / position do.
    void set(const ModalParams& p, int rampSamples = 0) noexcept {
        if (ratioDirty_ || differs(p.structure, structure_) || differs(p.stretch, stretch_)) {
            structure_ = p.structure;
            stretch_ = p.stretch;
            modal::structureRatios(structure_, seed_, ratio_, count_, stretch_);
            for (int i = 0; i < count_; ++i) logRatio_[i] = std::log(ratio_[i]);
            ratioDirty_ = false;
            shapeDirty_ = true;
        }
        if (shapeDirty_ || differs(p.brightness, bright_) || differs(p.t60, t60_) || differs(p.position, pos_)) {
            bright_ = std::clamp(p.brightness, 0.0f, 1.0f);
            t60_ = std::max(p.t60, 1e-3f);
            pos_ = std::clamp(p.position, 0.0f, 1.0f);
            const float dark = 1.0f - bright_;
            const float pp = 0.02f + 0.96f * pos_;
            for (int i = 0; i < count_; ++i) {
                const float k = (float)(i + 1);
                const float t = t60_ / (1.0f + 0.5f * dark * dark * (ratio_[i] - 1.0f));
                decay_[i] = (float)std::exp(-6.907755278982137 / ((double)t * sr_));
                amp_[i] = std::fabs(std::sin(kPi * k * pp)) * std::exp(-1.5f * dark * logRatio_[i]);
            }
            shapeDirty_ = false;
            f0_ = -1.0f;
        }
        if (differs(p.f0Hz, f0_)) {
            f0_ = p.f0Hz;
            const float nyq = (float)sr_;
            int active = 0;
            for (int i = 0; i < count_; ++i) {
                const float f = f0_ * ratio_[i];
                float ta = 0.0f, tb = 0.0f, tg = 0.0f, tw = 0.0f;
                if (f < 0.45f * nyq && f > 0.0f) {
                    const float fade = std::min(1.0f, (0.45f * nyq - f) / (0.05f * nyq));
                    const float w = 2.0f * kPi * f / nyq;
                    ta = decay_[i] * std::cos(w);
                    tb = decay_[i] * std::sin(w);
                    tw = amp_[i] * fade;
                    tg = tw * 2.0f * (1.0f - decay_[i]);
                    active = i + 1;
                }
                ta_[i] = ta;
                tb_[i] = tb;
                tg_[i] = tg;
                tw_[i] = tw;
            }
            // Ratios are non-decreasing, so modes past `active` are culled.
            const int prev = active_;
            active_ = active;
            loop_ = (std::max(prev, active) + 3) & ~3;
            if (rampSamples <= 0) {
                jumpToTargets();
            } else {
                const float inv = 1.0f / (float)rampSamples;
                for (int i = 0; i < loop_; ++i) {
                    da_[i] = (ta_[i] - a_[i]) * inv;
                    db_[i] = (tb_[i] - b_[i]) * inv;
                    dg_[i] = (tg_[i] - g_[i]) * inv;
                    dw_[i] = (tw_[i] - w_[i]) * inv;
                }
                ramp_ = rampSamples;
            }
        }
    }

    /// One sample. `x` excites every mode at its position weight, scaled
    /// as setInput() says.
    Out process(float x) noexcept {
        return input_ == Input::Struck ? process(x, 0.0f) : process(0.0f, x);
    }
    /// One sample with both kinds of excitation at once (e.g. a mallet or
    /// bow as `struck`, external audio or breath as `resonant`).
    Out process(float struck, float resonant) noexcept {
        float odd = 0.0f, even = 0.0f, vel = 0.0f;
        if (ramp_ > 0) {
            run<true>(struck, resonant, odd, even, vel);
            if (--ramp_ == 0) jumpToTargets();
        } else {
            run<false>(struck, resonant, odd, even, vel);
        }
        velocity_ = vel;
        if (++flush_ >= 64) flushDenormals();
        return {odd, even, im_[0]};
    }

    /// The body's velocity at the excitation point after the last sample
    /// (the modes' in-phase parts weighted by their position gains): the
    /// feedback for a bow or jet, one sample old by the time it's used.
    float velocity() const noexcept { return velocity_; }
    /// Sum of the position gains squared: how strongly one sample of
    /// excitation moves velocity() (for scaling a bow's coupling).
    float admittance() const noexcept {
        float s = 0.0f;
        for (int i = 0; i < active_; ++i) s += tw_[i] * tw_[i];
        return s;
    }

    int modeCount() const noexcept { return count_; }
    /// Modes below 0.45 × sample rate (the ones processed).
    int activeModes() const noexcept { return active_; }
    float ratio(int i) const noexcept { return ratio_[i]; }
    float modeHz(int i) const noexcept { return f0_ * ratio_[i]; }
    /// Position × brightness weight of mode i (0 when culled).
    float modeGain(int i) const noexcept { return tw_[i]; }
    /// Current ringing amplitude of mode i.
    float modeLevel(int i) const noexcept { return std::sqrt(re_[i] * re_[i] + im_[i] * im_[i]); }
    /// Total ringing energy (sum of squared amplitudes), for sleep detection.
    float energy() const noexcept {
        float e = 0.0f;
        for (int i = 0; i < loop_; ++i) e += re_[i] * re_[i] + im_[i] * im_[i];
        return e;
    }

private:
    static constexpr float kPi = 3.14159265358979323846f;
    static bool differs(float a, float b) noexcept { return a < b || a > b; }

    template <bool Ramp>
    void run(float xs, float xr, float& oddOut, float& evenOut, float& velOut) noexcept {
        const int n = loop_;  // a multiple of 4: mode i is odd (k = i + 1) for even i
        // Four independent lanes, so the compiler can keep them in one SIMD register.
        float accY[4] = {}, accV[4] = {};
        for (int i = 0; i < n; i += 4) {
            for (int j = 0; j < 4; ++j) {
                const int m = i + j;
                if constexpr (Ramp) {
                    a_[m] += da_[m];
                    b_[m] += db_[m];
                    g_[m] += dg_[m];
                    w_[m] += dw_[m];
                }
                const float re = a_[m] * re_[m] - b_[m] * im_[m] + w_[m] * xs + g_[m] * xr;
                const float im = b_[m] * re_[m] + a_[m] * im_[m];
                re_[m] = re;
                im_[m] = im;
                accY[j] += im;
                accV[j] += w_[m] * re;
            }
        }
        const float odd = accY[0] + accY[2], even = accY[1] + accY[3];
        const float vel = accV[0] + accV[1] + accV[2] + accV[3];
        oddOut = odd;
        evenOut = even;
        velOut = vel;
    }

    void jumpToTargets() noexcept {
        for (int i = 0; i < modal::kMaxModes; ++i) {
            a_[i] = ta_[i];
            b_[i] = tb_[i];
            g_[i] = tg_[i];
            w_[i] = tw_[i];
        }
        ramp_ = 0;
        for (int i = active_; i < modal::kMaxModes; ++i) re_[i] = im_[i] = 0.0f;
        loop_ = (active_ + 3) & ~3;
    }
    void flushDenormals() noexcept {
        flush_ = 0;
        for (int i = 0; i < loop_; ++i)
            if (std::fabs(re_[i]) + std::fabs(im_[i]) < 1e-15f) re_[i] = im_[i] = 0.0f;
    }

    double sr_ = 48000.0;
    int count_ = 32, active_ = 0, loop_ = 0, ramp_ = 0, flush_ = 0;
    uint64_t seed_ = 1;
    Input input_ = Input::Struck;
    bool ratioDirty_ = true, shapeDirty_ = true;
    float structure_ = -1.0f, stretch_ = 0.0f, bright_ = -1.0f, t60_ = -1.0f, pos_ = -1.0f, f0_ = -1.0f;
    float velocity_ = 0.0f;

    alignas(32) float re_[modal::kMaxModes] = {};
    alignas(32) float im_[modal::kMaxModes] = {};
    alignas(32) float a_[modal::kMaxModes] = {};  // decay · cos
    alignas(32) float b_[modal::kMaxModes] = {};  // decay · sin
    alignas(32) float g_[modal::kMaxModes] = {};  // resonant input gain
    alignas(32) float w_[modal::kMaxModes] = {};  // position weight: struck input gain, velocity pickup
    alignas(32) float da_[modal::kMaxModes] = {};
    alignas(32) float db_[modal::kMaxModes] = {};
    alignas(32) float dg_[modal::kMaxModes] = {};
    alignas(32) float dw_[modal::kMaxModes] = {};
    float ta_[modal::kMaxModes] = {}, tb_[modal::kMaxModes] = {}, tg_[modal::kMaxModes] = {},
          tw_[modal::kMaxModes] = {};
    float ratio_[modal::kMaxModes] = {}, logRatio_[modal::kMaxModes] = {};
    float decay_[modal::kMaxModes] = {}, amp_[modal::kMaxModes] = {};
};

}  // namespace bleep::dsp
