// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// SHA-1 and base64, just enough for the WebSocket handshake (RFC 6455 §4.2.2).
// juce_core has base64 but no SHA-1, and the hub must not pull in a crypto library for one hash.
// SHA-1 is not used for security here; the protocol fixes it.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>

namespace bleep::hub {

inline std::array<uint8_t, 20> sha1(const void* data, size_t len) {
    uint32_t h[5] = {0x67452301u, 0xEFCDAB89u, 0x98BADCFEu, 0x10325476u, 0xC3D2E1F0u};
    const auto rol = [](uint32_t v, int n) { return (v << n) | (v >> (32 - n)); };

    const auto block = [&](const uint8_t* p) {
        uint32_t w[80];
        for (int i = 0; i < 16; ++i)
            w[i] = (uint32_t)p[i * 4] << 24 | (uint32_t)p[i * 4 + 1] << 16 | (uint32_t)p[i * 4 + 2] << 8 | p[i * 4 + 3];
        for (int i = 16; i < 80; ++i) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (int i = 0; i < 80; ++i) {
            uint32_t f, k;
            if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999u; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1u; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDCu; }
            else { f = b ^ c ^ d; k = 0xCA62C1D6u; }
            const uint32_t t = rol(a, 5) + f + e + k + w[i];
            e = d; d = c; c = rol(b, 30); b = a; a = t;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    };

    const auto* bytes = static_cast<const uint8_t*>(data);
    size_t full = len / 64;
    for (size_t i = 0; i < full; ++i) block(bytes + i * 64);

    uint8_t tail[128] = {};
    const size_t rest = len - full * 64;
    for (size_t i = 0; i < rest; ++i) tail[i] = bytes[full * 64 + i];
    tail[rest] = 0x80;
    const size_t tailLen = rest < 56 ? 64 : 128;
    const uint64_t bits = (uint64_t)len * 8;
    for (size_t i = 0; i < 8; ++i) tail[tailLen - 1 - i] = (uint8_t)(bits >> (8 * i));
    block(tail);
    if (tailLen == 128) block(tail + 64);

    std::array<uint8_t, 20> out{};
    for (int i = 0; i < 5; ++i)
        for (int j = 0; j < 4; ++j) out[(size_t)i * 4 + (size_t)j] = (uint8_t)(h[i] >> (24 - 8 * j));
    return out;
}

inline std::string base64(const void* data, size_t len) {
    static const char* const kAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const auto* p = static_cast<const uint8_t*>(data);
    std::string out;
    out.reserve((len + 2) / 3 * 4);
    for (size_t i = 0; i < len; i += 3) {
        const uint32_t v = (uint32_t)p[i] << 16 | (i + 1 < len ? (uint32_t)p[i + 1] << 8 : 0u) | (i + 2 < len ? p[i + 2] : 0u);
        out += kAlphabet[(v >> 18) & 63];
        out += kAlphabet[(v >> 12) & 63];
        out += i + 1 < len ? kAlphabet[(v >> 6) & 63] : '=';
        out += i + 2 < len ? kAlphabet[v & 63] : '=';
    }
    return out;
}

/// Sec-WebSocket-Accept for a client's Sec-WebSocket-Key.
inline std::string websocketAcceptKey(const std::string& key) {
    const std::string joined = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    const auto digest = sha1(joined.data(), joined.size());
    return base64(digest.data(), digest.size());
}

}  // namespace bleep::hub
