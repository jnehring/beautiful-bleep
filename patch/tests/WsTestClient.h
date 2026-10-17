// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// A minimal raw-socket WebSocket client with masked frames, for the hub tests: written separately from the
// server so the server is checked against the RFC rather than against its own reader.
#pragma once

#include <juce_core/juce_core.h>

#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <string>

namespace bleep::hub::test {

int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

struct Frame {
    int op = -1;
    std::string payload;
    bool fin = true;
};

class Client {
public:
    bool connect(int port) { return sock_.connect("127.0.0.1", port, 2000); }
    void close() { sock_.close(); }

    void sendRaw(const std::string& s) {
        for (size_t off = 0; off < s.size();) {
            if (sock_.waitUntilReady(false, 5000) <= 0) return;
            const int n = sock_.write(s.data() + off, (int)(s.size() - off));
            if (n <= 0) return;
            off += (size_t)n;
        }
    }

    /// Returns the HTTP status, 0 on failure. Leftover bytes stay in the buffer.
    int handshake(const std::string& origin, int port, const std::string& path = "/ws",
                  const std::string& key = "dGhlIHNhbXBsZSBub25jZQ==") {
        std::string req = "GET " + path + " HTTP/1.1\r\nHost: 127.0.0.1:" + std::to_string(port) +
                          "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key +
                          "\r\nSec-WebSocket-Version: 13\r\n";
        if (!origin.empty()) req += "Origin: " + origin + "\r\n";
        sendRaw(req + "\r\n");
        std::string head;
        return readHead(head, 5000);
    }

    int readHead(std::string& head, int timeoutMs) {
        const int64_t end = nowMs() + timeoutMs;
        size_t pos;
        while ((pos = buf_.find("\r\n\r\n")) == std::string::npos) {
            if (!pull(std::max<int64_t>(1, end - nowMs()))) return 0;
        }
        head = buf_.substr(0, pos + 4);
        buf_.erase(0, pos + 4);
        return std::atoi(head.c_str() + 9);
    }

    /// Reads until the server closes (Connection: close).
    std::string readToEnd(int timeoutMs) {
        const int64_t end = nowMs() + timeoutMs;
        while (nowMs() < end && pull(std::max<int64_t>(1, end - nowMs()))) {
        }
        std::string r = std::move(buf_);
        buf_.clear();
        return r;
    }

    void sendFrame(int op, const std::string& payload, bool fin = true, bool masked = true) {
        std::string f;
        f += (char)((fin ? 0x80 : 0) | op);
        const uint8_t m = masked ? 0x80 : 0;
        if (payload.size() < 126) {
            f += (char)(m | payload.size());
        } else if (payload.size() <= 0xFFFF) {
            f += (char)(m | 126);
            f += (char)(payload.size() >> 8);
            f += (char)payload.size();
        } else {
            f += (char)(m | 127);
            for (int i = 7; i >= 0; --i) f += (char)((uint64_t)payload.size() >> (8 * i));
        }
        const uint8_t mask[4] = {0x12, 0x34, 0x56, 0x78};
        if (masked) f.append(reinterpret_cast<const char*>(mask), 4);
        for (size_t i = 0; i < payload.size(); ++i) f += (char)(masked ? (uint8_t)payload[i] ^ mask[i & 3] : (uint8_t)payload[i]);
        sendRaw(f);
    }

    /// Sends only the header of a masked frame that claims `len` payload bytes.
    void sendHeaderOnly(int op, uint64_t len) {
        std::string f;
        f += (char)(0x80 | op);
        f += (char)(0x80 | 127);
        for (int i = 7; i >= 0; --i) f += (char)(len >> (8 * i));
        f.append("\1\2\3\4", 4);
        sendRaw(f);
    }

    bool readFrame(Frame& out, int timeoutMs = 5000) {
        const int64_t end = nowMs() + timeoutMs;
        const auto need = [&](size_t n) {
            while (buf_.size() < n)
                if (!pull(std::max<int64_t>(1, end - nowMs()))) return false;
            return true;
        };
        if (!need(2)) return false;
        out.fin = (uint8_t)buf_[0] & 0x80;
        out.op = (uint8_t)buf_[0] & 0x0F;
        uint64_t len = (uint8_t)buf_[1] & 0x7F;
        size_t hdr = 2;
        if (len == 126) {
            if (!need(4)) return false;
            len = (uint64_t)(uint8_t)buf_[2] << 8 | (uint8_t)buf_[3];
            hdr = 4;
        } else if (len == 127) {
            if (!need(10)) return false;
            len = 0;
            for (int i = 0; i < 8; ++i) len = len << 8 | (uint8_t)buf_[2 + (size_t)i];
            hdr = 10;
        }
        if (!need(hdr + (size_t)len)) return false;
        out.payload = buf_.substr(hdr, (size_t)len);
        buf_.erase(0, hdr + (size_t)len);
        return true;
    }

    /// Skips nothing: the next frame must be a close with this code.
    bool expectClose(int code) {
        Frame f;
        return readFrame(f) && f.op == 8 && f.payload.size() >= 2 &&
               ((uint8_t)f.payload[0] << 8 | (uint8_t)f.payload[1]) == code;
    }

    /// True when the server has closed the TCP connection.
    bool waitEof(int timeoutMs) {
        const int64_t end = nowMs() + timeoutMs;
        while (nowMs() < end) {
            if (!pull(std::max<int64_t>(1, end - nowMs())) && eof_) return true;
        }
        return false;
    }

private:
    bool pull(int64_t timeoutMs) {
        if (eof_) return false;
        const int ready = sock_.waitUntilReady(true, (int)timeoutMs);
        if (ready < 0) { eof_ = true; return false; }
        if (ready == 0) return false;
        char tmp[65536];
        const int n = sock_.read(tmp, sizeof tmp, false);
        if (n <= 0) { eof_ = true; return false; }
        buf_.append(tmp, (size_t)n);
        return true;
    }

    juce::StreamingSocket sock_;
    std::string buf_;
    bool eof_ = false;
};

}  // namespace bleep::hub::test
