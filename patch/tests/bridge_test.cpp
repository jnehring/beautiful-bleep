// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Bleep Audio Bridge test (spec §11.3): a BridgeServer (the app) with a real
// engine, and two BridgeClients (plugins in Live) running on their own
// threads like parallel tracks, through real shared memory and a real
// semaphore. Bridge A's send is patched into bridge B's return on the app's
// board: B must get A's audio exactly two blocks later.
#include "BridgeClient.h"
#include "BridgeServer.h"

#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>
#include <mutex>
#include <thread>

namespace bleep::engine {
std::unique_ptr<BoardUi> createBoardUi(Engine&) { return nullptr; }
}  // namespace bleep::engine

using namespace bleep;

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

class Barrier {
public:
    explicit Barrier(int n) : n_(n) {}
    void arrive_and_wait() {
        std::unique_lock<std::mutex> lock(m_);
        const int gen = gen_;
        if (++count_ == n_) {
            count_ = 0;
            ++gen_;
            cv_.notify_all();
        } else {
            cv_.wait(lock, [&] { return gen != gen_; });
        }
    }

private:
    std::mutex m_;
    std::condition_variable cv_;
    int n_, count_ = 0, gen_ = 0;
};

juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> props) {
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}

/// Runs `blocks` host blocks: A sends a ramp, B records its return.
std::vector<float> run(bridge::BridgeClient& a, bridge::BridgeClient& b, int blocks, bool offline, int64_t& posBase) {
    Barrier sync(2);
    std::vector<float> received((size_t)blocks * kBlock, 0.0f);
    auto track = [&](bridge::BridgeClient& c, bool sender) {
        std::vector<float> in[2], ret[2];
        for (int ch = 0; ch < 2; ++ch) {
            in[ch].assign(kBlock, 0.0f);
            ret[ch].assign(kBlock, 0.0f);
        }
        for (int blk = 0; blk < blocks; ++blk) {
            if (sender)
                for (int i = 0; i < kBlock; ++i) in[0][(size_t)i] = in[1][(size_t)i] = (float)(blk * kBlock + i + 1);
            const float* ins[2] = {in[0].data(), in[1].data()};
            float* rets[2] = {ret[0].data(), ret[1].data()};
            bridge::Transport t;
            t.samplePos = posBase + blk * kBlock;
            const bool got = c.process(ins, rets, 2, kBlock, t, offline);
            if (!sender && got) std::copy(ret[0].begin(), ret[0].end(), received.begin() + blk * kBlock);
            if (!offline) std::this_thread::sleep_for(std::chrono::microseconds(2600));  // ≈ 128 samples at 48 kHz
            sync.arrive_and_wait();
        }
    };
    std::thread ta([&] { track(a, true); });
    std::thread tb([&] { track(b, false); });
    ta.join();
    tb.join();
    posBase += (int64_t)blocks * kBlock;
    return received;
}

