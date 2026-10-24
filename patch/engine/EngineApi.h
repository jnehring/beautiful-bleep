// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// EngineApi.h — the interface between Bleep plugins and the shared engine.
//
// Every Bleep plugin is its own binary (JUCE builds one plugin per binary),
// but a Live set must have exactly one engine (spec §5.3). The first Bleep
// plugin loaded into a process creates the engine and publishes it; every
// other Bleep plugin in that process finds and uses the same instance. The
// binary that created it pins itself in memory, so the engine's code stays
// loaded for as long as the process runs.
//
// Because the engine may live in another binary, this interface uses only
// plain types: no JUCE classes, no std::string, no exceptions.
//
// Versions (developers/development/engine-abi.md): the MAJOR number (kAbiTag) changes when
// the layout breaks: a method is inserted or removed, a struct that crosses
// binaries changes. Binaries of different majors refuse to share and say so.
// The MINOR number (kAbiMinor) counts additions: new methods go at the END of
// IEngine, below the destructor, never above it, and bump the minor. Binaries
// of the same major share; a plugin checks `engine.supports(minor)` before it
// calls a method that came later than its major's first release.
#pragma once

#include "Module.h"

#include <cstddef>
#include <cstdint>

namespace bleep::engine {

/// The MAJOR version: changes whenever the layout of this interface or the data it passes changes.
constexpr const char* kAbiTag = "bleep-engine-abi-8";
/// The MINOR version: methods added at the end of IEngine since this major's first release (0 at the start).
constexpr int kAbiMinor = 4;

constexpr int kMaxHostBlock = 4096;   ///< larger host blocks are processed in part and padded
constexpr int kMaxMidiEvents = 512;   ///< per host block and port

/// One host block, as a port plugin hands it to the engine. [RT]
struct BlockIO {
    int numSamples = 0;
    Transport transport;
    // Track audio into the board (Audio In, Audio Insert). Null if none.
    const float* const* audioIn = nullptr;
    int numAudioIn = 0;
    // Board audio to the track (Audio Out, Instrument, Audio Insert). Null if none.
    float* const* audioOut = nullptr;
    int numAudioOut = 0;
    // MIDI from the track (MIDI In, Instrument).
    const MidiEvent* midiIn = nullptr;
    int numMidiIn = 0;
    // MIDI to the track (MIDI Out): the engine fills up to midiOutCapacity events.
    MidiEvent* midiOut = nullptr;
    int midiOutCapacity = 0;
    int numMidiOut = 0;            ///< written by the engine
    bool boardAudioValid = false;  ///< written by the engine: audioOut carries board data
    // Bleep Board only: the 16 macro values, 0..1.
    const float* macros = nullptr;
};

/// Status of a plugin instance, for its editor.
enum class PortState {
    Ok,
    NoBoard,           ///< no active Bleep Board in this set
    InactiveMain,      ///< a second Bleep Board: shows a warning, does nothing
    VersionMismatch,   ///< another build of Bleep Board owns the engine
};

class IEngine {
public:
    /// The minor version of the engine's binary. Always the first method: its place never changes.
    virtual int abiMinor() const noexcept = 0;
    /// Whether the engine has everything up to minor version `minor` (a plugin newer than the engine asks first).
    bool supports(int minor) const noexcept { return abiMinor() >= minor; }

    // ---- lifetime ([non-RT], message thread) ------------------------------
    virtual void retain() noexcept = 0;
    virtual void release() noexcept = 0;

    // ---- plugin instances ([non-RT]) ---------------------------------------
    /// Registers a plugin instance. Returns a handle (> 0) or 0 on failure.
    virtual int registerInstance(PortKind kind) noexcept = 0;
    virtual void unregisterInstance(int handle) noexcept = 0;
    /// Restores a saved instance ID (from the plugin state). If another live
    /// instance already uses it (a duplicated device), a fresh ID is kept.
    virtual void restoreInstanceId(int handle, const char* savedId) noexcept = 0;
    /// Writes the instance ID (36-char UUID + NUL) into `out` (≥ 37 bytes).
    virtual void instanceId(int handle, char* out, int capacity) noexcept = 0;
    virtual void setTrack(int handle, const char* trackName, uint32_t argb) noexcept = 0;
    virtual void prepare(int handle, double sampleRate, int maxBlock) noexcept = 0;
    virtual PortState state(int handle) noexcept = 0;
    /// Writes a one-line, human-readable status (state, latency, sync).
    virtual void statusText(int handle, char* out, int capacity) noexcept = 0;
    /// The port node's name on the board (empty if none yet).
    virtual void nodeName(int handle, char* out, int capacity) noexcept = 0;
    virtual void setNodeName(int handle, const char* name) noexcept = 0;
    /// Fixed board latency in samples (spec §5.3): 2 × the largest host block.
    virtual int latencySamples() noexcept = 0;

    // ---- audio ([RT]) ------------------------------------------------------
    virtual void process(int handle, BlockIO& io) noexcept = 0;

