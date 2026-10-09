// SPDX-License-Identifier: MIT
// Delay Net core (specs/modules/delay-network.md): up to eight mono delay
// lines (taps) spread over one Time by Scatter and Jitter, some of them read
// backwards (dsp::ReverseReader), each repeat run through a character stage
// and fed back through a routing matrix (parallel, chain, ring or an
// orthogonal 8-point Hadamard mesh). Fractional Taps fade the next line in and
// slide the others between layouts; time changes crossfade between two heads
// or glide like tape (dsp::TapeTime). Freeze circulates the network without
// loss. Memory is allocated in prepare(); tick() never allocates.
#pragma once

#include "dsp/Delay.h"
#include "dsp/Lofi.h"
#include "dsp/Random.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <utility>

namespace bleep::patch {

namespace dnet {

constexpr int kLines = 8;
constexpr double kMaxSeconds = 8.0;
constexpr double kWowMs = 1.2;  ///< Wear: peak wow + flutter excursion

/// The loop's safety net: linear up to ±1, then a tanh knee towards ±1.5.
inline float loopLimit(float x) noexcept {
    const float a = std::fabs(x);
    if (a <= 1.0f) return x;
    return std::copysign(1.0f + 0.5f * std::tanh((a - 1.0f) * 2.0f), x);
}

/// tanh to about 2 % (Padé 3/2, exact ±1 at ±3): saturation quality, cheap.
inline float fastTanh(float x) noexcept {
    x = std::clamp(x, -3.0f, 3.0f);
    const float x2 = x * x;
    return x * (27.0f + x2) / (27.0f + 9.0f * x2);
}

/// Zero-delay-feedback one-pole with an externally computed coefficient.
struct OnePole {
    float s = 0.0f;
    static float coef(double hz, double sr) noexcept {
        const double g = std::tan(3.14159265358979323846 * std::clamp(hz, 5.0, 0.45 * sr) / sr);
        return (float)(g / (1.0 + g));
    }
    float lp(float x, float G) noexcept {
        const float v = (x - s) * G;
        const float y = v + s;
        s = y + v;
        return y;
    }
    float hp(float x, float G) noexcept { return x - lp(x, G); }
};

/// TPT state-variable filter: coefficients shared, state per line.
struct SvfCoef {
    float a1 = 0.0f, a2 = 0.0f, a3 = 0.0f;
    void set(double hz, double q, double sr) noexcept {
        const double g = std::tan(3.14159265358979323846 * std::clamp(hz, 5.0, 0.45 * sr) / sr);
        a1 = (float)(1.0 / (1.0 + g * (g + 1.0 / q)));
        a2 = (float)g * a1;
        a3 = (float)g * a2;
    }
};
struct SvfState {
    float ic1 = 0.0f, ic2 = 0.0f;
    /// {lp, bp}
    std::pair<float, float> process(float v0, const SvfCoef& c) noexcept {
        const float v3 = v0 - ic2;
        const float v1 = c.a1 * ic1 + c.a2 * v3;
        const float v2 = ic2 + c.a2 * ic1 + c.a3 * v3;
        ic1 = 2.0f * v1 - ic1;
        ic2 = 2.0f * v2 - ic2;
        return {v2, v1};
    }
};

/// Two read heads with an additive offset (Wear's wow): when the target moves
/// by more than 0.5 %, the idle head jumps there and the heads crossfade
/// (equal-power); targets arriving during a fade are latched.
class TwoHeads {
public:
    void setFade(int samples) noexcept { fade_ = std::max(samples, 1); }
    void reset(double d) noexcept {
        cur_ = next_ = d;
        pos_ = -1;
    }
    double delay() const noexcept { return cur_; }
    float process(const dsp::RingDelay& line, double target, double offset) noexcept {
        if (pos_ < 0 && std::fabs(target - cur_) > 0.005 * std::max(cur_, 1.0)) {
            next_ = target;
            pos_ = 0;
        }
        if (pos_ < 0) return line.readHermite(std::max(cur_ + offset, 0.0));
        const float t = (float)(pos_ + 1) / (float)fade_;
        const float y = std::cos(1.5707963f * t) * line.readHermite(std::max(cur_ + offset, 0.0)) +
                        std::sin(1.5707963f * t) * line.readHermite(std::max(next_ + offset, 0.0));
        if (++pos_ >= fade_) {
            cur_ = next_;
            pos_ = -1;
        }
        return y;
    }

private:
    double cur_ = 0.0, next_ = 0.0;
    int fade_ = 1920, pos_ = -1;
};

/// Interval between rising clock edges (gaps over 20 s are ignored).
class ClockMeter {
public:
    void reset() noexcept {
        high_ = seen_ = false;
        since_ = interval_ = 0;
    }
    bool process(float x, double sampleRate) noexcept {
        const bool h = x >= 0.5f, edge = h && !high_;
        high_ = h;
        ++since_;
        if (edge) {
            if (seen_ && (double)since_ <= 20.0 * sampleRate) interval_ = since_;
            seen_ = true;
            since_ = 0;
        }
        return edge;
    }
    int64_t interval() const noexcept { return interval_; }

private:
    bool high_ = false, seen_ = false;
    int64_t since_ = 0, interval_ = 0;
};

/// Even position i / n warped by Scatter: x ^ 2^(2·scatter).
inline double scattered(int i, int n, double scatter) noexcept {
    if (n <= 0) return 1.0;
    return std::pow((double)i / (double)n, std::exp2(2.0 * std::clamp(scatter, -1.0, 1.0)));
}

/// Tap positions (fractions of Time) and levels for a continuous Taps value,
/// before Jitter. Tap n sits at 1; the others slide between the n − 1 and n
/// layouts with the fraction, which is also tap n's level.
inline int layout(double taps, double scatter, std::array<double, kLines>& pos, std::array<float, kLines>& level) noexcept {
    taps = std::clamp(taps, 1.0, (double)kLines);
    const int n = std::clamp((int)std::ceil(taps - 1e-9), 1, kLines);
    const double f = n == 1 ? 1.0 : std::clamp(taps - (double)(n - 1), 0.0, 1.0);
    for (int i = 0; i < kLines; ++i) {
        const size_t k = (size_t)i;
        if (i >= n) {
            pos[k] = 1.0;
            level[k] = 0.0f;
            continue;
        }
        const double now = scattered(i + 1, n, scatter);
        const double before = i + 1 < n ? scattered(i + 1, n - 1, scatter) : 1.0;
        pos[k] = before + f * (now - before);
        level[k] = i + 1 == n ? (float)f : 1.0f;
    }
    return n;
}

/// The seeded order in which taps turn reversed (a permutation of 0 … 7).
inline std::array<int, kLines> reverseOrder(uint32_t seed) noexcept {
    std::array<int, kLines> o{};
    for (int i = 0; i < kLines; ++i) o[(size_t)i] = i;
    for (int i = kLines - 1; i > 0; --i) {
        const int j = (int)(dsp::uniform01(seed, (uint64_t)i, 0x72657673u) * (double)(i + 1));
        std::swap(o[(size_t)i], o[(size_t)std::min(j, i)]);
    }
    return o;
}

/// Pan of tap i: alternating sides, spread by Width.
inline float tapPan(int i, float width) noexcept {
    static constexpr float mag[kLines] = {1.0f, 1.0f, 0.6f, 0.6f, 0.8f, 0.8f, 0.4f, 0.4f};
    return (i & 1 ? 1.0f : -1.0f) * mag[i] * std::clamp(width, 0.0f, 1.0f);
}

}  // namespace dnet

enum DnetRouting { DnetParallel = 0, DnetChain, DnetRing, DnetMesh };
enum DnetCharacter { DnetClean = 0, DnetWarm, DnetFilter, DnetDrive, DnetCrush, DnetWear, kDnetCharacters };

struct DelayNetworkParams {
    double timeSeconds = 0.6;  ///< the Time knob (seconds, Free)
    float timeKnob = 0.5f;     ///< the Time knob, normalised (synced scale / clock ratio)
    double syncBeats = 0.0;    ///< Sync note value in quarter notes; 0 = Free
    double bpm = 120.0;
    bool clockPatched = false;
    float taps = 4.0f;         ///< 1 … 8, continuous
    float scatter = 0.0f;      ///< −1 … +1
    float jitter = 0.0f;
    float reverse = 0.0f;
    float feedback = 0.45f;    ///< 0 … 1.1
    float character = 0.2f;
    float tone = 0.0f;
    float width = 0.7f;
    float mix = 0.4f;
    int routing = DnetRing;
    bool tape = false;         ///< Time Change = Tape (else Crossfade)
    bool freeze = false;
    uint32_t seed = 1;
};

struct DelayNetworkFrame {
    float outL = 0.0f, outR = 0.0f, wetL = 0.0f, wetR = 0.0f, pulse = 0.0f;
    std::array<float, 4> tap{};
};

class DelayNetworkDsp {
public:
    /// Clock ratios when Clock is patched, and the synced Time multipliers.
    static double clockRatio(float knob) noexcept {
        static constexpr double r[6] = {0.25, 0.5, 1.0, 2.0, 3.0, 4.0};
        return r[std::clamp((int)(std::clamp(knob, 0.0f, 1.0f) * 6.0f), 0, 5)];
    }
    static double syncScale(float knob) noexcept {
        static constexpr double r[4] = {0.25, 0.5, 1.0, 2.0};
        return r[std::clamp((int)(std::clamp(knob, 0.0f, 1.0f) * 4.0f), 0, 3)];
    }

