// SPDX-License-Identifier: GPL-3.0-or-later
// OSC 1.0 packets without allocation (doc/specs/modules/osc-bridge.md §4): decoding
// messages and bundles into fixed-size messages with numeric arguments, encoding a
// message with float arguments, address-pattern matching, and a log that one network
// thread writes and any number of audio threads read.
#pragma once

#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace bleep::patch::osc {

constexpr int kMaxAddress = 96;
constexpr int kMaxArgs = 4;

/// One message with its numeric arguments: i, f, d, h and the booleans T / F (1 / 0) become floats;
/// anything else (strings, blobs) is skipped.
struct Message {
    char address[kMaxAddress] = {};
    int argc = 0;
    float args[kMaxArgs] = {};
};

namespace detail {
inline uint32_t be32(const uint8_t* p) noexcept { return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3]; }
inline uint64_t be64(const uint8_t* p) noexcept { return ((uint64_t)be32(p) << 32) | be32(p + 4); }
inline size_t pad4(size_t n) noexcept { return (n + 4) & ~(size_t)3; }  // string length + terminator, rounded up
/// Length of the 4-byte padded string at `p` (terminator included), or 0 if it does not end inside the packet.
inline size_t stringSize(const uint8_t* p, size_t avail) noexcept {
    size_t n = 0;
    while (n < avail && p[n] != 0) ++n;
    if (n >= avail) return 0;
    const size_t total = pad4(n);
    return total <= avail ? total : 0;
}
}  // namespace detail

/// Decodes one message. False when it is malformed.
inline bool decodeMessage(const uint8_t* data, size_t size, Message& out) noexcept {
    using namespace detail;
    out = Message{};
    const size_t a = stringSize(data, size);
    if (a == 0 || data[0] != '/' || std::strlen((const char*)data) >= (size_t)kMaxAddress) return false;
    std::memcpy(out.address, data, std::strlen((const char*)data));
    size_t pos = a;
    if (pos >= size) return true;  // no type tag string: an old-style message without arguments
    const size_t t = stringSize(data + pos, size - pos);
    if (t == 0 || data[pos] != ',') return false;
    const char* tags = (const char*)data + pos + 1;
    pos += t;
    for (; *tags; ++tags) {
        float v = 0.0f;
        bool numeric = true;
        switch (*tags) {
            case 'i':
                if (pos + 4 > size) return false;
                v = (float)(int32_t)be32(data + pos);
                pos += 4;
                break;
            case 'f': {
                if (pos + 4 > size) return false;
                const uint32_t u = be32(data + pos);
                std::memcpy(&v, &u, 4);
                pos += 4;
                break;
            }
            case 'd': {
                if (pos + 8 > size) return false;
                const uint64_t u = be64(data + pos);
                double d;
                std::memcpy(&d, &u, 8);
                v = (float)d;
                pos += 8;
                break;
            }
            case 'h':
                if (pos + 8 > size) return false;
                v = (float)(int64_t)be64(data + pos);
                pos += 8;
                break;
            case 'T': v = 1.0f; break;
            case 'F': v = 0.0f; break;
            case 'N': case 'I': numeric = false; break;
            case 's': case 'S': {
                const size_t n = stringSize(data + pos, size - pos);
                if (n == 0) return false;
                pos += n;
                numeric = false;
                break;
            }
            case 'b': {
                if (pos + 4 > size) return false;
                const size_t len = be32(data + pos);
                const size_t total = (len + 3) & ~(size_t)3;
                if (pos + 4 + total > size) return false;
                pos += 4 + total;
                numeric = false;
                break;
            }
            default: return true;  // an unknown type: stop; the arguments so far stand
        }
        if (!std::isfinite(v)) v = 0.0f;  // no NaN or infinity downstream
        if (numeric && out.argc < kMaxArgs) out.args[out.argc++] = v;
    }
    return true;
}

/// Calls `onMessage(const Message&)` for every message in a packet: a message, or a bundle (nested bundles included).
template <class F>
void decodePacket(const uint8_t* data, size_t size, F&& onMessage, int depth = 0) {
    using namespace detail;
    if (size < 4 || depth > 4) return;
    if (size >= 16 && std::memcmp(data, "#bundle\0", 8) == 0) {
        size_t pos = 16;  // the time tag is ignored: messages act when they arrive
        while (pos + 4 <= size) {
            const size_t len = be32(data + pos);
            pos += 4;
            if (len == 0 || pos + len > size) return;
            decodePacket(data + pos, len, onMessage, depth + 1);
            pos += len;
        }
        return;
    }
    Message m;
    if (decodeMessage(data, size, m)) onMessage(m);
}

