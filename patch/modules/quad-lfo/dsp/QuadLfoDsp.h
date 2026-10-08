// SPDX-License-Identifier: MIT
// Quad LFO core (specs/modules/quad-lfo.md): four LFOs with the LFO module's
// waves and a global mode for how they relate: independent rates, quadrature,
// an adjustable phase spread, or divisions of one rate. Free, synced to the
// song position (seekable, renders repeat) or following a clock. The waves and
// phase helpers are the shared ones in dsp/Waves.h.
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

enum QuadMode { QuadFree = 0, QuadQuadrature, QuadPhase, QuadDivide };

struct QuadParams {
    float rate[4] = {0.5407f, 0.5883f, 0.6221f, 0.6697f};  ///< Rate knobs, normalised (Hz or a note value)
    float level[4] = {1.0f, 1.0f, 1.0f, 1.0f};               ///< −1..+1
    float spread = 0.25f;                                   ///< Phase mode: offset between channels, in cycles
    float pulseWidth = 0.5f;
    int mode = QuadQuadrature;
    int wave[4] = {0, 0, 0, 0};    ///< dsp::WaveShape
    int divide[4] = {3, 4, 5, 6};  ///< index into divideNames() (÷1, ÷2, ÷3, ÷4)
    bool sync = false;
    int clockRatio = 3;            ///< index into clockRatioNames() (4 pulses)
    bool unipolar = false;
    uint32_t seed = 1;
};

struct QuadTime {
    bool running = false;
    bool started = false;
    double bpm = 120.0;
    double ppq = 0.0;
};

struct QuadFrame {
    float out[4] = {};
    float sum = 0.0f;
    float cycle[4] = {};
};

class QuadLfoDsp {
public:
    static constexpr int kChannels = 4;

    // ---- choices -------------------------------------------------------------
    static constexpr int kDivides = 13;
    static const char* divideName(int i) noexcept {
        static constexpr const char* n[kDivides] = {"\xc3\x97" "4", "\xc3\x97" "3", "\xc3\x97" "2", "\xc3\xb7" "1", "\xc3\xb7" "2",
                                                    "\xc3\xb7" "3", "\xc3\xb7" "4", "\xc3\xb7" "5", "\xc3\xb7" "6", "\xc3\xb7" "7",
                                                    "\xc3\xb7" "8", "\xc3\xb7" "12", "\xc3\xb7" "16"};
        return n[std::clamp(i, 0, kDivides - 1)];
    }
    /// Divide k as a rate multiple num/den of channel 1.
    static void divideRatio(int i, int& num, int& den) noexcept {
        static constexpr int n[kDivides] = {4, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1};
        static constexpr int d[kDivides] = {1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16};
        i = std::clamp(i, 0, kDivides - 1);
        num = n[i];
        den = d[i];
    }

    static constexpr int kClockRatios = 10;
    static int clockPulses(int i) noexcept {
        static constexpr int p[kClockRatios] = {1, 2, 3, 4, 6, 8, 12, 16, 24, 32};
        return p[std::clamp(i, 0, kClockRatios - 1)];
    }

    /// Synced rates: the shared note values from 16 bars (knob at 0) to 1/32T (knob at 1).
    static constexpr int kSyncValues = 22;
    static int syncIndex(float n) noexcept {
        return std::clamp((int)std::lround(std::clamp(n, 0.0f, 1.0f) * (kSyncValues - 1)), 0, kSyncValues - 1);
    }
    static double syncBeats(float n) noexcept { return dsp::noteValueBeats(syncIndex(n)); }
    static const char* syncName(float n) noexcept { return dsp::noteValues()[(size_t)syncIndex(n)].name; }

    /// Free rate: 0.01–50 Hz exponential (the declared knob).
    static double rateHz(float n) noexcept { return 0.01 * std::pow(5000.0, std::clamp((double)n, 0.0, 1.0)); }

    /// Channel k's output for a bipolar wave value: Unipolar maps to 0..1
    /// first, and a negative level then gives 1 − v instead of going below 0.
    static float shape(float v, float level, bool unipolar) noexcept {
        level = std::clamp(level, -1.0f, 1.0f);
        if (!unipolar) return v * level;
        const float u = dsp::waves::unipolar(v);
        return std::clamp(level >= 0.0f ? level * u : -level * (1.0f - u), 0.0f, 1.0f);
    }

