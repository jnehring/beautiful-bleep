// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// PortProcessor — every plugin users add in Live (spec §6): Bleep Board and
// the ports of the Ableton bridge. One class, configured by PortKind; each
// plugin binary is this class with a different BLEEP_PORT_KIND.
//
// The plugin itself does little: it hands its host block to the shared
// engine and plays back what the engine returns. The board lives in the
// engine; Bleep Board stores it in its state.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "BridgeClient.h"
#include "EngineApi.h"
#include "LiveLinkSender.h"

#include <array>
#include <atomic>
#include <vector>

namespace bleep::patch {

/// An automatable parameter whose name the board can change: one of the 16 of a cell plugin (the name follows the preset's
/// panel), or a macro (its label).
class SlotParameter : public juce::AudioParameterFloat {
public:
    SlotParameter(int slot) : SlotParameter("p" + juce::String(slot + 1), "Param " + juce::String(slot + 1)) {}
    SlotParameter(const juce::String& id, const juce::String& fallback)
        : juce::AudioParameterFloat(juce::ParameterID(id, 1), fallback, 0.0f, 1.0f, 0.0f), fallback_(fallback) {}
    juce::String getName(int maxLen) const override {
        const juce::SpinLock::ScopedLockType lock(lock_);
        return (shown_.isNotEmpty() ? shown_ : fallback_).substring(0, maxLen);
    }
    void setShownName(const juce::String& n) {
        const juce::SpinLock::ScopedLockType lock(lock_);
        shown_ = n;
    }
    juce::String shownName() const {
        const juce::SpinLock::ScopedLockType lock(lock_);
        return shown_;
    }

private:
    mutable juce::SpinLock lock_;
    juce::String shown_, fallback_;
};

class PortProcessor : public juce::AudioProcessor, private juce::Timer, private juce::AudioProcessorParameter::Listener {
public:
    explicit PortProcessor(engine::PortKind kind);
    ~PortProcessor() override;

    engine::PortKind kind() const noexcept { return kind_; }
    engine::IEngine& engine() const noexcept { return instance_.engine(); }
    int handle() const noexcept { return instance_.handle(); }
    juce::AudioParameterFloat* mixParameter() const noexcept { return mix_; }
    /// Bleep Instrument and Bleep FX load a cell preset (doc/specs/cell-plugins.md).
    bool loadsPresets() const noexcept { return kind_ == engine::PortKind::Instrument || kind_ == engine::PortKind::AudioInsert; }
    /// Puts the named factory preset into this instance (replacing the cell that is there).
    void loadPreset(const juce::String& name);
    juce::String presetName() const;
    bool reportsLatency() const noexcept;
    /// The board's latency for this plugin: 0 for a cell plugin whose cell the engine runs in the plugin's own block.
    int boardLatency() noexcept;
    /// Bleep MIDI In/Out and Audio In/Out can talk to another board: the app's or a browser's (bridges.md §1).
    bool canBridge() const noexcept;
    juce::AudioParameterChoice* boardParameter() const noexcept { return boardChoice_; }
    bridge::Board board() const noexcept;
    bool bridged() const noexcept { return board() != bridge::Board::ThisSet; }
    bridge::BridgeClient& bridgeClient() noexcept { return client_; }

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
    void releaseResources() override { prepared_ = false; }
    /// Whether the host has prepared this plugin for audio. Live does not while no audio interface is set up.
    bool audioPrepared() const noexcept { return prepared_; }
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
    void parameterValueChanged(int index, float value) override;
    void parameterGestureChanged(int, bool) override {}
    void pollSlots();
    void pollMacroLabels();
    void applyBoard();
    static BusesProperties busesFor(engine::PortKind kind);

    engine::PortKind kind_;
    std::atomic<bool> prepared_{false};
    engine::EngineInstance instance_;

    std::array<SlotParameter*, engine::kNumMacros> macros_{};
    juce::AudioParameterFloat* mix_ = nullptr;
    juce::AudioParameterChoice* boardChoice_ = nullptr;   ///< This set / App / Web
    bridge::BridgeClient client_;
    std::unique_ptr<LiveLinkSender> liveLink_;   ///< Bleep Board: sends the Live Params node to the Bleep Live Link device
    std::vector<bridge::Midi> bridgeMidiIn_, bridgeMidiOut_;
    juce::AudioBuffer<float> bridgeRet_;
    juce::String track_;
    int appliedBoard_ = -1;                         ///< what the engine and the client were last told
    float macroValues_[engine::kNumMacros] = {};

    std::vector<engine::MidiEvent> midiIn_, midiOut_;
    juce::AudioBuffer<float> board_;   ///< Audio Insert: the board's return
    juce::AudioBuffer<float> delay_;   ///< Audio Insert: dry signal, delayed by the board latency
    int delayPos_ = 0;
    std::atomic<int> latency_{0};
    int64_t fallbackPos_ = 0;
    uint64_t seenGeneration_ = 0;
    static constexpr int kSlots = 16;
    static constexpr int kHostMacros = 8;   ///< Bleep Instrument and Bleep FX: Macro 1…8 (engine::kNumHostMacros)
    std::array<SlotParameter*, kSlots> slots_{};
    struct Mapped { juce::String node, param; };
    std::array<Mapped, kSlots> mapping_{};
    std::array<std::atomic<bool>, kSlots> slotDirty_{};   ///< the host moved it: the knob follows
    bool ignoring_ = false;                               ///< we are setting it ourselves
    uint64_t slotsGeneration_ = ~0ull;
    uint64_t macrosGeneration_ = ~0ull;
    int slotTick_ = 0;
    bool stateRestored_ = false;   ///< setStateInformation ran: a saved set, not a fresh instance

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PortProcessor)
};

}  // namespace bleep::patch
