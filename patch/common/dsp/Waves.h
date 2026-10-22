// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
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

// ---- Morph ---------------------------------------------------------------
// `morph` is the Morph knob, 0..1 with 0.5 (12 o'clock) the plain wave. Each wave
// bends its own way: Sine softens into a square above the middle and runs into a
// triangle below it, Triangle also squares up above and sharpens into spikes below,
// the saws curve (convex or concave), Square rounds its edges above the middle and
// splits into 2–4 pulses below it, Random Step glides (above) or quantises (below)
// and Random Smooth eases like a step (above) or runs straight (below).

/// Moves the half-way point of a cycle: skew −1..+1 shifts the peak of a sine or triangle.
inline double warpPhase(double p, double skew) noexcept {
    const double k = std::clamp(0.5 + 0.45 * skew, 0.05, 0.95);
    return p < k ? 0.5 * p / k : 0.5 + 0.5 * (p - k) / (1.0 - k);
}

inline double smoothstep01(double k) noexcept { return k * k * (3.0 - 2.0 * k); }

/// Bipolar value of `wave` at phase p, bent by `morph` (0..1, 0.5 = unchanged).
inline float valueMorph(int wave, double p, float pulseWidth, float morph, uint64_t seed, int64_t cycle,
                        uint64_t stream = kRandomStream) noexcept {
    const double m = 2.0 * (double)std::clamp(morph, 0.0f, 1.0f) - 1.0;
    if (std::fabs(m) < 1e-4) return value(wave, p, pulseWidth, seed, cycle, stream);
    switch (wave) {
        case WaveTriangle: {
            const double v = triangle(p);
            if (m > 0.0) return (float)(std::tanh(v * (1.0 + 6.0 * m)) / std::tanh(1.0 + 6.0 * m));
            return (float)(std::copysign(std::pow(std::fabs(v), 1.0 + 2.0 * -m), v));
        }
        case WaveSawUp: return (float)(2.0 * std::pow(p, std::exp2(2.0 * m)) - 1.0);
        case WaveSawDown: return (float)(1.0 - 2.0 * std::pow(p, std::exp2(2.0 * m)));
        case WaveSquare: {
            const double pw = (double)std::clamp(pulseWidth, 0.05f, 0.95f);
            if (m < 0.0) {  // 1…4 pulses per cycle
                const double n = 1.0 + std::floor(-m * 4.0 * 0.999);
                return square(wrap01(p * n), pulseWidth);
            }
            const double r = std::max(m * 1.98 * std::min(pw, 1.0 - pw), 1e-6);  // edge width, in cycles
            const double q = p > 0.5 ? p - 1.0 : p;
            const double fall = std::clamp((pw + 0.5 * r - p) / r, 0.0, 1.0);
            const double rise = std::clamp((q + 0.5 * r) / r, 0.0, 1.0);
            return (float)(2.0 * fall * rise - 1.0);
        }
        case WaveRandomStep: {
            const float cur = randomAt(seed, cycle, stream);
            if (m > 0.0) {  // glide in from the previous value over the first part of the cycle
                if (p >= m) return cur;
                const float prev = randomAt(seed, cycle - 1, stream);
                const double k = smoothstep01(p / m);
                return (float)((1.0 - k) * prev + k * cur);
            }
            const double levels = std::round(2.0 + (1.0 + m) * 30.0);  // 2 levels at the end of the knob
            return (float)(std::round((cur * 0.5 + 0.5) * (levels - 1.0)) / (levels - 1.0) * 2.0 - 1.0);
        }
        case WaveRandomSmooth: {
            const double cosK = 0.5 - 0.5 * std::cos(p * kTwoPi * 0.5);
            const double k = m > 0.0 ? cosK + m * (smoothstep01(smoothstep01(cosK)) - cosK) : cosK + (-m) * (p - cosK);
            return (float)((1.0 - k) * randomAt(seed, cycle, stream) + k * randomAt(seed, cycle + 1, stream));
        }
        default: {
            const double v = sine(p);
            if (m > 0.0) return (float)(std::tanh(v * (1.0 + 6.0 * m)) / std::tanh(1.0 + 6.0 * m));
            return (float)((1.0 + m) * v + -m * triangle(p));
        }
    }
}

/// Bends a bipolar value towards exponential (curve > 0: slow start, fast end) or logarithmic (curve < 0).
inline float bend(float v, float curve) noexcept {
    if (std::fabs(curve) < 1e-4f) return v;
    const double u = std::clamp(0.5 * ((double)v + 1.0), 0.0, 1.0);
    return (float)(2.0 * std::pow(u, std::exp2(2.0 * (double)std::clamp(curve, -1.0f, 1.0f))) - 1.0);
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