/// Version 2: a plugin is any port kind, and the app's board sees it as that port (bridges.md §10.1).
void testPortKinds(engine::Engine& engine, bridge::BridgeServer& server) {
    using engine::PortKind;
    auto kindOf = [](PortKind k) { return (uint32_t)k; };
    bridge::BridgeClient midiIn, midiOut, audioIn, audioOut;
    midiIn.setIdentity("aaaaaaaa-0000-0000-0000-000000000001", "Keys");
    midiOut.setIdentity("aaaaaaaa-0000-0000-0000-000000000002", "Synth");
    audioIn.setIdentity("aaaaaaaa-0000-0000-0000-000000000003", "Guitar");
    audioOut.setIdentity("aaaaaaaa-0000-0000-0000-000000000004", "Return");
    midiIn.setPort(kindOf(PortKind::MidiIn), bridge::Board::App);
    midiOut.setPort(kindOf(PortKind::MidiOut), bridge::Board::App);
    audioIn.setPort(kindOf(PortKind::AudioIn), bridge::Board::App);
    audioOut.setPort(kindOf(PortKind::AudioOut), bridge::Board::App);
    server.poll();  // the app's heartbeat: it has been quiet while the earlier tests ran
    for (auto* c : {&midiIn, &midiOut, &audioIn, &audioOut}) {
        c->prepare(48000.0, kBlock);
        EXPECT(c->poll() == bridge::BridgeClient::Status::Connected);
    }
    server.poll();
    engine.reconcileNow();

    auto nodeOf = [&](const char* prefix, const char* type) {
        for (const auto& n : *engine.board()["nodes"].getArray())
            if (n["port"].toString().startsWith(prefix)) {
                EXPECT(n["type"].toString() == type);
                return n["id"].toString();
            }
        return juce::String();
    };
    const auto nMidiIn = nodeOf("aaaaaaaa-0000-0000-0000-000000000001", "midi-in");
    const auto nMidiOut = nodeOf("aaaaaaaa-0000-0000-0000-000000000002", "midi-out");
    const auto nAudioIn = nodeOf("aaaaaaaa-0000-0000-0000-000000000003", "audio-in");
    const auto nAudioOut = nodeOf("aaaaaaaa-0000-0000-0000-000000000004", "audio-out");
    EXPECT(nMidiIn.isNotEmpty() && nMidiOut.isNotEmpty() && nAudioIn.isNotEmpty() && nAudioOut.isNotEmpty());

    auto edited = engine::board::fromJson(engine::board::toJson(engine.board()));
    auto cable = [&](const juce::String& a, const char* aj, const juce::String& b, const char* bj) {
        edited["cables"].getArray()->add(
            obj({{"from", obj({{"node", a}, {"jack", aj}})}, {"to", obj({{"node", b}, {"jack", bj}})}, {"amount", 1.0}}));
    };
    cable(nMidiIn, "notes", nMidiOut, "notes");
    cable(nAudioIn, "l", nAudioOut, "l");
    cable(nAudioIn, "r", nAudioOut, "r");
    engine.commit(edited, "patch kinds");

    // Lockstep on one thread, offline: every client waits for the app. Notes go in at block 5, sample 17.
    constexpr int kBlocks = 40;
    std::vector<float> in((size_t)kBlock), retL((size_t)kBlock), retR((size_t)kBlock);
    int64_t pos = 1 << 20;
    int gotNote = -1, gotOffset = -1, gotVelocity = -1, noteBlocks = 0, audioWrong = 0;
    for (int blk = 0; blk < kBlocks; ++blk) {
        for (int i = 0; i < kBlock; ++i) in[(size_t)i] = (float)(blk * kBlock + i + 1);
        bridge::Transport t;
        t.samplePos = pos + blk * kBlock;

        bridge::Midi note;
        note.offset = 17;
        note.bytes[0] = 0x90;
        note.bytes[1] = 60;
        note.bytes[2] = 100;
        note.size = 3;
        bridge::BridgeClient::Block m;
        m.numSamples = kBlock;
        m.transport = t;
        m.offline = true;
        if (blk == 5) {
            m.midiIn = &note;
            m.numMidiIn = 1;
        }
        midiIn.exchange(m);

        bridge::Midi out[bridge::kMaxMidi];
        bridge::BridgeClient::Block o;
        o.numSamples = kBlock;
        o.transport = t;
        o.offline = true;
        o.midiOut = out;
        midiOut.exchange(o);
        if (o.numMidiOut > 0) {
            ++noteBlocks;
            gotNote = out[0].bytes[1];
            gotOffset = out[0].offset;
            gotVelocity = out[0].bytes[2];
            EXPECT(blk == 7);  // sent in block 5, back two blocks later
        }

        const float* ins[2] = {in.data(), in.data()};
        bridge::BridgeClient::Block a;
        a.in = ins;
        a.numSamples = kBlock;
        a.transport = t;
        a.offline = true;
        audioIn.exchange(a);

        float* rets[2] = {retL.data(), retR.data()};
        bridge::BridgeClient::Block r;
        r.ret = rets;
        r.numSamples = kBlock;
        r.transport = t;
        r.offline = true;
        const bool have = audioOut.exchange(r);
        if (blk >= 2) {
            EXPECT(have);
            for (int i = 0; i < kBlock; ++i)
                if (std::abs(retL[(size_t)i] - (float)((blk - 2) * kBlock + i + 1)) > 0.0f) ++audioWrong;
        }
    }
    std::printf("port kinds: note %d at sample %d velocity %d in %d block(s), %d wrong audio samples\n", gotNote,
                gotOffset, gotVelocity, noteBlocks, audioWrong);
    EXPECT(noteBlocks == 1 && gotNote == 60 && gotOffset == 17 && gotVelocity == 100);
    EXPECT(audioWrong == 0);
}

