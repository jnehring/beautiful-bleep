// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Live Link, board side: which Live Params rows the sender sends and when (engine/LiveParams.h), and the OSC packets between the
// board and the device (bridges/ableton/LiveLinkOsc.h), so that Max's udpreceive and udpsend read them.
#include "LiveLinkOsc.h"
#include "LiveParams.h"
#include "dsp/tests/TestUtil.h"

#include <cstring>
#include <string>
#include <utility>
#include <vector>

using namespace bleep::patch;
namespace osc = bleep::patch::osc;
using Sent = std::vector<std::pair<int, float>>;

static Sent poll(LiveParamsSender& s, const LiveParamsMailbox& box) {
    Sent out;
    s.poll(box, [&](int k, float v) { out.push_back({k, v}); });
    return out;
}

// ---- the mailbox and what the sender sends -----------------------------------------------------------------------

static void onlyDrivenRowsAreSent() {
    TEST("only rows a node drives are sent, with their value");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(0, 0.25f);
    box.publish(3, 0.75f);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 2);
    EXPECT(m[0].first == 0 && m[0].second == 0.25f);
    EXPECT(m[1].first == 3 && m[1].second == 0.75f);
}

static void unchangedValuesAreNotRepeated() {
    TEST("a value that did not move is not sent again; one that moved is");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(1, 0.5f);
    EXPECT(poll(s, box).size() == 1);
    box.publish(1, 0.5f + 0.0001f);   // inside the deadband
    EXPECT(poll(s, box).empty());
    box.publish(1, 0.6f);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 1 && m[0].second == 0.6f);
}

static void aRowThatIsNoLongerDrivenIsReleased() {
    TEST("a row no node drives any more is sent once as -1, so the device lets the parameter go");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(2, 0.8f);
    box.publish(5, 0.1f);
    poll(s, box);
    box.clearChannel(1);   // rows 0..3
    const Sent m = poll(s, box);
    EXPECT(m.size() == 1 && m[0].first == 2 && m[0].second == kReleased);
    EXPECT(poll(s, box).empty());
}

static void reconnectSendsEverything() {
    TEST("a device that (re)connects gets every driven row again");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(0, 0.1f);
    box.publish(1, 0.2f);
    poll(s, box);
    s.resendAll();
    EXPECT(poll(s, box).size() == 2);
}

static void channelResendsOnlyItsRows() {
    TEST("a device of channel 2 saying hello gets its four rows again, and nothing else is repeated");
    LiveParamsMailbox box;
    LiveParamsSender s;
    for (int k = 0; k < kNumLiveParams; ++k) box.publish(k, 0.1f * (float)(k % 10));
    poll(s, box);
    s.resendChannel(2);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 4);
    for (size_t i = 0; i < m.size(); ++i) EXPECT(m[i].first == (int)(4 + i));
    s.resendChannel(0);    // out of range: ignored
    s.resendChannel(kNumChannels + 1);
    EXPECT(poll(s, box).empty());
}

static void valuesAreSanitised() {
    TEST("NaN is 0 and values are clamped to 0..1, so nothing odd reaches Live");
    LiveParamsMailbox box;
    box.publish(0, std::nanf(""));
    box.publish(1, 1.5f);
    box.publish(2, -3.0f);
    EXPECT(box.value[0].load() == 0.0f && box.value[1].load() == 1.0f && box.value[2].load() == 0.0f);
}

static void clearChannelReleasesItsRows() {
    TEST("clearChannel() (a node was deleted or changed channel) releases its four rows and no others");
    LiveParamsMailbox box;
    LiveParamsSender s;
    for (int k = 0; k < kNumLiveParams; ++k) box.publish(k, 0.3f);
    poll(s, box);
    box.clearChannel(3);   // rows 8..11
    const Sent m = poll(s, box);
    EXPECT(m.size() == 4);
    for (size_t i = 0; i < m.size(); ++i) EXPECT(m[i].first == (int)(8 + i) && m[i].second == kReleased);
    box.clearChannel(0);   // out of range: ignored
    box.clearChannel(kNumChannels + 1);
    EXPECT(poll(s, box).empty());
}

