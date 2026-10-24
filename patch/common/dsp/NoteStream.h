// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Helpers for modules that take a `notes` stream in and send one out (Note
// Echo, Melody Mirror, Note Gate, Note Looper), free of the engine's types:
//
//  - NoteOwner     one note number sounds once: a second note-on of a sounding
//                  note ends the first (note-off, then note-on), and a
//                  note-off only counts for the note-on that owns the number.
//                  Several sources (the input and a delayed copy of it) can
//                  share a number without cutting each other short.
//  - TimedNotes    a time-ordered queue of notes still to be sent, in samples.
//  - scaleWalk()   a pitch moved by scale steps instead of semitones.
//
// Notes leave through `emit(bool on, int note, float pitch, float velocity)`
// as in SeqNotes.h. Header-only, no allocation.
#pragma once

#include "dsp/Chords.h"
#include "dsp/Scales.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

/// Tracks which note-on owns a sounding MIDI note number.
class NoteOwner {
public:
    void reset() noexcept {
        sounding_.fill(false);
        next_ = 1;
    }

    /// A note-on; returns the token its note-off must carry (see off()).
    template <class Emit>
    uint32_t on(int note, float pitch, float velocity, Emit&& emit) noexcept {
        const size_t k = slot(note);
        if (sounding_[k]) emit(false, note, pitch_[k], 0.0f);
        sounding_[k] = true;
        owner_[k] = next_;
        pitch_[k] = pitch;
        emit(true, note, pitch, velocity);
        return next_++;
    }

    /// A note-off for the note-on that returned `token`; ignored (false) when
    /// a later note-on took the number over, or the note already ended.
    template <class Emit>
    bool off(int note, uint32_t token, Emit&& emit) noexcept {
        const size_t k = slot(note);
        if (!sounding_[k] || owner_[k] != token) return false;
        sounding_[k] = false;
        emit(false, note, pitch_[k], 0.0f);
        return true;
    }

    /// Ends every sounding note.
    template <class Emit>
    void allOff(Emit&& emit) noexcept {
        for (int n = 0; n < 128; ++n)
            if (sounding_[(size_t)n]) {
                sounding_[(size_t)n] = false;
                emit(false, n, pitch_[(size_t)n], 0.0f);
            }
    }

    bool sounding(int note) const noexcept { return sounding_[slot(note)]; }
    int count() const noexcept {
        int c = 0;
        for (bool b : sounding_) c += b ? 1 : 0;
        return c;
    }

private:
    static size_t slot(int note) noexcept { return (size_t)std::clamp(note, 0, 127); }
    std::array<bool, 128> sounding_{};
    std::array<uint32_t, 128> owner_{};
    std::array<float, 128> pitch_{};
    uint32_t next_ = 1;
};

/// A note to send later.
struct TimedNote {
    int64_t due = 0;  ///< sample (any monotonic counter the caller keeps)
    bool on = true;
    int note = 60;
    float pitch = 0.0f;
    float velocity = 0.8f;
    uint32_t group = 0;  ///< pairs an off with its on (the on's token is kept by the caller)
    uint32_t token = 0;  ///< filled by the caller when the note-on went out
    uint8_t channel = 0;
};

/// Up to N notes waiting, kept sorted by due time (ties keep their order, so
/// a note-off scheduled before a note-on of the same sample goes first).
template <int N>
class TimedNotes {
public:
    static constexpr int kCapacity = N;
    void clear() noexcept { count_ = 0; }
    int size() const noexcept { return count_; }
    int free() const noexcept { return N - count_; }
    const TimedNote& operator[](int i) const noexcept { return items_[(size_t)i]; }
    TimedNote& operator[](int i) noexcept { return items_[(size_t)i]; }

    bool push(const TimedNote& n) noexcept {
        if (count_ >= N) return false;
        int i = count_;
        while (i > 0 && items_[(size_t)(i - 1)].due > n.due) {
            items_[(size_t)i] = items_[(size_t)(i - 1)];
            --i;
        }
        items_[(size_t)i] = n;
        ++count_;
        return true;
    }
    /// The earliest note if it is due at or before `now`.
    const TimedNote* due(int64_t now) const noexcept { return count_ > 0 && items_[0].due <= now ? &items_[0] : nullptr; }
    void pop() noexcept {
        if (count_ == 0) return;
        for (int i = 1; i < count_; ++i) items_[(size_t)(i - 1)] = items_[(size_t)i];
        --count_;
    }
    /// Removes every note for which `pred(note)` is true.
    template <class Pred>
    void removeIf(Pred&& pred) noexcept {
        int m = 0;
        for (int i = 0; i < count_; ++i)
            if (!pred(items_[(size_t)i])) items_[(size_t)m++] = items_[(size_t)i];
        count_ = m;
    }

private:
    std::array<TimedNote, (size_t)N> items_{};
    int count_ = 0;
};


/// Sends the notes of `queue` that are due at `now` through `owner`: a note-on
/// takes the number over (see NoteOwner) and hands its token to the paired
/// note-off still waiting; a note-off whose note-on was cut short is dropped.
/// `canEmit` false holds everything back (the output buffer is nearly full).
/// Returns true when a note-on went out.
template <int N, class Emit>
bool playDue(TimedNotes<N>& queue, NoteOwner& owner, int64_t now, bool canEmit, Emit&& emit) noexcept {
    bool started = false;
    while (canEmit) {
        const TimedNote* d = queue.due(now);
        if (!d) break;
        const TimedNote n = *d;
        queue.pop();
        if (n.on) {
            const uint32_t token = owner.on(n.note, n.pitch, n.velocity, emit);
            for (int i = 0; i < queue.size(); ++i)
                if (!queue[i].on && queue[i].group == n.group) queue[i].token = token;
            started = true;
        } else if (n.token) {
            owner.off(n.note, n.token, emit);
        }
    }
    return started;
}

/// The board's key and scale as an absolute (relative to C) pitch-class mask.
struct ScaleContext {
    int key = 0;            ///< pitch class of the root, 0…11
    uint16_t mask = 0xab5;  ///< bit k: k semitones above the key belong to the scale
    bool chromatic() const noexcept { return (mask & 0xfff) == 0xfff || (mask & 0xfff) == 0; }
    bool contains(int note) const noexcept { return inScale(mask, note - key); }
};

/// The scale note nearest to `note` (ties go down).
inline int snapToScale(int note, const ScaleContext& sc) noexcept {
    return sc.key + quantize((float)(note - sc.key), sc.mask);
}

/// `note` moved by `steps` scale steps (a note outside the scale is snapped
/// first). A chromatic scale moves by semitones. The result is not limited
/// to 0…127.
inline int scaleWalk(int note, int steps, const ScaleContext& sc) noexcept {
    if (steps == 0) return sc.contains(note) || sc.chromatic() ? note : snapToScale(note, sc);
    const int rel = quantize((float)(note - sc.key), sc.mask);
    return sc.key + scaleNote(sc.mask, scaleIndexOf(sc.mask, rel) + steps);
}

}  // namespace bleep::dsp
