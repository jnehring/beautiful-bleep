// SPDX-License-Identifier: GPL-3.0-only
// Melody Mirror core (doc/specs/modules/melody-mirror.md): remembers the last
// N notes of a `notes` stream, with their timing, and plays them back turned
// around:
//
//   Reverse   played backwards in time (the rhythm too)
//   Invert    pitches mirrored around an axis, the rhythm kept
//   Rotate    the pitches shifted along the rhythm by k notes
//   Mirror    Reverse and Invert together
//   Answer    waits for a pause, then plays the phrase it just heard as a
//             reply (turned by the Reply setting) while ignoring the input,
//             and listens again
//
// A phrase starts from a trigger, or by itself after a pause (Start: Gap).
// Header-only, no JUCE; notes leave through a callback.
#pragma once

#include "dsp/NoteStream.h"
#include "dsp/SeqNotes.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kMirrorMax = 16;

enum MirrorFn : int { MirrorReverse = 0, MirrorInvert, MirrorRotate, MirrorMirror, MirrorAnswer, MirrorNumModes };
enum MirrorAxis : int { AxisFirst = 0, AxisMean, AxisFixed };

/// One remembered or transformed note; times in samples from the phrase start.
struct PhraseNote {
    int64_t onset = 0;
    int64_t length = 0;
    int note = 60;
    float pitch = 0.0f;
    float velocity = 0.8f;
};

struct MirrorParams {
    int mode = MirrorReverse;
    int reply = MirrorMirror;       ///< Answer: how the reply is turned (MirrorFn, not Answer)
    int length = 6;                 ///< notes in the phrase
    int axisMode = AxisFirst;
    int axis = 60;
    int rotate = 1;
    bool startOnGap = true;         ///< a pause starts the phrase (always true in Answer)
    double gapSamples = 24000.0;    ///< the pause that starts it
    float speed = 1.0f;
    int transpose = 0;
    float velocity = 1.0f;
    float gateLength = 1.0f;
    bool muteThru = false;
    bool snap = false;
    dsp::ScaleContext scale;
};

class MelodyMirrorDsp {
public:
    static const std::array<const char*, MirrorNumModes>& modeNames() {
        static const std::array<const char*, MirrorNumModes> n{{"Reverse", "Invert", "Rotate", "Mirror", "Answer"}};
        return n;
    }

    void prepare(double) noexcept { reset(); }
    void reset() noexcept {
        queue_.clear();
        owner_.reset();
        thruToken_.fill(0);
        count_ = 0;
        fresh_ = 0;
        now_ = 0;
        lastEvent_ = 0;
        playEnd_ = 0;
        playing_ = false;
    }

