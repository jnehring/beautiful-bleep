// SPDX-License-Identifier: MIT
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
// plain types: no JUCE classes, no std::string, no exceptions. Binaries from
// different builds refuse to share (kAbiTag differs) and report it.
#pragma once

#include "Module.h"

#include <cstddef>
#include <cstdint>

namespace bleep::engine {

/// Changes whenever this interface or the data it passes changes.
constexpr const char* kAbiTag = "bleep-engine-abi-4";

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
    // Bleep Patch only: the 16 macro values, 0..1.
    const float* macros = nullptr;
};

/// Status of a plugin instance, for its editor.
enum class PortState {
    Ok,
    NoBoard,           ///< no active Bleep Patch in this set
    InactiveMain,      ///< a second Bleep Patch: shows a warning, does nothing
    VersionMismatch,   ///< another build of Bleep Patch owns the engine
};

class IEngine {
public:
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

    // ---- Bleep Patch: the board ([non-RT]) ---------------------------------
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

protected:
    virtual ~IEngine() = default;
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
