// SPDX-License-Identifier: GPL-3.0-or-later
// Rate Counter core (doc/specs/modules/rate-counter.md §4): finds the rising edges of a wave
// (a Schmitt trigger that follows the signal's own centre and swing) or of a gate train
// (fixed thresholds), times them to a fraction of a sample, and keeps the last sixteen
// intervals. From them: the latest rate, the average over the last N intervals (the tap
// average), and whether the last four intervals agree.
#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kRateHistory = 16;
constexpr float kRateBpmScale = 240.0f;  ///< the BPM outputs are bpm / 240
constexpr float kRateMiddleC = 261.6255653f;

enum RateMode { RateWave = 0, RateGate };

struct RateParams {
    int mode = RateWave;
    int perBeat = 1;         ///< pulses (or wave cycles) that make one beat
    int average = 4;         ///< intervals in the average (2..16)
    float tolerance = 0.05f; ///< stable while the last four intervals stay this close to their mean
    float timeout = 4.0f;    ///< seconds without an edge before the count starts over
};

struct RateFrame {
    float hz = 0.0f;       ///< the rate of the last interval (smoothed), as a 1 V/oct pitch signal
    float bpm = 0.0f;      ///< the same rate in beats per minute / 240
    float average = 0.0f;  ///< the tap average in beats per minute / 240
    float stable = 0.0f;   ///< gate
    float pulse = 0.0f;    ///< a short trigger on every edge found
};

class RateCounterDsp {
public:
    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        decay_ = (float)(1.0 / (0.5 * sampleRate));
        pulseLen_ = std::max(1, (int)(0.002 * sampleRate));
        reset();
    }
    void reset() noexcept {
        n_ = 0;
        lastEdge_ = -1.0;
        count_ = 0;
        head_ = 0;
        high_ = false;
        prev_ = 0.0f;
        hi_ = lo_ = 0.0f;
        rate_ = 0.0;
        active_ = false;
        pulseLeft_ = 0;
        history_.fill(0.0f);
        frame_ = {};
    }

    /// A tap from the view or a gate: counts as an edge at the next sample.
    void tap() noexcept { tapPending_ = true; }

    const RateFrame& tick(const RateParams& p, float x) noexcept {
        bool edge = false;
        double t = (double)n_;
        if (tapPending_) {
            tapPending_ = false;
            edge = true;
        } else if (p.mode == RateGate) {
            if (!high_ && x >= 0.5f) {
                high_ = true;
                edge = true;
                t = (double)n_ - 1.0 + (x > prev_ ? std::clamp((double)(0.5f - prev_) / (double)(x - prev_), 0.0, 1.0) : 1.0);
            } else if (high_ && x < 0.3f) {
                high_ = false;
            }
        } else {
            // The signal's own range: the envelope's top and bottom fall back towards each other.
            hi_ = x > hi_ ? x : hi_ - (hi_ - lo_) * decay_;
            lo_ = x < lo_ ? x : lo_ + (hi_ - lo_) * decay_;
            const float swing = hi_ - lo_, mid = 0.5f * (hi_ + lo_), up = mid + 0.2f * swing, down = mid - 0.2f * swing;
            if (swing > 0.01f) {
                if (!high_ && x >= up) {
                    high_ = true;
                    edge = true;
                    t = (double)n_ - 1.0 + (x > prev_ ? std::clamp((double)(up - prev_) / (double)(x - prev_), 0.0, 1.0) : 1.0);
                } else if (high_ && x <= down) {
                    high_ = false;
                }
            }
        }
        prev_ = x;
        if (edge) onEdge(p, t);
        if (active_ && (double)n_ - lastEdge_ > (double)p.timeout * sr_) {  // nothing for a while: start over
            active_ = false;
            count_ = 0;
            frame_.stable = 0.0f;
        }
        frame_.pulse = pulseLeft_ > 0 ? 1.0f : 0.0f;
        if (pulseLeft_ > 0) --pulseLeft_;
        ++n_;
        return frame_;
    }

    bool active() const noexcept { return active_; }
    int intervals() const noexcept { return count_; }
    /// The newest `count()` intervals in seconds, newest first.
    float interval(int age) const noexcept { return history_[(size_t)((head_ - 1 - age + 2 * kRateHistory) % kRateHistory)]; }
    double hz() const noexcept { return rate_; }
    double bpm(const RateParams& p) const noexcept { return rate_ * 60.0 / std::max(1, p.perBeat); }
    double averageBpm() const noexcept { return avgBpm_; }
    uint32_t edges() const noexcept { return edges_; }

private:
    void onEdge(const RateParams& p, double t) noexcept {
        pulseLeft_ = pulseLen_;
        ++edges_;
        if (lastEdge_ >= 0.0 && active_) {
            const double iv = t - lastEdge_;
            if (iv > 0.0) {
                history_[(size_t)head_] = (float)(iv / sr_);
                head_ = (head_ + 1) % kRateHistory;
                count_ = std::min(count_ + 1, kRateHistory);
                const double r = sr_ / iv;
                rate_ = count_ <= 1 ? r : rate_ + (r - rate_) * 0.5;
            }
        }
        lastEdge_ = t;
        active_ = true;
        if (count_ > 0) summarise(p);
    }

    void summarise(const RateParams& p) noexcept {
        const int perBeat = std::max(1, p.perBeat);
        const int n = std::clamp(p.average, 2, kRateHistory);
        const int use = std::min(n, count_);
        double sum = 0.0;
        for (int i = 0; i < use; ++i) sum += interval(i);
        const double mean = sum / use;
        avgBpm_ = 60.0 / (mean * perBeat);
        frame_.average = (float)std::clamp(avgBpm_ / kRateBpmScale, 0.0, 4.0);
        frame_.bpm = (float)std::clamp(rate_ * 60.0 / perBeat / kRateBpmScale, 0.0, 4.0);
        frame_.hz = (float)std::clamp(std::log2(std::max(rate_, 1e-3) / kRateMiddleC), -10.0, 10.0);
        bool ok = count_ >= 4;
        if (ok) {
            double m4 = 0.0;
            for (int i = 0; i < 4; ++i) m4 += interval(i);
            m4 *= 0.25;
            for (int i = 0; i < 4; ++i) ok = ok && std::fabs(interval(i) - m4) <= p.tolerance * m4;
        }
        frame_.stable = ok ? 1.0f : 0.0f;
    }

    double sr_ = 48000.0;
    int64_t n_ = 0;
    double lastEdge_ = -1.0, rate_ = 0.0, avgBpm_ = 0.0;
    int count_ = 0, head_ = 0, pulseLen_ = 96, pulseLeft_ = 0;
    uint32_t edges_ = 0;
    bool high_ = false, active_ = false, tapPending_ = false;
    float prev_ = 0.0f, hi_ = 0.0f, lo_ = 0.0f, decay_ = 1e-4f;
    std::array<float, kRateHistory> history_{};
    RateFrame frame_;
};

}  // namespace bleep::patch