/// A hostile peer: negative/huge numSamples and MIDI records with size 255 or offsets outside the block.
void testHostileFrame() {
    auto f = std::make_unique<bridge::Frame>();
    std::memset((void*)f.get(), 0, sizeof(bridge::Frame));
    f->block = 5;
    f->numSamples = -7;
    f->numMidi = 5;
    auto setMidi = [&](int i, int32_t off, uint8_t size) {
        f->midi[i].offset = off;
        f->midi[i].size = size;
        f->midi[i].bytes[0] = 0x90;
    };
    std::vector<float> l(bridge::kMaxBlock), r(bridge::kMaxBlock);
    std::vector<bridge::Midi> midi(bridge::kMaxMidi);
    int ns = 99, nm = 99;
    EXPECT(bridge::readFrame(*f, 5, l.data(), r.data(), bridge::kMaxBlock, ns, nullptr, midi.data(), &nm));
    EXPECT(ns == 0);  // negative numSamples: nothing copied, no huge memcpy
    EXPECT(nm == 0);  // every offset is outside an empty block

    f->numSamples = 64;
    setMidi(0, 10, 255);   // size clamped to 3
    setMidi(1, -1, 3);     // dropped
    setMidi(2, 64, 3);     // dropped (outside the block)
    setMidi(3, 1 << 30, 3);  // dropped
    setMidi(4, 63, 2);
    f->numMidi = 1 << 20;  // clamped to kMaxMidi; the rest of the array is zero (size 0, offset 0)
    EXPECT(bridge::readFrame(*f, 5, l.data(), r.data(), bridge::kMaxBlock, ns, nullptr, midi.data(), &nm));
    EXPECT(ns == 64);
    bool ok = nm >= 2 && midi[0].offset == 10 && midi[0].size == 3 && midi[1].offset == 63 && midi[1].size == 2;
    for (int i = 0; i < nm; ++i) ok = ok && midi[(size_t)i].size <= 3 && midi[(size_t)i].offset >= 0 && midi[(size_t)i].offset < 64;
    EXPECT(ok);
}

/// A hostile plugin claims a slot with a huge block size and a non-finite sample rate: the app must stay up.
void testHostileSlot(bridge::BridgeServer& server) {
    std::unique_ptr<bridge::SharedMemory> mem(bridge::SharedMemory::open(false));
    EXPECT(mem != nullptr);
    if (!mem) return;
    bridge::Shared& s = *mem->get();
    int hit = 0;
    for (auto& slot : s.slots)
        if (slot.state.load() == 1) {
            slot.maxBlock.store(0x7fffffff);
            slot.sampleRateMilli.store(INT64_MAX);
            slot.generation.fetch_add(1);
            ++hit;
        }
    EXPECT(hit > 0);
    server.poll();  // must not allocate gigabytes or crash
    for (auto& slot : s.slots)
        if (slot.state.load() == 1) {
            slot.maxBlock.store(-5);
            slot.sampleRateMilli.store(-1);
        }
    server.poll();
    EXPECT(server.ok());
}

}  // namespace

