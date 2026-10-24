// SPDX-License-Identifier: GPL-3.0-only
// Stretch DSP (doc/specs/modules/stretch.md): records a stereo input into a buffer
// and plays it back at a different speed without changing its pitch.
//
// The tape is a buffer of up to kMaxSeconds. A take is recorded once (until the
// buffer is full or Record is switched off), rolls round continuously, or the
// buffer is left alone. The play head moves through a window of the recording
// (all of it, or a "held range") at 1 / Stretch source samples per output sample,
// looping at the end of the window; Freeze stops it, and Position moves it by hand.
// Two engines turn the head position into sound:
//
//   Grains: Hann-windowed grains are cut from the head position every hop and played
//   at the pitch ratio. Rough and textural; a Scatter spreads their starting points.
//
//   Smear: the phase-vocoder method (published since the 1960s): every output hop
//   the spectrum at the head is analysed twice, a hop apart, to measure each bin's true
//   frequency; the bins are then re-synthesised with phases that keep turning at that
//   frequency (locked around spectral peaks, so partials stay together), and
//   overlap-added. Tones stretch cleanly, noise and transients smear out. A pitch offset
//   moves the bins up or down the spectrum.
//
// Stretch can wobble: a slow LFO or a smooth random walk modulates the factor in octaves.
#pragma once

#include "dsp/RealFft.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace bleep::patch {

struct StretchParams {
    float stretch = 1.0f;        ///< time factor, 0.1 … 8 (2 = twice as long)
    bool freeze = false;
    bool reverse = false;
    float pitchSemis = 0.0f;
    int engine = 0;              ///< 0 grains, 1 smear
    float grainMs = 120.0f;
    int overlap = 3;             ///< 2 … 4 grains at once
    float scatter = 0.1f;        ///< 0 … 1
    int sizeIndex = 1;           ///< smear FFT size: 1024, 2048, 4096
    bool holdRange = false;
    float rangeStart = 0.0f;     ///< 0 … 1 of the recording
    float rangeSize = 0.25f;     ///< 0 … 1 of the recording
    int mode = 0;                ///< 0 run (Position is an offset), 1 scrub (Position is the head)
    float position = 0.0f;       ///< 0 … 1 of the window
    float wobble = 0.0f;         ///< 0 … 1 depth (up to ±1.5 octaves of stretch)
    float wobbleRate = 0.7f;     ///< Hz
    int wobbleShape = 0;         ///< 0 sine, 1 smooth random, 2 saw
    int record = 0;              ///< 0 once, 1 rolling, 2 off
    float lengthSeconds = 8.0f;
    float mix = 1.0f;            ///< dry … stretched
    bool newTake = false;        ///< a trigger: start a take over (Once)
};

struct StretchFrame {
    float l = 0.0f, r = 0.0f;
    float head = 0.0f;      ///< play head inside its window, 0 … 1
    float recorded = 0.0f;  ///< recorded share of the buffer length, 0 … 1
    float window0 = 0.0f, window1 = 1.0f;  ///< the window, as shares of the buffer length
};

class StretchDsp {
public:
    static constexpr double kMaxSeconds = 30.0;
    static constexpr int kMaxFft = 4096;
    static int sizeFor(int index) noexcept { return 1024 << std::clamp(index, 0, 2); }

    void prepare(double sampleRate) {
        sr_ = sampleRate;
        cap_ = (size_t)(kMaxSeconds * sr_) + 16;
        bufL_.assign(cap_, 0.0f);
        bufR_.assign(cap_, 0.0f);
        for (int i = 0; i < 3; ++i) ffts_[i].prepare(sizeFor(i));
        const size_t ola = (size_t)kMaxFft * 2;
        olaL_.assign(ola, 0.0f);
        olaR_.assign(ola, 0.0f);
        re_.assign((size_t)kMaxFft, 0.0f);
        im_.assign((size_t)kMaxFft, 0.0f);
        re2_ = im2_ = re_;
        window_.assign((size_t)kMaxFft, 0.0f);
        const size_t bins = (size_t)kMaxFft / 2 + 2;
        for (int c = 0; c < 2; ++c) {
            sr_vec_[c].assign(bins, 1.0f);
            si_vec_[c].assign(bins, 0.0f);
        }
        mag_.assign(bins, 0.0f);
        ur_ = ui_ = ar_ = ai_ = tmag_ = tar_ = tai_ = mag_;
        peakOf_.assign(bins, -1);
        yr_[0] = yr_[1] = yi_[0] = yi_[1] = mag_;
        setFft(2048);
        resetAll();
    }

