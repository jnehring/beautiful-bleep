// SPDX-License-Identifier: MIT
//
// Board.h — the board as data (spec §4, §7, §8).
//
// The board is a JSON document; the board UI edits it and the engine owns
// it. `sanitise()` turns any document into a valid one (unknown nodes,
// dangling or incompatible cables, cables across cell borders, ports inside
// cells are dropped; defaults are filled in), so the engine never trusts the
// UI and old saves keep loading. `parse()` gives the typed view the compiler
// works from.
//
//   { "format": 1, "id": "<uuid>",
//     "nodes":  [ { "id", "type", "name", "x", "y", "parent", "params": {id: 0..1},
//                   "muted", "port", "track", "inputs": [jack], "outputs": [jack],
//                   "data": {...} (modules with node data, e.g. a sequencer's steps) } ],
//     "cables": [ { "id", "from": {"node", "jack"}, "to": {"node", "jack"}, "amount" } ],
//     "view": {...}  (UI state, kept as is),
//     "panels": [ {...} ]  (front panels, doc/specs/panels.md: kept as is) }
//
// Cells are nodes of type "cell" with their own "inputs"/"outputs"; inside a
// cell (nodes whose "parent" is the cell), a "cell-in" node exposes the
// cell's inputs as outputs and a "cell-out" node takes the cell's outputs.
#pragma once

#include "Registry.h"

#include <juce_core/juce_core.h>

#include <map>
#include <string>
#include <vector>

namespace bleep::engine {

/// A patch bay's channel jack: "c1", "c2" … (the bay's other jack is "bundle").
inline bool isBayChannel(const std::string& jack) {
    if (jack.size() < 2 || jack[0] != 'c') return false;
    for (size_t i = 1; i < jack.size(); ++i)
        if (jack[i] < '0' || jack[i] > '9') return false;
    return true;
}

struct CellJack {
    std::string id, name;
    Signal type = Signal::Control;
};

struct NodeModel {
    std::string id, type, name, parent, port;
    bool muted = false;
    bool bypassed = false;                ///< audio modules: the input audio goes straight to the output, unprocessed
    const ModuleSpec* spec = nullptr;
    std::map<std::string, float> params;  ///< normalised
    std::string data;                     ///< node data as compact JSON (empty if none)
    std::vector<CellJack> cellInputs, cellOutputs;
};

struct Endpoint {
    std::string node, jack;
};

struct CableModel {
    std::string id;
    Endpoint from, to;
    float amount = 1.0f;
};

struct BoardModel {
    std::string id;
    std::vector<NodeModel> nodes;
    std::vector<CableModel> cables;

    const NodeModel* node(const std::string& nodeId) const noexcept;
    /// The jack's signal type, if `jack` is an output (or input) of `node`.
    bool outputType(const NodeModel& node, const std::string& jack, Signal& type) const noexcept;
    bool inputType(const NodeModel& node, const std::string& jack, Signal& type) const noexcept;
};

/// The board the compiler runs: every chain through a patch bay (a source into a Patch Bay In channel, a bundle cable,
/// possibly through cell jacks and other bays, out of the same channel of a Patch Bay Out) becomes one plain cable,
/// and the bays and bundle cables are gone.
BoardModel flattenPatchbays(const BoardModel& board);
bool hasPatchbays(const BoardModel& board);

namespace board {

constexpr int kFormat = 1;

/// A new, empty board.
juce::var create();
/// Returns a valid copy of `doc`. `warnings` (optional) collects what was dropped.
juce::var sanitise(const juce::var& doc, juce::StringArray* warnings = nullptr);
BoardModel parse(const juce::var& doc);
/// Panel controls wired to a cell's input jacks or notes (doc/specs/panels.md §5) become hidden
/// source nodes ("~<panel>:<control>:<wire>": a Dial, Button or Keyboard) cabled into the
/// cell. They exist only in the compiled model, not in the saved board; the UI moves them
/// with setParam / perform on their ids.
void addPanelSources(BoardModel& model, const juce::var& doc);

juce::String toJson(const juce::var& doc);
juce::var fromJson(const juce::String& json);

/// Small editing helpers used by the engine (the UI edits the JSON itself).
juce::String newId(const char* prefix);
juce::DynamicObject* findNode(const juce::var& doc, const juce::String& id);
juce::DynamicObject* findNodeByPort(const juce::var& doc, const juce::String& portId);
juce::DynamicObject* findCable(const juce::var& doc, const juce::String& id);
/// Adds a node (with default params) and returns its id.
juce::String addNode(juce::var& doc, const ModuleSpec& spec, double x, double y, const juce::String& portId = {});

// ---- cell presets on the board (Bleep Instrument and Bleep FX, doc/specs/cell-plugins.md) -------

/// Copies a cell preset document ({root, nodes, cables, panels?}) into the top level of `doc` with
/// fresh ids, as the board's Add → Cell does, and returns the new root's id (empty if it has none).
juce::String insertPreset(juce::var& doc, const juce::var& preset, double x, double y);
/// Cables a preset cell to its port node the way the plugin plays it: `plays` is the preset's
/// entry, `effect` says which half of it applies. The Instrument's MIDI jacks feed the cell's note
/// inputs and its audio comes back to the port; an FX sends the port's audio through.
void attachHost(juce::var& doc, const juce::String& portNodeId, const juce::String& cellId, const juce::var& plays,
                bool effect);
/// The top-level cell cabled to a port node, if any (its id, else empty).
juce::String attachedCell(const juce::var& doc, const juce::String& portNodeId);
/// Removes a cell with everything inside it, the cables touching them and the panels of the cell.
void removeCell(juce::var& doc, const juce::String& cellId);
/// The cell as a preset document again ({format, root, nodes, cables, panels}), with its edits.
juce::var extractPreset(const juce::var& doc, const juce::String& cellId);

/// Every node type, for the UI's browser and module views.
juce::var describeTypes();

}  // namespace board
}  // namespace bleep::engine
