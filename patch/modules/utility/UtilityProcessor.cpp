// SPDX-License-Identifier: MIT
// Utility module: attenuverter, offset, mixer, shaper, slew and comparator.
#include "ModuleProcessor.h"
#include "Params.h"
#include "UtilityDsp.h"

namespace bleep::patch {

class UtilityProcessor final : public ModuleProcessor {
public:
    UtilityProcessor()
        : ModuleProcessor(BusesProperties()
                              .withInput("Input", juce::AudioChannelSet::stereo(), true)
                              .withOutput("Output", juce::AudioChannelSet::stereo(), true),
                          {"Utility", "Brilliant Bleep", juce::Colour(0xffa78bfa)}, layout()) {
        scaleX_ = addModulation("scalex");
        scaleY_ = addModulation("scaley");
        offset_ = addModulation("offset");
        slew_ = addModulation("slew");
        threshold_ = addModulation("threshold");
        x_ = addSignalInput("X", BB_SIGNAL_CONTROL);
        y_ = addSignalInput("Y", BB_SIGNAL_CONTROL);
        clock_ = addSignalInput("Clock", BB_SIGNAL_GATE);
        out_ = addOutput("Out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR);
        gate_ = addOutput("Gate", BB_SIGNAL_GATE, BB_POLARITY_UNIPOLAR);
        inv_ = addOutput("Inv", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR);
        mode_ = parameters().getRawParameterValue("mode");
    }

    static juce::AudioProcessorValueTreeState::ParameterLayout layout() {
        juce::AudioProcessorValueTreeState::ParameterLayout l;
        l.add(params::number("scalex", "Scale X", {-1.0f, 1.0f}, 1.0f));
        l.add(params::number("scaley", "Scale Y", {-1.0f, 1.0f}, 0.0f));
        l.add(params::number("offset", "Offset", {-1.0f, 1.0f}, 0.0f));
        l.add(params::seconds("slew", "Slew", 0.0f, 5.0f, 0.1f, 0.0f));
        l.add(params::number("threshold", "Threshold", {-1.0f, 1.0f}, 0.0f));
        l.add(params::choice("mode", "Mode", {"Through", "Rectify", "Fold", "Quantize", "Sample & Hold"}, 0));
        return l;
    }

    void resetModule() override { dsp_.reset(); }

    void renderModule(const RenderBlock& b, juce::AudioBuffer<float>&, juce::MidiBuffer&) override {
        UtilityParams p;
        p.mode = (UtilityMode)juce::jlimit(0, 4, (int)mode_->load());
        const float *x = signalInput(x_), *y = signalInput(y_), *clock = signalInput(clock_);
        float *out = output(out_), *gate = output(gate_), *inv = output(inv_);
        for (int i = 0; i < b.numSamples; ++i) {
            p.scaleX = modulatedValue(scaleX_, i);
            p.scaleY = modulatedValue(scaleY_, i);
            p.offset = modulatedValue(offset_, i);
            p.slew = modulatedValue(slew_, i);
            p.threshold = modulatedValue(threshold_, i);
            dsp_.tick(p, x[i], y[i], clock[i], b.sampleRate, out[i], gate[i], inv[i]);
        }
    }

private:
    UtilityDsp dsp_;
    int scaleX_ = 0, scaleY_ = 0, offset_ = 0, slew_ = 0, threshold_ = 0;
    int x_ = 0, y_ = 0, clock_ = 0, out_ = 0, gate_ = 0, inv_ = 0;
    std::atomic<float>* mode_ = nullptr;
};

}  // namespace bleep::patch

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new bleep::patch::UtilityProcessor(); }
