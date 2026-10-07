// SPDX-License-Identifier: MIT
//
// Integration test: loads the built VST3 modules into a minimal headless host
// and checks that they really talk over Bleep Bus.
//
//   bleep_patch_host_test <Function.vst3> <Utility.vst3> <Filter.vst3> <MidiOut.vst3>
#include <juce_audio_processors/juce_audio_processors.h>

#include "bleep_bus.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace {

int failures = 0;
#define EXPECT(cond)                                                          \
    do {                                                                      \
        if (!(cond)) {                                                        \
            std::printf("FAILED %s:%d: %s\n", __FILE__, __LINE__, #cond);     \
            ++failures;                                                       \
        }                                                                     \
    } while (0)

constexpr double kRate = 48000.0;
constexpr int kBlock = 256;

/// A transport that is always playing, advancing one block per call.
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

void setParam(juce::AudioPluginInstance& p, const juce::String& name, float normalised) {
    for (auto* prm : p.getParameters())
        if (prm->getName(64) == name) {
            prm->setValueNotifyingHost(normalised);
            return;
        }
    std::printf("no parameter %s\n", name.toRawUTF8());
    ++failures;
}

uint64_t uidOf(bleep::Bus& bus, const char* product) {
    for (const auto& e : bus.endpoints())
        if (juce::String(e.product) == product) return e.uid;
    return 0;
}

/// Runs one block on every plugin, in the given order. Returns the RMS of
/// `measure`'s output and collects its MIDI.
float runBlock(std::initializer_list<juce::AudioPluginInstance*> order, juce::AudioPluginInstance* measure,
               PlayHead& head, int& phase, juce::MidiBuffer* midiOut = nullptr) {
    float rms = 0.0f;
    for (auto* p : order) {
        juce::AudioBuffer<float> buf(2, kBlock);
        for (int i = 0; i < kBlock; ++i) {
            const float s = 0.5f * std::sin(2.0f * juce::MathConstants<float>::pi * 5000.0f * (float)(phase + i) / (float)kRate);
            buf.setSample(0, i, s);
            buf.setSample(1, i, s);
        }
        juce::MidiBuffer midi;
        p->processBlock(buf, midi);
        if (p == measure) {
            rms = buf.getRMSLevel(0, 0, kBlock);
            if (midiOut) midiOut->addEvents(midi, 0, kBlock, 0);
        }
    }
    phase += kBlock;
    head.pos += kBlock;
    return rms;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 5) {
        std::printf("usage: %s <Function.vst3> <Utility.vst3> <Filter.vst3> <MidiOut.vst3>\n", argv[0]);
        return 2;
    }
    // Private bus namespace so a running DAW is not disturbed.
    const juce::String ns = "host" + juce::String(juce::Random::getSystemRandom().nextInt(99999));
#if JUCE_WINDOWS
    _putenv_s("BLEEP_BUS_NAMESPACE", ns.toRawUTF8());
#else
    setenv("BLEEP_BUS_NAMESPACE", ns.toRawUTF8(), 1);
#endif
    bb_bus_unlink(ns.toRawUTF8());

    juce::ScopedJuceInitialiser_GUI juce;
    juce::AudioPluginFormatManager fm;
    fm.addFormat(new juce::VST3PluginFormat());
    PlayHead head;

    {
        bleep::Bus bus(ns.toRawUTF8());
        EXPECT(bus.ok());
        auto function = load(fm, argv[1], head);
        auto utility = load(fm, argv[2], head);
        auto filter = load(fm, argv[3], head);
        auto midiOut = load(fm, argv[4], head);
        if (!function || !utility || !filter || !midiOut) return 1;

        // Four endpoints with their ports on the bus.
        EXPECT(bus.endpoints().size() == 4);
        const uint64_t utilityUid = uidOf(bus, "Utility"), filterUid = uidOf(bus, "Filter"),
                       midiUid = uidOf(bus, "MIDI Out");
        EXPECT(utilityUid && filterUid && midiUid && uidOf(bus, "Function"));
        EXPECT(bus.inputs(filterUid).size() == 7);   // six parameters + Pitch
        EXPECT(bus.outputs().size() == 5 + 3 + 1);   // Function A-D+EOC, Utility Out/Gate/Inv, Filter Env

        // Utility outputs a constant +1 (Offset fully up).
        setParam(*utility, "Offset", 1.0f);
        int phase = 0;
        float open = 0.0f;
        for (int i = 0; i < 8; ++i) open = runBlock({utility.get(), filter.get()}, filter.get(), head, phase);
        EXPECT(open > 0.02f); // 5 kHz through the default 2 kHz LP: attenuated, clearly audible

        // Cable: Utility.Out → Filter.Cutoff, amount -1: cutoff falls ten octaves to 20 Hz.
        EXPECT(bus.connect(filterUid, "Cutoff", utilityUid, "Out", -1.0f) == BB_OK);
        float closed = 1.0f;
        for (int i = 0; i < 64; ++i)
            closed = runBlock({filter.get(), utility.get()}, filter.get(), head, phase); // reader first
        std::printf("filter rms: open %.4f, modulated %.6f\n", open, closed);
        EXPECT(closed < open * 0.01f); // > 40 dB further down

        // The knob itself did not move.
        for (auto* prm : filter->getParameters())
            if (prm->getName(64) == "Cutoff") EXPECT(std::abs(prm->getValue() - prm->getDefaultValue()) < 1e-6f);

        // The filter publishes its envelope.
        EXPECT(!bus.peek(filterUid, "Env").empty());

        // Cables live in the receiver's state and come back with it.
        juce::MemoryBlock state;
        filter->getStateInformation(state);
        EXPECT(bus.disconnectAll(filterUid, "Cutoff") == BB_OK);
        filter->setStateInformation(state.getData(), (int)state.getSize());
        EXPECT(bus.connections(filterUid, "Cutoff").size() == 1);

        // A duplicate (same saved UID) gets a fresh UID but keeps the cables.
        auto duplicate = load(fm, argv[3], head);
        duplicate->setStateInformation(state.getData(), (int)state.getSize());
        uint64_t dupUid = 0;
        for (const auto& e : bus.endpoints())
            if (juce::String(e.product) == "Filter" && e.uid != filterUid) dupUid = e.uid;
        EXPECT(dupUid != 0);
        EXPECT(bus.connections(dupUid, "Cutoff").size() == 1);
        duplicate.reset();

        // MIDI Out: Utility.Gate (high, since Out = 1 > threshold 0) → note on.
        EXPECT(bus.connect(midiUid, "Gate", utilityUid, "Gate", 1.0f) == BB_OK);
        juce::MidiBuffer midi;
        for (int i = 0; i < 4; ++i) runBlock({utility.get(), midiOut.get()}, midiOut.get(), head, phase, &midi);
        int noteOns = 0;
        for (const auto m : midi)
            if (m.getMessage().isNoteOn()) {
                ++noteOns;
                EXPECT(m.getMessage().getNoteNumber() == 60);
            }
        EXPECT(noteOns == 1);

        // Unloading a plugin removes its endpoint.
        midiOut.reset();
        EXPECT(bus.endpoints().size() == 3);
    }
    bb_bus_unlink(ns.toRawUTF8());
    std::printf(failures ? "%d failure(s)\n" : "host test passed\n", failures);
    return failures ? 1 : 0;
}
