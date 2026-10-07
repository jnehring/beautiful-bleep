// SPDX-License-Identifier: MIT
// Random module: seeded stepped randomness with a looping memory.
#include "ModuleProcessor.h"
#include "Params.h"
#include "RandomDsp.h"

namespace bleep::patch {

class RandomProcessor final : public ModuleProcessor {
public:
    RandomProcessor()
        : ModuleProcessor(BusesProperties()
                              .withInput("Input", juce::AudioChannelSet::stereo(), true)
                              .withOutput("Output", juce::AudioChannelSet::stereo(), true),
                          {"Random", "Brilliant Bleep", juce::Colour(0xfff6a85b)}, layout()) {
        rate_ = addModulation("rate");
        spread_ = addModulation("spread");
        bias_ = addModulation("bias");
        smooth_ = addModulation("smooth");
        loop_ = addModulation("loop");
        clock_ = addSignalInput("Clock", BB_SIGNAL_GATE);
        out_ = addOutput("Out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR);
        trig_ = addOutput("Trig", BB_SIGNAL_TRIGGER, BB_POLARITY_UNIPOLAR);
        sync_ = parameters().getRawParameterValue("sync");
        length_ = parameters().getRawParameterValue("length");
        quantize_ = parameters().getRawParameterValue("quantize");
        seed_ = parameters().getRawParameterValue("seed");
    }

    static juce::AudioProcessorValueTreeState::ParameterLayout layout() {
        juce::AudioProcessorValueTreeState::ParameterLayout l;
        l.add(params::number("rate", "Rate", params::exponential(0.05f, 50.0f), 2.0f, "Hz"));
        l.add(params::percent("spread", "Spread", 0.0f, 1.0f, 1.0f));
        l.add(params::number("bias", "Bias", {-1.0f, 1.0f}, 0.0f));
        l.add(params::percent("smooth", "Smooth", 0.0f, 1.0f, 0.0f));
        l.add(params::percent("loop", "Loop", 0.0f, 1.0f, 0.0f));
        l.add(params::choice("sync", "Sync", params::syncChoices(), 4));
        juce::StringArray lengths;
        for (int n : RandomDsp::kLengths) lengths.add(juce::String(n) + " steps");
        l.add(params::choice("length", "Length", lengths, 5));
        l.add(params::toggle("quantize", "Semitones", false));
        l.add(params::integer("seed", "Seed", 0, 999, 1));
        return l;
    }

    void prepareModule(double sampleRate) override { dsp_.prepare(sampleRate); }
    void resetModule() override { dsp_.reset(); }

    void renderModule(const RenderBlock& b, juce::AudioBuffer<float>&, juce::MidiBuffer&) override {
        if (b.transportStarted) dsp_.restart();
        RandomParams p;
        p.sync = (int)sync_->load();
        p.length = RandomDsp::kLengths[(size_t)juce::jlimit(0, (int)RandomDsp::kLengths.size() - 1, (int)length_->load())];
        p.quantize = quantize_->load() >= 0.5f;
        p.seed = (uint32_t)seed_->load();
        const float* clock = signalInput(clock_);
        const bool clockPatched = signalInputPatched(clock_);
        float* out = output(out_);
        float* trig = output(trig_);
        for (int i = 0; i < b.numSamples; ++i) {
            p.rateHz = modulatedValue(rate_, i);
            p.spread = modulatedValue(spread_, i);
            p.bias = modulatedValue(bias_, i);
            p.smooth = modulatedValue(smooth_, i);
            p.loop = modulatedValue(loop_, i);
            dsp_.tick(p, clock[i], clockPatched, b.bpm, b.ppqAt(i), b.playing && b.ppqValid, out[i], trig[i]);
        }
    }

private:
    RandomDsp dsp_;
    int rate_ = 0, spread_ = 0, bias_ = 0, smooth_ = 0, loop_ = 0, clock_ = 0, out_ = 0, trig_ = 0;
    std::atomic<float>*sync_ = nullptr, *length_ = nullptr, *quantize_ = nullptr, *seed_ = nullptr;
};

}  // namespace bleep::patch

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new bleep::patch::RandomProcessor(); }