    /// The phrase with `fn` applied (Answer is treated as the reply function),
    /// onsets from 0 and ascending. `in` is in the order played. Returns the count.
    static int transform(const PhraseNote* in, int n, const MirrorParams& p, int fn, PhraseNote* out) noexcept {
        n = std::clamp(n, 0, kMirrorMax);
        if (n == 0) return 0;
        if (fn == MirrorAnswer) fn = p.reply == MirrorAnswer ? MirrorMirror : p.reply;
        PhraseNote a[kMirrorMax];
        const int64_t t0 = in[0].onset;
        int64_t end = 0;
        for (int i = 0; i < n; ++i) {
            a[i] = in[i];
            a[i].onset -= t0;
            a[i].length = std::max<int64_t>(1, a[i].length);
            end = std::max(end, a[i].onset + a[i].length);
        }
        const bool reverse = fn == MirrorReverse || fn == MirrorMirror;
        const bool invert = fn == MirrorInvert || fn == MirrorMirror;
        if (fn == MirrorRotate) {
            int note[kMirrorMax];
            float pitch[kMirrorMax];
            for (int i = 0; i < n; ++i) {
                const int j = (((i + p.rotate) % n) + n) % n;
                note[i] = a[j].note;
                pitch[i] = a[j].pitch;
            }
            for (int i = 0; i < n; ++i) a[i].note = note[i], a[i].pitch = pitch[i];
        }
        if (reverse) {
            for (int i = 0; i < n; ++i) a[i].onset = end - (a[i].onset + a[i].length);
            std::stable_sort(a, a + n, [](const PhraseNote& x, const PhraseNote& y) { return x.onset < y.onset; });
        }
        if (invert) {
            int axis = p.axis;
            if (p.axisMode == AxisFirst) {
                axis = in[0].note;
            } else if (p.axisMode == AxisMean) {
                int sum = 0;
                for (int i = 0; i < n; ++i) sum += in[i].note;
                axis = (int)std::lround((double)sum / n);
            }
            for (int i = 0; i < n; ++i) {
                int m = 2 * axis - a[i].note;
                while (m < 0) m += 12;
                while (m > 127) m -= 12;
                a[i].pitch += (float)(m - a[i].note) / 12.0f;
                a[i].note = m;
            }
        }
        const double speed = std::clamp((double)p.speed, 0.05, 20.0);
        for (int i = 0; i < n; ++i) {
            PhraseNote& o = a[i];
            int m = std::clamp(o.note + p.transpose, 0, 127);
            if (p.snap && !p.scale.chromatic()) m = std::clamp(dsp::snapToScale(m, p.scale), 0, 127);
            o.pitch += (float)(m - o.note) / 12.0f;
            o.note = m;
            o.velocity = std::clamp(o.velocity * p.velocity, 0.01f, 1.0f);
            o.onset = (int64_t)std::llround((double)o.onset / speed);
            o.length = std::max<int64_t>(1, (int64_t)std::llround((double)o.length * std::max(0.05f, p.gateLength) / speed));
            out[i] = o;
        }
        return n;
    }

    /// The function a mode plays (Answer: the Reply setting).
    static int functionOf(const MirrorParams& p) noexcept { return p.mode == MirrorAnswer ? (p.reply == MirrorAnswer ? MirrorMirror : p.reply) : p.mode; }

    /// A note-on of the input.
    template <class Emit>
    void noteOn(int note, float pitch, float velocity, const MirrorParams& p, Emit&& emit) noexcept {
        lastEvent_ = now_;
        if (!p.muteThru) thruToken_[slot(note)] = owner_.on(note, pitch, velocity, emit);
        if (answering(p)) return;  // not listening while it answers
        if (count_ >= kMirrorMax) {
            for (int i = 1; i < count_; ++i) rec_[(size_t)(i - 1)] = rec_[(size_t)i], open_[(size_t)(i - 1)] = open_[(size_t)i];
            --count_;
        }
        PhraseNote n;
        n.onset = now_;
        n.length = 0;
        n.note = note;
        n.pitch = pitch;
        n.velocity = velocity;
        rec_[(size_t)count_] = n;
        open_[(size_t)count_++] = true;
        ++fresh_;
    }

    template <class Emit>
    void noteOff(int note, Emit&& emit) noexcept {
        lastEvent_ = now_;
        uint32_t& t = thruToken_[slot(note)];
        if (t) owner_.off(note, t, emit);
        t = 0;
        for (int i = count_ - 1; i >= 0; --i)
            if (open_[(size_t)i] && rec_[(size_t)i].note == note) {
                rec_[(size_t)i].length = std::max<int64_t>(1, now_ - rec_[(size_t)i].onset);
                open_[(size_t)i] = false;
                break;
            }
    }