    void prepare(double sampleRate) {
        sr_ = sampleRate;
        const int len = (int)std::ceil((dnet::kMaxSeconds + 0.05) * sampleRate + dnet::kWowMs * 0.001 * sampleRate) + 16;
        for (auto& l : lines_) {
            l.line.resize(len);
            l.tape.prepare(sampleRate, 0.1f, 1.0);
            l.heads.setFade((int)(0.04 * sampleRate));
        }
        toneCache_ = -1.0;
        envRel_ = (float)std::exp(-1.0 / (0.05 * sampleRate));
        slowCoef_ = (float)(1.0 - std::exp(-1.0 / (0.2 * sampleRate)));
        reset();
    }
    size_t memoryBytes() const noexcept { return dnet::kLines * (size_t)(lines_[0].line.maxDelay() + 4) * sizeof(float); }

    void reset() noexcept {
        for (auto& l : lines_) resetLine(l, true);
        clock_.reset();
        primed_ = false;
        routing_ = prevRouting_ = DnetRing;
        routeFade_ = 1.0f;
        freezeMix_ = 0.0f;
        clearGain_ = 1.0f;
        clearStage_ = -1;
        env_ = slow_ = 0.0f;
        armed_ = true;
        sinceOnset_ = -1;
        restart(seed_);
        ctrl_ = 0;
        lastLo_ = lastHi_ = -1;
    }

