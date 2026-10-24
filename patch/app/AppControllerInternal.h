// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// AppControllerInternal.h — what the files of the AppController implementation share: the includes, the command ids and a few small helpers.
// AppController.cpp (lifetime, ports), AppControllerAudio.cpp (System Audio, the audio callback, the timer),
// AppControllerProjects.cpp (projects and menus), AppControllerSettings.cpp (the Settings section and the web link).
#pragma once

#include "AppController.h"
#include "../common/SafeJson.h"

#include <future>

#include "BoardWindow.h"
#include "Media.h"

namespace bleep::app {

using engine::PortKind;


/// Non-ASCII text (·, —, …) must reach juce::String as UTF-8.
inline juce::String u8(const char* text) { return juce::String::fromUTF8(text); }


enum Command { cmdNew = 1, cmdOpen, cmdPresets, cmdSave, cmdSaveAs, cmdSettings, cmdDocs, cmdAbout, cmdPlay, cmdLink };

inline constexpr const char* kProjectSuffix = ".bleepboard";
inline constexpr const char* kVirtualPrefix = "Bleep App ";

inline juce::String projectName(const juce::File& f) { return f == juce::File() ? juce::String("Untitled") : f.getFileNameWithoutExtension(); }

}  // namespace bleep::app
