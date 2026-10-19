// SPDX-License-Identifier: GPL-3.0-or-later
// OSC Bridge: packet encoding and decoding (messages, bundles, malformed input), address
// patterns, the message log, receive lanes (value, gate, trigger, ranges, smoothing) and
// send lanes (rate limit, gate, trigger) (doc/specs/modules/osc-bridge.md §8).
#include "OscBridgeDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <cstring>
#include <string>
#include <vector>

using namespace bleep;
using namespace bleep::patch;

static void put32(std::vector<uint8_t>& v, uint32_t u) {
    v.push_back((uint8_t)(u >> 24)); v.push_back((uint8_t)(u >> 16)); v.push_back((uint8_t)(u >> 8)); v.push_back((uint8_t)u);
}
static void putStr(std::vector<uint8_t>& v, const std::string& s) {
    for (char c : s) v.push_back((uint8_t)c);
    v.push_back(0);
    while (v.size() % 4) v.push_back(0);
}
static std::vector<uint8_t> msg(const std::string& addr, const std::string& tags, std::vector<uint32_t> words = {}) {
    std::vector<uint8_t> v;
    putStr(v, addr);
    putStr(v, "," + tags);
    for (uint32_t w : words) put32(v, w);
    return v;
}
static uint32_t bits(float f) { uint32_t u; std::memcpy(&u, &f, 4); return u; }

static void decodes() {
    TEST("decode");
    osc::Message m;
    auto p = msg("/mixer/1/fader", "f", {bits(0.25f)});
    EXPECT(osc::decodeMessage(p.data(), p.size(), m));
    EXPECT(std::string(m.address) == "/mixer/1/fader" && m.argc == 1 && m.args[0] == 0.25f);
    p = msg("/a", "ifT", {(uint32_t)-3, bits(1.5f)});
    EXPECT(osc::decodeMessage(p.data(), p.size(), m));
    EXPECT(m.argc == 3 && m.args[0] == -3.0f && m.args[1] == 1.5f && m.args[2] == 1.0f);
    p = msg("/s", "sf");  // a string, then a float: the string is skipped
    std::vector<uint8_t> q;
    putStr(q, "/s"); putStr(q, ",sf"); putStr(q, "hello"); put32(q, bits(2.0f));
    EXPECT(osc::decodeMessage(q.data(), q.size(), m));
    EXPECT(m.argc == 1 && m.args[0] == 2.0f);
    p = msg("/n", "f", {bits(NAN)});
    EXPECT(osc::decodeMessage(p.data(), p.size(), m) && m.args[0] == 0.0f);
    p = msg("/none", "");
    EXPECT(osc::decodeMessage(p.data(), p.size(), m) && m.argc == 0);
}

static void rejectsMalformed() {
    TEST("malformed packets");
    osc::Message m;
    auto p = msg("/a", "f", {bits(1.0f)});
    EXPECT(!osc::decodeMessage(p.data(), p.size() - 2, m));          // truncated argument
    EXPECT(!osc::decodeMessage(p.data(), 3, m));                      // no terminator
    const uint8_t junk[8] = {'x', 0, 0, 0, ',', 'f', 0, 0};
    EXPECT(!osc::decodeMessage(junk, 8, m));                          // no leading slash
    std::string longAddr = "/" + std::string(200, 'a');
    auto lp = msg(longAddr, "f", {bits(1.0f)});
    EXPECT(!osc::decodeMessage(lp.data(), lp.size(), m));
    int n = 0;
    osc::decodePacket(junk, 8, [&](const osc::Message&) { ++n; });
    EXPECT(n == 0);
}

static void bundles() {
    TEST("bundles");
    std::vector<uint8_t> b;
    putStr(b, "#bundle");
    put32(b, 0); put32(b, 1);
    const auto a = msg("/one", "f", {bits(1.0f)}), c = msg("/two", "f", {bits(2.0f)});
    put32(b, (uint32_t)a.size());
    b.insert(b.end(), a.begin(), a.end());
    // a nested bundle with one message
    std::vector<uint8_t> inner;
    putStr(inner, "#bundle");
    put32(inner, 0); put32(inner, 1);
    put32(inner, (uint32_t)c.size());
    inner.insert(inner.end(), c.begin(), c.end());
    put32(b, (uint32_t)inner.size());
    b.insert(b.end(), inner.begin(), inner.end());
    std::vector<std::string> seen;
    osc::decodePacket(b.data(), b.size(), [&](const osc::Message& m) { seen.push_back(m.address); });
    EXPECT(seen.size() == 2 && seen[0] == "/one" && seen[1] == "/two");
    // a bundle whose element length runs past the end stops without reading beyond it
    b[b.size() - 1 - inner.size() - 3] = 0x7f;
    seen.clear();
    osc::decodePacket(b.data(), b.size(), [&](const osc::Message& m) { seen.push_back(m.address); });
    EXPECT(seen.size() <= 1);
}

