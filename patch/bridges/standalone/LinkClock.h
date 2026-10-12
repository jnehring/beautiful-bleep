// SPDX-License-Identifier: MIT
//
// LinkClock — the standalone app's musical time (spec §11.4): Ableton Link
// when it's built in (BLEEP_LINK), otherwise an internal clock with the
// same interface. Link itself is GPLv2-or-later; see patch/app/README.md.
#pragma once

#include <cstdint>
#include <memory>

namespace bleep::app {

class LinkClock {
public:
    LinkClock();
    ~LinkClock();

    static bool available() noexcept;  ///< built with Ableton Link

    // [message thread]
    void enable(bool on);
    bool enabled() const noexcept;
    void setStartStopSync(bool on);
    int peers() const noexcept;
    double tempo() const noexcept;
    void setTempo(double bpm);
    bool playing() const noexcept;
    void setPlaying(bool on);

    /// [audio thread] Musical time at the start of a block that will be heard
    /// `latencyMicros` from now. Advances the internal clock by numSamples.
    struct Time {
        double bpm = 120.0;
        double ppq = 0.0;
        bool playing = false;
    };
    Time atBlock(int numSamples, double sampleRate, double quantum, int64_t latencyMicros) noexcept;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace bleep::app
