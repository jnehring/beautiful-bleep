// SPDX-License-Identifier: MIT
//
// WebSocketServer test (spec §10.2): the handshake and framing rules against a minimal raw-socket
// client with masked frames, written here so the server is checked against the RFC rather than
// against its own reader. Everything runs on loopback with port 0.
#include "Sha1Base64.h"
#include "WebSocketServer.h"
#include "WsTestClient.h"

#include <juce_core/juce_core.h>

#include <chrono>
#include <cstdio>
#include <cstring>
#include <memory>
#include <thread>

using namespace bleep::hub;

static int g_failures = 0;
#define EXPECT(cond)                                                      \
    do {                                                                  \
        if (!(cond)) {                                                    \
            std::printf("FAILED %s:%d: %s\n", __FILE__, __LINE__, #cond); \
            ++g_failures;                                                 \
        }                                                                 \
    } while (0)

namespace {

using namespace bleep::hub::test;

class Echo : public WebSocketServer::Listener {
public:
    void onOpen(Connection& c) override {
        std::lock_guard<std::mutex> lock(m);
        ++opens;
        last = c.shared_from_this();
        origins.push_back(c.origin());
    }
    void onText(Connection& c, const std::string& s) override { c.sendText(s); }
    void onBinary(Connection& c, const uint8_t* d, size_t n) override { c.sendBinary(d, n); }
    void onClose(Connection&) override { ++closes; }

    std::shared_ptr<Connection> connection() {
        std::lock_guard<std::mutex> lock(m);
        return last;
    }
    std::mutex m;
    std::shared_ptr<Connection> last;
    std::vector<std::string> origins;
    std::atomic<int> opens{0}, closes{0};
};

bool waitFor(const std::function<bool()>& pred, int ms = 3000) {
    const int64_t end = nowMs() + ms;
    while (nowMs() < end) {
        if (pred()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    return pred();
}

bool contains(const std::string& head, const std::string& needle) {
    return juce::String(head).containsIgnoreCase(needle);
}

}  // namespace

int main() {
    // RFC 6455 §1.3.
    EXPECT(websocketAcceptKey("dGhlIHNhbXBsZSBub25jZQ==") == "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    {
        const auto d = sha1("abc", 3);
        EXPECT(base64(d.data(), d.size()) == "qZk+NkcGgWq6PiVxeFDCbJzQ2J0=");
        EXPECT(base64("", 0).empty() && base64("fo", 2) == "Zm8=" && base64("foobar", 6) == "Zm9vYmFy");
    }

    Echo echo;
    WebSocketServer::Options opt;
    opt.port = 0;
    std::atomic<int> slowCalls{0};
    opt.allowOrigin = [&](const std::string& o) {
        if (o == "http://slow.example") {
            ++slowCalls;
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
            return true;
        }
        return o == "http://ok.example" || o == "http://127.0.0.1";
    };
    opt.http = [](const std::string& path, HttpResponse& r) {
        if (path != "/") return false;
        r.body = "<html>board</html>";
        return true;
    };
    opt.maxQueuedBytes = 4u << 20;
    auto server = std::make_unique<WebSocketServer>(opt, echo);
    EXPECT(server->start());
    const int port = server->boundPort();
    EXPECT(port > 0);
    {
        WebSocketServer::Options o2 = opt;
        o2.port = port;
        Echo e2;
        WebSocketServer second(o2, e2);
        EXPECT(!second.start());
    }

    // Handshake, text echo, ping/pong.
    {
        Client c;
        EXPECT(c.connect(port));
        EXPECT(c.handshake("", port) == 101);
        c.sendFrame(1, "hello");
        Frame f;
        EXPECT(c.readFrame(f) && f.op == 1 && f.payload == "hello");
        c.sendFrame(9, "p");
        EXPECT(c.readFrame(f) && f.op == 10 && f.payload == "p");
        std::string utf = "gr\xC3\xBC\xC3\x9F" "e";
        c.sendFrame(1, utf);
        EXPECT(c.readFrame(f) && f.payload == utf);
        c.sendFrame(8, std::string("\x03\xE8", 2));
        EXPECT(c.expectClose(1000));
        EXPECT(c.waitEof(2000));
        EXPECT(waitFor([&] { return echo.closes.load() == 1; }));
    }

    // Binary: 16-byte audio header + 1 KiB, and 600 KiB (the 127 length form).
    for (size_t size : {16u + 1024u, 600u * 1024u}) {
        Client c;
        EXPECT(c.connect(port) && c.handshake("", port) == 101);
        std::string p(size, '\0');
        for (size_t i = 0; i < p.size(); ++i) p[i] = (char)(i * 31 + 7);
        p[0] = 1;
        c.sendFrame(2, p);
        Frame f;
        EXPECT(c.readFrame(f, 10000) && f.op == 2 && f.payload == p);
    }

    // 126 length form at the boundary.
    {
        Client c;
        EXPECT(c.connect(port) && c.handshake("", port) == 101);
        for (size_t n : {125u, 126u, 65535u, 65536u}) {
            const std::string p(n, 'x');
            c.sendFrame(1, p);
            Frame f;
            EXPECT(c.readFrame(f) && f.payload == p);
        }
    }

    // Fragmentation, with a ping between the fragments.
    {
        Client c;
        EXPECT(c.connect(port) && c.handshake("", port) == 101);
        c.sendFrame(1, "frag", false);
        c.sendFrame(9, "mid");
        c.sendFrame(0, "men", false);
        c.sendFrame(0, "ts", true);
        Frame f;
        EXPECT(c.readFrame(f) && f.op == 10 && f.payload == "mid");
        EXPECT(c.readFrame(f) && f.op == 1 && f.payload == "fragments");
        c.sendFrame(0, "stray");  // continuation without a message
        EXPECT(c.expectClose(1002));
    }

    // Origin: denied -> 403, allowed, absent, and a blocking callback.
    {
        Client c;
        EXPECT(c.connect(port));
        EXPECT(c.handshake("http://evil.example", port) == 403);
    }
    {
        Client c;
        EXPECT(c.connect(port) && c.handshake("http://ok.example", port) == 101);
        EXPECT(waitFor([&] { return echo.connection() && echo.connection()->origin() == "http://ok.example"; }));
    }
    {
        Client c;
        EXPECT(c.connect(port));
        const int64_t t0 = nowMs();
        EXPECT(c.handshake("http://slow.example", port) == 101);
        EXPECT(nowMs() - t0 >= 190);
        EXPECT(slowCalls == 1);
        c.sendFrame(1, "after");
        Frame f;
        EXPECT(c.readFrame(f) && f.payload == "after");
    }

    // Handshake rejects: wrong path, missing key, wrong Host.
    {
        Client c;
        EXPECT(c.connect(port) && c.handshake("", port, "/nope") == 404);
    }
    {
        Client c;
        EXPECT(c.connect(port));
        c.sendRaw("GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
        std::string head;
        EXPECT(c.readHead(head, 3000) == 400);
    }
    {
        Client c;
        EXPECT(c.connect(port));
        c.sendRaw("GET /health HTTP/1.1\r\nHost: evil.example\r\n\r\n");
        std::string head;
        EXPECT(c.readHead(head, 3000) == 403);
    }

    // HTTP: /health, a page from the callback, 404, with the isolation headers on all of them.
    {
        const std::string host = "127.0.0.1:" + std::to_string(port);
        for (const char* path : {"/health", "/", "/nope"}) {
            Client c;
            EXPECT(c.connect(port));
            c.sendRaw(std::string("GET ") + path + " HTTP/1.1\r\nHost: " + host + "\r\n\r\n");
            const std::string all = c.readToEnd(3000);
            const std::string p = path;
            EXPECT(all.compare(0, 9, "HTTP/1.1 ") == 0);
            EXPECT(contains(all, "Cross-Origin-Opener-Policy: same-origin\r\n"));
            EXPECT(contains(all, "Cross-Origin-Embedder-Policy: require-corp\r\n"));
            EXPECT(contains(all, "Cross-Origin-Resource-Policy: same-origin\r\n"));
            if (p == "/health") EXPECT(all.find("200 OK") != std::string::npos && all.find("{\"app\":\"bleep-app\",\"protocol\":1}") != std::string::npos);
            if (p == "/") EXPECT(all.find("200 OK") != std::string::npos && all.find("<html>board</html>") != std::string::npos);
            if (p == "/nope") EXPECT(all.find("404") != std::string::npos);
        }
    }

    // Protocol violations.
    {
        Client c;
        EXPECT(c.connect(port) && c.handshake("", port) == 101);
        c.sendFrame(1, "unmasked", true, false);
        EXPECT(c.expectClose(1002));
        EXPECT(c.waitEof(2000));
    }
    {
        Client c;
        EXPECT(c.connect(port) && c.handshake("", port) == 101);
        c.sendHeaderOnly(2, 5u << 20);
        EXPECT(c.expectClose(1009));
        EXPECT(c.waitEof(2000));
    }
    {
        Client c;  // exactly the limit is accepted: a sequence of 4 x 1 MiB fragments
        EXPECT(c.connect(port) && c.handshake("", port) == 101);
        const std::string mib(1u << 20, 'a');
        for (int i = 0; i < 4; ++i) c.sendFrame(i == 0 ? 2 : 0, mib, i == 3);
        Frame f;
        EXPECT(c.readFrame(f, 10000) && f.op == 2 && f.payload.size() == (4u << 20));
        c.sendFrame(2, mib, false);
        c.sendFrame(0, std::string(4u << 20, 'b'), true);  // the message grows past 4 MiB
        EXPECT(c.expectClose(1009));
    }
    {
        Client c;
        EXPECT(c.connect(port) && c.handshake("", port) == 101);
        c.sendFrame(1, "\xFF\xFE");
        EXPECT(c.expectClose(1007));
    }

    // A slow reader: sendBinary stays cheap and old binary frames are dropped; text is not.
    {
        Client c;
        EXPECT(c.connect(port) && c.handshake("", port) == 101);
        EXPECT(waitFor([&] { return echo.connection() && echo.opens.load() > 0; }));
        auto conn = echo.connection();
        EXPECT(conn != nullptr);
        constexpr int kFrames = 3000;
        std::string payload(64 * 1024, 'z');
        int64_t worst = 0;
        std::thread producer([&] {
            for (uint32_t seq = 0; seq < kFrames; ++seq) {
                std::memcpy(&payload[0], &seq, 4);
                const int64_t t0 = nowMs();
                conn->sendBinary(payload.data(), payload.size());
                worst = std::max(worst, nowMs() - t0);
                if (seq == 10) conn->sendText("keep-me");
            }
        });
        producer.join();
        std::printf("slow reader: worst sendBinary %lld ms, dropped %llu, queued %zu\n", (long long)worst,
                    (unsigned long long)conn->droppedBinaryFrames(), conn->queuedBytes());
        EXPECT(worst < 50);
        EXPECT(conn->droppedBinaryFrames() > 0);
        EXPECT(conn->queuedBytes() <= 4u << 20);

        int got = 0;
        uint32_t lastSeq = 0;
        bool ordered = true, text = false;
        Frame f;
        while (c.readFrame(f, 700)) {
            if (f.op == 1) text = f.payload == "keep-me";
            if (f.op != 2) continue;
            uint32_t seq;
            std::memcpy(&seq, f.payload.data(), 4);
            if (got++ > 0 && seq <= lastSeq) ordered = false;
            lastSeq = seq;
        }
        std::printf("slow reader: received %d of %d, last seq %u\n", got, kFrames, lastSeq);
        EXPECT(ordered && text);
        EXPECT(got > 0 && got < kFrames);
        EXPECT(lastSeq == kFrames - 1);  // the newest frames survive
    }

    // Server-initiated close, and sends after close are harmless.
    {
        Client c;
        EXPECT(c.connect(port) && c.handshake("", port) == 101);
        std::this_thread::sleep_for(std::chrono::milliseconds(50));  // let onOpen run
        auto conn = echo.connection();
        conn->close(1001);
        EXPECT(c.expectClose(1001));
        c.sendFrame(8, std::string("\x03\xE9", 2));
        EXPECT(c.waitEof(2000));
        conn->sendText("late");
        conn->sendBinary("x", 1);
        EXPECT(!conn->isOpen());
    }

    // stop() with 20 open connections, a half-open one and a stalled handshake.
    {
        std::vector<std::unique_ptr<Client>> clients;
        for (int i = 0; i < 20; ++i) {
            clients.push_back(std::make_unique<Client>());
            EXPECT(clients.back()->connect(port) && clients.back()->handshake("", port) == 101);
        }
        Client silent, partial;
        EXPECT(silent.connect(port));
        EXPECT(partial.connect(port));
        partial.sendRaw("GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgr");
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        const int64_t t0 = nowMs();
        server->stop();
        const int64_t took = nowMs() - t0;
        std::printf("stop() with 22 connections: %lld ms\n", (long long)took);
        EXPECT(took < 2000);
        EXPECT(server->boundPort() == 0);
        EXPECT(echo.closes.load() == echo.opens.load());
        for (auto& c : clients) EXPECT(c->waitEof(1000));
        server->stop();  // twice is fine
        Client again;
        EXPECT(!again.connect(port));
        EXPECT(server->start());  // and it restarts
        EXPECT(server->boundPort() > 0);
        server.reset();
    }

    std::printf(g_failures ? "%d failure(s)\n" : "websocket test passed\n", g_failures);
    return g_failures ? 1 : 0;
}
