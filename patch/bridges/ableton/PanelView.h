// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// PanelView — the panel of the cell a Bleep Instrument or Bleep FX holds, in the plugin window
// (doc/specs/cell-plugins.md §11). A web view of the board page in plugin mode: it shows only the cell's
// panel. The page's native calls go to the engine as JSON through IEngine::uiCall, because the engine may
// live in another plugin's binary.
#pragma once

#include "EngineApi.h"

#include <juce_gui_extra/juce_gui_extra.h>

#include <functional>
#include <set>

namespace bleep::patch {

class PanelView : public juce::Component, private juce::Timer {
public:
    /// What the preset browser in the page needs: the presets this plugin can play, the current one, and loading one.
    struct Presets {
        std::function<juce::var()> list;  ///< [{name, category, description, tags, current}]
        std::function<void(const juce::String&)> load;
    };
    /// `onSize` is told the panel's natural size in pixels once the page has laid it out.
    PanelView(engine::IEngine& engine, int handle, Presets presets, std::function<void(int, int)> onSize);
    ~PanelView() override;
    void resized() override;
    /// Opens the preset browser over the panel.
    void showPresets();

private:
    class Web;
    void timerCallback() override;
    juce::var call(const juce::String& method, const juce::Array<juce::var>& args);

    engine::IEngine& engine_;
    int handle_;
    Presets presets_;
    std::function<void(int, int)> onSize_;
    std::unique_ptr<Web> web_;
    std::set<juce::String> watched_;
    uint64_t seenGeneration_ = ~0ull;
    bool pageReady_ = false;
};

}  // namespace bleep::patch