    /// Empties every line now (Clear on Play); the old tail's last value
    /// ramps out over 5 ms.
    void clear() noexcept {
        for (auto& l : lines_) {
            l.declick = l.lastY;
            resetLine(l, false);
        }
        declickLeft_ = declickLen_ = std::max(1, (int)(0.005 * sr_));
        sinceOnset_ = -1;
        restart(seed_);
    }
    /// The Clear input: fade out over 10 ms, empty the lines, fade back in.
    void requestClear() noexcept {
        if (clearStage_ < 0) clearStage_ = 0;
    }
    /// Restarts the seeded parts (jitter offsets and reverse order are pure
    /// functions of the seed; Wear's wow phases and noise restart).
    void restart(uint32_t seed) noexcept {
        seed_ = seed;
        order_ = dnet::reverseOrder(seed);
        n_ = 0;
    }

    /// Effective delay (seconds), level and direction of tap i (last tick).
    double tapSeconds(int i) const noexcept { return lines_[(size_t)i].current / sr_; }
    float tapLevel(int i) const noexcept { return lines_[(size_t)i].level; }
    bool tapReversed(int i) const noexcept { return lines_[(size_t)i].revTarget > 0.5f; }
    /// Tap i's output (before panning) of the last tick.
    float tapOut(int i) const noexcept { return lines_[(size_t)i].lastY; }
    float tapPeak(int i) noexcept { return std::exchange(lines_[(size_t)i].peak, 0.0f); }
    int activeTaps() const noexcept { return active_; }

