// SPDX-License-Identifier: MIT
//
// WebSocketServer — the web hub's transport (spec §4, §10.2): one port that serves the board page and
// /health over HTTP and upgrades /ws to a WebSocket. Dependency-free (POSIX/Winsock sockets), because
// audio rides on it and the hub needs exact control over Nagle, queues and shutdown.
//
// Threads: one accept thread, one reader thread per connection (listener callbacks run there, in order
// per connection) and one writer thread per connection. A callback may block; stop() waits for it.
#pragma once

#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace bleep::hub {

struct HttpResponse {
    int status = 200;
    std::string contentType = "text/html; charset=utf-8";
    std::string body;
    std::vector<std::pair<std::string, std::string>> headers;  ///< extra headers (the isolation headers are always added)
};

class WebSocketServer;

/// One open WebSocket. Held by shared_ptr so the hub may keep it after onClose: every send is then a no-op.
class Connection : public std::enable_shared_from_this<Connection> {
public:
    ~Connection();
    Connection(const Connection&) = delete;
    Connection& operator=(const Connection&) = delete;

    uint64_t id() const noexcept { return id_; }
    /// The Origin header of the handshake; empty when the client sent none (non-browser).
    const std::string& origin() const noexcept { return origin_; }

    /// Thread-safe and cheap: frames the message, queues it and returns. Never waits for the network.
    void sendText(std::string text);
    /// As sendText. When the queue is over its byte limit the oldest binary frames are dropped (counted),
    /// text is never dropped: a stale audio packet is worth less than the control message behind it.
    void sendBinary(const void* data, size_t size);
    /// Starts the close handshake (the peer's reply is not awaited by the caller).
    void close(uint16_t code = 1000);

    bool isOpen() const noexcept { return !closing_.load(); }
    uint64_t droppedBinaryFrames() const noexcept { return dropped_.load(); }
    size_t queuedBytes() const;

private:
    friend class WebSocketServer;
    Connection(int fd, uint64_t id, size_t maxQueuedBytes);

    struct Out {
        std::string bytes;  ///< a complete frame
        bool binary = false;
    };
    void enqueue(std::string frame, bool binary);
    void writerLoop();
    bool writeAll(const char* data, size_t size, int stallMs);
    bool fill(int64_t deadlineMs);
    bool readExact(void* dst, size_t size);
    void drainAndClose();

    int fd_;
    const uint64_t id_;
    const size_t maxQueuedBytes_;
    std::string origin_;

    std::string rx_;
    size_t rxPos_ = 0;

    mutable std::mutex mutex_;
    std::condition_variable cv_;
    std::deque<Out> queue_;
    size_t queuedBytes_ = 0;
    std::atomic<bool> closing_{false};  ///< a close frame is queued; nothing more is accepted
    std::atomic<bool> abort_{false};    ///< stop everything now (server stop, I/O error)
    std::atomic<uint64_t> dropped_{0};
    std::thread writer_;
};

class WebSocketServer {
public:
    struct Options {
        int port = 47100;  ///< 0 picks a free port (see boundPort())
        bool localhostOnly = true;  ///< bind 127.0.0.1 only and require a loopback Host header
        /// Decides a browser's Origin at the handshake; may block (the pairing dialog, up to 30 s).
        /// Without it every request that carries an Origin is refused. Requests without one are accepted.
        std::function<bool(const std::string& origin)> allowOrigin;
        /// GET handler for pages. Return false for 404. The server adds Cross-Origin-Opener-Policy,
        /// Cross-Origin-Embedder-Policy and Cross-Origin-Resource-Policy to every HTTP response.
        /// /health and /ws are handled by the server first. Runs on a connection thread.
        std::function<bool(const std::string& path, HttpResponse&)> http;
        size_t maxQueuedBytes = 8u << 20;  ///< per-connection outgoing queue before binary frames are dropped
        size_t maxSessions = 32;           ///< concurrent connections (one thread each); more are answered 503 and closed
        size_t maxSessionsPerOrigin = 8;   ///< concurrent connections that carry the same Origin header
    };

    /// Callbacks run on the connection's reader thread.
    class Listener {
    public:
        virtual ~Listener() = default;
        virtual void onOpen(Connection&) {}
        virtual void onText(Connection&, const std::string&) {}
        virtual void onBinary(Connection&, const uint8_t*, size_t) {}
        virtual void onClose(Connection&) {}  ///< only for connections that got onOpen
    };

    static constexpr size_t kMaxPayload = 4u << 20;
    static constexpr size_t kMaxHeaderBytes = 16u << 10;
    static constexpr int kHandshakeTimeoutMs = 5000;
    static constexpr size_t kReadChunk = 64u << 10;  ///< payload buffers grow by this much as bytes arrive, not by the announced length

    WebSocketServer(Options options, Listener& listener);
    ~WebSocketServer();

    /// Binds and starts accepting. False when the port is taken. Call once.
    bool start();
    /// Closes the listener and every connection and joins all threads. Safe to call twice.
    void stop();
    int boundPort() const noexcept { return boundPort_.load(); }

private:
    struct Session {
        std::shared_ptr<Connection> conn;
        std::thread thread;
        std::shared_ptr<std::atomic<bool>> done;
    };
    void acceptLoop();
    void runSession(std::shared_ptr<Connection> conn);
    void reap(bool all);

    Options options_;
    Listener& listener_;
    int listenFd_ = -1;
    std::atomic<int> boundPort_{0};
    std::atomic<bool> stopping_{false};
    std::atomic<uint64_t> nextId_{1};
    std::thread acceptThread_;
    std::mutex sessionsMutex_;
    std::vector<Session> sessions_;
    std::mutex originsMutex_;
    std::map<std::string, size_t> originCounts_;  ///< live sessions per Origin header
};

}  // namespace bleep::hub
