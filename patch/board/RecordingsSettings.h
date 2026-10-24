// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// RecordingsSettings.h — Settings → Recordings, for the standalone app and the plugins: where the recorder service writes its files
// (engine/Recording.h). The choice is kept in <data folder>/recordings.json, which the app and every plugin share.
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

namespace bleep::engine {

/// {folder, defaultFolder, isDefault, freeBytes, choosing, error}: what the page shows. `error` is what the last folder chooser or
/// choice could not do; it stays until the next choice.
juce::var recordingsState();

/// What the page asks of "recordings": {folder: "/full/path"}, {reset: true}, {choose: true} (a folder chooser; the choice shows in
/// the state a moment later) or {reveal: true} (shows the folder in the file manager). Returns the state, with `error` when refused.
juce::var recordingsCall(const juce::var& arg);

}  // namespace bleep::engine
