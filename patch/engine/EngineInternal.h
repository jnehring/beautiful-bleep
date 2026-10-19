// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// EngineInternal.h — what the files of the Engine implementation share: the includes and a few small helpers.
// Engine.cpp (lifetime, instances, finding the engine), EngineBoard.cpp (the board and cell presets), EngineEdit.cpp
// (what the board UI does), EngineCompile.cpp (compiling and reconciling, live state), EngineAudio.cpp (the audio path).
#pragma once

#include "Engine.h"
#include "../common/SafeJson.h"

#include "Media.h"
#include "VoiceCell.h"
#if defined(BLEEP_WASM_MODULES)
#include "wasm/ModuleLibrary.h"
#endif

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace bleep::engine {

/// The ports the standalone app creates itself (not the bridges to Live).
inline bool appOwnsPort(PortKind k) {
    return k == PortKind::AudioIn || k == PortKind::AudioOut || k == PortKind::MidiIn || k == PortKind::MidiOut ||
           k == PortKind::Link;
}

/// Port ids of the MIDI In and Audio Out nodes that belong to Bleep Board itself: "<instance id>" + suffix.
constexpr const char* kBoardMidiSuffix = ":midi";
constexpr const char* kBoardAudioSuffix = ":audio";

/// Non-ASCII text (·, —, …) must reach juce::String as UTF-8.
inline juce::String u8(const char* text) { return juce::String::fromUTF8(text); }


inline void copyOut(const juce::String& s, char* out, int capacity) {
    if (out == nullptr || capacity <= 0) return;
    const auto utf8 = s.toStdString();
    const size_t n = std::min(utf8.size(), (size_t)capacity - 1);
    std::memcpy(out, utf8.data(), n);
    out[n] = 0;
}

inline double nowMs() { return juce::Time::getMillisecondCounterHiRes(); }

inline bool sendsToTrack(PortKind k) {
    return k == PortKind::MidiOut || k == PortKind::AudioOut || k == PortKind::Instrument || k == PortKind::AudioInsert ||
           k == PortKind::AudioBridge;
}


}  // namespace bleep::engine
