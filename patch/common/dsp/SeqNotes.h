// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Note output for sequencers (doc/specs/modules/step-sequencer.md §4.4),
// extracted from the Step Sequencer so every sequencer ties, glides and
// releases notes the same way:
//
//  - a step's note sounds for its gate length (GateTimer, SeqClock.h);
//  - a tied note holds into the next step: a different pitch sends the new
//    note-on first and the old note-off on the same sample (legato, so a
//    Voice Cell glides), the same pitch simply continues;
//  - release() ends whatever sounds; call it on transport stop, Reset,
//    Length/Direction/mode changes and module removal, so no note hangs.
//
// Notes leave through a callback `emit(bool on, int note, float pitch,
// float velocity)` (note = MIDI number, pitch in V/oct with 0 = C4, velocity
// 0…1; note-offs carry the note's pitch and velocity 0), so this stays free
// of the engine's types. noteEmitter() adapts an engine NoteBuffer.
#pragma once

#include "dsp/SeqClock.h"

#include <cstdint>
#include <type_traits>

namespace bleep::dsp {

/// The MIDI note number's pitch in V/oct (60 = C4 = 0 V).
inline float notePitch(int note) noexcept { return (float)(note - 60) / 12.0f; }

/// A callback that pushes into an engine NoteBuffer (anything with
/// `events[]` of NoteEvent and `push`) at sample `offset`. Make one per
/// sample: `auto emit = dsp::noteEmitter(*c.notesOut[Notes], i);`
template <class NoteBufferT>
auto noteEmitter(NoteBufferT& buffer, int offset, int channel = 0) noexcept {
    return [&buffer, offset, channel](bool on, int note, float pitch, float velocity) {
        using Event = std::remove_cv_t<std::remove_reference_t<decltype(buffer.events[0])>>;
        Event e;
        e.type = on ? Event::On : Event::Off;
        e.channel = (decltype(e.channel))channel;
        e.offset = (decltype(e.offset))offset;
        e.note = note;
        e.pitch = pitch;
        e.value = velocity;
        buffer.push(e);
    };
}

/// One monophonic note lane: the Step Sequencer's note logic. Per sample:
///   beginSample();  … release()/rest()/play() at step events …;  endSample(emit);
class SeqVoice {
public:
    /// How play() started the step.
    enum Start : uint8_t {
        Fresh,      ///< a new note-on (Trigger fires); a sounding untied note was ended first
        Legato,     ///< tied into a different pitch: note-on, then the old note-off
        Continued   ///< tied into the same pitch: no events
    };

    /// Forgets everything without events (only when nothing downstream can
    /// still hold a note, e.g. prepare/reset of a fresh module).
    void reset() noexcept {
        sounding_ = tie_ = retrig_ = false;
        note_ = 0;
        pitch_ = velocity_ = 0.0f;
        timer_.reset();
    }

    /// Start of every sample, before any other call.
    void beginSample() noexcept {
        retrig_ = false;
        timer_.advance();
    }

    /// A step with a note. `tie`: hold into the next step instead of ending
    /// after `gateLen` samples (gateSamples() in SeqClock.h).
    template <class Emit>
    Start play(int note, float pitch, float velocity, bool tie, int64_t gateLen, Emit&& emit) noexcept {
        timer_.start(gateLen);
        Start how = Fresh;
        if (sounding_ && tie_) {
            if (note != note_) {  // legato: the new note first
                emit(true, note, pitch, velocity);
                emit(false, note_, pitch_, 0.0f);
                how = Legato;
            } else {
                how = Continued;
            }
        } else {
            if (sounding_) {
                emit(false, note_, pitch_, 0.0f);
                retrig_ = true;
            }
            emit(true, note, pitch, velocity);
        }
        note_ = note;
        pitch_ = pitch;
        velocity_ = velocity;
        sounding_ = true;
        tie_ = tie;
        return how;
    }

    /// A step without a note (Off/Rest): a sounding or tied note ends here.
    template <class Emit>
    void rest(Emit&& emit) noexcept {
        timer_.start(1);
        release(emit);
    }

    /// Ends the sounding note now (if any).
    template <class Emit>
    void release(Emit&& emit) noexcept {
        if (sounding_) emit(false, note_, pitch_, 0.0f);
        sounding_ = tie_ = false;
    }

    /// End of every sample: ends an untied note whose gate length passed.
    template <class Emit>
    void endSample(Emit&& emit) noexcept {
        if (sounding_ && !tie_ && timer_.expired()) {
            emit(false, note_, pitch_, 0.0f);
            sounding_ = false;
        }
    }

