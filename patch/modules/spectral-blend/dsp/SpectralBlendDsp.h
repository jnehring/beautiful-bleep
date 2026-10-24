// SPDX-License-Identifier: GPL-3.0-only
// Spectral Blend DSP (doc/specs/modules/spectral-blend.md): cross-synthesis of two
// signals in the frequency domain, the textbook short-time Fourier analysis /
// overlap-add scheme (Hann analysis and synthesis windows, 75 % overlap).
//
// Per bin the output takes a magnitude and a phase from A and B: the magnitudes
// morph from A to B (linear or geometric), the phases are morphed as unit vectors,
// so "magnitude of A, phase of B" is two knobs at 0 % and 100 %. A Tilt bends the
// morph across the spectrum (low bins A and high bins B, or the other way round),
// around a Pivot frequency. The blended magnitudes can then be blurred across
// bins, gated per region (three thresholds), made to linger (Smear) and frozen:
// a frozen frame keeps its magnitudes and every bin keeps turning at the rate it
// had, so tones go on as a steady drone.
//
// Latency is one FFT size. Memory is allocated in prepare().
#pragma once

#include "dsp/RealFft.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace bleep::patch {

struct SpectralBlendParams {
    float magnitude = 0.0f;  ///< 0 = magnitudes of A … 1 = of B
    float phase = 1.0f;      ///< 0 = phases of A … 1 = of B
    float tilt = 0.0f;       ///< −1 … 1: + low bins follow A and high bins B, − the other way
    float pivotHz = 1000.0f;
    bool geometric = false;  ///< magnitude morph on a log scale
    float blur = 0.0f;       ///< 0 … 1, smooths magnitudes across bins
    float smear = 0.0f;      ///< 0 … 1, magnitudes linger (up to about 4 s)
    float gateDb[3] = {-90.0f, -90.0f, -90.0f};  ///< low / mid / high region thresholds, ≤ −89 = open
    float splitHz[2] = {400.0f, 3000.0f};
    bool invertGate = false; ///< keep what is below the threshold instead
    bool freeze = false;
    float mix = 1.0f;        ///< dry (A, delayed to match) … wet
    float level = 1.0f;      ///< linear gain
};

class SpectralBlendDsp {
public:
    static constexpr int kMaxSize = 4096;
    static int sizeFor(int index) noexcept { return 512 << std::clamp(index, 0, 3); }

    void prepare(double sampleRate) {
        sr_ = sampleRate;
        for (int i = 0; i < 4; ++i) ffts_[i].prepare(sizeFor(i));
        const size_t cap = (size_t)kMaxSize * 2;
        inA_.assign(cap, 0.0f);
        inB_.assign(cap, 0.0f);
        ola_.assign(cap, 0.0f);
        re_.assign((size_t)kMaxSize, 0.0f);
        im_.assign((size_t)kMaxSize, 0.0f);
        window_.assign((size_t)kMaxSize, 0.0f);
        mag_.assign((size_t)kMaxSize / 2 + 2, 0.0f);
        tmp_.assign((size_t)kMaxSize / 2 + 2, 0.0f);
        prefix_.assign((size_t)kMaxSize / 2 + 3, 0.0f);
        smearMag_ = frozenMag_ = mag_;
        ur_ = ui_ = rotR_ = rotI_ = frzR_ = frzI_ = mag_;
        ramp_ = mag_;
        setSize(2048);
    }

    /// FFT size 512 … 4096 (a power of two). Resets the signal state.
    void setSize(int n) {
        n = std::clamp(n, 512, kMaxSize);
        if (n == size_ && fftN_ == n) return;
        size_ = n;
        fftN_ = n;
        fft_ = &ffts_[(n <= 512 ? 0 : n <= 1024 ? 1 : n <= 2048 ? 2 : 3)];
        hop_ = n / 4;
        for (int i = 0; i < n; ++i) window_[(size_t)i] = 0.5f - 0.5f * std::cos(6.2831853f * (float)i / (float)n);
        rampPivot_ = -1.0f;
        reset();
    }
    int size() const noexcept { return size_; }
    float latencySeconds() const noexcept { return (float)((double)size_ / sr_); }

    void reset() {
        std::fill(inA_.begin(), inA_.end(), 0.0f);
        std::fill(inB_.begin(), inB_.end(), 0.0f);
        std::fill(ola_.begin(), ola_.end(), 0.0f);
        std::fill(smearMag_.begin(), smearMag_.end(), 0.0f);
        std::fill(frozenMag_.begin(), frozenMag_.end(), 0.0f);
        std::fill(ur_.begin(), ur_.end(), 1.0f);
        std::fill(ui_.begin(), ui_.end(), 0.0f);
        std::fill(rotR_.begin(), rotR_.end(), 1.0f);
        std::fill(rotI_.begin(), rotI_.end(), 0.0f);
        std::fill(frzR_.begin(), frzR_.end(), 1.0f);
        std::fill(frzI_.begin(), frzI_.end(), 0.0f);
        count_ = 0;
        sinceHop_ = 0;
        wasFrozen_ = false;
        havePrev_ = false;
    }

