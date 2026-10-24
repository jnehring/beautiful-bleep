// SPDX-License-Identifier: GPL-3.0-only
// Spatial Pan (doc/specs/modules/spatial-pan.md): a source placed around the
// head, rendered for headphones from synthesised cues only (no measured data):
//   * interaural time difference: a spherical-head path-length formula
//   * head shadow: a first-order pole/zero shelf per ear whose gain follows the
//     angle between the source and that ear's axis
//   * elevation: a movable pinna notch; the rear: a high-frequency roll-off
//   * distance: level, air absorption, and propagation delay (Doppler when it moves)
//   * six early reflections panned around the source
#pragma once

#include "dsp/Delay.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::patch {

struct SpatialParams {
    float azimuth = 0.0f;     ///< degrees: 0 front, +90 right, ±180 behind
    float elevation = 0.0f;   ///< degrees: −90 … +90
    float distance = 1.25f;   ///< metres
    float doppler = 1.0f;     ///< 0…1: how much of the propagation delay is applied (moving distance bends pitch)
    float room = 0.3f;        ///< 0…1: early reflections level
    float size = 0.5f;        ///< 0…1: early reflection spacing
    float headCm = 8.75f;     ///< head radius
    float air = 0.5f;         ///< 0…1: high-frequency loss with distance
};

struct SpatialFrame {
    float l = 0.0f, r = 0.0f;
    float side = 0.0f;  ///< −1 (left) … +1 (right): lateral position of the source
};

class SpatialDsp {
public:
    static constexpr double kSoundSpeed = 343.0;

    void prepare(double sampleRate) {
        sampleRate_ = sampleRate;
        line_.resize((int)(0.3 * sampleRate));
        reset();
    }
    void reset() noexcept {
        line_.clear();
        for (auto& e : ear_) e = {};
        rear_ = {};
        distLp_ = {};
        erLp_ = erL1_ = erR1_ = 0.0f;
        smooth_ = false;
        counter_ = 0;
    }

    SpatialFrame tick(float in, const SpatialParams& p) noexcept {
        // ---- slow parameters (control rate, every 16 samples)
        if ((counter_++ & 15) == 0 || !smooth_) updateControl(p);
        // fast one-pole glides of the delays: 4 ms
        const double g = 1.0 - std::exp(-1.0 / (sampleRate_ * 0.004));
        for (int e = 0; e < 2; ++e) delayNow_[(size_t)e] += g * (delayTarget_[(size_t)e] - delayNow_[(size_t)e]);
        gainNow_ += (float)g * (gainTarget_ - gainNow_);
        // ---- source: rear roll-off, then into the line
        rear_.cutoff(rearHz_, sampleRate_);
        const float src = rear_.low(in);
        line_.write(src);
        float out[2];
        for (int e = 0; e < 2; ++e) {
            float v = line_.readHermite(std::max(2.0, delayNow_[(size_t)e]));
            v = ear_[(size_t)e].shadow.run(v);
            v = ear_[(size_t)e].notch.run(v);
            out[e] = v;
        }
        // distance: level and air absorption on the direct sound
        distLp_.cutoff(airHz_, sampleRate_);
        const float l0 = distLp_.low(out[0]) * gainNow_, r0 = distLp_.lowR(out[1]) * gainNow_;
        // ---- early reflections from the same line
        float er = 0.0f, erL = 0.0f, erR = 0.0f;
        for (int k = 0; k < kTaps; ++k) {
            const float t = line_.readHermite(std::max(2.0, tapDelay_[(size_t)k]));
            erL += t * tapGainL_[(size_t)k];
            erR += t * tapGainR_[(size_t)k];
            er += t;
        }
        (void)er;
        erLp_ += 0.45f * ((erL + erR) * 0.5f - erLp_);
        const float lpL = erL, lpR = erR;
        erL1_ += 0.45f * (lpL - erL1_);
        erR1_ += 0.45f * (lpR - erR1_);
        SpatialFrame fr;
        fr.l = l0 + erL1_ * erGain_;
        fr.r = r0 + erR1_ * erGain_;
        fr.side = lateral_;
        return fr;
    }

private:
    static constexpr int kTaps = 6;

    /// One-pole low-pass with its own state (two states for the L/R use in distLp_).
    struct OnePole {
        float z = 0.0f, zr = 0.0f, a = 1.0f;
        void cutoff(float hz, double sr) noexcept { a = 1.0f - std::exp(-6.283185307f * std::min(hz, (float)sr * 0.45f) / (float)sr); }
        float low(float x) noexcept { z += a * (x - z); return z; }
        float lowR(float x) noexcept { zr += a * (x - zr); return zr; }
    };
    /// First-order pole/zero shelf for the head shadow: H(s) = (1 + α·s·τ) / (1 + s·τ).
    struct Shadow {
        float b0 = 1, b1 = 0, a1 = 0, x1 = 0, y1 = 0;
        void set(double alpha, double tau, double sr) noexcept {
            const double K = 2.0 * sr, k = K * tau;
            const double d = 1.0 + k;
            b0 = (float)((1.0 + alpha * k) / d);
            b1 = (float)((1.0 - alpha * k) / d);
            a1 = (float)((1.0 - k) / d);
        }
        float run(float x) noexcept {
            const float y = b0 * x + b1 * x1 - a1 * y1;
            x1 = x, y1 = y;
            return y;
        }
    };
    /// RBJ peaking filter (negative gain = a notch).
    struct Peak {
        float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        void set(double f, double q, double gainDb, double sr) noexcept {
            const double A = std::pow(10.0, gainDb / 40.0), w = 6.283185307179586 * std::min(f, sr * 0.45) / sr;
            const double al = std::sin(w) / (2.0 * q), cw = std::cos(w);
            const double a0 = 1.0 + al / A;
            b0 = (float)((1.0 + al * A) / a0);
            b1 = (float)(-2.0 * cw / a0);
            b2 = (float)((1.0 - al * A) / a0);
            a1 = (float)(-2.0 * cw / a0);
            a2 = (float)((1.0 - al / A) / a0);
        }
        float run(float x) noexcept {
            const float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1, x1 = x, y2 = y1, y1 = y;
            return y;
        }
    };
    struct Ear {
        Shadow shadow;
        Peak notch;
    };

