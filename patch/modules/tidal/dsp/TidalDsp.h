// SPDX-License-Identifier: MIT
// Tidal core (specs/modules/tidal.md): a slope oscillator from minutes-long
// swells to audio rate, run as a loop, an AD or an AR envelope, with four
// related outputs (ratio, phase, level or harmonic relations), smoothing or
// folding per output, and a clock follower. The slope, curves, smoother and
// clock lock are the shared ones in dsp/Slope.h.
#pragma once

#include "dsp/Slope.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"
#include "dsp/Waves.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <numeric>

namespace bleep::patch {

enum TidalMode { TidalAD = 0, TidalLoop, TidalAR };
enum TidalRange { TidalSlow = 0, TidalMedium, TidalAudio };
enum TidalRelation { TidalRatio = 0, TidalPhase, TidalLevel, TidalHarmonic };

struct TidalParams {
    float freq = 0.5f;      ///< Frequency knob, normalised 0..1 (mapped by Range)
    float pitch = 0.0f;     ///< octaves (1 V/oct)
    float skew = 0.5f;      ///< share of the cycle spent rising
    float curve = 0.0f;     ///< −1..+1
    float smooth = 0.0f;    ///< −1 low-pass … +1 fold
    float spread = 0.0f;    ///< −1..+1
    int mode = TidalLoop;
    int range = TidalMedium;
    int relation = TidalPhase;
    int sync = 0;           ///< 0 = free, else an index into syncNames()
    int ratio = 6;          ///< index into ratioNames() (×1)
    bool unipolar = false;  ///< Loop only; AD and AR are always unipolar
};

struct TidalTime {
    bool running = false;   ///< transport playing with a valid position
    bool started = false;   ///< first sample after the transport started
    double bpm = 120.0;
    double ppq = 0.0;
};

struct TidalFrame {
    float out[4] = {0.0f, 0.0f, 0.0f, 0.0f};
    float rise = 0.0f;
    float end = 0.0f;
};

class TidalDsp {
public:
    static constexpr int kOutputs = 4;
    static constexpr double kC4 = 261.6255653005986;

    // ---- choices ---------------------------------------------------------

    /// Sync: Free, then the shared note values from 8 bars to 1/32T.
    static constexpr int kFirstSyncValue = 1, kLastSyncValue = 21;
    static constexpr int kSyncChoices = 1 + kLastSyncValue - kFirstSyncValue + 1;
    static const char* syncName(int i) noexcept {
        return i <= 0 ? "Free" : dsp::noteValues()[(size_t)(kFirstSyncValue + std::min(i, kSyncChoices - 1) - 1)].name;
    }
    /// Length of a sync choice in quarter notes (0 for Free).
    static double syncBeats(int i) noexcept {
        return i <= 0 ? 0.0 : dsp::noteValueBeats(kFirstSyncValue + std::min(i, kSyncChoices - 1) - 1);
    }

    static constexpr int kRatios = 13;
    static const char* ratioName(int i) noexcept {
        static constexpr const char* names[kRatios] = {"\xc3\xb7" "16", "\xc3\xb7" "8", "\xc3\xb7" "6", "\xc3\xb7" "4", "\xc3\xb7" "3",
                                                       "\xc3\xb7" "2", "\xc3\x97" "1", "\xc3\x97" "2", "\xc3\x97" "3", "\xc3\x97" "4",
                                                       "\xc3\x97" "6", "\xc3\x97" "8", "\xc3\x97" "16"};
        return names[std::clamp(i, 0, kRatios - 1)];
    }
    /// +n = ×n, −n = ÷n (as dsp::ClockLock::setRatio takes it).
    static int signedRatio(int i) noexcept {
        static constexpr int r[kRatios] = {-16, -8, -6, -4, -3, -2, 1, 2, 3, 4, 6, 8, 16};
        return r[std::clamp(i, 0, kRatios - 1)];
    }

    /// Frequency knob (0..1) → Hz for a Range. Slow 0.001–1 Hz and Medium
    /// 0.02–50 Hz are exponential; Audio is exponential on each half, 8 Hz …
    /// C4 at the centre … 8 kHz.
    static double rangeHz(int range, float n) noexcept {
        const double x = std::clamp((double)n, 0.0, 1.0);
        switch (range) {
            case TidalSlow: return 0.001 * std::pow(1000.0, x);
            case TidalAudio:
                return x < 0.5 ? 8.0 * std::pow(kC4 / 8.0, 2.0 * x) : kC4 * std::pow(8000.0 / kC4, 2.0 * x - 1.0);
            default: return 0.02 * std::pow(2500.0, x);
        }
    }

