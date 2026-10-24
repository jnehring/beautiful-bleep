// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Reverb core (doc/specs/modules/reverb.md §4): a feedback delay network of 8 or
// 16 lines mixed by a lossless Householder or Hadamard matrix, after a
// pre-delay and an allpass input diffuser. All decay comes from per-line
// gains and shelves derived from the T60 per band (Jot's method), so every
// line decays at the same rate whatever its length, and infinite decay and
// freeze are exactly lossless. Every line length can change every sample
// (Size, internal modulation) without clicks: lengths are slew-limited and
// smoothed, and the lines are read through first-order allpass
// interpolation, which (unlike cubic reads) has no high-frequency loss, so a
// frozen tail keeps its highs while the modulation runs. The shelves are
// first-order with their corner frequency at the geometric middle of the
// transition, so a strong Damping really reaches the high band.
//
// Also the reusable allpass diffuser used by the delays' "diffuse" features.
// Memory is allocated in prepare(); process() never allocates.
#pragma once

#include "Delay.h"
#include "Random.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

namespace fdn_detail {
/// sin(2π·phase) to about 0.1 % (parabola plus one correction): LFO quality.
inline float lfoSine(double phase) noexcept {
    const float x = (float)(phase - std::floor(phase)) * 2.0f - 1.0f;  // −1 … 1
    const float y = 4.0f * x * (1.0f - std::fabs(x));
    return -(0.225f * (y * std::fabs(y) - y) + y);
}
constexpr uint64_t kStreamRate = 0x6664'6e72, kStreamPhase = 0x6664'6e70;
}  // namespace fdn_detail

/// Schroeder allpass (−g + z⁻ᴹ)/(1 − g·z⁻ᴹ) with a fractional length that may
/// change every sample. The delay is read through allpass interpolation, so
/// the whole stage stays exactly allpass (flat magnitude); |g| < 1.
class AllpassDiffuser {
public:
    void resize(int maxSamples) { line_.resize(maxSamples + 4); }
    void clear() noexcept {
        line_.clear();
        tap_.reset();
    }
    float process(float x, double lengthSamples, float g) noexcept {
        const float d = tap_.read(line_, std::max(lengthSamples - 1.0, 0.5));
        const float v = x + g * d;
        line_.write(v);
        return d - g * v;
    }

private:
    RingDelay line_;
    AllpassTap tap_;
};

/// A series chain of up to 8 allpasses with lengths scaled by one factor and
/// optionally modulated by slow seeded LFOs (against metallic ringing).
class Diffuser {
public:
    static constexpr int kMaxStages = 8;

    /// baseMs: stage lengths at scale 1. maxScale and maxModMs size the memory.
    void prepare(double sampleRate, const float* baseMs, int stages, float maxScale = 1.0f, float maxModMs = 0.0f) {
        sr_ = sampleRate;
        n_ = std::clamp(stages, 0, kMaxStages);
        for (int i = 0; i < n_; ++i) {
            base_[(size_t)i] = baseMs[i] * 0.001 * sampleRate;
            stage_[(size_t)i].resize((int)std::ceil(base_[(size_t)i] * maxScale + maxModMs * 0.001 * sampleRate) + 4);
        }
        maxModSamples_ = maxModMs * 0.001 * sampleRate;
        setSeed(seed_);
    }
    void clear() noexcept {
        for (int i = 0; i < n_; ++i) stage_[(size_t)i].clear();
    }
    /// Per-stage LFO rates spread ±23 % around the rate, start phases from the seed.
    void setSeed(uint64_t seed) noexcept {
        seed_ = seed;
        for (size_t i = 0; i < kMaxStages; ++i) {
            rateMul_[i] = 0.77 + 0.46 * uniform01(seed, i, fdn_detail::kStreamRate);
            phase_[i] = uniform01(seed, i, fdn_detail::kStreamPhase);
        }
    }
    void restartModulation() noexcept { setSeed(seed_); }
    /// depthMs: peak length change (clamped to the prepared maximum).
    void setModulation(float depthMs, float rateHz) noexcept {
        depth_ = std::min((double)depthMs * 0.001 * sr_, maxModSamples_);
        rate_ = rateHz;
    }
    /// coef: allpass gain (0 = bypass … 0.9); scale multiplies every length.
    float process(float x, float coef, float scale = 1.0f) noexcept {
        for (int i = 0; i < n_; ++i) {
            const size_t k = (size_t)i;
            double len = base_[k] * scale;
            if (depth_ > 0.0) {
                len += depth_ * fdn_detail::lfoSine(phase_[k]);
                phase_[k] += rate_ * rateMul_[k] / sr_;
                if (phase_[k] >= 1.0) phase_[k] -= 1.0;
            }
            x = stage_[k].process(x, std::max(len, 1.0), coef);
        }
        return x;
    }

private:
    double sr_ = 48000.0, depth_ = 0.0, rate_ = 0.5, maxModSamples_ = 0.0;
    int n_ = 0;
    uint64_t seed_ = 1;
    std::array<AllpassDiffuser, kMaxStages> stage_;
    std::array<double, kMaxStages> base_{}, rateMul_{}, phase_{};
};