/// Encodes an OSC message with float arguments. Returns its size, or 0 if it does not fit in `cap`.
inline size_t encode(const char* address, const float* args, int argc, uint8_t* out, size_t cap) noexcept {
    using namespace detail;
    const size_t alen = std::strlen(address);
    const size_t a = pad4(alen), t = pad4((size_t)argc + 1);
    const size_t total = a + t + 4 * (size_t)argc;
    if (alen == 0 || address[0] != '/' || total > cap) return 0;
    std::memset(out, 0, total);
    std::memcpy(out, address, alen);
    out[a] = ',';
    for (int i = 0; i < argc; ++i) out[a + 1 + (size_t)i] = 'f';
    for (int i = 0; i < argc; ++i) {
        uint32_t u;
        std::memcpy(&u, &args[i], 4);
        uint8_t* p = out + a + t + 4 * (size_t)i;
        p[0] = (uint8_t)(u >> 24); p[1] = (uint8_t)(u >> 16); p[2] = (uint8_t)(u >> 8); p[3] = (uint8_t)u;
    }
    return total;
}

namespace detail {
inline bool matchPart(const char* p, const char* pe, const char* s, const char* se) noexcept;

/// One bracket expression "[...]" starting at p (points after '['); sets `next` after the ']'. Whether c matches.
inline bool bracket(const char* p, const char* pe, char c, const char*& next) noexcept {
    bool negate = false, hit = false;
    if (p < pe && *p == '!') { negate = true; ++p; }
    for (; p < pe && *p != ']'; ++p) {
        if (p + 2 < pe && p[1] == '-' && p[2] != ']') {
            if (c >= p[0] && c <= p[2]) hit = true;
            p += 2;
        } else if (*p == c) {
            hit = true;
        }
    }
    next = p < pe ? p + 1 : pe;
    return hit != negate;
}

/// Matches one path part (no '/') against a pattern part: ? * [..] {a,b}.
inline bool matchPart(const char* p, const char* pe, const char* s, const char* se) noexcept {
    while (p < pe) {
        switch (*p) {
            case '*':
                while (p < pe && *p == '*') ++p;
                if (p == pe) return true;
                for (const char* t = s; t <= se; ++t)
                    if (matchPart(p, pe, t, se)) return true;
                return false;
            case '?':
                if (s == se) return false;
                ++p; ++s;
                break;
            case '[': {
                if (s == se) return false;
                const char* next;
                if (!bracket(p + 1, pe, *s, next)) return false;
                p = next; ++s;
                break;
            }
            case '{': {
                const char* close = p + 1;
                while (close < pe && *close != '}') ++close;
                if (close == pe) return false;
                const char* alt = p + 1;
                while (alt <= close) {
                    const char* end = alt;
                    while (end < close && *end != ',') ++end;
                    const size_t n = (size_t)(end - alt);
                    if ((size_t)(se - s) >= n && std::memcmp(alt, s, n) == 0 && matchPart(close + 1, pe, s + n, se)) return true;
                    alt = end + 1;
                }
                return false;
            }
            default:
                if (s == se || *s != *p) return false;
                ++p; ++s;
        }
    }
    return s == se;
}
}  // namespace detail

/// OSC address pattern matching: parts split at '/', each with ? * [abc] [a-z] [!x] {one,two}. A pattern
/// "//" part (any depth) is not supported. An empty pattern matches nothing.
inline bool match(const char* pattern, const char* address) noexcept {
    if (!pattern || !address || pattern[0] != '/' || address[0] != '/') return false;
    const char *p = pattern, *a = address;
    while (*p && *a) {
        const char* pe = p + 1;
        while (*pe && *pe != '/') ++pe;
        const char* ae = a + 1;
        while (*ae && *ae != '/') ++ae;
        if (!detail::matchPart(p + 1, pe, a + 1, ae)) return false;
        p = pe;
        a = ae;
    }
    return *p == 0 && *a == 0;
}

/// A log of messages: one writer thread (the network thread), any number of readers, each with its own cursor.
/// A reader that falls more than kSize behind skips ahead. No allocation, no locks.
class Log {
public:
    static constexpr uint64_t kSize = 256;

    void push(const Message& m) noexcept {
        const uint64_t seq = write_.load(std::memory_order_relaxed);
        Slot& s = slots_[seq % kSize];
        s.stamp.store(0, std::memory_order_release);
        s.msg = m;
        s.stamp.store(seq + 1, std::memory_order_release);
        write_.store(seq + 1, std::memory_order_release);
    }
    /// The cursor to start reading from: only messages that arrive from now on.
    uint64_t head() const noexcept { return write_.load(std::memory_order_acquire); }
    /// Reads the message at `cursor` and advances it. False when there is nothing new.
    bool read(uint64_t& cursor, Message& out) const noexcept {
        for (;;) {
            const uint64_t w = write_.load(std::memory_order_acquire);
            if (cursor >= w) return false;
            if (w - cursor > kSize) cursor = w - kSize;
            const Slot& s = slots_[cursor % kSize];
            if (s.stamp.load(std::memory_order_acquire) == cursor + 1) {
                out = s.msg;
                if (s.stamp.load(std::memory_order_acquire) == cursor + 1) {
                    ++cursor;
                    return true;
                }
            }
            ++cursor;  // overwritten while reading: skip it
        }
    }

private:
    struct Slot {
        std::atomic<uint64_t> stamp{0};
        Message msg;
    };
    std::array<Slot, kSize> slots_{};
    std::atomic<uint64_t> write_{0};
};

}  // namespace bleep::patch::osc
