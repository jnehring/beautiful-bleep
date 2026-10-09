// SPDX-License-Identifier: MIT
// LFO waveforms as pure phase → value functions, a phase accumulator that
// counts cycles, and helpers that lock a phase to the song position.
// Shared by LFO (doc/specs/modules/lfo.md), Quad LFO and the other modulators.
// Random waves are a pure function of (seed, cycle, stream), so synced
// renders repeat exactly and the transport can jump.
#pragma once

#include "Random.h"
#include "Tempo.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

/// The LFO wave set, in LFO's (saved) order.
enum WaveShape { WaveSine = 0, WaveTriangle, WaveSawUp, WaveSawDown, WaveSquare, WaveRandomStep, WaveRandomSmooth, kWaveShapes };

namespace waves {

constexpr double kTwoPi = 6.283185307179586;
/// The random stream LFO uses; Quad LFO uses the channel number instead.
constexpr uint64_t kRandomStream = 11;

// All waves take a phase p in 0..1 and return a bipolar value in −1..+1.

inline float sine(double p) noexcept { return (float)std::sin(p * kTwoPi); }
/// Starts at 0, +1 at 0.25, 0 at 0.5, −1 at 0.75 (in phase with the sine).
inline float triangle(double p) noexcept {
    return (float)(p < 0.25 ? 4.0 * p : p < 0.75 ? 2.0 - 4.0 * p : 4.0 * p - 4.0);
}
inline float sawUp(double p) noexcept { return (float)(2.0 * p - 1.0); }
inline float sawDown(double p) noexcept { return (float)(1.0 - 2.0 * p); }
/// +1 while p < pulseWidth (clamped to 0.05..0.95), else −1.
inline float square(double p, float pulseWidth) noexcept {
    return p < (double)std::clamp(pulseWidth, 0.05f, 0.95f) ? 1.0f : -1.0f;
}
/// Seeded random value for a cycle, in −1..+1.
inline float randomAt(uint64_t seed, int64_t cycle, uint64_t stream = kRandomStream) noexcept {
    return (float)(2.0 * uniform01(seed, (uint64_t)cycle, stream) - 1.0);
}
/// One random value per cycle.
inline float randomStep(uint64_t seed, int64_t cycle, uint64_t stream = kRandomStream) noexcept {
    return randomAt(seed, cycle, stream);
}
/// Cosine glide from this cycle's random value to the next one's.
inline float randomSmooth(double p, uint64_t seed, int64_t cycle, uint64_t stream = kRandomStream) noexcept {
    const double k = 0.5 - 0.5 * std::cos(p * kTwoPi * 0.5);
    return (float)((1.0 - k) * randomAt(seed, cycle, stream) + k * randomAt(seed, cycle + 1, stream));
}

/// Bipolar value of `wave` (a WaveShape) at phase p in cycle `cycle`.
inline float value(int wave, double p, float pulseWidth, uint64_t seed, int64_t cycle,
                   uint64_t stream = kRandomStream) noexcept {
    switch (wave) {
        case WaveTriangle: return triangle(p);
        case WaveSawUp: return sawUp(p);
        case WaveSawDown: return sawDown(p);
        case WaveSquare: return square(p, pulseWidth);
        case WaveRandomStep: return randomStep(seed, cycle, stream);
        case WaveRandomSmooth: return randomSmooth(p, seed, cycle, stream);
        default: return sine(p);
    }
}

/// −1..+1 → 0..1.
inline float unipolar(float v) noexcept { return 0.5f + 0.5f * v; }

}  // namespace waves

// ---- Phase ----------------------------------------------------------------

/// A phase in [0, 1) plus the number of the cycle it is in.
struct CyclePhase {
    int64_t cycle = 0;
    double phase = 0.0;
};

/// Adds an offset (in cycles) to a phase, carrying whole cycles into the
/// cycle number, so random waves move with the offset.
inline CyclePhase offsetPhase(double phase, int64_t cycle, double offset) noexcept {
    const double shifted = phase + offset;
    return {cycle + (int64_t)std::floor(shifted), shifted - std::floor(shifted)};
}

/// Cycles per second for one cycle every `cycleBeats` quarter notes.
inline double syncedHz(double bpm, double cycleBeats) noexcept { return bpm / 60.0 / cycleBeats; }

/// Song position in cycles: ppq / cycleBeats × ratio (ratio = cycles per
/// `cycleBeats`, e.g. a Divide or harmonic ratio).
inline double ppqCycles(double ppq, double cycleBeats, double ratio = 1.0) noexcept {
    return ppq * ratio / cycleBeats;
}
/// Phase locked to the bars: frac(ppq × ratio / cycleBeats). With the
/// transport playing this is a pure function of the song position.
inline double ppqPhase(double ppq, double cycleBeats, double ratio = 1.0) noexcept {
    return wrap01(ppqCycles(ppq, cycleBeats, ratio));
}
/// The cycle number at a song position: floor(ppq × ratio / cycleBeats).
inline int64_t ppqCycle(double ppq, double cycleBeats, double ratio = 1.0) noexcept {
    return (int64_t)std::floor(ppqCycles(ppq, cycleBeats, ratio));
}

/// Phase accumulator with a cycle counter. Free-running it advances by
/// hz / sampleRate per sample; locked, it follows the song position.
class Phasor {
public:
    void reset(double phase = 0.0, int64_t cycle = 0) noexcept {
        phase_ = phase;
        cycle_ = cycle;
    }
    double phase() const noexcept { return phase_; }
    int64_t cycle() const noexcept { return cycle_; }

    /// Advances by `increment` cycles (hz / sampleRate; may be negative for
    /// through-zero FM). Returns true when the phase wrapped.
    bool advance(double increment) noexcept {
        phase_ += increment;
        if (phase_ >= 1.0 || phase_ < 0.0) {
            const double whole = std::floor(phase_);
            phase_ -= whole;
            cycle_ += (int64_t)whole;
            return true;
        }
        return false;
    }
    bool advance(double hz, double sampleRate) noexcept { return advance(hz / sampleRate); }

    /// A reset: phase 0, counted as a new cycle (so random waves move on).
    void restart() noexcept {
        phase_ = 0.0;
        ++cycle_;
    }

    /// Locks to the song position: one cycle per `cycleBeats` quarter notes.
    /// Returns true when a cycle starts at this sample. `continuing` is false
    /// on the first locked sample (e.g. after a transport start): a cycle then
    /// counts as starting only if this sample is its first.
    bool lock(double ppq, double cycleBeats, double bpm, double sampleRate, bool continuing) noexcept {
        const double s = ppq / cycleBeats;
        const int64_t n = (int64_t)std::floor(s);
        const double inc = bpm / 60.0 / sampleRate / cycleBeats;
        const bool edge = continuing ? n != cycle_ : s - (double)n < inc;
        cycle_ = n;
        phase_ = s - (double)n;
        return edge;
    }

private:
    double phase_ = 0.0;
    int64_t cycle_ = 0;
};

}  // namespace bleep::dsp