struct FdnParams {
    float size = 0.5f;            ///< 0 … 1: lengths × 2^(4 (size − 0.5)) = ¼ … 4×
    float decay = 2.5f;           ///< mid-band T60, seconds (≥ 0.05)
    bool infinite = false;        ///< lossless loop, input open, soft limiter on
    bool freeze = false;          ///< lossless loop, input faded out (20 ms; 50 ms back)
    bool limit = false;           ///< soft limiter (tanh at −1 dBFS) in the loop
    float damping = 0.4f;         ///< 0 … 1: high T60 = decay × (1 − 0.9 damping)
    float bass = 1.0f;            ///< low T60 = decay × bass (0.5 … 2)
    float diffusion = 0.7f;       ///< 0 … 1: input allpass gain 0.35 + 0.4 × diffusion
    float modRate = 0.6f;         ///< Hz (per-line rates spread ±23 %)
    float modDepth = 0.25f;       ///< 0 … 1 (1 ≈ ±3 ms per line)
    double preDelaySamples = 0.0; ///< follows at ±1 sample per sample
};

class Fdn {
public:
    static constexpr int kMaxLines = 16;
    enum class Mixing { Householder, Hadamard };

    /// Allocates everything (≈ 2 MB at 48 kHz). lines: 8 or 16.
    void prepare(double sampleRate, int lines = 16, double maxPreDelaySeconds = 1.0, uint64_t seed = 1) {
        sr_ = sampleRate;
        const double maxLen = kMaxMs * 0.001 * sampleRate * kMaxScale + kModMs * 0.001 * sampleRate + 8.0;
        for (auto& l : lines_) l.resize((int)std::ceil(maxLen));
        for (auto& p : pre_) p.resize((int)std::ceil(maxPreDelaySeconds * sampleRate) + 4);
        static constexpr float diffL[4] = {1.21f, 2.37f, 4.13f, 6.97f};
        static constexpr float diffR[4] = {1.43f, 2.83f, 4.71f, 7.97f};
        diff_[0].prepare(sampleRate, diffL, 4, kMaxScale);
        diff_[1].prepare(sampleRate, diffR, 4, kMaxScale);
        preTime_.prepare(sampleRate, 0.002f, 1.0);
        scaleCoef_ = std::exp(-1.0 / (0.002 * sampleRate));
        setSeed(seed);
        setLineCount(lines);
    }

    /// 8 or 16 lines (memory is always sized for 16). Clears the tank.
    void setLineCount(int lines) noexcept {
        n_ = lines <= 8 ? 8 : 16;
        mixing_ = n_ == 16 ? Mixing::Hadamard : Mixing::Householder;
        // Distinct primes spread log-uniformly over 11 … 97 ms (co-prime lengths).
        double longest = 0.0;
        for (int i = 0; i < n_; ++i) {
            const double ms = kMinMs * std::pow(kMaxMs / kMinMs, (double)i / (double)(n_ - 1));
            int len = (int)std::lround(ms * 0.001 * sr_);
            while (!isPrime(len) || (i > 0 && len <= (int)base_[(size_t)i - 1])) ++len;
            base_[(size_t)i] = len;
            longest = std::max(longest, (double)len);
        }
        maxScaleStep_ = 0.5 / longest;  // the longest line moves ≤ 0.5 samples per sample
        clear();
    }
    void setMixing(Mixing m) noexcept { mixing_ = m; }
    int lineCount() const noexcept { return n_; }
    double lineLength(int i) const noexcept { return base_[(size_t)i] * scale_; }

    /// Modulation rates and start phases from the seed; restarts the LFOs.
    void setSeed(uint64_t seed) noexcept {
        seed_ = seed;
        for (size_t i = 0; i < kMaxLines; ++i) {
            rateMul_[i] = 0.77 + 0.46 * uniform01(seed, i, fdn_detail::kStreamRate);
            phase_[i] = uniform01(seed, i + 100, fdn_detail::kStreamPhase);
        }
    }
    void restartModulation() noexcept { setSeed(seed_); }

    /// Zeroes lines, filters, diffusers and pre-delay; resets the smoothers on
    /// the next process() call (the first call jumps to its parameters).
    void clear() noexcept {
        for (auto& l : lines_) l.clear();
        for (auto& p : pre_) p.clear();
        for (auto& d : diff_) d.clear();
        for (auto& t : taps_) t.reset();
        lowZ_.fill(0.0f);
        highZ_.fill(0.0f);
        primed_ = false;
    }

