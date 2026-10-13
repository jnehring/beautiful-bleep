// SPDX-License-Identifier: MIT
// Arpeggiator core (doc/specs/modules/arpeggiator.md): the held notes of a
// `notes` stream played one at a time, in a pattern, over up to four octaves.
// Timing comes from the shared dsp::SeqClock (transport-locked or clocked),
// notes from dsp::SeqVoice; notes leave through a callback, so this stays
// free of the engine's types.
#pragma once

#include "dsp/Random.h"
#include "dsp/SeqClock.h"
#include "dsp/SeqNotes.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cstdint>

namespace bleep::patch {

enum ArpPattern { ArpUp = 0, ArpDown, ArpUpDown, ArpDownUp, ArpUpAndDown, ArpPlayed, ArpRandom, ArpConverge, ArpDiverge, ArpNumPatterns };

constexpr int kArpMaxHeld = 32;
constexpr int kArpMaxOctaves = 4;

struct ArpParams {
    int rate = 9;  ///< rateNames() index (1/16)
    int pattern = ArpUp;
    int octaves = 1;
    bool latch = false;
    uint32_t seed = 1;
    float gateLength = 0.5f;  ///< share of a step
    float swing = 0.5f;       ///< 0.5 = straight .. 0.75
};

struct ArpTime {
    bool running = false;  ///< transport playing with a valid position
    bool started = false;  ///< first sample after the transport started
    double bpm = 120.0;
    double ppq = 0.0;
};

struct ArpOutputs {
    float pitch = 0.0f, gate = 0.0f, velocity = 0.0f, trigger = 0.0f;
};

class ArpeggiatorDsp {
public:
    static constexpr int kNumRates = dsp::kNumSequencerRates;
    static const std::array<const char*, kNumRates>& rateNames() {
        static const std::array<const char*, kNumRates> n = [] {
            std::array<const char*, kNumRates> a{};
            for (int i = 0; i < kNumRates; ++i) a[(size_t)i] = dsp::sequencerRate(i).name;
            return a;
        }();
        return n;
    }
    static const std::array<const char*, ArpNumPatterns>& patternNames() {
        static const std::array<const char*, ArpNumPatterns> n{
            {"Up", "Down", "Up-Down", "Down-Up", "Up & Down", "Played", "Random", "Converge", "Diverge"}};
        return n;
    }

    static int64_t mod(int64_t a, int64_t m) noexcept { return ((a % m) + m) % m; }

    /// Steps until the pattern repeats, for `n` notes in the sequence.
    static int cycle(int pattern, int n) noexcept {
        if (n <= 1) return 1;
        switch (pattern) {
            case ArpUpDown:
            case ArpDownUp: return 2 * n - 2;
            case ArpUpAndDown: return 2 * n;
            default: return n;
        }
    }

    /// The index (0 = lowest, n−1 = highest; for Played: oldest) played at
    /// count `n` out of `size` notes. Not for Random, which is seeded.
    static int position(int pattern, int64_t n, int size) noexcept {
        if (size <= 1) return 0;
        switch (pattern) {
            case ArpDown: return size - 1 - (int)mod(n, size);
            case ArpUpDown: {
                const int k = (int)mod(n, 2 * size - 2);
                return k < size ? k : 2 * size - 2 - k;
            }
            case ArpDownUp: {
                const int k = (int)mod(n, 2 * size - 2);
                return size - 1 - (k < size ? k : 2 * size - 2 - k);
            }
            case ArpUpAndDown: {
                const int k = (int)mod(n, 2 * size);
                return k < size ? k : 2 * size - 1 - k;
            }
            case ArpConverge: return converge((int)mod(n, size), size);
            case ArpDiverge: return converge(size - 1 - (int)mod(n, size), size);
            default: return (int)mod(n, size);  // Up, Played
        }
    }

    void prepare(double sampleRate) noexcept { clock_.prepare(sampleRate); }

    void reset() noexcept {
        clock_.reset();
        voice_.reset();
        count_ = 0;
        keysDown_ = 0;
        latched_ = false;
        stopRequested_ = false;
        configured_ = false;
        step_ = 0;
    }

    /// A key goes down (velocity 0…1). The same note again moves it to the end.
    void noteOn(int note, float pitch, float velocity, bool latch) noexcept {
        if (latch && latched_ && keysDown_ == 0) count_ = 0;  // a new chord replaces the latched one
        latched_ = false;
        remove(note);
        if (count_ >= kArpMaxHeld) {  // drop the oldest
            for (int i = 1; i < count_; ++i) held_[i - 1] = held_[i];
            --count_;
        }
        held_[count_++] = {note, pitch, velocity};
        ++keysDown_;
    }

