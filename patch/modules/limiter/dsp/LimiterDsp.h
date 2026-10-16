// SPDX-License-Identifier: MIT
// Brickwall lookahead limiter, stereo-linked. The gain needed to bring each sample under the ceiling is
// min-filtered over the lookahead window, released with a one-pole and averaged over the same window, which
// is a ramp down that arrives exactly when the peak does: no sample of the delayed signal exceeds the ceiling.
// Lookahead of one sample is a limiter without delay (the gain follows the signal instantly, no ramp).
#pragma once

#include <algorithm>
#include <cmath>
#include <vector>

namespace bleep::patch {

struct LimiterParams {
    float ceilingDb = -0.3f;
    float releaseMs = 100.0f;
    float inputDb = 0.0f;
};

class LimiterDsp {
public:
    static constexpr double kMaxLookaheadMs = 5.0;

    void prepare(double sampleRate) {
        sr_ = sampleRate;
        cap_ = (int)std::ceil(kMaxLookaheadMs * 0.001 * sampleRate) + 2;
        dq_.assign((size_t)cap_ + 1, {});
        delay_.assign((size_t)cap_ * 2, 0.0f);
        ramp_.assign((size_t)cap_, 0.0f);
        lookahead_ = 0;
        setLookahead(1);
    }
    void reset() {
        std::fill(delay_.begin(), delay_.end(), 0.0f);
        std::fill(ramp_.begin(), ramp_.end(), 1.0f);
        dqHead_ = dqSize_ = 0;
        pos_ = 0;
        rampSum_ = (double)length_;
        released_ = 1.0f;
    }

    /// Lookahead in samples (1 = none). The signal is delayed by `latency()` samples.
    void setLookahead(int samples) {
        samples = std::clamp(samples, 1, cap_ - 1);
        if (samples == lookahead_) return;
        lookahead_ = length_ = samples;
        reset();
    }
    int latency() const noexcept { return lookahead_ - 1; }

    /// One stereo frame. Returns the gain applied (0 … 1, input gain not included).
    float tick(const float in[2], float out[2], const LimiterParams& p) noexcept {
        if (p.releaseMs != lastRelease_) {
            lastRelease_ = p.releaseMs;
            release_ = (float)std::exp(-1.0 / (std::max((double)p.releaseMs, 1.0) * 0.001 * sr_));
        }
        const float pre = std::pow(10.0f, p.inputDb * 0.05f);
        const float ceiling = std::pow(10.0f, p.ceilingDb * 0.05f);
        const float x[2] = {in[0] * pre, in[1] * pre};
        const float peak = std::max(std::fabs(x[0]), std::fabs(x[1]));
        const float need = peak > ceiling ? ceiling / peak : 1.0f;

        // Sliding minimum over the last `length_` samples (monotonic queue).
        const long long n = count_++;
        while (dqSize_ > 0 && back().value >= need) --dqSize_;
        push({n, need});
        while (front().index <= n - length_) pop();
        const float m = front().value;

        // Release: falls at once, rises slowly. Never above m, so the average below stays under the need.
        released_ = m < released_ ? m : m + release_ * (released_ - m);

        // Moving average over the window turns the steps into a ramp.
        rampSum_ += (double)released_ - (double)ramp_[(size_t)pos_];
        ramp_[(size_t)pos_] = released_;
        pos_ = pos_ + 1 == length_ ? 0 : pos_ + 1;
        const float gain = (float)(rampSum_ / length_);

        // Delay the signal by length_ - 1 samples so the ramp meets its peak.
        const int d = length_ - 1;
        const size_t size = delay_.size() / 2;
        const size_t wr = (size_t)(n % (long long)size);
        delay_[wr * 2] = x[0];
        delay_[wr * 2 + 1] = x[1];
        const size_t rd = (size_t)(((n - d) % (long long)size + (long long)size) % (long long)size);
        for (int c = 0; c < 2; ++c)
            out[c] = std::clamp(delay_[rd * 2 + (size_t)c] * gain, -ceiling, ceiling);  // float rounding only
        return gain;
    }

private:
    struct Entry { long long index; float value; };
    Entry& front() { return dq_[(size_t)dqHead_]; }
    Entry& back() { return dq_[(size_t)((dqHead_ + dqSize_ - 1) % (int)dq_.size())]; }
    void push(Entry e) { dq_[(size_t)((dqHead_ + dqSize_) % (int)dq_.size())] = e; ++dqSize_; }
    void pop() { dqHead_ = (dqHead_ + 1) % (int)dq_.size(); --dqSize_; }

    double sr_ = 48000.0;
    int cap_ = 242, lookahead_ = 0, length_ = 1;
    std::vector<Entry> dq_;
    int dqHead_ = 0, dqSize_ = 0;
    std::vector<float> delay_, ramp_;
    int pos_ = 0;
    long long count_ = 0;
    double rampSum_ = 1.0;
    float released_ = 1.0f, release_ = 0.999f, lastRelease_ = -1.0f;
};

}  // namespace bleep::patch
