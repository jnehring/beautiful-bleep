// SPDX-License-Identifier: GPL-3.0-only
// The Transport module's logic without the engine (doc/specs/modules/transport.md): MIDI clock out from the
// song position, MIDI clock in turned into a tempo and start/stop, and tap tempo.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kMidiClock = 0xF8, kMidiStart = 0xFA, kMidiContinue = 0xFB, kMidiStop = 0xFC;
constexpr double kMinBpm = 20.0, kMaxBpm = 400.0;

/// MIDI clock out: 24 pulses per quarter note, locked to the song position, plus Start, Continue and Stop.
class MidiClockOut {
public:
    void reset() noexcept {
        running_ = false;
        last_ = 0;
    }
    /// One sample. `ppq` is the song position in quarter notes; `emit(status)` is called for each message,
    /// in order. Start comes at position 0, Continue anywhere else; the clock pulse on the downbeat follows it.
    template <class F>
    void tick(bool enabled, bool playing, double ppq, F&& emit) noexcept {
        const bool run = enabled && playing;
        if (!run) {
            if (running_) emit(kMidiStop);
            running_ = false;
            return;
        }
        const int64_t idx = (int64_t)std::floor(ppq * 24.0 + 1e-6);
        if (!running_) {
            running_ = true;
            const bool fromStart = ppq < 1.0 / 24.0;
            emit(fromStart ? kMidiStart : kMidiContinue);
            last_ = fromStart ? idx - 1 : idx;
        }
        if (idx > last_) emit(kMidiClock);
        last_ = idx;  // a jump back (loop, restart) just re-aims: no pulse, no message
    }

private:
    bool running_ = false;
    int64_t last_ = 0;
};

/// MIDI clock in: the tempo from the spacing of the pulses, averaged over up to four beats so the
/// host's block timing washes out (the same average as a hardware clock follower, settling within a bar).
class MidiClockIn {
public:
    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        reset();
    }
    void reset() noexcept {
        count_ = 0;
        sinceReport_ = 0;
        reported_ = 0.0;
    }
    /// A pulse at absolute sample `at`. Returns the new tempo when it has settled on one that differs from the
    /// last reported by 0.2 BPM or more (rounded to 0.1), else 0.
    double clock(int64_t at) noexcept {
        if (count_ > 0) {
            const double gap = (double)(at - times_[(count_ - 1) % kRing]);
            // Slower than 20 BPM's pulse spacing: the clock stopped and came back; start the average again.
            if (gap > sr_ * 60.0 / (kMinBpm * 24.0) * 1.5) count_ = 0;
        }
        times_[count_ % kRing] = at;
        ++count_;
        if (count_ < kMin + 1) return 0.0;
        if (++sinceReport_ < kReportEvery) return 0.0;
        sinceReport_ = 0;
        const int span = std::min(count_ - 1, kRing - 1);
        const int64_t first = times_[(count_ - 1 - span) % kRing];
        const double seconds = (double)(at - first) / sr_;
        if (seconds <= 0.0) return 0.0;
        const double bpm = std::round(60.0 * span / (24.0 * seconds) * 10.0) / 10.0;
        if (bpm < kMinBpm || bpm > kMaxBpm) return 0.0;
        if (std::fabs(bpm - reported_) < 0.2) return 0.0;
        reported_ = bpm;
        return bpm;
    }
    /// Start: the average begins again (the sender may have changed tempo while stopped).
    void restart() noexcept { count_ = 0; sinceReport_ = 0; }

private:
    static constexpr int kRing = 97;          // 96 intervals = four beats
    static constexpr int kMin = 24;           // first report after one beat
    static constexpr int kReportEvery = 6;    // then every quarter of a beat
    double sr_ = 48000.0;
    int64_t times_[kRing] = {};
    int count_ = 0, sinceReport_ = 0;
    double reported_ = 0.0;
};

/// Tap tempo: the average of the last taps' spacing; a pause of two seconds starts over.
class TapTempo {
public:
    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        n_ = 0;
    }
    /// A tap at absolute sample `at`. Returns the tempo from the second tap on, else 0.
    double tap(int64_t at) noexcept {
        if (n_ > 0 && (double)(at - taps_[(n_ - 1) % kMax]) > 2.0 * sr_) n_ = 0;
        taps_[n_ % kMax] = at;
        ++n_;
        if (n_ < 2) return 0.0;
        const int span = std::min(n_ - 1, kMax - 1);
        const double seconds = (double)(at - taps_[(n_ - 1 - span) % kMax]) / sr_;
        const double bpm = 60.0 * span / seconds;
        return std::clamp(std::round(bpm * 10.0) / 10.0, kMinBpm, kMaxBpm);
    }

private:
    static constexpr int kMax = 5;  // four intervals
    double sr_ = 48000.0;
    int64_t taps_[kMax] = {};
    int n_ = 0;
};

}  // namespace bleep::patch
