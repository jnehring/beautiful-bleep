// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// The few OSC messages between the board and the Bleep Live Link devices (Max for Live), without JUCE.
//
// A device has 4 rows and listens on the port of its CHANNEL (1, 2, …): a UDP port can only be bound once, so each device
// gets its own. Board input k belongs to channel k / 4 + 1, row k % 4.
//
//   board → device (UDP, localhost:devicePort(channel))   /bleep/param  ,if  <row 0..3> <value 0..1, or -1: no longer driven>
//   device → board (UDP, localhost:kBoardPort)            /bleep/hello  ,i   <channel>   (the device (re)started: send its rows again)
//   device → board (UDP, localhost:kBoardPort)            /bleep/info   what a row is mapped to (see RowInfo)
//
// OSC 1.0: an address and a type tag string, each a NUL-terminated string padded to a multiple of 4 bytes,
// then the arguments, big-endian.
#pragma once

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace bleep::patch::osc {

constexpr int kRowsPerChannel = 4;
constexpr int kChannels = 8;
constexpr int kFirstDevicePort = 9871;   ///< channel 1's udpreceive; channel c listens on kFirstDevicePort + c - 1
constexpr int kBoardPort = 9880;         ///< the board's listening port, for the devices' hello

/// The port of the device that handles board input `input`, and its row.
constexpr int devicePort(int input) noexcept { return kFirstDevicePort + input / kRowsPerChannel; }
constexpr int rowOf(int input) noexcept { return input % kRowsPerChannel; }

namespace detail {
inline size_t putString(const char* s, uint8_t* out, size_t at, size_t cap) noexcept {
    const size_t n = std::strlen(s) + 1;
    const size_t padded = (n + 3) & ~size_t(3);
    if (at + padded > cap) return 0;
    std::memset(out + at, 0, padded);
    std::memcpy(out + at, s, n);
    return at + padded;
}
inline void putU32(uint32_t v, uint8_t* out) noexcept {
    out[0] = (uint8_t)(v >> 24);
    out[1] = (uint8_t)(v >> 16);
    out[2] = (uint8_t)(v >> 8);
    out[3] = (uint8_t)v;
}
}  // namespace detail

/// /bleep/param with an int (the row) and a float (its value, 0..1; -1 when the board no longer drives the row). Returns the packet's size, 0 if it does not fit.
inline size_t encodeParam(int row, float value, uint8_t* out, size_t cap) noexcept {
    size_t at = detail::putString("/bleep/param", out, 0, cap);
    if (at == 0) return 0;
    at = detail::putString(",if", out, at, cap);
    if (at == 0 || at + 8 > cap) return 0;
    uint32_t bits;
    std::memcpy(&bits, &value, 4);
    detail::putU32((uint32_t)row, out + at);
    detail::putU32(bits, out + at + 4);
    return at + 8;
}

/// /bleep/hello with the device's channel (what a device sends when it loads).
inline size_t encodeHello(int channel, uint8_t* out, size_t cap) noexcept {
    size_t at = detail::putString("/bleep/hello", out, 0, cap);
    if (at == 0) return 0;
    at = detail::putString(",i", out, at, cap);
    if (at == 0 || at + 4 > cap) return 0;
    detail::putU32((uint32_t)channel, out + at);
    return at + 4;
}

/// Whether a received packet is /bleep/hello <channel>; writes the channel (1-based).
inline bool parseHello(const uint8_t* data, size_t size, int& channel) noexcept {
    constexpr char kHello[] = "/bleep/hello";   // 13 bytes with its NUL, padded to 16
    constexpr char kTags[] = ",i";               // 3 bytes with its NUL, padded to 4
    if (data == nullptr || size < 24) return false;
    if (std::memcmp(data, kHello, sizeof(kHello)) != 0) return false;
    if (std::memcmp(data + 16, kTags, sizeof(kTags)) != 0) return false;
    channel = (int)(((uint32_t)data[20] << 24) | ((uint32_t)data[21] << 16) | ((uint32_t)data[22] << 8) | (uint32_t)data[23]);
    return true;
}

// ---- /bleep/info: what a device row is mapped to --------------------------------------------------------------

/// The arguments, in this order: channel (int) row (int) kind (string: "continuous", "discrete" or "none") name (string)
/// current (0..1, the parameter's position when it was mapped) min max (the parameter's own range) adopt (int: 1 when the row
/// was just mapped) then, for a discrete parameter, its item names, one string each. A "none" message ends after the kind.
/// Max sends whole numbers as ints and the rest as floats, and a name like "4" as a number, so every argument is read leniently.
struct RowInfo {
    int channel = 0, row = 0;
    std::string kind, name;
    float current = 0.0f, min = 0.0f, max = 1.0f;
    bool adopt = false;
    std::vector<std::string> items;
};

namespace detail {
struct Arg {
    char type = 0;
    int32_t i = 0;
    float f = 0.0f;
    std::string s;
    bool numeric() const noexcept { return type == 'i' || type == 'f'; }
    float number() const noexcept { return type == 'i' ? (float)i : f; }
    std::string text() const {
        if (type == 's') return s;
        if (type == 'i') return std::to_string(i);
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%g", (double)f);
        return buf;
    }
};
inline bool readString(const uint8_t* d, size_t size, size_t& at, std::string& out) noexcept {
    size_t end = at;
    while (end < size && d[end] != 0) ++end;
    if (end >= size) return false;   // no terminating NUL
    out.assign(reinterpret_cast<const char*>(d + at), end - at);
    at += (end - at + 1 + 3) & ~size_t(3);
    return at <= size;
}
inline int32_t readI32(const uint8_t* d) noexcept {
    return (int32_t)(((uint32_t)d[0] << 24) | ((uint32_t)d[1] << 16) | ((uint32_t)d[2] << 8) | (uint32_t)d[3]);
}
inline bool readArgs(const uint8_t* d, size_t size, const char* address, std::vector<Arg>& args) {
    size_t at = 0;
    std::string addr, tags;
    if (d == nullptr || !readString(d, size, at, addr) || addr != address || !readString(d, size, at, tags)) return false;
    if (tags.empty() || tags[0] != ',') return false;
    for (size_t t = 1; t < tags.size(); ++t) {
        Arg a;
        a.type = tags[t];
        if (a.type == 'i' || a.type == 'f') {
            if (at + 4 > size) return false;
            a.i = readI32(d + at);
            if (a.type == 'f') {
                const uint32_t u = (uint32_t)a.i;
                std::memcpy(&a.f, &u, 4);
            }
            at += 4;
        } else if (a.type == 's') {
            if (!readString(d, size, at, a.s)) return false;
        } else {
            return false;   // blobs, 64-bit numbers and the rest: not part of this protocol
        }
        args.push_back(std::move(a));
        if (args.size() > 64) return false;
    }
    return true;
}
inline void jsonString(std::string& out, const std::string& s) {
    out += '"';
    for (const unsigned char c : s) {
        if (c == '"' || c == '\\') { out += '\\'; out += (char)c; }
        else if (c < 0x20) { char buf[8]; std::snprintf(buf, sizeof(buf), "\\u%04x", c); out += buf; }
        else out += (char)c;
    }
    out += '"';
}
inline void jsonNumber(std::string& out, float v) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.6g", std::isfinite(v) ? (double)v : 0.0);
    out += buf;
}
}  // namespace detail