    /// Engine state back to the start (the recording stays).
    void reset() {
        std::fill(olaL_.begin(), olaL_.end(), 0.0f);
        std::fill(olaR_.begin(), olaR_.end(), 0.0f);
        for (int c = 0; c < 2; ++c) {
            std::fill(sr_vec_[c].begin(), sr_vec_[c].end(), 1.0f);
            std::fill(si_vec_[c].begin(), si_vec_[c].end(), 0.0f);
        }
        for (auto& g : grains_) g.active = false;
        lastGrain_ = -1;
        count_ = 0;
        sinceHop_ = 0;
        seeded_ = false;
        wobbleSeeded_ = false;
        countdown_ = 0.0;
        head_ = 0.0;
        scrubPos_ = 0.0;
        wobblePhase_ = 0.0;
        wobbleVal_ = 0.0f;
    }

    StretchFrame tick(float inL, float inR, const StretchParams& p) noexcept {
        record(inL, inR, p);
        // window of the recording
        const double avail = (double)avail_;
        double S = 0.0, R = std::max(avail, 0.0);
        if (p.holdRange && avail > 0.0) {
            R = std::max(std::min((double)p.rangeSize * avail, avail), std::min(0.02 * sr_, avail));
            S = std::min((double)p.rangeStart * avail, avail - R);
        }
        winS_ = S;
        winR_ = R;

        // stretch factor with the wobble
        double wob = 0.0;
        if (p.wobble > 0.0f) wob = (double)p.wobble * 1.5 * wobble(p);
        const double factor = std::clamp((double)p.stretch * std::exp2(wob), 0.05, 20.0);
        const double rate = p.freeze ? 0.0 : 1.0 / factor;
        const double dir = p.reverse ? -1.0 : 1.0;

        if (R >= 32.0) {
            head_ += dir * rate;
            if (head_ >= S + R) head_ -= R * std::floor((head_ - S) / R);
            if (head_ < S) head_ += R * std::ceil((S - head_) / R);
            if (head_ < S || head_ >= S + R) head_ = S;
        }
        // where the sound is taken from
        double pos;
        if (p.mode == 1) {
            scrubPos_ += (std::clamp((double)p.position, 0.0, 1.0) - scrubPos_) * 0.01;  // ~2 ms: no zipper from stepped CV
            pos = S + scrubPos_ * R;
        } else {
            pos = head_ + (double)p.position * R;
            if (R > 0.0) pos = S + std::fmod(std::fmod(pos - S, R) + R, R);
        }
        pos = std::clamp(pos, S, std::max(S, S + R - 1.0));

        float wetL = 0.0f, wetR = 0.0f;
        if (R >= 32.0) {
            if (p.engine == 0) grains(pos, S, R, dir, p, wetL, wetR);
            else smear(pos, S, R, dir, p, wetL, wetR);
        } else if (p.engine == 1) {
            smearIdle(p, wetL, wetR);
        }
        StretchFrame f;
        f.l = inL + p.mix * (wetL - inL);
        f.r = inR + p.mix * (wetR - inR);
        f.head = R > 0.0 ? (float)std::clamp((pos - S) / R, 0.0, 1.0) : 0.0f;
        const double len = std::max(1.0, (double)len_);
        f.recorded = (float)std::min(1.0, avail / len);
        f.window0 = (float)(S / len);
        f.window1 = (float)((S + R) / len);
        return f;
    }

    /// Samples recorded and usable (the length of the take so far).
    size_t recorded() const noexcept { return avail_; }
    bool recording() const noexcept { return writing_; }
    float latencySeconds(int engine) const noexcept { return engine == 1 ? (float)((double)fftN_ / sr_) : 0.0f; }

private:
    // ---- tape ------------------------------------------------------------
    void resetAll() {
        reset();
        std::fill(bufL_.begin(), bufL_.end(), 0.0f);
        std::fill(bufR_.begin(), bufR_.end(), 0.0f);
        w_ = 0;
        avail_ = 0;
        writing_ = true;
        lastRecord_ = 0;
        len_ = (size_t)(8.0 * sr_);
        rng_ = 12345u;
        wobbleTarget_ = 0.0f;
    }

