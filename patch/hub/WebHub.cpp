// SPDX-License-Identifier: MIT
#include "WebHub.h"

#include "Sha1Base64.h"
#include "../common/SafeJson.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <thread>

namespace bleep::hub {

using bridge::Midi;

namespace {

constexpr int kMaxChannels = 256;
constexpr int kMaxQueued = 4096;
constexpr double kJumpBeats = 0.05;

juce::var object(std::initializer_list<std::pair<const char*, juce::var>> props) {
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}

std::string json(const juce::var& v) { return juce::JSON::toString(v, true).toStdString(); }

const char* mimeOf(const std::string& path) {
    const auto dot = path.rfind('.');
    const std::string ext = dot == std::string::npos ? "" : path.substr(dot + 1);
    if (ext == "html") return "text/html; charset=utf-8";
    if (ext == "js" || ext == "mjs") return "text/javascript; charset=utf-8";
    if (ext == "css") return "text/css; charset=utf-8";
    if (ext == "json") return "application/json";
    if (ext == "wasm") return "application/wasm";
    if (ext == "svg") return "image/svg+xml";
    if (ext == "png") return "image/png";
    if (ext == "md") return "text/markdown; charset=utf-8";
    return "application/octet-stream";
}

const char kFallbackPage[] =
    "<!doctype html><meta charset=utf-8><title>Bleep App</title>"
    "<body style=\"font:15px system-ui;max-width:42em;margin:3em auto;padding:0 1em;background:#15171c;color:#e7e9ee\">"
    "<h1>Bleep App is running</h1><p>The web link is on. This app has no board page to serve yet: set "
    "<code>BLEEP_WEB_ROOT</code> to the folder that <code>scripts/build/build-web.sh</code> wrote, or open the board "
    "on the website and press <b>Connect to app</b>.</p><p><a style=\"color:#ff9f43\" href=\"/health\">/health</a></p>";

}  // namespace

WebHub::WebHub(engine::Engine& engine, Callbacks callbacks)
    : juce::Thread("Bleep Web Hub"), engine_(engine), cb_(std::move(callbacks)) {
    channels_.resize(kMaxChannels);
}

WebHub::~WebHub() { stop(); }

namespace {
engine::Transport toEngine(const bridge::Transport& t) {
    engine::Transport e;
    e.sampleRate = t.sampleRate;
    e.bpm = t.bpm;
    e.ppq = t.ppq;
    e.ppqValid = t.ppqValid != 0;
    e.playing = t.playing != 0;
    e.samplePos = t.samplePos;
    return e;
}
}  // namespace

/// The audio device's thread must never wait for another thread, but the tables behind m_ are only held for a few
/// microseconds (a packet pushed, a message parsed): trying for a moment nearly always gets the lock, where a single
/// try loses the block (and with it MIDI, whose note-off would then never arrive).
static bool lockBriefly(std::unique_lock<std::mutex>& lock) noexcept {
    for (int i = 0; i < 4000; ++i)
        if (lock.try_lock()) return true;
    return false;
}

double WebHub::hubMs() const noexcept { return juce::Time::getMillisecondCounterHiRes(); }

int WebHub::port() const noexcept { return server_ ? server_->boundPort() : 0; }

bool WebHub::start(int port, const std::string& webRoot) {
    if (server_) return true;
    webRoot_ = webRoot;
    WebSocketServer::Options o;
    o.port = port;
    o.allowOrigin = [this](const std::string& origin) { return allowOrigin(origin); };
    o.http = [this](const std::string& path, HttpResponse& out) { return serve(path, out); };
    auto s = std::make_unique<WebSocketServer>(o, *this);
    if (!s->start()) return false;
    boundPort_ = s->boundPort();
    server_ = std::move(s);
    startThread();
    return true;
}

void WebHub::stop() {
    signalThreadShouldExit();
    stopThread(2000);
    if (server_) {
        server_->stop();
        server_.reset();
    }
    std::lock_guard<std::mutex> lock(m_);
    peers_.clear();
    for (auto& c : channels_)
        if (c) {
            if (c->handle) removed_.push_back(c->handle);
            c->handle = 0;
            c->active = false;
            c->conn.reset();
        }
}

// ---- HTTP and pairing --------------------------------------------------------------------------------

bool WebHub::allowOrigin(const std::string& origin) {
    const std::string self = "http://127.0.0.1:" + std::to_string(boundPort_);
    const std::string selfName = "http://localhost:" + std::to_string(boundPort_);
    if (origin == self || origin == selfName) return true;
    if (cb_.allowedOrigins && cb_.allowedOrigins().count(origin) != 0) return true;
    if (!cb_.askPairing) return false;
    {
        std::lock_guard<std::mutex> lock(pairMutex_);
        const double now = hubMs();
        for (auto it = denied_.begin(); it != denied_.end();) it = it->second <= now ? denied_.erase(it) : std::next(it);
        if (denied_.count(origin) != 0) return false;  // said no recently
        if (pairingPending_) return false;             // a question is already on screen: no pile of dialogs
        pairingPending_ = true;
    }
    const bool allowed = cb_.askPairing(origin);
    {
        std::lock_guard<std::mutex> lock(pairMutex_);
        pairingPending_ = false;
        if (!allowed) {
            if (denied_.size() >= 256) denied_.clear();
            denied_[origin] = hubMs() + cb_.pairingDenyMs;
        }
    }
    if (!allowed) return false;
    if (cb_.rememberOrigin) cb_.rememberOrigin(origin);
    return true;
}

bool WebHub::serve(const std::string& rawPath, HttpResponse& out) {
    std::string path = rawPath.substr(0, rawPath.find('?'));
    if (path == "/health") {
        out.contentType = "application/json";
        out.body = "{\"app\":\"bleep-app\",\"protocol\":1}";
        out.headers.emplace_back("Access-Control-Allow-Origin", "*");
        return true;
    }
    if (path == "/status") {  // for tests and the curious: who is connected, with how many channels (no CORS header: pages can't read it)
        out.contentType = "application/json";
        out.body = json(status());
        return true;
    }
    if (path.find("..") != std::string::npos || path.find('\\') != std::string::npos) return false;
    if (path.empty() || path.back() == '/') path += "index.html";
    if (!webRoot_.empty()) {
        const juce::File file = juce::File(webRoot_).getChildFile(juce::String(path).trimCharactersAtStart("/"));
        if (file.existsAsFile() && file.isAChildOf(juce::File(webRoot_))) {
            juce::MemoryBlock bytes;
            if (file.loadFileAsData(bytes)) {
                out.contentType = mimeOf(path);
                out.body.assign(static_cast<const char*>(bytes.getData()), bytes.getSize());
                return true;
            }
        }
    }
    if (path == "/index.html") {
        out.body = kFallbackPage;
        return true;
    }
    return false;
}

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

// ---- Live slots (SlotRelay) --------------------------------------------------------------------------------

void WebHub::addSlotChannels(int slot, Peer& p) {
    SlotInfo& s = slots_[slot];
    using engine::PortKind;
    const auto kind = (PortKind)s.kind;
    const bool audioTo = kind == PortKind::AudioIn || kind == PortKind::AudioInsert || kind == PortKind::AudioBridge;
    const bool audioFrom = kind == PortKind::AudioOut || kind == PortKind::Instrument || kind == PortKind::AudioInsert ||
                           kind == PortKind::AudioBridge;
    const bool midiTo = kind == PortKind::MidiIn || kind == PortKind::Instrument;
    const bool midiFrom = kind == PortKind::MidiOut;
    const char* port = kind == PortKind::AudioIn ? "audio-in"
                       : kind == PortKind::AudioOut ? "audio-out"
                       : kind == PortKind::MidiIn ? "midi-in"
                       : kind == PortKind::MidiOut ? "midi-out"
                       : kind == PortKind::Instrument ? "instrument" : "audio-insert";
    // All channels of a plugin share its ID as their key; kind and direction tell them apart (§10.3).
    auto add = [&](Kind k, bool toWeb) {
        // The channel already exists for this peer (a rename, or the peer came back): update it.
        for (int n : s.channels) {
            Channel& e = *channels_[(size_t)n];
            if (e.active && e.connId == p.connId && e.kind == k && e.toWeb == toWeb) {
                e.name = "Live: " + s.track;
                announce(e, true);
                return;
            }
        }
        Channel* fresh = allocate();
        if (fresh == nullptr) return;
        Channel& ch = *fresh;
        const int n = ch.ch;
        ch.active = true;
        ch.kind = k;
        ch.toWeb = toWeb;
        ch.key = s.id;
        ch.name = "Live: " + s.track;
        ch.port = port;
        ch.source = "live";
        ch.connId = p.connId;
        ch.conn = p.conn;
        ch.slot = slot;
        ch.webRate = p.sampleRate;
        ch.lowLatency = p.low;
        if (k == Kind::Audio && !toWeb) ch.link.configure(p.sampleRate, s.sampleRate, p.low ? 16.0 : 64.0);
        s.channels.push_back(n);
        announce(ch, true);
    };
    if (audioTo) add(Kind::Audio, true);
    if (midiTo) add(Kind::Midi, true);
    if (audioFrom) add(Kind::Audio, false);
    if (midiFrom) add(Kind::Midi, false);
}

void WebHub::slotAttached(int slot, uint32_t portKind, const std::string& id, const std::string& track, double sampleRate) {
    std::lock_guard<std::mutex> lock(m_);
    SlotInfo& s = slots_[slot];
    if (s.attached && (s.kind != portKind || s.id != id)) {
        for (int n : s.channels) {
            Channel& ch = *channels_[(size_t)n];
            if (ch.conn) ch.conn->sendText(json(object({{"op", "channel-gone"}, {"ch", ch.ch}})));
            ch.active = false;
        }
        s.channels.clear();
    }
    s.attached = true;
    s.kind = portKind;
    s.id = id;
    s.track = track;
    s.sampleRate = sampleRate;
    sinkRate_ = sampleRate;
    for (auto& [cid, p] : peers_) addSlotChannels(slot, p);
}

void WebHub::slotDetached(int slot, const std::string&) {
    std::lock_guard<std::mutex> lock(m_);
    SlotInfo& s = slots_[slot];
    for (int n : s.channels) {
        Channel& ch = *channels_[(size_t)n];
        if (ch.conn) ch.conn->sendText(json(object({{"op", "channel-gone"}, {"ch", ch.ch}})));
        ch.active = false;
        ch.conn.reset();
        ch.queue.clear();
    }
    s = SlotInfo{};
}

int WebHub::slotLatency(int slot) noexcept {
    std::lock_guard<std::mutex> lock(m_);
    const SlotInfo& s = slots_[slot];
    double frames = 0.0;
    for (int n : s.channels) {
        const Channel& ch = *channels_[(size_t)n];
        if (!ch.active || ch.kind != Kind::Audio || ch.toWeb) continue;
        // The way back to Live is this channel's buffer; the way out was a buffer of the same size on the web
        // side; Bleep Play adds what it declared (§3.2: the round trip is reported by the returning port).
        frames = std::max(frames, (2.0 * ch.link.targetMs() + ch.webLatencyMs) * 0.001 * s.sampleRate);
    }
    return (int)std::lround(frames);
}

void WebHub::sendAudio(Channel& ch, const float* l, const float* r, int n, double) {
    if (!ch.conn || !ch.conn->isOpen()) return;
    std::string pkt((size_t)(16 + 8 * n), '\0');
    char* p = pkt.data();
    p[0] = 1;
    p[1] = (char)ch.ch;
    const uint16_t frames = (uint16_t)n;
    std::memcpy(p + 2, &frames, 2);
    std::memcpy(p + 4, &ch.seq, 4);
    ++ch.seq;
    std::memcpy(p + 8, &ch.sampleTime, 8);
    ch.sampleTime += n;
    std::memcpy(p + 16, l, 4 * (size_t)n);
    std::memcpy(p + 16 + 4 * (size_t)n, r, 4 * (size_t)n);
    ch.conn->sendBinary(pkt.data(), pkt.size());
}

void WebHub::sendMidi(Channel& ch, const Midi* ev, int count, const engine::Transport& t, int numSamples) {
    if (count <= 0 || !ch.conn || !ch.conn->isOpen()) return;
    std::string out;
    out.reserve(96 + (size_t)count * 28);
    char buf[96];
    std::snprintf(buf, sizeof buf, "{\"op\":\"midi\",\"ch\":%d,\"epoch\":%u,\"t\":%.3f,\"ev\":[", ch.ch, epoch_.load(), hubMs());
    out += buf;
    const double sr = t.sampleRate > 0.0 ? t.sampleRate : 48000.0;
    (void)numSamples;
    for (int i = 0; i < count; ++i) {
        const double beat = t.ppqValid ? t.ppq + (double)ev[i].offset * t.bpm / (60.0 * sr) : -1.0;
        std::snprintf(buf, sizeof buf, "%s[%.6f,%d,%d,%d]", i ? "," : "", beat, ev[i].bytes[0],
                      ev[i].size > 1 ? ev[i].bytes[1] : 0, ev[i].size > 2 ? ev[i].bytes[2] : 0);
        out += buf;
    }
    out += "]}";
    ch.conn->sendText(std::move(out));
}

/// Takes the events of a fromWeb MIDI channel that fall into this block. Beat-stamped events wait for their beat
/// (they were sent ahead); events stamped -1 play at once. [real time: the caller holds m_]
int WebHub::pullDue(Channel& ch, const engine::Transport& t, int n, Midi* out, int capacity) {
    int count = 0;
    const double sr = t.sampleRate > 0.0 ? t.sampleRate : 48000.0;
    const double perSample = t.bpm / (60.0 * sr);
    const bool timed = t.ppqValid && t.playing && perSample > 0.0;
    size_t keep = 0;
    for (size_t i = 0; i < ch.queue.size(); ++i) {
        const MidiEv& e = ch.queue[i];
        int offset = -1;
        if (e.beat < 0.0) {
            offset = 0;
        } else if (timed) {
            const double at = (e.beat - t.ppq) / perSample;
            if (at >= (double)n) {
                ch.queue[keep++] = e;  // not yet
                continue;
            }
            if (at < 0.0) lateEvents_.fetch_add(1, std::memory_order_relaxed);
            offset = std::max(0, (int)std::lround(at));
        } else {
            continue;  // stamped for a transport that isn't running: stale
        }
        if (count < capacity) {
            Midi& m = out[count++];
            m.offset = std::min(offset, n - 1);
            std::memcpy(m.bytes, e.bytes, 3);
            m.size = e.size;
        }
    }
    ch.queue.resize(keep);
    std::stable_sort(out, out + count, [](const Midi& a, const Midi& b) { return a.offset < b.offset; });
    return count;
}

void WebHub::slotBlock(int slot, Block& b) noexcept {
    const engine::Transport et = toEngine(b.transport);
    observe(et, b.numSamples, true);
    std::unique_lock<std::mutex> lock(m_);  // the bridge thread is the app's own, not Live's: it may wait the few µs
    SlotInfo& s = slots_[slot];
    lastBlock_ = b.numSamples;
    float tmpL[bridge::kMaxBlock], tmpR[bridge::kMaxBlock];
    for (int idx : s.channels) {
        Channel& ch = *channels_[(size_t)idx];
        if (!ch.active) continue;
        if (ch.toWeb) {
            if (ch.kind == Kind::Audio && b.in[0]) sendAudio(ch, b.in[0], b.in[1], b.numSamples, s.sampleRate);
            else if (ch.kind == Kind::Midi) sendMidi(ch, b.midiIn, b.numMidiIn, et, b.numSamples);
        } else if (ch.kind == Kind::Audio) {
            if (ch.link.pull(tmpL, tmpR, b.numSamples))
                for (int i = 0; i < b.numSamples; ++i) {
                    b.ret[0][i] += tmpL[i];
                    b.ret[1][i] += tmpR[i];
                }
        } else {
            // The bridge returns this block two blocks later: events are placed against the beat the plugin will be
            // at when it plays them, so a beat-stamped note sounds on its beat (§3.2, predictable sources).
            engine::Transport later = et;
            if (later.ppqValid) later.ppq += 2.0 * b.numSamples * later.bpm / (60.0 * (later.sampleRate > 0.0 ? later.sampleRate : 48000.0));
            b.numMidiOut += pullDue(ch, later, b.numSamples, b.midiOut + b.numMidiOut, bridge::kMaxMidi - b.numMidiOut);
        }
    }
}

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

// ---- sync ---------------------------------------------------------------------------------------------------------

void WebHub::observe(const engine::Transport& t, int n, bool fromLive) noexcept {
    if (fromLive) liveMs_.store(hubMs());
    juce::SpinLock::ScopedTryLockType lock(syncLock_);
    if (!lock.isLocked()) return;
    if (haveTransport_ && t.ppqValid && std::fabs(t.ppq - prevPpq_) < 1e-12 && t.playing == prevPlaying_) {
        transport_ = t;  // the same block seen again (every port reports it)
        return;
    }
    if (haveTransport_) {
        bool jump = t.playing != prevPlaying_ || std::fabs(t.bpm - prevBpm_) > 0.01;
        if (!jump && t.playing && t.ppqValid && prevPpq_ >= 0.0) {
            const double expected = prevPpq_ + (double)prevBlock_ * prevBpm_ / (60.0 * (t.sampleRate > 0.0 ? t.sampleRate : 48000.0));
            jump = std::fabs(t.ppq - expected) > kJumpBeats;
        }
        if (jump) epoch_.fetch_add(1);
    }
    transport_ = t;
    haveTransport_ = true;
    prevBpm_ = t.bpm;
    prevPpq_ = t.ppqValid ? t.ppq : -1.0;
    prevBlock_ = n;
    prevPlaying_ = t.playing;
}

void WebHub::run() {
    double lastSync = 0.0;
    while (!threadShouldExit()) {
        wait(10);
        const double now = hubMs();
        const uint32_t e = epoch_.load();
        const bool changed = e != sentEpoch_.load();
        if (!changed && now - lastSync < 50.0) continue;
        engine::Transport t;
        bool have;
        {
            const juce::SpinLock::ScopedLockType lock(syncLock_);
            t = transport_;
            have = haveTransport_;
        }
        if (!have) continue;
        std::string leader = "app";
        if (now - liveMs_.load() < 500.0) leader = "live";
        else if (cb_.leader) leader = cb_.leader();
        char buf[256];
        std::snprintf(buf, sizeof buf,
                      "{\"op\":\"sync\",\"epoch\":%u,\"tempo\":%.4f,\"beat\":%.6f,\"playing\":%s,\"quantum\":4,\"leader\":\"%s\",\"hub\":%.3f}",
                      e, t.bpm, t.ppqValid ? t.ppq : 0.0, t.playing ? "true" : "false", leader.c_str(), now);
        std::vector<std::shared_ptr<Connection>> conns;
        {
            std::lock_guard<std::mutex> lock(m_);
            for (auto& [id, p] : peers_) conns.push_back(p.conn);
        }
        if (changed) {
            sentEpoch_.store(e);
            const std::string flush = "{\"op\":\"flush\",\"epoch\":" + std::to_string(e) + "}";
            for (auto& c : conns) c->sendText(flush);
        }
        for (auto& c : conns) c->sendText(buf);
        lastSync = now;
    }
}

// ---- status ---------------------------------------------------------------------------------------------------------

int WebHub::numPeers() const {
    std::lock_guard<std::mutex> lock(m_);
    return (int)peers_.size();
}

juce::var WebHub::status() const {
    std::lock_guard<std::mutex> lock(m_);
    juce::Array<juce::var> peers;
    for (const auto& [id, p] : peers_) {
        int channels = 0;
        for (const auto& c : channels_)
            if (c && c->active && c->connId == id) ++channels;
        peers.add(object({{"id", juce::String(p.id)}, {"name", juce::String(p.name)}, {"mode", p.low ? "low" : "safe"},
                          {"channels", channels}}));
    }
    juce::Array<juce::var> channels;
    for (const auto& c : channels_)
        if (c && c->active)
            channels.add(object({{"ch", c->ch}, {"key", juce::String(c->key)}, {"kind", c->kind == Kind::Audio ? "audio" : "midi"},
                                 {"dir", c->toWeb ? "toWeb" : "fromWeb"}, {"source", juce::String(c->source)},
                                 {"fillMs", c->kind == Kind::Audio && !c->toWeb ? c->link.fill() / std::max(1.0, c->webRate) * 1000.0 : 0.0},
                                 {"underruns", (int)c->link.underruns()}, {"overruns", (int)c->link.overruns()},
                                 {"packets", (int)c->seq}, {"queued", (int)c->queue.size()}}));
    return object({{"running", server_ != nullptr},
                   {"port", boundPort_},
                   {"peers", juce::var(peers)},
                   {"channels", juce::var(channels)},
                   {"lateEvents", (int)lateEvents_.load()},
                   {"staleEvents", (int)staleEvents_.load()}});
}

}  // namespace bleep::hub