static void eightChannelsFit() {
    TEST("eight channels of four rows: the last channel's rows are rows 28..31 and are sent");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(31, 0.5f);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 1 && m[0].first == 31 && m[0].second == 0.5f);
    s.resendChannel(kNumChannels);
    EXPECT(poll(s, box).size() == 1);
}

static void discreteRows() {
    TEST("a row the device reports as discrete is flagged; the flag can be cleared; out-of-range rows are ignored");
    LiveParamsMailbox box;
    box.setDiscrete(5, true);
    EXPECT(box.isDiscrete(5) && !box.isDiscrete(4) && !box.isDiscrete(6));
    box.setDiscrete(5, false);
    EXPECT(!box.isDiscrete(5));
    box.setDiscrete(-1, true);
    box.setDiscrete(kNumLiveParams, true);
    EXPECT(box.discrete.load() == 0u);
}

static void scaling() {
    TEST("a continuous row's value is scaled into Min..Max: 0 is Min, 1 is Max, Max below Min turns it round");
    EXPECT_NEAR(scaleIntoRange(0.0f, 0.2f, 0.8f), 0.2f, 1e-6);
    EXPECT_NEAR(scaleIntoRange(1.0f, 0.2f, 0.8f), 0.8f, 1e-6);
    EXPECT_NEAR(scaleIntoRange(0.5f, 0.2f, 0.8f), 0.5f, 1e-6);
    EXPECT_NEAR(scaleIntoRange(0.25f, 0.0f, 1.0f), 0.25f, 1e-6);   // the default Min 0, Max 1 changes nothing
    EXPECT_NEAR(scaleIntoRange(0.0f, 0.8f, 0.2f), 0.8f, 1e-6);
    EXPECT_NEAR(scaleIntoRange(1.0f, 0.8f, 0.2f), 0.2f, 1e-6);
    EXPECT_NEAR(scaleIntoRange(2.0f, 0.2f, 0.8f), 0.8f, 1e-6);     // an input beyond the knob's range stays inside Min..Max
    EXPECT_NEAR(scaleIntoRange(-1.0f, 0.2f, 0.8f), 0.2f, 1e-6);
}

// ---- OSC packets -------------------------------------------------------------------------------------------------

/// A hand-made packet, to test what Max would send (whole numbers as ints, names that look like numbers as numbers).
struct Pkt {
    std::vector<uint8_t> b;
    Pkt& str(const std::string& s) {
        for (char c : s) b.push_back((uint8_t)c);
        b.push_back(0);
        while (b.size() % 4) b.push_back(0);
        return *this;
    }
    Pkt& i32(int v) {
        for (int sh = 24; sh >= 0; sh -= 8) b.push_back((uint8_t)((uint32_t)v >> sh));
        return *this;
    }
    Pkt& f32(float v) {
        uint32_t u;
        std::memcpy(&u, &v, 4);
        return i32((int)u);
    }
};

static void paramPacket() {
    TEST("/bleep/param is address, type tags, int32 and float32, padded to 4 bytes, big-endian");
    uint8_t p[64];
    const size_t n = osc::encodeParam(3, 0.5f, p, sizeof(p));
    EXPECT(n == 28);                                   // "/bleep/param\0\0\0\0" 16, ",if\0" 4, 4 + 4
    EXPECT(std::memcmp(p, "/bleep/param", 13) == 0 && p[13] == 0 && p[15] == 0);
    EXPECT(std::memcmp(p + 16, ",if\0", 4) == 0);
    EXPECT(p[20] == 0 && p[21] == 0 && p[22] == 0 && p[23] == 3);
    EXPECT(p[24] == 0x3f && p[25] == 0x00 && p[26] == 0 && p[27] == 0);   // 0.5f = 0x3f000000
    EXPECT(n % 4 == 0);
}

static void releasePacket() {
    TEST("the release value -1 is 0xbf800000 on the wire");
    uint8_t p[64];
    const size_t n = osc::encodeParam(15 % 4, kReleased, p, sizeof(p));
    EXPECT(n == 28);
    EXPECT(p[24] == 0xbf && p[25] == 0x80 && p[26] == 0 && p[27] == 0);
}

static void tooSmall() {
    TEST("a buffer that is too small gets nothing, never an overrun");
    uint8_t p[64];
    EXPECT(osc::encodeParam(0, 0.0f, p, 16) == 0);
    EXPECT(osc::encodeParam(0, 0.0f, p, 27) == 0);
    EXPECT(osc::encodeParam(0, 0.0f, p, 28) == 28);
}

