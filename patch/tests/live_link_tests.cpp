// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Live Link, board side: which Live Params rows the sender sends and when (LiveParams.h), and the OSC packets it sends them in
// (bridges/ableton/LiveLinkOsc.h), so that Max's udpreceive reads them.
#include "LiveLinkOsc.h"
#include "LiveParams.h"
#include "dsp/tests/TestUtil.h"

#include <cstring>
#include <utility>
#include <vector>

using namespace bleep::patch;
using Sent = std::vector<std::pair<int, float>>;

static Sent poll(LiveParamsSender& s, const LiveParamsMailbox& box) {
    Sent out;
    s.poll(box, [&](int k, float v) { out.push_back({k, v}); });
    return out;
}

static void onlyCabledInputsAreSent() {
    TEST("only inputs with a cable are sent, with their last sample");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(0, true, 0.25f);
    box.publish(3, true, -0.5f);
    box.publish(5, false, 0.9f);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 2);
    EXPECT(m[0].first == 0 && m[0].second == 0.25f);
    EXPECT(m[1].first == 3 && m[1].second == -0.5f);
}

static void unchangedValuesAreNotRepeated() {
    TEST("a value that did not move is not sent again; one that moved is");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(1, true, 0.5f);
    EXPECT(poll(s, box).size() == 1);
    box.publish(1, true, 0.5f + 0.0001f);   // inside the deadband
    EXPECT(poll(s, box).empty());
    box.publish(1, true, 0.6f);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 1 && m[0].second == 0.6f);
}

static void unpatchingReleases() {
    TEST("removing the cable sends 0 once, so the device releases the parameter");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(2, true, 0.8f);
    poll(s, box);
    box.publish(2, false, 0.0f);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 1 && m[0].first == 2 && m[0].second == 0.0f);
    EXPECT(poll(s, box).empty());
}

static void reconnectSendsEverything() {
    TEST("a device that (re)connects gets every cabled input again");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(0, true, 0.1f);
    box.publish(1, true, 0.2f);
    poll(s, box);
    s.resendAll();
    EXPECT(poll(s, box).size() == 2);
}

static void channelResendsOnlyItsRows() {
    TEST("a device of channel 2 saying hello gets its four rows again, and nothing else is repeated");
    LiveParamsMailbox box;
    LiveParamsSender s;
    for (int k = 0; k < kNumLiveParams; ++k) box.publish(k, true, 0.1f * (float)k);
    poll(s, box);
    s.resendChannel(2);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 4);
    for (size_t i = 0; i < m.size(); ++i) EXPECT(m[i].first == (int)(4 + i));
    s.resendChannel(0);    // out of range: ignored
    s.resendChannel(kNumChannels + 1);
    EXPECT(poll(s, box).empty());
}

static void notANumberIsZero() {
    TEST("NaN and infinity never reach Live");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(0, true, std::nanf(""));
    const Sent m = poll(s, box);
    EXPECT(m.size() == 1 && m[0].second == 0.0f);
}

static void clearChannelReleasesItsRows() {
    TEST("clearChannel() (a node was deleted or changed channel) uncables its four rows and no others");
    LiveParamsMailbox box;
    LiveParamsSender s;
    for (int k = 0; k < kNumLiveParams; ++k) box.publish(k, true, 0.3f);
    poll(s, box);
    box.clearChannel(3);   // rows 8..11
    const Sent m = poll(s, box);
    EXPECT(m.size() == 4);
    for (size_t i = 0; i < m.size(); ++i) EXPECT(m[i].first == (int)(8 + i) && m[i].second == 0.0f);
    box.clearChannel(0);   // out of range: ignored
    box.clearChannel(kNumChannels + 1);
    EXPECT(poll(s, box).empty());
}

static void eightChannelsFit() {
    TEST("eight channels of four rows: the last channel's rows are rows 28..31 and are sent");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(31, true, 0.5f);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 1 && m[0].first == 31 && m[0].second == 0.5f);
    s.resendChannel(kNumChannels);
    EXPECT(poll(s, box).size() == 1);
}


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
    onlyCabledInputsAreSent();
    unchangedValuesAreNotRepeated();
    unpatchingReleases();
    reconnectSendsEverything();
    channelResendsOnlyItsRows();
    notANumberIsZero();
    clearChannelReleasesItsRows();
    eightChannelsFit();
    paramPacket();
    negativeOffset();
    tooSmall();
    ports();
    hello();
    return bleep::test::finish("live-link");
}