    void process(float inL, float inR, float& outL, float& outR, const FdnParams& p) noexcept {
        const double target = std::exp2(4.0 * (std::clamp((double)p.size, 0.0, 1.0) - 0.5));
        const bool lossless = p.freeze || p.infinite;
        if (!primed_) {
            primed_ = true;
            scaleSlew_ = scale_ = target;
            preTime_.reset(p.preDelaySamples);
            inGain_ = p.freeze ? 0.0f : 1.0f;
            loss_ = lossless ? 1.0f : 0.0f;
            limitMix_ = p.limit || p.infinite ? 1.0f : 0.0f;
            countdown_ = 0;
            updateGains(p, true);
        }
        // Size: slew-limited, then a 2 ms one-pole.
        scaleSlew_ += std::clamp(target - scaleSlew_, -maxScaleStep_, maxScaleStep_);
        scale_ = scaleSlew_ + scaleCoef_ * (scale_ - scaleSlew_);
        // Freeze / infinite ramps.
        const float fast = (float)(1.0 / (0.02 * sr_)), slow = (float)(1.0 / (0.05 * sr_));
        inGain_ += std::clamp((p.freeze ? 0.0f : 1.0f) - inGain_, -fast, p.freeze ? fast : slow);
        loss_ += std::clamp((lossless ? 1.0f : 0.0f) - loss_, -slow, fast);
        limitMix_ += std::clamp((p.limit || p.infinite ? 1.0f : 0.0f) - limitMix_, -fast, fast);
        if (--countdown_ <= 0) updateGains(p, false);

        // Pre-delay and input diffusion.
        pre_[0].write(inL);
        pre_[1].write(inR);
        const double pd = preTime_.process(std::clamp(p.preDelaySamples, 0.0, pre_[0].maxDelay()));
        const float coef = 0.35f + 0.4f * std::clamp(p.diffusion, 0.0f, 1.0f);
        const float dl = diff_[0].process(pre_[0].readHermite(pd), coef, (float)scale_) * inGain_;
        const float dr = diff_[1].process(pre_[1].readHermite(pd), coef, (float)scale_) * inGain_;

        // Tank.
        const double modMax = std::clamp((double)p.modDepth, 0.0, 1.0) * kModMs * 0.001 * sr_;
        const double rate = (double)std::max(p.modRate, 0.0f) / sr_;
        std::array<float, kMaxLines> y;
        float sumL = 0.0f, sumR = 0.0f;
        for (int i = 0; i < n_; ++i) {
            const size_t k = (size_t)i;
            const double len = base_[k] * scale_;
            const double exc = std::min(modMax, 0.2 * len) * fdn_detail::lfoSine(phase_[k]);
            phase_[k] += rate * rateMul_[k];
            if (phase_[k] >= 1.0) phase_[k] -= 1.0;
            const float raw = taps_[k].read(lines_[k], std::max(len + exc - 1.0, 0.5));
            if (i & 1) sumR += raw;
            else sumL += raw;
            gm_[k] += dgm_[k];
            rl_[k] += drl_[k];
            rh_[k] += drh_[k];
            cl_[k] += dcl_[k];
            ch_[k] += dch_[k];
            // Low shelf (DC gain rl), then high shelf (Nyquist gain rh), times gm
            // (TPT one-poles; their cutoffs move with the gains, see shelfCoef).
            float v = (raw - lowZ_[k]) * cl_[k];
            const float lp = v + lowZ_[k];
            lowZ_[k] = lp + v;
            const float s = raw + (rl_[k] - 1.0f) * lp;
            v = (s - highZ_[k]) * ch_[k];
            const float lp2 = v + highZ_[k];
            highZ_[k] = lp2 + v;
            y[k] = gm_[k] * (s + (rh_[k] - 1.0f) * (s - lp2));
        }
        mix(y);
        const float inScale = n_ == 16 ? 0.35355339f : 0.5f;  // 1/√(N/2)
        for (int i = 0; i < n_; ++i) {
            const size_t k = (size_t)i;
            const float sign = (i >> 1) & 1 ? -1.0f : 1.0f;
            float v = y[k] + sign * inScale * (i & 1 ? dr : dl);
            if (limitMix_ > 0.0f) v += limitMix_ * (0.891f * std::tanh(v * 1.1223f) - v);
            if (std::fabs(v) < 1e-25f) v = 0.0f;
            lines_[k].write(v);
        }
        outL = sumL * inScale;
        outR = sumR * inScale;
    }

private:
    static constexpr double kMinMs = 11.0, kMaxMs = 97.0, kMaxScale = 4.0, kModMs = 3.0;

