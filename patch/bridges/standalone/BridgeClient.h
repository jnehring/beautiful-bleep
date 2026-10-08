// SPDX-License-Identifier: MIT
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
    enum class Status { AppNotRunning, Connected, OtherHost, NoFreeSlot };

    BridgeClient();
    ~BridgeClient();

    /// [message thread] The bridge's stable ID and its track name.
    void setIdentity(const std::string& id, const std::string& track);
    void prepare(double sampleRate, int maxBlock);
    /// [message thread] Call a few times per second.
    Status poll();
    Status status() const noexcept { return status_.load(); }
    uint32_t drops() const noexcept;
    /// Another live bridge uses the same ID (a duplicated device): pick a new one.
    bool idTaken() const noexcept { return idTaken_; }
    int latencySamples() const noexcept { return 2 * maxBlock_; }

    /// [RT] Hands this block to the app and fills `ret` with the app's return
    /// for the block two blocks ago. Returns false if there is none.
    bool process(const float* const* in, float* const* ret, int numChannels, int numSamples, const Transport& t,
                 bool offline) noexcept;

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
    bool trackChanged_ = false;
    bool idTaken_ = false;
    int maxBlock_ = 512;
    double sampleRate_ = 48000.0;
    int64_t counter_ = -1;  // audio thread
};

}  // namespace bleep::bridge
