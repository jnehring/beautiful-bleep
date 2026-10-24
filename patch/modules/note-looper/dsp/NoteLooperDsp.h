// SPDX-License-Identifier: GPL-3.0-only
// Note Looper core (doc/specs/modules/note-looper.md): a loop of notes, not of
// audio. Incoming notes are stored with their position in the loop and their
// length (in quarter notes), then played again every pass:
//
//  - the position locks to the song position while the transport plays,
//    otherwise it runs freely at the tempo; Half / Normal / Double change how
//    fast the head moves through the loop;
//  - Record clears the loop and records, Overdub adds to it, Play only plays;
//  - Quantize pulls note starts towards a grid by a strength, at playback, so
//    the knob works on what is already recorded;
//  - Probability decides per note and per pass (seeded, repeatable) whether a
//    note plays; Undo removes the last recorded layer.
//
// The head is counted in ticks (kTicksPerBeat per quarter note), so notes are
// found without comparing floating point positions. Header-only, no JUCE;
// notes leave through a callback.
#pragma once

#include "dsp/NoteStream.h"
#include "dsp/Random.h"
#include "dsp/SeqNotes.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kLoopMaxNotes = 256;
constexpr int kLoopMaxBars = 16;
constexpr int64_t kTicksPerBeat = 960;

enum LooperMode : int { LoopPlay = 0, LoopRecord, LoopOverdub };
enum LooperSpeed : int { LoopHalf = 0, LoopNormal, LoopDouble };

struct LoopNote {
    double start = 0.0;   ///< quarter notes from the loop start
    double length = 0.25; ///< quarter notes
    int note = 60;
    float pitch = 0.0f;
    float velocity = 0.8f;
    uint16_t layer = 0;   ///< the recording pass that made it (Undo)
};

struct LooperParams {
    int mode = LoopPlay;
    int bars = 2;
    double beatsPerBar = 4.0;
    int speed = LoopNormal;
    float probability = 1.0f;
    double gridBeats = 0.0;  ///< quantize grid in quarter notes, 0 = off
    float strength = 1.0f;
    bool muteThru = false;
    uint32_t seed = 1;
    bool running = false;    ///< transport playing with a valid position
    double ppq = 0.0;
    double bpm = 120.0;
};

class NoteLooperDsp {
public:
    static double speedFactor(int speed) noexcept { return speed == LoopHalf ? 0.5 : speed == LoopDouble ? 2.0 : 1.0; }
    static double loopBeats(const LooperParams& p) noexcept {
        return (double)std::clamp(p.bars, 1, kLoopMaxBars) * std::max(1.0, p.beatsPerBar);
    }

