// SPDX-License-Identifier: MIT
// Step Sequencer core (specs/modules/step-sequencer.md): 32 steps with a
// gate (Off/On/Tie), a pitch and a velocity; transport-locked or clocked;
// scale quantizing and seeded live variation. Notes leave through a callback,
// so this stays free of the engine's types.
#pragma once

#include "dsp/Random.h"
#include "dsp/Scales.h"
#include "dsp/Smoothing.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum SeqGate : uint8_t { SeqOff = 0, SeqOn = 1, SeqTie = 2 };
enum SeqDirection { SeqForward = 0, SeqBackward, SeqPingPong, SeqRandom };

constexpr int kSeqSteps = 32;
constexpr int kSeqMinPitch = -24, kSeqMaxPitch = 36;

struct SeqStep {
    uint8_t gate = SeqOn;
    int8_t pitch = 0;        ///< semitones above Root + Octave
    uint8_t velocity = 100;  ///< 1..127
};
using SeqPattern = std::array<SeqStep, kSeqSteps>;

struct SeqParams {
    int length = 16;
    int rate = 9;            ///< rateNames() index
    int direction = SeqForward;
    int root = 0;            ///< 0 = C
    int scale = 1;           ///< dsp::scales() index
    int octave = 0;
    uint32_t seed = 1;
    float gateLength = 0.5f; ///< share of a step
    float swing = 0.5f;      ///< 0.5 = straight .. 0.75
    float variation = 0.0f;  ///< chance per step
    float variationRange = 12.0f;  ///< semitones
};

struct SeqTime {
    bool running = false;    ///< transport playing with a valid position
    bool started = false;    ///< first sample after the transport started
    double bpm = 120.0;
    double ppq = 0.0;
};

struct SeqOutputs {
    float pitch = 0.0f, gate = 0.0f, velocity = 0.0f, trigger = 0.0f, end = 0.0f, step = 0.0f;
};

class StepSequencerDsp {
public:
    static constexpr int kNumRates = 14;
    static const std::array<const char*, kNumRates>& rateNames() {
        static const std::array<const char*, kNumRates> n{"1/1",  "1/2",  "1/4.",  "1/4",  "1/4T",  "1/8.", "1/8",
                                                          "1/8T", "1/16.", "1/16", "1/16T", "1/32.", "1/32", "1/32T"};
        return n;
    }
    /// A step's length in quarter notes.
    static double rateBeats(int rate) noexcept {
        static constexpr double b[kNumRates] = {4.0,   2.0,  1.5,       1.0,    2.0 / 3.0, 0.75,  0.5,
                                                1.0 / 3.0, 0.375, 0.25, 1.0 / 6.0, 0.1875, 0.125, 1.0 / 12.0};
        return b[std::clamp(rate, 0, kNumRates - 1)];
    }
    static int64_t mod(int64_t a, int64_t m) noexcept { return ((a % m) + m) % m; }
    /// Steps until the playhead is back at the start of its cycle.
    static int cycle(int length, int direction) noexcept {
        return direction == SeqPingPong && length > 1 ? 2 * length - 2 : length;
    }
    /// The step played at count `n` (not for Random, which keeps history).
    static int position(int64_t n, int length, int direction) noexcept {
        if (length <= 1) return 0;
        switch (direction) {
            case SeqBackward: return length - 1 - (int)mod(n, length);
            case SeqPingPong: {
                const int k = (int)mod(n, 2 * length - 2);
                return k < length ? k : 2 * length - 2 - k;
            }
            default: return (int)mod(n, length);
        }
    }
    /// A step's quantized pitch, in semitones from C4.
    static int pitchOf(const SeqParams& p, float relative) noexcept {
        const auto& sc = dsp::scales()[(size_t)std::clamp(p.scale, 0, (int)dsp::scales().size() - 1)];
        const int q = p.root + dsp::quantize(relative, sc.mask);
        return std::clamp(q, -60, 67);  // MIDI 0..127
    }

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    void reset() noexcept {
        clock_.reset();
        reset_.reset();
        haveN_ = haveClock_ = false;
        lastN_ = 0;
        pendingReset_ = false;
        delayLeft_ = 0;
        sinceClock_ = 0;
        period_ = (int64_t)(sampleRate_ * 0.125);  // 1/16 at 120 BPM
        transportOn_ = false;
        origin_ = 0;
        sounding_ = tie_ = played_ = false;
        retrig_ = false;
        note_ = 0;
        step_ = 0;
        lastIdx_ = -1;
        pitch_ = velocity_ = 0.0f;
        sinceStep_ = 0;
        gateSamples_ = 1;
        varied_ = 0;
        stopRequested_ = false;
    }

