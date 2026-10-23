// The few OSC messages between the board and the Bleep Live Link devices (Max for Live), without JUCE.
//
// A device has 4 rows and listens on the port of its CHANNEL (1, 2, …): a UDP port can only be bound once, so each device
// gets its own. Board input k belongs to channel k / 4 + 1, row k % 4.
//
//   board → device (UDP, localhost:devicePort(channel))   /bleep/param  ,if  <row 0..3> <offset>
//   device → board (UDP, localhost:kBoardPort)            /bleep/hello  ,i   <channel>   (the device (re)started: send its rows again)
//
// OSC 1.0: an address and a type tag string, each a NUL-terminated string padded to a multiple of 4 bytes,
// then the arguments, big-endian.
#pragma once

#include <cstdint>
#include <cstring>

namespace bleep::patch::osc {

constexpr int kRowsPerChannel = 4;
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

/// /bleep/param with an int (the row) and a float (its offset). Returns the packet's size, 0 if it does not fit.
inline size_t encodeParam(int row, float offset, uint8_t* out, size_t cap) noexcept {
    size_t at = detail::putString("/bleep/param", out, 0, cap);
    if (at == 0) return 0;
    at = detail::putString(",if", out, at, cap);
    if (at == 0 || at + 8 > cap) return 0;
    uint32_t bits;
    std::memcpy(&bits, &offset, 4);
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

}  // namespace bleep::patch::osc