    /// Where a note starts after Quantize, in quarter notes (wrapped into the loop).
    static double quantized(double start, double gridBeats, float strength, double loop) noexcept {
        if (gridBeats > 1e-6 && strength > 0.0f) {
            const double g = std::round(start / gridBeats) * gridBeats;
            start += (g - start) * (double)std::clamp(strength, 0.0f, 1.0f);
        }
        start = std::fmod(start, loop);
        return start < 0.0 ? start + loop : start;
    }

    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        reset();
    }
    void reset() noexcept {
        owner_.reset();
        sounding_.fill(false);
        open_.fill(-1);
        thru_.fill(0);
        notes_.fill(LoopNote{});
        count_ = 0;
        pos_ = 0.0;
        lastTick_ = 0;
        pass_ = 0;
        layer_ = 0;
        lastMode_ = LoopPlay;
        changed_ = true;
    }

    // ---- the loop's content ----------------------------------------------------

    int count() const noexcept { return count_; }
    const LoopNote& note(int i) const noexcept { return notes_[(size_t)i]; }
    /// True once after the notes changed (recorded, cleared, loaded).
    bool takeChanged() noexcept {
        const bool c = changed_;
        changed_ = false;
        return c;
    }
    /// Replaces the loop (loading a saved one); sounding notes end first.
    template <class Emit>
    void setNotes(const LoopNote* src, int n, Emit&& emit) noexcept {
        releaseAll(emit);
        count_ = std::clamp(n, 0, kLoopMaxNotes);
        for (int i = 0; i < count_; ++i) notes_[(size_t)i] = src[i];
        open_.fill(-1);
        changed_ = true;
    }
    template <class Emit>
    void clear(Emit&& emit) noexcept {
        releaseAll(emit);
        count_ = 0;
        open_.fill(-1);
        changed_ = true;
    }
    /// Removes the notes of the newest recorded layer.
    template <class Emit>
    void undo(Emit&& emit) noexcept {
        if (count_ == 0) return;
        uint16_t top = 0;
        for (int i = 0; i < count_; ++i) top = std::max(top, notes_[(size_t)i].layer);
        releaseAll(emit);
        int m = 0;
        for (int i = 0; i < count_; ++i)
            if (notes_[(size_t)i].layer != top) notes_[(size_t)m++] = notes_[(size_t)i];
        count_ = m;
        open_.fill(-1);
        changed_ = true;
    }

    // ---- notes in ------------------------------------------------------------------

    template <class Emit>
    void noteOn(int note, float pitch, float velocity, const LooperParams& p, Emit&& emit) noexcept {
        const size_t k = slot(note);
        if (!p.muteThru) thru_[k] = owner_.on(note, pitch, velocity, emit);
        if (p.mode == LoopPlay || count_ >= kLoopMaxNotes) return;
        LoopNote n;
        n.start = pos_;
        n.length = 0.0;
        n.note = note;
        n.pitch = pitch;
        n.velocity = velocity;
        n.layer = layer_;
        notes_[(size_t)count_] = n;
        openPass_[(size_t)count_] = pass_;
        open_[k] = count_++;
        changed_ = true;
    }

    template <class Emit>
    void noteOff(int note, const LooperParams& p, Emit&& emit) noexcept {
        const size_t k = slot(note);
        if (thru_[k]) owner_.off(note, thru_[k], emit);
        thru_[k] = 0;
        const int i = open_[k];
        if (i < 0) return;
        open_[k] = -1;
        const double loop = loopBeats(p);
        double len = pos_ - notes_[(size_t)i].start + (double)(pass_ - openPass_[(size_t)i]) * loop;
        notes_[(size_t)i].length = std::clamp(len, 1.0 / kTicksPerBeat, loop);
        changed_ = true;
    }

    // ---- one sample ------------------------------------------------------------------

    /// Moves the head and sends the notes it passes. Returns true when the head wrapped (a pass starts).
    template <class Emit>
    bool tick(const LooperParams& p, bool canEmit, Emit&& emit) noexcept {
        enterMode(p, emit);
        const double loop = loopBeats(p), speed = speedFactor(p.speed);
        const int64_t total = (int64_t)std::llround(loop * (double)kTicksPerBeat);
        if (p.running) {
            pos_ = std::fmod(p.ppq * speed, loop);
            if (pos_ < 0.0) pos_ += loop;
            wasRunning_ = true;
        } else {
            pos_ += std::max(p.bpm, 1.0) / 60.0 / sr_ * speed;
            if (pos_ >= loop) pos_ = std::fmod(pos_, loop);
            wasRunning_ = false;
        }
        const int64_t tick = std::min<int64_t>(total - 1, (int64_t)std::floor(pos_ * (double)kTicksPerBeat));
        bool wrapped = false;
        if (tick != lastTick_) {
            int64_t d = tick - lastTick_;
            if (d < 0) d += total;
            if (lastTick_ >= total || d > kJump) {  // a jump of the song position, or a loop length change
                releaseLooped(emit);
                lastTick_ = tick;
            } else if (canEmit) {
                for (int64_t t = lastTick_ + 1; t <= lastTick_ + d; ++t) {
                    const int64_t u = t % total;
                    if (u == 0) {
                        ++pass_;
                        wrapped = true;
                    }
                    atTick(u, total, loop, p, emit);
                }
                lastTick_ = tick;
            }
        }
        return wrapped;
    }

    /// Ends the notes of the loop that sound (not the thru notes).
    template <class Emit>
    void releaseLooped(Emit&& emit) noexcept {
        for (int i = 0; i < count_; ++i)
            if (sounding_[(size_t)i]) {
                sounding_[(size_t)i] = false;
                owner_.off(notes_[(size_t)i].note, token_[(size_t)i], emit);
            }
    }
    template <class Emit>
    void releaseAll(Emit&& emit) noexcept {
        owner_.allOff(emit);
        sounding_.fill(false);
        thru_.fill(0);
    }
    template <class Emit>
    void flush(Emit&& emit) noexcept {
        releaseAll(emit);
        open_.fill(-1);
    }

    double position() const noexcept { return pos_; }
    int64_t passes() const noexcept { return pass_; }
    int sounding() const noexcept { return owner_.count(); }

