// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Delay-line toolkit shared by the delays, the reverb and the glitch modules
// (doc/specs/modules/zone-delay.md, delay-network.md, reverb.md, bender.md): a
// power-of-two ring buffer with fractional reads, and the readers built on
// it: a tape-style time follower (time changes bend pitch), a two-head
// crossfading reader (time changes without pitch bend), a windowed reverse
// reader and a hold loop that replays the buffer once writing stops.
//
// Delay convention: read(d) returns the sample written d writes ago, so
// d = 0 is the most recent write. Feed-forward: write(x), then read(D) is x
// delayed by D samples. In a feedback loop that reads before it writes,
// read(L - 1) closes a loop of L samples.
#pragma once

#include "Tempo.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

namespace bleep::dsp {

/// 4-point, 3rd-order Hermite (Catmull-Rom) interpolation between p1 (t = 0)
/// and p2 (t = 1); p0 and p3 are the outer neighbours.
inline float hermite4(float p0, float p1, float p2, float p3, float t) noexcept {
    const float c1 = 0.5f * (p2 - p0);
    const float c2 = p0 - 2.5f * p1 + 2.0f * p2 - 0.5f * p3;
    const float c3 = 0.5f * (p3 - p0) + 1.5f * (p1 - p2);
    return ((c3 * t + c2) * t + c1) * t + p1;
}

/// Mono ring-buffer delay line. Memory is allocated in resize() (off the audio
/// thread); everything else is real-time safe.
class RingDelay {
public:
    /// Allocates for delays up to maxDelaySamples (rounded up to a power of two
    /// plus interpolation guard) and clears.
    void resize(int maxDelaySamples) {
        size_t n = 16;
        const size_t need = (size_t)std::max(maxDelaySamples, 1) + kGuard;
        while (n < need) n <<= 1;
        buf_.assign(n, 0.0f);
        mask_ = n - 1;
        w_ = 0;
    }
    void clear() noexcept {
        std::fill(buf_.begin(), buf_.end(), 0.0f);
        w_ = 0;
    }
    bool ready() const noexcept { return !buf_.empty(); }
    /// The longest delay that reads valid samples with any interpolation.
    double maxDelay() const noexcept { return buf_.empty() ? 0.0 : (double)(buf_.size() - kGuard); }

    void write(float x) noexcept {
        buf_[w_] = x;
        w_ = (w_ + 1) & mask_;
    }
    /// Integer read, d >= 0.
    float at(size_t d) const noexcept { return buf_[(w_ - 1 - d) & mask_]; }

    /// Linear interpolation, d >= 0.
    float readLinear(double d) const noexcept {
        d = clampDelay(d);
        const size_t i = (size_t)d;
        const float t = (float)(d - (double)i);
        const float a = at(i);
        return a + t * (at(i + 1) - a);
    }
    /// Cubic Hermite interpolation, d >= 0 (below 1 the newest sample is
    /// repeated as the missing neighbour).
    float readHermite(double d) const noexcept {
        d = clampDelay(d);
        const size_t i = (size_t)d;
        const float t = (float)(d - (double)i);
        const float p1 = at(i);
        const float p0 = i > 0 ? at(i - 1) : p1;
        return hermite4(p0, p1, at(i + 1), at(i + 2), t);
    }

