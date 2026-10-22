// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// BoardWindow.h — how the board window looks and behaves. Plugins use the
// defaults (a floating window that hides on close, spec §9.1); the standalone
// app makes it its main window (spec §11.1).
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

#include <functional>

namespace bleep::engine {

struct BoardWindowStyle {
    bool alwaysOnTop = false;  ///< a floating window stays above every app, not only the host
    juce::String title = "Bleep Board";
    std::function<void()> onClose;            ///< default: hide the window
    juce::MenuBarModel* menu = nullptr;       ///< Windows/Linux menu bar (macOS uses the main menu)
    juce::Rectangle<int> bounds;              ///< empty: centred 1180 × 760
    /// The preset browser loads a whole patch (a board, its tempo, its name). The standalone app
    /// replaces its project with it (asking about unsaved changes first); without it the patch is
    /// committed to the board as an ordinary edit.
    std::function<void(const juce::var& board, double tempo, const juce::String& name)> onLoadPatch;
    /// The standalone app's Settings section (audio, MIDI, Link): the page calls it with a name and an argument and gets the
    /// settings state back. Without it the page has no Settings section.
    std::function<juce::var(const juce::String& fn, const juce::var& arg)> onSettings;
    /// The page's menus (app-menu.js: [{title, items: [{id, label, key, enabled, app}|null]}]), sent at start and whenever an item's
    /// state changes. The standalone app builds its menu bar from them; choosing a page item sends its id back (openBoardMenu).
    std::function<void(const juce::var& menus)> onMenu;
};

/// Call before the board window is first opened.
void setBoardWindowStyle(const BoardWindowStyle& style);
/// Changes the title of the open window (and of the next one).
void setBoardWindowTitle(const juce::String& title);
/// The open board window, or null.
juce::DocumentWindow* boardWindow();
/// Shows the page's preset browser (standalone app: File → Presets).
void openPresetBrowser();
/// Shows the page's Settings section (standalone app: File → Settings).
void openSettings();
/// A menu item of the app that the page answers (its id, e.g. "edit.undo", "help.docs").
void openBoardMenu(const juce::String& what);

}  // namespace bleep::engine
