// SPDX-License-Identifier: GPL-3.0-only
// Notes to CV core (doc/specs/modules/notes-to-cv.md §4): a held-note list, one
// active note by priority, and mono pitch/gate/velocity/pressure out.
#pragma once

#include "dsp/Smoothing.h"

#include <algorithm>
#include <cstdint>

namespace bleep::patch {

enum NotePriority { PriorityLast = 0, PriorityLowest, PriorityHighest, PriorityFirst };

struct NotesToCvParams {
    float glide = 0.0f;  ///< seconds
    int priority = PriorityLast;
    bool retrigger = true;
    bool glideLegatoOnly = false;
    int channel = -1;    ///< −1: all, else 0..15
};

struct NotesToCvFrame {
    float pitch = 0.0f, gate = 0.0f, trigger = 0.0f, velocity = 0.0f, release = 0.0f, pressure = 0.0f, count = 0.0f;
};

class NotesToCvDsp {
public:
    static constexpr int kMaxHeld = 32;

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        held_ = 0;
        active_ = -1;
        pitch_ = velocity_ = release_ = pressure_ = 0.0f;
        trigger_ = false;
        gap_ = false;
        glideNow_ = false;
        glide_.reset(0.0f);
        started_ = false;
    }

    void noteOn(int channel, int note, float pitch, float velocity, const NotesToCvParams& p) noexcept {
        if (p.channel >= 0 && channel != p.channel) return;
        remove(note);
        if (held_ == kMaxHeld) removeAt(0);  // drop the oldest
        notes_[held_++] = {note, pitch, velocity, 0.0f};
        update(p);
    }
    void noteOff(int channel, int note, float velocity, const NotesToCvParams& p) noexcept {
        if (p.channel >= 0 && channel != p.channel) return;
        if (!remove(note)) return;
        release_ = velocity;
        update(p);
    }
    void pressure(int channel, int note, float value, const NotesToCvParams& p) noexcept {
        if (p.channel >= 0 && channel != p.channel) return;
        for (int i = 0; i < held_; ++i)
            if (notes_[i].note == note) notes_[i].pressure = value;
        if (active_ == note) pressure_ = value;
    }
    void releaseAll(const NotesToCvParams& p) noexcept {
        held_ = 0;
        update(p);
    }

    /// One sample, after this sample's events.
    void tick(const NotesToCvParams& p, NotesToCvFrame& f) noexcept {
        const float time = p.glideLegatoOnly && !glideNow_ ? 0.0f : p.glide;
        f.pitch = glide_.process(pitch_, time, sampleRate_);
        f.gate = held_ > 0 && !gap_ ? 1.0f : 0.0f;
        f.trigger = trigger_ ? 1.0f : 0.0f;
        f.velocity = velocity_;
        f.release = release_;
        f.pressure = held_ > 0 ? pressure_ : 0.0f;
        f.count = std::min(1.0f, (float)held_ / 16.0f);
        trigger_ = gap_ = false;
    }

    int heldCount() const noexcept { return held_; }
    int heldNote(int i) const noexcept { return notes_[i].note; }
    int activeNote() const noexcept { return held_ > 0 ? active_ : -1; }

private:
    struct Held {
        int note;
        float pitch, velocity, pressure;
    };

    bool remove(int note) noexcept {
        for (int i = 0; i < held_; ++i)
            if (notes_[i].note == note) {
                removeAt(i);
                return true;
            }
        return false;
    }
    void removeAt(int i) noexcept {
        for (int k = i; k + 1 < held_; ++k) notes_[k] = notes_[k + 1];
        --held_;
    }
    int choose(int priority) const noexcept {
        int best = held_ - 1;  // last
        if (priority == PriorityFirst) best = 0;
        for (int i = 0; i < held_; ++i) {
            if (priority == PriorityLowest && notes_[i].pitch < notes_[best].pitch) best = i;
            if (priority == PriorityHighest && notes_[i].pitch > notes_[best].pitch) best = i;
        }
        return best;
    }
    void update(const NotesToCvParams& p) noexcept {
        if (held_ == 0) {
            active_ = -1;  // Pitch and Velocity hold
            return;
        }
        const Held& n = notes_[choose(p.priority)];
        if (n.note == active_) return;
        const bool legato = active_ >= 0;  // another note was still held
        active_ = n.note;
        pitch_ = n.pitch;
        velocity_ = n.velocity;
        pressure_ = n.pressure;
        trigger_ = true;
        gap_ = legato && p.retrigger;
        glideNow_ = legato;
        if (!started_ || (p.glideLegatoOnly && !legato)) glide_.reset(pitch_);
        started_ = true;
    }

    double sampleRate_ = 48000.0;
    Held notes_[kMaxHeld] = {};
    int held_ = 0, active_ = -1;
    float pitch_ = 0.0f, velocity_ = 0.0f, release_ = 0.0f, pressure_ = 0.0f;
    bool trigger_ = false, gap_ = false, glideNow_ = false, started_ = false;
    dsp::OnePole glide_;
};

}  // namespace bleep::patch
