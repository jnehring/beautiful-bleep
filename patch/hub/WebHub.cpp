// SPDX-License-Identifier: MIT
// WebHub.cpp — the hub's lifetime, HTTP and pairing, sync and status.
#include "WebHubInternal.h"

namespace bleep::hub {

namespace {

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
