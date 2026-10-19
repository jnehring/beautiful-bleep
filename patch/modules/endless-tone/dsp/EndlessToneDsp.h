// SPDX-License-Identifier: GPL-3.0-or-later
// Endless Tone (doc/specs/modules/endless-tone.md): the rising-for-ever tone
// illusion. N partials sit one octave apart; all of them slide by the same
// amount in log-frequency, and each one's loudness comes from a fixed window
// over the log-frequency axis (a Gaussian times a raised cosine that reaches
// exactly zero at both ends). A partial that leaves the top of the window has
// been silent for a while, and the one that enters at the bottom starts from
// silence, so the glide never ends. When the pattern has moved one octave it
// is the same pattern again: the oscillators' phases are rotated by one place
// at that moment, so nothing clicks.
#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

struct EndlessParams {
    double centreHz = 261.6255653;  ///< centre of the window
    float speed = 0.25f;            ///< octaves per second, signed (+ rises)
    float width = 0.5f;             ///< 0…1: Gaussian width (narrow = a few clear partials, wide = a dense cloud)
    int count = 9;                  ///< 6…12 partials
    float timbre = 0.0f;            ///< 0 sine … 1 saw
    float spread = 0.0f;            ///< 0…1 stereo spread of alternate partials
    float phase = 0.0f;             ///< 0…1 offset into the loop
};

struct EndlessFrame {
    float l = 0.0f, r = 0.0f;
    float loop = 0.0f;  ///< 0…1 ramp, one cycle per octave of travel (falls when the tone falls)
    bool wrap = false;  ///< the pattern completed one octave (at this sample)
};

class EndlessToneDsp {
public:
    static constexpr int kMax = 12;

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        phi_ = 0.0;
        lastFloor_ = 0;
        ctr_ = 0;
        for (int k = 0; k < kMax; ++k) ph_[(size_t)k] = 0.123 * (double)k, amp_[(size_t)k] = 0.0f, dt_[(size_t)k] = 0.0, tgt_[(size_t)k] = 0.0f;
        norm_ = 1.0f;
        lastWidth_ = -1.0f;
        lastCount_ = -1;
    }

    /// The window at log-frequency position `pos` (0…count, octaves from the bottom edge).
    static float window(double pos, int count, float width) noexcept {
        if (pos <= 0.0 || pos >= (double)count) return 0.0f;
        const double sigma = sigmaOf(width, count);
        const double r = pos - 0.5 * count;
        const double hann = std::sin(3.141592653589793 * pos / count);
        return (float)(std::exp(-0.5 * r * r / (sigma * sigma)) * hann * hann);
    }
    static double sigmaOf(float width, int count) noexcept { return 0.6 + (double)std::clamp(width, 0.0f, 1.0f) * 0.35 * count; }

    EndlessFrame tick(const EndlessParams& p) noexcept {
        EndlessFrame fr;
        const int n = std::clamp(p.count, 6, kMax);
        if (n != lastCount_ || std::fabs(p.width - lastWidth_) > 1e-4f) {
            lastCount_ = n, lastWidth_ = p.width;
            float s0 = 0.0f, s5 = 0.0f;
            for (int k = 0; k < n; ++k) s0 += window((double)k, n, p.width), s5 += window((double)k + 0.5, n, p.width);
            norm_ = 0.5f / std::max(0.05f, 0.5f * (s0 + s5));
        }
        // ---- travel: `total` is the pattern's position in octaves; each whole octave moves every partial's identity one slot
        phi_ += (double)p.speed / sampleRate_;
        if (std::fabs(phi_) > 1000.0) {
            const double shift = phi_ > 0 ? 1000.0 : -1000.0;
            phi_ -= shift;
            lastFloor_ -= (long)shift;
        }
        const double total = phi_ + (double)p.phase;
        const long fl = (long)std::floor(total);
        if (fl != lastFloor_) {
            const long d = std::clamp(fl - lastFloor_, -(long)n, (long)n);
            for (long i = 0; i < std::labs(d); ++i) rotate(d > 0 ? +1 : -1, n);
            lastFloor_ = fl;
            fr.wrap = true;
        }
        const double ph = total - (double)fl;
        const float a = 1.0f - std::exp(-1.0f / (float)(sampleRate_ * 0.002));
        const float tw = std::clamp(p.timbre, 0.0f, 1.0f), sp = std::clamp(p.spread, 0.0f, 1.0f);
        if ((ctr_++ & 15) == 0) {  // frequencies and window values change slowly: every 16 samples is plenty
            for (int k = 0; k < n; ++k) {
                const double pos = (double)k + ph;
                const double f = p.centreHz * std::exp2(pos - 0.5 * n);
                dt_[(size_t)k] = std::clamp(f / sampleRate_, 0.0, 0.49);
                tgt_[(size_t)k] = f < sampleRate_ * 0.45 ? window(pos, n, p.width) : 0.0f;
            }
        }
        float outL = 0.0f, outR = 0.0f;
        for (int k = 0; k < n; ++k) {
            amp_[(size_t)k] += a * (tgt_[(size_t)k] - amp_[(size_t)k]);
            double& phase = ph_[(size_t)k];
            const double dt = dt_[(size_t)k];
            phase += dt;
            if (phase >= 1.0) phase -= 1.0;
            float s = (float)std::sin(6.283185307179586 * phase);
            if (tw > 0.0f) {
                double saw = 2.0 * phase - 1.0;
                if (phase < dt) { const double x = phase / dt; saw -= x + x - x * x - 1.0; }
                else if (phase > 1.0 - dt) { const double x = (phase - 1.0) / dt; saw -= x * x + x + x + 1.0; }
                s = s + tw * ((float)(-saw * 0.7) - s);  // −saw: the same sign as the sine's first half-cycle
            }
            const float y = s * amp_[(size_t)k] * norm_;
            const float pan = (k & 1 ? 0.5f : -0.5f) * sp;  // alternate partials lean left / right
            outL += y * (0.5f - pan) * 2.0f * 0.5f;
            outR += y * (0.5f + pan) * 2.0f * 0.5f;
        }
        fr.l = outL * 1.0f;
        fr.r = outR * 1.0f;
        fr.loop = (float)ph;
        return fr;
    }

