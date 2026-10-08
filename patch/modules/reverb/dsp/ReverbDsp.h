// SPDX-License-Identifier: MIT
// Verb (specs/modules/reverb.md): the shared FDN tank (dsp/Fdn.h: pre-delay,
// input diffuser, 8 or 16 lines, per-band decay, freeze, infinite decay)
// plus what makes it a module: the Decay knob's mapping with its infinite
// region, Tone (tilt EQ), Width (mid/side), equal-power Mix, the wet
// envelope, and click-free Clear / Quality / Seed changes (the wet path fades
// out over 10 ms, the change happens in silence, and it fades back in).
#pragma once

#include "dsp/Fdn.h"
#include "dsp/Smoothing.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

namespace bleep::patch {

struct ReverbParams {
    float size = 0.5f;          ///< 0 … 1
    float decay = 0.463f;       ///< the Decay knob, normalised (see ReverbDsp::t60)
    double preDelaySamples = 960.0;
    float diffusion = 0.7f, damping = 0.4f;
    float bass = 1.0f;          ///< low T60 × 0.5 … 2
    float modRate = 0.6f;       ///< Hz
    float modDepth = 0.25f;     ///< 0 … 1
    float tone = 0.0f;          ///< −1 dark … +1 bright
    float width = 1.0f;         ///< 0 … 1.5
    float mix = 0.35f;          ///< dry/wet, equal power
    bool freeze = false;
};

struct ReverbFrame {
    float in[2] = {0.0f, 0.0f};
    float out[2] = {0.0f, 0.0f}, wet[2] = {0.0f, 0.0f};
    float env = 0.0f;
};

class ReverbDsp {
public:
    static constexpr float kLimitFrom = 0.92f;     ///< the soft limiter engages, T60 leaves 60 s
    static constexpr float kInfiniteFrom = 0.96f;  ///< lossless loop
    static constexpr double kMinT60 = 0.1, kMaxT60 = 60.0;
    /// The knob's top in seconds if the exponential went on (what the knob shows at 100 %).
    static double knobTopSeconds() noexcept { return kMinT60 * std::pow(kMaxT60 / kMinT60, 1.0 / kLimitFrom); }

    /// Mid-band T60 for a normalised Decay knob: 0.1 s … 60 s exponentially
    /// up to 92 %, then towards lossless (60 s / (1 − t)) until 96 %, where
    /// the loop becomes exactly lossless (+∞, returned as infinity).
    static double t60(float knob) noexcept {
        const double x = std::clamp((double)knob, 0.0, 1.0);
        if (x <= kLimitFrom) return kMinT60 * std::pow(kMaxT60 / kMinT60, x / kLimitFrom);
        if (x >= kInfiniteFrom) return std::numeric_limits<double>::infinity();
        const double t = (x - kLimitFrom) / (kInfiniteFrom - kLimitFrom);
        return kMaxT60 / (1.0 - t);
    }

    void prepare(double sampleRate, int lines = 16, uint64_t seed = 1) {
        sr_ = sampleRate;
        lines_ = lines <= 8 ? 8 : 16;
        seed_ = seed;
        fdn_.prepare(sampleRate, lines_, 1.0, seed);
        env_.prepare(sampleRate, 0.005f, 0.2f);
        toneCoef_ = (float)(std::tan(3.14159265358979323846 * 800.0 / sampleRate));
        toneCoef_ = toneCoef_ / (1.0f + toneCoef_);
        fadeStep_ = (float)(1.0 / (0.01 * sampleRate));
        peakRelease_ = (float)std::exp(-1.0 / (0.5 * sampleRate));
        clearNow();
    }

    /// Empties everything at once (Clear on Play: renders become repeatable).
    void clearNow() noexcept {
        fdn_.setLineCount(lines_);  // also clears
        fdn_.setSeed(seed_);        // restarts the modulation from the seed
        toneZ_[0] = toneZ_[1] = 0.0f;
        env_.reset();
        peak_ = 0.0f;
        hot_ = false;
        fade_ = 1.0f;
        fadeDir_ = 0;
        pendingClear_ = false;
        countdown_ = 0;
        wantLines_ = lines_;
        wantSeed_ = seed_;
    }
    /// Clear trigger / button: 10 ms fade-out, clear, fade back in.
    void clear() noexcept {
        pendingClear_ = true;
        fadeDir_ = -1;
    }
    /// Quality (8 or 16 lines) and Seed changes go through the same fade.
    void setLines(int lines) noexcept {
        wantLines_ = lines <= 8 ? 8 : 16;
        if (wantLines_ != lines_) fadeDir_ = -1;
    }
    void setSeed(uint64_t seed) noexcept {
        wantSeed_ = seed;
        if (wantSeed_ != seed_) fadeDir_ = -1;
    }
    /// Internal LFOs back to their seeded start (transport start).
    void restartModulation() noexcept { fdn_.restartModulation(); }

