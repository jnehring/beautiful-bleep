// SPDX-License-Identifier: MIT
#include "WebSocketServer.h"

#include "Sha1Base64.h"

#include <algorithm>
#include <chrono>
#include <cstring>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
using socklen_t = int;
#define BLEEP_CLOSESOCKET closesocket
#define BLEEP_POLL WSAPoll
#define BLEEP_SHUT_WR SD_SEND
#define BLEEP_SEND_FLAGS 0
#else
#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#define BLEEP_CLOSESOCKET ::close
#define BLEEP_POLL ::poll
#define BLEEP_SHUT_WR SHUT_WR
#ifdef MSG_NOSIGNAL
#define BLEEP_SEND_FLAGS MSG_NOSIGNAL
#else
#define BLEEP_SEND_FLAGS 0  // macOS: SO_NOSIGPIPE is set per socket
#endif
#endif

namespace bleep::hub {

namespace {

constexpr int kTickMs = 100;           ///< how often blocked loops look at the abort flag
constexpr int kWriteStallMs = 15000;   ///< a peer that accepts nothing for this long is dropped
constexpr int kDrainMs = 500;          ///< wait for the peer's FIN after our close, so an RST can't eat the close frame

int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

void setNonBlocking(int fd) {
#ifdef _WIN32
    u_long on = 1;
    ioctlsocket((SOCKET)fd, FIONBIO, &on);
#else
    fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK);
#endif
}

void shutdownWrite(int fd) { ::shutdown(fd, BLEEP_SHUT_WR); }

const char* statusText(int s) {
    switch (s) {
        case 200: return "OK";
        case 400: return "Bad Request";
        case 403: return "Forbidden";
        case 404: return "Not Found";
        case 405: return "Method Not Allowed";
        case 426: return "Upgrade Required";
        case 503: return "Service Unavailable";
        case 431: return "Request Header Fields Too Large";
        case 408: return "Request Timeout";
        default: return "Error";
    }
}

std::string lower(std::string s) {
    for (auto& c : s) c = (char)std::tolower((unsigned char)c);
    return s;
}

std::string trim(const std::string& s) {
    size_t a = 0, b = s.size();
    while (a < b && (s[a] == ' ' || s[a] == '\t')) ++a;
    while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t')) --b;
    return s.substr(a, b - a);
}

struct Request {
    std::string method, target, path;
    std::vector<std::pair<std::string, std::string>> headers;  ///< names lower-case
    const std::string* find(const char* name) const {
        for (auto it = headers.rbegin(); it != headers.rend(); ++it)
            if (it->first == name) return &it->second;
        return nullptr;
    }
};

bool parseRequest(const std::string& head, Request& r) {
    size_t eol = head.find("\r\n");
    if (eol == std::string::npos) return false;
    const std::string line = head.substr(0, eol);
    const size_t s1 = line.find(' '), s2 = line.rfind(' ');
    if (s1 == std::string::npos || s2 == s1) return false;
    r.method = line.substr(0, s1);
    r.target = line.substr(s1 + 1, s2 - s1 - 1);
    if (line.compare(s2 + 1, 5, "HTTP/") != 0) return false;
    r.path = r.target.substr(0, r.target.find_first_of("?#"));
    size_t pos = eol + 2;
    while (pos < head.size()) {
        eol = head.find("\r\n", pos);
        if (eol == std::string::npos) eol = head.size();
        if (eol == pos) break;
        const std::string h = head.substr(pos, eol - pos);
        const size_t colon = h.find(':');
        if (colon == std::string::npos || colon == 0) return false;
        r.headers.emplace_back(lower(h.substr(0, colon)), trim(h.substr(colon + 1)));
        pos = eol + 2;
    }
    return true;
}

/// Only a loopback Host is accepted when bound locally: a DNS-rebinding page names its own host here.
bool hostIsLoopback(const std::string* host) {
    if (!host) return false;
    std::string h = lower(*host);
    if (!h.empty() && h[0] == '[') {
        const size_t e = h.find(']');
        return e != std::string::npos && h.substr(0, e + 1) == "[::1]";
    }
    h = h.substr(0, h.find(':'));
    return h == "127.0.0.1" || h == "localhost";
}

bool validUtf8(const std::string& s) {
    const auto* p = reinterpret_cast<const uint8_t*>(s.data());
    const size_t n = s.size();
    for (size_t i = 0; i < n;) {
        const uint8_t c = p[i];
        size_t len;
        uint32_t cp;
        if (c < 0x80) { ++i; continue; }
        else if ((c & 0xE0) == 0xC0) { len = 2; cp = c & 0x1F; }
        else if ((c & 0xF0) == 0xE0) { len = 3; cp = c & 0x0F; }
        else if ((c & 0xF8) == 0xF0) { len = 4; cp = c & 0x07; }
        else return false;
        if (i + len > n) return false;
        for (size_t k = 1; k < len; ++k) {
            if ((p[i + k] & 0xC0) != 0x80) return false;
            cp = cp << 6 | (p[i + k] & 0x3F);
        }
        if ((len == 2 && cp < 0x80) || (len == 3 && cp < 0x800) || (len == 4 && cp < 0x10000) || cp > 0x10FFFF ||
            (cp >= 0xD800 && cp <= 0xDFFF))
            return false;
        i += len;
    }
    return true;
}

std::string makeFrame(uint8_t opcode, const void* data, size_t size) {
    std::string f;
    f.reserve(size + 10);
    f += (char)(0x80 | opcode);
    if (size < 126) {
        f += (char)size;
    } else if (size <= 0xFFFF) {
        f += (char)126;
        f += (char)(size >> 8);
        f += (char)size;
    } else {
        f += (char)127;
        for (int i = 7; i >= 0; --i) f += (char)((uint64_t)size >> (8 * i));
    }
    f.append(static_cast<const char*>(data), size);
    return f;
}

std::string closePayload(uint16_t code) {
    std::string p;
    p += (char)(code >> 8);
    p += (char)code;
    return p;
}

}  // namespace