static void ports() {
    TEST("input k goes to its channel's port, as row k % 4");
    EXPECT(osc::devicePort(0) == 9871 && osc::rowOf(0) == 0);
    EXPECT(osc::devicePort(3) == 9871 && osc::rowOf(3) == 3);
    EXPECT(osc::devicePort(4) == 9872 && osc::rowOf(4) == 0);
    EXPECT(osc::devicePort(31) == 9878 && osc::rowOf(31) == 3);   // channel 8
    EXPECT(osc::kBoardPort != osc::devicePort(0) && osc::kBoardPort != osc::devicePort(kNumLiveParams - 1));
}

static void hello() {
    TEST("/bleep/hello <channel> is encoded and recognised; other packets are not");
    uint8_t h[64];
    const size_t n = osc::encodeHello(3, h, sizeof(h));
    EXPECT(n == 24);
    EXPECT(std::memcmp(h + 16, ",i\0\0", 4) == 0);
    int channel = 0;
    EXPECT(osc::parseHello(h, n, channel) && channel == 3);
    EXPECT(!osc::parseHello(h, 23, channel));              // too short
    EXPECT(!osc::parseHello(nullptr, 0, channel));
    uint8_t other[64] = {};
    std::memcpy(other, "/bleep/helloo", 14);
    EXPECT(!osc::parseHello(other, sizeof(other), channel));   // a NUL must follow the address
    uint8_t param[64];
    const size_t m = osc::encodeParam(1, 0.5f, param, sizeof(param));
    EXPECT(!osc::parseHello(param, m, channel));
    EXPECT(osc::encodeHello(1, h, 23) == 0);
}

static osc::RowInfo continuousInfo() {
    osc::RowInfo r;
    r.channel = 2;
    r.row = 1;
    r.kind = "continuous";
    r.name = "Frequency";
    r.current = 0.25f;
    r.min = 0.0f;
    r.max = 1.0f;
    r.adopt = true;
    return r;
}

static void infoRoundTrip() {
    TEST("/bleep/info for a continuous parameter survives encode and parse");
    uint8_t p[512];
    const osc::RowInfo in = continuousInfo();
    const size_t n = osc::encodeInfo(in, p, sizeof(p));
    EXPECT(n > 0 && n % 4 == 0);
    osc::RowInfo out;
    EXPECT(osc::parseInfo(p, n, out));
    EXPECT(out.channel == 2 && out.row == 1 && out.kind == "continuous" && out.name == "Frequency");
    EXPECT(out.current == 0.25f && out.min == 0.0f && out.max == 1.0f && out.adopt && out.items.empty());
}

static void infoWithItems() {
    TEST("a discrete parameter carries its item names, in order, names with spaces included");
    uint8_t p[512];
    osc::RowInfo in = continuousInfo();
    in.kind = "discrete";
    in.name = "Filter Type";
    in.adopt = false;
    in.max = 3.0f;
    in.items = {"Lowpass", "High Pass", "Bandpass", "Notch"};
    const size_t n = osc::encodeInfo(in, p, sizeof(p));
    osc::RowInfo out;
    EXPECT(osc::parseInfo(p, n, out));
    EXPECT(out.name == "Filter Type" && out.max == 3.0f && !out.adopt);
    EXPECT(out.items.size() == 4 && out.items[1] == "High Pass" && out.items[3] == "Notch");
}

static void infoNone() {
    TEST("a row that is no longer mapped says kind none, and nothing else is needed");
    uint8_t p[128];
    osc::RowInfo in;
    in.channel = 4;
    in.row = 3;
    in.kind = "none";
    const size_t n = osc::encodeInfo(in, p, sizeof(p));
    osc::RowInfo out;
    EXPECT(osc::parseInfo(p, n, out) && out.kind == "none" && out.channel == 4 && out.row == 3 && out.name.empty());
}