    // ---- running ------------------------------------------------------------------

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        clock_.prepare(sampleRate);
        fadeStep_ = (float)(1.0 / (0.005 * sampleRate));
        reset();
    }
    void reset() noexcept {
        for (auto& p : phasors_) p.reset();
        prevCyc_.fill(0.0);
        armed_.fill(false);
        pos_.fill(0.0);
        out_.fill(0.0f);
        lastOut_.fill(0.0f);
        from_.fill(0.0f);
        fade_.fill(0.0f);
        resetIn_.reset();
        hold_.reset();
        clockIn_.reset();
        clock_.reset();
        clockPatched_ = false;
        origin_ = 0.0;
        count1_ = lastCycle1_ = 0;
        mode_ = -1;
        wasLocked_ = false;
        heldLocked_ = false;
        primed_ = false;
    }

    /// Channel k's phase (with its offset), for the view.
    double phase(int k) const noexcept { return pos_[(size_t)k] - std::floor(pos_[(size_t)k]); }
    double clockBpm() const noexcept { return clock_.bpm(); }
    bool clocked() const noexcept { return clockPatched_; }

    void tick(const QuadParams& p, float resetIn, float clockIn, bool clockPatched, float holdIn, const QuadTime& t,
              QuadFrame& f) noexcept {
        for (float& c : f.cycle) c = 0.0f;
        const bool resetEdge = resetIn_.process(resetIn) > 0;
        hold_.process(holdIn);
        const bool held = hold_.high();
        const int mode = std::clamp(p.mode, 0, 3);
        const bool shared = mode == QuadQuadrature || mode == QuadPhase;
        if (clockPatched != clockPatched_) {
            clockPatched_ = clockPatched;
            clock_.reset();
        }
        bool clockRestart = false;
        if (clockPatched) {
            clock_.setRatio(1, clockPulses(p.clockRatio));
            clockRestart = clock_.tick(clockIn_.process(clockIn) > 0);
        }
        const bool locked = p.sync && t.running && !clockPatched;

        // Divide ratios and their common period (in cycles of channel 1).
        int num[kChannels], den[kChannels];
        int repeat = 1;
        for (int k = 0; k < kChannels; ++k) {
            if (mode == QuadDivide) divideRatio(p.divide[k], num[k], den[k]);
            else num[k] = den[k] = 1;
            repeat = std::lcm(repeat, den[k]);
        }
        auto mult = [&](int k) { return (double)num[k] / (double)den[k]; };
        const double beats1 = syncBeats(p.rate[0]);

        // Mode switch: channel 1 keeps its phase, the others crossfade to their new phase.
        if (mode_ >= 0 && mode != mode_) {
            const bool wasShared = mode_ == QuadQuadrature || mode_ == QuadPhase;
            if (wasShared && !shared)
                for (int k = 1; k < kChannels; ++k) phasors_[(size_t)k].reset(phasors_[0].phase(), phasors_[0].cycle());
            for (int k = 1; k < kChannels; ++k) startFade(k);
        }
        mode_ = mode;
        if (t.started) {
            origin_ = 0.0;
            for (auto& ph : phasors_) ph.reset(0.0, ph.cycle() + 1);
            count1_ = 0;
            lastCycle1_ = phasors_[0].cycle();
        }

        double cyc[kChannels];  // continuous cycles (cycle + phase) per channel, before offsets
        if (locked) {
            if (resetEdge) origin_ = t.ppq;  // shift the grid until the next transport start
            if (held) {
                heldLocked_ = true;
                emit(f, p);
                return;
            }
            if (heldLocked_) {  // released: jump to the song position, crossfaded
                heldLocked_ = false;
                for (int k = 0; k < kChannels; ++k) startFade(k);
            }
            const double ppq = t.ppq - origin_;
            for (int k = 0; k < kChannels; ++k) {
                const int src = mode == QuadFree ? k : 0;
                const double beats = syncBeats(p.rate[src]);
                phasors_[(size_t)k].lock(ppq * mult(k), beats, t.bpm, sampleRate_, wasLocked_);
                cyc[k] = (double)phasors_[(size_t)k].cycle() + phasors_[(size_t)k].phase();
            }
            wasLocked_ = true;
        } else {
            wasLocked_ = false;
            heldLocked_ = false;
            auto hzOf = [&](int k) {
                if (k == 0 && clockPatched) return clock_.hz();
                const int src = mode == QuadFree ? k : 0;
                const double hz = p.sync ? dsp::syncedHz(t.bpm, syncBeats(p.rate[src])) : rateHz(p.rate[src]);
                return std::clamp(hz, 0.01, 50.0);
            };
            const double f1 = hzOf(0);
            if (resetEdge) {
                for (auto& ph : phasors_) ph.restart();
                count1_ = 0;
                lastCycle1_ = phasors_[0].cycle();
            } else if (!held && primed_) {  // the first sample sits at phase 0
                const int n = shared ? 1 : kChannels;
                for (int k = 0; k < n; ++k) {
                    const double hz = mode == QuadDivide ? f1 * mult(k) : mode == QuadFree ? hzOf(k) : f1;
                    phasors_[(size_t)k].advance(std::min(hz, 0.45 * sampleRate_) / sampleRate_);
                }
            }
            if (clockRestart) resync(0);  // channel 1 (and through it the shared modes) in step
            // Divide: all realign every `repeat` cycles of channel 1.
            const int64_t c1 = phasors_[0].cycle();
            if (mode == QuadDivide && c1 != lastCycle1_) {
                count1_ += c1 - lastCycle1_;
                if (count1_ % repeat == 0)
                    for (int k = 1; k < kChannels; ++k) resync(k);
            }
            for (int k = 0; k < kChannels; ++k) {
                const auto& ph = phasors_[(size_t)(shared ? 0 : k)];
                cyc[k] = (double)ph.cycle() + ph.phase();
            }
        }
        lastCycle1_ = phasors_[0].cycle();

        // Offsets (shared modes) and Cycle pulses. Each channel fires once per
        // cycle of the phase it runs on (channel 1's in the shared modes): it is
        // armed when that phase wraps and fires when the phase reaches the
        // point where the channel's offset phase wraps, 1 − offset. With a
        // steady Spread that is exactly the offset phase's wrap; a moving
        // Spread can move the point but never adds a pulse.
        const double spread = (double)std::clamp(p.spread, 0.0f, 1.0f);
        for (int k = 0; k < kChannels; ++k) {
            const double offset = mode == QuadQuadrature ? k * 0.25 : mode == QuadPhase ? k * spread : 0.0;
            const double base = std::floor(cyc[k]);
            if (!primed_ || base != std::floor(prevCyc_[(size_t)k])) armed_[(size_t)k] = true;
            const double at = dsp::wrap01(-offset);
            if (armed_[(size_t)k] && cyc[k] - base >= at - 1e-12) {
                armed_[(size_t)k] = false;
                f.cycle[k] = 1.0f;
            }
            prevCyc_[(size_t)k] = cyc[k];
            pos_[(size_t)k] = cyc[k] + offset;
        }
        primed_ = true;
        if (!(locked && held)) {
            for (int k = 0; k < kChannels; ++k) {
                const double fl = std::floor(pos_[(size_t)k]);
                const float v = dsp::waves::value(p.wave[k], pos_[(size_t)k] - fl, p.pulseWidth, p.seed, (int64_t)fl,
                                                  (uint64_t)(k + 1));
                out_[(size_t)k] = shape(v, p.level[k], p.unipolar);
            }
        }
        emit(f, p);
    }

