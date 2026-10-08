// SPDX-License-Identifier: MIT
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

}  // namespace

int main() {
    juce::ScopedJuceInitialiser_GUI juce;
    const juce::String ns = "t" + juce::String(juce::Random::getSystemRandom().nextInt(99999));
    setenv("BLEEP_BRIDGE_NAMESPACE", ns.toRawUTF8(), 1);

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

        // A bridge that goes away becomes a ghost node with its cables kept.
        b.setIdentity("", "Pad");
        server.poll();
        EXPECT(server.connected() == 1);
        engine->reconcileNow();
        int cables = engine->board()["cables"].getArray()->size();
        EXPECT(cables == 1);
    }
    engine->unregisterInstance(main);
    engine->collectGarbage();
    engine->release();
    std::printf(g_failures ? "%d failure(s)\n" : "bridge test passed\n", g_failures);
    return g_failures ? 1 : 0;
}