// ---------------------------------------------------------------------------------------------- Connection

Connection::Connection(int fd, uint64_t id, size_t maxQueuedBytes) : fd_(fd), id_(id), maxQueuedBytes_(maxQueuedBytes) {}

Connection::~Connection() {
    abort_ = true;
    cv_.notify_all();
    if (writer_.joinable()) writer_.join();
    if (fd_ >= 0) BLEEP_CLOSESOCKET(fd_);
}

size_t Connection::queuedBytes() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return queuedBytes_;
}

void Connection::enqueue(std::string frame, bool binary) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closing_ || abort_) return;
        queuedBytes_ += frame.size();
        queue_.push_back({std::move(frame), binary});
        // The newest frame is kept even if it alone exceeds the limit.
        for (auto it = queue_.begin(); queuedBytes_ > maxQueuedBytes_ && it + 1 != queue_.end();) {
            if (it->binary) {
                queuedBytes_ -= it->bytes.size();
                it = queue_.erase(it);
                ++dropped_;
            } else {
                ++it;
            }
        }
    }
    cv_.notify_one();
}

void Connection::sendText(std::string text) { enqueue(makeFrame(0x1, text.data(), text.size()), false); }

void Connection::sendBinary(const void* data, size_t size) { enqueue(makeFrame(0x2, data, size), true); }

void Connection::close(uint16_t code) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closing_ || abort_) return;
        const std::string p = closePayload(code);
        std::string f = makeFrame(0x8, p.data(), p.size());
        queuedBytes_ += f.size();
        queue_.push_back({std::move(f), false});
        closing_ = true;
    }
    cv_.notify_one();
}

bool Connection::writeAll(const char* data, size_t size, int stallMs) {
    int64_t lastProgress = nowMs();
    size_t off = 0;
    while (off < size) {
        if (abort_) return false;
        const int n = (int)::send(fd_, data + off, size - off, BLEEP_SEND_FLAGS);
        if (n > 0) {
            off += (size_t)n;
            lastProgress = nowMs();
            continue;
        }
#ifdef _WIN32
        const bool again = n < 0 && WSAGetLastError() == WSAEWOULDBLOCK;
#else
        const bool again = n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR);
#endif
        if (!again) return false;
        if (nowMs() - lastProgress > stallMs) return false;
        pollfd p{(decltype(pollfd::fd))fd_, POLLOUT, 0};
        BLEEP_POLL(&p, 1, kTickMs);
    }
    return true;
}

void Connection::writerLoop() {
    for (;;) {
        Out out;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            cv_.wait(lock, [&] { return abort_ || !queue_.empty(); });
            if (abort_) return;
            out = std::move(queue_.front());
            queue_.pop_front();
            queuedBytes_ -= out.bytes.size();
        }
        if (!writeAll(out.bytes.data(), out.bytes.size(), kWriteStallMs)) {
            abort_ = true;
            return;
        }
        if ((static_cast<uint8_t>(out.bytes[0]) & 0x0F) == 0x8) {  // the close frame is always last
            shutdownWrite(fd_);
            return;
        }
    }
}

