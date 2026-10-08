// SPDX-License-Identifier: MIT
//
// BridgeServer — the app side of Bleep Audio Bridge (spec §11.3). Creates
// the shared segment, turns every connected bridge into a port node, and runs
// a real-time thread that processes each host block as soon as Live's
// bridges have handed it over.
#pragma once

#include "BridgeProtocol.h"
#include "Engine.h"

#include <juce_core/juce_core.h>

#include <functional>
#include <memory>
#include <vector>

namespace bleep::bridge {

class BridgeServer : private juce::Thread {
public:
    /// Adds the app's other ports (MIDI, Link) to a block driven by Live.
    using ExtraPorts = std::function<void(const engine::Transport&, int numSamples, std::vector<int>& handles,
                                          std::vector<engine::BlockIO*>& ios)>;
    /// Called after each block (e.g. to send MIDI out).
    using AfterBlock = std::function<void(std::vector<int>& handles, std::vector<engine::BlockIO*>& ios)>;

    BridgeServer(engine::Engine& engine, ExtraPorts extra = {}, AfterBlock after = {});
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
        std::string id;
        std::vector<float> in[2], out[2];
        engine::BlockIO io;
        const float* inPtrs[2] = {nullptr, nullptr};
        float* outPtrs[2] = {nullptr, nullptr};
    };

    engine::Engine& engine_;
    ExtraPorts extra_;
    AfterBlock after_;
    std::unique_ptr<SharedMemory> memory_;
    std::unique_ptr<WakeSignal> wake_;
    Proxy proxies_[kMaxBridges];
    std::atomic<bool> live_[kMaxBridges] = {};  ///< the audio thread may use proxies_[k]
    std::atomic<bool> busy_{false};
    std::atomic<int64_t> lastDriveMs_{0};
    int64_t done_ = -1;
    std::vector<int> handles_;
    std::vector<engine::BlockIO*> ios_;
    std::vector<int> used_;  ///< slots processed in the current block
};

}  // namespace bleep::bridge
