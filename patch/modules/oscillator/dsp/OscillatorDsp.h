// SPDX-License-Identifier: GPL-3.0-only
// Oscillator: a triangle-core oscillator with a primary and a secondary waveform
// (Morph crossfades between them), linear FM (through zero or clamped at 0 Hz)
// or exponential FM or phase modulation, and hard sync. A sub oscillator (square
// or sine or a copy of the main waveform, one or two octaves down) is mixed in at its own level; Drift detunes
// it all by a slow seeded wander; Reset (and Sync) restart the cycle at Phase;
// syncOut() is a short pulse at the start of every cycle. Saw, square and the
// square sub are band-limited (polyBLEP).
// Through-zero FM: the phase runs backwards when the instantaneous frequency
// goes negative, so deep linear FM stays in tune. The core itself is the
// shared dsp::OscCore (common/dsp/OscCore.h).
#pragma once

#include "dsp/OscCore.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

/// The waveforms the Oscillator offers, in the order of its Waveform choices.
enum class OscWave { Sine, Triangle, Saw, Square };

/// The sub oscillator's waveforms, in the order of its Sub Wave choices; Main copies Waveform / Secondary / Morph
/// and Pulse Width.
enum class OscSubWave { Square, Sine, Main };

struct OscillatorParams {
    float pitch = 0.0f;              ///< octaves (1 V/oct): Tuned: octave + semitones + cents + input, from C4;
                                     ///< Free: the input alone, from freeHz
    bool freePitch = false;          ///< Free pitch mode: pitch 0 is freeHz instead of C4
    float freeHz = 0.0f;             ///< Free: Coarse + Fine in Hz (never below 0 Hz)
    OscWave wave = OscWave::Saw;     ///< primary waveform (Morph 0)
    OscWave wave2 = OscWave::Square; ///< secondary waveform (Morph 1)
    float morph = 0.0f;              ///< 0..1: crossfade from wave to wave2
    float pulseWidth = 0.5f;         ///< 0.05..0.95, for the square
    float fmDepth = 0.0f;            ///< 0..1: linear FM index (×4), or ±4 octaves exponential
    bool expFm = false;              ///< exponential FM (in octaves, never below 0 Hz) instead of linear
    bool throughZero = true;         ///< linear FM: negative frequencies run the phase backwards; off: clamped at 0 Hz
    bool hardSync = true;            ///< rising edges at Sync restart the cycle
    bool phaseMod = false;           ///< phase modulation instead of FM: ±fmDepth cycles of phase (expFm ignored)
    float phase = 0.0f;              ///< 0..1: where Reset and Sync restart the cycle
    float subLevel = 0.0f;           ///< 0..1: the sub oscillator, added to the waveform
    int subOctaves = 1;              ///< 1 or 2 octaves below
    OscSubWave subWave = OscSubWave::Square;  ///< the sub's waveform
    float drift = 0.0f;              ///< 0..1: seeded pitch wander, ±kDriftCents at 1
};

class OscillatorDsp {
public:
    static constexpr double kC4 = dsp::osc::kC4Hz;