private:
    static constexpr int64_t kJump = kTicksPerBeat / 2;
    static size_t slot(int note) noexcept { return (size_t)std::clamp(note, 0, 127); }

    template <class Emit>
    void enterMode(const LooperParams& p, Emit&& emit) noexcept {
        if (p.mode == lastMode_) return;
        if (p.mode == LoopRecord) {  // Record starts from an empty loop
            releaseLooped(emit);
            count_ = 0;
            open_.fill(-1);
            changed_ = true;
        }
        if (p.mode != LoopPlay && lastMode_ == LoopPlay) layer_ = (uint16_t)std::min<int>(65535, layer_ + 1);
        lastMode_ = p.mode;
    }

    template <class Emit>
    void atTick(int64_t t, int64_t total, double loop, const LooperParams& p, Emit&& emit) noexcept {
        for (int i = 0; i < count_; ++i)  // ends first, so a note can retrigger on the tick it ends
            if (sounding_[(size_t)i] && offTick_[(size_t)i] == t) {
                sounding_[(size_t)i] = false;
                owner_.off(notes_[(size_t)i].note, token_[(size_t)i], emit);
            }
        for (int i = 0; i < count_; ++i) {
            const LoopNote& n = notes_[(size_t)i];
            if (n.start >= loop || open_[slot(n.note)] == i) continue;
            const int64_t on = (int64_t)std::llround(quantized(n.start, p.gridBeats, p.strength, loop) * (double)kTicksPerBeat) % total;
            if (on != t) continue;
            if (p.probability < 1.0f && dsp::uniform01(p.seed, (uint64_t)pass_, (uint64_t)i) >= (double)p.probability) continue;
            if (sounding_[(size_t)i]) owner_.off(n.note, token_[(size_t)i], emit);
            token_[(size_t)i] = owner_.on(n.note, n.pitch, n.velocity, emit);
            sounding_[(size_t)i] = true;
            const int64_t len = std::clamp<int64_t>((int64_t)std::llround(n.length * (double)kTicksPerBeat), 1, total - 1);
            offTick_[(size_t)i] = (on + len) % total;
        }
    }

    double sr_ = 48000.0;
    dsp::NoteOwner owner_;
    std::array<LoopNote, kLoopMaxNotes> notes_{};
    std::array<bool, kLoopMaxNotes> sounding_{};
    std::array<uint32_t, kLoopMaxNotes> token_{};
    std::array<int64_t, kLoopMaxNotes> offTick_{};
    std::array<int64_t, kLoopMaxNotes> openPass_{};
    std::array<int, 128> open_{};
    std::array<uint32_t, 128> thru_{};
    int count_ = 0;
    double pos_ = 0.0;
    int64_t lastTick_ = 0, pass_ = 0;
    uint16_t layer_ = 0;
    int lastMode_ = LoopPlay;
    bool changed_ = true, wasRunning_ = false;
};

}  // namespace bleep::patch