    /// The longest tap's time in samples: free, synced (note × ¼ … ×2) or
    /// clocked (pulse interval × ¼ … 4), clamped to 8 s.
    double timeSamples(const DelayNetworkParams& p) const noexcept {
        double t = p.timeSeconds * sr_;
        if (p.clockPatched && clock_.interval() > 0) t = (double)clock_.interval() * clockRatio(p.timeKnob);
        else if (p.syncBeats > 0.0) t = dsp::beatsToSamples(p.syncBeats, p.bpm, sr_) * syncScale(p.timeKnob);
        return std::clamp(t, 0.002 * sr_, dnet::kMaxSeconds * sr_);
    }

    void tick(const DelayNetworkParams& p, float inL, float inR, float clockIn, DelayNetworkFrame& f) noexcept {
        clock_.process(clockIn, sr_);
        if (p.seed != seed_) {
            seed_ = p.seed;
            order_ = dnet::reverseOrder(seed_);
        }
        const double timeS = timeSamples(p);

        // Layout at control rate (every 16 samples); Time scales it per sample.
        if (ctrl_-- <= 0 || !primed_) {
            ctrl_ = 15;
            active_ = dnet::layout(p.taps, p.scatter, pos_, level_);
            const float jit = std::clamp(p.jitter, 0.0f, 1.0f);
            const int n = active_;
            for (int i = 0; i + 1 < n; ++i) {  // jitter: up to ± half the gap to the neighbours
                const double u = 2.0 * dsp::uniform01(seed_, (uint64_t)i, 0x6a697474u) - 1.0;
                const double lo = i == 0 ? 0.0 : pos_[(size_t)i - 1], hi = pos_[(size_t)i + 1];
                const double gap = u < 0.0 ? pos_[(size_t)i] - lo : hi - pos_[(size_t)i];
                pos_[(size_t)i] = std::clamp(pos_[(size_t)i] + jit * u * 0.5 * gap, 0.001, 1.0);
            }
            const int reversed = (int)std::floor(std::clamp(p.reverse, 0.0f, 1.0f) * (float)n + 0.5f);
            int k = 0;
            for (auto& l : lines_) l.revTarget = 0.0f;
            for (int j = 0; j < dnet::kLines && k < reversed; ++j)
                if (order_[(size_t)j] < n) {
                    lines_[(size_t)order_[(size_t)j]].revTarget = 1.0f;
                    ++k;
                }
            updateCoefs(p.tone);
        }
        if (!primed_ || p.tape != tapeMode_) {
            for (size_t i = 0; i < dnet::kLines; ++i) {
                const double d = primed_ ? lines_[i].current : std::max(timeS * pos_[i], 2.0);
                lines_[i].tape.reset(d);
                lines_[i].heads.reset(d - 1.0);  // the heads hold the read distance (loop − 1)
                if (!primed_) {  // start on the layout, not ramping into it
                    lines_[i].level = level_[i];
                    lines_[i].rev = lines_[i].revTarget;
                    lines_[i].current = d;
                }
            }
            tapeMode_ = p.tape;
            if (!primed_) routing_ = prevRouting_ = p.routing;
            primed_ = true;
        }
        if (p.routing != routing_) {  // crossfade the matrices over 50 ms
            prevRouting_ = routeFade_ < 1.0f ? prevRouting_ : routing_;
            routing_ = p.routing;
            routeFade_ = 0.0f;
        }
        routeFade_ = std::min(routeFade_ + (float)(1.0 / (0.05 * sr_)), 1.0f);

        const float step20 = (float)(1.0 / (0.02 * sr_));
        freezeMix_ += std::clamp((p.freeze ? 1.0f : 0.0f) - freezeMix_, -step20, step20);
        if (clearStage_ >= 0) {  // fade out, clear one line per sample, fade in
            if (clearStage_ == 0) {
                clearGain_ = std::max(clearGain_ - (float)(1.0 / (0.01 * sr_)), 0.0f);
                if (clearGain_ <= 0.0f) clearStage_ = 1;
            } else if (clearStage_ <= dnet::kLines) {
                resetLine(lines_[(size_t)clearStage_ - 1], false);
                ++clearStage_;
            } else {
                clearStage_ = -1;
            }
        } else {
            clearGain_ = std::min(clearGain_ + (float)(1.0 / (0.01 * sr_)), 1.0f);
        }

        // Character pair and blend.
        const float cpos = std::clamp(p.character, 0.0f, 1.0f) * (kDnetCharacters - 1);
        const int lo = std::min((int)cpos, kDnetCharacters - 2), hi = lo + 1;
        const float blend = cpos - (float)lo;
        if (lo != lastLo_ || hi != lastHi_) {
            for (auto& l : lines_) {
                if (lo != lastLo_ && lo != lastHi_) l.chr[(size_t)lo] = CharState{};
                if (hi != lastLo_ && hi != lastHi_) l.chr[(size_t)hi] = CharState{};
            }
            lastLo_ = lo;
            lastHi_ = hi;
        }
        const float wearW = (lo == DnetWear ? 1.0f - blend : 0.0f) + (hi == DnetWear ? blend : 0.0f);
        const float bypass = freezeMix_;  // frozen: no character, no wow

        // Read every line.
        const double t = (double)n_ / sr_;
        std::array<float, dnet::kLines> y{}, c{};
        for (int i = 0; i < dnet::kLines; ++i) {
            Line& l = lines_[(size_t)i];
            const float target = level_[(size_t)i];
            l.level += std::clamp(target - l.level, -step20, step20);
            if (l.level <= 0.0f && target <= 0.0f && l.quiet) {  // inactive: skip the reads
                l.current = std::max(timeS * pos_[(size_t)i], 2.0);
                continue;
            }
            const double d = std::max(timeS * pos_[(size_t)i], 2.0);
            double wow = 0.0;
            if (wearW > 0.0f && bypass < 1.0f) {
                if ((n_ & 15) == 0 || l.wowStep == 0.0) {  // control rate, interpolated
                    const double ph = 0.37 * i;
                    const auto shape = [&](double tt) {
                        return 0.5 + 0.4 * std::sin(6.283185307179586 * (0.5 * tt + ph)) +
                               0.1 * std::sin(6.283185307179586 * (7.0 * tt + 1.7 * ph));
                    };
                    l.wow = shape(t);
                    l.wowStep = (shape(t + 16.0 / sr_) - l.wow) / 16.0 + 1e-300;
                }
                wow = (double)(wearW * (1.0f - bypass)) * dnet::kWowMs * 0.001 * sr_ * l.wow;
                l.wow += l.wowStep;
            }
            float fwd;
            if (p.tape) {
                l.current = l.tape.process(d);
                fwd = l.line.readHermite(std::max(l.current + wow - 1.0, 0.0));
            } else {
                fwd = l.heads.process(l.line, d - 1.0, wow);
                l.current = l.heads.delay() + 1.0;
            }
            l.rev += std::clamp(l.revTarget - l.rev, -step20, step20);
            float v = fwd;
            if (l.rev > 0.0f) {
                if (!l.revOn) {
                    l.reverse.reset();
                    l.revOn = true;
                }
                v = fwd + l.rev * (l.reverse.process(l.line, l.current) - fwd);
            } else {
                l.revOn = false;
            }
            v *= l.level;
            y[(size_t)i] = v;
            const float a = character(l, i, lo, v), b = character(l, i, hi, v);
            const float ch = a + blend * (b - a);
            c[(size_t)i] = ch + bypass * (v - ch);
            l.peak = std::max(l.peak, std::fabs(v));
        }

        // Feedback through the routing matrices (crossfaded on a change).
        std::array<float, dnet::kLines> fb{};
        route(routing_, c, fb, 1.0f);
        if (routeFade_ < 1.0f) {
            std::array<float, dnet::kLines> old{};
            route(prevRouting_, c, old, 1.0f);
            for (int i = 0; i < dnet::kLines; ++i) fb[(size_t)i] = old[(size_t)i] + routeFade_ * (fb[(size_t)i] - old[(size_t)i]);
        }
        const float fbGain = std::clamp(p.feedback, 0.0f, 1.1f) + freezeMix_ * (1.0f - std::clamp(p.feedback, 0.0f, 1.1f));
        const float mid = 0.5f * (inL + inR) * (1.0f - freezeMix_) * clearGain_;
        for (int i = 0; i < dnet::kLines; ++i) {
            Line& l = lines_[(size_t)i];
            float w = (mid + fbGain * fb[(size_t)i]) * l.level * clearGain_;
            w = dnet::loopLimit(w);
            if (std::fabs(w) < 1e-20f) w = 0.0f;
            l.quiet = w == 0.0f && l.level <= 0.0f;
            l.line.write(w);
        }

        // Outputs: pan the taps; taps 1 … 4 also go out on their own.
        const float dc = declickLeft_ > 0 ? (float)declickLeft_-- / (float)declickLen_ : 0.0f;
        float wl = 0.0f, wr = 0.0f;
        for (int i = 0; i < dnet::kLines; ++i) {
            Line& l = lines_[(size_t)i];
            const float v = y[(size_t)i] * clearGain_ + l.declick * dc;
            l.lastY = v;
            const float th = (dnet::tapPan(i, p.width) + 1.0f) * 0.78539816f;
            wl += v * std::cos(th);
            wr += v * std::sin(th);
            if (i < 4) f.tap[(size_t)i] = v;
        }
        const float mix = std::clamp(p.mix, 0.0f, 1.0f);
        const float gd = std::cos(1.5707963f * mix), gw = std::sin(1.5707963f * mix);
        f.wetL = wl;
        f.wetR = wr;
        f.outL = gd * inL + gw * wl;
        f.outR = gd * inR + gw * wr;

        // Pulse: each tap's time after an input onset (−30 dB, re-armed below −40 dB).
        f.pulse = 0.0f;
        const float a = std::fabs(0.5f * (inL + inR));
        env_ = a > env_ ? a : env_ * envRel_;
        slow_ += (a - slow_) * slowCoef_;
        if (armed_ && env_ > 0.0316f && env_ > 2.0f * slow_ + 1e-4f) {
            armed_ = false;
            sinceOnset_ = 0;
        } else if (!armed_ && env_ < 0.01f) {
            armed_ = true;
        }
        if (sinceOnset_ >= 0) {
            ++sinceOnset_;
            for (int i = 0; i < active_; ++i) {
                const int64_t at = (int64_t)std::llround(lines_[(size_t)i].current);
                if (sinceOnset_ == at) f.pulse = 1.0f;
            }
            if (sinceOnset_ > (int64_t)(dnet::kMaxSeconds * sr_) + 16) sinceOnset_ = -1;
        }
        ++n_;
    }

private:
    struct CharState {
        dnet::OnePole lp, hp;
        dnet::SvfState svf;
        dsp::Decimator dec;
    };
    struct Line {
        dsp::RingDelay line;
        dsp::TapeTime tape;
        dnet::TwoHeads heads;
        dsp::ReverseReader reverse;
        std::array<CharState, kDnetCharacters> chr{};
        double current = 48.0, wow = 0.0, wowStep = 0.0;
        float level = 0.0f, rev = 0.0f, revTarget = 0.0f, peak = 0.0f, declick = 0.0f, lastY = 0.0f;
        bool revOn = false, quiet = true;
    };