private:
    /// Back to phase 0 for a clock or realignment: a cycle that was more than
    /// half done counts as finished (one Cycle pulse), one that had just
    /// wrapped doesn't fire again.
    void resync(int k) noexcept {
        dsp::Phasor& ph = phasors_[(size_t)k];
        ph.reset(0.0, ph.phase() >= 0.5 ? ph.cycle() + 1 : ph.cycle());
    }
    void startFade(int k) noexcept {
        from_[(size_t)k] = lastOut_[(size_t)k];
        fade_[(size_t)k] = 1.0f;
    }
    void emit(QuadFrame& f, const QuadParams&) noexcept {
        float sum = 0.0f;
        for (int k = 0; k < kChannels; ++k) {
            float v = out_[(size_t)k];
            if (fade_[(size_t)k] > 0.0f) {
                v += fade_[(size_t)k] * (from_[(size_t)k] - v);
                fade_[(size_t)k] = std::max(0.0f, fade_[(size_t)k] - fadeStep_);
            }
            lastOut_[(size_t)k] = v;
            f.out[k] = v;
            sum += v;
        }
        f.sum = sum / kChannels;
    }

    double sampleRate_ = 48000.0;
    std::array<dsp::Phasor, kChannels> phasors_;
    std::array<double, kChannels> prevCyc_{}, pos_{};
    std::array<bool, kChannels> armed_{};
    std::array<float, kChannels> out_{}, lastOut_{}, from_{}, fade_{};
    float fadeStep_ = 1.0f / 240.0f;
    dsp::GateEdge resetIn_, hold_, clockIn_;
    dsp::ClockLock clock_;
    bool clockPatched_ = false;
    double origin_ = 0.0;
    int64_t count1_ = 0, lastCycle1_ = 0;
    int mode_ = -1;
    bool wasLocked_ = false, heldLocked_ = false, primed_ = false;
};

}  // namespace bleep::patch