    void updateControl(const SpatialParams& p) noexcept {
        constexpr double pi = 3.141592653589793, rad = pi / 180.0;
        const double az = (double)p.azimuth * rad, el = std::clamp((double)p.elevation, -90.0, 90.0) * rad;
        const double sinAz = std::sin(az), cosAz = std::cos(az), cosEl = std::cos(el), sinEl = std::sin(el);
        const double lat = std::clamp(sinAz * cosEl, -1.0, 1.0);  // right-ear axis · source direction
        lateral_ = (float)lat;
        const double a = std::clamp((double)p.headCm, 5.0, 14.0) * 0.01;
        // ITD: (a / c)(θ + sin θ) with θ the lateral angle; the far ear is the later one.
        const double theta = std::asin(std::fabs(lat));
        const double itd = a / kSoundSpeed * (theta + std::sin(theta));
        const double dist = std::clamp((double)p.distance, 0.1, 40.0);
        const double prop = (double)p.doppler * dist / kSoundSpeed;  // seconds
        const double base = 3.0;                                    // samples of guard
        delayTarget_[0] = base + (prop + (lat > 0.0 ? itd : 0.0)) * sampleRate_;  // left: far when the source is on the right
        delayTarget_[1] = base + (prop + (lat < 0.0 ? itd : 0.0)) * sampleRate_;
        if (!smooth_) {
            delayNow_ = delayTarget_;
        }
        // Head shadow per ear: α = 1.05 + 0.95 cos(θ_ear · 180/150), θ_ear the angle between source and ear axis.
        const double tau = a / (2.0 * kSoundSpeed);
        for (int e = 0; e < 2; ++e) {
            const double c = e == 1 ? lat : -lat;  // cosine of the incidence angle at this ear
            const double thetaEar = std::acos(std::clamp(c, -1.0, 1.0));
            const double alpha = 1.05 + 0.95 * std::cos(thetaEar * (180.0 / 150.0));
            ear_[(size_t)e].shadow.set(alpha, tau, sampleRate_);
            // Pinna notch: moves up with elevation, deepens away from the horizon.
            const double nf = 7500.0 + 2500.0 * sinEl;
            ear_[(size_t)e].notch.set(nf, 2.5, -(2.0 + 7.0 * std::fabs(sinEl)), sampleRate_);
        }
        // The rear: high-frequency roll-off on the source.
        const double rearAmount = std::max(0.0, -cosAz * cosEl);
        rearHz_ = (float)(16000.0 - 10500.0 * rearAmount);
        // Distance: level, air.
        const double gd = 1.0 / (1.0 + 1.5 * std::max(0.0, dist - 0.25));
        gainTarget_ = (float)gd;
        airHz_ = (float)(20000.0 / (1.0 + (double)p.air * 0.7 * std::max(0.0, dist - 0.25)));
        // Early reflections: six images around the source.
        static constexpr double ms[kTaps] = {6.1, 9.7, 13.3, 17.9, 24.1, 31.7};
        static constexpr double offsets[kTaps] = {-70.0, 60.0, -130.0, 140.0, -25.0, 30.0};
        static constexpr double gains[kTaps] = {0.5, 0.42, 0.36, 0.3, 0.24, 0.18};
        const double scale = 0.6 + 1.0 * (double)std::clamp(p.size, 0.0f, 1.0f);
        for (int k = 0; k < kTaps; ++k) {
            tapDelay_[(size_t)k] = base + (ms[k] * 0.001 * scale + 0.5 * prop) * sampleRate_;
            const double x = std::sin((offsets[k] + 0.5 * (double)p.azimuth) * rad);
            const double ang = (x + 1.0) * pi / 4.0;
            tapGainL_[(size_t)k] = (float)(std::cos(ang) * gains[k]);
            tapGainR_[(size_t)k] = (float)(std::sin(ang) * gains[k]);
        }
        erGain_ = (float)((double)std::clamp(p.room, 0.0f, 1.0f) * (0.35 + 0.65 * std::sqrt(gd)) * 1.2);
        if (!smooth_) {
            gainNow_ = gainTarget_;
            smooth_ = true;
        }
    }

    double sampleRate_ = 48000.0;
    dsp::RingDelay line_;
    std::array<Ear, 2> ear_{};
    OnePole rear_, distLp_;
    std::array<double, 2> delayNow_{3.0, 3.0}, delayTarget_{3.0, 3.0};
    std::array<double, kTaps> tapDelay_{};
    std::array<float, kTaps> tapGainL_{}, tapGainR_{};
    float gainNow_ = 1.0f, gainTarget_ = 1.0f, rearHz_ = 16000.0f, airHz_ = 20000.0f, erGain_ = 0.0f, erLp_ = 0.0f, erL1_ = 0.0f, erR1_ = 0.0f;
    float lateral_ = 0.0f;
    bool smooth_ = false;
    uint32_t counter_ = 0;
};

}  // namespace bleep::patch
