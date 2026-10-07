// SPDX-License-Identifier: MIT
// Filter module: the first audio module. Every control is a bus destination;
// cutoff modulation works in octaves and may run at audio rate.
#include "FilterDsp.h"
#include "ModuleProcessor.h"
#include "Params.h"

namespace bleep::patch {

class FilterProcessor final : public ModuleProcessor {
public:
    FilterProcessor()
        : ModuleProcessor(BusesProperties()
                              .withInput("Input", juce::AudioChannelSet::stereo(), true)
                              .withOutput("Output", juce::AudioChannelSet::stereo(), true),
                          {"Filter", "Brilliant Bleep", juce::Colour(0xfff472b6)}, layout()) {
        cutoff_ = addModulation("cutoff");
        resonance_ = addModulation("resonance");
        drive_ = addModulation("drive");
        morph_ = addModulation("mode");
        mix_ = addModulation("mix");
        keyTrack_ = addModulation("keytrack");
        pitch_ = addSignalInput("Pitch", BB_SIGNAL_PITCH);
        env_ = addOutput("Env", BB_SIGNAL_CONTROL, BB_POLARITY_UNIPOLAR);
    }

    static juce::AudioProcessorValueTreeState::ParameterLayout layout() {
        juce::AudioProcessorValueTreeState::ParameterLayout l;
        l.add(std::make_unique<juce::AudioParameterFloat>(
            params::id("cutoff"), "Cutoff", params::exponential(20.0f, 20000.0f), 2000.0f,
            juce::AudioParameterFloatAttributes().withStringFromValueFunction([](float hz, int) {
                return hz < 1000.0f ? juce::String(juce::roundToInt(hz)) + " Hz" : juce::String(hz / 1000.0f, 2) + " kHz";
            })));
        l.add(params::percent("resonance", "Resonance", 0.0f, 1.0f, 0.2f));
        l.add(params::percent("drive", "Drive", 0.0f, 1.0f, 0.0f));
        l.add(std::make_unique<juce::AudioParameterFloat>(
            params::id("mode"), "Mode", juce::NormalisableRange<float>(0.0f, 1.0f), 0.0f,
            juce::AudioParameterFloatAttributes().withStringFromValueFunction([](float v, int) {
                static const char* names[] = {"LP", "BP", "HP", "Notch"};
                const float m = v * 3.0f;
                const int i = juce::roundToInt(m);
                return std::abs(m - (float)i) < 0.05f ? juce::String(names[i])
                                                      : juce::String(names[(int)m]) + "›" + names[juce::jmin(3, (int)m + 1)];
            })));
        l.add(params::percent("mix", "Mix", 0.0f, 1.0f, 1.0f));
        l.add(params::percent("keytrack", "Key Track", 0.0f, 1.0f, 0.0f));
        return l;
    }

    void prepareModule(double sampleRate) override { dsp_.prepare(sampleRate); }
    void resetModule() override { dsp_.reset(); }

    void renderModule(const RenderBlock& b, juce::AudioBuffer<float>& audio, juce::MidiBuffer&) override {
        const int channels = juce::jmin(audio.getNumChannels(), FilterDsp::kMaxChannels);
        const float* cutoff = modulated(cutoff_); // normalised = octave domain
        const float* pitch = signalInput(pitch_);
        float* env = output(env_);
        FilterParams p;
        for (int i = 0; i < b.numSamples; ++i) {
            p.cutoff = cutoff[i];
            p.resonance = modulatedValue(resonance_, i);
            p.drive = modulatedValue(drive_, i);
            p.morph = modulatedValue(morph_, i);
            p.mix = modulatedValue(mix_, i);
            p.keyTrack = modulatedValue(keyTrack_, i);
            float frame[FilterDsp::kMaxChannels] = {};
            for (int ch = 0; ch < channels; ++ch) frame[ch] = audio.getSample(ch, b.start + i);
            env[i] = dsp_.tick(p, pitch[i], frame, channels);
            for (int ch = 0; ch < channels; ++ch) audio.setSample(ch, b.start + i, frame[ch]);
        }
    }

private:
    FilterDsp dsp_;
    int cutoff_ = 0, resonance_ = 0, drive_ = 0, morph_ = 0, mix_ = 0, keyTrack_ = 0, pitch_ = 0, env_ = 0;
};

}  // namespace bleep::patch

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new bleep::patch::FilterProcessor(); }