    void resetLine(Line& l, bool all) noexcept {
        l.line.clear();
        l.reverse.reset();
        l.revOn = false;
        for (auto& s : l.chr) s = CharState{};
        l.quiet = false;
        if (all) {
            l.level = l.rev = l.revTarget = l.peak = l.declick = l.lastY = 0.0f;
            l.current = 48.0;
            l.tape.reset(48.0);
            l.heads.reset(48.0);
        }
    }

    void updateCoefs(float tone) noexcept {
        const double m = std::exp2(2.0 * std::clamp((double)tone, -1.0, 1.0));
        if (!(m < toneCache_ || m > toneCache_)) return;
        toneCache_ = m;
        warmLp_ = dnet::OnePole::coef(6000.0 * m, sr_);
        warmHp_ = dnet::OnePole::coef(60.0 * m, sr_);
        driveLp_ = dnet::OnePole::coef(4000.0 * m, sr_);
        crushLp_ = dnet::OnePole::coef(8000.0 * m, sr_);
        wearLp_ = dnet::OnePole::coef(3000.0 * m, sr_);
        for (int i = 0; i < dnet::kLines; ++i)  // each tap its own colour, ±1 octave around 1.2 kHz
            filter_[(size_t)i].set(1200.0 * m * std::exp2(2.0 * i / (dnet::kLines - 1) - 1.0), 1.5, sr_);
    }

