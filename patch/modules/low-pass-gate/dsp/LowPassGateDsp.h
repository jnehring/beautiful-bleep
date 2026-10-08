// SPDX-License-Identifier: MIT
// Low Pass Gate DSP (specs/modules/low-pass-gate.md): a modelled vactrol cell
// (dsp::Vactrol) opened by light (Level + CV + Ping flashes) drives a stereo
// filter + VCA (dsp::LowPassGate). Drive saturates the input with
// first-order antiderivative anti-aliasing (ADAA): far cheaper than
// oversampling and without latency. A mode change dips the output for 5 ms
// so it never clicks.
#pragma once

#include "dsp/Drums.h"
#include "dsp/Vactrol.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

struct LowPassGateParams {
    float level = 0.0f;       ///< constant light 0..1
    float response = 0.5f;    ///< 0..1 → time scale 0.25× … 4×
    float ping = 0.8f;        ///< flash height per Ping pulse
    float resonance = 0.0f;   ///< 0..1
    float brightness = 0.75f; ///< 0..1 → 1 kHz … 20 kHz when open
    float drive = 0.0f;       ///< 0..1
    float bleed = 0.0f;       ///< 0..1
    int mode = 2;             ///< LP, VCA, Both
    int cell = 1;             ///< Fast, Classic, Slow memory
};

class LowPassGateDsp {
public:
    struct Frame {
        float l, r, light;
        bool active;
    };

    static constexpr float kFlashSeconds = 0.002f;
    static constexpr float kActiveFloor = 1e-4f;  // −80 dB
    static constexpr float kActiveHold = 0.05f;   // output below the floor this long → inactive

    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        cell_.prepare(sampleRate);
        gate_.prepare(sampleRate);
        flashLen_ = std::max(1, (int)std::lround(kFlashSeconds * sampleRate));
        holdLen_ = (int)(kActiveHold * sampleRate);
        dipLen_ = std::max(1, (int)(0.0025 * sampleRate));  // 2.5 ms down, 2.5 ms up
        driveHold_ = (int)(0.1 * sampleRate);
        xfadeLen_ = std::max(1, (int)(0.005 * sampleRate));
        lastResponse_ = -1.0f;
        lastCell_ = -1;
        mode_ = -1;
        reset();
    }
    void reset() noexcept {
        cell_.reset();
        gate_.reset();
        for (auto& a : adaa_) a = {};
        flashLeft_ = 0;
        flashLevel_ = 0.0f;
        hold_ = 0;
        dip_ = 0;
        driveOn_ = false;
        driveIdle_ = 0;
        driveMix_ = 0.0f;
        lightIn_ = 0.0f;
    }

    /// A Ping pulse: a 2 ms flash of `height` (Ping × Velocity). A flash on a
    /// running one keeps the brighter height and restarts the 2 ms.
    void ping(float height) noexcept {
        flashLevel_ = flashLeft_ > 0 ? std::max(flashLevel_, height) : height;
        flashLeft_ = flashLen_;
    }

    /// Once per sub-block (cheap when nothing changed).
    void set(const LowPassGateParams& p) noexcept {
        const float resp = std::clamp(p.response, 0.0f, 1.0f);
        if (dsp::differs(resp, lastResponse_)) {
            lastResponse_ = resp;
            cell_.setResponse(dsp::Vactrol::responseScale(resp));
        }
        if (p.cell != lastCell_) {
            lastCell_ = p.cell;
            cell_.setCell((dsp::VactrolCell)std::clamp(p.cell, 0, 2));
        }
        const int mode = std::clamp(p.mode, 0, 2);
        if (mode_ < 0) mode_ = pendingMode_ = mode;
        else if (mode != pendingMode_) {
            pendingMode_ = mode;
            if (dip_ == 0) dip_ = 2 * dipLen_;  // fade out, switch at the bottom, fade in
        }
        gp_.mode = (dsp::LpgMode)mode_;
        gp_.resonance = p.resonance;
        gp_.maxHz = 1000.0f * std::pow(20.0f, std::clamp(p.brightness, 0.0f, 1.0f));
        gp_.bleed = p.bleed;
        gate_.set(gp_);
        level_ = p.level;
        pingHeight_ = p.ping;
        drive_ = std::clamp(p.drive, 0.0f, 1.0f);
        if (drive_ > 0.0f) {
            driveG_ = 1.0 + 8.0 * (double)drive_;
            driveT_ = std::tanh(driveG_);
        }
        if (drive_ > 0.0f) {
            driveOn_ = true;
            driveIdle_ = 0;
        }
    }

    float pingHeight() const noexcept { return pingHeight_; }

    /// One stereo sample. cv: the CV input (0 when unpatched).
    Frame tick(float inL, float inR, float cv) noexcept {
        // Light: Level + CV clipped to 0..1, plus the flash; the sum up to 1.2.
        float L = std::clamp(level_ + cv, 0.0f, 1.0f);
        if (flashLeft_ > 0) {
            L += flashLevel_;
            --flashLeft_;
        }
        L = std::clamp(L, 0.0f, 1.2f);
        lightIn_ = L;
        const float c = cell_.process(L);

        // Drive: anti-aliased soft saturation, crossfaded in and out so
        // engaging it (and its half-sample delay) never clicks.
        if (driveOn_) {
            float l = inL, r = inR;
            if (!std::isfinite(l)) l = 0.0f;
            if (!std::isfinite(r)) r = 0.0f;
            const float sl = saturate(adaa_[0], l), sr = saturate(adaa_[1], r);
            const float target = drive_ > 0.0f ? 1.0f : 0.0f;
            driveMix_ += std::clamp(target - driveMix_, -1.0f / (float)xfadeLen_, 1.0f / (float)xfadeLen_);
            inL = inL + driveMix_ * (sl - inL);
            inR = inR + driveMix_ * (sr - inR);
            if (drive_ <= 0.0f && driveMix_ <= 0.0f && ++driveIdle_ > driveHold_) driveOn_ = false;
        }

        float l = inL, r = inR;
        if (c <= 0.0f && gp_.mode != dsp::LpgMode::LP && !(gp_.bleed > 0.0f)) {
            // Closed and silent: skip the filter (its state was cleared).
            l = r = 0.0f;
            if (!closed_) gate_.reset();
            closed_ = true;
        } else {
            gate_.process(l, r, c);
            closed_ = false;
        }

        if (dip_ > 0) {
            --dip_;
            if (dip_ == dipLen_) {
                mode_ = pendingMode_;
                gp_.mode = (dsp::LpgMode)mode_;
                gate_.set(gp_);
            }
            const float g = (float)std::abs(dip_ - dipLen_) / (float)dipLen_;
            l *= g;
            r *= g;
        }

        // Active: the cell is open or the output is still audible (held 50 ms).
        const bool loud = std::fabs(l) > kActiveFloor || std::fabs(r) > kActiveFloor;
        if (c > 0.001f || loud || flashLeft_ > 0) hold_ = holdLen_;
        else if (hold_ > 0) --hold_;
        return {l, r, std::min(c, 1.2f), hold_ > 0};
    }

    float openness() const noexcept { return cell_.value(); }
    float light() const noexcept { return lightIn_; }
    float cutoffHz() const noexcept { return gp_.mode == dsp::LpgMode::VCA ? 0.0f : gate_.cutoffHz(cell_.value()); }
    float gain() const noexcept { return gate_.gain(cell_.value()); }
    /// The drive's saturator is running.
    bool driving() const noexcept { return driveOn_; }

