// SPDX-License-Identifier: GPL-3.0-only
// Uncertainty (doc/specs/modules/uncertainty.md): six random generators with
// different characters. Two Fluctuating curves (Catmull-Rom through randomly
// spaced points), two Quantized voltages on 2^Bits levels, a Stored value with
// Shape, Distribution and Correlation (an AR(1) process in a Gaussian domain,
// mapped back to uniform), and an Integrated voltage that uses the stored
// values as slopes.
//
// Every fresh value is uniform01(seed, index, stream); synced generators take
// the index from the song position, so they render identically from any start.
#pragma once

#include "dsp/Random.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

/// Random streams, one per generator (spec 2: "each its own stream of one Seed").
namespace ustream {
constexpr uint64_t kFluctValue[2] = {11, 21}, kFluctSpacing[2] = {12, 22};
constexpr uint64_t kQuant[2] = {31, 32};
constexpr uint64_t kStored = 41;
}  // namespace ustream

enum class UShape { Uniform, Bell, Edges };

struct UncertaintyParams {
    std::array<float, 2> fRate{0.5f, 0.17f}, fSpread{1.0f, 1.0f};
    float qRate = 2.0f, storeRate = 1.0f;
    float distribution = 0.0f;  ///< −1..+1
    float correlation = 0.0f;   ///< −0.95..+0.95
    float integrate = 0.5f;     ///< slope scale, 1/s
    int fSync = 0, qSync = 3, storeSync = 4;  ///< dsp::syncNames() indices (Free, 1/8, 1/4)
    std::array<int, 2> bits{3, 2};
    std::array<int, 2> interval{0, 0};  ///< semitones per level; 0 = Even
    int q2Divide = 2;
    UShape shape = UShape::Uniform;
    uint32_t seed = 1;
};

struct UncertaintyInput {
    float clockQ1 = 0.0f, clockQ2 = 0.0f, store = 0.0f;
    bool q1Patched = false, q2Patched = false, storePatched = false;
    bool running = false;  ///< transport playing with a valid position
    bool started = false;  ///< first sample after the transport started
    double ppq = 0.0, bpm = 120.0;
};

struct UncertaintyFrame {
    std::array<float, 2> fluct{}, quant{};
    float stored = 0.0f, integrated = 0.0f, storeTrig = 0.0f;
};

/// One generator's clock (spec 4.5): its jack if patched, else the transport
/// grid when synced (while the transport is stopped: free at the synced
/// length, continuing from the grid's phase), else a free rate.
class EventClock {
public:
    struct Event {
        bool fire = false;
        bool jump = false;     ///< synced: the index isn't the previous one + 1
        bool synced = false;   ///< the index is a grid index
        int64_t index = 0;
        double seconds = 0.0;  ///< the event period (synced: exact; else an estimate)
    };

    void reset() noexcept {
        edge_.reset();
        counter_ = -1;
        have_ = locked_ = false;
        phase_ = 0.0;
        since_ = 0;
        period_ = 0;
    }
    /// Transport start: counters restart at 0 (free clocks fire at once).
    void restart() noexcept {
        counter_ = -1;
        have_ = false;
        phase_ = 0.0;
    }

    Event tick(bool patched, float jack, bool running, double ppq, double beats, double rateHz, double bpm,
               double sampleRate) noexcept {
        Event e;
        if (patched) {
            locked_ = false;
            ++since_;
            if (edge_.process(jack) > 0) {
                if (have_) period_ = since_;
                since_ = 0;
                have_ = true;
                e.fire = true;
                e.index = ++counter_;
            }
            e.seconds = period_ > 0 ? (double)period_ / sampleRate : 1.0 / std::max(rateHz, 1e-3);
        } else if (beats > 0.0) {
            e.synced = true;
            e.seconds = beats * 60.0 / std::max(bpm, 1.0);
            if (!running) {  // stopped: free at the synced length, from the grid's phase
                locked_ = false;
                phase_ += 1.0 / (e.seconds * sampleRate);
                if (!have_ || phase_ >= 1.0) {
                    phase_ -= std::floor(phase_);
                    have_ = true;
                    e.fire = true;
                    e.synced = false;
                    e.index = ++counter_;
                }
                return e;
            }
            phase_ = dsp::wrap01(ppq / beats);
            const int64_t n = (int64_t)std::floor(ppq / beats);
            if (!locked_ || !have_ || n != counter_) {
                e.fire = true;
                e.jump = locked_ && have_ && n != counter_ + 1;
                e.index = n;
            }
            locked_ = have_ = true;
            counter_ = n;
        } else {
            locked_ = false;
            const double hz = std::max(rateHz, 1e-3);
            e.seconds = 1.0 / hz;
            phase_ += hz / sampleRate;
            if (!have_ || phase_ >= 1.0) {
                phase_ -= std::floor(phase_);
                have_ = true;
                e.fire = true;
                e.index = ++counter_;
            }
        }
        return e;
    }

private:
    dsp::GateEdge edge_;
    int64_t counter_ = -1, since_ = 0, period_ = 0;
    bool have_ = false, locked_ = false;
    double phase_ = 0.0;
};

