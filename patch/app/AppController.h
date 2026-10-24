// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// AppController — the standalone Bleep App (spec §11): owns the engine,
// the audio device, the app's own MIDI ports, Ableton Link, the Bleep Audio
// Bridge server and the project file, and drives the engine:
//
//   alone            the audio device's callback runs every port (processAll)
//   with Live        Bleep Audio Bridge plugins wake the bridge thread, which
//                    runs the bridges plus MIDI and Link; the device is silent
#pragma once
#include <map>

#include "BridgeServer.h"
#include "Engine.h"
#include "HostControl.h"
#include "LinkClock.h"
#include "WebHub.h"
#include "SystemAudio.h"

#include <juce_audio_utils/juce_audio_utils.h>

#include <array>
#include <functional>
#include <memory>
#include <set>
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
    /// --system-audio: capture what the computer plays for this run, whatever the saved settings say (not saved).
    void setForceSystemAudio(bool on) noexcept { forceSystem_ = on; }
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
    void menuItemSelected(int itemId, int) override;
    /// The page's menus (BoardWindowStyle::onMenu): the menu bar is built from them.
    void setMenuModel(const juce::var& menus);
    juce::ApplicationCommandTarget* getNextCommandTarget() override { return nullptr; }
    void getAllCommands(juce::Array<juce::CommandID>& commands) override;
    void getCommandInfo(juce::CommandID id, juce::ApplicationCommandInfo& info) override;
    bool perform(const InvocationInfo& info) override;

private:
    juce::var menuModel_;                        ///< what the page sent (setMenuModel)
    juce::String menuModelJson_;
    std::map<int, juce::String> menuIds_;        ///< item ID -> page command id, for the items the page answers
    struct AudioPort {
        juce::String id;
        int handle = 0;
        bool input = false;
        int channel = 0;  ///< first of the pair, among the device's active channels
        bool system = false;  ///< the System port: what the computer plays, not a channel of the device (system-audio.md)
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
    juce::var systemAudioState();
    /// Starts, restarts or stops System Audio capture to match systemEnabled_ and friends, then updates the ports.
    void applySystemAudio();
    void saveSettings();
    /// Settings → Web connection: starts or stops the hub to match webEnabled_ and webPort_.
    void applyWeb();
    /// The Transport module's requests (engine/HostControl.h): tempo, play and stop, Link. About every 10 ms.
    void applyHostControl();
    juce::var webState();
    bool askPairing(const std::string& origin);

    engine::IEngine* iengine_ = nullptr;
    engine::Engine* engine_ = nullptr;
    int main_ = 0;
    int linkHandle_ = 0;

    bool forceWeb_ = false;   ///< BLEEP_WEB_PORT: on for this run only
    bool webEnabled_ = false;
    int webPort_ = 47100;
    juce::String webError_;
    juce::CriticalSection originsLock_;
    std::set<std::string> allowedOrigins_;

    juce::AudioDeviceManager devices_;
    juce::ApplicationCommandManager commands_;
    std::unique_ptr<juce::PropertiesFile> settings_;
    std::unique_ptr<hub::WebHub> hub_;              ///< the web link (doc/specs/bridges.md); declared before bridge_: it outlives it
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

    // System Audio (doc/specs/system-audio.md): what the computer plays, as one more audio port. system_ changes under
    // portsLock_; the reader and its buffers belong to the audio callback.
    std::unique_ptr<SystemAudio> system_;
    SystemAudioReader systemReader_;
    std::vector<float> systemL_, systemR_;
    double systemReaderIn_ = 0.0, systemReaderOut_ = 0.0;
    std::atomic<int> blockSize_{512};
    bool systemEnabled_ = false, systemExclude_ = true, forceSystem_ = false;
    juce::String systemSource_, systemError_;
    std::vector<std::pair<std::string, std::string>> systemSources_;
    juce::int64 systemSourcesAt_ = 0;
    int virtualPorts_ = 2;

    struct HostTimer final : juce::Timer {
        std::function<void()> tick;
        void timerCallback() override { if (tick) tick(); }
    } hostTimer_;

    std::atomic<double> quantum_{4.0};
    std::atomic<double> sampleRate_{48000.0};
    std::atomic<int64_t> latencyMicros_{0};

    bool smoke_ = false;
    juce::File project_;
    uint64_t savedGeneration_ = 0;
    juce::String lastTitle_;
};

}  // namespace bleep::app