/// Makes at least one byte available in rx_. False on EOF, error, abort or deadline (0 = none).
bool Connection::fill(int64_t deadlineMs) {
    if (rxPos_ > 0 && rxPos_ == rx_.size()) {
        rx_.clear();
        rxPos_ = 0;
    }
    for (;;) {
        if (abort_) return false;
        char buf[16384];
        const int n = (int)::recv(fd_, buf, sizeof buf, 0);
        if (n > 0) {
            rx_.append(buf, (size_t)n);
            return true;
        }
        if (n == 0) return false;
#ifdef _WIN32
        const bool again = WSAGetLastError() == WSAEWOULDBLOCK;
#else
        const bool again = errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR;
#endif
        if (!again) return false;
        if (deadlineMs && nowMs() >= deadlineMs) return false;
        pollfd p{(decltype(pollfd::fd))fd_, POLLIN, 0};
        BLEEP_POLL(&p, 1, kTickMs);
    }
}

bool Connection::readExact(void* dst, size_t size) {
    auto* out = static_cast<char*>(dst);
    while (size > 0) {
        if (rxPos_ == rx_.size() && !fill(0)) return false;
        const size_t n = std::min(size, rx_.size() - rxPos_);
        std::memcpy(out, rx_.data() + rxPos_, n);
        rxPos_ += n;
        out += n;
        size -= n;
    }
    return true;
}

void Connection::drainAndClose() {
    shutdownWrite(fd_);
    const int64_t deadline = nowMs() + kDrainMs;
    rx_.clear();
    rxPos_ = 0;
    while (!abort_ && nowMs() < deadline && fill(deadline)) {
        rx_.clear();
        rxPos_ = 0;
    }
    BLEEP_CLOSESOCKET(fd_);
    fd_ = -1;
}

// ---------------------------------------------------------------------------------------------- Server

WebSocketServer::WebSocketServer(Options options, Listener& listener) : options_(std::move(options)), listener_(listener) {}

WebSocketServer::~WebSocketServer() { stop(); }

bool WebSocketServer::start() {
#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
#endif
    if (listenFd_ >= 0) return false;
    const int fd = (int)::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return false;
#ifndef _WIN32
    const int yes = 1;
    ::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);  // not on Windows: it would allow port stealing
#endif
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons((uint16_t)options_.port);
    addr.sin_addr.s_addr = htonl(options_.localhostOnly ? INADDR_LOOPBACK : INADDR_ANY);
    if (::bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof addr) != 0 || ::listen(fd, 64) != 0) {
        BLEEP_CLOSESOCKET(fd);
        return false;
    }
    socklen_t len = sizeof addr;
    ::getsockname(fd, reinterpret_cast<sockaddr*>(&addr), &len);
    boundPort_ = ntohs(addr.sin_port);
    setNonBlocking(fd);
    listenFd_ = fd;
    stopping_ = false;
    acceptThread_ = std::thread([this] { acceptLoop(); });
    return true;
}

void WebSocketServer::stop() {
    if (listenFd_ < 0) return;
    stopping_ = true;
    if (acceptThread_.joinable()) acceptThread_.join();
    BLEEP_CLOSESOCKET(listenFd_);
    listenFd_ = -1;
    boundPort_ = 0;
    std::vector<Session> sessions;
    {
        std::lock_guard<std::mutex> lock(sessionsMutex_);
        sessions.swap(sessions_);
    }
    for (auto& s : sessions) {
        s.conn->abort_ = true;
        s.conn->cv_.notify_all();
    }
    for (auto& s : sessions)
        if (s.thread.joinable()) s.thread.join();
}

void WebSocketServer::reap(bool all) {
    std::vector<Session> finished;
    {
        std::lock_guard<std::mutex> lock(sessionsMutex_);
        for (auto it = sessions_.begin(); it != sessions_.end();) {
            if (all || it->done->load()) {
                finished.push_back(std::move(*it));
                it = sessions_.erase(it);
            } else {
                ++it;
            }
        }
    }
    for (auto& s : finished)
        if (s.thread.joinable()) s.thread.join();
}

