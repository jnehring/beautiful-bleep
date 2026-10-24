// SPDX-License-Identifier: GPL-3.0-only
// Scope core (doc/specs/modules/scope.md §4): a triggered capture of up to four
// signals into a fixed number of display columns (the lowest and highest sample
// of each column, so fast detail is never lost), and a measurement of one signal's
// amplitude and frequency that runs whether or not the display does.
#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>

namespace bleep::patch {

constexpr int kScopeColumns = 400;
constexpr int kScopeTraces = 4;
constexpr int kScopeDivisions = 10;
constexpr float kScopeTrigHysteresis = 0.01f;  ///< re-arm distance from the trigger level

enum ScopeMode { ScopeAuto = 0, ScopeNormal, ScopeFree };
enum ScopeEdge { ScopeRising = 0, ScopeFalling, ScopeEither };

struct ScopeParams {
    int channels = 2;
    float timeDiv = 0.001f;  ///< seconds per division
    float level = 0.0f;      ///< trigger level
    int edge = ScopeRising;
    int source = 0;          ///< trigger source (trace index)
    int mode = ScopeAuto;
    bool hold = false;       ///< freezes the display; the measurements go on
    int measure = 0;         ///< trace the amplitude and frequency outputs follow
};

/// One lowest/highest pair per column, per trace.
using ScopeFrame = std::array<float, kScopeTraces * kScopeColumns * 2>;

constexpr float kScopeMiddleC = 261.6255653f;
/// A frequency as a 1 V/oct pitch signal (0 = middle C).
inline float scopeHzToPitch(float hz) noexcept { return hz > 1e-3f ? std::log2(hz / kScopeMiddleC) : -4.0f; }

class ScopeDsp {
public:
    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        blockLen_ = std::max(1, (int)(sampleRate * 0.05));
        ampAlpha_ = (float)(1.0 - std::exp(-1.0 / (0.03 * sampleRate)));
        reset();
    }
    void reset() noexcept {
        state_ = Waiting;
        armedRise_ = armedFall_ = false;
        waited_ = 0.0;
        sweepIndex_ = 0;
        publishedCol_ = 0;
        prevSrc_ = 0.0f;
        done_.fill(0.0f);
        cur_.fill(0.0f);
        triggered_ = false;
        blockN_ = 0;
        bmax_ = bmin_ = pmax_ = pmin_ = 0.0f;
        mid_ = 0.0f;
        ampTarget_ = amp_ = 0.0f;
        high_ = false;
        prevMeas_ = 0.0f;
        sample_ = 0;
        lastCross_ = -1.0;
        freq_ = 0.0f;
        valid_ = false;
    }

    /// One frame of input (`in[0 .. channels)`).
    void tick(const ScopeParams& p, const float* in) noexcept {
        const int ch = std::clamp(p.channels, 1, kScopeTraces);
        capture(p, in, ch);
        measure(in[std::clamp(p.measure, 0, ch - 1)]);
        ++sample_;
    }

    // ---- display ----------------------------------------------------------------------------
    /// Number of frames published so far (it changes when `frame()` has new content).
    uint32_t published() const noexcept { return published_; }
    const ScopeFrame& frame() const noexcept { return done_; }
    /// The column a slow sweep has reached, or -1 when the frame is complete: the view draws a gap there.
    int writeColumn() const noexcept { return state_ == Sweeping && sweepSeconds_ > 0.1 ? publishedCol_ : -1; }
    bool triggered() const noexcept { return triggered_; }
    /// Seconds the full width of the screen shows.
    double sweepSeconds() const noexcept { return sweepSeconds_; }

    // ---- measurements -------------------------------------------------------------------------
    float amplitude() const noexcept { return amp_; }
    float frequency() const noexcept { return freq_; }
    bool valid() const noexcept { return valid_; }

private:
    enum State { Waiting, Sweeping };
    static constexpr float kInf = std::numeric_limits<float>::infinity();

