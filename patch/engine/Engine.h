// SPDX-License-Identifier: MIT
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

    // ---- for the board window (message thread) ----------------------------
    bool hasBoard() const noexcept { return mainHandle_ != 0; }
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
    /// Live values for the UI: outputs of every node, params of `detailed`.
    juce::var liveState(const std::set<juce::String>& detailed) const;
    juce::String statusLine() const;

    // ---- for tests ----------------------------------------------------------
    int64_t ticks() const noexcept { return ticks_.load(); }
    void reconcileNow();   ///< adds nodes for new ports without the settle delay
    void collectGarbage();

private:
    void timerCallback() override;
    PortSlot* slot(int handle) const noexcept;
    std::shared_ptr<PortSlot> slotShared(int handle) const;
    void setBoard(juce::var doc, bool resetUndo);
    void boardEdited(bool notifyUi);
    void recompile();
    void reconcile(bool force);
    void runTick(int64_t block, const BlockIO& claimer) noexcept;
    void clearBoard();
    void promoteMain();
    void applySampleRate();

    juce::ScopedJuceInitialiser_GUI juceInit_;  ///< keeps this binary's JUCE alive while the engine lives
    std::atomic<int> refs_{1};

    // Instances (message thread), plus an RT-safe table by handle.
    std::vector<std::shared_ptr<PortSlot>> instances_;
    std::atomic<PortSlot*> table_[kMaxInstances] = {};
    int mainHandle_ = 0;
    double sampleRate_ = 48000.0;              ///< message thread: what modules are prepared for
    std::atomic<double> pendingRate_{0.0};     ///< set by prepare() on any thread, applied by the timer
    std::atomic<int> maxBlock_{0};             ///< largest host block of any plugin (never shrinks)

    // Board (message thread).
    juce::var board_;
    std::atomic<uint64_t> generation_{0};
    std::vector<juce::String> undo_, redo_;
    std::map<std::string, std::shared_ptr<Module>> modules_;

    // Program hand-over (hazard pointer: the audio thread announces what it runs).
    std::atomic<Program*> program_{nullptr};
    std::atomic<Program*> inFlight_{nullptr};
    std::vector<Program*> retired_;

    // Ticks (audio threads).
    std::atomic<int64_t> ticks_{0};
    bool wasPlaying_ = false;

    std::unique_ptr<BoardUi> ui_;
    juce::String pendingFocus_;
};

}  // namespace bleep::engine