    static constexpr float kDriftCents = 10.0f;   ///< slow wander at Drift 1 (plus a quarter of it, faster)
    static constexpr double kPmCycles = 1.0;      ///< phase modulation at depth 1 and ±1 in: ±1 cycle (±2π)
    static constexpr double kSyncPulse = 0.001;   ///< Sync Out: 1 ms, at most half a cycle

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        slow_.prepare(sampleRate, 0.15);
        fast_.prepare(sampleRate, 2.3);
        seedDrift(seed_);
    }
    void reset() noexcept {
        core_.reset();
        lastSync_ = false;
        lastReset_ = false;
        subCount_ = 0;
        lastPm_ = 0.0;
        syncOut_ = false;
    }
    /// Seeds (and rewinds) the drift walks: each instance gets its own, so two oscillators drift apart.
    void seedDrift(uint64_t seed) noexcept {
        seed_ = seed;
        slow_.reset(seed, 0x05c1a7e0ull);
        fast_.reset(seed, 0x05c1a7e1ull);
    }
    /// The Sync Out pulse of the sample tick() just returned: high for 1 ms (at most half a cycle) from the
    /// start of each cycle.
    bool syncOut() const noexcept { return syncOut_; }

    static float frequency(float pitchOctaves) noexcept { return (float)dsp::osc::pitchToHz((double)pitchOctaves); }

    static float pick(const dsp::OscWaves& w, OscWave wave) noexcept {
        switch (wave) {
            case OscWave::Sine: return w.sine;
            case OscWave::Triangle: return w.triangle;
            case OscWave::Saw: return w.saw;
            case OscWave::Square: return w.square;
        }
        return w.saw;
    }

    /// The old single Shape knob (0 sine, 1/3 triangle, 2/3 saw, 1 square, neighbours crossfaded) as a
    /// Waveform / Secondary / Morph setting that sounds the same.
    static void setShape(OscillatorParams& p, float shape) noexcept {
        const float m = std::clamp(shape, 0.0f, 1.0f) * 3.0f;
        const int i = std::min((int)m, 2);
        p.wave = (OscWave)i;
        p.wave2 = (OscWave)(i + 1);
        p.morph = m - (float)i;
    }

    /// One sample. `fm` is the FM input (audio, ±1), `sync` the sync input (gate), `reset` the reset input
    /// (trigger): rising edges at Reset always, at Sync with Hard Sync on, restart the cycle at Phase.
    float tick(const OscillatorParams& p, float fm, float sync, float reset = 0.0f) noexcept {
        const bool syncHigh = sync >= 0.5f, resetHigh = reset >= 0.5f;
        if ((p.hardSync && syncHigh && !lastSync_) || (resetHigh && !lastReset_)) restart(p.phase);
        lastSync_ = syncHigh;
        lastReset_ = resetHigh;

        double f0 = p.freePitch ? (double)std::max(p.freeHz, 0.0f) * std::exp2((double)p.pitch) : frequency(p.pitch);
        const float slow = slow_.next(), fast = fast_.next();   // the walks always run, so turning Drift up never jumps
        if (p.drift > 0.0f)
            f0 *= std::exp2((double)(std::min(p.drift, 1.0f) * kDriftCents * (slow + 0.25f * fast)) / 1200.0);
        double f;
        if (p.phaseMod) {
            f = f0;   // the frequency stays, the phase moves
        } else if (p.expFm) {
            f = dsp::osc::expFm(f0, (double)p.fmDepth, (double)fm);   // ±4 octaves at depth 1: always positive
        } else {
            f = dsp::osc::linearFm(f0, (double)p.fmDepth, (double)fm);  // through zero when negative
            if (!p.throughZero) f = std::max(f, 0.0);
        }
        const double dt = std::clamp(f / sampleRate_, -0.49, 0.49);

        const double ph = core_.phase();
        syncOut_ = ph < std::max(std::min(kSyncPulse * std::fabs(f), 0.5), std::fabs(dt));

        dsp::OscWaves w;
        if (p.phaseMod) {
            // Read the waveforms a little ahead of or behind the carrier's phase; the BLEPs get the increment
            // the read position actually moves by.
            const double off = kPmCycles * (double)p.fmDepth * (double)fm;
            dsp::OscCore read = core_;
            read.setPhase(ph + off);
            w = read.waves(std::clamp(dt + off - lastPm_, -0.49, 0.49), p.pulseWidth);
            lastPm_ = off;
        } else {
            w = core_.waves(dt, p.pulseWidth);
        }
        float y = pick(w, p.wave);
        const float m = std::clamp(p.morph, 0.0f, 1.0f);
        if (m > 0.0f && p.wave != p.wave2) y += m * (pick(w, p.wave2) - y);
        if (p.subLevel > 0.0f) y += std::min(p.subLevel, 1.0f) * sub(ph, dt, p);

        core_.advance(dt);
        const double next = core_.phase();
        if (dt > 0.0 && next < ph) ++subCount_;        // wrapped forwards
        else if (dt < 0.0 && next > ph) --subCount_;   // backwards (through-zero FM): the sub runs back too
        return y;
    }

private:
    void restart(float phase) noexcept {
        core_.setPhase((double)std::clamp(phase, 0.0f, 1.0f));
        subCount_ = 0;
    }

    /// The sub oscillator: its own phase is the carrier's slowed down by 2 or 4 (the carrier's cycles counted),
    /// so it follows FM and sync exactly. The square is band-limited like the main one; Main reads the main
    /// waveforms (Waveform / Secondary / Morph, Pulse Width) at the sub's phase, band-limited at its rate.
    float sub(double ph, double dt, const OscillatorParams& p) const noexcept {
        const unsigned n = p.subOctaves >= 2 ? 4u : 2u;
        const double sp = (ph + (double)(subCount_ & (n - 1))) / (double)n;
        if (p.subWave == OscSubWave::Sine) return (float)std::sin(dsp::osc::kTwoPi * sp);
        if (p.subWave == OscSubWave::Main) {
            dsp::OscCore read;
            read.setPhase(sp);
            const dsp::OscWaves w = read.waves(dt / (double)n, p.pulseWidth);
            float y = pick(w, p.wave);
            const float m = std::clamp(p.morph, 0.0f, 1.0f);
            if (m > 0.0f && p.wave != p.wave2) y += m * (pick(w, p.wave2) - y);
            return y;
        }
        const double adt = std::max(std::fabs(dt) / (double)n, 1e-9);
        double sq = sp < 0.5 ? 1.0 : -1.0;
        sq += dsp::osc::polyBlep(sp, adt);
        sq -= dsp::osc::polyBlep(dsp::osc::wrap01(sp - 0.5), adt);
        return (float)sq;
    }

    double sampleRate_ = 48000.0;
    dsp::OscCore core_;
    dsp::OscDrift slow_, fast_;
    uint64_t seed_ = 1;
    unsigned subCount_ = 0;
    double lastPm_ = 0.0;
    bool lastSync_ = false, lastReset_ = false, syncOut_ = false;
};

}  // namespace bleep::patch
