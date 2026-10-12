// SPDX-License-Identifier: MIT
// Monitor core (doc/specs/modules/monitor.md §4): the MIDI event log and the held
// notes, the CV statistics and the gate statistics. The audio meter is
// LevelMeterDsp. No JUCE and no engine types; the audio thread writes, the
// message thread reads (atomics only).
#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

namespace bleep::patch {

// ---- MIDI --------------------------------------------------------------------

/// The log's event types: the same numbers as engine NoteEvent::Type.
enum MonitorEventType : int {
    kMonNoteOn = 0, kMonNoteOff, kMonPressure, kMonCc, kMonProgram, kMonBend, kMonChannelPressure, kMonSystem
};

constexpr int kMonitorLogSize = 256;   ///< events kept (a power of two)
constexpr int kMonitorShown = 64;      ///< events the view reads per update

/// What a log slot holds, in MIDI's own units: note/controller/program/status number `a`,
/// data `b` (velocity, pressure, CC value 0..127; bend −8192..+8191).
struct MonitorEvent {
    int type = 0, channel = 0, a = 0, b = 0;
};

/// A lock-free ring of the latest MIDI events: one writer (the audio thread), any readers.
/// Each slot is one 64-bit atomic, so a reader never sees half an event.
class MidiLog {
public:
    void reset() noexcept {
        for (auto& s : slots_) s.store(0, std::memory_order_relaxed);
        written_.store(0, std::memory_order_relaxed);
    }

    /// Writer: appends an event. `data` is MIDI's data in the event's own units (see MonitorEvent).
    void push(const MonitorEvent& e) noexcept {
        const uint32_t w = written_.load(std::memory_order_relaxed);
        const uint64_t v = (uint64_t)(uint8_t)e.type | (uint64_t)(uint8_t)e.channel << 8 |
                           (uint64_t)(uint16_t)e.a << 16 | (uint64_t)(uint16_t)(int16_t)e.b << 32;
        slots_[w & (kMonitorLogSize - 1)].store(v, std::memory_order_relaxed);
        written_.store(w + 1, std::memory_order_release);
    }

    uint32_t written() const noexcept { return written_.load(std::memory_order_acquire); }

    /// Reader: the newest `n` events (at most what exists and the ring holds), oldest first.
    /// `total` receives the count of events ever written, read before the events.
    std::vector<MonitorEvent> latest(int n, uint32_t& total) const {
        total = written_.load(std::memory_order_acquire);
        n = (int)std::min<uint32_t>((uint32_t)std::min(n, kMonitorLogSize - 1), total);
        std::vector<MonitorEvent> out((size_t)n);
        for (int k = 0; k < n; ++k) {
            const uint64_t v = slots_[(total - (uint32_t)n + (uint32_t)k) & (kMonitorLogSize - 1)].load(std::memory_order_relaxed);
            MonitorEvent& e = out[(size_t)k];
            e.type = (int)(v & 0xff);
            e.channel = (int)(v >> 8 & 0xff);
            e.a = (int)(v >> 16 & 0xffff);
            e.b = (int)(int16_t)(v >> 32 & 0xffff);
        }
        return out;
    }

private:
    std::atomic<uint64_t> slots_[kMonitorLogSize] = {};
    std::atomic<uint32_t> written_{0};
};

/// The notes that are on right now, as four 32-bit words (notes 0..127), kept by note number:
/// a note-off from any channel ends the note.
class HeldNotes {
public:
    void reset() noexcept {
        for (auto& w : words_) w.store(0, std::memory_order_relaxed);
    }
    void on(int note) noexcept { set(note, true); }
    void off(int note) noexcept { set(note, false); }
    uint32_t word(int i) const noexcept { return words_[i & 3].load(std::memory_order_relaxed); }
    bool held(int note) const noexcept {
        return note >= 0 && note < 128 && (word(note >> 5) >> (note & 31) & 1u) != 0;
    }
    int count() const noexcept {
        int n = 0;
        for (int i = 0; i < 4; ++i) {
            uint32_t x = word(i);
            while (x) { x &= x - 1; ++n; }
        }
        return n;
    }

private:
    void set(int note, bool on) noexcept {
        if (note < 0 || note > 127) return;
        const uint32_t bit = 1u << (note & 31);
        const uint32_t w = words_[note >> 5].load(std::memory_order_relaxed);
        words_[note >> 5].store(on ? (w | bit) : (w & ~bit), std::memory_order_relaxed);
    }
    std::atomic<uint32_t> words_[4] = {};
};

/// Packs one MIDI-style event for the log: a note's velocity, a pressure or a CC value
/// (0..1) become 0..127; a bend (−1..+1) becomes −8192..+8191.
inline MonitorEvent monitorEvent(int type, int channel, int a, float value) noexcept {
    MonitorEvent e;
    e.type = type;
    e.channel = channel;
    e.a = a;
    e.b = type == kMonBend ? (int)std::lround(std::clamp(value, -1.0f, 1.0f) * 8192.0f) : (int)std::lround(std::clamp(value, 0.0f, 1.0f) * 127.0f);
    e.b = std::clamp(e.b, -8192, 8191);
    return e;
}

// ---- CV ----------------------------------------------------------------------

/// The CV input as numbers: the last value, and the lowest and highest since the view last read them
/// (so a short spike is never missed).
struct CvStats {
    float last = 0.0f, lo = 0.0f, hi = 0.0f;
    bool any = false;  ///< a value since the last takeRange()

