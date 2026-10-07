// SPDX-License-Identifier: MIT
// MIDI Out: turns bus signals into MIDI. Gate + Pitch become notes,
// three controls become CC A, CC B and 14-bit pitch bend.
// Values are kept at high resolution internally so MPE / MIDI 2.0 can follow.
#pragma once

#include "dsp/Smoothing.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

struct MidiOutParams {
    float velocity = 0.8f; ///< 0..1
    float ccA = 0.0f;      ///< 0..1
    float ccB = 0.0f;      ///< 0..1
    float bend = 0.0f;     ///< -1..1
    int channel = 1;       ///< 1..16
    int ccANumber = 1;
    int ccBNumber = 74;
    int transpose = 0;     ///< semitones
    bool sendCCs = true;
};

/// Sink receives raw MIDI bytes with a sample offset inside the host block.
template <typename Sink>
class MidiOutDsp {
public:
    static constexpr int kControlInterval = 32; ///< samples between CC/bend checks

    static int noteFor(float pitch, int transpose) noexcept {
        return std::clamp(60 + transpose + (int)std::lround(pitch * 12.0f), 0, 127);
    }

    void reset() noexcept {
        gate_.reset();
        activeNote_ = -1;
        lastA_ = lastB_ = lastBend_ = -1;
        counter_ = 0;
    }

    /// Releases a hanging note (call on stop, bypass, or reset).
    void allNotesOff(Sink& sink, int offset, int channel) noexcept {
        if (activeNote_ >= 0) noteOff(sink, offset, channel);
    }

    void tick(const MidiOutParams& p, float gate, float pitch, int offset, Sink& sink) noexcept {
        const int ch = std::clamp(p.channel, 1, 16);
        const int edge = gate_.process(gate);
        const int note = noteFor(pitch, p.transpose);
        if (edge > 0) {
            if (activeNote_ >= 0) noteOff(sink, offset, ch);
            noteOn(sink, offset, ch, note, p.velocity);
        } else if (edge < 0) {
            if (activeNote_ >= 0) noteOff(sink, offset, ch);
        } else if (gate_.high() && activeNote_ >= 0 && note != activeNote_) {
            // Legato: start the new note before releasing the old one.
            const int old = activeNote_;
            noteOn(sink, offset, ch, note, p.velocity);
            const uint8_t off[3] = {(uint8_t)(0x80 | (ch - 1)), (uint8_t)old, 0};
            sink(offset, off, 3);
        }

        if (p.sendCCs && counter_++ % kControlInterval == 0) {
            const int a = std::clamp((int)std::lround(p.ccA * 127.0f), 0, 127);
            const int b = std::clamp((int)std::lround(p.ccB * 127.0f), 0, 127);
            const int bend = std::clamp((int)std::lround((p.bend * 0.5f + 0.5f) * 16383.0f), 0, 16383);
            if (a != lastA_) {
                const uint8_t m[3] = {(uint8_t)(0xB0 | (ch - 1)), (uint8_t)std::clamp(p.ccANumber, 0, 127), (uint8_t)a};
                sink(offset, m, 3);
                lastA_ = a;
            }
            if (b != lastB_) {
                const uint8_t m[3] = {(uint8_t)(0xB0 | (ch - 1)), (uint8_t)std::clamp(p.ccBNumber, 0, 127), (uint8_t)b};
                sink(offset, m, 3);
                lastB_ = b;
            }
            if (bend != lastBend_) {
                const uint8_t m[3] = {(uint8_t)(0xE0 | (ch - 1)), (uint8_t)(bend & 0x7f), (uint8_t)(bend >> 7)};
                sink(offset, m, 3);
                lastBend_ = bend;
            }
        }
    }

    int activeNote() const noexcept { return activeNote_; }

private:
    void noteOn(Sink& sink, int offset, int ch, int note, float velocity) noexcept {
        const int vel = std::clamp((int)std::lround(velocity * 127.0f), 1, 127);
        const uint8_t m[3] = {(uint8_t)(0x90 | (ch - 1)), (uint8_t)note, (uint8_t)vel};
        sink(offset, m, 3);
        activeNote_ = note;
    }
    void noteOff(Sink& sink, int offset, int ch) noexcept {
        const uint8_t m[3] = {(uint8_t)(0x80 | (ch - 1)), (uint8_t)activeNote_, 0};
        sink(offset, m, 3);
        activeNote_ = -1;
    }

    dsp::GateEdge gate_;
    int activeNote_ = -1;
    int lastA_ = -1, lastB_ = -1, lastBend_ = -1;
    uint32_t counter_ = 0;
};

}  // namespace bleep::patch
