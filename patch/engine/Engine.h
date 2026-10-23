// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// Engine.h — the shared engine (spec §5.3, §5.4). One per process; plugins
// reach it through IEngine (EngineApi.h). The board window, in the same
// binary as the engine, also uses the richer C++ API below.
//
// Threads:
//   message thread  registers plugins, owns the board document, compiles
//                   programs, runs the undo stack and the board window;
//   audio threads   each plugin calls process(); for every host block the
//                   first caller claims the block and runs the program.
#pragma once

#include "Board.h"
#include "EngineApi.h"
#include "Program.h"

#include <juce_events/juce_events.h>

#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <vector>

namespace bleep::engine {

class Engine;

/// The board window (patch/board). Created on first use.
class BoardUi {
public:
    virtual ~BoardUi() = default;
    virtual void show(const juce::String& focusNodeId) = 0;
    virtual bool isShowing() const = 0;
    /// The board changed without the window asking for it (load, port, undo from elsewhere).
    virtual void boardChanged() = 0;
};
std::unique_ptr<BoardUi> createBoardUi(Engine&);

class Engine final : public IEngine, private juce::Timer {
public:
    Engine();
    ~Engine() override;

    static constexpr int kMaxInstances = 256;
    static constexpr int kUndoLimit = 200;

    // ---- IEngine -----------------------------------------------------------
    int abiMinor() const noexcept override { return kAbiMinor; }
    void retain() noexcept override;
    void release() noexcept override;
    int registerInstance(PortKind kind) noexcept override;
    void unregisterInstance(int handle) noexcept override;
    void restoreInstanceId(int handle, const char* savedId) noexcept override;
    void instanceId(int handle, char* out, int capacity) noexcept override;
    void setTrack(int handle, const char* trackName, uint32_t argb) noexcept override;
    void prepare(int handle, double sampleRate, int maxBlock) noexcept override;
    PortState state(int handle) noexcept override;
    void statusText(int handle, char* out, int capacity) noexcept override;
    void nodeName(int handle, char* out, int capacity) noexcept override;
    void setNodeName(int handle, const char* name) noexcept override;
    int latencySamples() noexcept override;
    void process(int handle, BlockIO& io) noexcept override;
    size_t saveBoard(int handle, char* out, size_t capacity) noexcept override;
    void loadBoard(int handle, const char* json, size_t length) noexcept override;
    uint64_t boardGeneration() noexcept override { return generation_.load(); }
    void replaceBoardWith(int handle) noexcept override;
    void editorOpened(int handle) noexcept override;
    void openBoard(int handle) noexcept override;
    void setCellPreset(int handle, const char* json, size_t length, bool replace) noexcept override;
    size_t cellPreset(int handle, char* out, size_t capacity) noexcept override;
    size_t uiCall(int handle, const char* method, const char* argsJson, char* out, size_t capacity) noexcept override;
    void setBridged(int handle, bool bridged) noexcept override;
    int portLatencySamples(int handle) noexcept override;

    // ---- for the board window (message thread) ----------------------------
    bool hasBoard() const noexcept { return mainHandle_ != 0 || implicit_; }
    const juce::var& board() const noexcept { return board_; }
    /// Ports and external instances: id → {kind, track, colour, live}.
    juce::var ports() const;
    /// Replaces the board with an edited copy; returns the sanitised result.
    juce::var commit(const juce::var& edited, const juce::String& label);
    bool undo();
    bool redo();
    bool canUndo() const noexcept { return !undo_.empty(); }
    bool canRedo() const noexcept { return !redo_.empty(); }
    /// Knob and amount changes: cheap, no undo entry of their own.
    void beginGesture();
    void setParam(const juce::String& nodeId, const juce::String& paramId, float normalised);
    void setAmount(const juce::String& cableId, float amount);
    /// A node's data (e.g. a sequencer's steps): no recompile, no undo entry of its own.
    void setData(const juce::String& nodeId, const juce::var& data);
    /// A view button or one-shot command (Module::command), for the node and,
    /// inside a Voice Cell, for every voice.
    void command(const juce::String& nodeId, const juce::String& id, float value);
    /// Imports a WAV file (its bytes) into the media folder (Media.h). Returns
    /// {id, name, seconds, channels} or {error}.
    juce::var importMedia(const juce::String& name, const juce::MemoryBlock& bytes);
    /// A Code node's module, compiled by the board UI (engine/wasm/CodeNodes.h): registers it for that node and recompiles the board.
    /// {ok: true} or {error}. `code` is the node's `code` property ({source, interface, settings}).
    juce::var registerCode(const juce::String& nodeId, const juce::var& code, const juce::MemoryBlock& wasm);
    /// The WAV file of a media id as base64, for a preset that takes its audio along: {data, name} or {error}.
    juce::var readMedia(const juce::String& id);
    /// Shows a media file in the computer's file manager (the Recorder's "show take"). {ok} or {error}.
    juce::var revealMedia(const juce::String& id);
    /// Saves audio a module holds (Module::exportMedia) to the media folder.
    /// Returns {id, seconds, channels} or {error}.
    juce::var exportMedia(const juce::String& nodeId, const juce::String& slot);
    /// A performance gesture for a node's module (Button press, Keyboard key):
    /// not saved, no undo entry, no generation change.
    void perform(const juce::String& nodeId, const juce::String& action, const juce::var& args);
    /// Live values for the UI: outputs of every node, params of `detailed`.
    juce::var liveState(const std::set<juce::String>& detailed) const;
    juce::String statusLine() const;