    /// Write index and mask, for readers that track a fixed point in the
    /// buffer while writing goes on (HoldLoop).
    size_t writeIndex() const noexcept { return w_; }
    size_t mask() const noexcept { return mask_; }

private:
    static constexpr size_t kGuard = 4;
    double clampDelay(double d) const noexcept { return std::clamp(d, 0.0, maxDelay()); }
    std::vector<float> buf_;
    size_t mask_ = 0, w_ = 0;
};

/// First-order (Thiran) allpass interpolation: exactly flat magnitude, so a
/// feedback loop read through it loses no energy (lossless reverb tanks,
/// freeze, tuned combs). The phase is exact at low frequencies and disperses
/// towards Nyquist. Holds one sample of state per tap. The fraction is kept
/// in [0.5, 1.5) (coefficient −0.2 … 0.33), so slowly moving delays cross
/// sample boundaries without audible transients. d >= 0.5.
class AllpassTap {
public:
    void reset() noexcept { y1_ = 0.0f; }
    float read(const RingDelay& line, double d) noexcept {
        d = std::clamp(d, 0.5, line.maxDelay() - 2.0);
        const size_t i = (size_t)(d - 0.5);
        const float f = (float)(d - (double)i);
        const float eta = (1.0f - f) / (1.0f + f);
        y1_ = eta * (line.at(i) - y1_) + line.at(i + 1);
        return y1_;
    }

private:
    float y1_ = 0.0f;
};

/// Tape-style delay-time follower: the read distance follows the target
/// through a one-pole (glide) and then a slew limit, so a time change speeds
/// up or slows down the head and the repeats bend in pitch, never jump.
/// Max slew s samples/sample bounds the pitch to 1 − s … 1 + s.
class TapeTime {
public:
    void prepare(double sampleRate, float glideSeconds = 0.15f, double maxSlew = 1.0) noexcept {
        sr_ = sampleRate;
        setGlide(glideSeconds);
        setMaxSlew(maxSlew);
    }
    /// 63 % time of the one-pole; 0 = only the slew limit.
    void setGlide(float seconds) noexcept {
        a_ = seconds > 0.0f ? std::exp(-1.0 / ((double)seconds * sr_)) : 0.0;
    }
    void setMaxSlew(double samplesPerSample) noexcept { slew_ = std::max(samplesPerSample, 1e-6); }
    void reset(double delaySamples) noexcept { z_ = out_ = delaySamples; }
    /// One sample: returns the delay (samples) to read at.
    double process(double target) noexcept {
        z_ = target + a_ * (z_ - target);
        out_ += std::clamp(z_ - out_, -slew_, slew_);
        return out_;
    }
    double value() const noexcept { return out_; }

private:
    double sr_ = 48000.0, a_ = 0.0, slew_ = 1.0, z_ = 0.0, out_ = 0.0;
};

/// Two read heads: when the target time moves by more than a threshold, the
/// idle head jumps to it and the heads crossfade, so the pitch never changes.
/// Targets arriving during a fade are latched (the latest wins when it ends).
class CrossfadeReader {
public:
    void setFadeSamples(int samples) noexcept { fade_ = std::max(samples, 1); }
    /// Relative change that starts a fade (default 0.5 %).
    void setThreshold(double relative) noexcept { threshold_ = std::max(relative, 0.0); }
    /// Equal-power (default, for uncorrelated material) or linear gains.
    void setEqualPower(bool on) noexcept { equalPower_ = on; }
    void reset(double delaySamples) noexcept {
        cur_ = next_ = delaySamples;
        pos_ = -1;
    }
    float process(const RingDelay& line, double target) noexcept {
        if (pos_ < 0 && std::fabs(target - cur_) > threshold_ * std::max(cur_, 1.0)) {
            next_ = target;
            pos_ = 0;
        }
        if (pos_ < 0) return line.readHermite(cur_);
        const float t = (float)(pos_ + 1) / (float)fade_;
        float ga = 1.0f - t, gb = t;
        if (equalPower_) {
            ga = std::cos(1.5707963f * t);
            gb = std::sin(1.5707963f * t);
        }
        const float y = ga * line.readHermite(cur_) + gb * line.readHermite(next_);
        if (++pos_ >= fade_) {
            cur_ = next_;
            pos_ = -1;
        }
        return y;
    }
    double delay() const noexcept { return cur_; }
    bool fading() const noexcept { return pos_ >= 0; }

private:
    double cur_ = 0.0, next_ = 0.0, threshold_ = 0.005;
    int fade_ = 2400, pos_ = -1;
    bool equalPower_ = true;
};

/// Plays the most recent `window` samples backwards, repeatedly: two heads
/// half a window apart each read backwards from the write head while it moves
/// on (their delay grows 2 samples per sample, so playback is exactly
/// reversed, never pitched), under raised-cosine windows that sum to 1. A
/// head restarts at the write head when its window ends. Changing the window
/// changes the rhythm of the restarts, not the pitch. Needs a line of at
/// least 2 × the longest window + 2 samples.
class ReverseReader {
public:
    void reset() noexcept {
        phase_ = 0.0;
        started_ = false;
    }
    float process(const RingDelay& line, double windowSamples) noexcept {
        const double maxD = line.maxDelay() - 2.0;
        const double w = std::clamp(windowSamples, 8.0, 0.5 * maxD);
        if (!started_) {
            started_ = true;
            d_[0] = 1.0 + 2.0 * w * phase_;
            d_[1] = 1.0 + 2.0 * w * (phase_ + 0.5 - std::floor(phase_ + 0.5));
        }
        const double np = phase_ + 1.0 / w;
        float y = 0.0f;
        for (int h = 0; h < 2; ++h) {
            double ph = phase_ + 0.5 * h;
            ph -= std::floor(ph);
            const float s = (float)std::sin(3.14159265358979323846 * ph);
            y += s * s * line.readHermite(std::min(d_[h], maxD));
            const double after = np + 0.5 * h;
            d_[h] = after - std::floor(after) < ph ? 1.0 : d_[h] + 2.0;  // restart where the window is 0
        }
        phase_ = np - std::floor(np);
        return y;
    }

private:
    double phase_ = 0.0;
    double d_[2] = {1.0, 1.0};
    bool started_ = false;
};

/// Hold / freeze: once engaged, the caller stops writing and this replays the
/// last `loop` samples continuously, continuing exactly where a reader at the
/// same delay was. The seam is crossfaded into the audio just before the loop
/// region, so it doesn't click. Speed may be negative (backwards) or change
/// per sample (tape pitch). The loop stays anchored to the buffer when writing
/// resumes, so the caller can crossfade back to the live read.
class HoldLoop {
public:
    void setSeamSamples(int samples) noexcept { seam_ = std::max(samples, 1); }
    /// Engage with the delay the live reader was using.
    void engage(const RingDelay& line, double currentDelay) noexcept {
        anchor_ = line.writeIndex();
        r_ = std::max(currentDelay - 1.0, 1.0);  // next sample, measured from the frozen head
        active_ = true;
    }
    void release() noexcept { active_ = false; }
    bool active() const noexcept { return active_; }

