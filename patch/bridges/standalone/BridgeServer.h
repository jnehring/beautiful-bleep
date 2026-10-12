// SPDX-License-Identifier: MIT
//
// BridgeServer — the app side of Bleep Audio Bridge (spec §11.3). Creates
// the shared segment, turns every connected bridge into a port node, and runs
// a real-time thread that processes each host block as soon as Live's
// bridges have handed it over.
//
// Version 2 (doc/specs/bridges.md §10.1): a slot is any Bleep port plugin
// with Board = App. Its proxy is an engine instance of the plugin's kind
// (Audio In, MIDI Out, …), so the app's board sees exactly what the plugin's
// board would. Slots with Board = Web go to a SlotRelay (the web hub).
#pragma once

#include "BridgeProtocol.h"
#include "Engine.h"

#include <juce_core/juce_core.h>

#include <functional>
#include <memory>
#include <vector>

namespace bleep::bridge {

/// Takes the Live ports whose Board is the web (the hub implements it).
class SlotRelay {
public:
    virtual ~SlotRelay() = default;
    /// [message thread] A slot with Board = Web appeared, or its track name or kind changed.
    virtual void slotAttached(int slot, uint32_t portKind, const std::string& id, const std::string& track, double sampleRate) = 0;
    /// [message thread] It went away.
    virtual void slotDetached(int slot, const std::string& id) = 0;
    /// [bridge thread, real time] One block of the slot: its input, and the room for what goes back to Live
    /// (the engine's two-block delay applies as for every slot). Return false to send nothing.
    struct Block {
        Transport transport;
        int numSamples = 0;
        const float* in[2] = {nullptr, nullptr};   ///< null if the plugin sends no audio
        const Midi* midiIn = nullptr;
        int numMidiIn = 0;
        float* ret[2] = {nullptr, nullptr};        ///< filled with silence before the call; write audio for the track
        Midi* midiOut = nullptr;                   ///< room for kMaxMidi
        int numMidiOut = 0;
    };
    virtual void slotBlock(int slot, Block& b) noexcept = 0;
    /// [message thread] Samples Live should add to the two blocks of the bridge for this slot's plugin: its
    /// share of the web round trip (bridges.md §3.2). The plugin reports the sum as its latency.
    virtual int slotLatency(int slot) noexcept = 0;
};

class BridgeServer : private juce::Thread {
public:
    /// Adds the app's other ports (MIDI, Link) to a block driven by Live.
    using ExtraPorts = std::function<void(const engine::Transport&, int numSamples, std::vector<int>& handles,
                                          std::vector<engine::BlockIO*>& ios)>;
    /// Called after each block (e.g. to send MIDI out).
    using AfterBlock = std::function<void(std::vector<int>& handles, std::vector<engine::BlockIO*>& ios)>;

    BridgeServer(engine::Engine& engine, ExtraPorts extra = {}, AfterBlock after = {});
    /// [message thread] Before the first poll(). Not owned.
    void setRelay(SlotRelay* relay) noexcept { relay_ = relay; }
    ~BridgeServer() override;

    bool ok() const noexcept { return memory_ != nullptr && wake_ != nullptr; }
    /// [message thread] Heartbeat; bridges come and go as port nodes. Call often (≥ 4 Hz).
    void poll();
    /// Live drove a block recently: the app's own audio device stays silent.
    bool driving() const noexcept { return nowMs() - lastDriveMs_.load() < 250; }
    int connected() const noexcept;

private:
    void run() override;
    void processBlock(int64_t block);
    void detach(int k);

    struct Proxy {
        int handle = 0;
        uint32_t generation = 0;
        uint32_t kind = 0;            ///< engine::PortKind
        uint32_t board = 0;           ///< Board
        std::string id, track;
        std::vector<float> in[2], out[2];
        std::vector<Midi> midiIn;                ///< from the plugin, as the protocol has it
        std::vector<engine::MidiEvent> midiEvents;  ///< the same, for the engine
        std::vector<engine::MidiEvent> midiOut;
        engine::BlockIO io;
        const float* inPtrs[2] = {nullptr, nullptr};
        float* outPtrs[2] = {nullptr, nullptr};
        bool audioIn = false, audioOut = false, midiIn_ = false, midiOut_ = false;  ///< what the kind uses
        // Board = Web: what the block brought, until the relay has answered.
        bool relayGot = false;
        int relayMidi = 0, relaySamples = 0;
        Transport relayTransport;
    };

    engine::Engine& engine_;
    SlotRelay* relay_ = nullptr;
    ExtraPorts extra_;
    AfterBlock after_;
    std::unique_ptr<SharedMemory> memory_;
    std::unique_ptr<WakeSignal> wake_;
    Proxy proxies_[kMaxBridges];
    std::atomic<bool> live_[kMaxBridges] = {};  ///< the audio thread may use proxies_[k]
    std::atomic<bool> relayed_[kMaxBridges] = {};  ///< the slot's Board is the web: the relay handles it
    std::atomic<bool> busy_{false};
    std::atomic<int64_t> lastDriveMs_{0};
    int64_t done_ = -1;
    std::vector<int> handles_;
    std::vector<engine::BlockIO*> ios_;
    std::vector<int> used_;       ///< slots processed in the current block
    std::vector<int> relayUsed_;  ///< slots whose board is the web, in the current block
    std::vector<Midi> relayIn_, relayOut_;
    std::vector<float> relayAudioIn_[2], relayAudioOut_[2];
};

}  // namespace bleep::bridge