    /// Ratio relation: the ratio set for Spread (zones of |s|, 0 = all ×1).
    struct RatioSet {
        int num[kOutputs], den[kOutputs];
        int repeat;  ///< cycles of A after which all outputs realign
    };
    static RatioSet ratioSet(float spread) noexcept {
        static constexpr int zones[6][3][2] = {{{1, 1}, {1, 1}, {1, 1}}, {{2, 1}, {3, 1}, {4, 1}}, {{3, 2}, {2, 1}, {3, 1}},
                                               {{4, 3}, {3, 2}, {2, 1}}, {{5, 4}, {3, 2}, {7, 4}}, {{5, 3}, {7, 4}, {9, 4}}};
        const int z = std::clamp((int)std::lround(std::fabs(spread) * 5.0f), 0, 5);
        RatioSet r{{1, 1, 1, 1}, {1, 1, 1, 1}, 1};
        for (int k = 1; k < kOutputs; ++k) {
            int n = zones[z][k - 1][0], d = zones[z][k - 1][1];
            if (spread < 0.0f) std::swap(n, d);
            r.num[k] = n;
            r.den[k] = d;
            r.repeat = std::lcm(r.repeat, d);
        }
        return r;
    }

    /// Frequency multiple of output k (k = 0 is A) in the Ratio and Harmonic relations.
    static double outputRatio(int relation, float spread, int k) noexcept {
        if (relation == TidalRatio) {
            const RatioSet r = ratioSet(spread);
            return (double)r.num[k] / (double)r.den[k];
        }
        if (relation == TidalHarmonic) {
            const double s = std::clamp((double)spread, -1.0, 1.0);
            return s >= 0.0 ? 1.0 + k * s : 1.0 / (1.0 + k * -s);
        }
        return 1.0;
    }

    // ---- running ------------------------------------------------------------

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        clock_.prepare(sampleRate);
        for (auto& s : slopes_) s.prepare(sampleRate);
        for (auto& s : smoothers_) s.prepare(sampleRate);
        reset();
    }

    void reset() noexcept {
        for (auto& s : slopes_) s.reset();
        for (auto& s : smoothers_) s.reset();
        for (auto& c : comp_) c = Compensation{};
        for (auto& d : delayed_) d = DelayedGate{};
        phases_.fill(0.0);
        cycles_ = 0;
        now_ = 0;
        trig_.reset();
        clockEdge_.reset();
        clock_.reset();
        clockPatched_ = false;
        hz_ = 1.0;
    }

    /// Phase of A (for the view's dot) and its current frequency.
    double phase() const noexcept { return slopes_[0].phase(); }
    double hz() const noexcept { return hz_; }
    double clockBpm() const noexcept { return clock_.bpm(); }
    bool clocked() const noexcept { return clockPatched_; }

