// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// SystemAudio — captures what the computer plays (doc/specs/system-audio.md) and hands it to the app as a stereo
// stream in a StereoRing. One backend per platform, chosen at build time:
//
//   macOS    SystemAudioMac.mm      Core Audio process tap (macOS 14.2+), the app's own sound left out
//   Windows  SystemAudioWin.cpp     WASAPI loopback; process loopback (Windows 10 2004+) leaves the app's sound out
//   Linux    SystemAudioLinux.cpp   PulseAudio / PipeWire: the monitor of an output (needs libpulse)
//   other    SystemAudioStub.cpp    not supported
//
// No JUCE types here: the backends include system headers that clash with JUCE's.
#pragma once

#include "SystemAudioBuffer.h"

#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace bleep::app {

struct SystemAudioOptions {
    /// Leave the app's own output out of the capture (spec §3). Ignored where the platform cannot (see canExclude()).
    bool excludeOwnProcess = true;
    /// Which output to capture, an id from SystemAudio::sources(); empty: the default output (Linux only).
    std::string source;
};

class SystemAudio {
public:
    virtual ~SystemAudio() = default;

    /// Starts capturing into ring(). Returns an error message, or an empty string when it runs.
    virtual std::string start(const SystemAudioOptions& options) = 0;
    /// Stops capturing (the destructor does too). Safe to call twice.
    virtual void stop() = 0;

    /// The sample rate of the frames written to ring(); valid once start() succeeded.
    virtual double sampleRate() const = 0;
    /// True while the app's own output is left out of the capture (it may be asked for and not available).
    virtual bool excluding() const = 0;
    /// A problem that came up after start (the output device was unplugged and capture could not follow). Empty: none.
    virtual std::string problem() const = 0;
    /// Called on the message thread a few times a second: backends follow changes of the output device here.
    virtual void poll() {}

    StereoRing& ring() noexcept { return ring_; }

    /// Why System Audio cannot work on this machine ("macOS 14.2 or later is needed"); empty when it can.
    static std::string unsupportedReason();
    /// Whether this platform can leave the app's own sound out.
    static bool canExclude();
    /// The outputs that can be captured, as (id, name); empty where there is only one choice.
    static std::vector<std::pair<std::string, std::string>> sources();
    /// A new capture, or null where unsupportedReason() is not empty.
    static std::unique_ptr<SystemAudio> create();

protected:
    StereoRing ring_;
};

}  // namespace bleep::app