static void infoFromMaxIsReadLeniently() {
    TEST("Max sends whole numbers as ints: the numbers are read as either, and a name or item like 4 as text");
    // channel 1, row 0, "discrete", "Sync", current 1 (an int), min 0.0, max 3 (an int), adopt 1, items "1/4" "1/8"
    Pkt p;
    p.str("/bleep/info").str(",iissifiiss").i32(1).i32(0).str("discrete").str("Sync").i32(1).f32(0.0f).i32(3).i32(1).str("1/4").str("1/8");
    osc::RowInfo out;
    EXPECT(osc::parseInfo(p.b.data(), p.b.size(), out));
    EXPECT(out.name == "Sync" && out.current == 1.0f && out.min == 0.0f && out.max == 3.0f && out.adopt);
    EXPECT(out.items.size() == 2 && out.items[0] == "1/4" && out.items[1] == "1/8");
    // item names that Max turned into numbers: 4, 8 and 2.5; and a name that is a number too
    Pkt q;
    q.str("/bleep/info").str(",iisifffiiif").i32(1).i32(2).str("discrete").i32(7).f32(0).f32(0).f32(2).i32(0).i32(4).i32(8).f32(2.5f);
    osc::RowInfo o2;
    EXPECT(osc::parseInfo(q.b.data(), q.b.size(), o2));
    EXPECT(o2.name == "7");
    EXPECT(o2.items.size() == 3 && o2.items[0] == "4" && o2.items[1] == "8" && o2.items[2] == "2.5");
}

static void infoRejectsBadPackets() {
    TEST("anything that is not a well-formed /bleep/info is ignored, never read past its end");
    uint8_t p[512];
    const size_t n = osc::encodeInfo(continuousInfo(), p, sizeof(p));
    osc::RowInfo out;
    for (size_t cut = 0; cut < n; ++cut) EXPECT(!osc::parseInfo(p, cut, out) || cut >= n - 3);   // a truncated packet is refused
    EXPECT(!osc::parseInfo(nullptr, 0, out));
    uint8_t other[64];
    const size_t m = osc::encodeHello(1, other, sizeof(other));
    EXPECT(!osc::parseInfo(other, m, out));                 // another address
    osc::RowInfo bad = continuousInfo();
    bad.row = 4;
    uint8_t q[512];
    EXPECT(!osc::parseInfo(q, osc::encodeInfo(bad, q, sizeof(q)), out));   // row out of range
    bad = continuousInfo();
    bad.channel = 9;
    EXPECT(!osc::parseInfo(q, osc::encodeInfo(bad, q, sizeof(q)), out));   // channel out of range
    bad = continuousInfo();
    bad.kind = "banana";
    EXPECT(!osc::parseInfo(q, osc::encodeInfo(bad, q, sizeof(q)), out));   // unknown kind
    Pkt blob;
    blob.str("/bleep/info").str(",iib").i32(1).i32(0);
    EXPECT(!osc::parseInfo(blob.b.data(), blob.b.size(), out));            // an argument type this protocol does not use
}

static void infoAsJson() {
    TEST("the info becomes the JSON the engine takes, with strings escaped");
    osc::RowInfo in = continuousInfo();
    in.kind = "discrete";
    in.name = "Say \"hi\"\\there";
    in.items = {"a", "b\"c"};
    const std::string j = osc::infoToJson(in);
    EXPECT(j.find("\"kind\":\"discrete\"") != std::string::npos);
    EXPECT(j.find("\"name\":\"Say \\\"hi\\\"\\\\there\"") != std::string::npos);
    EXPECT(j.find("\"current\":0.25") != std::string::npos);
    EXPECT(j.find("\"adopt\":true") != std::string::npos);
    EXPECT(j.find("\"items\":[\"a\",\"b\\\"c\"]") != std::string::npos);
    osc::RowInfo none;
    none.kind = "none";
    EXPECT(osc::infoToJson(none) == "{\"kind\":\"none\"}");
}

int main() {
    onlyDrivenRowsAreSent();
    unchangedValuesAreNotRepeated();
    aRowThatIsNoLongerDrivenIsReleased();
    reconnectSendsEverything();
    channelResendsOnlyItsRows();
    valuesAreSanitised();
    clearChannelReleasesItsRows();
    eightChannelsFit();
    discreteRows();
    scaling();
    paramPacket();
    releasePacket();
    tooSmall();
    ports();
    hello();
    infoRoundTrip();
    infoWithItems();
    infoNone();
    infoFromMaxIsReadLeniently();
    infoRejectsBadPackets();
    infoAsJson();
    return bleep::test::finish("live-link");
}
