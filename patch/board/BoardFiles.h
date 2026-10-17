// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// BoardFiles.h — the files side of the board window: the page's resources, installing the plugins, and the preset and project files.
// Used by BoardWindow.cpp.
#pragma once

#include <juce_gui_extra/juce_gui_extra.h>

#include <optional>

namespace bleep::engine::boardfiles {

/// A file of the board page (board/ui, common/ui, the modules' ui and doc folders), by URL.
std::optional<juce::WebBrowserComponent::Resource> resource(const juce::String& url);

#if defined(BLEEP_WASM_MODULES)
juce::var installPluginBundle();
juce::var installedPlugins();
#endif

/// Where a kind of preset lives: folder (under Beautiful Bleep) and file extension.
struct PresetKind {
    juce::String folder;
    juce::String extension;
};

PresetKind presetKind(const juce::var& kind);
bool isProjectKind(const juce::var& kind);
juce::var flatToProject(const juce::String& name, const juce::var& flat);
void migrateBoardPresets();
juce::File presetFile(const juce::String& name, const PresetKind& k);
juce::var presetList(const PresetKind& k);

}  // namespace bleep::engine::boardfiles