    void tick(float x) noexcept {
        last = x;
        if (!any) { lo = hi = x; any = true; }
        else { lo = std::min(lo, x); hi = std::max(hi, x); }
    }
    /// The range since the last call; the next range starts from the current value.
    void takeRange(float& outLo, float& outHi) noexcept {
        outLo = any ? lo : last;
        outHi = any ? hi : last;
        lo = hi = last;
        any = true;
    }
};

/// A control value as a note name and cents on 1 V/octave with 0 = C4, e.g. "A4 +12".
inline int cvToMidiNote(float v, int& cents) noexcept {
    const double semis = 60.0 + (double)v * 12.0;
    const double n = std::floor(semis + 0.5);
    cents = (int)std::lround((semis - n) * 100.0);
    return (int)n;
}

// ---- Gate --------------------------------------------------------------------

/// The gate input as a state, a pulse counter and timings. High at 0.5 and above.
class GateStats {
public:
    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        dutyCoef_ = (float)(1.0 - std::exp(-1.0 / (kDutySeconds * sampleRate)));
        reset();
    }
    void reset() noexcept {
        high_ = false;
        count_ = 0;
        sinceRise_ = highFor_ = 0;
        haveRise_ = false;
        lastLen_ = lastPeriod_ = 0.0f;
        duty_ = 0.0f;
        anyHigh_ = false;
    }

    void tick(float g) noexcept {
        const bool now = g >= 0.5f;
        if (now && !high_) {
            ++count_;
            if (haveRise_) lastPeriod_ = (float)((double)sinceRise_ / sampleRate_);
            haveRise_ = true;
            sinceRise_ = 0;
            highFor_ = 0;
        }
        if (!now && high_) lastLen_ = (float)((double)highFor_ / sampleRate_);
        high_ = now;
        if (now) { anyHigh_ = true; ++highFor_; }
        if (haveRise_ && sinceRise_ < kIdle) ++sinceRise_;
        duty_ += ((now ? 1.0f : 0.0f) - duty_) * dutyCoef_;
    }

    bool high() const noexcept { return high_; }
    uint32_t count() const noexcept { return count_; }
    /// Seconds the last gate stayed high (the running one, while high).
    float length() const noexcept { return high_ ? (float)((double)highFor_ / sampleRate_) : lastLen_; }
    /// Rising edges per second from the last two edges, 0 when the gate has been quiet for twice
    /// that period (or 2 s).
    float rateHz() const noexcept {
        if (lastPeriod_ <= 0.0f) return 0.0f;
        const double quiet = (double)sinceRise_ / sampleRate_;
        return quiet > std::max(2.0 * (double)lastPeriod_, 2.0) ? 0.0f : 1.0f / lastPeriod_;
    }
    /// The share of the last second the gate was high, 0..1.
    float duty() const noexcept { return duty_; }
    /// Whether the gate was high at any time since the last call (a 1 ms trigger still lights the lamp).
    bool takeAnyHigh() noexcept {
        const bool a = anyHigh_;
        anyHigh_ = high_;
        return a;
    }

private:
    static constexpr double kDutySeconds = 1.0;
    static constexpr uint32_t kIdle = 1u << 30;  ///< stops the idle counter before it wraps
    double sampleRate_ = 48000.0;
    float dutyCoef_ = 0.0f;
    bool high_ = false, haveRise_ = false, anyHigh_ = false;
    uint32_t count_ = 0;
    uint32_t sinceRise_ = 0, highFor_ = 0;
    float lastLen_ = 0.0f, lastPeriod_ = 0.0f, duty_ = 0.0f;
};

}  // namespace bleep::patch