    float character(Line& l, int i, int k, float x) noexcept {
        CharState& s = l.chr[(size_t)k];
        switch (k) {
            case DnetWarm: return dnet::fastTanh(s.hp.hp(s.lp.lp(x, warmLp_), warmHp_));
            case DnetFilter: return 0.8f * s.svf.process(x, filter_[(size_t)i]).second;  // ≈ unit gain at Q 1.5
            case DnetDrive: {
                const float v = (dnet::fastTanh(4.0f * x + 0.25f) - dnet::fastTanh(0.25f)) * 0.266f;  // +12 dB, asymmetric
                return s.lp.lp(v, driveLp_);
            }
            case DnetCrush: {
                const float held = s.dec.process(x, 8000.0, sr_);
                return s.lp.lp(dsp::quantizeBits(std::clamp(held, -1.5f, 1.5f), 8.0f), crushLp_);
            }
            case DnetWear: {
                const float noise = 1e-3f * (float)(2.0 * dsp::uniform01(seed_, n_, 0x77656172u + (uint64_t)i) - 1.0);
                return 0.97f * s.lp.lp(x, wearLp_) + noise;
            }
            default: return x;
        }
    }

    /// fb[j] = Σ_i M_ij c_i for a routing.
    void route(int routing, const std::array<float, dnet::kLines>& c, std::array<float, dnet::kLines>& fb, float) const noexcept {
        const int n = std::max(active_, 1);
        switch (routing) {
            case DnetParallel: fb = c; break;
            case DnetChain:
            case DnetRing: {
                for (int j = 1; j < dnet::kLines; ++j) fb[(size_t)j] = c[(size_t)j - 1];
                // Ring wraps at the last active line; the fading line hands over
                // to the one before it, so sweeping Taps never breaks the loop.
                const float f = level_[(size_t)n - 1];
                const float wrap = n >= 2 ? f * c[(size_t)n - 1] + (1.0f - f) * c[(size_t)n - 2] : c[0];
                fb[0] = routing == DnetRing ? wrap : freezeMix_ * wrap;  // Chain loops only while frozen
                break;
            }
            case DnetMesh: {
                std::array<float, dnet::kLines> v = c;
                for (int h = 1; h < dnet::kLines; h <<= 1)
                    for (int a = 0; a < dnet::kLines; a += h << 1)
                        for (int b = a; b < a + h; ++b) {
                            const float x = v[(size_t)b], z = v[(size_t)(b + h)];
                            v[(size_t)b] = x + z;
                            v[(size_t)(b + h)] = x - z;
                        }
                for (int j = 0; j < dnet::kLines; ++j) fb[(size_t)j] = v[(size_t)j] * 0.35355339f;
                break;
            }
            default: fb = c; break;
        }
    }

    double sr_ = 48000.0;
    std::array<Line, dnet::kLines> lines_;
    std::array<double, dnet::kLines> pos_{};
    std::array<float, dnet::kLines> level_{};
    std::array<int, dnet::kLines> order_{};
    std::array<dnet::SvfCoef, dnet::kLines> filter_{};
    float warmLp_ = 0.0f, warmHp_ = 0.0f, driveLp_ = 0.0f, crushLp_ = 0.0f, wearLp_ = 0.0f;
    double toneCache_ = -1.0;
    dnet::ClockMeter clock_;
    int active_ = 4, ctrl_ = 0, routing_ = DnetRing, prevRouting_ = DnetRing, lastLo_ = -1, lastHi_ = -1;
    int clearStage_ = -1, declickLeft_ = 0, declickLen_ = 1;
    float routeFade_ = 1.0f, freezeMix_ = 0.0f, clearGain_ = 1.0f;
    float env_ = 0.0f, slow_ = 0.0f, envRel_ = 0.9995f, slowCoef_ = 0.0005f;
    bool primed_ = false, tapeMode_ = false, armed_ = true;
    int64_t sinceOnset_ = -1;
    uint32_t seed_ = 1;
    uint64_t n_ = 0;
};

}  // namespace bleep::patch