    /// loop: region length in samples (>= 2); speed: 1 = normal, −1 backwards.
    float process(const RingDelay& line, double loop, double speed = 1.0) noexcept {
        const double off = (double)((line.writeIndex() - anchor_) & line.mask());
        const double maxL = line.maxDelay() - off - 2.0 - (double)seam_;
        const double L = std::clamp(loop, 2.0, std::max(maxL, 2.0));
        if (r_ > L + 1.0 || r_ < 1.0) r_ = 1.0 + std::fmod(std::fmod(r_ - 1.0, L) + L, L);
        const double x = std::min((double)seam_, 0.5 * L);
        float y = line.readHermite(off + r_);
        if (r_ < 1.0 + x) {  // near the newest end: blend into the audio before the loop start
            const float w = (float)((r_ - 1.0) / x);
            const float g = std::sin(1.5707963f * w);
            y = g * g * y + (1.0f - g * g) * line.readHermite(off + r_ + L);
        }
        r_ -= speed;
        if (r_ < 1.0) r_ += L;
        else if (r_ >= L + 1.0) r_ -= L;
        return y;
    }

private:
    size_t anchor_ = 0;
    double r_ = 1.0;
    int seam_ = 480;
    bool active_ = false;
};

// ---- tempo helpers (note values from Tempo.h) ----------------------------

/// Samples of noteValues()[index] at a tempo (4/4).
inline double noteValueSamples(int index, double bpm, double sampleRate) noexcept {
    return beatsToSamples(noteValueBeats(index), bpm, sampleRate);
}
/// Samples of a length given as a fraction of a whole note (1/8 → 0.5 beats),
/// dotted ×1.5 or triplet ×2/3.
inline double noteFractionSamples(double fractionOfWhole, NoteFeel feel, double bpm, double sampleRate) noexcept {
    const double beats = 4.0 * fractionOfWhole * (feel == NoteFeel::Dotted ? 1.5 : feel == NoteFeel::Triplet ? 2.0 / 3.0 : 1.0);
    return beatsToSamples(beats, bpm, sampleRate);
}
inline double msToSamples(double ms, double sampleRate) noexcept { return ms * 0.001 * sampleRate; }

}  // namespace bleep::dsp