    bool infinite(float knob) const noexcept { return knob >= kInfiniteFrom; }
    /// True when the next tick() reads the slow params (all but size,
    /// preDelaySamples and freeze): callers may skip filling them in between.
    bool controlDue() const noexcept { return countdown_ <= 1; }

    void tick(const ReverbParams& p, ReverbFrame& f) noexcept {
        if (--countdown_ <= 0) control(p);

        // Fades for Clear, Quality and Seed: the change happens at silence.
        if (fadeDir_ < 0) {
            fade_ -= fadeStep_;
            if (fade_ <= 0.0f) {
                fade_ = 0.0f;
                fadeDir_ = 1;
                if (pendingClear_ || wantLines_ != lines_) {
                    lines_ = wantLines_;
                    fdn_.setLineCount(lines_);
                    toneZ_[0] = toneZ_[1] = 0.0f;
                    pendingClear_ = false;
                }
                if (wantSeed_ != seed_) {
                    seed_ = wantSeed_;
                    fdn_.setSeed(seed_);
                }
            }
        } else if (fadeDir_ > 0) {
            fade_ += fadeStep_;
            if (fade_ >= 1.0f) {
                fade_ = 1.0f;
                fadeDir_ = 0;
            }
        }

        dsp::FdnParams fp;
        fp.size = p.size;
        // The ∞ region runs the loop with gains of 1 − 1e−10 or so (T60 1e9 s),
        // not the tank's own `infinite` mode: that keeps its soft limiter on at
        // all levels, and the limiter's gentle compression drains a moderate
        // pad by several dB a minute. Here the limiter only engages while the
        // tank is hot (wet peak above −6 dBFS, off again below −9 dBFS), which
        // is what bounds a loop that keeps receiving input.
        fp.infinite = false;
        fp.decay = decaySeconds_;
        fp.limit = p.decay > kLimitFrom && hot_;
        fp.freeze = p.freeze;
        fp.damping = p.damping;
        fp.bass = p.bass;
        fp.diffusion = p.diffusion;
        fp.modRate = p.modRate;
        fp.modDepth = p.modDepth;
        fp.preDelaySamples = p.preDelaySamples;
        float wl, wr;
        fdn_.process(f.in[0], f.in[1], wl, wr, fp);
        const float level = std::max(std::fabs(wl), std::fabs(wr));
        peak_ = std::max(level, peak_ * peakRelease_);
        hot_ = hot_ ? peak_ > 0.35f : peak_ > 0.5f;

        // Tone: tilt around 800 Hz (TPT one-pole split into low and high).
        float w[2] = {wl, wr};
        for (int c = 0; c < 2; ++c) {
            const float v = (w[c] - toneZ_[c]) * toneCoef_;
            const float lp = v + toneZ_[c];
            toneZ_[c] = lp + v;
            w[c] = toneLow_ * lp + toneHigh_ * (w[c] - lp);
        }
        // Width (mid/side), then the fade.
        const float mid = 0.5f * (w[0] + w[1]), side = 0.5f * (w[0] - w[1]) * width_;
        f.wet[0] = (mid + side) * fade_;
        f.wet[1] = (mid - side) * fade_;
        for (int c = 0; c < 2; ++c) f.out[c] = dryGain_ * f.in[c] + wetGain_ * f.wet[c];
        f.env = std::min(1.0f, 2.0f * env_.process(0.5f * (f.wet[0] + f.wet[1])));
    }

private:
    // Tone, Width and Mix gains every 8 samples (steps far below audibility).
    void control(const ReverbParams& p) noexcept {
        countdown_ = 8;
        decaySeconds_ = (float)std::min(t60(p.decay), 1e9);
        const float tone = std::clamp(p.tone, -1.0f, 1.0f);
        toneHigh_ = std::pow(10.0f, 0.3f * tone);  // ±6 dB
        toneLow_ = 1.0f / toneHigh_;
        width_ = std::clamp(p.width, 0.0f, 1.5f);
        const float m = std::clamp(p.mix, 0.0f, 1.0f) * 1.5707963f;
        dryGain_ = std::cos(m);
        wetGain_ = std::sin(m);
    }

    double sr_ = 48000.0;
    dsp::Fdn fdn_;
    dsp::EnvelopeFollower env_;
    uint64_t seed_ = 1, wantSeed_ = 1;
    int lines_ = 16, wantLines_ = 16, countdown_ = 0, fadeDir_ = 0;
    bool pendingClear_ = false, hot_ = false;
    float peak_ = 0.0f, peakRelease_ = 0.9999f;
    float toneZ_[2] = {0.0f, 0.0f};
    float toneCoef_ = 0.05f, toneLow_ = 1.0f, toneHigh_ = 1.0f, width_ = 1.0f, dryGain_ = 1.0f, wetGain_ = 0.0f;
    float fade_ = 1.0f, fadeStep_ = 0.002f, decaySeconds_ = 2.5f;
};

}  // namespace bleep::patch
