// SPDX-License-Identifier: MIT
//
// AppController — the standalone Bleep Patch app (spec §11): owns the engine,
// the audio device, the app's own MIDI ports, Ableton Link, the Bleep Audio
// Bridge server and the project file, and drives the engine:
//
//   alone            the audio device's callback runs every port (processAll)
//   with Live        Bleep Audio Bridge plugins wake the bridge thread, which
//                    runs the bridges plus MIDI and Link; the device is silent
#pragma once

#include "BridgeServer.h"
#include "Engine.h"
#include "LinkClock.h"

#include <juce_audio_utils/juce_audio_utils.h>

#include <array>
#include <functional>
#include <memory>
#include <vector>

namespace bleep::app {

class AppController : public juce::AudioIODeviceCallback,
                      public juce::MidiInputCallback,
                      public juce::MenuBarModel,
                      public juce::ApplicationCommandTarget,
                      private juce::ChangeListener,
                      private juce::Timer {
public:
    AppController();
    ~AppController() override;

    void start(const juce::String& commandLine);
    /// --smoke: no audio inputs, no Link, no saved settings; report() after a few seconds.
    void setSmokeTest(bool on) noexcept { smoke_ = on; }
    juce::String report() const;
    void openFromCommandLine(const juce::String& commandLine);
    /// Asks to save unsaved changes, then calls `then` (unless cancelled).
    void confirmDiscard(std::function<void()> then);

    // Settings: the board window's Settings section calls settingsCall (BoardWindowStyle::onSettings).
    void setVirtualPorts(int n);
    void setLinkEnabled(bool on);
    juce::var settingsCall(const juce::String& fn, const juce::var& arg);

    // ---- juce::AudioIODeviceCallback ----------------------------------------
    void audioDeviceIOCallbackWithContext(const float* const* inputs, int numInputs, float* const* outputs,
                                          int numOutputs, int numSamples,
                                          const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart(juce::AudioIODevice*) override;
    void audioDeviceStopped() override {}

    // ---- juce::MidiInputCallback ---------------------------------------------
    void handleIncomingMidiMessage(juce::MidiInput* source, const juce::MidiMessage& message) override;

    // ---- menus and commands --------------------------------------------------
    juce::StringArray getMenuBarNames() override;
    juce::PopupMenu getMenuForIndex(int index, const juce::String& name) override;
    void menuItemSelected(int, int) override {}
    juce::ApplicationCommandTarget* getNextCommandTarget() override { return nullptr; }
    void getAllCommands(juce::Array<juce::CommandID>& commands) override;
    void getCommandInfo(juce::CommandID id, juce::ApplicationCommandInfo& info) override;
    bool perform(const InvocationInfo& info) override;

private:
    struct AudioPort {
        juce::String id;
        int handle = 0;
        bool input = false;
        int channel = 0;  ///< first of the pair, among the device's active channels
        engine::BlockIO io;
        const float* in[2] = {nullptr, nullptr};
        float* out[2] = {nullptr, nullptr};
    };
    struct MidiPort {
        juce::String id, name, identifier;  ///< identifier: the hardware input it listens to
        int inHandle = 0, outHandle = 0;
        std::unique_ptr<juce::MidiInput> input;    ///< virtual ports: the app's own input
        std::unique_ptr<juce::MidiOutput> output;
        juce::MidiOutput* sharedOutput = nullptr;  ///< hardware: the device manager's default output
        juce::AbstractFifo fifo{512};
        std::array<engine::MidiEvent, 512> fifoData{};
        std::array<double, 512> fifoTime{};  ///< arrival, in seconds (Time::getMillisecondCounterHiRes)
        std::vector<engine::MidiEvent> inBlock, outBlock;
        engine::BlockIO inIo, outIo;
    };

    void timerCallback() override;
    void syncDeviceNodes();
    void changeListenerCallback(juce::ChangeBroadcaster*) override;
    void syncPorts();
    int addInstance(engine::PortKind kind, const juce::String& id, const juce::String& name);
    void removeInstance(int& handle);
    void buildControlPorts(const engine::Transport& t, int numSamples, std::vector<int>& handles,
                           std::vector<engine::BlockIO*>& ios);
    void sendMidi();
    engine::Transport transportFor(int numSamples);

    void newProject();
    bool openProject(const juce::File& file);
    /// A patch from the preset browser: replaces the project (an untitled one) after asking about unsaved changes.
    void loadPatch(const juce::var& board, double tempo, const juce::String& name);
    bool saveProject(const juce::File& file);
    void saveAs(std::function<void()> then = {});
    void save(std::function<void()> then = {});
    bool dirty() const;
    void updateTitle();
    void showSettings();
    juce::var settingsState();
    void saveSettings();

    engine::IEngine* iengine_ = nullptr;
    engine::Engine* engine_ = nullptr;
    int main_ = 0;
    int linkHandle_ = 0;

    juce::AudioDeviceManager devices_;
    juce::ApplicationCommandManager commands_;
    std::unique_ptr<juce::PropertiesFile> settings_;
    std::unique_ptr<bridge::BridgeServer> bridge_;
    LinkClock clock_;
    std::unique_ptr<juce::FileChooser> chooser_;

    // Ports: changed on the message thread under both locks. Audio threads only
    // try portsLock_ (they never wait); MIDI input threads take midiLock_ and
    // never drop a message (a lost note-off is a hanging voice).
    juce::SpinLock portsLock_;
    juce::SpinLock midiLock_;
    std::vector<std::unique_ptr<AudioPort>> audioPorts_;
    std::vector<std::unique_ptr<MidiPort>> midiPorts_;
    std::vector<std::unique_ptr<MidiPort>> devicePorts_;  ///< MIDI Device nodes (spec §12): id = node's port
    engine::BlockIO linkIo_;
    std::vector<int> handles_;
    std::vector<engine::BlockIO*> ios_;
    std::vector<float> scratch_;
    int virtualPorts_ = 2;

    std::atomic<double> quantum_{4.0};
    std::atomic<double> sampleRate_{48000.0};
    std::atomic<int64_t> latencyMicros_{0};

    bool smoke_ = false;
    juce::File project_;
    uint64_t savedGeneration_ = 0;
    juce::String lastTitle_;
};

}  // namespace bleep::app
