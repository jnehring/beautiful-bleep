// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// The Board menu of the port plugins (doc/specs/bridges.md §1): loads the built Bleep Audio In, Audio Out, MIDI In
// and MIDI Out VST3s into this process as a host would, sets Board = App, and runs the app's side (BridgeServer +
// engine) here. Audio In's audio must come out of Audio Out, and a note into MIDI In out of MIDI Out, with the
// bridge's two blocks of delay, through real shared memory.
//
//   bleep_port_plugin_test <Bleep Audio In.vst3> <Bleep Audio Out.vst3> <Bleep MIDI In.vst3> <Bleep MIDI Out.vst3>
#include "BridgeServer.h"

#include <juce_audio_processors/juce_audio_processors.h>

#include <cstdio>

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
        info.setIsPlaying(true);
        info.setBpm(120.0);
        info.setPpqPosition(0.0);
        return info;
    }
};

std::unique_ptr<juce::AudioPluginInstance> load(juce::AudioPluginFormatManager& fm, const juce::String& path, PlayHead& head) {
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

juce::String portId(juce::AudioPluginInstance& p) {
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

/// Sets the Board parameter (This set / App / Web) the way a host does.
bool setBoard(juce::AudioPluginInstance& p, int index) {
    for (auto* param : p.getParameters())
        if (param->getName(32) == "Board") {
            param->setValueNotifyingHost((float)index / (float)(param->getNumSteps() - 1));
            return true;
        }
    return false;
}

void pump(int ms) {
    const auto until = juce::Time::getMillisecondCounter() + (juce::uint32)ms;
    while (juce::Time::getMillisecondCounter() < until) juce::MessageManager::getInstance()->runDispatchLoopUntil(20);
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 5) {
        std::printf("usage: %s <Audio In.vst3> <Audio Out.vst3> <MIDI In.vst3> <MIDI Out.vst3>\n", argv[0]);
        return 2;
    }
    const juce::String ns = "q" + juce::String(juce::Random::getSystemRandom().nextInt(99999));
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
        auto audioIn = load(fm, argv[1], head), audioOut = load(fm, argv[2], head), midiIn = load(fm, argv[3], head),
             midiOut = load(fm, argv[4], head);
        EXPECT(audioIn && audioOut && midiIn && midiOut);
        if (!audioIn || !audioOut || !midiIn || !midiOut) return 1;
        const int before = audioOut->getLatencySamples();
        for (auto* p : {audioIn.get(), audioOut.get(), midiIn.get(), midiOut.get()}) EXPECT(setBoard(*p, 1));

        for (int i = 0; i < 60 && server.connected() < 4; ++i) {
            server.poll();
            pump(50);
        }
        EXPECT(server.connected() == 4);
        engine->reconcileNow();
        auto nodeOf = [&](juce::AudioPluginInstance& p, const char* type) {
            const auto id = portId(p);
            for (const auto& n : *engine->board()["nodes"].getArray())
                if (n["port"].toString() == id) {
                    EXPECT(n["type"].toString() == type);
                    return n["id"].toString();
                }
            return juce::String();
        };
        const auto nAudioIn = nodeOf(*audioIn, "audio-in"), nAudioOut = nodeOf(*audioOut, "audio-out"),
                   nMidiIn = nodeOf(*midiIn, "midi-in"), nMidiOut = nodeOf(*midiOut, "midi-out");
        EXPECT(nAudioIn.isNotEmpty() && nAudioOut.isNotEmpty() && nMidiIn.isNotEmpty() && nMidiOut.isNotEmpty());
        if (nAudioIn.isEmpty() || nAudioOut.isEmpty() || nMidiIn.isEmpty() || nMidiOut.isEmpty()) return 1;
        auto edited = engine::board::fromJson(engine::board::toJson(engine->board()));
        auto cable = [&](const juce::String& a, const char* aj, const juce::String& b, const char* bj) {
            edited["cables"].getArray()->add(
                obj({{"from", obj({{"node", a}, {"jack", aj}})}, {"to", obj({{"node", b}, {"jack", bj}})}, {"amount", 1.0}}));
        };
        cable(nAudioIn, "l", nAudioOut, "l");
        cable(nAudioIn, "r", nAudioOut, "r");
        cable(nMidiIn, "notes", nMidiOut, "notes");
        engine->commit(edited, "patch");

        // The plugin that returns audio reports the bridge's two blocks as its latency.
        std::printf("Audio Out latency: %d samples (was %d)\n", audioOut->getLatencySamples(), before);
        EXPECT(audioOut->getLatencySamples() == 2 * kBlock);

        float lastOut = 0.0f;
        int noteBlock = -1, noteOffset = -1, noteCount = 0;
        for (int blk = 0; blk < 40; ++blk) {
            juce::MidiBuffer mIn, mOut, none;
            if (blk == 10) mIn.addEvent(juce::MidiMessage::noteOn(1, 61, (juce::uint8)100), 33);
            juce::AudioBuffer<float> a(2, kBlock), o(2, kBlock), m1(2, kBlock), m2(2, kBlock);
            a.clear();
            o.clear();
            m1.clear();
            m2.clear();
            for (int i = 0; i < kBlock; ++i) a.setSample(0, i, 1.0f), a.setSample(1, i, 1.0f);
            audioIn->processBlock(a, none);
            audioOut->processBlock(o, none);
            midiIn->processBlock(m1, mIn);
            midiOut->processBlock(m2, mOut);
            lastOut = o.getSample(0, kBlock - 1);
            for (const auto meta : mOut)
                if (meta.getMessage().isNoteOn()) {
                    noteBlock = blk;
                    noteOffset = meta.samplePosition;
                    ++noteCount;
                }
        }
        std::printf("Audio Out %.3f; note out at block %d sample %d (%d)\n", lastOut, noteBlock, noteOffset, noteCount);
        EXPECT(std::abs(lastOut - 1.0f) < 1e-4f);
        EXPECT(noteCount == 1 && noteBlock == 12 && noteOffset == 33);

        // Board = Web without a hub in the app: nothing is relayed, and the plugin stays quiet and alive.
        EXPECT(setBoard(*audioOut, 2));
        pump(400);
        juce::AudioBuffer<float> o(2, kBlock);
        juce::MidiBuffer none;
        o.clear();
        audioOut->processBlock(o, none);

        // Back to This set: the node on the app's board is a ghost, the plugin passes through its own board.
        for (auto* p : {audioIn.get(), audioOut.get(), midiIn.get(), midiOut.get()}) {
            EXPECT(setBoard(*p, 0));
            juce::AudioBuffer<float> flush(2, kBlock);  // a hosted VST3 takes parameter changes at its next block
            juce::MidiBuffer noMidi;
            flush.clear();
            p->processBlock(flush, noMidi);
        }
        for (int i = 0; i < 40 && server.connected() > 0; ++i) {
            server.poll();
            pump(50);
        }
        EXPECT(server.connected() == 0);
        EXPECT(engine->board()["cables"].getArray()->size() == 3);
    }
    engine->unregisterInstance(main);
    engine->collectGarbage();
    engine->release();
    std::printf(g_failures ? "%d failure(s)\n" : "port plugin test passed\n", g_failures);
    return g_failures ? 1 : 0;
}