    void startSweep(const ScopeParams& p, double offset, bool fromTrigger) noexcept {
        state_ = Sweeping;
        triggered_ = fromTrigger;
        sweepSeconds_ = (double)p.timeDiv * kScopeDivisions;
        spc_ = std::max(1e-6, sweepSeconds_ * sr_ / kScopeColumns);
        sweepIndex_ = 0;
        offset_ = offset;
        lastCol_ = -1;
        publishedCol_ = 0;
        sinceRefresh_ = 0;
        for (size_t i = 0; i < cur_.size(); i += 2) {
            cur_[i] = kInf;
            cur_[i + 1] = -kInf;
        }
    }

    void touch(int trace, int col, float v) noexcept {
        const size_t o = ((size_t)trace * kScopeColumns + (size_t)col) * 2;
        cur_[o] = std::min(cur_[o], v);
        cur_[o + 1] = std::max(cur_[o + 1], v);
    }

    /// Copies the columns up to `upTo` (inclusive) into the published frame; empty columns repeat their left neighbour.
    void publish(const ScopeParams& p, int upTo) noexcept {
        if (p.hold) return;
        for (int t = 0; t < kScopeTraces; ++t) {
            float lo = 0.0f, hi = 0.0f;
            for (int c = 0; c <= upTo; ++c) {  // leading empty columns take the first value that arrives
                const size_t o = ((size_t)t * kScopeColumns + (size_t)c) * 2;
                if (cur_[o] <= cur_[o + 1]) {
                    lo = cur_[o];
                    hi = cur_[o + 1];
                    break;
                }
            }
            for (int c = 0; c <= upTo; ++c) {
                const size_t o = ((size_t)t * kScopeColumns + (size_t)c) * 2;
                if (cur_[o] <= cur_[o + 1]) {
                    lo = cur_[o];
                    hi = cur_[o + 1];
                }
                done_[o] = lo;
                done_[o + 1] = hi;
            }
        }
        publishedCol_ = upTo;
        ++published_;
    }

    void capture(const ScopeParams& p, const float* in, int ch) noexcept {
        const float src = in[std::clamp(p.source, 0, ch - 1)];
        if (state_ == Waiting) {
            bool fire = false;
            double frac = 0.0;
            if (p.mode == ScopeFree) {
                fire = true;
            } else {
                if (src < p.level - kScopeTrigHysteresis) armedRise_ = true;
                if (src > p.level + kScopeTrigHysteresis) armedFall_ = true;
                if (p.edge != ScopeFalling && armedRise_ && prevSrc_ < p.level && src >= p.level) {
                    fire = true;
                    frac = (double)(p.level - prevSrc_) / (double)(src - prevSrc_);
                } else if (p.edge != ScopeRising && armedFall_ && prevSrc_ > p.level && src <= p.level) {
                    fire = true;
                    frac = (double)(prevSrc_ - p.level) / (double)(prevSrc_ - src);
                }
                if (fire) armedRise_ = armedFall_ = false;
            }
            if (fire) {
                startSweep(p, p.mode == ScopeFree ? 0.0 : 1.0 - frac, p.mode != ScopeFree);
            } else if (p.mode == ScopeAuto && ++waited_ > std::max(0.05, (double)p.timeDiv * kScopeDivisions * 1.1) * sr_) {
                startSweep(p, 0.0, false);
            }
        }
        if (state_ == Sweeping) {
            const double pos = (offset_ + (double)sweepIndex_) / spc_;
            const int col = (int)pos;
            if (col >= kScopeColumns) {
                publish(p, kScopeColumns - 1);
                state_ = Waiting;
                waited_ = 0.0;
                armedRise_ = armedFall_ = false;
            } else {
                for (int t = 0; t < ch; ++t) {
                    // Columns the sweep skipped (faster than one sample per column) get the line between samples.
                    if (sweepIndex_ > 0)
                        for (int k = std::max(lastCol_ + 1, 0); k < col; ++k) {
                            const float a = lastIn_[(size_t)t];
                            const float u = (float)std::clamp(((double)k - lastPos_) / (pos - lastPos_), 0.0, 1.0);
                            touch(t, k, a + (in[t] - a) * u);
                        }
                    touch(t, col, in[t]);
                    lastIn_[(size_t)t] = in[t];
                }
                lastCol_ = col;
                lastPos_ = pos;
                ++sweepIndex_;
                if (sweepSeconds_ > 0.1 && ++sinceRefresh_ >= (int64_t)(sr_ / 30.0)) {
                    sinceRefresh_ = 0;
                    publish(p, col);
                }
            }
        }
        prevSrc_ = src;
    }