    void tick(const TidalParams& p, float trigIn, float clockIn, bool clockPatched, const TidalTime& t,
              TidalFrame& f) noexcept {
        ++now_;
        f.rise = f.end = 0.0f;
        const int edge = trig_.process(trigIn);
        const bool loop = p.mode == TidalLoop;
        const dsp::SlopeMode mode = p.mode == TidalAD ? dsp::SlopeMode::AD
                                    : p.mode == TidalAR ? dsp::SlopeMode::AR
                                                        : dsp::SlopeMode::Loop;
        if (clockPatched != clockPatched_) {  // a new clock: count from its first pulse
            clockPatched_ = clockPatched;
            clock_.reset();
        }
        if (t.started && loop) restartAll();

        // Frequency: Clock overrides Sync, Sync overrides Frequency.
        const double beats = syncBeats(p.sync);
        const bool locked = !clockPatched && beats > 0.0 && t.running && loop;
        const double octave = beats > 0.0 ? std::exp2(std::round((double)p.pitch)) : 1.0;  // whole octaves when synced
        bool clockReset = false;
        if (clockPatched) {
            clock_.setRatio(signedRatio(p.ratio));
            clockReset = clock_.tick(clockEdge_.process(clockIn) > 0);
            hz_ = clock_.hz();
        } else if (beats > 0.0) {
            hz_ = dsp::syncedHz(t.bpm, beats) * octave;
        } else {
            hz_ = dsp::voctHz(rangeHz(p.range, p.freq), (double)p.pitch);
        }
        const double maxHz = p.range == TidalAudio ? 0.25 * sampleRate_ : 0.49 * sampleRate_;
        hz_ = std::clamp(hz_, 0.0, maxHz);

        dsp::SlopeParams sp;
        sp.hz = hz_;
        sp.skew = p.range == TidalAudio ? std::clamp(p.skew, 0.005f, 0.995f) : std::clamp(p.skew, 0.0f, 1.0f);
        sp.curve = p.curve;
        sp.morphCurve = true;
        sp.mode = mode;

        const int rel = p.relation;
        const bool ratioRel = rel == TidalRatio || rel == TidalHarmonic;
        float v[kOutputs];       // curved slopes 0..1
        double rate[kOutputs];   // cycle rate per output (for the smoother)
        bool wrapped[kOutputs];  // cycle start per output (for the level compensation)

        // ---- A
        dsp::SlopeFrame a;
        if (locked) {
            a = slopes_[0].tickAt(sp, dsp::ppqPhase(t.ppq, beats, octave));
        } else {
            if (loop && clockReset) slopes_[0].resync();
            a = slopes_[0].tick(sp, trigIn);
        }
        if (loop && edge > 0 && !locked) restartOthers();
        v[0] = a.value;
        rate[0] = hz_;
        wrapped[0] = a.endOfCycle;
        f.rise = a.rising ? 1.0f : 0.0f;
        f.end = a.endOfCycle ? 1.0f : 0.0f;
        if (loop && a.endOfCycle && !locked && rel == TidalRatio) {
            const int repeat = ratioSet(p.spread).repeat;
            if (++cycles_ % repeat == 0) restartOthers();  // realign at the common period
        }

        // ---- B, C, D
        for (int k = 1; k < kOutputs; ++k) {
            dsp::SlopeParams q = sp;
            if (ratioRel) {
                const double ratio = outputRatio(rel, p.spread, k);
                q.hz = std::min(hz_ * ratio, maxHz);
                rate[k] = q.hz;
                if (!loop) {
                    const dsp::SlopeFrame g = slopes_[(size_t)k].tick(q, trigIn);
                    v[k] = g.value;
                    wrapped[k] = false;
                    continue;
                }
                double ph;
                if (locked) {
                    ph = dsp::ppqPhase(t.ppq, beats, octave * ratio);
                } else {
                    ph = phases_[(size_t)k] + q.hz / sampleRate_;
                    ph -= std::floor(ph);
                }
                phases_[(size_t)k] = ph;
                const dsp::SlopeFrame g = slopes_[(size_t)k].tickAt(q, ph);
                v[k] = g.value;
                wrapped[k] = g.endOfCycle;
            } else if (rel == TidalPhase) {
                rate[k] = hz_;
                if (loop) {
                    const double ph = a.phase + k * (double)std::clamp(p.spread, -1.0f, 1.0f) / 4.0;
                    const dsp::SlopeFrame g = slopes_[(size_t)k].tickAt(q, ph - std::floor(ph));
                    v[k] = g.value;
                    wrapped[k] = g.endOfCycle;
                } else {
                    // Envelopes: output k starts k·|Spread|/4 of a cycle later.
                    const double delay = hz_ > 0.0 ? k * std::fabs((double)p.spread) / 4.0 / hz_ * sampleRate_ : 0.0;
                    const float g = delayed_[(size_t)k].process(edge, trig_.high(), now_, (int64_t)std::llround(delay));
                    v[k] = slopes_[(size_t)k].tick(q, g).value;
                    wrapped[k] = false;
                }
            } else {  // Level: from A, scaled after smoothing (below)
                v[k] = v[0];
                rate[k] = hz_;
                wrapped[k] = wrapped[0];
            }
        }

        // ---- Smooth (per output), polarity, level relation
        const int smoothed = rel == TidalLevel ? 1 : kOutputs;
        float u[kOutputs];
        for (int k = 0; k < smoothed; ++k) {
            const float x = v[k];
            float y = smoothers_[(size_t)k].process(x, rate[k], p.smooth);
            if (p.smooth < 0.0f && loop) y = comp_[(size_t)k].process(x, y, wrapped[k]);
            else comp_[(size_t)k] = Compensation{};
            u[k] = std::clamp(y, 0.0f, 1.0f);
        }
        const bool bipolar = loop && !p.unipolar;
        for (int k = 0; k < kOutputs; ++k) {
            if (rel == TidalLevel) {
                const float s = std::clamp(p.spread, -1.0f, 1.0f);
                const float g = 1.0f - k * std::fabs(s) / 3.0f;
                const bool invert = s < 0.0f && (k % 2) == 1;
                if (bipolar) f.out[k] = g * (invert ? -1.0f : 1.0f) * (2.0f * u[0] - 1.0f);
                else f.out[k] = g * (invert ? 1.0f - u[0] : u[0]);
            } else {
                f.out[k] = bipolar ? 2.0f * u[k] - 1.0f : u[k];
            }
        }
    }

private:
    /// Smooth −1 lowers the level (a 2-pole low-pass at the cycle rate); this
    /// restores it: once per cycle the filtered range is measured and mapped
    /// back onto the unfiltered one (gain and centre glide from cycle to cycle).
    struct Compensation {
        float inLo = 1e9f, inHi = -1e9f, outLo = 1e9f, outHi = -1e9f;
        float gain = 1.0f, inMid = 0.5f, outMid = 0.5f;
        bool measured = false;
        float process(float x, float y, bool cycleStart) noexcept {
            if (cycleStart) {
                const float inPP = inHi - inLo, outPP = outHi - outLo;
                if (inHi >= inLo && outHi >= outLo) {
                    const float g = outPP > 1e-4f ? std::clamp(inPP / outPP, 1.0f, 8.0f) : 1.0f;
                    const float k = measured ? 0.5f : 1.0f;
                    gain += k * (g - gain);
                    inMid += k * (0.5f * (inHi + inLo) - inMid);
                    outMid += k * (0.5f * (outHi + outLo) - outMid);
                    measured = true;
                }
                inLo = outLo = 1e9f;
                inHi = outHi = -1e9f;
            }
            inLo = std::min(inLo, x);
            inHi = std::max(inHi, x);
            outLo = std::min(outLo, y);
            outHi = std::max(outHi, y);
            return measured ? inMid + (y - outMid) * gain : y;
        }
    };

