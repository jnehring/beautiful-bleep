// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// WebHubInternal.h — what the files of the WebHub implementation share: the includes, limits and small helpers.
// WebHub.cpp (lifetime, HTTP, sync, status), WebHubMessages.cpp (messages from the web), WebHubSlots.cpp (Live slots and audio/MIDI
// packets), WebHubBoard.cpp (web nodes in the app's board).
#pragma once

#include "WebHub.h"

#include "Sha1Base64.h"
#include "../common/SafeJson.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <thread>

namespace bleep::hub {

using bridge::Midi;

inline constexpr int kMaxChannels = 256;
inline constexpr int kMaxQueued = 4096;
inline constexpr double kJumpBeats = 0.05;

inline juce::var object(std::initializer_list<std::pair<const char*, juce::var>> props) {
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}

inline std::string json(const juce::var& v) { return juce::JSON::toString(v, true).toStdString(); }

inline engine::Transport toEngine(const bridge::Transport& t) {
    engine::Transport e;
    e.sampleRate = t.sampleRate;
    e.bpm = t.bpm;
    e.ppq = t.ppq;
    e.ppqValid = t.ppqValid != 0;
    e.playing = t.playing != 0;
    e.samplePos = t.samplePos;
    return e;
}

/// The audio device's thread must never wait for another thread, but the tables behind m_ are only held for a few
/// microseconds (a packet pushed, a message parsed): trying for a moment nearly always gets the lock, where a single
/// try loses the block (and with it MIDI, whose note-off would then never arrive).
inline bool lockBriefly(std::unique_lock<std::mutex>& lock) noexcept {
    for (int i = 0; i < 4000; ++i)
        if (lock.try_lock()) return true;
    return false;
}

}  // namespace bleep::hub
