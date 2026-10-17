// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
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
//
// A module that is a .wasm file has no access to the host's memory: its copy of this
// struct lives in the module's own memory. The optional export bleep_host_ptr(h) gives
// its address (module-abi.md); the host copies the status in before each block and takes
// the requests out after it, forwarding them to its own mailbox. The layout is therefore
// fixed: all fields are 4 bytes except the tempo (8), in this order, 40 bytes in all.
#pragma once

#include <atomic>
#include <cstdint>

namespace bleep::engine {

struct HostControl {
    static constexpr int kNone = -1;
    /// Values of `play`.
    enum Play { Stop = 0, Start = 1, Continue = 2 };

    // ---- module → host: a request stays until the host takes it --------------------
    std::atomic<double> tempo{0.0};              ///< BPM; 0 = no request
    std::atomic<int32_t> play{kNone};            ///< Play, or kNone
    std::atomic<int32_t> link{kNone};            ///< 1 on, 0 off
    std::atomic<int32_t> startStopSync{kNone};   ///< Link start/stop sync: 1 on, 0 off

    // ---- host → module: written by the host, read by the module view -------------------
    std::atomic<int32_t> hosted{0};              ///< 1: a host answers the requests (the standalone app)
    std::atomic<int32_t> linkAvailable{0};       ///< 1: the host was built with Ableton Link
    std::atomic<int32_t> linkEnabled{0};
    std::atomic<int32_t> linkPeers{0};

    /// Host: takes a request and clears it.
    double takeTempo() noexcept { return tempo.exchange(0.0); }
    int takePlay() noexcept { return play.exchange(kNone); }
    int takeLink() noexcept { return link.exchange(kNone); }
    int takeStartStopSync() noexcept { return startStopSync.exchange(kNone); }
};

/// The same, as plain data: what the host reads out of a module's memory.
struct HostControlWire {
    double tempo;
    int32_t play, link, startStopSync;
    int32_t hosted, linkAvailable, linkEnabled, linkPeers;
};
static_assert(sizeof(HostControl) == sizeof(HostControlWire) && sizeof(HostControlWire) == 40, "HostControl's layout is part of the module ABI");
static_assert(std::atomic<double>::is_always_lock_free && std::atomic<int32_t>::is_always_lock_free, "the layout needs lock-free atomics");

inline HostControl& hostControl() noexcept {
    static HostControl control;
    return control;
}

}  // namespace bleep::engine