    /// The Trig gate, delayed (Phase relation in AD and AR): rising and falling
    /// edges are replayed `delay` samples later.
    struct DelayedGate {
        static constexpr int kEvents = 8;
        int64_t due[kEvents] = {};
        bool level[kEvents] = {};
        int head = 0, count = 0;
        bool high = false;
        float process(int edge, bool inputHigh, int64_t now, int64_t delay) noexcept {
            if (delay <= 0) {
                count = 0;
                high = inputHigh;
                return high ? 1.0f : 0.0f;
            }
            if (edge != 0) {
                if (count == kEvents) {  // full: drop the oldest
                    head = (head + 1) % kEvents;
                    --count;
                }
                const int i = (head + count) % kEvents;
                due[i] = now + delay;
                level[i] = edge > 0;
                ++count;
            }
            while (count > 0 && due[head] <= now) {
                high = level[head];
                head = (head + 1) % kEvents;
                --count;
            }
            return high ? 1.0f : 0.0f;
        }
    };

    void restartOthers() noexcept {
        for (int k = 1; k < kOutputs; ++k) phases_[(size_t)k] = 0.0;
        cycles_ = 0;
    }
    void restartAll() noexcept {
        slopes_[0].setPhase(0.0);
        restartOthers();
    }

    double sampleRate_ = 48000.0;
    std::array<dsp::Slope, kOutputs> slopes_;
    std::array<dsp::SlopeSmoother, kOutputs> smoothers_;
    std::array<Compensation, kOutputs> comp_;
    std::array<DelayedGate, kOutputs> delayed_;
    std::array<double, kOutputs> phases_{};
    int64_t cycles_ = 0;
    int64_t now_ = 0;
    dsp::GateEdge trig_, clockEdge_;
    dsp::ClockLock clock_;
    bool clockPatched_ = false;
    double hz_ = 1.0;
};

}  // namespace bleep::patch