    void record(float inL, float inR, const StretchParams& p) noexcept {
        len_ = std::clamp((size_t)((double)p.lengthSeconds * sr_), (size_t)(0.25 * sr_), cap_ - 16);
        if (avail_ > len_) avail_ = len_;
        if (w_ >= len_) w_ = 0;
        if (p.record != lastRecord_) {
            if (p.record == 0) startTake();
            else writing_ = p.record == 1;
            lastRecord_ = p.record;
        }
        if (p.newTake && p.record == 0) startTake();
        if (p.record == 2 || !writing_) return;
        bufL_[w_] = inL;
        bufR_[w_] = inR;
        ++w_;
        if (p.record == 0) {
            avail_ = w_;
            if (w_ >= len_) {  // the take is full
                writing_ = false;
                w_ = 0;
            }
        } else {
            avail_ = std::min(len_, std::max(avail_, w_));
            if (w_ >= len_) w_ = 0;
        }
    }
    void startTake() noexcept {
        w_ = 0;
        avail_ = 0;
        writing_ = true;
    }

    float wobble(const StretchParams& p) noexcept {
        wobblePhase_ += (double)p.wobbleRate / sr_;
        bool wrapped = false;
        if (wobblePhase_ >= 1.0) {
            wobblePhase_ -= std::floor(wobblePhase_);
            wrapped = true;
        }
        const float ph = (float)wobblePhase_;
        switch (p.wobbleShape) {
            case 1: {
                if (wrapped || !wobbleSeeded_) {
                    wobbleSeeded_ = true;
                    wobbleFrom_ = wobbleTarget_;
                    rng_ = rng_ * 1664525u + 1013904223u;
                    wobbleTarget_ = (float)(rng_ >> 8) / 8388608.0f - 1.0f;
                }
                const float t = 0.5f - 0.5f * std::cos(3.14159265f * ph);
                return wobbleFrom_ + t * (wobbleTarget_ - wobbleFrom_);
            }
            case 2: return 2.0f * ph - 1.0f;
            default: return std::sin(6.2831853f * ph);
        }
    }

    float readL(double pos) const noexcept { return interp(bufL_, pos); }
    float readR(double pos) const noexcept { return interp(bufR_, pos); }
    float interp(const std::vector<float>& b, double pos) const noexcept {
        if (pos < 0.0) pos = 0.0;
        const size_t i = (size_t)pos;
        if (i + 1 >= cap_) return b[cap_ - 1];
        const float t = (float)(pos - (double)i);
        return b[i] + t * (b[i + 1] - b[i]);
    }

    // ---- grains ----------------------------------------------------------
    struct Grain {
        bool active = false;
        double src = 0.0, n = 0.0, len = 1.0, step = 1.0;
        float gain = 1.0f;
    };

    void grains(double pos, double S, double R, double dir, const StretchParams& p, float& outL, float& outR) noexcept {
        const double ratio = std::exp2((double)p.pitchSemis / 12.0);
        const int ov = std::clamp(p.overlap, 2, 4);
        double len = std::max(64.0, (double)p.grainMs * 0.001 * sr_);
        len = std::min(len, std::max(64.0, (R - 2.0) / ratio));  // a grain never reaches past the window
        if (countdown_ <= 0.0) {
            rng_ = rng_ * 1664525u + 1013904223u;
            const double jitter = ((double)(rng_ >> 8) / 8388608.0 - 1.0) * (double)p.scatter * len * ratio;
            const double span = len * ratio;
            double start = pos + jitter;
            if (dir > 0.0) start = std::clamp(start, S, std::max(S, S + R - span - 2.0));
            else start = std::clamp(start, std::min(S + span + 2.0, S + R - 1.0), S + R - 1.0);
            double lo, hi;
            if (dir > 0.0) { lo = S; hi = std::max(S, S + R - span - 2.0); }
            else { lo = std::min(S + span + 2.0, S + R - 1.0); hi = S + R - 1.0; }
            if (lastGrain_ >= 0 && grains_[lastGrain_].active) start = align(grains_[lastGrain_], start, len, dir * ratio, lo, hi);
            Grain* slot = nullptr;
            for (auto& g : grains_)
                if (!g.active) { slot = &g; break; }
            if (!slot) {
                slot = &grains_[0];
                for (auto& g : grains_)
                    if (g.n > slot->n) slot = &g;
            }
            lastGrain_ = (int)(slot - grains_);
            slot->active = true;
            slot->src = start;
            slot->n = std::max(-countdown_, 0.0);
            slot->len = len;
            slot->step = dir * ratio;
            slot->gain = 2.0f / (float)ov;
            countdown_ += len / (double)ov;
        }
        countdown_ -= 1.0;
        float l = 0.0f, r = 0.0f;
        for (auto& g : grains_) {
            if (!g.active) continue;
            const float u = (float)(g.n / g.len);
            const float w = (0.5f - 0.5f * std::cos(6.2831853f * u)) * g.gain;
            const double at = g.src + g.n * g.step;
            l += w * readL(at);
            r += w * readR(at);
            g.n += 1.0;
            if (g.n >= g.len) g.active = false;
        }
        outL = l;
        outR = r;
    }

