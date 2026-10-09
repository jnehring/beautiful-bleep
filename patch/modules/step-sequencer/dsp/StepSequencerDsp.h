// SPDX-License-Identifier: MIT
// Step Sequencer core (doc/specs/modules/step-sequencer.md): 32 steps with a
// gate (Off/On/Tie), a pitch and a velocity; transport-locked or clocked;
// scale quantizing and seeded live variation. Timing comes from the shared
// dsp::SeqClock, notes from dsp::SeqVoice; notes leave through a callback, so
// this stays free of the engine's types.
#pragma once

#include "dsp/Random.h"
#include "dsp/Scales.h"
#include "dsp/SeqClock.h"
#include "dsp/SeqNotes.h"
#include "dsp/Tempo.h"

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
    int scaleMask = -1;      ///< >= 0: quantize to this 12-bit mask instead (the harmony bus)
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
    static constexpr int kNumRates = dsp::kNumSequencerRates;
    /// The shared sequencer rate list (Tempo.h): 1/1 … 1/32T.
    static const std::array<const char*, kNumRates>& rateNames() {
        static const std::array<const char*, kNumRates> n = [] {
            std::array<const char*, kNumRates> a{};
            for (int i = 0; i < kNumRates; ++i) a[(size_t)i] = dsp::sequencerRate(i).name;
            return a;
        }();
        return n;
    }
    /// A step's length in quarter notes.
    static double rateBeats(int rate) noexcept { return dsp::sequencerRateBeats(rate); }
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
        const uint16_t mask = p.scaleMask >= 0 ? (uint16_t)p.scaleMask : sc.mask;
        const int q = p.root + dsp::quantize(relative, mask);
        return std::clamp(q, -60, 67);  // MIDI 0..127
    }

    void prepare(double sampleRate) noexcept { clock_.prepare(sampleRate); }

    void reset() noexcept {
        clock_.reset();
        voice_.reset();
        played_ = false;
        step_ = 0;
        lastIdx_ = -1;
        varied_ = 0;
        stopRequested_ = false;
    }

    /// A new pattern. A sounding step that lost its gate stops.
    void setPattern(const SeqPattern& p) noexcept {
        pattern_ = p;
        if (voice_.sounding() && pattern_[(size_t)step_].gate == SeqOff) stopRequested_ = true;
    }
    const SeqPattern& pattern() const noexcept { return pattern_; }

    int playingStep() const noexcept { return step_; }
    bool sounding() const noexcept { return voice_.sounding(); }
    uint32_t variedSteps() const noexcept { return varied_; }

    /// One sample. `emit(on, note, pitch, velocity)` receives note events.
    template <class Emit>
    void tick(const SeqParams& p, float clockIn, bool clockPatched, float resetIn, float transpose, const SeqTime& t,
              SeqOutputs& out, Emit&& emit) noexcept {
        out.trigger = out.end = 0.0f;
        voice_.beginSample();
        const int length = std::clamp(p.length, 1, kSeqSteps);
        if (configured_ && (length != length_ || p.direction != direction_ || clockPatched != clocked_)) stop(emit);
        configured_ = true;
        length_ = length;
        direction_ = p.direction;
        clocked_ = clockPatched;
        if (stopRequested_) stop(emit);

        dsp::SeqClockInput in;
        in.clocked = clockPatched;
        in.clock = clockIn;
        in.reset = resetIn;
        in.running = t.running;
        in.started = t.started;
        in.ppq = t.ppq;
        in.bpm = t.bpm;
        in.stepBeats = rateBeats(p.rate);
        in.swing = p.swing;
        clock_.tick(in, [&](const dsp::SeqClockEvent& e) {
            if (e.type == dsp::SeqClockEvent::Release) stop(emit);
            else start(p, e.n, transpose, e.durationSamples, emit, out);
        });

        voice_.endSample(emit);
        out.pitch = voice_.pitch();
        out.velocity = voice_.velocity();
        out.gate = voice_.gate() ? 1.0f : 0.0f;
        out.step = length > 1 ? (float)step_ / (float)(length - 1) : 0.0f;
    }

private:
    template <class Emit>
    void stop(Emit& emit) noexcept {
        stopRequested_ = false;
        voice_.release(emit);
    }

    template <class Emit>
    void start(const SeqParams& p, int64_t n, float transpose, double durationSamples, Emit& emit, SeqOutputs& out) noexcept {
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

        const SeqStep& st = pattern_[(size_t)idx];
        varied_ &= ~(1u << idx);
        if (st.gate == SeqOff) {
            voice_.rest(emit);
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
        vel = std::clamp(vel, 1.0f / 127.0f, 1.0f);
        const auto how = voice_.play(60 + q, (float)q / 12.0f, vel, st.gate == SeqTie,
                                     dsp::gateSamples(durationSamples, p.gateLength), emit);
        if (how == dsp::SeqVoice::Fresh) out.trigger = 1.0f;
    }

    SeqPattern pattern_{};
    dsp::SeqClock clock_;
    dsp::SeqVoice voice_;
    bool configured_ = false, clocked_ = false;
    int length_ = 16, direction_ = SeqForward;
    bool played_ = false, stopRequested_ = false;
    int step_ = 0, lastIdx_ = -1;
    uint32_t varied_ = 0;
};

}  // namespace bleep::patch