static void encodeRoundTrip() {
    TEST("encode");
    uint8_t buf[128];
    const float args[2] = {0.5f, -2.0f};
    const size_t n = osc::encode("/synth/cutoff", args, 2, buf, sizeof buf);
    EXPECT(n > 0 && n % 4 == 0);
    osc::Message m;
    EXPECT(osc::decodeMessage(buf, n, m));
    EXPECT(std::string(m.address) == "/synth/cutoff" && m.argc == 2 && m.args[0] == 0.5f && m.args[1] == -2.0f);
    EXPECT(osc::encode("/x", args, 2, buf, 8) == 0);   // does not fit
    EXPECT(osc::encode("x", args, 2, buf, 64) == 0);   // not an address
}

static void patterns() {
    TEST("address patterns");
    EXPECT(osc::match("/a/b", "/a/b"));
    EXPECT(!osc::match("/a/b", "/a/c"));
    EXPECT(!osc::match("/a/b", "/a/b/c"));
    EXPECT(!osc::match("/a/b/c", "/a/b"));
    EXPECT(osc::match("/a/*", "/a/anything"));
    EXPECT(!osc::match("/a/*", "/a/x/y"));
    EXPECT(osc::match("/fader/?", "/fader/7"));
    EXPECT(!osc::match("/fader/?", "/fader/12"));
    EXPECT(osc::match("/fader/[1-4]", "/fader/3"));
    EXPECT(!osc::match("/fader/[1-4]", "/fader/5"));
    EXPECT(osc::match("/fader/[!1-4]", "/fader/5"));
    EXPECT(osc::match("/ch/{red,green}/level", "/ch/green/level"));
    EXPECT(!osc::match("/ch/{red,green}/level", "/ch/blue/level"));
    EXPECT(osc::match("/x/f*r", "/x/fader"));
    EXPECT(osc::match("/x/*ader", "/x/fader"));
    EXPECT(osc::match("/", "/"));
    EXPECT(!osc::match("", "/a"));
    EXPECT(!osc::match("/a", ""));
}

static void logReads() {
    TEST("message log");
    static osc::Log log;
    uint64_t cursor = log.head();
    osc::Message m, out;
    EXPECT(!log.read(cursor, out));
    for (int i = 0; i < 3; ++i) {
        std::snprintf(m.address, sizeof m.address, "/m/%d", i);
        log.push(m);
    }
    for (int i = 0; i < 3; ++i) {
        EXPECT(log.read(cursor, out));
        EXPECT(std::string(out.address) == "/m/" + std::to_string(i));
    }
    EXPECT(!log.read(cursor, out));
    uint64_t late = log.head();
    for (int i = 0; i < 1000; ++i) {
        std::snprintf(m.address, sizeof m.address, "/n/%d", i);
        log.push(m);
        if (i == 0) late = cursor;
    }
    // A reader that fell far behind skips to the newest ones, in order.
    int seen = 0, lastIdx = -1;
    while (log.read(cursor, out)) {
        ++seen;
        lastIdx = std::atoi(out.address + 3);
    }
    EXPECT(seen == (int)osc::Log::kSize && lastIdx == 999);
    (void)late;
}

static OscBridgeConfig config() {
    OscBridgeConfig c;
    std::strcpy(c.receive[0].pattern, "/fader/1");
    std::strcpy(c.receive[1].pattern, "/btn/*");
    c.receive[1].mode = OscReceiveGate;
    std::strcpy(c.receive[2].pattern, "/hit");
    c.receive[2].mode = OscReceiveTrigger;
    std::strcpy(c.receive[3].pattern, "/pan");
    c.receive[3].lo = -50.0f; c.receive[3].hi = 50.0f; c.receive[3].bipolar = true; c.receive[3].smooth = 0.0f;
    return c;
}
static osc::Message make(const char* addr, std::initializer_list<float> a) {
    osc::Message m;
    std::strcpy(m.address, addr);
    for (float f : a) m.args[m.argc++] = f;
    return m;
}
static void settle(OscBridgeDsp& d, const OscBridgeConfig& c, int lane, int n, float* last) {
    for (int i = 0; i < n; ++i) *last = d.receive(c, lane);
}

static void receiveValue() {
    TEST("value lanes: range, smoothing, bipolar");
    OscBridgeDsp d;
    d.prepare(48000.0);
    const auto c = config();
    float v = 0.0f;
    d.onMessage(c, make("/fader/1", {0.75f}));
    d.onMessage(c, make("/fader/2", {1.0f}));  // other address: ignored
    settle(d, c, 0, 24000, &v);
    EXPECT_NEAR(v, 0.75, 1e-3);
    d.onMessage(c, make("/fader/1", {5.0f}));  // out of range: clamped
    settle(d, c, 0, 24000, &v);
    EXPECT_NEAR(v, 1.0, 1e-3);
    d.onMessage(c, make("/pan", {-25.0f}));
    settle(d, c, 3, 4, &v);
    EXPECT_NEAR(v, -0.5, 1e-6);  // no smoothing: at once
    // Smoothing: after one time constant a fader is at 63 %.
    OscBridgeDsp e;
    e.prepare(48000.0);
    e.onMessage(c, make("/fader/1", {1.0f}));
    settle(e, c, 0, 480, &v);
    EXPECT(v > 0.55f && v < 0.72f);
}