    /// Plays the phrase now (a trigger). `onlyFresh` limits it to the notes heard since the last phrase.
    bool start(const MirrorParams& p, bool onlyFresh) noexcept {
        const int n = phrase(p, onlyFresh);
        if (n == 0) return false;
        PhraseNote src[kMirrorMax], out[kMirrorMax];
        copyPhrase(n, src);
        const int m = transform(src, n, p, functionOf(p), out);
        // notes of the last phrase that did not start yet are dropped; the ones that sound end as planned
        queue_.removeIf([](const dsp::TimedNote& t) { return t.on || t.token == 0; });
        int64_t end = now_;
        uint32_t g = ++group_;
        for (int i = 0; i < m; ++i) {
            dsp::TimedNote on, off;
            on.due = now_ + out[i].onset;
            off.due = on.due + out[i].length;
            on.on = true;
            off.on = false;
            on.note = off.note = out[i].note;
            on.pitch = off.pitch = out[i].pitch;
            on.velocity = out[i].velocity;
            on.group = off.group = ++g;
            queue_.push(on);
            queue_.push(off);
            end = std::max(end, off.due);
        }
        group_ = g;
        playEnd_ = end;
        startAt_ = now_;
        playing_ = true;
        fresh_ = 0;
        return true;
    }

    /// One sample: starts a phrase after a pause, sends what is due. Returns true on a phrase start.
    template <class Emit>
    bool tick(const MirrorParams& p, bool canEmit, Emit&& emit) noexcept {
        bool started = false;
        if (playing_ && queue_.size() == 0) playing_ = false;
        if ((p.startOnGap || p.mode == MirrorAnswer) && !playing_ && fresh_ > 0 && heldCount() == 0 &&
            (double)(now_ - lastEvent_) >= p.gapSamples)
            started = start(p, true);
        dsp::playDue(queue_, owner_, now_, canEmit, emit);
        ++now_;
        return started;
    }

    /// Forgets the phrase.
    void clear() noexcept {
        count_ = 0;
        fresh_ = 0;
    }

    template <class Emit>
    void flush(Emit&& emit) noexcept {
        queue_.clear();
        owner_.allOff(emit);
        thruToken_.fill(0);
        playing_ = false;
    }

    bool playing() const noexcept { return playing_; }
    /// Where the running phrase is, 0…1; −1 when none plays.
    double playPosition() const noexcept {
        if (!playing_) return -1.0;
        return std::clamp((double)(now_ - startAt_) / (double)std::max<int64_t>(1, playEnd_ - startAt_), 0.0, 1.0);
    }
    bool answering(const MirrorParams& p) const noexcept { return p.mode == MirrorAnswer && playing_; }
    int count() const noexcept { return count_; }
    int fresh() const noexcept { return fresh_; }
    int sounding() const noexcept { return owner_.count(); }
    int heldCount() const noexcept {
        int c = 0;
        for (int i = 0; i < count_; ++i) c += open_[(size_t)i] ? 1 : 0;
        return c;
    }
    /// The remembered notes (the last `length`, or only the fresh ones), in the order played.
    int phrase(const MirrorParams& p, bool onlyFresh) const noexcept {
        int n = std::min(count_, std::clamp(p.length, 1, kMirrorMax));
        if (onlyFresh) n = std::min(n, fresh_);
        return n;
    }
    void copyPhrase(int n, PhraseNote* dst) const noexcept {
        for (int i = 0; i < n; ++i) {
            dst[i] = rec_[(size_t)(count_ - n + i)];
            if (open_[(size_t)(count_ - n + i)]) dst[i].length = std::max<int64_t>(1, now_ - dst[i].onset);
        }
    }

private:
    static size_t slot(int note) noexcept { return (size_t)std::clamp(note, 0, 127); }
    dsp::TimedNotes<64> queue_;
    dsp::NoteOwner owner_;
    std::array<uint32_t, 128> thruToken_{};
    std::array<PhraseNote, kMirrorMax> rec_{};
    std::array<bool, kMirrorMax> open_{};
    int count_ = 0, fresh_ = 0;
    int64_t now_ = 0, lastEvent_ = 0, playEnd_ = 0, startAt_ = 0;
    uint32_t group_ = 0;
    bool playing_ = false;
};

}  // namespace bleep::patch