class UncertaintyDsp {
public:
    static constexpr std::array<int, 6> kIntervals{0, 1, 2, 5, 7, 12};
    static constexpr std::array<int, 5> kDivides{1, 2, 3, 4, 8};
    static constexpr int kSumTerms = 512;      ///< truncation of the correlated sum (4.3)
    static constexpr int kRebuildEvents = 64;  ///< Integrated: Store intervals replayed on a jump (4.4)

    // ---- pure functions --------------------------------------------------------

    /// Quantized output for a level (4.2): Even spreads 0..1, else level · n / 12.
    static float quantValue(int level, int bits, int interval) noexcept {
        const int top = (1 << std::clamp(bits, 1, 4)) - 1;
        const float v = interval <= 0 ? (float)level / (float)top : (float)(level * interval) / 12.0f;
        return std::clamp(v, -10.0f, 10.0f);
    }
    static int quantLevel(uint32_t seed, int64_t index, int q, int bits) noexcept {
        const int n = 1 << std::clamp(bits, 1, 4);
        return std::min(n - 1, (int)std::floor(dsp::uniform01(seed, (uint64_t)index, ustream::kQuant[q]) * n));
    }

    /// z_k = √(1 − c²) · Σ_{j=0..511} c^j · n_{k−j}: a pure function of k, equal
    /// to the AR(1) recursion z_k = c·z_{k−1} + √(1 − c²)·n_k (spec 4.3).
    static double correlatedNormal(uint32_t seed, int64_t k, double c) noexcept {
        c = std::clamp(c, -0.95, 0.95);
        double sum = 0.0, w = 1.0;
        for (int j = 0; j < kSumTerms; ++j) {
            sum += w * dsp::standardNormal(seed, (uint64_t)(k - j), ustream::kStored);
            w *= c;
            if (std::fabs(w) < 1e-13) break;
        }
        return std::sqrt(1.0 - c * c) * sum;
    }
    /// The uniform 0..1 behind the stored value k (before Shape and Distribution).
    static double storedUniform(uint32_t seed, int64_t k, double c) noexcept {
        return dsp::normalCdf(correlatedNormal(seed, k, c));
    }
    /// Shape, then Distribution, then −1..+1.
    static double shapeStored(double u, UShape shape, double distribution) noexcept {
        if (shape == UShape::Bell) u = dsp::inverseSmoothstep01(u);
        else if (shape == UShape::Edges) u = dsp::smoothstep01(u);
        return 2.0 * dsp::skew01(u, distribution) - 1.0;
    }
    static double storedValue(uint32_t seed, int64_t k, const UncertaintyParams& p) noexcept {
        return shapeStored(storedUniform(seed, k, p.correlation), p.shape, p.distribution);
    }
    /// Integrated's fold: J runs freely, the output reflects at ±1.
    static double foldIntegrated(double j) noexcept {
        const double t = j + 1.0 - 4.0 * std::floor((j + 1.0) / 4.0);  // 0..4
        return t <= 2.0 ? t - 1.0 : 3.0 - t;
    }

    // ---- running -------------------------------------------------------------------

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        reset();
    }

    void reset() noexcept {
        q1_.reset();
        q2_.reset();
        store_.reset();
        for (auto& f : fluct_) f = Fluct{};
        quant_ = {0.0f, 0.0f};
        stored_ = 0.0;
        integral_ = 0.0;
    }

    void tick(const UncertaintyParams& p, const UncertaintyInput& in, UncertaintyFrame& out) noexcept {
        if (in.started) {
            q1_.restart();
            q2_.restart();
            store_.restart();
            for (auto& f : fluct_) f.started = false;
            integral_ = 0.0;
        }
        for (int k = 0; k < 2; ++k) out.fluct[(size_t)k] = fluct(k, p, in);

        // Quantized (4.2): Q2 follows Q1 divided while its jack is unpatched.
        const auto e1 = q1_.tick(in.q1Patched, in.clockQ1, in.running, in.ppq, dsp::syncBeats(p.qSync), p.qRate, in.bpm,
                                 sampleRate_);
        if (e1.fire) quant_[0] = quantValue(quantLevel(p.seed, e1.index, 0, p.bits[0]), p.bits[0], p.interval[0]);
        if (in.q2Patched) {
            const auto e2 = q2_.tick(true, in.clockQ2, in.running, in.ppq, 0.0, p.qRate, in.bpm, sampleRate_);
            if (e2.fire) quant_[1] = quantValue(quantLevel(p.seed, e2.index, 1, p.bits[1]), p.bits[1], p.interval[1]);
        } else if (e1.fire) {
            const int64_t div = std::max(1, p.q2Divide);
            const int64_t m = ((e1.index % div) + div) % div;
            if (m == 0) {
                const int64_t i2 = (e1.index - m) / div;
                quant_[1] = quantValue(quantLevel(p.seed, i2, 1, p.bits[1]), p.bits[1], p.interval[1]);
            }
        }
        out.quant = quant_;

        // Stored (4.3) and Integrated (4.4).
        out.storeTrig = 0.0f;
        const double storeBeats = dsp::syncBeats(p.storeSync);
        const auto es = store_.tick(in.storePatched, in.store, in.running, in.ppq, storeBeats, p.storeRate, in.bpm,
                                    sampleRate_);
        if (es.fire) {
            stored_ = storedValue(p.seed, es.index, p);
            out.storeTrig = 1.0f;
            if (es.jump) rebuildIntegral(p, es.index, es.seconds, in.ppq / storeBeats - (double)es.index);
        }
        integral_ += stored_ * (double)p.integrate / sampleRate_;
        if (integral_ >= 3.0 || integral_ < -1.0) integral_ = foldRange(integral_);
        out.stored = (float)stored_;
        out.integrated = (float)foldIntegrated(integral_);
    }

    /// Free Fluctuating k: the index of the current segment's first point.
    int64_t fluctSegment(int k) const noexcept { return fluct_[(size_t)k].j; }
    double integral() const noexcept { return integral_; }