void WebSocketServer::acceptLoop() {
    while (!stopping_) {
        pollfd p{(decltype(pollfd::fd))listenFd_, POLLIN, 0};
        if (BLEEP_POLL(&p, 1, kTickMs) <= 0) {
            reap(false);
            continue;
        }
        const int fd = (int)::accept(listenFd_, nullptr, nullptr);
        if (fd < 0) continue;
        setNonBlocking(fd);
        const int yes = 1;
        ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, reinterpret_cast<const char*>(&yes), sizeof yes);
#ifdef SO_NOSIGPIPE
        ::setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, sizeof yes);
#endif
        reap(false);
        {
            size_t live;
            {
                std::lock_guard<std::mutex> lock(sessionsMutex_);
                live = sessions_.size();
            }
            if (live >= options_.maxSessions) {  // refuse cleanly rather than grow threads without bound
                static const char busy[] = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                ::send(fd, busy, sizeof busy - 1, BLEEP_SEND_FLAGS);
                BLEEP_CLOSESOCKET(fd);
                continue;
            }
        }
        std::shared_ptr<Connection> conn(new Connection(fd, nextId_++, options_.maxQueuedBytes));
        auto done = std::make_shared<std::atomic<bool>>(false);
        Session s{conn, std::thread([this, conn, done] {
                      runSession(conn);
                      *done = true;
                  }),
                  done};
        std::lock_guard<std::mutex> lock(sessionsMutex_);
        sessions_.push_back(std::move(s));
    }
}