    // ---- Bleep Board: the board ([non-RT]) ---------------------------------
    /// Serialises the board (JSON). Returns the full length; writes at most
    /// `capacity` bytes (call with capacity 0 to measure). Inactive mains
    /// return their own saved copy.
    virtual size_t saveBoard(int handle, char* out, size_t capacity) noexcept = 0;
    virtual void loadBoard(int handle, const char* json, size_t length) noexcept = 0;
    /// Changes on every board edit: the main plugin marks the set as changed.
    virtual uint64_t boardGeneration() noexcept = 0;
    /// An inactive main replaces the current board with its own copy.
    virtual void replaceBoardWith(int handle) noexcept = 0;

    // ---- the board window ([non-RT]) ---------------------------------------
    /// A plugin's editor opened: opens the board or brings it to the front
    /// and highlights the instance's node (spec §9.1).
    virtual void editorOpened(int handle) noexcept = 0;
    virtual void openBoard(int handle) noexcept = 0;

    // ---- cell plugins: Bleep Instrument, Bleep FX ([non-RT]) ---------------
    /// Loads a cell preset (JSON: {name, root, nodes, cables, panels?, plays}) into the instance: its
    /// cell appears on the board next to the instance's port node, cabled as `plays` says (spec
    /// cell-plugins.md §1). With `replace` false a cell that is already there stays (restoring a saved
    /// set: the board's copy, with its edits, wins). With no board in the set, the engine keeps a board
    /// of its own for these plugins until Bleep Board is added.
    virtual void setCellPreset(int handle, const char* json, size_t length, bool replace) noexcept = 0;
    /// The instance's preset as it is now on the board, edits included (for the plugin state).
    /// Returns the full length; writes at most `capacity` bytes. Empty if none was loaded.
    virtual size_t cellPreset(int handle, char* out, size_t capacity) noexcept = 0;

    // ---- the page in a plugin window ([non-RT], message thread) --------------
    /// What a plugin editor's web view asks of the engine (cell-plugins.md §11.2): the board page's native
    /// functions ("init", "commit", "setParam", "perform", "liveState", …) with their arguments as a JSON
    /// array; the result is JSON. Returns the result's full length and writes at most `capacity` bytes;
    /// if it did not fit, `method` "__last" returns the same result again.
    virtual size_t uiCall(int handle, const char* method, const char* argsJson, char* out, size_t capacity) noexcept = 0;

protected:
    virtual ~IEngine() = default;

    // Methods added after this major's first release (minor 1 and up) go BELOW this line, in order, each with the
    // minor that introduced it in its comment: "[minor 1]", after a `public:`. Never insert above the destructor.

public:
    /// [minor 1] The plugin's other side is not this set's board (Board = App or Web, doc/specs/bridges.md §1): the
    /// instance stays registered, but its node becomes a ghost and gets no node of its own. Message thread.
    virtual void setBridged(int handle, bool bridged) noexcept = 0;

    /// [minor 2] The latency this plugin reports to the host: latencySamples(), or 0 for a cell plugin (Instrument, Audio Insert)
    /// whose cell has no cable to another plugin, which the engine runs in the plugin's own block. May change when the board is
    /// edited. Any thread.
    virtual int portLatencySamples(int handle) noexcept = 0;

    /// [minor 3] What the board's Live Params nodes (doc: board/ui/live-params.md) want Live to do: writes the values of their
    /// rows (32 of them, 8 channels of 4, as engine/LiveParams.h defines them) into `values32` (0..1, or -1 for a row no node
    /// drives) and returns the bit mask of the rows a node drives. Any thread; the values are those of the last block.
    virtual uint32_t liveParams(float* values32) noexcept = 0;

    /// [minor 4] The Bleep Live Link device on `channel` (1..8) says what its `row` (0..3) is mapped to, as a JSON object:
    /// {"kind":"continuous"|"discrete"|"none", "name":"…", "current":0..1, "min":…, "max":…, "items":["…"], "adopt":true|false}.
    /// The engine keeps it for the board's Live Params view, and with "adopt" (the row was just mapped) moves that node's row
    /// knob so the parameter starts where it is. Message thread.
    virtual void setLiveRowInfo(int channel, int row, const char* json) noexcept = 0;
};

/// Finds the process's engine or creates it in this binary. Retained; call
/// release() when done. Never null: on an ABI mismatch it returns a stub
/// whose instances report PortState::VersionMismatch.
IEngine* acquireEngine();

/// RAII handle for a plugin instance.
class EngineInstance {
public:
    explicit EngineInstance(PortKind kind) : engine_(acquireEngine()), handle_(engine_->registerInstance(kind)) {}
    ~EngineInstance() {
        engine_->unregisterInstance(handle_);
        engine_->release();
    }
    EngineInstance(const EngineInstance&) = delete;
    EngineInstance& operator=(const EngineInstance&) = delete;

    IEngine& engine() const noexcept { return *engine_; }
    int handle() const noexcept { return handle_; }

private:
    IEngine* engine_;
    int handle_;
};

}  // namespace bleep::engine
