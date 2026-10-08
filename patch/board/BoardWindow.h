// SPDX-License-Identifier: MIT
//
// BoardWindow.h — how the board window looks and behaves. Plugins use the
// defaults (a floating window that hides on close, spec §9.1); the standalone
// app makes it its main window (spec §11.1).
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

#include <functional>

namespace bleep::engine {

struct BoardWindowStyle {
    bool alwaysOnTop = true;
    juce::String title = "Bleep Board";
    std::function<void()> onClose;            ///< default: hide the window
    juce::MenuBarModel* menu = nullptr;       ///< Windows/Linux menu bar (macOS uses the main menu)
    juce::Rectangle<int> bounds;              ///< empty: centred 1180 × 760
};

/// Call before the board window is first opened.
void setBoardWindowStyle(const BoardWindowStyle& style);
/// Changes the title of the open window (and of the next one).
void setBoardWindowTitle(const juce::String& title);
/// The open board window, or null.
juce::DocumentWindow* boardWindow();

}  // namespace bleep::engine
