// SPDX-License-Identifier: MIT
// MIDI Out module: a VST3 instrument that only produces MIDI. Route it to any
// instrument with a second MIDI track: "MIDI From: <this track> → Bleep MIDI Out",
// monitoring "In".
#include "MidiOutDsp.h"
#include "ModuleProcessor.h"
#include "Params.h"

namespace bleep::patch {

class MidiOutProcessor final : public ModuleProcessor {
public:
    MidiOutProcessor()
        : ModuleProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true),
                          {"MIDI Out", "Brilliant Bleep", juce::Colour(0xff60a5fa), true, true}, layout()) {
        velocity_ = addModulation("velocity");
        ccA_ = addModulation("cca");
        ccB_ = addModulation("ccb");
        bend_ = addModulation("bend");
        gate_ = addSignalInput("Gate", BB_SIGNAL_GATE);
        pitch_ = addSignalInput("Pitch", BB_SIGNAL_PITCH);
        channel_ = parameters().getRawParameterValue("channel");
        ccANumber_ = parameters().getRawParameterValue("ccanum");
        ccBNumber_ = parameters().getRawParameterValue("ccbnum");
        transpose_ = parameters().getRawParameterValue("transpose");
        sendCCs_ = parameters().getRawParameterValue("sendcc");
    }

    static juce::AudioProcessorValueTreeState::ParameterLayout layout() {
        juce::AudioProcessorValueTreeState::ParameterLayout l;
        l.add(params::percent("velocity", "Velocity", 0.0f, 1.0f, 0.8f));
        l.add(params::percent("cca", "CC A", 0.0f, 1.0f, 0.0f));
        l.add(params::percent("ccb", "CC B", 0.0f, 1.0f, 0.0f));
        l.add(params::number("bend", "Bend", {-1.0f, 1.0f}, 0.0f));
        l.add(params::integer("channel", "Channel", 1, 16, 1));
        l.add(params::integer("ccanum", "CC A #", 0, 127, 1));
        l.add(params::integer("ccbnum", "CC B #", 0, 127, 74));
        l.add(params::integer("transpose", "Transpose", -24, 24, 0));
        l.add(params::toggle("sendcc", "Send CC + Bend", true));
        return l;
    }

    void resetModule() override { dsp_.reset(); }

    void renderModule(const RenderBlock& b, juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi) override {
        if (b.start == 0) {
            midi.clear(); // incoming MIDI is not passed on: only the patch plays
            audio.clear();
        }
        MidiOutParams p;
        p.channel = (int)channel_->load();
        p.ccANumber = (int)ccANumber_->load();
        p.ccBNumber = (int)ccBNumber_->load();
        p.transpose = (int)transpose_->load();
        p.sendCCs = sendCCs_->load() >= 0.5f;
        Sink sink{midi, b.start};
        const float *gate = signalInput(gate_), *pitch = signalInput(pitch_);
        for (int i = 0; i < b.numSamples; ++i) {
            p.velocity = modulatedValue(velocity_, i);
            p.ccA = modulatedValue(ccA_, i);
            p.ccB = modulatedValue(ccB_, i);
            p.bend = modulatedValue(bend_, i);
            dsp_.tick(p, gate[i], pitch[i], i, sink);
        }
    }

private:
    struct Sink {
        juce::MidiBuffer& midi;
        int base;
        void operator()(int offset, const uint8_t* bytes, int size) {
            midi.addEvent(juce::MidiMessage(bytes, size), base + offset);
        }
    };

    MidiOutDsp<Sink> dsp_;
    int velocity_ = 0, ccA_ = 0, ccB_ = 0, bend_ = 0, gate_ = 0, pitch_ = 0;
    std::atomic<float>*channel_ = nullptr, *ccANumber_ = nullptr, *ccBNumber_ = nullptr, *transpose_ = nullptr,
    *sendCCs_ = nullptr;
};

}  // namespace bleep::patch

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new bleep::patch::MidiOutProcessor(); }
