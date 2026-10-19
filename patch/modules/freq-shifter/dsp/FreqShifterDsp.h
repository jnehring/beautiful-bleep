// SPDX-License-Identifier: GPL-3.0-or-later
// Freq Shifter (doc/specs/modules/frequency-shifter.md): single-sideband
// frequency shifting per channel with a Hilbert pair and a quadrature
// oscillator (dsp/Hilbert.h), a feedback loop with its own delay, opposite
// shifts on the two channels (Spread), anti-aliasing and tempo sync.
//
// Per channel and sample:
//
//   in ─► DC block ─► + feedback ─► soft limit ─► [6-pole anti-alias LP] ─► Hilbert ─► I, Q
//   up = I·cos φ − Q·sin φ,  down = I·cos φ + Q·sin φ,  feedback = delayed up
//
// The left phase φ advances by f / fs (or follows the song position when
// synced); the right channel runs at f · (1 − 2·Spread) as an offset from it,
// so it stays continuous whatever Spread does.
#pragma once

#include "dsp/Clip.h"
#include "dsp/Delay.h"
#include "dsp/Hilbert.h"
#include "dsp/Svf.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::patch {

struct FreqShifterParams {
    double shiftHz = 0.0;   ///< signed shift of the left channel (Shift + Fine, or the synced rate)
    float feedback = 0.0f;  ///< −1 … 1
    float fbDelay = 0.0f;   ///< seconds, 0 … 1 (0 = one sample)
    float spread = 0.0f;    ///< 0 … 1: right shift = left · (1 − 2·spread)
    float mix = 1.0f;       ///< dry ↔ up for Out
    bool antiAlias = true;
};

struct FreqShifterFrame {
    float in[2] = {0.0f, 0.0f};
    float out[2] = {0.0f, 0.0f}, up[2] = {0.0f, 0.0f}, down[2] = {0.0f, 0.0f};
    float sin = 0.0f, cos = 1.0f;  ///< the left oscillator
};

class FreqShifterDsp {
public:
    static constexpr double kMaxFbDelaySeconds = 1.0;

    void prepare(double sampleRate) {
        sr_ = sampleRate;
        for (auto& h : hilbert_) h.prepare(sampleRate, 15.0);
        for (auto& l : fbLine_) l.resize((int)std::ceil(kMaxFbDelaySeconds * sampleRate) + 8);
        fbTime_.prepare(sampleRate, 0.05f, 1.0);
        dcR_ = (float)(1.0 - 2.0 * 3.14159265358979323846 * 10.0 / sampleRate);
        rampStep_ = (float)(1.0 / (0.001 * sampleRate));  // 1 ms down, 1 ms up
        reset();
    }

    void reset() noexcept {
        for (auto& h : hilbert_) h.reset();
        for (auto& l : fbLine_) l.clear();
        for (auto& c : ch_) c = {};
        for (auto& f : aa_) f.reset();
        fbTime_.reset(1.0);
        phase_ = offsetR_ = 0.0;
        aaHz_ = -1.0f;
        aaCount_ = 0;
        rampGain_ = 1.0f;
        rampDir_ = 0;
    }

    /// Reset trigger: dips the wet outputs over 1 ms, jumps both phases to 0,
    /// and fades back in over 1 ms (2 ms in all).
    void triggerReset() noexcept { rampDir_ = -1; }
    /// Restarts both oscillators at once (transport start).
    void restartPhase(double cycles = 0.0) noexcept {
        phase_ = cycles - std::floor(cycles);
        offsetR_ = 0.0;
    }
    /// Locks the left phase to an externally derived value (tempo sync).
    void setPhase(double cycles) noexcept { phase_ = cycles - std::floor(cycles); }
    double phaseL() const noexcept { return phase_; }
    double phaseR() const noexcept { return wrap(phase_ + offsetR_); }

