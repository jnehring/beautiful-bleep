// SPDX-License-Identifier: MIT
// WebHubMessages.cpp — messages from the web: hello, open, MIDI, binary packets and closing.
#include "WebHubInternal.h"

namespace bleep::hub {

// ---- messages from the web -----------------------------------------------------------------------------

WebHub::Peer* WebHub::peerOf(uint64_t connId) {
    auto it = peers_.find(connId);
    return it == peers_.end() ? nullptr : &it->second;
}

void WebHub::onText(Connection& c, const std::string& text) {
    const juce::var msg = bleep::safejson::parse(juce::String(text));
    if (!msg.isObject()) return;
    const juce::String op = msg["op"].toString();
    if (op == "hello") return handleHello(c, msg);
    if (op == "ping") {
        c.sendText(json(object({{"op", "pong"}, {"t", msg["t"]}, {"hub", hubMs()}})));
        return;
    }
    {
        std::lock_guard<std::mutex> lock(m_);
        if (peerOf(c.id()) == nullptr) return;  // no hello yet
    }
    if (op == "open") return handleOpen(c, msg);
    if (op == "midi") return handleMidi(c, msg);
    if (op == "close") {
        std::lock_guard<std::mutex> lock(m_);
        const std::string key = msg["key"].toString().toStdString();
        for (auto& ch : channels_)
            if (ch && ch->active && ch->connId == c.id() && ch->slot < 0 && ch->key == key) {
                if (ch->handle) removed_.push_back(ch->handle);
                ch->handle = 0;
                ch->active = false;
                ch->wantInstance = false;
            }
        return;
    }
    if (op == "request") {
        if (cb_.request) {
            const double tempo = msg.hasProperty("tempo") ? (double)msg["tempo"] : 0.0;
            const int play = msg.hasProperty("play") ? ((bool)msg["play"] ? 1 : 0) : -1;
            cb_.request(tempo, play);
        }
        return;
    }
    if (op == "latency") {
        std::lock_guard<std::mutex> lock(m_);
        const int n = (int)msg["ch"];
        if (n >= 0 && n < kMaxChannels && channels_[(size_t)n] && channels_[(size_t)n]->connId == c.id())
            channels_[(size_t)n]->webLatencyMs = std::clamp((double)msg["ms"], 0.0, 1000.0);
    }
}

void WebHub::handleHello(Connection& c, const juce::var& msg) {
    if ((int)msg["v"] != 1) {
        c.sendText(json(object({{"op", "error"}, {"code", "version"}})));
        c.close(1002);
        return;
    }
    std::shared_ptr<Connection> replaced;
    bool refused = false;
    {
        std::unique_lock<std::mutex> lock(m_);
        const std::string id = msg["id"].toString().toStdString();
        for (auto& [cid, p] : peers_)
            if (p.id == id && cid != c.id()) {
                // The id belongs to the origin that first used it: another page must not close that board's link by claiming its id.
                if (p.conn && p.conn->origin() != c.origin()) {
                    refused = true;
                    break;
                }
                replaced = p.conn;  // the same board came back: the old link is stale
            }
        if (refused) {
            lock.unlock();
            c.sendText(json(object({{"op", "error"}, {"code", "id-in-use"}})));
            c.close(1008);
            return;
        }
        Peer p;
        p.connId = c.id();
        p.conn = c.shared_from_this();
        p.id = id;
        p.name = msg["name"].toString().toStdString();
        p.sampleRate = msg.hasProperty("sampleRate") ? (double)msg["sampleRate"] : 48000.0;
        if (p.sampleRate < 8000.0 || p.sampleRate > 384000.0) p.sampleRate = 48000.0;
        p.low = msg["mode"].toString() == "low";
        p.welcomed = true;
        peers_[c.id()] = p;
    }
    if (replaced) replaced->close(1000);
    std::string leader = "app";
    if (hubMs() - liveMs_.load() < 500.0) leader = "live";
    else if (cb_.leader) leader = cb_.leader();
    c.sendText(json(object({{"op", "welcome"},
                            {"v", 1},
                            {"hub", "Bleep App"},
                            {"sampleRate", sinkRate_},
                            {"block", lastBlock_},
                            {"epoch", (int)epoch_.load()},
                            {"leader", juce::String(leader)}})));
    std::lock_guard<std::mutex> lock(m_);
    Peer* p = peerOf(c.id());
    if (p == nullptr) return;
    for (int k = 0; k < bridge::kMaxBridges; ++k)
        if (slots_[k].attached) addSlotChannels(k, *p);
    sendChannelList(*p);
}

/// A free channel, reset to defaults (entries are reused, never freed: the block thread may hold a pointer). m_ held.
WebHub::Channel* WebHub::allocate() {
    for (int i = 0; i < kMaxChannels; ++i) {
        auto& slot = channels_[(size_t)i];
        if (slot && (slot->active || slot->handle != 0)) continue;
        if (!slot) slot = std::make_unique<Channel>();
        else {
            slot->~Channel();
            new (slot.get()) Channel();
        }
        slot->ch = i;
        return slot.get();
    }
    return nullptr;
}

void WebHub::announce(Channel& c, bool online) {
    if (!c.conn) return;
    // What the way back to Live adds: the buffers of both legs and what Bleep Play declared (§3.2).
    const int latency = c.slot >= 0 && !c.toWeb && c.kind == Kind::Audio
                            ? (int)std::lround((2.0 * c.link.targetMs() + c.webLatencyMs) * 0.001 * sinkRate_)
                            : 0;
    c.conn->sendText(json(object({{"op", "channel"},
                                  {"ch", c.ch},
                                  {"kind", c.kind == Kind::Audio ? "audio" : "midi"},
                                  {"dir", c.toWeb ? "toWeb" : "fromWeb"},
                                  {"key", juce::String(c.key)},
                                  {"name", juce::String(c.name)},
                                  {"port", juce::String(c.port)},
                                  {"source", juce::String(c.source)},
                                  {"online", online},
                                  {"latency", latency},
                                  {"reactive", c.port == "audio-insert"}})));
}

void WebHub::sendChannelList(Peer& p) {
    auto list = juce::Array<juce::var>();
    for (auto& c : channels_)
        if (c && c->active && c->connId == p.connId)
            list.add(object({{"ch", c->ch},
                             {"kind", c->kind == Kind::Audio ? "audio" : "midi"},
                             {"dir", c->toWeb ? "toWeb" : "fromWeb"},
                             {"key", juce::String(c->key)},
                             {"name", juce::String(c->name)},
                             {"port", juce::String(c->port)},
                             {"source", juce::String(c->source)},
                             {"online", true},
                             {"latency", 0},
                             {"reactive", c->port == "audio-insert"}}));
    p.conn->sendText(json(object({{"op", "channels"}, {"list", juce::var(list)}})));
}

void WebHub::handleOpen(Connection& c, const juce::var& msg) {
    std::lock_guard<std::mutex> lock(m_);
    Peer* p = peerOf(c.id());
    if (p == nullptr) return;
    const std::string key = msg["key"].toString().toStdString();
    const std::string name = msg["name"].toString().toStdString();
    const bool audio = msg["kind"].toString() == "audio";
    const juce::String dir = msg["dir"].toString();
    if (key.empty() || (!audio && msg["kind"].toString() != "midi")) return;
    // Already open (the board reconnected): keep it.
    for (auto& ch : channels_)
        if (ch && ch->active && ch->connId == c.id() && ch->slot < 0 && ch->key == key) return;

    // Both directions of a node share the key; a channel is told apart by its kind and direction (§10.3).
    auto make = [&](bool toWeb) -> Channel* {
        Channel* fresh = allocate();
        if (fresh == nullptr) return nullptr;
        Channel& ch = *fresh;
        ch.active = true;
        ch.kind = audio ? Kind::Audio : Kind::Midi;
        ch.toWeb = toWeb;
        ch.key = key;
        ch.name = name;
        ch.port = "remote";
        ch.source = "app";
        ch.connId = c.id();
        ch.conn = p->conn;
        ch.webRate = p->sampleRate;
        ch.lowLatency = p->low;
        if (audio && !toWeb) ch.link.configure(p->sampleRate, sinkRate_, p->low ? 16.0 : 64.0);
        return &ch;
    };
    Channel* from = nullptr;
    Channel* to = nullptr;
    if (dir == "fromWeb" || dir == "both") from = make(false);
    if (dir == "toWeb" || dir == "both") to = make(true);
    if (from && to) {
        from->partner = to->ch;
        to->partner = from->ch;
    }
    // One engine instance per node: the app's board sees "Web: name" with the jacks the directions need.
    auto want = [&](Channel* ch, engine::PortKind kind, const char* role) {
        ch->wantInstance = true;
        ch->instanceKind = kind;
        ch->instanceId = uuidFor(p->id, key, role);
        ch->name = name;
    };
    if (audio) {
        if (from && to) want(from, engine::PortKind::AudioBridge, "bridge");
        else if (from) want(from, engine::PortKind::AudioIn, "in");
        else if (to) want(to, engine::PortKind::AudioOut, "out");
    } else {
        if (from) want(from, engine::PortKind::MidiDevice, "device");
        if (to) want(to, engine::PortKind::MidiOut, "midiout");
    }
    if (from) announce(*from, true);
    if (to) announce(*to, true);
}

void WebHub::handleMidi(Connection& c, const juce::var& msg) {
    const int n = (int)msg["ch"];
    const auto* list = msg["ev"].getArray();
    if (list == nullptr || n < 0 || n >= kMaxChannels) return;
    std::lock_guard<std::mutex> lock(m_);
    Channel* ch = channels_[(size_t)n].get();
    if (ch == nullptr || !ch->active || ch->toWeb || ch->kind != Kind::Midi || ch->connId != c.id()) return;
    if ((uint32_t)(int)msg["epoch"] < epoch_.load() && msg.hasProperty("epoch")) {
        staleEvents_.fetch_add((uint32_t)list->size());
        return;
    }
    for (const auto& e : *list) {
        const auto* a = e.getArray();
        if (a == nullptr || a->size() < 3 || (int)ch->queue.size() >= kMaxQueued) continue;
        MidiEv ev;
        ev.beat = (double)(*a)[0];
        const int status = (int)(*a)[1];
        if (status < 0x80 || status > 0xff) continue;
        ev.bytes[0] = (uint8_t)status;
        ev.bytes[1] = (uint8_t)std::clamp((int)(*a)[2], 0, 127);
        ev.bytes[2] = a->size() > 3 ? (uint8_t)std::clamp((int)(*a)[3], 0, 127) : 0;
        const int hi = status & 0xf0;
        ev.size = (hi == 0xc0 || hi == 0xd0 || status == 0xf1 || status == 0xf3) ? 2 : (status >= 0xf8 ? 1 : 3);
        ch->queue.push_back(ev);
    }
}

void WebHub::onBinary(Connection& c, const uint8_t* d, size_t size) {
    if (size < 16 || d[0] != 1) return;
    const int n = d[1];
    uint16_t frames;
    uint32_t seq;
    std::memcpy(&frames, d + 2, 2);
    std::memcpy(&seq, d + 4, 4);
    if (frames == 0 || frames > 2048 || size != 16 + 8 * (size_t)frames) return;
    std::lock_guard<std::mutex> lock(m_);
    Channel* ch = channels_[(size_t)n].get();
    if (ch == nullptr || !ch->active || ch->toWeb || ch->kind != Kind::Audio || ch->connId != c.id()) return;
    static thread_local std::vector<float> l, r;
    l.resize(frames);
    r.resize(frames);
    std::memcpy(l.data(), d + 16, 4 * (size_t)frames);
    std::memcpy(r.data(), d + 16 + 4 * (size_t)frames, 4 * (size_t)frames);
    ch->link.push(l.data(), r.data(), frames);
    ch->seq = seq;
}

void WebHub::onClose(Connection& c) {
    std::lock_guard<std::mutex> lock(m_);
    dropPeerChannels(c.id());
    peers_.erase(c.id());
}

void WebHub::dropPeerChannels(uint64_t connId) {
    for (auto& ch : channels_)
        if (ch && ch->active && ch->connId == connId) {
            if (ch->handle) removed_.push_back(ch->handle);
            ch->handle = 0;
            ch->active = false;
            ch->wantInstance = false;
            ch->conn.reset();
            ch->queue.clear();
        }
    for (auto& s : slots_) {
        s.channels.erase(std::remove_if(s.channels.begin(), s.channels.end(),
                                        [&](int n) { return !channels_[(size_t)n]->active; }),
                         s.channels.end());
    }
}

}  // namespace bleep::hub