void WebSocketServer::runSession(std::shared_ptr<Connection> conn) {
    Connection& c = *conn;

    const auto respond = [&](HttpResponse r) {
        std::string out = "HTTP/1.1 " + std::to_string(r.status) + " " + statusText(r.status) + "\r\n";
        out += "Content-Type: " + r.contentType + "\r\nContent-Length: " + std::to_string(r.body.size()) + "\r\n";
        out += "Cross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Embedder-Policy: require-corp\r\n";
        out += "Cross-Origin-Resource-Policy: same-origin\r\nCache-Control: no-store\r\nConnection: close\r\n";
        for (auto& h : r.headers) out += h.first + ": " + h.second + "\r\n";
        out += "\r\n";
        out += r.body;
        c.writeAll(out.data(), out.size(), 5000);
    };
    const auto fail = [&](int status) {
        HttpResponse r;
        r.status = status;
        r.contentType = "text/plain; charset=utf-8";
        r.body = std::string(statusText(status)) + "\n";
        respond(std::move(r));
        c.drainAndClose();
    };

    // The Origin this session counts against (released however the session ends).
    std::string originSlot;
    struct OriginRelease {
        WebSocketServer& s;
        const std::string& origin;
        ~OriginRelease() {
            if (origin.empty()) return;
            std::lock_guard<std::mutex> lock(s.originsMutex_);
            auto it = s.originCounts_.find(origin);
            if (it != s.originCounts_.end() && --it->second == 0) s.originCounts_.erase(it);
        }
    } originRelease{*this, originSlot};

    // 1. Request head, within the handshake timeout and size limit.
    const int64_t deadline = nowMs() + kHandshakeTimeoutMs;
    size_t end;
    for (;;) {
        end = c.rx_.find("\r\n\r\n");
        if (end != std::string::npos) break;
        if (c.rx_.size() > kMaxHeaderBytes) return fail(431);
        if (!c.fill(deadline)) {
            if (!c.abort_ && nowMs() >= deadline) return fail(408);
            c.drainAndClose();
            return;
        }
    }
    if (end > kMaxHeaderBytes) return fail(431);
    Request req;
    if (!parseRequest(c.rx_.substr(0, end + 2), req)) return fail(400);
    c.rxPos_ = end + 4;

    // 2. Routing.
    if (options_.localhostOnly && !hostIsLoopback(req.find("host"))) return fail(403);
    if (req.method != "GET") return fail(405);

    const std::string* upgrade = req.find("upgrade");
    const bool wantsUpgrade = upgrade && lower(*upgrade) == "websocket";
    if (req.path == "/ws") {
        if (!wantsUpgrade) return fail(426);
        const std::string* key = req.find("sec-websocket-key");
        const std::string* version = req.find("sec-websocket-version");
        const std::string* conn_h = req.find("connection");
        if (!key || key->size() != 24 || !version || *version != "13" || !conn_h ||
            lower(*conn_h).find("upgrade") == std::string::npos)
            return fail(400);
        if (const std::string* origin = req.find("origin")) {
            {
                std::lock_guard<std::mutex> lock(originsMutex_);
                if (originCounts_[*origin] >= options_.maxSessionsPerOrigin) return fail(503);
                ++originCounts_[*origin];
            }
            originSlot = *origin;
            if (!options_.allowOrigin || !options_.allowOrigin(*origin)) return fail(403);
            c.origin_ = *origin;
        }
        if (stopping_ || c.abort_) {
            c.drainAndClose();
            return;
        }
        const std::string accept = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                                   "Sec-WebSocket-Accept: " + websocketAcceptKey(*key) + "\r\n\r\n";
        if (!c.writeAll(accept.data(), accept.size(), 5000)) {
            c.drainAndClose();
            return;
        }
    } else {
        HttpResponse r;
        if (req.path == "/health") {
            r.contentType = "application/json";
            r.body = "{\"app\":\"bleep-app\",\"protocol\":1}";
        } else if (!options_.http || !options_.http(req.path, r)) {
            return fail(404);
        }
        respond(std::move(r));
        c.drainAndClose();
        return;
    }

    // 3. WebSocket session.
    c.writer_ = std::thread([&c] { c.writerLoop(); });
    listener_.onOpen(c);

    std::string msg;
    bool inMessage = false, messageBinary = false;
    const auto closeWith = [&](uint16_t code) { c.close(code); };
    for (;;) {
        uint8_t h[2];
        if (!c.readExact(h, 2)) break;
        const bool fin = h[0] & 0x80;
        const uint8_t op = h[0] & 0x0F;
        if ((h[0] & 0x70) || !(h[1] & 0x80)) {  // reserved bits, or an unmasked client frame
            closeWith(1002);
            break;
        }
        uint64_t len = h[1] & 0x7F;
        if (len == 126) {
            uint8_t b[2];
            if (!c.readExact(b, 2)) break;
            len = (uint64_t)b[0] << 8 | b[1];
        } else if (len == 127) {
            uint8_t b[8];
            if (!c.readExact(b, 8)) break;
            len = 0;
            for (uint8_t x : b) len = len << 8 | x;
        }
        const bool control = op >= 0x8;
        if (control && (len > 125 || !fin)) {
            closeWith(1002);
            break;
        }
        if (len > kMaxPayload || (!control && msg.size() + len > kMaxPayload)) {
            closeWith(1009);
            break;
        }
        uint8_t mask[4];
        if (!c.readExact(mask, 4)) break;
        std::string payload;  // grown chunk by chunk: a peer announcing 4 MB must send it before we hold it
        bool short_ = false;
        for (size_t have = 0; have < (size_t)len;) {
            const size_t n = std::min(kReadChunk, (size_t)len - have);
            payload.resize(have + n);
            if (!c.readExact(&payload[have], n)) { short_ = true; break; }
            have += n;
        }
        if (short_) break;
        for (size_t i = 0; i < payload.size(); ++i) payload[i] = (char)((uint8_t)payload[i] ^ mask[i & 3]);

        if (op == 0x8) {
            closeWith(payload.size() >= 2 ? (uint16_t)((uint8_t)payload[0] << 8 | (uint8_t)payload[1]) : 1000);
            break;
        }
        if (op == 0x9) {
            c.enqueue(makeFrame(0xA, payload.data(), payload.size()), false);
            continue;
        }
        if (op == 0xA) continue;
        if (op == 0x0 ? !inMessage : (op != 0x1 && op != 0x2) || inMessage) {  // bad continuation / unknown opcode
            closeWith(1002);
            break;
        }
        if (op != 0x0) {
            inMessage = true;
            messageBinary = op == 0x2;
            msg.clear();
        }
        msg += payload;
        if (!fin) continue;
        inMessage = false;
        if (messageBinary) {
            listener_.onBinary(c, reinterpret_cast<const uint8_t*>(msg.data()), msg.size());
        } else if (validUtf8(msg)) {
            listener_.onText(c, msg);
        } else {
            closeWith(1007);
            break;
        }
    }

    // 4. Teardown: let the writer flush the close frame, then wait for the peer's FIN.
    c.close(1001);
    c.cv_.notify_all();
    if (c.writer_.joinable()) c.writer_.join();
    listener_.onClose(c);
    c.drainAndClose();
    c.abort_ = true;
}

}  // namespace bleep::hub
