// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Program.h — a compiled board: the real nodes in processing order, each
// with its inputs bound to source buffers. Cells are flattened away: a cable
// that enters or leaves a cell is followed through the cell's jacks, and the
// amounts along the way multiply.
//
// Programs are built on the message thread and swapped into the engine; the
// audio thread only runs them. Feedback (spec §7.5): cycles are allowed; the
// cable that closes a loop reads its source's previous chunk (kChunk samples).
#pragma once

#include "Board.h"
#include "PortSlot.h"
#include "dsp/Harmony.h"

#include <array>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <vector>

namespace bleep::engine {

class Program {
public:
    struct Source {
        const float* buffer = nullptr;
        float amount = 1.0f;
    };
    struct Step {
        std::string nodeId;
        std::shared_ptr<Module> module;
        std::shared_ptr<PortSlot> port;   ///< port nodes; null for modules and ghosts
        bool portWritesOut = false;       ///< the node writes audio/MIDI back to its plugin
        bool bypassed = false;            ///< audio in goes to audio out; the module does not run
        std::vector<std::pair<int, int>> bypassRoute;  ///< (input jack, output jack) pairs: the n-th audio in feeds the n-th audio out
        PortIO io;
        int local = -1;                   ///< the local group this step runs in (Program::localGroup), -1: the tick runs it

        std::vector<std::vector<Source>> paramSources;   ///< per param
        std::vector<std::vector<Source>> inputSources;   ///< per input jack (signal)
        std::vector<std::vector<const NoteBuffer*>> noteSources;  ///< per input jack (notes)

        std::vector<std::unique_ptr<float[]>> paramBuffers, inputBuffers, outputBuffers;
        std::vector<std::unique_ptr<NoteBuffer>> noteInputs, noteOutputs;

        // Pointer arrays handed to the module.
        std::vector<const float*> paramPtrs, inputPtrs;
        std::unique_ptr<bool[]> connected;
        std::unique_ptr<bool[]> outConnected;   ///< per output jack: something reads it
        std::vector<const NoteBuffer*> notesInPtrs;
        std::vector<float*> outputPtrs;
        std::vector<NoteBuffer*> notesOutPtrs;
    };

    /// Which part of the board to compile. The whole board is the default
    /// scope; a Voice Cell compiles its inside as a scope of its own (spec §8.3):
    /// Voice In and the cell's shared inputs become `external` buffers it fills,
    /// and Voice Out and the cell's shared outputs become `taps` it reads.
    struct Scope {
        std::string root;  ///< the Voice Cell's id; empty for the whole board
        std::map<std::pair<std::string, std::string>, const float*> external;  ///< (node, jack) → buffer
        std::vector<Endpoint> taps;  ///< inputs whose sources the owner reads after each chunk
    };

    /// Compiles `board`. Reuses modules from `modules` (by node id and type)
    /// and creates the missing ones; `modules` is updated to exactly the
    /// scope's real nodes. `ports` maps port IDs to their live slots.
    static std::unique_ptr<Program> compile(const BoardModel& board,
                                            std::map<std::string, std::shared_ptr<Module>>& modules,
                                            const std::map<std::string, std::shared_ptr<PortSlot>>& ports,
                                            double sampleRate, const Scope* scope = nullptr, bool allowLocal = false);

    /// Runs one host block of `numSamples`: every step that is not in a local group. [RT]
    void run(const Transport& transport, int numSamples, bool transportStarted) noexcept;

    /// Cell plugins (Instrument, Audio Insert) whose cell is cabled to no other plugin: the connected part of the board around
    /// such a plugin's port (the port node, the cell, whatever is cabled to it) has no cable to anything else, so the plugin's own
    /// audio thread can run it in the plugin's own block. That takes no hand-over between plugins, so no latency. Only with
    /// `allowLocal` (compile): the standalone app has one driving thread and no latency anyway.
    /// The group of `slot`, or -1 if the tick runs its steps.
    int localGroup(const PortSlot* slot) const noexcept {
        for (size_t g = 0; g < local_.size(); ++g)
            if (local_[g].slot == slot) return (int)g;
        return -1;
    }
    /// Runs one host block of group `g` in the calling plugin's thread, with the plugin's block as input in `in`
    /// (audio, MIDI, transport); the group's output audio ends in `out`. [RT]
    void runLocal(int g, const Transport& transport, bool transportStarted, PortFrame& in, PortFrame& out) noexcept;
    /// Runs one chunk (at most kChunk samples) described by `chunk`. [RT]
    void runChunk(const ProcessContext& chunk) noexcept;
    /// Sources feeding taps[i] of the scope, valid after runChunk. [RT]
    const std::vector<Source>& tap(size_t i) const noexcept { return taps_[i]; }

    const std::vector<Step>& steps() const noexcept { return steps_; }
    std::vector<Step>& steps() noexcept { return steps_; }
    const std::vector<std::shared_ptr<PortSlot>>& slots() const noexcept { return slots_; }
    double sampleRate() const noexcept { return sampleRate_; }
    /// Cables that close a loop ("from.node→to.node"), for tests and the UI.
    const std::set<std::string>& feedback() const noexcept { return feedback_; }

private:
    struct Local {
        const PortSlot* slot = nullptr;
        std::vector<size_t> steps;   ///< indices into steps_, in processing order
    };
    static bool outputsSane(Step& st, int numSamples) noexcept;
    void runSteps(const Transport& transport, int numSamples, bool transportStarted, int group) noexcept;
    void runStep(Step& st, ProcessContext& ctx) noexcept;
    void splitLocal();
    std::vector<Local> local_;
    std::vector<Step> steps_;
    std::vector<std::vector<Source>> taps_;
    std::vector<std::shared_ptr<PortSlot>> slots_;
    std::set<std::string> feedback_;
    /// The harmony buses (ProcessContext::harmony). Writers publish their full
    /// state every chunk, so a recompile loses nothing.
    std::array<dsp::HarmonyState, dsp::kHarmonyBuses> harmony_{};
    double sampleRate_ = 48000.0;
};

}  // namespace bleep::engine
