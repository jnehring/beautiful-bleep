// SPDX-License-Identifier: MIT
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
        PortIO io;

        std::vector<std::vector<Source>> paramSources;   ///< per param
        std::vector<std::vector<Source>> inputSources;   ///< per input jack (signal)
        std::vector<std::vector<const NoteBuffer*>> noteSources;  ///< per input jack (notes)

        std::vector<std::unique_ptr<float[]>> paramBuffers, inputBuffers, outputBuffers;
        std::vector<std::unique_ptr<NoteBuffer>> noteInputs, noteOutputs;

        // Pointer arrays handed to the module.
        std::vector<const float*> paramPtrs, inputPtrs;
        std::unique_ptr<bool[]> connected;
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
                                            double sampleRate, const Scope* scope = nullptr);

    /// Runs one host block of `numSamples`. [RT]
    void run(const Transport& transport, int numSamples, bool transportStarted) noexcept;
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
    std::vector<Step> steps_;
    std::vector<std::vector<Source>> taps_;
    std::vector<std::shared_ptr<PortSlot>> slots_;
    std::set<std::string> feedback_;
    double sampleRate_ = 48000.0;
};

}  // namespace bleep::engine
