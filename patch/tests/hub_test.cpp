// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Web hub test (doc/specs/bridges.md §10): a real WebHub and engine, a raw WebSocket client standing in for the
// browser, and BridgeClients standing in for Live's plugins. Covers the three jobs of the hub: Bleep Play pages' own
// nodes in the app (audio and MIDI loop back through the app's board), Live ports with Board = Bleep Play (audio and MIDI
// to the web and back, beat-stamped MIDI landing on the right sample, round-trip latency reported), and sync.
#include "BridgeClient.h"
#include "BridgeServer.h"
#include "WebHub.h"
#include "WsTestClient.h"

#include <atomic>
#include <cstdio>
#include <set>
#include <cstring>
#include <thread>

namespace bleep::engine {
std::unique_ptr<BoardUi> createBoardUi(Engine&) { return nullptr; }
}  // namespace bleep::engine

using namespace bleep;
using namespace bleep::hub;
using namespace bleep::hub::test;

static int g_failures = 0;
#define EXPECT(cond)                                                      \
    do {                                                                  \
        if (!(cond)) {                                                    \
            std::printf("FAILED %s:%d: %s\n", __FILE__, __LINE__, #cond); \
            ++g_failures;                                                 \
        }                                                                 \
    } while (0)

namespace {

constexpr int kBlock = 128;

juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> props) {
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}

std::string js(const juce::var& v) { return juce::JSON::toString(v, true).toStdString(); }

/// One MIDI event as the web sends it: [beat, status, d1, d2], in a list of one.
juce::var oneEvent(double beat, int status, int d1, int d2) {
    juce::Array<juce::var> e;
    e.add(beat);
    e.add(status);
    e.add(d1);
    e.add(d2);
    juce::Array<juce::var> list;
    list.add(juce::var(e));
    return juce::var(list);
}

/// The browser's side: handshake, hello, and reading what the hub sends.
struct Web {
    Client c;
    std::vector<juce::var> texts;
    std::vector<std::vector<float>> audio[256];   ///< per channel: packets (left then right)
    std::map<int, int> audioSeen;
    bool closed = false;   ///< the hub sent a close frame
    int epoch = 0;   ///< the newest epoch the hub announced (welcome, sync, flush): what a sequencer stamps its MIDI with
    bool connect(int port, const std::string& name) {
        if (!c.connect(port)) return false;
        if (c.handshake("http://127.0.0.1:" + std::to_string(port), port) != 101) return false;
        c.sendFrame(1, js(obj({{"op", "hello"}, {"v", 1}, {"id", juce::String("web-") + juce::String(name)},
                               {"name", juce::String(name)}, {"sampleRate", 48000}, {"quantum", 128},
                               {"mode", "low"}})));
        return true;
    }
    void send(const juce::var& v) { c.sendFrame(1, js(v)); }
    void sendAudio(int ch, const float* l, const float* r, int n, uint32_t seq) {
        std::string p((size_t)(16 + 8 * n), '\0');
        p[0] = 1;
        p[1] = (char)ch;
        const uint16_t f = (uint16_t)n;
        std::memcpy(&p[2], &f, 2);
        std::memcpy(&p[4], &seq, 4);
        std::memcpy(&p[16], l, 4 * (size_t)n);
        std::memcpy(&p[16 + 4 * (size_t)n], r, 4 * (size_t)n);
        c.sendFrame(2, p);
    }
    /// Reads whatever is waiting.
    void pump(int ms = 1) {
        Frame f;
        while (c.readFrame(f, ms)) {
            if (f.op == 8) closed = true;
            if (f.op == 1) {
                texts.push_back(juce::JSON::parse(juce::String(f.payload)));
                const auto& m = texts.back();
                const juce::String op = m["op"].toString();
                if (op == "welcome" || op == "sync" || op == "flush") epoch = std::max(epoch, (int)m["epoch"]);
            }
            else if (f.op == 2 && f.payload.size() >= 16 && (uint8_t)f.payload[0] == 1) {
                const int ch = (uint8_t)f.payload[1];
                uint16_t n;
                std::memcpy(&n, &f.payload[2], 2);
                std::vector<float> d((size_t)2 * n);
                std::memcpy(d.data(), &f.payload[16], 8 * (size_t)n);
                audio[ch].push_back(std::move(d));
                ++audioSeen[ch];
            }
            ms = 1;
        }
    }
    juce::var firstText(const char* op, int from = 0) {
        for (size_t i = (size_t)from; i < texts.size(); ++i)
            if (texts[i]["op"].toString() == op) return texts[i];
        return {};
    }
    std::vector<juce::var> allText(const char* op) {
        std::vector<juce::var> r;
        for (auto& t : texts)
            if (t["op"].toString() == op) r.push_back(t);
        return r;
    }
};

bool waitFor(const std::function<bool()>& pred, int ms = 3000) {
    const int64_t end = nowMs() + ms;
    while (nowMs() < end) {
        if (pred()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    return pred();
}

engine::Transport transportAt(double ppq, bool playing = true, double bpm = 120.0) {
    engine::Transport t;
    t.sampleRate = 48000.0;
    t.bpm = bpm;
    t.ppq = ppq;
    t.ppqValid = true;
    t.playing = playing;
    return t;
}

/// The app's own driver for the web nodes: collect, process, after.
void driveApp(engine::Engine& engine, WebHub& hub, const engine::Transport& t, int n = kBlock) {
    std::vector<int> handles;
    std::vector<engine::BlockIO*> ios;
    hub.collect(t, n, handles, ios);
    if (!handles.empty()) engine.processAll(handles.data(), ios.data(), (int)handles.size());
    hub.after(handles, ios);
}

juce::String nodeOfPort(const juce::var& board, const juce::String& portPrefix) {
    for (const auto& n : *board["nodes"].getArray())
        if (n["port"].toString().startsWith(portPrefix)) return n["id"].toString();
    return {};
}

void addCable(juce::var& board, const juce::String& a, const char* aj, const juce::String& b, const char* bj) {
    board["cables"].getArray()->add(
        obj({{"from", obj({{"node", a}, {"jack", aj}})}, {"to", obj({{"node", b}, {"jack", bj}})}, {"amount", 1.0}}));
}

// A web node with dir "both": its audio goes through the app's board (Send patched to Return) and comes back.
void testWebNodes(engine::Engine& engine, WebHub& hub, int port) {
    Web web;
    EXPECT(web.connect(port, "Chrome"));
    EXPECT(waitFor([&] { web.pump(5); return web.firstText("welcome").isObject(); }));
    web.send(obj({{"op", "open"}, {"key", "remote-audio-1"}, {"kind", "audio"}, {"dir", "both"}, {"name", "Remote Audio"}}));
    web.send(obj({{"op", "open"}, {"key", "remote-midi-1"}, {"kind", "midi"}, {"dir", "both"}, {"name", "Remote MIDI"}}));
    EXPECT(waitFor([&] { web.pump(5); return web.allText("channel").size() >= 4; }));
    int audioFrom = -1, audioTo = -1, midiFrom = -1, midiTo = -1;
    for (const auto& m : web.allText("channel")) {
        const bool audio = m["kind"].toString() == "audio", to = m["dir"].toString() == "toWeb";
        (audio ? (to ? audioTo : audioFrom) : (to ? midiTo : midiFrom)) = (int)m["ch"];
    }
    EXPECT(audioFrom >= 0 && audioTo >= 0 && midiFrom >= 0 && midiTo >= 0);

    hub.poll();
    engine.reconcileNow();
    const auto board = engine.board();
    int webNodes = 0;
    for (const auto& n : *board["nodes"].getArray())
        if (n["name"].toString().startsWith("Web: ")) ++webNodes;
    std::printf("web nodes on the app's board: %d\n", webNodes);
    EXPECT(webNodes == 3);  // an audio bridge, a MIDI device and a MIDI out

    juce::String bridgeNode, deviceNode, midiOutNode;
    for (const auto& n : *board["nodes"].getArray()) {
        if (n["type"].toString() == "audio-bridge") bridgeNode = n["id"].toString();
        if (n["type"].toString() == "midi-device") deviceNode = n["id"].toString();
        if (n["type"].toString() == "midi-out") midiOutNode = n["id"].toString();
    }
    EXPECT(bridgeNode.isNotEmpty() && deviceNode.isNotEmpty() && midiOutNode.isNotEmpty());
    auto edited = engine::board::fromJson(engine::board::toJson(board));
    addCable(edited, bridgeNode, "l", bridgeNode, "l");
    addCable(edited, bridgeNode, "r", bridgeNode, "r");
    addCable(edited, deviceNode, "notes", midiOutNode, "notes");
    engine.commit(edited, "web loop");

    // Audio: a ramp in, the same ramp out, delayed by the jitter buffer (16 ms) and nothing else.
    std::vector<float> in(kBlock), out;
    uint32_t seq = 0;
    std::vector<float> sent;
    for (int blk = 0; blk < 200; ++blk) {
        for (int i = 0; i < kBlock; ++i) in[(size_t)i] = (float)(blk * kBlock + i + 1) * 1e-4f;
        web.sendAudio(audioFrom, in.data(), in.data(), kBlock, seq++);
        sent.insert(sent.end(), in.begin(), in.end());
        if (blk < 8) continue;  // let the buffer fill: nothing is consumed before it holds the target
        if (blk == 8) std::this_thread::sleep_for(std::chrono::milliseconds(50));
        driveApp(engine, hub, transportAt(blk * 0.002667));
        web.pump(1);
    }
    web.pump(50);
    for (const auto& p : web.audio[audioTo]) out.insert(out.end(), p.begin(), p.begin() + kBlock);
    int zeros = 0;
    for (float v : out) zeros += v == 0.0f ? 1 : 0;
    EXPECT(out.size() >= (size_t)kBlock * 150);
    // The last half second of output must be the input ramp (slope 1e-4 per sample, within the 0.5 % nudge).
    double slope = 0.0;
    int counted = 0;
    for (size_t i = out.size() - 4000; i + 1 < out.size(); ++i) {
        slope += out[i + 1] - out[i];
        ++counted;
    }
    slope /= counted;
    std::printf("web audio loop: %zu frames back, slope %.3e (want 1e-4), %d silent\n", out.size(), slope, zeros);
    EXPECT(std::fabs(slope - 1e-4) < 1e-4 * 0.02);

    // MIDI: a note from the web goes to the board's MIDI Device node, patched to MIDI Out, and back to the web.
    web.texts.clear();
    web.send(obj({{"op", "midi"}, {"ch", midiFrom}, {"epoch", web.epoch},
                  {"ev", oneEvent(-1.0, 144, 62, 90)}}));
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    bool back = false;
    for (int blk = 0; blk < 20 && !back; ++blk) {
        driveApp(engine, hub, transportAt(10.0 + blk * 0.002667));
        web.pump(2);
        for (const auto& m : web.allText("midi")) {
            const auto* ev = m["ev"].getArray();
            if (ev && !ev->isEmpty() && (int)m["ch"] == midiTo) {
                const auto* e = (*ev)[0].getArray();
                back = e && (int)(*e)[1] == 144 && (int)(*e)[2] == 62 && (int)(*e)[3] == 90;
            }
        }
    }
    EXPECT(back);

    // Closing Bleep Play leaves ghosts: the nodes stay with their cables.
    web.c.sendFrame(8, std::string("\x03\xe8", 2));
    web.c.close();
    EXPECT(waitFor([&] { return hub.numPeers() == 0; }));
    hub.poll();
    engine.reconcileNow();
    int cables = (int)engine.board()["cables"].getArray()->size();
    EXPECT(cables == 3);
}

// Live ports with Board = Bleep Play: Audio In → web → Audio Out, and MIDI both ways with beats.
void testLiveSlots(engine::Engine& engine, WebHub& hub, bridge::BridgeServer& server, int port) {
    using engine::PortKind;
    auto kindOf = [](PortKind k) { return (uint32_t)k; };
    bridge::BridgeClient audioIn, audioOut, midiIn, midiOut;
    audioIn.setIdentity("bbbbbbbb-0000-0000-0000-000000000001", "Guitar");
    audioOut.setIdentity("bbbbbbbb-0000-0000-0000-000000000002", "Web Synth");
    midiIn.setIdentity("bbbbbbbb-0000-0000-0000-000000000003", "Keys");
    midiOut.setIdentity("bbbbbbbb-0000-0000-0000-000000000004", "Web Sequencer");
    audioIn.setPort(kindOf(PortKind::AudioIn), bridge::Board::Web);
    audioOut.setPort(kindOf(PortKind::AudioOut), bridge::Board::Web);
    midiIn.setPort(kindOf(PortKind::MidiIn), bridge::Board::Web);
    midiOut.setPort(kindOf(PortKind::MidiOut), bridge::Board::Web);

    Web web;
    EXPECT(web.connect(port, "Firefox"));
    EXPECT(waitFor([&] { web.pump(5); return web.firstText("welcome").isObject(); }));
    server.poll();
    for (auto* c : {&audioIn, &audioOut, &midiIn, &midiOut}) {
        c->prepare(48000.0, kBlock);
        EXPECT(c->poll() == bridge::BridgeClient::Status::Connected);
    }
    server.poll();
    EXPECT(waitFor([&] { web.pump(5); return web.allText("channel").size() >= 4; }));
    int chAudioTo = -1, chAudioFrom = -1, chMidiTo = -1, chMidiFrom = -1;
    for (const auto& m : web.allText("channel")) {
        if (m["source"].toString() != "live") continue;
        const bool audio = m["kind"].toString() == "audio", to = m["dir"].toString() == "toWeb";
        EXPECT(m["name"].toString().startsWith("Live: "));
        (audio ? (to ? chAudioTo : chAudioFrom) : (to ? chMidiTo : chMidiFrom)) = (int)m["ch"];
    }
    EXPECT(chAudioTo >= 0 && chAudioFrom >= 0 && chMidiTo >= 0 && chMidiFrom >= 0);
    // No node for them on the app's board: the relay is a pass-through.
    engine.reconcileNow();
    EXPECT(nodeOfPort(engine.board(), "bbbbbbbb").isEmpty());

    // Lockstep, offline (every plugin waits for the app). The web echoes the audio it gets back to Audio Out.
    constexpr int kBlocks = 400;
    std::vector<float> ramp(kBlock), ret(kBlock), outAll;
    uint32_t seq = 0;
    std::vector<bridge::Midi> sentMidi;
    int64_t pos = 1 << 22;
    std::vector<std::pair<int, int>> midiAtWeb;      // (block, note)
    std::vector<std::pair<int, int>> midiFromWebAt;  // (block, offset)
    double webBeat = -1;
    for (int blk = 0; blk < kBlocks; ++blk) {
        const double ppq = 4.0 + blk * (kBlock * 120.0 / (60.0 * 48000.0));
        bridge::Transport t;
        t.sampleRate = 48000.0;
        t.bpm = 120.0;
        t.ppq = ppq;
        t.ppqValid = 1;
        t.playing = 1;
        t.samplePos = pos + (int64_t)blk * kBlock;
        for (int i = 0; i < kBlock; ++i) ramp[(size_t)i] = (float)(blk * kBlock + i + 1) * 1e-4f;

        const float* ins[2] = {ramp.data(), ramp.data()};
        bridge::BridgeClient::Block a;
        a.in = ins;
        a.numSamples = kBlock;
        a.transport = t;
        a.offline = true;
        audioIn.exchange(a);

        bridge::Midi note;
        note.offset = 5;
        note.bytes[0] = 0x90;
        note.bytes[1] = 64;
        note.bytes[2] = 100;
        note.size = 3;
        bridge::BridgeClient::Block m;
        m.numSamples = kBlock;
        m.transport = t;
        m.offline = true;
        if (blk == 100) {
            m.midiIn = &note;
            m.numMidiIn = 1;
        }
        midiIn.exchange(m);

        // Bleep Play's sequencer: at block 200 it asks for a note on a beat in the middle of block 220.
        web.pump(1);
        if (blk == 200) {
            webBeat = 4.0 + 220 * (kBlock * 120.0 / (60.0 * 48000.0)) + 40 * (120.0 / (60.0 * 48000.0));
            web.send(obj({{"op", "midi"}, {"ch", chMidiFrom}, {"epoch", web.epoch},
                          {"ev", oneEvent(webBeat, 144, 70, 80)}}));
            std::this_thread::sleep_for(std::chrono::milliseconds(30));
        }
        bridge::Midi seqOut[bridge::kMaxMidi];
        bridge::BridgeClient::Block o;
        o.numSamples = kBlock;
        o.transport = t;
        o.offline = true;
        o.midiOut = seqOut;
        midiOut.exchange(o);
        for (int i = 0; i < o.numMidiOut; ++i) midiFromWebAt.push_back({blk, seqOut[i].offset});

        float* rets[2] = {ret.data(), ret.data()};
        std::vector<float> retR(kBlock);
        rets[1] = retR.data();
        bridge::BridgeClient::Block r;
        r.ret = rets;
        r.numSamples = kBlock;
        r.transport = t;
        r.offline = true;
        audioOut.exchange(r);
        if (blk >= 2) outAll.insert(outAll.end(), ret.begin(), ret.end());

        // The browser: echo audio, remember MIDI.
        web.pump(1);
        while (!web.audio[chAudioTo].empty()) {
            auto& p = web.audio[chAudioTo].front();
            web.sendAudio(chAudioFrom, p.data(), p.data() + p.size() / 2, (int)(p.size() / 2), seq++);
            web.audio[chAudioTo].erase(web.audio[chAudioTo].begin());
        }
        for (const auto& mm : web.allText("midi"))
            if ((int)mm["ch"] == chMidiTo) {
                const auto* ev = mm["ev"].getArray();
                if (ev && !ev->isEmpty()) midiAtWeb.push_back({blk, (int)(*(*ev)[0].getArray())[2]});
                webBeat = webBeat;  // keep
            }
        web.texts.erase(std::remove_if(web.texts.begin(), web.texts.end(),
                                       [](const juce::var& v) { return v["op"].toString() == "midi"; }),
                        web.texts.end());
        if (blk % 20 == 0) {
            server.poll();
            hub.poll();
        }
    }
    // Audio came back delayed by a constant (the round trip), with no gaps.
    int silentTail = 0;
    for (size_t i = outAll.size() - 6000; i < outAll.size(); ++i) silentTail += outAll[i] == 0.0f ? 1 : 0;
    double slope = 0.0;
    for (size_t i = outAll.size() - 4000; i + 1 < outAll.size(); ++i) slope += outAll[i + 1] - outAll[i];
    slope /= 3999.0;
    // delay in frames: how far the ramp value at the end is behind the value sent then
    const double lastSent = (double)(kBlocks * kBlock) * 1e-4;
    const double delayFrames = (lastSent - outAll.back()) / 1e-4 - 2.0 * kBlock;
    std::printf("live→web→live audio: slope %.3e, %d silent samples in the tail, round trip about %.0f frames (%.1f ms) beyond the bridge\n",
                slope, silentTail, delayFrames, delayFrames / 48.0);
    EXPECT(silentTail == 0);
    EXPECT(std::fabs(slope - 1e-4) < 1e-4 * 0.02);
    // The test's browser echoes at once, so only the way back is buffered: one 16 ms buffer (768 frames) plus granularity. A machine
    // under load, or an audio thread without real-time priority, adds scheduling delay (1167 on a busy build server); a second
    // buffer would be 1536 and more, which is what the upper limit is there to catch.
    EXPECT(delayFrames > 700.0 && delayFrames < 1450.0);

    // The plugin that returns the web's audio is asked to report that round trip.
    const int extra = audioOut.extraLatency();
    std::printf("reported extra latency: %d samples (%.1f ms)\n", extra, extra / 48.0);
    EXPECT(extra >= 1400 && extra <= 1700);
    EXPECT(audioIn.extraLatency() == 0);

    // MIDI to the web: one note at block 100, offset 5, with its beat.
    EXPECT(!midiAtWeb.empty());
    if (!midiAtWeb.empty()) {
        EXPECT(midiAtWeb.size() == 1 && midiAtWeb[0].second == 64);
    }
    // MIDI from the web: the note lands in block 220 at sample 40, exactly where its beat is.
    std::printf("web sequencer note lands at:");
    for (const auto& [b, off] : midiFromWebAt) std::printf(" block %d sample %d", b, off);
    std::printf("\n");
    EXPECT(midiFromWebAt.size() == 1 && midiFromWebAt[0].first == 220 && std::abs(midiFromWebAt[0].second - 40) <= 1);
    web.c.close();
}

// Sync: tempo, beat, play state, flush on a jump.
void testSync(engine::Engine& engine, WebHub& hub, int port) {
    Web web;
    EXPECT(web.connect(port, "Safari"));
    EXPECT(waitFor([&] { web.pump(5); return web.firstText("welcome").isObject(); }));
    const auto welcomeEpoch = (int)web.firstText("welcome")["epoch"];
    for (int blk = 0; blk < 10; ++blk) driveApp(engine, hub, transportAt(8.0 + blk * 0.0027));
    // The sync thread may have sent one before these blocks ran (the earlier test left the clock at beat 10): wait for one after.
    EXPECT(waitFor([&] {
        web.pump(5);
        const auto all = web.allText("sync");
        return !all.empty() && (double)all.back()["beat"] >= 8.0 && (double)all.back()["beat"] < 8.1;
    }));
    const auto s1 = web.allText("sync").back();
    EXPECT(std::fabs((double)s1["tempo"] - 120.0) < 1e-6);
    EXPECT((bool)s1["playing"]);
    EXPECT((double)s1["beat"] >= 8.0 && (double)s1["beat"] < 8.1);
    EXPECT(s1["leader"].toString().isNotEmpty());
    EXPECT(s1["hub"].isDouble());

    // A jump (loop wrap) and a tempo change: the epoch rises and a flush is sent.
    web.texts.clear();
    driveApp(engine, hub, transportAt(2.0));
    EXPECT(waitFor([&] { web.pump(5); return web.firstText("flush").isObject(); }));
    const int epochAfterJump = (int)web.firstText("flush")["epoch"];
    EXPECT(epochAfterJump > welcomeEpoch);
    web.texts.clear();
    driveApp(engine, hub, transportAt(2.01, true, 133.0));
    EXPECT(waitFor([&] { web.pump(5); return web.firstText("flush").isObject(); }));
    EXPECT((int)web.firstText("flush")["epoch"] > epochAfterJump);

    // A ping is answered with the hub's clock.
    web.texts.clear();
    web.send(obj({{"op", "ping"}, {"t", 1234.5}}));
    EXPECT(waitFor([&] { web.pump(5); return web.firstText("pong").isObject(); }));
    EXPECT((double)web.firstText("pong")["t"] == 1234.5);
    web.c.close();
}

}  // namespace

/// A hello with another origin's id is refused and does not close that board; the same origin may replace its own link.
void testHelloIdBound(WebHub& hub, int port) {
    (void)hub;
    Web owner;
    EXPECT(owner.connect(port, "Owner"));
    EXPECT(waitFor([&] { owner.pump(5); return owner.firstText("welcome").isObject(); }));
    // another allowed origin (localhost instead of 127.0.0.1) claims the same id
    Web thief;
    EXPECT(thief.c.connect(port));
    EXPECT(thief.c.handshake("http://localhost:" + std::to_string(port), port) == 101);
    thief.send(obj({{"op", "hello"}, {"v", 1}, {"id", "web-Owner"}, {"name", "Thief"}, {"sampleRate", 48000}, {"mode", "low"}}));
    EXPECT(waitFor([&] { thief.pump(5); return thief.firstText("error").isObject(); }));
    EXPECT(thief.firstText("error")["code"].toString() == "id-in-use");
    EXPECT(!thief.firstText("welcome").isObject());
    owner.pump(50);
    EXPECT(!owner.closed);
    // the same origin replaces its own link
    Web again;
    EXPECT(again.connect(port, "Owner"));
    EXPECT(waitFor([&] { again.pump(5); return again.firstText("welcome").isObject(); }));
    EXPECT(waitFor([&] { owner.pump(5); return owner.closed; }));
}

/// Text nested 100000 deep must not blow the reader's stack; the link stays usable afterwards.
void testDeepJson(WebHub& hub, int port) {
    (void)hub;
    Web web;
    EXPECT(web.connect(port, "Deep"));
    EXPECT(waitFor([&] { web.pump(5); return web.firstText("welcome").isObject(); }));
    web.c.sendFrame(1, std::string(100000, '['));
    web.c.sendFrame(1, std::string(100000, '{'));
    web.c.sendFrame(1, "{\"op\":\"ping\",\"t\":" + std::string(100000, '[') + std::string(100000, ']') + "}");
    web.send(obj({{"op", "ping"}, {"t", 7}}));
    EXPECT(waitFor([&] { web.pump(5); return web.firstText("pong").isObject(); }));
    EXPECT((int)web.firstText("pong")["t"] == 7);
    web.c.close();
}

/// Pairing: one question at a time, a denial is remembered, Allow is remembered by the app (rememberOrigin).
void testPairing(engine::Engine& engine) {
    std::atomic<int> asked{0};
    std::atomic<bool> release{false}, answer{false};
    std::mutex m;
    std::set<std::string> remembered;
    WebHub::Callbacks cb;
    cb.leader = [] { return std::string("app"); };
    cb.pairingDenyMs = 400;
    cb.askPairing = [&](const std::string&) {
        ++asked;
        waitFor([&] { return release.load(); }, 5000);
        return answer.load();
    };
    cb.allowedOrigins = [&] {
        std::lock_guard<std::mutex> lock(m);
        return remembered;
    };
    cb.rememberOrigin = [&](const std::string& o) {
        std::lock_guard<std::mutex> lock(m);
        remembered.insert(o);
    };
    WebHub hub(engine, cb);
    EXPECT(hub.start(0, ""));
    const int port = hub.port();

    int firstStatus = -1;
    Client first;
    EXPECT(first.connect(port));
    std::thread t([&] { firstStatus = first.handshake("http://one.example", port); });
    EXPECT(waitFor([&] { return asked.load() == 1; }));
    // a second unknown origin while the dialog is up: refused at once, no second question
    Client second;
    EXPECT(second.connect(port));
    const int64_t t0 = nowMs();
    EXPECT(second.handshake("http://two.example", port) == 403);
    EXPECT(nowMs() - t0 < 1500);
    EXPECT(asked.load() == 1);
    // the user says no
    answer = false;
    release = true;
    t.join();
    EXPECT(firstStatus == 403);
    // asking again right away: denied without a question
    Client third;
    EXPECT(third.connect(port));
    EXPECT(third.handshake("http://one.example", port) == 403);
    EXPECT(asked.load() == 1);
    // after the memory runs out it asks again, and Allow lets it in and remembers it
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    answer = true;
    Client fourth;
    EXPECT(fourth.connect(port));
    EXPECT(fourth.handshake("http://one.example", port) == 101);
    EXPECT(asked.load() == 2);
    {
        std::lock_guard<std::mutex> lock(m);
        EXPECT(remembered.count("http://one.example") == 1 && remembered.count("http://two.example") == 0);
    }
    hub.stop();
}

int main() {
    juce::ScopedJuceInitialiser_GUI juce;
    const juce::String ns = "h" + juce::String(juce::Random::getSystemRandom().nextInt(99999));
    setenv("BLEEP_BRIDGE_NAMESPACE", ns.toRawUTF8(), 1);

    auto* engine = new engine::Engine();
    engine->setStandalone(true);
    const int main = engine->registerInstance(engine::PortKind::Patch);
    {
        WebHub::Callbacks cb;
        cb.leader = [] { return std::string("app"); };
        WebHub hub(*engine, cb);
        bridge::BridgeServer server(*engine);  // after the hub: it hands slots to it until it is gone
        EXPECT(server.ok());
        server.setRelay(&hub);
        EXPECT(hub.start(0, ""));
        const int port = hub.port();
        std::printf("hub on port %d\n", port);
        EXPECT(port > 0);

        testWebNodes(*engine, hub, port);
        testSync(*engine, hub, port);
        testLiveSlots(*engine, hub, server, port);
        testHelloIdBound(hub, port);
        testDeepJson(hub, port);
        hub.stop();
    }
    testPairing(*engine);
    engine->unregisterInstance(main);
    engine->collectGarbage();
    engine->release();
    std::printf(g_failures ? "%d failure(s)\n" : "hub test passed\n", g_failures);
    return g_failures ? 1 : 0;
}