static void receiveGateAndTrigger() {
    TEST("gate and trigger lanes");
    OscBridgeDsp d;
    d.prepare(48000.0);
    const auto c = config();
    float v = 0.0f;
    d.onMessage(c, make("/btn/3", {1.0f}));
    settle(d, c, 1, 10, &v);
    EXPECT(v == 1.0f);
    settle(d, c, 1, 48000, &v);
    EXPECT(v == 1.0f);  // holds until told otherwise
    d.onMessage(c, make("/btn/3", {0.0f}));
    settle(d, c, 1, 1, &v);
    EXPECT(v == 0.0f);
    d.onMessage(c, make("/btn/3", {}));  // no argument: a short gate
    settle(d, c, 1, 100, &v);
    EXPECT(v == 1.0f);
    settle(d, c, 1, 1000, &v);
    EXPECT(v == 0.0f);
    d.onMessage(c, make("/hit", {0.0f}));
    int high = 0;
    for (int i = 0; i < 1000; ++i) high += d.receive(c, 2) > 0.5f;
    EXPECT(high > 50 && high < 200);
}

static OscBridgeConfig sendConfig() {
    OscBridgeConfig c;
    std::strcpy(c.send[0].address, "/synth/cutoff");
    c.send[0].lo = 20.0f; c.send[0].hi = 20000.0f; c.send[0].rate = 100.0f;
    std::strcpy(c.send[1].address, "/gate");
    c.send[1].mode = OscSendGate;
    std::strcpy(c.send[2].address, "/go");
    c.send[2].mode = OscSendTrigger;
    return c;
}
static std::vector<OscOutgoing> drain(OscOutQueue& q) {
    std::vector<OscOutgoing> v;
    OscOutgoing m;
    while (q.pop(m)) v.push_back(m);
    return v;
}

static void sendValue() {
    TEST("value send lane: first value, changes only, rate limit");
    OscBridgeDsp d;
    d.prepare(48000.0);
    const auto c = sendConfig();
    OscOutQueue q;
    for (int i = 0; i < 4800; ++i) d.send(c, 0, 0.5f, q);  // constant: one message
    auto got = drain(q);
    EXPECT(got.size() == 1);
    EXPECT(std::string(got[0].address) == "/synth/cutoff");
    EXPECT_NEAR(got[0].value, 20.0f + 0.5f * 19980.0f, 0.5);
    // A fast sweep over 0.1 s at 100 Hz: about ten messages, the last one is the final value.
    for (int i = 0; i < 4800; ++i) d.send(c, 0, 0.5f + 0.5f * (float)i / 4799.0f, q);
    for (int i = 0; i < 1000; ++i) d.send(c, 0, 1.0f, q);
    got = drain(q);
    EXPECT(got.size() >= 8 && got.size() <= 14);
    EXPECT_NEAR(got.back().value, 20000.0f, 1.0);
    // Bipolar cable.
    OscBridgeConfig b = sendConfig();
    b.send[0].bipolar = true;
    OscBridgeDsp e;
    e.prepare(48000.0);
    e.send(b, 0, -1.0f, q);
    EXPECT_NEAR(drain(q)[0].value, 20.0f, 1e-3);
}

static void sendGateAndTrigger() {
    TEST("gate and trigger send lanes");
    OscBridgeDsp d;
    d.prepare(48000.0);
    const auto c = sendConfig();
    OscOutQueue q;
    for (int i = 0; i < 100; ++i) { d.send(c, 1, 0.0f, q); d.send(c, 2, 0.0f, q); }
    EXPECT(drain(q).empty());
    for (int i = 0; i < 100; ++i) { d.send(c, 1, 1.0f, q); d.send(c, 2, 1.0f, q); }
    for (int i = 0; i < 100; ++i) { d.send(c, 1, 0.0f, q); d.send(c, 2, 0.0f, q); }
    auto got = drain(q);
    int gate = 0, go = 0;
    for (auto& m : got) {
        if (std::string(m.address) == "/gate") gate += m.value > 0.5f ? 1 : 100;
        if (std::string(m.address) == "/go") ++go;
    }
    EXPECT(gate == 101);  // one on, one off
    EXPECT(go == 1);
}

static void queueFull() {
    TEST("a full queue drops, never blocks");
    OscOutQueue q;
    OscOutgoing m;
    int pushed = 0;
    for (int i = 0; i < 1000; ++i) pushed += q.push(m);
    EXPECT(pushed == (int)OscOutQueue::kSize);
    EXPECT(q.pop(m));
    EXPECT(q.push(m));
}

int main() {
    decodes();
    rejectsMalformed();
    bundles();
    encodeRoundTrip();
    patterns();
    logReads();
    receiveValue();
    receiveGateAndTrigger();
    sendValue();
    sendGateAndTrigger();
    queueFull();
    return test::finish("osc-bridge");
}