private:
    /// The pattern moved one octave: oscillator k now plays what k+1 (or k−1) played.
    void rotate(int dir, int n) noexcept {
        if (dir > 0) {  // upward: slot k now sits where slot k−1 did
            const double last = ph_[(size_t)n - 1], lastDt = dt_[(size_t)n - 1];
            const float lastAmp = amp_[(size_t)n - 1], lastTgt = tgt_[(size_t)n - 1];
            for (int k = n - 1; k > 0; --k)
                ph_[(size_t)k] = ph_[(size_t)k - 1], amp_[(size_t)k] = amp_[(size_t)k - 1], dt_[(size_t)k] = dt_[(size_t)k - 1], tgt_[(size_t)k] = tgt_[(size_t)k - 1];
            ph_[0] = last, amp_[0] = lastAmp, dt_[0] = lastDt, tgt_[0] = lastTgt;
        } else {        // downward: slot k now sits where slot k+1 did
            const double first = ph_[0], firstDt = dt_[0];
            const float firstAmp = amp_[0], firstTgt = tgt_[0];
            for (int k = 0; k < n - 1; ++k)
                ph_[(size_t)k] = ph_[(size_t)k + 1], amp_[(size_t)k] = amp_[(size_t)k + 1], dt_[(size_t)k] = dt_[(size_t)k + 1], tgt_[(size_t)k] = tgt_[(size_t)k + 1];
            ph_[(size_t)n - 1] = first, amp_[(size_t)n - 1] = firstAmp, dt_[(size_t)n - 1] = firstDt, tgt_[(size_t)n - 1] = firstTgt;
        }
    }

    double sampleRate_ = 48000.0, phi_ = 0.0;
    std::array<double, kMax> ph_{}, dt_{};
    std::array<float, kMax> amp_{}, tgt_{};
    uint32_t ctr_ = 0;
    float norm_ = 1.0f, lastWidth_ = -1.0f;
    int lastCount_ = -1;
    long lastFloor_ = 0;
};

}  // namespace bleep::patch
