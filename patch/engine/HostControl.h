// SPDX-License-Identifier: MIT
//
// HostControl.h — what the Transport module asks of the host, and what the host
// tells it back (doc/specs/modules/transport.md). Modules cannot change the
// transport themselves: they read it (Transport in Module.h). The Transport module
// is the exception, and goes through this one small mailbox.
//
// Only the standalone app answers: it polls the requests (about every 10 ms) and
// applies them to its clock. Plugins in Live and the browser never read them, so there
// the module only shows the host's tempo. The mailbox is one per process; with two
// Transport modules on one board the last request wins.
#pragma once

#include <atomic>

namespace bleep::engine {

struct HostControl {
    static constexpr int kNone = -1;
    /// Values of `play`.
    enum Play { Stop = 0, Start = 1, Continue = 2 };

    // ---- module → host: a request stays until the host takes it --------------------
    std::atomic<double> tempo{0.0};              ///< BPM; 0 = no request
    std::atomic<int> play{kNone};                ///< Play, or kNone
    std::atomic<int> link{kNone};                ///< 1 on, 0 off
    std::atomic<int> startStopSync{kNone};       ///< Link start/stop sync: 1 on, 0 off

    // ---- host → module: written by the host, read by the module view -------------------
    std::atomic<bool> hosted{false};             ///< a host answers the requests (the standalone app)
    std::atomic<bool> linkAvailable{false};      ///< the host was built with Ableton Link
    std::atomic<bool> linkEnabled{false};
    std::atomic<int> linkPeers{0};

    /// Host: takes a request and clears it.
    double takeTempo() noexcept { return tempo.exchange(0.0); }
    int takePlay() noexcept { return play.exchange(kNone); }
    int takeLink() noexcept { return link.exchange(kNone); }
    int takeStartStopSync() noexcept { return startStopSync.exchange(kNone); }
};

inline HostControl& hostControl() noexcept {
    static HostControl control;
    return control;
}

}  // namespace bleep::engine
