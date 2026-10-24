// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// PresetLibrary — the cell presets a plugin can load (doc/specs/cell-plugins.md §4): the factory
// presets compiled into the plugin, each with its panels, filtered by what the plugin plays.
#pragma once

#include "EngineApi.h"

#include <juce_core/juce_core.h>

namespace bleep::patch {

struct PresetEntry {
    juce::String name, category, description;
    juce::String json;  ///< the preset document the engine takes: name, plays, nodes, cables, panels
};

class PresetLibrary {
public:
    /// The presets whose `plays` has an instrument (Bleep Instrument) or an effect (Bleep FX), in menu order.
    static const juce::Array<PresetEntry>& forKind(engine::PortKind kind);
    /// By name, or null.
    static const PresetEntry* find(engine::PortKind kind, const juce::String& name);
    /// The preset a new instance starts with.
    static juce::String defaultName(engine::PortKind kind);
};

}  // namespace bleep::patch