    /// Waveform-similarity alignment: nudges a new grain's start (within about ±8 ms) to the place where
    /// it continues the grain before it most closely, so overlapping grains add up instead of beating.
    double align(const Grain& prev, double start, double len, double step, double lo, double hi) noexcept {
        const int pts = (int)std::clamp(len / 8.0, 4.0, 128.0);
        const int reach = (int)std::clamp(len / 4.0, 8.0, 0.008 * sr_);
        float tmpl[128];
        for (int m = 0; m < pts; ++m) {
            const double at = prev.src + (prev.n + 2.0 * m) * prev.step;
            tmpl[m] = readL(at) + readR(at);
        }
        double best = start, bestScore = -1e30;
        for (int d = -reach; d <= reach; ++d) {
            const double c = std::clamp(start + (double)d, lo, hi);
            double num = 0.0, den = 1e-9;
            for (int m = 0; m < pts; ++m) {
                const double at = c + 2.0 * m * step;
                const float x = readL(at) + readR(at);
                num += (double)tmpl[m] * x;
                den += (double)x * x;
            }
            const double score = num / std::sqrt(den) - 1e-4 * std::fabs((double)d);  // prefer staying put when equal
            if (score > bestScore) {
                bestScore = score;
                best = c;
            }
        }
        return best;
    }

    // ---- phase vocoder ---------------------------------------------------
    void setFft(int n) {
        fftN_ = n;
        fft_ = &ffts_[(n <= 1024 ? 0 : n <= 2048 ? 1 : 2)];
        hop_ = n / 4;
        for (int i = 0; i < n; ++i) window_[(size_t)i] = 0.5f - 0.5f * std::cos(6.2831853f * (float)i / (float)n);
    }

    void smearIdle(const StretchParams& p, float& outL, float& outR) noexcept {
        const int n = sizeFor(p.sizeIndex);
        if (n != fftN_) setFft(n);
        const size_t cmask = (size_t)kMaxFft * 2 - 1;
        const size_t at = (count_ - 1 - (size_t)fftN_) & cmask;
        ++count_;
        outL = olaL_[at];
        outR = olaR_[at];
        olaL_[at] = olaR_[at] = 0.0f;
    }

    void smear(double pos, double S, double R, double dir, const StretchParams& p, float& outL, float& outR) noexcept {
        const int n = sizeFor(p.sizeIndex);
        if (n != fftN_) {
            setFft(n);
            std::fill(olaL_.begin(), olaL_.end(), 0.0f);
            std::fill(olaR_.begin(), olaR_.end(), 0.0f);
            seeded_ = false;
            sinceHop_ = 0;
            count_ = 0;
        }
        const size_t cmask = (size_t)kMaxFft * 2 - 1;
        ++count_;
        if (++sinceHop_ >= hop_) {
            sinceHop_ = 0;
            pvFrame(pos, S, R, dir, p);
        }
        const size_t at = (count_ - 1 - (size_t)fftN_) & cmask;
        outL = olaL_[at];
        outR = olaR_[at];
        olaL_[at] = olaR_[at] = 0.0f;
    }

    /// The frame analysed at `centre` plus the next hop of the recording, wrapped inside the window.
    void analyse(double centre, double S, double R, float* re, float* im) const noexcept {
        const int n = fftN_;
        const long Si = (long)S, Ri = std::max(1L, (long)R);
        const long base = (long)std::floor(centre) - n / 2;
        for (int i = 0; i < n; ++i) {
            long j = base + i - Si;
            j %= Ri;
            if (j < 0) j += Ri;
            const size_t idx = (size_t)(Si + j);
            const float w = window_[(size_t)i];
            re[i] = bufL_[idx] * w;
            im[i] = bufR_[idx] * w;
        }
    }