    /// One sample of A and B; returns the output.
    float tick(float a, float b, const SpectralBlendParams& p) noexcept {
        const size_t cmask = (size_t)kMaxSize * 2 - 1;
        inA_[count_ & cmask] = a;
        inB_[count_ & cmask] = b;
        ++count_;
        if (++sinceHop_ >= hop_) {
            sinceHop_ = 0;
            frame(p);
        }
        const size_t pos = (count_ - 1 - (size_t)size_) & cmask;
        const float wet = ola_[pos];
        ola_[pos] = 0.0f;
        const float dry = inA_[pos];
        return p.level * (dry + p.mix * (wet - dry));
    }

private:
    void frame(const SpectralBlendParams& p) noexcept {
        const int n = size_, half = n / 2;
        const size_t cmask = (size_t)kMaxSize * 2 - 1;
        const size_t start = count_ - (size_t)n;
        for (int i = 0; i < n; ++i) {
            const float w = window_[(size_t)i];
            re_[(size_t)i] = inA_[(start + (size_t)i) & cmask] * w;
            im_[(size_t)i] = inB_[(start + (size_t)i) & cmask] * w;
        }
        fft_->forward(re_.data(), im_.data());
        updateRamp(p.pivotHz);

        const bool frozen = p.freeze;
        const float norm = 4.0f / (float)n;  // a full-scale sine reads 1 in a bin
        const float wm0 = p.magnitude, wp0 = p.phase, tilt = p.tilt, at = std::fabs(tilt);
        if (!frozen) {
            for (int k = 0; k <= half; ++k) {
                float ar, ai, br, bi;
                fft_->splitPacked(re_.data(), im_.data(), k, ar, ai, br, bi);
                const float ma = std::sqrt(ar * ar + ai * ai), mb = std::sqrt(br * br + bi * bi);
                float wm = wm0, wp = wp0;
                if (at > 0.0f) {
                    const float target = tilt > 0.0f ? ramp_[(size_t)k] : 1.0f - ramp_[(size_t)k];
                    wm += at * (target - wm);
                    wp += at * (target - wp);
                }
                float m;
                if (p.geometric) {
                    const float la = std::log(ma * norm + 1e-6f), lb = std::log(mb * norm + 1e-6f);
                    m = std::max(std::exp(la + wm * (lb - la)) - 1e-6f, 0.0f) / norm;
                } else {
                    m = ma + wm * (mb - ma);
                }
                // phase: unit vectors of A and B, blended
                const float uar = ma > 1e-12f ? ar / ma : 1.0f, uai = ma > 1e-12f ? ai / ma : 0.0f;
                const float ubr = mb > 1e-12f ? br / mb : 1.0f, ubi = mb > 1e-12f ? bi / mb : 0.0f;
                float xr = uar + wp * (ubr - uar), xi = uai + wp * (ubi - uai);
                const float xm = std::sqrt(xr * xr + xi * xi);
                if (xm > 1e-6f) {
                    xr /= xm;
                    xi /= xm;
                } else {
                    xr = uar;
                    xi = uai;
                }
                // how far this bin's phase turned since the last frame (kept for a freeze)
                if (havePrev_) {
                    float rr = xr * ur_[(size_t)k] + xi * ui_[(size_t)k], ri = xi * ur_[(size_t)k] - xr * ui_[(size_t)k];
                    const float rm = std::sqrt(rr * rr + ri * ri);
                    if (rm > 1e-6f) {
                        rotR_[(size_t)k] = rr / rm;
                        rotI_[(size_t)k] = ri / rm;
                    }
                }
                ur_[(size_t)k] = xr;
                ui_[(size_t)k] = xi;
                mag_[(size_t)k] = m;
            }
            havePrev_ = true;
            blur(p.blur, half);
            gate(p, half, norm);
            smear(p.smear, half);
            if (wasFrozen_) wasFrozen_ = false;
        } else {
            if (!wasFrozen_) {  // capture: what is lingering now stays, each bin keeps its own turning rate
                for (int k = 0; k <= half; ++k) {
                    frozenMag_[(size_t)k] = smearMag_[(size_t)k];
                    frzR_[(size_t)k] = ur_[(size_t)k];
                    frzI_[(size_t)k] = ui_[(size_t)k];
                }
                wasFrozen_ = true;
            }
            for (int k = 0; k <= half; ++k) {
                const float r = frzR_[(size_t)k] * rotR_[(size_t)k] - frzI_[(size_t)k] * rotI_[(size_t)k];
                const float i = frzR_[(size_t)k] * rotI_[(size_t)k] + frzI_[(size_t)k] * rotR_[(size_t)k];
                const float m = std::sqrt(r * r + i * i);
                frzR_[(size_t)k] = m > 1e-6f ? r / m : 1.0f;
                frzI_[(size_t)k] = m > 1e-6f ? i / m : 0.0f;
                ur_[(size_t)k] = frzR_[(size_t)k];
                ui_[(size_t)k] = frzI_[(size_t)k];
                mag_[(size_t)k] = frozenMag_[(size_t)k];
            }
        }

        // back to a real frame: Hermitian spectrum
        re_[0] = mag_[0] * ur_[0];
        im_[0] = 0.0f;
        re_[(size_t)half] = mag_[(size_t)half] * ur_[(size_t)half];
        im_[(size_t)half] = 0.0f;
        for (int k = 1; k < half; ++k) {
            const float yr = mag_[(size_t)k] * ur_[(size_t)k], yi = mag_[(size_t)k] * ui_[(size_t)k];
            re_[(size_t)k] = yr;
            im_[(size_t)k] = yi;
            re_[(size_t)(n - k)] = yr;
            im_[(size_t)(n - k)] = -yi;
        }
        fft_->inverse(re_.data(), im_.data());
        const float scale = 1.0f / 1.5f;  // Hann × Hann at 75 % overlap sums to 1.5
        for (int i = 0; i < n; ++i) ola_[(start + (size_t)i) & cmask] += re_[(size_t)i] * window_[(size_t)i] * scale;
    }

