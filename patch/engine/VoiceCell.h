// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// VoiceCell.h — the Voice Cell (spec §8.3): the user patches one voice
// inside; this module compiles that inside once per voice, assigns incoming
// notes to voices (allocation, stealing, mono/legato, glide), fills each
// voice's Voice In signals, runs the awake voices and sums their Voice Out.
//
// The voices' DSP state (inner modules) and the allocation state live in a
// shared State that survives recompiles, so editing the board doesn't cut
// notes off.
#pragma once

#include "Board.h"
#include "Program.h"

#include <array>
#include <atomic>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace bleep::engine {

/// Lets a module own the spec it hands to Module (constructed first).
struct OwnedSpec {
    ModuleSpec ownedSpec;
};

class VoiceCellModule final : private OwnedSpec, public Module {
public:
    static constexpr int kMaxVoices = 16;
    /// Voice In outputs, in this order (registry spec "voice-in").
    enum VoiceSignal { Pitch, Gate, Trigger, Velocity, Release, Pressure, VoiceNumber, Random, kNumSignals };
    enum Setting { Voices, Allocation, Stealing, Mode, Glide, GlideMode, Spread, Output };

    struct Voice {
        int note = -1;
        bool gate = false;
        bool sounding = false;   ///< still audible after its gate went off
        bool retrigger = false;  ///< gate low for one sample: envelopes restart
        bool trigger = false;
        float pitch = 0.0f, target = 0.0f;
        float velocity = 0.0f, release = 0.0f, pressure = 0.0f, random = 0.0f;
        uint64_t age = 0;
        float peak = 0.0f;
        int silent = 0;          ///< samples below −90 dB
    };
    /// Survives recompiles.
    struct State {
        std::array<std::map<std::string, std::shared_ptr<Module>>, kMaxVoices> modules;
        std::array<Voice, kMaxVoices> voices{};
        std::vector<int> held;   ///< mono/legato: the note stack
        std::vector<float> heldVelocity;
        uint64_t counter = 0;
        int nextVoice = 0;
        std::string notesSources;  ///< what feeds the Notes input, to spot rewiring
    };

    /// Builds the Voice Cell for `node`, keeping the voices of `previous`.
    static std::shared_ptr<VoiceCellModule> create(const BoardModel& board, const NodeModel& node,
                                                   const std::shared_ptr<VoiceCellModule>& previous, double sampleRate);

    void prepare(double sampleRate) override;
    void reset() override;
    void process(const ProcessContext& ctx) override;

    /// [message thread] Inner modules by node id, one per voice (for knob changes).
    void collect(std::map<std::string, std::vector<std::shared_ptr<Module>>>& out) const;
    /// The voice to show in module views: the one that started last.
    int displayVoice() const noexcept { return displayVoice_.load(); }
    /// Bit k set while voice k plays.
    uint32_t activeVoices() const noexcept { return activeMask_.load(); }

private:
    VoiceCellModule(ModuleSpec spec, std::shared_ptr<State> state);

    void noteOn(const NoteEvent& e, int voices, int mode);
    void noteOff(const NoteEvent& e, int voices, int mode);
    void start(Voice& v, int index, int note, float pitch, float velocity, bool glide);
    int pickVoice(int voices, int note);

    std::shared_ptr<State> state_;
    std::array<std::unique_ptr<Program>, kMaxVoices> programs_;
    std::array<std::array<std::array<float, kChunk>, kNumSignals>, kMaxVoices> signals_{};
    std::vector<std::array<float, kChunk>> sharedIn_;
    size_t numSharedOut_ = 0;
    bool activeTapped_ = false;
    bool releaseAll_ = false;  ///< the Notes input was rewired: no note-offs will come for held notes
    uint64_t seed_ = 0;
    std::atomic<int> displayVoice_{0};
    std::atomic<uint32_t> activeMask_{0};
};

}  // namespace bleep::engine
