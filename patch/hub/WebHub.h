// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// WebHub — the app's side of the web link (doc/specs/bridges.md §2, §3.2, §10). Owns the WebSocket server,
// the web peers and their channels, and does three jobs:
//
//   * Live ports with Board = Bleep Play (SlotRelay): their audio and MIDI go to Bleep Play and come back;
//   * Bleep Play pages' own bridged nodes (open): the app's board gets nodes "Web: …", driven through collect/after;
//   * sync: tempo, beat and play state to every peer, requests back, flushes on jumps.
//
// Threads: the server's reader threads (messages), the engine's driver (collect/after: the audio device's
// callback, or the bridge thread while Live drives), the bridge thread (slotBlock), the message thread (poll)
// and a small thread for sync. Shared tables sit behind one mutex that the real-time paths only try to take.
#pragma once

#include "AudioLink.h"
#include "BridgeServer.h"
#include "Engine.h"
#include "WebSocketServer.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <vector>

namespace bleep::hub {

class WebHub final : public WebSocketServer::Listener, public bridge::SlotRelay, private juce::Thread {
public:
    struct Callbacks {
        /// An origin that isn't the app's own page wants to connect. May block (the pairing dialog); empty: deny.
        std::function<bool(const std::string& origin)> askPairing;
        /// How long a denied (or unanswered, or turned-away-because-another-dialog-was-open) origin stays denied without asking again.
        double pairingDenyMs = 5.0 * 60.0 * 1000.0;
        /// Origins the user allowed before, and a way to remember a new one.
        std::function<std::set<std::string>()> allowedOrigins;
        std::function<void(const std::string& origin)> rememberOrigin;
        /// Bleep Play asks for a tempo (> 0) and/or start (1) or stop (0); -1: no change. The leader decides.
        std::function<void(double tempo, int play)> request;
        /// Who leads when Live doesn't: "link" or "app".
        std::function<std::string()> leader;
    };

    WebHub(engine::Engine& engine, Callbacks callbacks);
    ~WebHub() override;

    /// `webRoot`: a folder with the board page (index.html and its files), or empty for the built-in page.
    bool start(int port, const std::string& webRoot);
    void stop();
    bool running() const noexcept { return server_ != nullptr; }
    int port() const noexcept;

    /// [message thread] Registers and removes the app's nodes for web channels. Call a few times per second.
    void poll();
    /// [message thread] Peers and channels, for the settings page and tests.
    juce::var status() const;
    int numPeers() const;

    /// [engine driver] The Bleep Play pages' nodes in this block: their input, before processAll().
    void collect(const engine::Transport& t, int numSamples, std::vector<int>& handles, std::vector<engine::BlockIO*>& ios);
    /// [engine driver] After processAll(): their output goes to the peers.
    void after(std::vector<int>& handles, std::vector<engine::BlockIO*>& ios);

    // ---- bridge::SlotRelay ---------------------------------------------------------------
    void slotAttached(int slot, uint32_t portKind, const std::string& id, const std::string& track, double sampleRate) override;
    void slotDetached(int slot, const std::string& id) override;
    void slotBlock(int slot, Block& b) noexcept override;
    int slotLatency(int slot) noexcept override;

private:
    struct MidiEv {
        double beat = -1.0;
        uint8_t bytes[3] = {0, 0, 0};
        uint8_t size = 0;
    };
    struct Peer {
        uint64_t connId = 0;
        std::shared_ptr<Connection> conn;
        std::string id, name;
        double sampleRate = 48000.0;
        bool low = false;
        bool welcomed = false;
    };
    enum class Kind { Audio, Midi };
    struct Channel {
        bool active = false;
        int ch = 0;
        Kind kind = Kind::Audio;
        bool toWeb = true;
        std::string key, name, port, source;
        uint64_t connId = 0;
        std::shared_ptr<Connection> conn;
        int slot = -1;                 ///< a Live slot's channel; -1: a web node's
        int partner = -1;              ///< the other direction of a web node with dir "both"
        double webLatencyMs = 0.0;     ///< declared by Bleep Play
        double webRate = 48000.0;
        bool lowLatency = false;
        uint32_t seq = 0;
        int64_t sampleTime = 0;
        AudioLink link;                ///< fromWeb audio
        std::vector<MidiEv> queue;     ///< fromWeb MIDI, not yet due
        // A web node's engine instance (poll() makes it; collect/after drive it).
        int handle = 0;
        bool wantInstance = false;
        engine::PortKind instanceKind = engine::PortKind::None;
        std::string instanceId;
        std::vector<float> in[2], out[2];
        std::vector<engine::MidiEvent> midiIn, midiOut;
        const float* inPtrs[2] = {nullptr, nullptr};
        float* outPtrs[2] = {nullptr, nullptr};
        engine::BlockIO io;
        bool ioReady = false;
    };
    struct SlotInfo {
        bool attached = false;
        uint32_t kind = 0;
        std::string id, track;
        double sampleRate = 48000.0;
        std::vector<int> channels;     ///< all peers' channels of this slot
    };