    void measure(float x) noexcept {
        bmax_ = blockN_ == 0 ? x : std::max(bmax_, x);
        bmin_ = blockN_ == 0 ? x : std::min(bmin_, x);
        if (++blockN_ >= blockLen_) {
            blockN_ = 0;
            const float hi = std::max(bmax_, pmax_), lo = std::min(bmin_, pmin_);
            ampTarget_ = (hi - lo) * 0.5f;
            mid_ = (hi + lo) * 0.5f;
            pmax_ = bmax_;
            pmin_ = bmin_;
        }
        amp_ += (ampTarget_ - amp_) * ampAlpha_;
        const float hyst = std::max(0.2f * ampTarget_, 1e-4f);
        const bool active = ampTarget_ > 0.002f;
        if (!high_ && x > mid_ + hyst) {
            high_ = true;
            const float thr = mid_ + hyst;
            const double frac = x > prevMeas_ ? std::clamp((double)(thr - prevMeas_) / (double)(x - prevMeas_), 0.0, 1.0) : 0.0;
            const double t = (double)sample_ - 1.0 + frac;
            if (active && lastCross_ >= 0.0) {
                const double period = t - lastCross_;
                if (period > 2.0 && period < 5.0 * sr_) {
                    const float f = (float)(sr_ / period);
                    freq_ = (freq_ <= 0.0f || f > freq_ * 1.25f || f < freq_ * 0.8f) ? f : freq_ + (f - freq_) * 0.25f;
                    valid_ = true;
                    lastPeriod_ = period;
                }
            }
            lastCross_ = active ? t : -1.0;
        } else if (high_ && x < mid_ - hyst) {
            high_ = false;
        }
        prevMeas_ = x;
        if (valid_ && (double)sample_ - lastCross_ > std::max(3.0 * lastPeriod_, 0.1 * sr_)) valid_ = false;
        if (!active) valid_ = false;
    }

    double sr_ = 48000.0;
    State state_ = Waiting;
    bool armedRise_ = false, armedFall_ = false, triggered_ = false;
    double waited_ = 0.0, spc_ = 1.0, offset_ = 0.0, sweepSeconds_ = 0.01, lastPos_ = 0.0;
    int64_t sweepIndex_ = 0, sinceRefresh_ = 0;
    int lastCol_ = -1, publishedCol_ = 0;
    uint32_t published_ = 0;
    float prevSrc_ = 0.0f;
    std::array<float, kScopeTraces> lastIn_{};
    ScopeFrame cur_{}, done_{};

    int blockLen_ = 2400, blockN_ = 0;
    float bmax_ = 0.0f, bmin_ = 0.0f, pmax_ = 0.0f, pmin_ = 0.0f, mid_ = 0.0f;
    float ampTarget_ = 0.0f, amp_ = 0.0f, ampAlpha_ = 0.001f, prevMeas_ = 0.0f, freq_ = 0.0f;
    bool high_ = false, valid_ = false;
    int64_t sample_ = 0;
    double lastCross_ = -1.0, lastPeriod_ = 0.0;
};

}  // namespace bleep::patch
