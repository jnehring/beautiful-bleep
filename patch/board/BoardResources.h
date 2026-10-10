// SPDX-License-Identifier: MIT
//
// BoardResources.h — the board page's files (board/ui, common/ui, the modules' ui and doc folders) as a
// WebBrowserComponent resource provider. The board window and the plugin windows (a cell's panel) use it.
#pragma once

#include <juce_gui_extra/juce_gui_extra.h>

#include <optional>

namespace bleep::engine {

std::optional<juce::WebBrowserComponent::Resource> boardResource(const juce::String& url);

}  // namespace bleep::engine