    // WebSocketServer::Listener
    void onOpen(Connection&) override {}
    void onText(Connection& c, const std::string& text) override;
    void onBinary(Connection& c, const uint8_t* data, size_t size) override;
    void onClose(Connection& c) override;
    void run() override;  // sync

    bool allowOrigin(const std::string& origin);
    std::mutex pairMutex_;                  ///< guards the two below
    bool pairingPending_ = false;           ///< one pairing question at a time; others are denied at once
    std::map<std::string, double> denied_;  ///< origin -> hubMs() until which it stays denied
    bool serve(const std::string& path, HttpResponse& out);
    void handleHello(Connection& c, const juce::var& msg);
    void handleOpen(Connection& c, const juce::var& msg);
    void handleMidi(Connection& c, const juce::var& msg);
    void sendChannelList(Peer& p);
    void announce(Channel& ch, bool online);
    Channel* allocate();   ///< m_ held; null if full
    void addSlotChannels(int slot, Peer& p);
    void dropPeerChannels(uint64_t connId);
    Peer* peerOf(uint64_t connId);
    void observe(const engine::Transport& t, int n, bool fromLive) noexcept;
    void sendAudio(Channel& ch, const float* l, const float* r, int n, double sampleRate);
    void sendMidi(Channel& ch, const bridge::Midi* ev, int count, const engine::Transport& t, int numSamples);
    int pullDue(Channel& ch, const engine::Transport& t, int numSamples, bridge::Midi* out, int capacity);
    static std::string uuidFor(const std::string& peerId, const std::string& key, const char* role);
    double hubMs() const noexcept;
    static std::string quote(const std::string& s);

    engine::Engine& engine_;
    Callbacks cb_;
    std::unique_ptr<WebSocketServer> server_;
    std::string webRoot_;
    int boundPort_ = 0;

    mutable std::mutex m_;
    std::map<uint64_t, Peer> peers_;
    std::vector<std::unique_ptr<Channel>> channels_;  ///< index = channel number; entries live as long as the hub
    SlotInfo slots_[bridge::kMaxBridges];
    std::vector<int> removed_;  ///< handles to unregister in poll()
    double sinkRate_ = 48000.0;
    int lastBlock_ = 128;

    // Sync (written by the engine drivers, read by the sync thread).
    juce::SpinLock syncLock_;
    engine::Transport transport_;
    bool haveTransport_ = false;
    double prevBpm_ = 0.0, prevPpq_ = -1.0;
    int prevBlock_ = 0;
    bool prevPlaying_ = false;
    std::atomic<uint32_t> epoch_{0};
    std::atomic<uint32_t> sentEpoch_{0};
    std::atomic<double> liveMs_{-1e9};
    std::atomic<bool> inBlock_{false};  ///< between collect() and after(): engine handles are in use
    std::atomic<uint32_t> lateEvents_{0}, staleEvents_{0};
};

}  // namespace bleep::hub
