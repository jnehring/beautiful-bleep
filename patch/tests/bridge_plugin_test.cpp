// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Loads the built Bleep Audio Bridge VST3 twice (two tracks in a host) and
// runs the app's side (BridgeServer + engine) in this process. The plugin
// binary and this test share nothing but the named shared memory and
// semaphore, exactly like Live and the app. On the app's board, bridge A's
// send goes into bridge B's return at amount 0.5.
//
//   bleep_bridge_plugin_test <Bleep Audio Bridge.vst3>
#include "BridgeServer.h"

#include <juce_audio_processors/juce_audio_processors.h>

#include <cstdio>
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

constexpr double kRate = 48000.0;
constexpr int kBlock = 256;

juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> props) {
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}

struct PlayHead : juce::AudioPlayHead {
    juce::Optional<PositionInfo> getPosition() const override {
        PositionInfo info;
        info.setIsPlaying(false);
        info.setBpm(120.0);
        return info;
    }
};

std::unique_ptr<juce::AudioPluginInstance> load(juce::AudioPluginFormatManager& fm, const juce::String& path,
                                                PlayHead& head) {
    juce::OwnedArray<juce::PluginDescription> found;
    juce::VST3PluginFormat vst3;
    vst3.findAllTypesForFile(found, path);
    if (found.isEmpty()) return nullptr;
    juce::String error;
    auto p = fm.createPluginInstance(*found[0], kRate, kBlock, error);
    if (!p) return nullptr;
    p->setPlayHead(&head);
    p->enableAllBuses();
    p->setNonRealtime(true);  // the bridge waits for the app, like an offline export
    p->prepareToPlay(kRate, kBlock);
    return p;
}

/// The plugin's own state from a hosted VST3's <VST3PluginState>.
juce::String bridgeId(juce::AudioPluginInstance& p) {
    juce::MemoryBlock m;
    p.getStateInformation(m);
    auto wrapper = juce::AudioProcessor::getXmlFromBinary(m.getData(), (int)m.getSize());
    auto* component = wrapper ? wrapper->getChildByName("IComponent") : nullptr;
    if (!component) return {};
    juce::MemoryBlock inner;
    inner.fromBase64Encoding(component->getAllSubText());
    auto xml = juce::AudioProcessor::getXmlFromBinary(inner.getData(), (int)inner.getSize());
    return xml ? xml->getStringAttribute("id") : juce::String();
}

/// Pumps the message loop: plugins and server connect on their timers.
void pump(int ms) {
    const auto until = juce::Time::getMillisecondCounter() + (juce::uint32)ms;
    while (juce::Time::getMillisecondCounter() < until) juce::MessageManager::getInstance()->runDispatchLoopUntil(20);
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::printf("usage: %s <Bleep Audio Bridge.vst3>\n", argv[0]);
        return 2;
    }
    const juce::String ns = "p" + juce::String(juce::Random::getSystemRandom().nextInt(99999));
    setenv("BLEEP_BRIDGE_NAMESPACE", ns.toRawUTF8(), 1);
    juce::ScopedJuceInitialiser_GUI juce;
    juce::AudioPluginFormatManager fm;
    fm.addFormat(new juce::VST3PluginFormat());
    PlayHead head;

    auto* engine = new engine::Engine();
    engine->setStandalone(true);
    const int main = engine->registerInstance(engine::PortKind::Patch);
    {
        bridge::BridgeServer server(*engine);
        EXPECT(server.ok());
        auto a = load(fm, argv[1], head);
        auto b = load(fm, argv[1], head);
        EXPECT(a && b);
        if (!a || !b) return 1;
        EXPECT(a->getLatencySamples() == 2 * kBlock);

        // The plugins find the app within a few of their timer ticks.
        for (int i = 0; i < 40 && server.connected() < 2; ++i) {
            server.poll();
            pump(50);
        }
        EXPECT(server.connected() == 2);
        engine->reconcileNow();
        // Each plugin is the node with its ID.
        const auto idA = bridgeId(*a), idB = bridgeId(*b);
        juce::String nodeA, nodeB;
        for (const auto& n : *engine->board()["nodes"].getArray()) {
            if (n["port"].toString() == idA) nodeA = n["id"].toString();
            if (n["port"].toString() == idB) nodeB = n["id"].toString();
        }
        EXPECT(nodeA.isNotEmpty() && nodeB.isNotEmpty());
        if (nodeA.isEmpty() || nodeB.isEmpty()) return 1;
        auto edited = engine::board::fromJson(engine::board::toJson(engine->board()));
        edited["cables"].getArray()->add(obj({{"from", obj({{"node", nodeA}, {"jack", "l"}})},
                                              {"to", obj({{"node", nodeB}, {"jack", "l"}})},
                                              {"amount", 0.5}}));
        engine->commit(edited, "patch");

        // Run 40 blocks; plugin A gets a constant 1.0, B silence. Monitor = Return (default).
        float lastA = 0.0f, lastB = 0.0f;
        for (int blk = 0; blk < 40; ++blk) {
            juce::MidiBuffer midi;
            juce::AudioBuffer<float> ba(2, kBlock), bb(2, kBlock);
            ba.clear();
            bb.clear();
            for (int i = 0; i < kBlock; ++i) ba.setSample(0, i, 1.0f);
            a->processBlock(ba, midi);
            b->processBlock(bb, midi);
            lastA = ba.getSample(0, kBlock - 1);
            lastB = bb.getSample(0, kBlock - 1);
        }
        std::printf("plugin A out %.3f, plugin B out %.3f\n", lastA, lastB);
        // B hears A's send at half level; A's return is unpatched, so A's send passes through.
        EXPECT(std::abs(lastB - 0.5f) < 1e-4f);
        EXPECT(std::abs(lastA - 1.0f) < 1e-4f);
        EXPECT(server.connected() == 2);

        // Removing a plugin turns its node into a ghost: the cable stays.
        b.reset();
        for (int i = 0; i < 40 && server.connected() > 1; ++i) {
            server.poll();
            pump(50);
        }
        EXPECT(server.connected() == 1);
        EXPECT(engine->board()["cables"].getArray()->size() == 1);
    }
    engine->unregisterInstance(main);
    engine->collectGarbage();
    engine->release();
    std::printf(g_failures ? "%d failure(s)\n" : "bridge plugin test passed\n", g_failures);
    return g_failures ? 1 : 0;
}
