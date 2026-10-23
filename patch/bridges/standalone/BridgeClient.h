// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// BridgeClient — the Live side of Bleep Audio Bridge (spec §11.3). One per
// plugin instance. poll() runs on the message thread (connect, claim a slot,
// heartbeats); process() runs on the audio thread and never blocks, except
// in offline rendering, where it waits for the app.
#pragma once

#include "BridgeProtocol.h"

#include <memory>
#include <string>
#include <vector>

namespace bleep::bridge {

class BridgeClient {
public:
    enum class Status { AppNotRunning, Connected, OtherHost, NoFreeSlot, VersionMismatch };

    BridgeClient();
    ~BridgeClient();

    /// [message thread] The bridge's stable ID and its track name.
    void setIdentity(const std::string& id, const std::string& track);
    const std::string& identity() const noexcept { return id_; }
    /// [message thread] Which port plugin this is (an engine::PortKind value; AudioBridge for the Bleep Audio Bridge)
    /// and which board is on the other side. A change is seen by the app at once.
    void setPort(uint32_t portKind, Board board);
    void prepare(double sampleRate, int maxBlock);
    /// [message thread] Call a few times per second.
    Status poll();
    Status status() const noexcept { return status_.load(); }
    uint32_t drops() const noexcept;
    /// Another live bridge uses the same ID (a duplicated device): pick a new one.
    bool idTaken() const noexcept { return idTaken_; }
    /// Two blocks of the size the host really runs (what it announced in prepare() until a block has come).
    int latencySamples() const noexcept {
        const int seen = seenBlock_.load(std::memory_order_relaxed);
        return 2 * (seen > 0 ? seen : maxBlock_) + extraLatency();
    }
    /// What the app asks the plugin to add (Bleep Play in the loop); 0 without one.
    int extraLatency() const noexcept;

    /// [RT] Hands this block to the app and fills `ret` with the app's return
    /// for the block two blocks ago. Returns false if there is none.
    bool process(const float* const* in, float* const* ret, int numChannels, int numSamples, const Transport& t,
                 bool offline) noexcept;

    /// What a port plugin hands over and takes back in one block. Null pointers mean "none": Audio In has no
    /// return, Audio Out sends no audio, MIDI ports carry no audio.
    struct Block {
        const float* const* in = nullptr;   ///< the track's audio (Audio In, Audio Insert, Bridge)
        float* const* ret = nullptr;        ///< board audio for the track, filled with the return of two blocks ago
        int numChannels = 2;
        int numSamples = 0;
        Transport transport;
        bool offline = false;
        const Midi* midiIn = nullptr;       ///< the track's MIDI (MIDI In, Instrument)
        int numMidiIn = 0;
        Midi* midiOut = nullptr;            ///< MIDI for the track (MIDI Out), room for kMaxMidi
        int numMidiOut = 0;                 ///< written: events returned for this block
    };
    /// [RT] The general form of process(). Returns false if the app's return for this block is missing.
    bool exchange(Block& b) noexcept;

private:
    void disconnect();
    bool claimSlot();

    std::unique_ptr<SharedMemory> memory_;
    std::unique_ptr<WakeSignal> wake_;
    std::vector<std::unique_ptr<SharedMemory>> retired_;  ///< old mappings the audio thread may still hold
    std::atomic<Shared*> shared_{nullptr};
    std::atomic<int> slot_{-1};
    std::atomic<Status> status_{Status::AppNotRunning};
    std::string id_, track_;
    uint32_t portKind_ = 0;
    Board board_ = Board::App;
    bool portChanged_ = false;
    bool trackChanged_ = false;
    bool idTaken_ = false;
    int maxBlock_ = 512;
    std::atomic<int> seenBlock_{0};  ///< largest block exchange() has been called with
    double sampleRate_ = 48000.0;
    int64_t counter_ = -1;  // audio thread
};

}  // namespace bleep::bridge