int main() {
    juce::ScopedJuceInitialiser_GUI juce;
    const juce::String ns = "t" + juce::String(juce::Random::getSystemRandom().nextInt(99999));
    setenv("BLEEP_BRIDGE_NAMESPACE", ns.toRawUTF8(), 1);

    testHostileFrame();
    auto* engine = new engine::Engine();
    engine->setStandalone(true);
    const int main = engine->registerInstance(engine::PortKind::Patch);
    {
        bridge::BridgeServer server(*engine);
        EXPECT(server.ok());
        server.poll();

        bridge::BridgeClient a, b;
        a.setIdentity("11111111-1111-1111-1111-111111111111", "Drums");
        b.setIdentity("22222222-2222-2222-2222-222222222222", "Pad");
        a.prepare(48000.0, kBlock);
        b.prepare(48000.0, kBlock);
        EXPECT(a.poll() == bridge::BridgeClient::Status::Connected);
        EXPECT(b.poll() == bridge::BridgeClient::Status::Connected);
        server.poll();
        EXPECT(server.connected() == 2);
        engine->reconcileNow();

        // Both bridges are nodes, named after their tracks; no Macros node in the app.
        juce::String nodeA, nodeB;
        int macros = 0;
        for (const auto& n : *engine->board()["nodes"].getArray()) {
            if (n["port"].toString().startsWith("1111")) nodeA = n["id"].toString();
            if (n["port"].toString().startsWith("2222")) nodeB = n["id"].toString();
            if (n["type"].toString() == "macros") ++macros;
            if (n["port"].toString().startsWith("1111")) EXPECT(n["name"].toString() == "Drums");
        }
        EXPECT(nodeA.isNotEmpty() && nodeB.isNotEmpty());
        EXPECT(macros == 0);

        auto edited = engine::board::fromJson(engine::board::toJson(engine->board()));
        edited["cables"].getArray()->add(obj({{"from", obj({{"node", nodeA}, {"jack", "l"}})},
                                              {"to", obj({{"node", nodeB}, {"jack", "l"}})},
                                              {"amount", 1.0}}));
        engine->commit(edited, "patch");

        // Offline rendering: the bridges wait for the app, so nothing may drop.
        int64_t pos = 0;
        constexpr int kBlocks = 300;
        auto got = run(a, b, kBlocks, true, pos);
        int wrong = 0;
        for (int i = 2 * kBlock; i < kBlocks * kBlock; ++i)
            if (std::abs(got[(size_t)i] - (float)(i - 2 * kBlock + 1)) > 0.0f) {
                if (wrong++ % kBlock == 0)
                    std::printf("  block %d: got %.0f, want %d\n", i / kBlock, got[(size_t)i], i - 2 * kBlock + 1);
            }
        std::printf("offline: %d wrong samples, drops A %u B %u\n", wrong, a.drops(), b.drops());
        EXPECT(wrong == 0);

        // Real time: the app has one block to answer. Report misses.
        auto rt = run(a, b, 400, false, pos);
        int late = 0;
        for (int blk = 2; blk < 400; ++blk)
            late += rt[(size_t)blk * kBlock] == 0.0f ? 1 : 0;
        std::printf("real time: %d of 398 blocks late (drops B %u)\n", late, b.drops());
        EXPECT(late < 40);  // a loaded CI machine may miss some; Live measures this in phase 0

        testPortKinds(*engine, server);
        testHostileSlot(server);

        // A bridge that goes away becomes a ghost node with its cables kept.
        b.setIdentity("", "Pad");
        server.poll();
        EXPECT(server.connected() == 1);
        engine->reconcileNow();
        int cables = engine->board()["cables"].getArray()->size();
        EXPECT(cables >= 1);
    }
    engine->unregisterInstance(main);
    engine->collectGarbage();
    engine->release();
    std::printf(g_failures ? "%d failure(s)\n" : "bridge test passed\n", g_failures);
    return g_failures ? 1 : 0;
}
