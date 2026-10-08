// SPDX-License-Identifier: MIT
//
// Integration test: loads the built VST3s into a minimal headless host.
// Bleep Patch, Bleep Audio In and Bleep Audio Out are three different
// binaries; they must find one shared engine (spec §5.3), report the board
// latency, pass audio through a cable on the board, and save the board.
//
//   bleep_patch_host_test <Bleep Patch.vst3> <Bleep Audio In.vst3> <Bleep Audio Out.vst3>
#include <juce_audio_processors/juce_audio_processors.h>

#include <cstdio>

namespace {

int failures = 0;
#define EXPECT(cond)                                                      \
    do {                                                                  \
        if (!(cond)) {                                                    \
            std::printf("FAILED %s:%d: %s\n", __FILE__, __LINE__, #cond); \
            ++failures;                                                   \
        }                                                                 \
    } while (0)

constexpr double kRate = 48000.0;
constexpr int kBlock = 256;

struct PlayHead : juce::AudioPlayHead {
    int64_t pos = 0;
    juce::Optional<PositionInfo> getPosition() const override {
        PositionInfo info;
        info.setTimeInSamples(pos);
        info.setIsPlaying(true);
        info.setBpm(120.0);
        info.setPpqPosition((double)pos / kRate * 2.0);
        return info;
    }
};

std::unique_ptr<juce::AudioPluginInstance> load(juce::AudioPluginFormatManager& fm, const juce::String& path,
                                                PlayHead& head) {
    juce::OwnedArray<juce::PluginDescription> found;
    juce::VST3PluginFormat vst3;
    vst3.findAllTypesForFile(found, path);
    if (found.isEmpty()) {
        std::printf("could not scan %s\n", path.toRawUTF8());
        return nullptr;
    }
    juce::String error;
    auto p = fm.createPluginInstance(*found[0], kRate, kBlock, error);
    if (!p) {
        std::printf("could not load %s: %s\n", path.toRawUTF8(), error.toRawUTF8());
        return nullptr;
    }
    p->setPlayHead(&head);
    p->enableAllBuses();
    p->prepareToPlay(kRate, kBlock);
    return p;
}

// A hosted VST3's state is JUCE's <VST3PluginState> with the plugin's own
// state base64-encoded in <IComponent>.
std::unique_ptr<juce::XmlElement> stateOf(juce::AudioPluginInstance& p) {
    juce::MemoryBlock m;
    p.getStateInformation(m);
    auto wrapper = juce::AudioProcessor::getXmlFromBinary(m.getData(), (int)m.getSize());
    auto* component = wrapper ? wrapper->getChildByName("IComponent") : nullptr;
    if (component == nullptr) return nullptr;
    juce::MemoryBlock inner;
    inner.fromBase64Encoding(component->getAllSubText());
    return juce::AudioProcessor::getXmlFromBinary(inner.getData(), (int)inner.getSize());
}

void setState(juce::AudioPluginInstance& p, const juce::XmlElement& xml) {
    juce::MemoryBlock inner, outer;
    juce::AudioProcessor::copyXmlToBinary(xml, inner);
    juce::XmlElement wrapper("VST3PluginState");
    wrapper.createNewChildElement("IComponent")->addTextElement(inner.toBase64Encoding());
    juce::AudioProcessor::copyXmlToBinary(wrapper, outer);
    p.setStateInformation(outer.getData(), (int)outer.getSize());
}

juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> props) {
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 4) {
        std::printf("usage: %s <Bleep Patch.vst3> <Bleep Audio In.vst3> <Bleep Audio Out.vst3>\n", argv[0]);
        return 2;
    }
    juce::ScopedJuceInitialiser_GUI juce;
    juce::AudioPluginFormatManager fm;
    fm.addFormat(new juce::VST3PluginFormat());
    PlayHead head;
    {
        auto patch = load(fm, argv[1], head);
        auto audioIn = load(fm, argv[2], head);
        auto audioOut = load(fm, argv[3], head);
        if (!patch || !audioIn || !audioOut) return 1;

        EXPECT(audioOut->getLatencySamples() == 2 * kBlock);
        EXPECT(audioIn->getLatencySamples() == 0);

        // The board: Audio In → Audio Out, stored in Bleep Patch's state.
        auto inState = stateOf(*audioIn), outState = stateOf(*audioOut), patchState = stateOf(*patch);
        EXPECT(inState && outState && patchState);
        if (!inState || !outState || !patchState) return 1;
        const auto inId = inState->getStringAttribute("id"), outId = outState->getStringAttribute("id");
        EXPECT(inId.length() == 36 && outId.length() == 36 && inId != outId);
        auto board = obj({{"format", 1},
                          {"id", "host-test"},
                          {"nodes", juce::Array<juce::var>{obj({{"id", "in"}, {"type", "audio-in"}, {"port", inId}}),
                                                           obj({{"id", "out"}, {"type", "audio-out"}, {"port", outId}})}},
                          {"cables", juce::Array<juce::var>{
                                         obj({{"from", obj({{"node", "in"}, {"jack", "l"}})},
                                              {"to", obj({{"node", "out"}, {"jack", "l"}})},
                                              {"amount", 0.5}})}}});
        if (auto* b = patchState->getChildByName("Board")) patchState->removeChildElement(b, true);
        patchState->createNewChildElement("Board")->addTextElement(juce::JSON::toString(board));
        setState(*patch, *patchState);

        // An impulse into Audio In comes out of Audio Out two blocks later, at half level.
        int arrived = -1, sample = -1;
        float level = 0.0f;
        for (int b = 0; b < 8; ++b) {
            juce::MidiBuffer midi;
            juce::AudioBuffer<float> p(2, kBlock), in(2, kBlock), out(2, kBlock);
            p.clear();
            in.clear();
            out.clear();
            if (b == 1) in.setSample(0, 17, 1.0f);
            patch->processBlock(p, midi);
            audioIn->processBlock(in, midi);
            audioOut->processBlock(out, midi);
            EXPECT(b != 1 || in.getSample(0, 17) == 1.0f);  // Audio In passes audio through
            for (int i = 0; i < kBlock && arrived < 0; ++i)
                if (std::abs(out.getSample(0, i)) > 0.01f) {
                    arrived = b;
                    sample = i;
                    level = out.getSample(0, i);
                }
            head.pos += kBlock;
        }
        std::printf("impulse arrived in block %d, sample %d, level %.2f\n", arrived, sample, level);
        EXPECT(arrived == 3 && sample == 17);
        EXPECT(std::abs(level - 0.5f) < 1e-4f);

        // Bleep Patch saves the board with the cable.
        auto saved = stateOf(*patch);
        auto* savedBoard = saved ? saved->getChildByName("Board") : nullptr;
        EXPECT(savedBoard != nullptr);
        if (savedBoard) {
            const auto doc = juce::JSON::parse(savedBoard->getAllSubText());
            EXPECT(doc["cables"].getArray() && doc["cables"].getArray()->size() == 1);
        }
    }
    std::printf(failures ? "%d failure(s)\n" : "host test passed\n", failures);
    return failures ? 1 : 0;
}