private:
    struct Fluct {
        bool started = false;
        int64_t j = 0;      ///< free mode: index of the point at the segment start
        double t = 0.0;     ///< position in the segment, 0..1
        double last = 0.0;  ///< the last unit value (held while a synced curve is stopped)
        std::array<double, 4> pts{};
    };

    /// Fluctuating (4.1): synced, a pure function of the song position; free,
    /// a curve through randomly spaced points that keeps moving.
    float fluct(int k, const UncertaintyParams& p, const UncertaintyInput& in) noexcept {
        const double spread = std::clamp((double)p.fSpread[(size_t)k], 0.0, 1.0);
        const double beats = dsp::syncBeats(p.fSync);
        Fluct& f = fluct_[(size_t)k];
        const uint64_t sv = ustream::kFluctValue[k], st = ustream::kFluctSpacing[k];
        if (beats > 0.0 && in.running) {
            f.started = false;  // free mode restarts at its point 0 afterwards
            f.last = dsp::smoothNoise(p.seed, sv, in.ppq / beats);
            return (float)(spread * f.last);
        }
        if (beats > 0.0 && !in.running) return (float)(spread * f.last);
        if (!f.started) {
            f.started = true;
            f.j = 0;
            f.t = 0.0;
            for (int i = 0; i < 4; ++i) f.pts[(size_t)i] = dsp::noisePoint(p.seed, i - 1, sv);
        }
        const double seg = (0.5 + dsp::uniform01(p.seed, (uint64_t)f.j, st)) / std::max((double)p.fRate[(size_t)k], 1e-3);
        f.t += 1.0 / (seg * sampleRate_);
        while (f.t >= 1.0) {
            f.t -= 1.0;
            ++f.j;
            f.pts = {f.pts[1], f.pts[2], f.pts[3], dsp::noisePoint(p.seed, f.j + 2, sv)};
            f.t = std::min(f.t, 0.999999);
        }
        f.last = std::clamp(dsp::catmullRom(f.pts[0], f.pts[1], f.pts[2], f.pts[3], f.t), -1.0, 1.0);
        return (float)(spread * f.last);
    }

    static double foldRange(double j) noexcept { return j + 1.0 - 4.0 * std::floor((j + 1.0) / 4.0) - 1.0; }

    /// A jump with a synced Store: integrate the last 64 intervals from 0 (4.4).
    void rebuildIntegral(const UncertaintyParams& p, int64_t index, double seconds, double frac) noexcept {
        double j = 0.0;
        const double scale = (double)p.integrate * seconds;
        // One direct sum, then the recursion (the same values to ~1e-12, 8× cheaper).
        const double c = std::clamp((double)p.correlation, -0.95, 0.95), g = std::sqrt(1.0 - c * c);
        double z = correlatedNormal(p.seed, index - kRebuildEvents, c);
        for (int64_t k = index - kRebuildEvents; k < index; ++k) {
            if (k > index - kRebuildEvents) z = c * z + g * dsp::standardNormal(p.seed, (uint64_t)k, ustream::kStored);
            j += shapeStored(dsp::normalCdf(z), p.shape, p.distribution) * scale;
        }
        j += stored_ * scale * std::clamp(frac, 0.0, 1.0);
        integral_ = foldRange(j);
    }

    double sampleRate_ = 48000.0;
    EventClock q1_, q2_, store_;
    std::array<Fluct, 2> fluct_{};
    std::array<float, 2> quant_{};
    double stored_ = 0.0, integral_ = 0.0;
};

}  // namespace bleep::patch
