// SPDX-License-Identifier: MIT
//
// ModuleProcessor — the base class of every Bleep Patch module.
//
// It does the bus plumbing so a module only writes DSP:
//  - registers the instance on Bleep Bus and keeps its UID in the plugin state;
//  - gives every modulated parameter a bus input of the same name and applies
//    modulation as an offset in normalised parameter space
//        effective = clamp(knob + Σ source × amount, 0, 1)
//    so the host-visible knob never moves (no automation, no undo spam);
//  - reads signal inputs, writes outputs, splits large host blocks;
//  - saves cables with the instance and tells the host when they change.
//
// Modules use the bus only through its public API (bleep_bus.hpp), exactly
// like a third-party plugin would.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "bleep_bus_juce.h"

#include <array>
#include <atomic>
#include <memory>
#include <vector>

namespace bleep::patch {

/// What a module's render function needs to know about the current sub-block.
struct RenderBlock {
    int start = 0;            ///< sample offset inside the host buffer
    int numSamples = 0;
    double sampleRate = 48000.0;
    double bpm = 120.0;
    bool playing = false;
    bool transportStarted = false; ///< first block after the transport started
    bool ppqValid = false;    ///< true if the host reports musical position
    double ppqStart = 0.0;    ///< quarter notes at `start`
    double ppqPerSample = 0.0;
    double ppqAt(int i) const noexcept { return ppqStart + ppqPerSample * i; }
};

class ModuleProcessor : public juce::AudioProcessor, private juce::Timer {
public:
    struct Description {
        juce::String product;           ///< e.g. "Function"
        juce::String vendor = "Brilliant Bleep";
        juce::Colour colour = juce::Colour(0xff4fd1c5);
        bool acceptsMidi = false;
        bool producesMidi = false;
    };

    ModuleProcessor(const BusesProperties& buses, Description description,
                    juce::AudioProcessorValueTreeState::ParameterLayout layout);
    ~ModuleProcessor() override;

    // ---- building the module (call from the subclass constructor) -------

    /// Makes a parameter a bus destination. Returns its modulation index.
    int addModulation(const juce::String& parameterId);
    int addSignalInput(const juce::String& name, bb_signal_type type);
    int addOutput(const juce::String& name, bb_signal_type type, bb_polarity polarity);

    // ---- render API -------------------------------------------------------

    virtual void prepareModule(double sampleRate) { juce::ignoreUnused(sampleRate); }
    virtual void resetModule() {}
    /// Renders one sub-block of at most BB_MAX_BLOCK_SAMPLES. Audio passes
    /// through untouched unless the module writes to `audio`.
    virtual void renderModule(const RenderBlock& block, juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi) = 0;

    /// Effective normalised values (0..1), one per sample of the block.
    const float* modulated(int index) const noexcept { return mods_[(size_t)index]->buffer.data(); }
    /// Effective value of a modulated parameter in its own units.
    float modulatedValue(int index, int sample) const noexcept {
        const auto& m = *mods_[(size_t)index];
        return m.param->convertFrom0to1(m.buffer[(size_t)sample]);
    }
    const float* signalInput(int index) const noexcept { return inputs_[(size_t)index]->buffer.data(); }
    bool signalInputPatched(int index) const noexcept { return inputs_[(size_t)index]->patched.load(); }
    float* output(int index) noexcept { return outputs_[(size_t)index]->buffer.data(); }

    juce::AudioProcessorValueTreeState& parameters() noexcept { return apvts_; }

    // ---- for the editor -----------------------------------------------------

    struct Modulation {
        juce::RangedAudioParameter* param = nullptr;
        bleep::Input input;
        std::vector<float> buffer;
        std::vector<float> scratch;
        std::atomic<float> display{0.0f};  ///< last effective normalised value
        std::atomic<bool> active{false};   ///< at least one source present
    };
    struct SignalInput {
        juce::String name;
        bb_signal_type type = BB_SIGNAL_CONTROL;
        bleep::Input input;
        std::vector<float> buffer;
        std::atomic<bool> patched{false};
    };
    struct Output {
        juce::String name;
        bb_signal_type type = BB_SIGNAL_CONTROL;
        bb_polarity polarity = BB_POLARITY_BIPOLAR;
        bleep::Output output;
        std::vector<float> buffer;
        std::atomic<float> display{0.0f};
    };

    const Description& description() const noexcept { return description_; }
    const std::vector<std::unique_ptr<Modulation>>& modulations() const noexcept { return mods_; }
    const std::vector<std::unique_ptr<SignalInput>>& signalInputs() const noexcept { return inputs_; }
    const std::vector<std::unique_ptr<Output>>& outputs() const noexcept { return outputs_; }
    bool isModulated(const juce::String& parameterId) const;

    bleep::Bus* bus() const noexcept { return bus_ && bus_->ok() ? bus_.get() : nullptr; }
    bleep::Endpoint* endpoint() const noexcept { return endpoint_ && endpoint_->ok() ? endpoint_.get() : nullptr; }
    uint64_t uid() const noexcept { return endpoint() ? endpoint()->uid() : 0; }
    juce::String busStatus() const;

    juce::String instanceName() const { return instanceName_; }
    void setInstanceName(const juce::String& name, bool notifyHost = true);

    // ---- juce::AudioProcessor ----------------------------------------------

    const juce::String getName() const override { return "Bleep " + description_.product; }
    bool acceptsMidi() const override { return description_.acceptsMidi; }
    bool producesMidi() const override { return description_.producesMidi; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void prepareToPlay(double sampleRate, int maximumExpectedSamplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi) override;
    using juce::AudioProcessor::processBlock;

    bool hasEditor() const override { return true; }
    juce::AudioProcessorEditor* createEditor() override;

    void getStateInformation(juce::MemoryBlock& dest) override;
    void setStateInformation(const void* data, int sizeInBytes) override;
    void updateTrackProperties(const TrackProperties& properties) override;

private:
    void timerCallback() override;

    Description description_;
    juce::AudioProcessorValueTreeState apvts_;
    std::shared_ptr<bleep::Bus> bus_;
    std::unique_ptr<bleep::Endpoint> endpoint_;
    std::vector<std::unique_ptr<Modulation>> mods_;
    std::vector<std::unique_ptr<SignalInput>> inputs_;
    std::vector<std::unique_ptr<Output>> outputs_;

    juce::String instanceName_;
    juce::CriticalSection trackNameLock_;
    juce::String pendingTrackName_;
    bool trackNameDirty_ = false;
    uint32_t seenPatchVersion_ = 0;

    int64_t fallbackSamplePos_ = 0;
    bool wasPlaying_ = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ModuleProcessor)
};

}  // namespace bleep::patch