private:
    /// Antiderivative of the drive curve tanh(g x) / tanh(g):
    /// log cosh(g x) / (g tanh g), written to avoid overflow.
    static double driveIntegral(double x, double g, double norm) noexcept {
        const double a = std::fabs(g * x);
        return (a + std::log1p(std::exp(-2.0 * a)) - 0.6931471805599453) * norm;
    }
    struct Adaa {
        double x = 0.0, F = 0.0, g = 0.0;
    };
    /// First-order ADAA of dsp::softClip(x, drive): the average of the curve
    /// between the last two samples, (F(x) − F(x₁)) / (x − x₁).
    float saturate(Adaa& s, float xin) noexcept {
        const double g = driveG_, t = driveT_;
        const double x = xin;
        const double norm = 1.0 / (g * t);
        if (g < s.g || g > s.g) {  // the curve changed: F(x₁) on the new curve
            s.F = driveIntegral(s.x, g, norm);
            s.g = g;
        }
        const double F = driveIntegral(x, g, norm);
        const double dx = x - s.x;
        double y;
        if (std::fabs(dx) > 1e-5) y = (F - s.F) / dx;
        else y = std::tanh(g * 0.5 * (x + s.x)) / t;
        s.x = x;
        s.F = F;
        return (float)y;
    }

    double sr_ = 48000.0;
    dsp::Vactrol cell_;
    dsp::LowPassGate gate_;
    dsp::LowPassGate::Params gp_;
    Adaa adaa_[2];
    double driveG_ = 1.0, driveT_ = 0.7615941559557649;
    float level_ = 0.0f, pingHeight_ = 0.8f, drive_ = 0.0f, lastResponse_ = -1.0f;
    int lastCell_ = -1, mode_ = -1, pendingMode_ = 2;
    int flashLen_ = 96, flashLeft_ = 0;
    float flashLevel_ = 0.0f, lightIn_ = 0.0f;
    int holdLen_ = 2400, hold_ = 0;
    int dipLen_ = 120, dip_ = 0;
    bool driveOn_ = false, closed_ = false;
    int driveIdle_ = 0, driveHold_ = 4800, xfadeLen_ = 240;
    float driveMix_ = 0.0f;
};

}  // namespace bleep::patch