    static bool isPrime(int n) noexcept {
        if (n < 2) return false;
        for (int d = 2; d * d <= n; ++d)
            if (n % d == 0) return false;
        return true;
    }

    void mix(std::array<float, kMaxLines>& y) const noexcept {
        if (mixing_ == Mixing::Householder) {
            float sum = 0.0f;
            for (int i = 0; i < n_; ++i) sum += y[(size_t)i];
            sum *= 2.0f / (float)n_;
            for (int i = 0; i < n_; ++i) y[(size_t)i] -= sum;
            return;
        }
        for (int h = 1; h < n_; h <<= 1)  // fast Walsh-Hadamard transform
            for (int i = 0; i < n_; i += h << 1)
                for (int j = i; j < i + h; ++j) {
                    const float a = y[(size_t)j], b = y[(size_t)(j + h)];
                    y[(size_t)j] = a + b;
                    y[(size_t)(j + h)] = a - b;
                }
        const float norm = 1.0f / std::sqrt((float)n_);
        for (int i = 0; i < n_; ++i) y[(size_t)i] *= norm;
    }

    // Per-line band gains every kGainBlock samples, ramped linearly in between.
    void updateGains(const FdnParams& p, bool jump) noexcept {
        countdown_ = kGainBlock;
        const double tm = std::max((double)p.decay, 0.05);
        const double th = tm * (1.0 - 0.9 * std::clamp((double)p.damping, 0.0, 1.0));
        const double tl = tm * std::clamp((double)p.bass, 0.25, 4.0);
        const double loss = loss_;
        for (int i = 0; i < n_; ++i) {
            const size_t k = (size_t)i;
            const double len = base_[k] * scale_;
            auto gain = [&](double t60) { return std::exp(-6.907755278982137 * len / (t60 * sr_)); };
            const double gm = gain(tm), gl = gain(tl), gh = gain(th);
            const double mm = gm + (1.0 - gm) * loss;
            const double ll = std::max((gl + (1.0 - gl) * loss) / mm, 1e-6);
            const double hh = std::max((gh + (1.0 - gh) * loss) / mm, 1e-6);
            const float m = (float)mm, l = (float)ll, h = (float)hh;
            // First-order shelves with the transition centred on their corner:
            // low shelf pole at fc / √R, high shelf pole at fc · √G.
            const float cl = shelfCoef(kLowHz / std::sqrt(ll)), ch = shelfCoef(kHighHz * std::sqrt(hh));
            if (jump || loss >= 1.0) {  // exact 1s when lossless
                gm_[k] = m;
                rl_[k] = l;
                rh_[k] = h;
                cl_[k] = cl;
                ch_[k] = ch;
                dgm_[k] = drl_[k] = drh_[k] = dcl_[k] = dch_[k] = 0.0f;
                continue;
            }
            dgm_[k] = (m - gm_[k]) / (float)kGainBlock;
            drl_[k] = (l - rl_[k]) / (float)kGainBlock;
            drh_[k] = (h - rh_[k]) / (float)kGainBlock;
            dcl_[k] = (cl - cl_[k]) / (float)kGainBlock;
            dch_[k] = (ch - ch_[k]) / (float)kGainBlock;
        }
    }

    /// TPT one-pole coefficient g / (1 + g), g = tan(π f / fs).
    float shelfCoef(double hz) const noexcept {
        const double g = std::tan(3.14159265358979323846 * std::clamp(hz, 1.0, 0.45 * sr_) / sr_);
        return (float)(g / (1.0 + g));
    }

    static constexpr int kGainBlock = 8;
    static constexpr double kLowHz = 250.0, kHighHz = 3000.0;
    double sr_ = 48000.0;
    int n_ = 16;
    Mixing mixing_ = Mixing::Hadamard;
    uint64_t seed_ = 1;
    std::array<RingDelay, kMaxLines> lines_;
    std::array<AllpassTap, kMaxLines> taps_;
    std::array<RingDelay, 2> pre_;
    std::array<Diffuser, 2> diff_;
    TapeTime preTime_;
    std::array<double, kMaxLines> base_{}, rateMul_{}, phase_{};
    std::array<float, kMaxLines> gm_{}, rl_{}, rh_{}, cl_{}, ch_{}, dgm_{}, drl_{}, drh_{}, dcl_{}, dch_{};
    std::array<float, kMaxLines> lowZ_{}, highZ_{};
    float inGain_ = 1.0f, loss_ = 0.0f, limitMix_ = 0.0f;
    double scale_ = 1.0, scaleSlew_ = 1.0, scaleCoef_ = 0.0, maxScaleStep_ = 1e-4;
    int countdown_ = 0;
    bool primed_ = false;
};

}  // namespace bleep::dsp
