// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// WebHubBoard.cpp — web nodes in the app's board, and the per-block collect/after.
#include "WebHubInternal.h"

namespace bleep::hub {

// ---- web nodes in the app's board ----------------------------------------------------------------------------

std::string WebHub::uuidFor(const std::string& peerId, const std::string& key, const char* role) {
    // Stable across reconnects, so the app's node for Bleep Play's node keeps its cables (§6).
    const std::string material = peerId + "|" + key + "|" + role;
    const auto digest = sha1(material.data(), material.size());
    juce::String hex;
    for (int i = 0; i < 16; ++i) hex << juce::String::toHexString(&digest[(size_t)i], 1).paddedLeft('0', 2);
    return (hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + hex.substring(12, 16) + "-" + hex.substring(16, 20) +
            "-" + hex.substring(20, 32)).toStdString();
}

void WebHub::poll() {
    std::vector<int> toRemove;
    struct Make { int ch; engine::PortKind kind; std::string id, name; double rate; };
    std::vector<Make> make;
    {
        std::lock_guard<std::mutex> lock(m_);
        toRemove.swap(removed_);
        for (auto& c : channels_)
            if (c && c->active && c->wantInstance && c->handle == 0)
                make.push_back({c->ch, c->instanceKind, c->instanceId, c->name, sinkRate_});
    }
    // The block thread may still be inside collect/after with these handles: unregistering waits for nothing
    // there because collect() only reads handles under m_, and the handle was cleared under m_ before it got here.
    if (!toRemove.empty()) {
        const double until = hubMs() + 50.0;
        while (inBlock_.load() && hubMs() < until) std::this_thread::yield();  // a block in flight may hold the handle
    }
    for (int h : toRemove) engine_.unregisterInstance(h);
    for (const auto& m : make) {
        const int handle = engine_.registerRemoteInstance(m.kind);
        if (handle == 0) continue;
        engine_.restoreInstanceId(handle, m.id.c_str());
        engine_.setTrack(handle, ("Web: " + m.name).c_str(), 0);
        engine_.prepare(handle, m.rate, 2048);
        std::lock_guard<std::mutex> lock(m_);
        Channel* c = channels_[(size_t)m.ch].get();
        if (!c->active || !c->wantInstance) {
            engine_.unregisterInstance(handle);
            continue;
        }
        for (int k = 0; k < 2; ++k) {
            c->in[k].assign(bridge::kMaxBlock, 0.0f);
            c->out[k].assign(bridge::kMaxBlock, 0.0f);
            c->inPtrs[k] = c->in[k].data();
            c->outPtrs[k] = c->out[k].data();
        }
        c->midiIn.assign(bridge::kMaxMidi, engine::MidiEvent{});
        c->midiOut.assign(engine::kMaxMidiEvents, engine::MidiEvent{});
        c->io = engine::BlockIO{};
        using engine::PortKind;
        const bool audioIn = c->instanceKind == PortKind::AudioIn || c->instanceKind == PortKind::AudioBridge;
        const bool audioOut = c->instanceKind == PortKind::AudioOut || c->instanceKind == PortKind::AudioBridge;
        c->io.audioIn = audioIn ? c->inPtrs : nullptr;
        c->io.numAudioIn = audioIn ? 2 : 0;
        c->io.audioOut = audioOut ? c->outPtrs : nullptr;
        c->io.numAudioOut = audioOut ? 2 : 0;
        c->io.midiIn = c->instanceKind == PortKind::MidiDevice ? c->midiIn.data() : nullptr;
        c->io.midiOut = c->instanceKind == PortKind::MidiOut ? c->midiOut.data() : nullptr;
        c->io.midiOutCapacity = c->io.midiOut ? (int)c->midiOut.size() : 0;
        c->handle = handle;
        c->ioReady = true;
    }
}

void WebHub::collect(const engine::Transport& t, int n, std::vector<int>& handles, std::vector<engine::BlockIO*>& ios) {
    observe(t, n, false);
    std::unique_lock<std::mutex> lock(m_, std::defer_lock);
    if (!lockBriefly(lock)) return;
    sinkRate_ = t.sampleRate > 0.0 ? t.sampleRate : sinkRate_;
    lastBlock_ = n;
    inBlock_.store(true);
    for (auto& cp : channels_) {
        if (!cp || !cp->active || cp->handle == 0 || !cp->ioReady) continue;
        Channel& ch = *cp;
        engine::BlockIO& io = ch.io;
        io.numSamples = n;
        io.transport = t;
        io.numMidiIn = 0;
        io.numMidiOut = 0;
        if (io.audioIn) {
            if (!ch.link.pull(ch.in[0].data(), ch.in[1].data(), n)) {
                std::fill_n(ch.in[0].data(), n, 0.0f);
                std::fill_n(ch.in[1].data(), n, 0.0f);
            }
        }
        if (io.midiIn) {
            static thread_local std::vector<Midi> due(bridge::kMaxMidi);
            const int count = pullDue(ch, t, n, due.data(), bridge::kMaxMidi);
            for (int i = 0; i < count; ++i) {
                ch.midiIn[(size_t)i].offset = due[(size_t)i].offset;
                std::memcpy(ch.midiIn[(size_t)i].bytes, due[(size_t)i].bytes, 3);
                ch.midiIn[(size_t)i].size = due[(size_t)i].size;
            }
            io.numMidiIn = count;
        }
        handles.push_back(ch.handle);
        ios.push_back(&io);
    }
}

void WebHub::after(std::vector<int>&, std::vector<engine::BlockIO*>&) {
    struct Done {
        std::atomic<bool>& flag;
        ~Done() { flag.store(false); }
    } done{inBlock_};
    std::unique_lock<std::mutex> lock(m_, std::defer_lock);
    if (!lockBriefly(lock)) return;
    for (auto& cp : channels_) {
        if (!cp || !cp->active || cp->handle == 0 || !cp->ioReady) continue;
        Channel& ch = *cp;
        engine::BlockIO& io = ch.io;
        if (!io.boardAudioValid) continue;
        // The instance sits on the fromWeb channel of a node that receives, or on the toWeb channel of one that
        // only sends. What the board returns goes out on the toWeb channel: its partner, or itself.
        Channel* target = ch.toWeb ? &ch : (ch.partner >= 0 ? channels_[(size_t)ch.partner].get() : nullptr);
        if (target == nullptr || !target->toWeb) continue;
        if (io.audioOut && target->kind == Kind::Audio) {
            sendAudio(*target, ch.out[0].data(), ch.out[1].data(), io.numSamples, sinkRate_);
        } else if (io.midiOut && io.numMidiOut > 0 && target->kind == Kind::Midi) {
            static thread_local std::vector<Midi> events(bridge::kMaxMidi);
            const int count = std::min(io.numMidiOut, bridge::kMaxMidi);
            for (int i = 0; i < count; ++i) {
                events[(size_t)i].offset = ch.midiOut[(size_t)i].offset;
                std::memcpy(events[(size_t)i].bytes, ch.midiOut[(size_t)i].bytes, 3);
                events[(size_t)i].size = ch.midiOut[(size_t)i].size;
            }
            sendMidi(*target, events.data(), count, io.transport, io.numSamples);
        }
    }
}

}  // namespace bleep::hub