    /// A new pattern. A sounding step that lost its gate stops.
    void setPattern(const SeqPattern& p) noexcept {
        pattern_ = p;
        if (sounding_ && pattern_[(size_t)step_].gate == SeqOff) stopRequested_ = true;
    }
    const SeqPattern& pattern() const noexcept { return pattern_; }

    int playingStep() const noexcept { return step_; }
    bool sounding() const noexcept { return sounding_; }
    uint32_t variedSteps() const noexcept { return varied_; }

    /// One sample. `emit(on, note, pitch, velocity)` receives note events.
    template <class Emit>
    void tick(const SeqParams& p, float clockIn, bool clockPatched, float resetIn, float transpose, const SeqTime& t,
              SeqOutputs& out, Emit&& emit) noexcept {
        out.trigger = out.end = 0.0f;
        retrig_ = false;
        const int length = std::clamp(p.length, 1, kSeqSteps);
        if (configured_ && (length != length_ || p.direction != direction_ || clockPatched != clocked_)) stop(emit);
        configured_ = true;
        length_ = length;
        direction_ = p.direction;
        clocked_ = clockPatched;
        if (stopRequested_) stop(emit);
        swing_ = (std::clamp(p.swing, 0.5f, 0.75f) - 0.5f) * 2.0f;

        const bool resetEdge = reset_.process(resetIn) > 0;
        if (resetEdge) stop(emit);
        ++sinceStep_;

        if (clockPatched) {
            ++sinceClock_;
            if (resetEdge) {
                pendingReset_ = true;
                delayLeft_ = 0;
            }
            if (delayLeft_ > 0 && --delayLeft_ == 0) start(p, pendingN_, transpose, (double)period_, emit, out);
            if (clock_.process(clockIn) > 0) {
                if (delayLeft_ > 0) {  // the swung step is late: play it now
                    delayLeft_ = 0;
                    start(p, pendingN_, transpose, (double)period_, emit, out);
                }
                if (sinceClock_ > 0 && haveClock_) period_ = sinceClock_;
                haveClock_ = true;
                sinceClock_ = 0;
                const int64_t n = pendingReset_ || !haveN_ ? 0 : lastN_ + 1;
                pendingReset_ = false;
                haveN_ = true;
                lastN_ = n;
                const int delay = (n & 1) ? (int)std::lround(swing_ * (double)period_) : 0;
                if (delay >= 1) {
                    pendingN_ = n;
                    delayLeft_ = delay;
                } else {
                    start(p, n, transpose, (double)period_, emit, out);
                }
            }
        } else if (t.running) {
            const double beats = rateBeats(p.rate);
            if (t.started || !transportOn_) {
                if (t.started) origin_ = 0;
                haveN_ = false;
            }
            transportOn_ = true;
            if (resetEdge) origin_ = (int64_t)std::floor(t.ppq / beats) + 1;  // the next boundary is step 1
            const double s = t.ppq / beats - (double)origin_;
            int64_t n = (int64_t)std::floor(s);
            if ((n & 1) && s - (double)n < swing_) --n;
            if (resetEdge) {  // silent until then
                haveN_ = true;
                lastN_ = n;
            } else if (!haveN_ || n != lastN_) {
                haveN_ = true;
                lastN_ = n;
                start(p, n, transpose, beats * 60.0 / std::max(t.bpm, 1.0) * sampleRate_, emit, out);
            }
        } else if (transportOn_) {
            transportOn_ = false;
            haveN_ = false;
            stop(emit);
        }

        if (sounding_ && !tie_ && sinceStep_ >= gateSamples_) {
            emit(false, note_, (float)(note_ - 60) / 12.0f, 0.0f);
            sounding_ = false;
        }
        out.pitch = pitch_;
        out.velocity = velocity_;
        out.gate = sounding_ && !retrig_ ? 1.0f : 0.0f;
        out.step = length > 1 ? (float)step_ / (float)(length - 1) : 0.0f;
    }

private:
    template <class Emit>
    void stop(Emit& emit) noexcept {
        stopRequested_ = false;
        if (sounding_) emit(false, note_, (float)(note_ - 60) / 12.0f, 0.0f);
        sounding_ = tie_ = false;
    }