    /// A key comes up. With latch the notes stay until the next chord.
    void noteOff(int note, bool latch) noexcept {
        keysDown_ = std::max(0, keysDown_ - 1);
        if (latch) {
            if (keysDown_ == 0) latched_ = true;
            return;
        }
        remove(note);
    }

    /// Latch was switched off: forget notes that were only held by it.
    void latchOff() noexcept {
        if (latched_) count_ = 0;
        latched_ = false;
    }

    /// Forgets all held notes and ends the sounding one (cable removed,
    /// transport stopped).
    void clearHeld() noexcept {
        count_ = keysDown_ = 0;
        latched_ = false;
    }

    int heldCount() const noexcept { return count_; }
    int playingStep() const noexcept { return step_; }
    bool sounding() const noexcept { return voice_.sounding(); }

    /// One sample. `emit(on, note, pitch, velocity)` receives note events.
    template <class Emit>
    void tick(const ArpParams& p, float clockIn, bool clockPatched, float resetIn, const ArpTime& t, ArpOutputs& out,
              Emit&& emit) noexcept {
        out.trigger = 0.0f;
        voice_.beginSample();
        if (configured_ && (p.pattern != pattern_ || p.octaves != octaves_ || clockPatched != clocked_)) stopRequested_ = true;
        configured_ = true;
        pattern_ = p.pattern;
        octaves_ = p.octaves;
        clocked_ = clockPatched;
        if (stopRequested_) stop(emit);
        if (count_ == 0) voice_.release(emit);  // nothing held: the note ends with the key

        dsp::SeqClockInput in;
        in.clocked = clockPatched;
        in.clock = clockIn;
        in.reset = resetIn;
        in.running = t.running;
        in.started = t.started;
        in.ppq = t.ppq;
        in.bpm = t.bpm;
        in.stepBeats = dsp::sequencerRateBeats(p.rate);
        in.swing = p.swing;
        clock_.tick(in, [&](const dsp::SeqClockEvent& e) {
            if (e.type == dsp::SeqClockEvent::Release) stop(emit);
            else start(p, e.n, e.durationSamples, emit, out);
        });

        voice_.endSample(emit);
        out.pitch = voice_.pitch();
        out.velocity = voice_.velocity();
        out.gate = voice_.gate() ? 1.0f : 0.0f;
    }

private:
    struct Held {
        int note = 60;
        float pitch = 0.0f, velocity = 0.8f;
    };

    /// 0, n−1, 1, n−2, …: alternately from the ends towards the middle.
    static int converge(int k, int size) noexcept { return (k & 1) ? size - 1 - k / 2 : k / 2; }

    void remove(int note) noexcept {
        for (int i = 0; i < count_; ++i) {
            if (held_[i].note != note) continue;
            for (int j = i + 1; j < count_; ++j) held_[j - 1] = held_[j];
            --count_;
            return;
        }
    }

    template <class Emit>
    void stop(Emit& emit) noexcept {
        stopRequested_ = false;
        voice_.release(emit);
    }

    template <class Emit>
    void start(const ArpParams& p, int64_t n, double durationSamples, Emit& emit, ArpOutputs& out) noexcept {
        if (count_ == 0) {
            voice_.rest(emit);
            return;
        }
        // The pool: held notes lowest first (Played: in the order they came),
        // repeated for every octave, the octave as the slow digit.
        Held pool[kArpMaxHeld];
        for (int i = 0; i < count_; ++i) pool[i] = held_[i];
        if (p.pattern != ArpPlayed)
            std::stable_sort(pool, pool + count_, [](const Held& a, const Held& b) { return a.note < b.note; });
        const int octaves = std::clamp(p.octaves, 1, kArpMaxOctaves);
        const int size = count_ * octaves;
        int idx;
        if (p.pattern == ArpRandom && size > 1) {
            idx = std::min((int)(dsp::uniform01(p.seed, (uint64_t)n, 7) * size), size - 1);
        } else {
            idx = position(p.pattern, n, size);
        }
        step_ = idx;
        const Held& h = pool[idx % count_];
        const int oct = idx / count_;
        const int note = std::clamp(h.note + 12 * oct, 0, 127);
        const float pitch = h.pitch + (float)oct;
        const auto how = voice_.play(note, pitch, std::clamp(h.velocity, 1.0f / 127.0f, 1.0f), false,
                                     dsp::gateSamples(durationSamples, p.gateLength), emit);
        if (how == dsp::SeqVoice::Fresh) out.trigger = 1.0f;
    }

    dsp::SeqClock clock_;
    dsp::SeqVoice voice_;
    std::array<Held, kArpMaxHeld> held_{};
    int count_ = 0, keysDown_ = 0;
    bool latched_ = false, stopRequested_ = false, configured_ = false, clocked_ = false;
    int pattern_ = ArpUp, octaves_ = 1, step_ = 0;
};

}  // namespace bleep::patch
