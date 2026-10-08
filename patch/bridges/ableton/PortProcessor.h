// SPDX-License-Identifier: MIT
//
// PortProcessor — every plugin users add in Live (spec §6): Bleep Patch and
// the ports of the Ableton bridge. One class, configured by PortKind; each
// plugin binary is this class with a different BLEEP_PORT_KIND.
//
// The plugin itself does little: it hands its host block to the shared
// engine and plays back what the engine returns. The board lives in the
// engine; Bleep Patch stores it in its state.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "EngineApi.h"

#include <array>
#include <atomic>
#include <vector>

namespace bleep::patch {

class PortProcessor : public juce::AudioProcessor, private juce::Timer {
public:
    explicit PortProcessor(engine::PortKind kind);
    ~PortProcessor() override;

    engine::PortKind kind() const noexcept { return kind_; }
    engine::IEngine& engine() const noexcept { return instance_.engine(); }
    int handle() const noexcept { return instance_.handle(); }
    juce::AudioParameterFloat* mixParameter() const noexcept { return mix_; }
    bool reportsLatency() const noexcept;

    // ---- juce::AudioProcessor ----------------------------------------------
    const juce::String getName() const override;
    bool acceptsMidi() const override;
    bool producesMidi() const override { return kind_ == engine::PortKind::MidiOut; }
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
    static BusesProperties busesFor(engine::PortKind kind);

    engine::PortKind kind_;
    engine::EngineInstance instance_;

    std::array<juce::AudioParameterFloat*, engine::kNumMacros> macros_{};
    juce::AudioParameterFloat* mix_ = nullptr;
    float macroValues_[engine::kNumMacros] = {};

    std::vector<engine::MidiEvent> midiIn_, midiOut_;
    juce::AudioBuffer<float> board_;   ///< Audio Insert: the board's return
    juce::AudioBuffer<float> delay_;   ///< Audio Insert: dry signal, delayed by the board latency
    int delayPos_ = 0;
    std::atomic<int> latency_{0};
    int64_t fallbackPos_ = 0;
    uint64_t seenGeneration_ = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PortProcessor)
};

}  // namespace bleep::patch
