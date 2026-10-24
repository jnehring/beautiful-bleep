// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// AppController.cpp — lifetime and the ports.
#include "AppControllerInternal.h"

namespace bleep::app {

// ---- lifetime --------------------------------------------------------------------------

AppController::AppController() {
    engine::media::migrateLegacyFolders();  // before the settings file is opened
    juce::PropertiesFile::Options o;
    o.applicationName = "Bleep App";
    o.folderName = "Beautiful Bleep";
    o.filenameSuffix = ".settings";
    o.osxLibrarySubFolder = "Application Support";
    settings_ = std::make_unique<juce::PropertiesFile>(o);
    virtualPorts_ = juce::jlimit(0, 8, settings_->getIntValue("virtualMidiPorts", 2));

    iengine_ = engine::acquireEngine();
    engine_ = dynamic_cast<engine::Engine*>(iengine_);  // the app is the first Bleep binary in its process
    jassert(engine_ != nullptr);
    engine_->setStandalone(true);
    engine_->setStatusProvider([this] {
        juce::String s = bridge_ && bridge_->driving() ? "Driven by Live (" + juce::String(bridge_->connected()) + " bridges)"
                                                        : (devices_.getCurrentAudioDevice() ? devices_.getCurrentAudioDevice()->getName()
                                                                                            : juce::String("No audio device"));
        if (clock_.enabled()) s << u8(" · Link ") << juce::String(clock_.tempo(), 1) << " BPM, " << clock_.peers() << " peers";
        else s << u8(" · ") << juce::String(clock_.tempo(), 1) << " BPM";
        s << (clock_.playing() ? u8(" · playing") : u8(" · stopped"));
        return s;
    });
    main_ = engine_->registerInstance(PortKind::Patch);
    engine_->restoreInstanceId(main_, "app-board");

    commands_.registerAllCommandsForTarget(this);
    commands_.setFirstCommandTarget(this);
    setApplicationCommandManagerToWatch(&commands_);
#if JUCE_MAC
    juce::MenuBarModel::setMacMainMenu(this);
#endif
    scratch_.assign(engine::kMaxHostBlock, 0.0f);
    systemL_.assign(engine::kMaxHostBlock, 0.0f);
    systemR_.assign(engine::kMaxHostBlock, 0.0f);
    handles_.reserve(128);
    ios_.reserve(128);
}

AppController::~AppController() {
    stopTimer();
    hostTimer_.stopTimer();
    engine::hostControl().hosted = false;
    devices_.removeAudioCallback(this);
    devices_.removeMidiInputDeviceCallback({}, this);
    devices_.closeAudioDevice();
    system_.reset();
    bridge_.reset();
    hub_.reset();
    {
        const juce::SpinLock::ScopedLockType lock(portsLock_);
        const juce::SpinLock::ScopedLockType midiLock(midiLock_);
        for (auto& p : audioPorts_) removeInstance(p->handle);
        for (auto& m : midiPorts_) {
            removeInstance(m->inHandle);
            removeInstance(m->outHandle);
        }
        for (auto& d : devicePorts_) removeInstance(d->inHandle);
        audioPorts_.clear();
        midiPorts_.clear();
        devicePorts_.clear();
        removeInstance(linkHandle_);
    }
#if JUCE_MAC
    juce::MenuBarModel::setMacMainMenu(nullptr);
#endif
    engine_->setStatusProvider({});
    engine_->unregisterInstance(main_);
    iengine_->release();
}

void AppController::start(const juce::String& commandLine) {
    auto saved = smoke_ ? nullptr : settings_->getXmlValue("audioDevice");
    const auto error = devices_.initialise(smoke_ ? 0 : 2, 2, saved.get(), true);
    if (error.isNotEmpty()) DBG("audio device: " << error);
    devices_.addChangeListener(this);
    devices_.addAudioCallback(this);
    devices_.addMidiInputDeviceCallback({}, this);
    systemEnabled_ = forceSystem_ || (!smoke_ && settings_->getBoolValue("systemAudio", false));
    systemExclude_ = settings_->getBoolValue("systemAudioExclude", true);
    systemSource_ = settings_->getValue("systemAudioSource");
    clock_.enable(!smoke_ && settings_->getBoolValue("link", true));
    clock_.setTempo(settings_->getDoubleValue("tempo", 120.0));

    // The web link (doc/specs/bridges.md): off until the user turns it on in Settings.
    webEnabled_ = !smoke_ && settings_->getBoolValue("webEnabled", false);
    webPort_ = juce::jlimit(1024, 65535, settings_->getIntValue("webPort", 47100));
    // BLEEP_WEB_PORT=<port> turns the link on for this run, whatever the saved settings say (tests, demos; not saved).
    if (const char* env = std::getenv("BLEEP_WEB_PORT"); env != nullptr && *env != 0) {
        forceWeb_ = true;
        webEnabled_ = true;
        webPort_ = juce::jlimit(1024, 65535, std::atoi(env));
    }
    for (const auto& line : juce::StringArray::fromLines(settings_->getValue("webOrigins")))
        if (line.isNotEmpty()) allowedOrigins_.insert(line.toStdString());
    hub::WebHub::Callbacks hubCallbacks;
    hubCallbacks.askPairing = [this](const std::string& origin) { return askPairing(origin); };
    hubCallbacks.allowedOrigins = [this] {
        const juce::CriticalSection::ScopedLockType lock(originsLock_);
        return allowedOrigins_;
    };
    hubCallbacks.rememberOrigin = [this](const std::string& origin) {
        {
            const juce::CriticalSection::ScopedLockType lock(originsLock_);
            allowedOrigins_.insert(origin);
        }
        juce::MessageManager::callAsync([this] { saveSettings(); });
    };
    hubCallbacks.request = [this](double tempo, int play) {
        // The leader decides (§5): a request only counts while the app's own clock is the leader.
        juce::MessageManager::callAsync([this, tempo, play] {
            if (bridge_ && bridge_->driving()) return;
            if (tempo >= 20.0 && tempo <= 400.0) clock_.setTempo(tempo);
            if (play >= 0) clock_.setPlaying(play == 1);
        });
    };
    hubCallbacks.leader = [this] { return std::string(clock_.enabled() ? "link" : "app"); };
    hub_ = std::make_unique<hub::WebHub>(*engine_, hubCallbacks);

    // Bleep Audio Bridge: Live's blocks drive MIDI and Link too while bridges are connected.
    bridge_ = std::make_unique<bridge::BridgeServer>(
        *engine_,
        [this](const engine::Transport& t, int n, std::vector<int>& handles, std::vector<engine::BlockIO*>& ios) {
            buildControlPorts(t, n, handles, ios);
        },
        [this](std::vector<int>& handles, std::vector<engine::BlockIO*>& ios) {
            if (hub_) hub_->after(handles, ios);
            sendMidi();
        });
    bridge_->setRelay(hub_.get());
    applyWeb();

    applySystemAudio();  // syncPorts() inside
    newProject();

    engine::BoardWindowStyle style;
    style.alwaysOnTop = false;
    style.title = u8("Untitled — Bleep App");
    style.onClose = [] { juce::JUCEApplication::getInstance()->systemRequestedQuit(); };
    style.onLoadPatch = [this](const juce::var& board, double tempo, const juce::String& name) {
        loadPatch(board, tempo, name);
    };
    style.menu = this;
    style.onSettings = [this](const juce::String& fn, const juce::var& arg) { return settingsCall(fn, arg); };
    style.onMenu = [this](const juce::var& menus) { setMenuModel(menus); };
    engine::setBoardWindowStyle(style);  // before openBoard creates the window
    engine_->openBoard(main_);
    if (auto* w = engine::boardWindow()) w->addKeyListener(commands_.getKeyMappings());

    const auto file = juce::File::getCurrentWorkingDirectory().getChildFile(commandLine.unquoted().trim());
    if (commandLine.isNotEmpty() && file.existsAsFile()) openProject(file);
    startTimerHz(10);
    engine::hostControl().hosted = true;
    hostTimer_.tick = [this] { applyHostControl(); };
    hostTimer_.startTimerHz(100);
}

void AppController::openFromCommandLine(const juce::String& commandLine) {
    const juce::File f(commandLine.unquoted().trim());
    if (f.existsAsFile()) confirmDiscard([this, f] { openProject(f); });
}

// ---- ports -------------------------------------------------------------------------------

int AppController::addInstance(PortKind kind, const juce::String& id, const juce::String& name) {
    const int h = engine_->registerInstance(kind);
    if (h == 0) return 0;
    engine_->restoreInstanceId(h, id.toRawUTF8());  // stable IDs: the project keeps its cables
    engine_->setTrack(h, name.toRawUTF8(), 0);
    if (auto* d = devices_.getCurrentAudioDevice())
        engine_->prepare(h, d->getCurrentSampleRate(), d->getCurrentBufferSizeSamples());
    return h;
}

void AppController::removeInstance(int& handle) {
    if (handle != 0) engine_->unregisterInstance(handle);
    handle = 0;
}

/// Makes the port nodes match the audio device, the MIDI settings and Link (spec §11.1, §11.2).
void AppController::syncPorts() {
    std::vector<std::unique_ptr<AudioPort>> audio;
    auto* device = devices_.getCurrentAudioDevice();
    const int ins = device ? device->getActiveInputChannels().countNumberOfSetBits() : 0;
    const int outs = device ? device->getActiveOutputChannels().countNumberOfSetBits() : 0;
    for (int dir = 0; dir < 2; ++dir) {
        const bool input = dir == 0;
        const int channels = input ? ins : outs;
        for (int ch = 0; ch < channels; ch += 2) {
            auto p = std::make_unique<AudioPort>();
            p->input = input;
            p->channel = ch;
            p->id = juce::String(input ? "device-in-" : "device-out-") + juce::String(ch + 1);
            for (auto& old : audioPorts_)
                if (old && old->id == p->id) std::swap(p->handle, old->handle);
            const juce::String name = (input ? "In " : "Out ") + juce::String(ch + 1) +
                                      (ch + 1 < channels ? "/" + juce::String(ch + 2) : juce::String());
            if (p->handle == 0) p->handle = addInstance(input ? PortKind::AudioIn : PortKind::AudioOut, p->id, name);
            audio.push_back(std::move(p));
        }
    }

    if (system_) {  // what the computer plays: one more pair of inputs
        auto p = std::make_unique<AudioPort>();
        p->input = true;
        p->system = true;
        p->id = "system-in";
        for (auto& old : audioPorts_)
            if (old && old->id == p->id) std::swap(p->handle, old->handle);
        if (p->handle == 0) p->handle = addInstance(PortKind::AudioIn, p->id, "System");
        audio.push_back(std::move(p));
    }

    // MIDI: the app's own ports, enabled hardware inputs, the default hardware output.
    struct Want {
        juce::String id, name, identifier;
        bool isVirtual, in, out;
    };
    std::vector<Want> wants;
    for (int k = 1; k <= virtualPorts_; ++k)
        wants.push_back({"vmidi-" + juce::String(k), kVirtualPrefix + juce::String(k), {}, true, true, true});
    for (const auto& d : juce::MidiInput::getAvailableDevices())
        if (!d.name.startsWith(kVirtualPrefix) && devices_.isMidiInputDeviceEnabled(d.identifier))
            wants.push_back({"midi-in:" + d.name, d.name, d.identifier, false, true, false});
    if (auto* out = devices_.getDefaultMidiOutput(); out && !out->getName().startsWith(kVirtualPrefix))
        wants.push_back({"midi-out:" + out->getName(), out->getName(), {}, false, false, true});

    std::vector<std::unique_ptr<MidiPort>> midi;
    std::vector<const decltype(wants)::value_type*> midiWants;
    for (const auto& w : wants) {
        // A port that already exists stays where it is until the swap below: moving it out of midiPorts_ here would leave
        // an empty entry for the audio thread, which iterates that list.
        bool exists = false;
        for (const auto& old : midiPorts_) exists = exists || (old && old->id == w.id);
        std::unique_ptr<MidiPort> p;
        if (!exists) {
            p = std::make_unique<MidiPort>();
            p->id = w.id;
            p->name = w.name;
            p->identifier = w.identifier;
            p->inBlock.reserve(engine::kMaxMidiEvents);
            p->outBlock.resize(engine::kMaxMidiEvents);
            if (w.isVirtual) {
                p->input = juce::MidiInput::createNewDevice(w.name, this);
                p->output = juce::MidiOutput::createNewDevice(w.name);
                if (p->input) p->input->start();
                if (!p->input && !p->output) continue;  // no virtual ports on this system (Windows without MIDI Services)
            }
            if (w.in) p->inHandle = addInstance(PortKind::MidiIn, w.id + ":in", w.name);
            if (w.out) p->outHandle = addInstance(PortKind::MidiOut, w.id + ":out", w.name);
        }
        midi.push_back(std::move(p));  // null: the existing port, taken over below
        midiWants.push_back(&w);
    }

    if (linkHandle_ == 0) linkHandle_ = addInstance(PortKind::Link, "link", "Link");

    juce::MidiOutput* sharedOutput = devices_.getDefaultMidiOutput();
    std::vector<std::unique_ptr<AudioPort>> oldAudio;
    std::vector<std::unique_ptr<MidiPort>> oldMidi;
    {
        const juce::SpinLock::ScopedLockType lock(portsLock_);
        const juce::SpinLock::ScopedLockType midiLock(midiLock_);
        for (size_t i = 0; i < midi.size(); ++i) {  // the ports that stay, now that nothing else iterates the list
            if (!midi[i])
                for (auto& old : midiPorts_)
                    if (old && old->id == midiWants[i]->id) midi[i] = std::move(old);
            if (midi[i]) midi[i]->sharedOutput = midiWants[i]->out && !midiWants[i]->isVirtual ? sharedOutput : nullptr;
        }
        oldAudio = std::move(audioPorts_);
        oldMidi = std::move(midiPorts_);
        audioPorts_ = std::move(audio);
        midiPorts_ = std::move(midi);
    }
    // Ports that went away become ghosts on the board.
    for (auto& p : oldAudio)
        if (p) removeInstance(p->handle);
    for (auto& m : oldMidi)
        if (m) {
            removeInstance(m->inHandle);
            removeInstance(m->outHandle);
        }
    engine_->reconcileNow();
}

void AppController::setVirtualPorts(int n) {
    virtualPorts_ = juce::jlimit(0, 8, n);
    saveSettings();
    syncPorts();
}

void AppController::setLinkEnabled(bool on) {
    clock_.enable(on);
    saveSettings();
}

}  // namespace bleep::app
