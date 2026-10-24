// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Monophonic pitch tracker shared by Pitch Follower, Pitch Snap and Tuner
// (doc/specs/modules/pitch-follower.md). The estimator is the published
// difference-function method (a normalised squared-difference
// search with an absolute threshold, the first dip below it and a parabolic
// refinement), reimplemented here; no code is taken from anywhere.
//
// The input is low-passed and decimated to about 24 kHz first, so the search
// costs the same at every sample rate. An estimate is made every few
// milliseconds (hopSeconds()); in between the last result stands. On top of the
// raw estimate sit two optional stabilisers:
//
//   * Octave guard: a jump of more than about half an octave from the pitch the
//     tracker has settled on is not believed until it has been heard again and
//     again for guardSeconds. A real leap goes through after that delay; a
//     one-frame mistake on a strong harmonic never does.
//   * Vote: the result is the median (in pitch, not Hz) of the last 3 … 9 accepted
//     estimates, which removes single outliers and jitter.
//
// Real-time safe after prepare() (which allocates).
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace bleep::dsp {

struct PitchTrackSettings {
    float minHz = 60.0f;          ///< lowest pitch looked for (sets the analysis window: lower = more latency and CPU)
    float maxHz = 1500.0f;        ///< highest pitch looked for
    float minConfidence = 0.75f;  ///< clarity (0…1) an estimate needs to count as voiced
    float guardSeconds = 0.0f;    ///< octave guard: how long a jump has to persist (0 = off)
    int vote = 1;                 ///< median over the last n accepted estimates (1 = off), up to 9
};

class PitchTracker {
public:
    static constexpr float kLowestHz = 25.0f;
    static constexpr float kSilenceRms = 0.0015f;  ///< about −56 dB: below it nothing is tracked
    static constexpr int kMaxVote = 9;

    void prepare(double sampleRate) {
        sr_ = sampleRate;
        decim_ = std::max(1, (int)std::lround(sr_ / 24000.0));
        decRate_ = sr_ / (double)decim_;
        capTau_ = (int)std::ceil(decRate_ / kLowestHz) + 4;
        int n = 64;
        while (n < capTau_ * 2 + 512) n <<= 1;
        ring_.assign((size_t)n, 0.0f);
        ringMask_ = (size_t)n - 1;
        frame_.assign((size_t)capTau_ * 2 + 8, 0.0f);
        cmnd_.assign((size_t)capTau_ + 4, 1.0f);
        // two RBJ low-pass sections (Butterworth Q pair) at 42 % of the decimated rate
        if (decim_ > 1) {
            const double w0 = 6.283185307179586 * 0.42 * decRate_ / sr_;
            const double qs[2] = {0.5412, 1.3066};
            for (int s = 0; s < 2; ++s) {
                const double alpha = std::sin(w0) / (2.0 * qs[s]), c = std::cos(w0), a0 = 1.0 + alpha;
                lp_[s].b0 = (float)((1.0 - c) * 0.5 / a0);
                lp_[s].b1 = (float)((1.0 - c) / a0);
                lp_[s].b2 = lp_[s].b0;
                lp_[s].a1 = (float)(-2.0 * c / a0);
                lp_[s].a2 = (float)((1.0 - alpha) / a0);
            }
        }
        configure(settings_);
        reset();
    }

    void reset() {
        std::fill(ring_.begin(), ring_.end(), 0.0f);
        lp_[0].z1 = lp_[0].z2 = lp_[1].z1 = lp_[1].z2 = 0.0f;
        writePos_ = 0;
        phase_ = 0;
        sinceHop_ = 0;
        filled_ = 0;
        hz_ = rawHz_ = 0.0f;
        clarity_ = 0.0f;
        level_ = 0.0f;
        voiced_ = false;
        stable_ = 0.0f;
        candidate_ = 0.0f;
        candidateHops_ = 0;
        unvoicedHops_ = 0;
        voteCount_ = voteAt_ = 0;
    }

    /// Applies the settings (cheap; call when a knob moves, not necessarily per sample).
    void configure(const PitchTrackSettings& s) {
        settings_ = s;
        settings_.minHz = std::clamp(s.minHz, kLowestHz, (float)(decRate_ * 0.25));
        settings_.maxHz = std::clamp(s.maxHz, settings_.minHz * 1.5f, (float)(decRate_ * 0.45));
        settings_.vote = std::clamp(s.vote, 1, kMaxVote);
        tauMin_ = std::max(2, (int)std::floor(decRate_ / settings_.maxHz));
        tauMax_ = std::min(capTau_, std::max(tauMin_ + 8, (int)std::ceil(decRate_ / settings_.minHz)));
        hop_ = std::clamp(tauMax_ / 2, 48, 256);
        guardHops_ = settings_.guardSeconds <= 0.0f ? 0 : std::max(2, (int)std::ceil(settings_.guardSeconds * (float)hopSeconds_()));
    }

    /// Feeds one sample at the full rate. Returns true when this sample finished a new estimate.
    bool push(float x) noexcept {
        if (decim_ > 1) {
            x = biquad(lp_[0], x);
            x = biquad(lp_[1], x);
            if (++phase_ < decim_) return false;
            phase_ = 0;
        }
        ring_[writePos_ & ringMask_] = x;
        ++writePos_;
        if (filled_ < tauMax_ * 2) ++filled_;
        if (++sinceHop_ < hop_) return false;
        sinceHop_ = 0;
        if (filled_ < tauMax_ * 2) return false;
        analyse();
        return true;
    }

    /// The stabilised pitch in Hz: the last voiced estimate (after guard and vote); 0 before the first one.
    float hz() const noexcept { return hz_; }
    /// The latest raw estimate (not stabilised), 0 when unvoiced.
    float rawHz() const noexcept { return rawHz_; }
    /// Clarity of the latest frame, 0 … 1 (1 = a perfect periodic signal).
    float confidence() const noexcept { return clarity_; }
    /// RMS level of the latest analysis window (the decimated, filtered input).
    float level() const noexcept { return level_; }
    /// The latest frame was periodic enough, and not a rejected jump.
    bool voiced() const noexcept { return voiced_; }
    /// Seconds between two estimates.
    float hopSeconds() const noexcept { return (float)hopSeconds_(); }
    /// How far an estimate lags behind the audio it describes, in seconds: about one analysis window
    /// (it grows as Low goes down) plus a hop, and half a hop more for every two votes.
    float latencySeconds() const noexcept {
        return (float)((double)tauMax_ / decRate_ + hopSeconds_() * (1.0 + 0.5 * (double)(settings_.vote - 1)));
    }
    const PitchTrackSettings& settings() const noexcept { return settings_; }

private:
    struct Biquad {
        float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
    };
    static float biquad(Biquad& f, float x) noexcept {  // transposed direct form II
        const float y = f.b0 * x + f.z1;
        f.z1 = f.b1 * x - f.a1 * y + f.z2;
        f.z2 = f.b2 * x - f.a2 * y;
        return y;
    }
    double hopSeconds_() const noexcept { return decRate_ > 0.0 ? (double)hop_ / decRate_ : 0.005; }

    void analyse() noexcept {
        const int len = tauMax_ * 2, W = tauMax_;
        const size_t start = writePos_ - (size_t)len;
        double energy = 0.0;
        for (int i = 0; i < len; ++i) {
            const float v = ring_[(start + (size_t)i) & ringMask_];
            frame_[(size_t)i] = v;
            if (i >= len - W) energy += (double)v * v;
        }
        level_ = (float)std::sqrt(energy / (double)W);
        float estimate = 0.0f, clarity = 0.0f;
        if (level_ >= kSilenceRms) clarity = search(estimate);
        clarity_ = clarity;
        rawHz_ = clarity >= settings_.minConfidence ? estimate : 0.0f;
        stabilise(rawHz_);
    }

    /// Normalised difference search; returns the clarity and writes the pitch.
    float search(float& hzOut) noexcept {
        const int W = tauMax_;
        const float* f = frame_.data();
        const float thr = std::clamp(1.0f - settings_.minConfidence, 0.02f, 0.6f);
        double running = 0.0;
        int best = -1;
        float bestVal = 1e9f;
        bool dip = false;
        cmnd_[0] = 1.0f;
        int last = 0;
        for (int tau = 1; tau < tauMax_; ++tau) {
            float sum = 0.0f;
            const float* g = f + tau;
            for (int j = 0; j < W; ++j) {
                const float d = f[j] - g[j];
                sum += d * d;
            }
            running += sum;
            const float v = running > 1e-12 ? (float)((double)sum * tau / running) : 1.0f;
            cmnd_[(size_t)tau] = v;
            last = tau;
            if (tau < tauMin_) continue;
            if (!dip) {
                if (v < bestVal) {
                    bestVal = v;
                    best = tau;
                }
                if (v < thr) dip = true;
            } else if (v < cmnd_[(size_t)tau - 1]) {
                best = tau;
                bestVal = v;
            } else {
                break;  // past the bottom of the first dip
            }
        }
        if (best < 0) return 0.0f;
        float tauF = (float)best;
        if (best >= 2 && best + 1 <= last) {  // parabolic refinement of the minimum
            const float a = cmnd_[(size_t)best - 1], b = cmnd_[(size_t)best], c = cmnd_[(size_t)best + 1];
            const float den = a - 2.0f * b + c;
            if (den > 1e-9f) tauF += std::clamp(0.5f * (a - c) / den, -1.0f, 1.0f);
        }
        hzOut = (float)(decRate_ / (double)tauF);
        if (hzOut < settings_.minHz * 0.97f || hzOut > settings_.maxHz * 1.03f) return 0.0f;
        return std::clamp(1.0f - bestVal, 0.0f, 1.0f);
    }

    /// Octave guard and vote on the raw estimate (0 = unvoiced frame).
    void stabilise(float raw) noexcept {
        if (raw <= 0.0f) {
            voiced_ = false;
            if (++unvoicedHops_ > 12) {  // a gap: the next pitch is a new note, no guard against it
                stable_ = 0.0f;
                candidateHops_ = 0;
                voteCount_ = voteAt_ = 0;
            }
            return;
        }
        unvoicedHops_ = 0;
        float lg = std::log2(raw);
        if (guardHops_ > 0 && stable_ > 0.0f) {
            if (std::fabs(lg - std::log2(stable_)) > 0.4f) {
                if (candidateHops_ > 0 && std::fabs(lg - std::log2(candidate_)) < 0.05f) ++candidateHops_;
                else candidateHops_ = 1;
                candidate_ = raw;
                if (candidateHops_ < guardHops_) {
                    voiced_ = false;  // believed later or never: this frame does not count
                    return;
                }
            }
            candidateHops_ = 0;
        }
        stable_ = raw;
        voiced_ = true;
        if (settings_.vote > 1) {
            votes_[voteAt_] = lg;
            voteAt_ = (voteAt_ + 1) % kMaxVote;
            voteCount_ = std::min(voteCount_ + 1, settings_.vote);
            float tmp[kMaxVote];
            for (int i = 0; i < voteCount_; ++i) tmp[i] = votes_[(voteAt_ + kMaxVote - 1 - i) % kMaxVote];
            std::sort(tmp, tmp + voteCount_);
            lg = tmp[voteCount_ / 2];
        }
        hz_ = std::exp2(lg);
    }

    double sr_ = 48000.0, decRate_ = 24000.0;
    int decim_ = 2, phase_ = 0;
    int capTau_ = 1000, tauMin_ = 20, tauMax_ = 400, hop_ = 128, sinceHop_ = 0, filled_ = 0, guardHops_ = 0;
    PitchTrackSettings settings_;
    Biquad lp_[2];
    std::vector<float> ring_, frame_, cmnd_;
    size_t ringMask_ = 0, writePos_ = 0;
    float hz_ = 0.0f, rawHz_ = 0.0f, clarity_ = 0.0f, level_ = 0.0f;
    bool voiced_ = false;
    float stable_ = 0.0f, candidate_ = 0.0f;
    int candidateHops_ = 0, unvoicedHops_ = 0, voteCount_ = 0, voteAt_ = 0;
    float votes_[kMaxVote]{};
};

}  // namespace bleep::dsp