    // ---- the standalone app (spec §11) ---------------------------------------
    /// No Macros node, and the app drives the engine itself (processAll).
    void setStandalone(bool on) noexcept { standalone_ = on; }
    bool standalone() const noexcept { return standalone_; }
    /// Replaces the board's status line (device, Link, transport).
    void setStatusProvider(std::function<juce::String()> provider) { statusProvider_ = std::move(provider); }
    /// Registers an instance that stands for a port plugin in Live or Bleep Play: its node appears on the app's
    /// board whatever its kind (a Live Audio In is the app's Audio In), and the app drives it with processAll().
    int registerRemoteInstance(PortKind kind) noexcept;
    /// Processes one block for several ports at once, from one thread. Every
    /// port's output is the board's output for this same block (no latency
    /// inside the engine). Only for a process with a single driving thread,
    /// never mixed with process(). [RT]
    void processAll(const int* handles, BlockIO* const* ios, int count) noexcept;

    // ---- for tests ----------------------------------------------------------
    int64_t ticks() const noexcept { return ticks_.load(); }
    void reconcileNow();   ///< adds nodes for new ports without the settle delay
    void collectGarbage();
    /// Stores node data modules changed themselves (Module::takeData).
    void pollModuleData();

private:
    void timerCallback() override;
    PortSlot* slot(int handle) const noexcept;
    std::shared_ptr<PortSlot> slotShared(int handle) const;
    void setBoard(juce::var doc, bool resetUndo);
    void claimBoardPorts(const juce::var& doc);
    void boardEdited(bool notifyUi);
    void recompile();
    /// Modules were installed: nodes of a type that was missing are real nodes now.
    void modulesChanged();
    void reconcile(bool force);
    void runTick(int64_t block, const BlockIO& claimer) noexcept;
    /// Runs a cell plugin's cell in the plugin's own block, if the board has it apart from the other plugins. [RT]
    bool runLocal(PortSlot& s, BlockIO& io) noexcept;
    void clearBoard();
    void promoteMain();
    juce::var uiDispatch(int handle, const juce::String& method, const juce::var& args);
    juce::var uiMessage() const;
    juce::var cellParams(int handle);
    /// Cell plugins in a set without Bleep Board get a board of their own, dropped when the last one leaves.
    void updateImplicitBoard();
    /// Puts the instance's preset next to its port node (replacing a cell that is there).
    void attachPreset(PortSlot& slot, const juce::String& portNodeId);
    void applySampleRate();

    juce::ScopedJuceInitialiser_GUI juceInit_;  ///< keeps this binary's JUCE alive while the engine lives
    std::atomic<int> refs_{1};

    // Instances (message thread), plus an RT-safe table by handle.
    std::vector<std::shared_ptr<PortSlot>> instances_;
    std::atomic<PortSlot*> table_[kMaxInstances] = {};
    int mainHandle_ = 0;
    std::string uiLast_;       ///< the last uiCall result, for callers whose buffer was too small
    bool implicit_ = false;    ///< a board kept for cell plugins while there is no Bleep Board
    double sampleRate_ = 48000.0;              ///< message thread: what modules are prepared for
    std::atomic<double> pendingRate_{0.0};     ///< set by prepare() on any thread, applied by the timer
    std::atomic<int> maxBlock_{0};             ///< largest host block any plugin announced in prepare() (never shrinks)
    std::atomic<int> seenBlock_{0};            ///< largest host block process() has actually been called with (never shrinks)

    // Board (message thread).
    juce::var board_;
    std::atomic<uint64_t> generation_{0};
    std::vector<juce::String> undo_, redo_;
    std::map<std::string, std::shared_ptr<Module>> modules_;
    struct Inner {
        std::vector<std::shared_ptr<Module>> modules;  ///< one per voice
        std::shared_ptr<class VoiceCellModule> cell;
    };
    std::map<std::string, Inner> inner_;  ///< nodes inside Voice Cells

    // Program hand-over (hazard pointer: the audio thread announces what it runs).
    std::atomic<Program*> program_{nullptr};
    std::atomic<Program*> inFlight_{nullptr};
    std::vector<Program*> retired_;

    // Ticks (audio threads).
    std::atomic<int64_t> ticks_{0};
    bool wasPlaying_ = false;
    std::atomic<double> uiBpm_{120.0};          ///< the transport of the last tick, for the side menu [RT writes, UI reads]
    std::atomic<bool> uiPlaying_{false};

    bool standalone_ = false;
    std::function<juce::String()> statusProvider_;
    std::unique_ptr<BoardUi> ui_;
    juce::String pendingFocus_;
};

}  // namespace bleep::engine
