// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// PortSlot.h — how a port plugin and the engine exchange one host block.
//
// Each registered plugin instance owns a PortSlot with two small rings of
// frames: `in` (plugin → engine) and `out` (engine → plugin). A frame is
// tagged with the host block it belongs to and guarded by a sequence lock,
// so a reader never uses a frame that is being written (spec §5.3):
//
//   no Bleep Board (the first plugin of a block runs the tick):
//   host block N:  port writes in[N]   ─┐
//                  engine tick N reads  in[N-1], writes out[N-1]
//                  port reads out[N-2] ─┘      → two blocks of latency
//
//   with Bleep Board (it runs the tick in its own block N, driver):
//                  every other port writes in[N] and reads out[N-1];
//                  tick N reads in[N] of the driver and in[N-1] of the others, writes out[N] for all
//                  → driver to driver none, one block to or from another plugin, two through the board
#pragma once

#include "EngineApi.h"

#include <atomic>
#include <cstring>
#include <memory>
#include <string>

namespace bleep::engine {

class Program;

constexpr int kRing = 4;

struct PortFrame {
    std::atomic<uint32_t> seq{0};   ///< odd while being written
    int64_t block = -1;             ///< host block index this frame belongs to
    int numSamples = 0;
    int numChannels = 0;
    Transport transport;
    float audio[2][kMaxHostBlock];
    int numMidi = 0;
    MidiEvent midi[kMaxMidiEvents];
    float macros[kNumMacros] = {};

    void beginWrite(int64_t b) noexcept {
        seq.store(seq.load(std::memory_order_relaxed) | 1u, std::memory_order_relaxed);
        std::atomic_thread_fence(std::memory_order_release);
        block = b;
    }
    void endWrite() noexcept { seq.store((seq.load(std::memory_order_relaxed) | 1u) + 1u, std::memory_order_release); }
};

/// Copies `src` into `dst` if it holds host block `b` and wasn't torn. [RT]
inline bool readFrame(const PortFrame& src, int64_t b, PortFrame& dst) noexcept {
    const uint32_t s1 = src.seq.load(std::memory_order_acquire);
    if ((s1 & 1u) != 0 || src.block != b) return false;
    dst.block = src.block;
    dst.numSamples = std::min(src.numSamples, kMaxHostBlock);
    dst.numChannels = src.numChannels;
    dst.transport = src.transport;
    for (int ch = 0; ch < 2; ++ch) std::memcpy(dst.audio[ch], src.audio[ch], sizeof(float) * (size_t)dst.numSamples);
    dst.numMidi = std::min(src.numMidi, kMaxMidiEvents);
    std::memcpy(dst.midi, src.midi, sizeof(MidiEvent) * (size_t)dst.numMidi);
    std::memcpy(dst.macros, src.macros, sizeof(src.macros));
    std::atomic_thread_fence(std::memory_order_acquire);
    return src.seq.load(std::memory_order_relaxed) == s1;
}

/// One registered plugin instance.
struct PortSlot {
    PortKind kind = PortKind::None;
    int handle = 0;

    // Message thread only.
    std::string id;                 ///< stable instance ID (UUID)
    std::string trackName;
    uint32_t trackColour = 0;
    double registeredAt = 0.0;      ///< ms, for the settle delay before a node appears
    bool restored = false;          ///< setState has run (or the settle delay passed)
    bool remote = false;            ///< standalone app: stands in for a plugin or Bleep Play somewhere else (Engine::registerRemoteInstance)
    bool seeded = false;            ///< Bleep Board: its own MIDI In and Audio Out nodes were added to a new board
    bool bridged = false;           ///< Live: the plugin talks to another board (IEngine::setBridged)
    std::string savedBoard;         ///< Bleep Board: the board it loaded or last saved
    std::string presetJson;         ///< cell plugins: the preset as the plugin loaded it (name, plays, panels …)

    // Audio thread of this plugin.
    int64_t counter = -1;           ///< this plugin's idea of the host block index
    PortFrame in[kRing];
    PortFrame out[kRing];

    // Engine (audio thread of the claiming plugin).
    PortFrame tickIn;               ///< snapshot of in[N-1] for the running tick
    bool tickInValid = false;

    // A cell plugin whose cell is cabled to no other plugin runs in its own plugin's block (Program::runLocal): no hand-over,
    // no latency. The input is tickIn, filled from the block itself; the output goes to localOut.
    PortFrame localOut;
    bool localWasPlaying = false;            ///< audio thread of this plugin
    std::atomic<bool> local{false};          ///< the running program runs this slot's cell in its own block (message thread writes)
    std::atomic<Program*> hazard{nullptr};   ///< the program this plugin's audio thread is running, so it is not deleted under it

    // Statistics, shown in the plugin's status line.
    std::atomic<int64_t> lastBlock{-1};
    std::atomic<uint32_t> resyncs{0};
    std::atomic<uint32_t> drops{0};
    std::atomic<int> maxBlock{0};

    /// Bleep Board: the board has an Audio Out node for this plugin, so its output is the board's (else the track passes through).
    std::atomic<bool> writesOut{false};
};

/// A port node's view of its plugin during one tick.
struct PortIO {
    PortSlot* slot = nullptr;
    const PortFrame* in = nullptr;  ///< null if the plugin sent nothing for this block
    PortFrame* out = nullptr;       ///< null for ports without outputs to Live
};

}  // namespace bleep::engine
