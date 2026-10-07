// SPDX-License-Identifier: MIT
// Function module: slope generator (LFO / envelope) with four related outputs.
#include "FunctionDsp.h"
#include "ModuleProcessor.h"
#include "Params.h"

namespace bleep::patch {

class FunctionProcessor final : public ModuleProcessor {
public:
    FunctionProcessor()
        : ModuleProcessor(BusesProperties()
                              .withInput("Input", juce::AudioChannelSet::stereo(), true)
                              .withOutput("Output", juce::AudioChannelSet::stereo(), true),
                          {"Function", "Brilliant Bleep", juce::Colour(0xff4fd1c5)}, layout()) {
        rise_ = addModulation("rise");
        fall_ = addModulation("fall");
        shape_ = addModulation("shape");
        spread_ = addModulation("spread");
        trig_ = addSignalInput("Trig", BB_SIGNAL_GATE);
        for (const char* name : {"A", "B", "C", "D"}) addOutput(name, BB_SIGNAL_CONTROL, BB_POLARITY_UNIPOLAR);
        eoc_ = addOutput("EOC", BB_SIGNAL_TRIGGER, BB_POLARITY_UNIPOLAR);
        cycle_ = parameters().getRawParameterValue("cycle");
        sync_ = parameters().getRawParameterValue("sync");
    }

    static juce::AudioProcessorValueTreeState::ParameterLayout layout() {
        juce::AudioProcessorValueTreeState::ParameterLayout l;
        l.add(params::seconds("rise", "Rise", 0.001f, 10.0f, 0.25f, 0.25f));
        l.add(params::seconds("fall", "Fall", 0.001f, 10.0f, 0.25f, 0.25f));
        l.add(params::number("shape", "Shape", {-1.0f, 1.0f}, 0.0f));
        l.add(params::percent("spread", "Spread", 0.0f, 1.0f, 0.0f));
        l.add(params::toggle("cycle", "Cycle", true));
        l.add(params::choice("sync", "Sync", params::syncChoices(), 0));
        return l;
    }

    void resetModule() override { dsp_.reset(); }

    void renderModule(const RenderBlock& b, juce::AudioBuffer<float>&, juce::MidiBuffer&) override {
        FunctionParams p;
        p.cycle = cycle_->load() >= 0.5f;
        p.sync = (int)sync_->load();
        SampleClock clk;
        clk.sampleRate = b.sampleRate;
        clk.bpm = b.bpm;
        clk.locked = b.playing && b.ppqValid;
        const float* trig = signalInput(trig_);
        float* outs[4] = {output(0), output(1), output(2), output(3)};
        float* eoc = output(eoc_);
        for (int i = 0; i < b.numSamples; ++i) {
            p.rise = modulatedValue(rise_, i);
            p.fall = modulatedValue(fall_, i);
            p.shape = modulatedValue(shape_, i);
            p.spread = modulatedValue(spread_, i);
            clk.ppq = b.ppqAt(i);
            float frame[4];
            dsp_.tick(p, trig[i], clk, frame, eoc[i]);
            for (int k = 0; k < 4; ++k) outs[k][i] = frame[k];
        }
    }

private:
    FunctionDsp dsp_;
    int rise_ = 0, fall_ = 0, shape_ = 0, spread_ = 0, trig_ = 0, eoc_ = 0;
    std::atomic<float>* cycle_ = nullptr;
    std::atomic<float>* sync_ = nullptr;
};

}  // namespace bleep::patch

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new bleep::patch::FunctionProcessor(); }