    template <class Emit>
    void start(const SeqParams& p, int64_t n, float transpose, double stepSamples, Emit& emit, SeqOutputs& out) noexcept {
        const int length = length_;
        int idx;
        if (direction_ == SeqRandom && length > 1) {
            const double u = dsp::uniform01(p.seed, (uint64_t)n, 7);
            if (lastIdx_ >= 0 && lastIdx_ < length) {
                const int r = std::min((int)(u * (length - 1)), length - 2);
                idx = r >= lastIdx_ ? r + 1 : r;
            } else {
                idx = std::min((int)(u * length), length - 1);
            }
        } else {
            idx = position(n, length, direction_);
        }
        lastIdx_ = idx;
        if (played_ && mod(n, cycle(length, direction_)) == 0) out.end = 1.0f;
        played_ = true;
        step_ = idx;

        const double dur = stepSamples * ((n & 1) ? 1.0 - swing_ : 1.0 + swing_);
        gateSamples_ = std::max<int64_t>(1, (int64_t)std::llround(std::clamp(p.gateLength, 0.01f, 1.0f) * dur));
        sinceStep_ = 0;

        const SeqStep& st = pattern_[(size_t)idx];
        varied_ &= ~(1u << idx);
        if (st.gate == SeqOff) {
            if (sounding_) emit(false, note_, (float)(note_ - 60) / 12.0f, 0.0f);
            sounding_ = tie_ = false;
            return;
        }
        float rel = (float)(p.octave * 12 + st.pitch) + transpose * 12.0f;
        float vel = (float)st.velocity / 127.0f;
        if (p.variation > 0.0f && dsp::uniform01(p.seed, (uint64_t)n, 1) < p.variation) {
            const double range = std::clamp(p.variationRange, 0.0f, 24.0f);
            rel += (float)std::lround((dsp::uniform01(p.seed, (uint64_t)n, 2) * 2.0 - 1.0) * range);
            vel *= 1.0f + (float)(dsp::uniform01(p.seed, (uint64_t)n, 3) * 2.0 - 1.0) * 0.25f;
            varied_ |= 1u << idx;
        }
        const int q = pitchOf(p, rel);
        const int note = 60 + q;
        vel = std::clamp(vel, 1.0f / 127.0f, 1.0f);
        const float pitch = (float)q / 12.0f;
        if (sounding_ && tie_) {
            if (note != note_) {  // legato: the new note first
                emit(true, note, pitch, vel);
                emit(false, note_, (float)(note_ - 60) / 12.0f, 0.0f);
            }
        } else {
            if (sounding_) {
                emit(false, note_, (float)(note_ - 60) / 12.0f, 0.0f);
                retrig_ = true;
            }
            emit(true, note, pitch, vel);
            out.trigger = 1.0f;
        }
        note_ = note;
        pitch_ = pitch;
        velocity_ = vel;
        sounding_ = true;
        tie_ = st.gate == SeqTie;
    }

    double sampleRate_ = 48000.0;
    SeqPattern pattern_{};
    dsp::GateEdge clock_, reset_;
    bool configured_ = false, clocked_ = false;
    int length_ = 16, direction_ = SeqForward;
    float swing_ = 0.0f;
    bool haveN_ = false, haveClock_ = false, pendingReset_ = false;
    int64_t lastN_ = 0, pendingN_ = 0;
    int64_t delayLeft_ = 0, sinceClock_ = 0, period_ = 6000;
    bool transportOn_ = false;
    int64_t origin_ = 0;
    bool sounding_ = false, tie_ = false, played_ = false, retrig_ = false, stopRequested_ = false;
    int note_ = 0, step_ = 0, lastIdx_ = -1;
    float pitch_ = 0.0f, velocity_ = 0.0f;
    int64_t sinceStep_ = 0, gateSamples_ = 1;
    uint32_t varied_ = 0;
};

}  // namespace bleep::patch
