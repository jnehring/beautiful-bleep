// SPDX-License-Identifier: GPL-3.0-only
// Note Echo core (doc/specs/modules/note-echo.md): every note-on of a `notes`
// stream is followed by up to 16 repeats. Each repeat comes later, softer, and
// moved along the board's scale; a repeat can drop out, fan into a chord-tone
// pattern (Spread) and be pulled onto, or pushed off, a grid (Gravity).
// Everything is decided at the note-on, so a repeat train is stable while
// knobs move. Notes leave through a callback; this stays free of the
// engine's types.
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

constexpr int kEchoMaxRepeats = 16;
constexpr int kEchoQueue = 256;

enum EchoFan : int { EchoFanUp = 0, EchoFanDown, EchoFanUpDown, EchoFanRandom, EchoNumFans };

struct EchoParams {
    int repeats = 4;
    bool free = false;              ///< spacing in seconds instead of a note value
    double spacingBeats = 0.5;      ///< synced spacing
    double spacingSeconds = 0.25;   ///< free spacing
    double bpm = 120.0;
    double ppq = 0.0;               ///< song position of this note-on
    bool ppqValid = false;
    float decay = 0.3f;             ///< each repeat is (1 − decay) times the one before
    int steps = 0;                  ///< scale steps added per repeat
    float drop = 0.0f;              ///< chance that a repeat is left out
    float length = 0.5f;            ///< share of the spacing a repeat sounds
    float spread = 0.0f;            ///< 0: off, up to 4 chord tones added to the fan
    int fan = EchoFanUp;
    float gravity = 0.0f;           ///< −1 … +1: push off the grid … pull onto it
    double gridBeats = 0.25;
    bool muteOriginal = false;
    uint32_t seed = 1;
    dsp::ScaleContext scale;
};

class NoteEchoDsp {
public:
    static const std::array<const char*, EchoNumFans>& fanNames() {
        static const std::array<const char*, EchoNumFans> n{{"Up", "Down", "Up-Down", "Random"}};
        return n;
    }

    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        reset();
    }
    void reset() noexcept {
        queue_.clear();
        owner_.reset();
        srcToken_.fill(0);
        now_ = 0;
        counter_ = 0;
        pending_ = 0;
        tap_ = false;
    }

    /// Number of chord tones that Spread selects (1 = none).
    static int fanTones(float spread) noexcept { return 1 + std::clamp((int)std::floor(std::clamp(spread, 0.0f, 1.0f) * 4.0f + 1e-4f), 0, 4); }

    /// Which tone (0 = the played note) the k-th repeat (k ≥ 1) takes.
    static int fanTone(int fan, int k, int n, uint32_t seed, uint64_t counter) noexcept {
        if (n <= 1) return 0;
        switch (fan) {
            case EchoFanDown: return (n - k % n) % n;
            case EchoFanUpDown: {
                const int period = 2 * n - 2, p = k % period;
                return p < n ? p : period - p;
            }
            case EchoFanRandom: return (int)(dsp::hash3(seed, counter, 1000 + (uint64_t)k) % (uint64_t)n);
            default: return k % n;
        }
    }

    /// Time of the k-th repeat after the note-on, in quarter notes, with Gravity.
    static double gravityBeats(double beats, double ppq, double gridBeats, float gravity) noexcept {
        const double g = std::max(gridBeats, 1e-3), a = std::fabs((double)gravity);
        if (a < 1e-4) return beats;
        const double b = ppq + beats;
        const double target = gravity > 0.0f ? std::round(b / g) * g : (std::floor(b / g) + 0.5) * g;
        return std::max(0.0, beats + (target - b) * a);
    }

    /// A note-on arrives: sends the original (unless muted) and schedules its repeats.
    template <class Emit>
    void noteOn(int note, float pitch, float velocity, const EchoParams& p, Emit&& emit) noexcept {
        if (!p.muteOriginal) srcToken_[(size_t)std::clamp(note, 0, 127)] = owner_.on(note, pitch, velocity, emit);
        else srcToken_[(size_t)std::clamp(note, 0, 127)] = 0;
        const uint64_t id = counter_++;
        const double spacing = p.free ? p.spacingSeconds * sr_ : dsp::beatsToSamples(p.spacingBeats, p.bpm, sr_);
        if (spacing < 2.0) return;
        const double spacingBeats = p.free ? p.spacingSeconds * p.bpm / 60.0 : p.spacingBeats;
        const int tones = fanTones(p.spread);
        const bool chromatic = p.scale.chromatic();
        static constexpr int kChord[5] = {0, 4, 7, 11, 14};
        int64_t lastDue = now_;
        float vel = velocity;
        for (int k = 1; k <= std::clamp(p.repeats, 0, kEchoMaxRepeats); ++k) {
            vel *= std::clamp(1.0f - p.decay, 0.0f, 1.0f);
            if (vel < 0.004f) break;
            if (p.drop > 0.0f && dsp::uniform01(p.seed, id, (uint64_t)k) < (double)p.drop) continue;
            int target;
            const int tone = fanTone(p.fan, k, tones, p.seed, id);
            if (chromatic) target = note + p.steps * k + kChord[tone];
            else target = dsp::scaleWalk(note, p.steps * k + 2 * tone, p.scale);
            if (target < 0 || target > 127) continue;
            double beatsAt = (double)k * spacingBeats;
            if (p.ppqValid) beatsAt = gravityBeats(beatsAt, p.ppq, p.gridBeats, p.gravity);
            double due = beatsAt / spacingBeats * spacing;
            due = std::max(due, (double)(lastDue - now_) + 1.0);
            lastDue = now_ + (int64_t)std::llround(due);
            const double len = std::max(1.0, std::min((double)p.length, 0.98) * spacing);
            if (queue_.free() < 2) break;
            dsp::TimedNote on, off;
            on.due = lastDue;
            on.on = true;
            on.note = off.note = target;
            on.pitch = off.pitch = pitch + (float)(target - note) / 12.0f;
            on.velocity = vel;
            on.group = off.group = ++group_;
            off.due = on.due + std::max<int64_t>(1, (int64_t)std::llround(len));
            off.on = false;
            queue_.push(on);
            queue_.push(off);
        }
    }

    /// The note-off of an input note.
    template <class Emit>
    void noteOff(int note, Emit&& emit) noexcept {
        uint32_t& t = srcToken_[(size_t)std::clamp(note, 0, 127)];
        if (t) owner_.off(note, t, emit);
        t = 0;
    }

    /// One sample: sends repeats that are due. `canEmit` false holds them back
    /// (the output buffer is nearly full). Returns true when a repeat started.
    template <class Emit>
    bool tick(bool canEmit, Emit&& emit) noexcept {
        const bool started = dsp::playDue(queue_, owner_, now_, canEmit, emit);
        ++now_;
        return started;
    }

    /// Ends everything that sounds and forgets what is pending (cable pulled).
    template <class Emit>
    void flush(Emit&& emit) noexcept {
        queue_.clear();
        owner_.allOff(emit);
        srcToken_.fill(0);
    }

    int pending() const noexcept { return queue_.size(); }
    int sounding() const noexcept { return owner_.count(); }

private:
    double sr_ = 48000.0;
    dsp::TimedNotes<kEchoQueue> queue_;
    dsp::NoteOwner owner_;
    std::array<uint32_t, 128> srcToken_{};
    int64_t now_ = 0;
    uint64_t counter_ = 0;
    uint32_t group_ = 0;
    int pending_ = 0;
    bool tap_ = false;
};

}  // namespace bleep::patch