    void pvFrame(double pos, double S, double R, double dir, const StretchParams& p) noexcept {
        const int n = fftN_, half = n / 2, hs = hop_;
        const size_t cmask = (size_t)kMaxFft * 2 - 1;
        const double ratio = std::exp2((double)p.pitchSemis / 12.0);
        const bool shifted = std::fabs(ratio - 1.0) > 1e-4;
        analyse(pos, S, R, re_.data(), im_.data());
        analyse(pos + (double)hs, S, R, re2_.data(), im2_.data());
        fft_->forward(re_.data(), im_.data());
        fft_->forward(re2_.data(), im2_.data());

        for (int c = 0; c < 2; ++c) {
            float* sr = sr_vec_[c].data();
            float* si = si_vec_[c].data();
            // analysis: magnitude, unit vector of frame 1, advance vector between the frames
            for (int k = 0; k <= half; ++k) {
                float xr, xi, yr, yi;  // channel c of frame 1 and frame 2
                float ar, ai, br, bi;
                fft_->splitPacked(re_.data(), im_.data(), k, ar, ai, br, bi);
                float cr, ci, dr, di;
                fft_->splitPacked(re2_.data(), im2_.data(), k, cr, ci, dr, di);
                if (c == 0) { xr = ar; xi = ai; yr = cr; yi = ci; }
                else { xr = br; xi = bi; yr = dr; yi = di; }
                const float m = std::sqrt(xr * xr + xi * xi);
                mag_[(size_t)k] = m;
                ur_[(size_t)k] = m > 1e-12f ? xr / m : 1.0f;
                ui_[(size_t)k] = m > 1e-12f ? xi / m : 0.0f;
                // frame 2 relative to frame 1: the phase the bin turned through in one hop
                float rr = yr * xr + yi * xi, ri = yi * xr - yr * xi;
                const float rm = std::sqrt(rr * rr + ri * ri);
                if (rm > 1e-20f) { rr /= rm; ri /= rm; } else { rr = 1.0f; ri = 0.0f; }
                ar_[(size_t)k] = rr;
                ai_[(size_t)k] = ri;
            }
            if (!seeded_) {  // first frame: start each bin at its own phase
                for (int k = 0; k <= half; ++k) { sr[k] = ur_[(size_t)k]; si[k] = ui_[(size_t)k]; }
            }
            if (!shifted) {
                for (int k = 0; k <= half; ++k) {
                    float r = sr[k] * ar_[(size_t)k] - si[k] * ai_[(size_t)k];
                    float i = sr[k] * ai_[(size_t)k] + si[k] * ar_[(size_t)k];
                    const float m = std::sqrt(r * r + i * i);
                    sr[k] = m > 1e-9f ? r / m : 1.0f;
                    si[k] = m > 1e-9f ? i / m : 0.0f;
                }
                lockPeaks(sr, si, half, dir < 0.0);
                for (int k = 0; k <= half; ++k) {
                    yr_[c][(size_t)k] = mag_[(size_t)k] * sr[k];
                    yi_[c][(size_t)k] = mag_[(size_t)k] * si[k];
                }
            } else {
                std::fill(tmag_.begin(), tmag_.begin() + half + 1, 0.0f);
                for (int k = 0; k <= half; ++k) {
                    const int t = (int)std::lround((double)k * ratio);
                    if (t > half || mag_[(size_t)k] <= tmag_[(size_t)t]) continue;
                    // the phase turned through in one hop, ω·hop, scaled by the ratio (the whole turns are kept)
                    const double turned = std::atan2((double)ai_[(size_t)k], (double)ar_[(size_t)k]);
                    const double expected = 1.5707963267948966 * (double)k;  // 2π·k/N · N/4
                    double dev = turned - expected;
                    dev -= 6.283185307179586 * std::floor(dev / 6.283185307179586 + 0.5);
                    const double adv = ratio * (expected + dev);
                    tmag_[(size_t)t] = mag_[(size_t)k];
                    tar_[(size_t)t] = (float)std::cos(adv);
                    tai_[(size_t)t] = (float)std::sin(adv);
                }
                for (int t = 0; t <= half; ++t) {
                    if (tmag_[(size_t)t] > 0.0f) {
                        const float r = sr[t] * tar_[(size_t)t] - si[t] * tai_[(size_t)t];
                        const float i = sr[t] * tai_[(size_t)t] + si[t] * tar_[(size_t)t];
                        const float m = std::sqrt(r * r + i * i);
                        sr[t] = m > 1e-9f ? r / m : 1.0f;
                        si[t] = m > 1e-9f ? i / m : 0.0f;
                    }
                    yr_[c][(size_t)t] = tmag_[(size_t)t] * sr[t];
                    yi_[c][(size_t)t] = tmag_[(size_t)t] * si[t];
                }
            }
        }
        seeded_ = true;

        // both channels in one inverse transform: Z = YL + j·YR, each Hermitian
        for (int k = 0; k <= half; ++k) {
            const float lr = yr_[0][(size_t)k], li = (k == 0 || k == half) ? 0.0f : yi_[0][(size_t)k];
            const float rr = yr_[1][(size_t)k], ri = (k == 0 || k == half) ? 0.0f : yi_[1][(size_t)k];
            re_[(size_t)k] = lr - ri;
            im_[(size_t)k] = li + rr;
            if (k > 0 && k < half) {
                re_[(size_t)(n - k)] = lr + ri;
                im_[(size_t)(n - k)] = -li + rr;
            }
        }
        fft_->inverse(re_.data(), im_.data());
        const float scale = 1.0f / 1.5f;
        const size_t start = count_ - (size_t)n;
        for (int i = 0; i < n; ++i) {
            const float w = window_[(size_t)i] * scale;
            olaL_[(start + (size_t)i) & cmask] += re_[(size_t)i] * w;
            olaR_[(start + (size_t)i) & cmask] += im_[(size_t)i] * w;
        }
    }