/// Whether a received packet is /bleep/info with well-formed arguments; fills `info`.
inline bool parseInfo(const uint8_t* data, size_t size, RowInfo& info) {
    std::vector<detail::Arg> a;
    if (!detail::readArgs(data, size, "/bleep/info", a) || a.size() < 3) return false;
    if (!a[0].numeric() || !a[1].numeric() || a[2].type != 's') return false;
    RowInfo r;
    r.channel = (int)std::lround(a[0].number());
    r.row = (int)std::lround(a[1].number());
    r.kind = a[2].s;
    if (r.kind != "continuous" && r.kind != "discrete" && r.kind != "none") return false;
    if (r.channel < 1 || r.channel > kChannels || r.row < 0 || r.row >= kRowsPerChannel) return false;
    if (r.kind != "none") {
        if (a.size() < 8 || !a[4].numeric() || !a[5].numeric() || !a[6].numeric() || !a[7].numeric()) return false;
        r.name = a[3].text();
        r.current = a[4].number();
        r.min = a[5].number();
        r.max = a[6].number();
        r.adopt = a[7].number() != 0.0f;
        for (size_t i = 8; i < a.size(); ++i) r.items.push_back(a[i].text());
    }
    info = std::move(r);
    return true;
}

/// The row's info as the JSON object IEngine::setLiveRowInfo takes.
inline std::string infoToJson(const RowInfo& r) {
    std::string j = "{\"kind\":";
    detail::jsonString(j, r.kind);
    if (r.kind != "none") {
        j += ",\"name\":";
        detail::jsonString(j, r.name);
        j += ",\"current\":";
        detail::jsonNumber(j, r.current);
        j += ",\"min\":";
        detail::jsonNumber(j, r.min);
        j += ",\"max\":";
        detail::jsonNumber(j, r.max);
        j += r.adopt ? ",\"adopt\":true" : ",\"adopt\":false";
        j += ",\"items\":[";
        for (size_t i = 0; i < r.items.size(); ++i) {
            if (i) j += ",";
            detail::jsonString(j, r.items[i]);
        }
        j += "]";
    }
    return j + "}";
}

/// A /bleep/info packet (what the device sends; here for tests). Returns its size, 0 if it does not fit.
inline size_t encodeInfo(const RowInfo& r, uint8_t* out, size_t cap) {
    std::string tags = ",iis";
    if (r.kind != "none") tags += "sfffi" + std::string(r.items.size(), 's');
    size_t at = detail::putString("/bleep/info", out, 0, cap);
    if (at == 0) return 0;
    at = detail::putString(tags.c_str(), out, at, cap);
    if (at == 0) return 0;
    auto putInt = [&](int v) { if (at + 4 > cap) return false; detail::putU32((uint32_t)v, out + at); at += 4; return true; };
    auto putFloat = [&](float v) { uint32_t u; std::memcpy(&u, &v, 4); return putInt((int)u); };
    auto putStr = [&](const std::string& s) { at = detail::putString(s.c_str(), out, at, cap); return at != 0; };
    if (!putInt(r.channel) || !putInt(r.row) || !putStr(r.kind)) return 0;
    if (r.kind != "none") {
        if (!putStr(r.name) || !putFloat(r.current) || !putFloat(r.min) || !putFloat(r.max) || !putInt(r.adopt ? 1 : 0)) return 0;
        for (const auto& item : r.items)
            if (!putStr(item)) return 0;
    }
    return at;
}

}  // namespace bleep::patch::osc