    bool sounding() const noexcept { return sounding_; }
    bool tied() const noexcept { return tie_; }
    /// This sample ended a note to start the next one (Gate output dips).
    bool retriggered() const noexcept { return retrig_; }
    /// The Gate output: high while a note sounds, low for one sample at a retrigger.
    bool gate() const noexcept { return sounding_ && !retrig_; }
    /// The last played note; held after the note ends (Pitch/Velocity outputs hold).
    int note() const noexcept { return note_; }
    float pitch() const noexcept { return pitch_; }
    float velocity() const noexcept { return velocity_; }
    const GateTimer& timer() const noexcept { return timer_; }

private:
    GateTimer timer_;
    bool sounding_ = false, tie_ = false, retrig_ = false;
    int note_ = 0;
    float pitch_ = 0.0f, velocity_ = 0.0f;
};

/// A note for SeqNoteSet.
struct SeqNote {
    int note = 60;          ///< MIDI note number (identifies the note)
    float pitch = 0.0f;     ///< V/oct, 0 = C4
    float velocity = 0.8f;  ///< 0…1
};

/// A set of up to N sounding notes (chords, drum hits): change to a new set
/// with common tones held, retrigger, or release everything.
template <int N = 16>
class SeqNoteSet {
public:
    static constexpr int kCapacity = N;

    void reset() noexcept { count_ = 0; }

    /// Changes to `notes` (duplicates by note number are skipped, more than
    /// N ignored): notes in both keep sounding, new ones get a note-on, then
    /// leaving ones a note-off, all on this sample (note-ons first).
    template <class Emit>
    void set(const SeqNote* notes, int count, Emit&& emit) noexcept {
        SeqNote next[N];
        int m = 0;
        for (int i = 0; i < count && m < N; ++i)
            if (find(next, m, notes[i].note) < 0) next[m++] = notes[i];
        for (int i = 0; i < m; ++i)
            if (find(held_, count_, next[i].note) < 0) emit(true, next[i].note, next[i].pitch, next[i].velocity);
        for (int i = 0; i < count_; ++i)
            if (find(next, m, held_[i].note) < 0) emit(false, held_[i].note, held_[i].pitch, 0.0f);
        for (int i = 0; i < m; ++i) {
            const int k = find(held_, count_, next[i].note);
            if (k >= 0) next[i] = held_[k];  // a held note keeps its pitch and velocity
        }
        for (int i = 0; i < m; ++i) held_[i] = next[i];
        count_ = m;
    }

    /// Ends everything, then starts `notes` (all on this sample).
    template <class Emit>
    void retrigger(const SeqNote* notes, int count, Emit&& emit) noexcept {
        release(emit);
        set(notes, count, emit);
    }

    /// One note on; a note already sounding is retriggered (off, then on).
    template <class Emit>
    bool noteOn(const SeqNote& n, Emit&& emit) noexcept {
        const int k = find(held_, count_, n.note);
        if (k >= 0) {
            emit(false, held_[k].note, held_[k].pitch, 0.0f);
            emit(true, n.note, n.pitch, n.velocity);
            held_[k] = n;
            return true;
        }
        if (count_ >= N) return false;
        emit(true, n.note, n.pitch, n.velocity);
        held_[count_++] = n;
        return true;
    }

    /// One note off (if sounding).
    template <class Emit>
    void noteOff(int note, Emit&& emit) noexcept {
        const int k = find(held_, count_, note);
        if (k < 0) return;
        emit(false, held_[k].note, held_[k].pitch, 0.0f);
        for (int i = k + 1; i < count_; ++i) held_[i - 1] = held_[i];
        --count_;
    }

    /// Ends every sounding note.
    template <class Emit>
    void release(Emit&& emit) noexcept {
        for (int i = 0; i < count_; ++i) emit(false, held_[i].note, held_[i].pitch, 0.0f);
        count_ = 0;
    }

    int count() const noexcept { return count_; }
    const SeqNote& operator[](int i) const noexcept { return held_[i]; }
    bool contains(int note) const noexcept { return find(held_, count_, note) >= 0; }

private:
    static int find(const SeqNote* list, int count, int note) noexcept {
        for (int i = 0; i < count; ++i)
            if (list[i].note == note) return i;
        return -1;
    }

    SeqNote held_[N];
    int count_ = 0;
};

}  // namespace bleep::dsp