    /// Identity phase locking: each bin keeps its phase relation (in the analysed frame) to the
    /// spectral peak it belongs to; the peaks themselves keep their accumulated phase.
    void lockPeaks(float* sr, float* si, int half, bool reversed) noexcept {
        int peaks[1024], np = 0;
        for (int k = 2; k <= half - 2 && np < 1024; ++k) {
            const float m = mag_[(size_t)k];
            if (m > 1e-9f && m > mag_[(size_t)k - 1] && m >= mag_[(size_t)k + 1] && m > mag_[(size_t)k - 2] && m >= mag_[(size_t)k + 2])
                peaks[np++] = k;
        }
        if (np == 0) return;
        int pi = 0;
        for (int k = 0; k <= half; ++k) {
            while (pi + 1 < np && std::abs(peaks[pi + 1] - k) < std::abs(peaks[pi] - k)) ++pi;
            const int pk = peaks[pi];
            if (k == pk) continue;
            // relation of bin k to its peak in the analysed frame
            float rr = ur_[(size_t)k] * ur_[(size_t)pk] + ui_[(size_t)k] * ui_[(size_t)pk];
            float ri = ui_[(size_t)k] * ur_[(size_t)pk] - ur_[(size_t)k] * ui_[(size_t)pk];
            if (reversed) ri = -ri;
            const float x = sr[pk] * rr - si[pk] * ri, y = sr[pk] * ri + si[pk] * rr;
            const float m = std::sqrt(x * x + y * y);
            if (m > 1e-9f) {
                sr[k] = x / m;
                si[k] = y / m;
            }
        }
    }

    // ---- state -----------------------------------------------------------
    double sr_ = 48000.0;
    size_t cap_ = 0, len_ = 0, w_ = 0, avail_ = 0;
    bool writing_ = true;
    int lastRecord_ = 0;
    std::vector<float> bufL_, bufR_;
    double head_ = 0.0, scrubPos_ = 0.0, winS_ = 0.0, winR_ = 0.0;
    double wobblePhase_ = 0.0;
    float wobbleVal_ = 0.0f, wobbleFrom_ = 0.0f, wobbleTarget_ = 0.0f;
    uint32_t rng_ = 12345u;
    // grains
    Grain grains_[10];
    int lastGrain_ = -1;
    double countdown_ = 0.0;
    // vocoder
    dsp::RealFft ffts_[3];
    const dsp::RealFft* fft_ = nullptr;
    int fftN_ = 2048, hop_ = 512, sinceHop_ = 0;
    size_t count_ = 0;
    bool seeded_ = false, wobbleSeeded_ = false;
    std::vector<float> olaL_, olaR_, re_, im_, re2_, im2_, window_, mag_, ur_, ui_, ar_, ai_, tmag_, tar_, tai_;
    std::vector<float> sr_vec_[2], si_vec_[2], yr_[2], yi_[2];
    std::vector<int> peakOf_;
};

}  // namespace bleep::patch