    /// Box blur of the magnitudes across bins, radius from the Blur knob.
    void blur(float amount, int half) noexcept {
        const int r = (int)(amount * amount * 0.04f * (float)half + 0.5f);
        if (r < 1) return;
        prefix_[0] = 0.0f;
        for (int k = 0; k <= half; ++k) prefix_[(size_t)k + 1] = prefix_[(size_t)k] + mag_[(size_t)k];
        for (int k = 0; k <= half; ++k) {
            const int lo = std::max(0, k - r), hi = std::min(half, k + r);
            tmp_[(size_t)k] = (prefix_[(size_t)hi + 1] - prefix_[(size_t)lo]) / (float)(hi - lo + 1);
        }
        for (int k = 0; k <= half; ++k) mag_[(size_t)k] = tmp_[(size_t)k];
    }

    /// Three regions, each with a threshold; soft over one octave of level (a factor of two).
    void gate(const SpectralBlendParams& p, int half, float norm) noexcept {
        const bool any = p.gateDb[0] > -89.0f || p.gateDb[1] > -89.0f || p.gateDb[2] > -89.0f;
        if (!any) return;
        float thr[3];
        for (int r = 0; r < 3; ++r) thr[r] = p.gateDb[r] > -89.0f ? std::pow(10.0f, p.gateDb[r] / 20.0f) / norm : 0.0f;
        const float binHz = (float)(sr_ / (double)size_);
        for (int k = 0; k <= half; ++k) {
            const float hz = (float)k * binHz;
            const float t = thr[hz < p.splitHz[0] ? 0 : (hz < p.splitHz[1] ? 1 : 2)];
            if (t <= 0.0f) continue;
            float g = std::clamp(mag_[(size_t)k] / t - 1.0f, 0.0f, 1.0f);
            if (p.invertGate) g = 1.0f - g;
            mag_[(size_t)k] *= g;
        }
    }

    /// Magnitudes fall at most at a rate set by Smear.
    void smear(float amount, int half) noexcept {
        const float tau = amount * amount * 4.0f;
        const float d = tau < 0.005f ? 0.0f : std::exp(-(float)hop_ / (float)sr_ / tau);
        for (int k = 0; k <= half; ++k) {
            smearMag_[(size_t)k] = std::max(mag_[(size_t)k], smearMag_[(size_t)k] * d);
            mag_[(size_t)k] = smearMag_[(size_t)k];
        }
    }

    /// Weight of B across frequency for a Tilt: a smooth step around the pivot, two octaves wide.
    void updateRamp(float pivot) noexcept {
        if (pivot == rampPivot_) return;
        rampPivot_ = pivot;
        const float binHz = (float)(sr_ / (double)size_);
        for (int k = 0; k <= size_ / 2; ++k) {
            const float hz = std::max((float)k, 0.5f) * binHz;
            ramp_[(size_t)k] = 0.5f + 0.5f * std::tanh(1.1f * std::log2(hz / pivot));
        }
    }

    double sr_ = 48000.0;
    dsp::RealFft ffts_[4];
    const dsp::RealFft* fft_ = nullptr;
    int size_ = 2048, fftN_ = 0, hop_ = 512, sinceHop_ = 0;
    size_t count_ = 0;
    bool wasFrozen_ = false, havePrev_ = false;
    float rampPivot_ = -1.0f;
    std::vector<float> inA_, inB_, ola_, re_, im_, window_, mag_, tmp_, prefix_, smearMag_, frozenMag_;
    std::vector<float> ur_, ui_, rotR_, rotI_, frzR_, frzI_, ramp_;
};

}  // namespace bleep::patch