    void tick(const FreqShifterParams& p, FreqShifterFrame& f) noexcept {
        // Anti-alias low-pass: 0.42·fs − |f|, never below 1 kHz; updated every 16 samples.
        if (p.antiAlias && --aaCount_ <= 0) {
            aaCount_ = 16;
            const float hz = (float)std::max(1000.0, 0.42 * sr_ - std::fabs(p.shiftHz));
            if (std::fabs(hz - aaHz_) > 1.0f) {
                aaHz_ = hz;
                static constexpr float kButterworthQ[3] = {0.5176381f, 0.7071068f, 1.9318517f};
                for (size_t k = 0; k < aa_.size(); ++k) aa_[k].set(hz, kButterworthQ[k % 3], sr_);
            }
        }
        if (!p.antiAlias) aaCount_ = 0;

        // Reset dip: 1 ms down, phase jump, 1 ms up.
        if (rampDir_ < 0) {
            rampGain_ -= rampStep_;
            if (rampGain_ <= 0.0f) {
                rampGain_ = 0.0f;
                rampDir_ = 1;
                restartPhase();
            }
        } else if (rampDir_ > 0) {
            rampGain_ += rampStep_;
            if (rampGain_ >= 1.0f) {
                rampGain_ = 1.0f;
                rampDir_ = 0;
            }
        }

        float cs[2], sn[2];
        dsp::QuadratureOsc::lookup(phase_, cs[0], sn[0]);
        dsp::QuadratureOsc::lookup(phase_ + offsetR_, cs[1], sn[1]);
        f.cos = cs[0];
        f.sin = sn[0];

        const double delay = fbTime_.process(std::max((double)p.fbDelay * sr_, 1.0));
        const float fbAmount = std::clamp(p.feedback, -1.0f, 1.0f);
        for (int c = 0; c < 2; ++c) {
            Channel& s = ch_[(size_t)c];
            const float x = f.in[c];
            // DC blockers (10 Hz) on the input and in the feedback path.
            const float dc = x - s.inX1 + dcR_ * s.inY1;
            s.inX1 = x;
            s.inY1 = flush(dc);
            const float fbRaw = fbLine_[(size_t)c].readLinear(delay - 1.0);
            const float fb = fbRaw - s.fbX1 + dcR_ * s.fbY1;
            s.fbX1 = fbRaw;
            s.fbY1 = flush(fb);
            // Soft limit: linear up to ±1.2, bounded at ±1.5.
            float u = 1.5f * dsp::softClip((dc + fbAmount * fb) * (1.0f / 1.5f));
            if (p.antiAlias)
                for (size_t k = 0; k < 3; ++k) u = aa_[(size_t)c * 3 + k].process(u).lp;
            float i, q;
            hilbert_[(size_t)c].process(u, i, q);
            const float up = i * cs[c] - q * sn[c];
            const float down = i * cs[c] + q * sn[c];
            fbLine_[(size_t)c].write(up);
            f.up[c] = up * rampGain_;
            f.down[c] = down * rampGain_;
            f.out[c] = x + p.mix * (f.up[c] - x);
        }

        const double inc = p.shiftHz / sr_;
        phase_ = wrap(phase_ + inc);
        offsetR_ = wrap(offsetR_ - 2.0 * (double)std::clamp(p.spread, 0.0f, 1.0f) * inc);
    }

private:
    struct Channel {
        float inX1 = 0.0f, inY1 = 0.0f, fbX1 = 0.0f, fbY1 = 0.0f;
    };
    static double wrap(double x) noexcept { return x - std::floor(x); }
    static float flush(float x) noexcept { return std::fabs(x) < 1e-20f ? 0.0f : x; }

    double sr_ = 48000.0;
    std::array<dsp::HilbertTransformer, 2> hilbert_;
    std::array<dsp::RingDelay, 2> fbLine_;
    std::array<Channel, 2> ch_{};
    std::array<dsp::Svf, 6> aa_{};  ///< 6-pole Butterworth, three sections per channel
    dsp::TapeTime fbTime_;
    double phase_ = 0.0, offsetR_ = 0.0;
    float dcR_ = 0.999f, aaHz_ = -1.0f, rampGain_ = 1.0f, rampStep_ = 0.02f;
    int aaCount_ = 0, rampDir_ = 0;
};

}  // namespace bleep::patch
