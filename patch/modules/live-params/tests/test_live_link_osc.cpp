// SPDX-License-Identifier: GPL-3.0-or-later
// Bleep Live Link: the OSC packets are well-formed (OSC 1.0), so Max's udpreceive reads them.
#include "LiveLinkOsc.h"
#include "LiveParamsDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cstring>

using namespace bleep::patch;
using namespace bleep::patch::osc;

static void paramPacket() {
    TEST("/bleep/param is address, type tags, int32 and float32, padded to 4 bytes, big-endian");
    uint8_t p[64];
    const size_t n = encodeParam(3, 0.5f, p, sizeof(p));
    EXPECT(n == 28);                                   // "/bleep/param\0\0\0\0" 16, ",if\0" 4, 4 + 4
    EXPECT(std::memcmp(p, "/bleep/param", 13) == 0 && p[13] == 0 && p[15] == 0);
    EXPECT(std::memcmp(p + 16, ",if\0", 4) == 0);
    EXPECT(p[20] == 0 && p[21] == 0 && p[22] == 0 && p[23] == 3);
    EXPECT(p[24] == 0x3f && p[25] == 0x00 && p[26] == 0 && p[27] == 0);   // 0.5f = 0x3f000000
    EXPECT(n % 4 == 0);
}

static void negativeOffset() {
    TEST("a negative offset: -1.0f is 0xbf800000");
    uint8_t p[64];
    const size_t n = encodeParam(15, -1.0f, p, sizeof(p));
    EXPECT(n == 28);
    EXPECT(p[23] == 15);
    EXPECT(p[24] == 0xbf && p[25] == 0x80 && p[26] == 0 && p[27] == 0);
}

static void tooSmall() {
    TEST("a buffer that is too small gets nothing, never an overrun");
    uint8_t p[64];
    EXPECT(encodeParam(0, 0.0f, p, 16) == 0);
    EXPECT(encodeParam(0, 0.0f, p, 27) == 0);
    EXPECT(encodeParam(0, 0.0f, p, 28) == 28);
}

static void ports() {
    TEST("input k goes to its channel's port, as row k % 4");
    EXPECT(devicePort(0) == 9871 && rowOf(0) == 0);
    EXPECT(devicePort(3) == 9871 && rowOf(3) == 3);
    EXPECT(devicePort(4) == 9872 && rowOf(4) == 0);
    EXPECT(devicePort(31) == 9878 && rowOf(31) == 3);   // channel 8
    EXPECT(kBoardPort != devicePort(0) && kBoardPort != devicePort(kNumLiveParams - 1));
}

static void hello() {
    TEST("/bleep/hello <channel> is encoded and recognised; other packets are not");
    uint8_t h[64];
    const size_t n = encodeHello(3, h, sizeof(h));
    EXPECT(n == 24);
    EXPECT(std::memcmp(h + 16, ",i\0\0", 4) == 0);
    int channel = 0;
    EXPECT(parseHello(h, n, channel) && channel == 3);
    EXPECT(!parseHello(h, 23, channel));              // too short
    EXPECT(!parseHello(nullptr, 0, channel));
    uint8_t other[64] = {};
    std::memcpy(other, "/bleep/helloo", 14);
    EXPECT(!parseHello(other, sizeof(other), channel));   // a NUL must follow the address
    uint8_t param[64];
    const size_t m = encodeParam(1, 0.5f, param, sizeof(param));
    EXPECT(!parseHello(param, m, channel));
    EXPECT(encodeHello(1, h, 23) == 0);
}

int main() {
    paramPacket();
    negativeOffset();
    tooSmall();
    ports();
    hello();
    return bleep::test::finish("live-link-osc");
}
