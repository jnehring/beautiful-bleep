// SPDX-License-Identifier: MIT
#include "AppController.h"

#include "BoardWindow.h"

namespace bleep::app {

using engine::PortKind;

namespace {

/// Non-ASCII text (·, —, …) must reach juce::String as UTF-8.
inline juce::String u8(const char* text) { return juce::String::fromUTF8(text); }


enum Command { cmdNew = 1, cmdOpen, cmdPresets, cmdSave, cmdSaveAs, cmdSettings, cmdPlay, cmdLink };

constexpr const char* kProjectSuffix = ".bleepboard";
constexpr const char* kVirtualPrefix = "Bleep Patch ";

juce::String projectName(const juce::File& f) { return f == juce::File() ? juce::String("Untitled") : f.getFileNameWithoutExtension(); }

/// The settings window: audio device, MIDI devices, the app's MIDI ports, Link.
class SettingsComponent : public juce::Component {
public:
    explicit SettingsComponent(AppController& app)
        : app_(app), selector_(app.devices(), 0, 32, 0, 32, true, true, false, false) {
        addAndMakeVisible(selector_);
        portsLabel_.setText("Bleep Patch MIDI ports", juce::dontSendNotification);
        addAndMakeVisible(portsLabel_);
        ports_.setRange(0, 8, 1);
        ports_.setValue(app.virtualPorts(), juce::dontSendNotification);
        ports_.setSliderStyle(juce::Slider::IncDecButtons);
        ports_.setTextBoxStyle(juce::Slider::TextBoxLeft, false, 40, 22);
        ports_.onValueChange = [this] { app_.setVirtualPorts((int)ports_.getValue()); };
        addAndMakeVisible(ports_);
        link_.setButtonText(LinkClock::available() ? "Ableton Link" : "Ableton Link (not in this build)");
        link_.setEnabled(LinkClock::available());
        link_.setToggleState(app.clock().enabled(), juce::dontSendNotification);
        link_.onClick = [this] { app_.setLinkEnabled(link_.getToggleState()); };
        addAndMakeVisible(link_);
        setSize(560, 620);
    }
    void resized() override {
        auto r = getLocalBounds().reduced(12);
        auto bottom = r.removeFromBottom(64);
        selector_.setBounds(r);
        auto row = bottom.removeFromTop(28);
        portsLabel_.setBounds(row.removeFromLeft(220));
        ports_.setBounds(row.removeFromLeft(120));
        bottom.removeFromTop(6);
        link_.setBounds(bottom.removeFromTop(28).removeFromLeft(320));
    }

private:
    AppController& app_;
    juce::AudioDeviceSelectorComponent selector_;
    juce::Label portsLabel_;
    juce::Slider ports_;
    juce::ToggleButton link_;
};

}  // namespace

// ---- lifetime --------------------------------------------------------------------------

AppController::AppController() {
    juce::PropertiesFile::Options o;
    o.applicationName = "Bleep Patch";
    o.folderName = "Bleep Patch";
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
    handles_.reserve(128);
    ios_.reserve(128);
}

AppController::~AppController() {
    stopTimer();
    devices_.removeAudioCallback(this);
    devices_.removeMidiInputDeviceCallback({}, this);
    devices_.closeAudioDevice();
    bridge_.reset();
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
    if (settingsWindow_) delete settingsWindow_.getComponent();
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
    clock_.enable(!smoke_ && settings_->getBoolValue("link", true));
    clock_.setTempo(settings_->getDoubleValue("tempo", 120.0));

    // Bleep Audio Bridge: Live's blocks drive MIDI and Link too while bridges are connected.
    bridge_ = std::make_unique<bridge::BridgeServer>(
        *engine_,
        [this](const engine::Transport& t, int n, std::vector<int>& handles, std::vector<engine::BlockIO*>& ios) {
            buildControlPorts(t, n, handles, ios);
        },
        [this](std::vector<int>&, std::vector<engine::BlockIO*>&) { sendMidi(); });

    syncPorts();
    newProject();

    engine::BoardWindowStyle style;
    style.alwaysOnTop = false;
    style.title = u8("Untitled — Bleep Patch");
    style.onClose = [] { juce::JUCEApplication::getInstance()->systemRequestedQuit(); };
    style.onLoadPatch = [this](const juce::var& board, double tempo, const juce::String& name) {
        loadPatch(board, tempo, name);
    };
    style.menu = this;
    engine::setBoardWindowStyle(style);  // before openBoard creates the window
    engine_->openBoard(main_);
    if (auto* w = engine::boardWindow()) w->addKeyListener(commands_.getKeyMappings());

    const auto file = juce::File::getCurrentWorkingDirectory().getChildFile(commandLine.unquoted().trim());
    if (commandLine.isNotEmpty() && file.existsAsFile()) openProject(file);
    else if (juce::File last(settings_->getValue("lastProject")); !smoke_ && last.existsAsFile()) openProject(last);
    startTimerHz(10);
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
    for (const auto& w : wants) {
        std::unique_ptr<MidiPort> p;
        for (auto& old : midiPorts_)
            if (old && old->id == w.id) p = std::move(old);
        if (!p) {
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
        p->sharedOutput = w.out && !w.isVirtual ? devices_.getDefaultMidiOutput() : nullptr;
        midi.push_back(std::move(p));
    }

    if (linkHandle_ == 0) linkHandle_ = addInstance(PortKind::Link, "link", "Link");

    std::vector<std::unique_ptr<AudioPort>> oldAudio;
    std::vector<std::unique_ptr<MidiPort>> oldMidi;
    {
        const juce::SpinLock::ScopedLockType lock(portsLock_);
        const juce::SpinLock::ScopedLockType midiLock(midiLock_);
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

void AppController::changeListenerCallback(juce::ChangeBroadcaster*) {
    saveSettings();
    syncPorts();
}

juce::String AppController::report() const {
    juce::StringArray ownPorts;
    for (const auto& d : juce::MidiInput::getAvailableDevices())
        if (d.name.startsWith(kVirtualPrefix)) ownPorts.add(d.name);
    juce::StringArray nodes;
    if (auto* list = engine_->board()["nodes"].getArray())
        for (const auto& n : *list) nodes.add(n["type"].toString() + ":" + n["name"].toString());
    juce::String r;
    r << "audio device: " << (devices_.getCurrentAudioDevice() ? devices_.getCurrentAudioDevice()->getName() : "none")
      << "\nown MIDI ports seen by the system: " << ownPorts.joinIntoString(", ")
      << "\nbridge server: " << (bridge_ && bridge_->ok() ? "ok" : "failed")
      << "\nLink: " << (LinkClock::available() ? "built in" : "not built in")
      << "\nboard nodes: " << nodes.joinIntoString(", ")
      << "\nengine ticks: " << (juce::int64)engine_->ticks()
      << "\nboard window: " << (engine::boardWindow() && engine::boardWindow()->isVisible() ? "open" : "missing");
    return r;
}

void AppController::saveSettings() {
    if (smoke_) return;
    if (auto xml = devices_.createStateXml()) settings_->setValue("audioDevice", xml.get());
    settings_->setValue("virtualMidiPorts", virtualPorts_);
    settings_->setValue("link", clock_.enabled());
    settings_->setValue("tempo", clock_.tempo());
    settings_->saveIfNeeded();
}

// ---- audio ----------------------------------------------------------------------------------

void AppController::audioDeviceAboutToStart(juce::AudioIODevice* device) {
    sampleRate_ = device->getCurrentSampleRate();
    latencyMicros_ = (int64_t)(1.0e6 * device->getOutputLatencyInSamples() / std::max(1.0, sampleRate_.load()));
    const int block = device->getCurrentBufferSizeSamples();
    for (auto& p : audioPorts_) engine_->prepare(p->handle, sampleRate_, block);
    for (auto& m : midiPorts_) {
        if (m->inHandle) engine_->prepare(m->inHandle, sampleRate_, block);
        if (m->outHandle) engine_->prepare(m->outHandle, sampleRate_, block);
    }
    if (linkHandle_) engine_->prepare(linkHandle_, sampleRate_, block);
}

engine::Transport AppController::transportFor(int numSamples) {
    const auto t = clock_.atBlock(numSamples, sampleRate_, quantum_, latencyMicros_);
    engine::Transport tr;
    tr.sampleRate = sampleRate_;
    tr.bpm = t.bpm;
    tr.ppq = t.ppq;
    tr.ppqValid = true;
    tr.playing = t.playing;
    return tr;
}

/// MIDI and Link ports for one block. Caller holds portsLock_.
void AppController::buildControlPorts(const engine::Transport& t, int n, std::vector<int>& handles,
                                      std::vector<engine::BlockIO*>& ios) {
    for (auto* list : {&midiPorts_, &devicePorts_})
    for (auto& m : *list) {
        if (m->inHandle) {
            m->inBlock.clear();
            // Messages that arrived during the last block's time are spread over this
            // block by arrival time: steady one-block delay, real timing between notes,
            // and a quick tap (press and release) never collapses onto one sample.
            const double now = juce::Time::getMillisecondCounterHiRes() * 0.001;
            const double sr = t.sampleRate > 0.0 ? t.sampleRate : 48000.0;
            int last = 0;
            auto take = [&](int index) {
                engine::MidiEvent e = m->fifoData[(size_t)index];
                const double ago = now - m->fifoTime[(size_t)index];
                int offset = juce::jlimit(0, n - 1, (int)std::lround((double)n - ago * sr));
                offset = juce::jmax(offset, last);  // keep the order
                last = offset;
                e.offset = offset;
                m->inBlock.push_back(e);
            };
            const auto scope = m->fifo.read(m->fifo.getNumReady());
            for (int i = 0; i < scope.blockSize1; ++i) take(scope.startIndex1 + i);
            for (int i = 0; i < scope.blockSize2; ++i) take(scope.startIndex2 + i);
            m->inIo = {};
            m->inIo.numSamples = n;
            m->inIo.transport = t;
            m->inIo.midiIn = m->inBlock.data();
            m->inIo.numMidiIn = (int)m->inBlock.size();
            handles.push_back(m->inHandle);
            ios.push_back(&m->inIo);
        }
        if (m->outHandle) {
            m->outIo = {};
            m->outIo.numSamples = n;
            m->outIo.transport = t;
            m->outIo.midiOut = m->outBlock.data();
            m->outIo.midiOutCapacity = (int)m->outBlock.size();
            handles.push_back(m->outHandle);
            ios.push_back(&m->outIo);
        }
    }
    if (linkHandle_) {
        linkIo_ = {};
        linkIo_.numSamples = n;
        linkIo_.transport = t;
        handles.push_back(linkHandle_);
        ios.push_back(&linkIo_);
    }
}

void AppController::sendMidi() {
    for (auto& m : midiPorts_) {
        juce::MidiOutput* out = m->output ? m->output.get() : m->sharedOutput;
        if (!out) continue;
        for (int i = 0; i < m->outIo.numMidiOut; ++i) {
            const auto& e = m->outBlock[(size_t)i];
            out->sendMessageNow(juce::MidiMessage(e.bytes, e.size));
        }
    }
}

void AppController::audioDeviceIOCallbackWithContext(const float* const* inputs, int numInputs, float* const* outputs,
                                                     int numOutputs, int numSamples,
                                                     const juce::AudioIODeviceCallbackContext&) {
    for (int ch = 0; ch < numOutputs; ++ch)
        if (outputs[ch]) juce::FloatVectorOperations::clear(outputs[ch], numSamples);
    // While Live drives the app through Bleep Audio Bridge, the device stays silent (spec §11.3).
    if (bridge_ && bridge_->driving()) return;
    const juce::SpinLock::ScopedTryLockType lock(portsLock_);
    if (!lock.isLocked() || numSamples > engine::kMaxHostBlock) return;

    const auto t = transportFor(numSamples);
    handles_.clear();
    ios_.clear();
    for (auto& p : audioPorts_) {
        p->io = {};
        p->io.numSamples = numSamples;
        p->io.transport = t;
        if (p->input) {
            if (p->channel >= numInputs) continue;
            p->in[0] = inputs[p->channel];
            p->in[1] = p->channel + 1 < numInputs ? inputs[p->channel + 1] : inputs[p->channel];
            p->io.audioIn = p->in;
            p->io.numAudioIn = 2;
        } else {
            if (p->channel >= numOutputs) continue;
            p->out[0] = outputs[p->channel];
            p->out[1] = p->channel + 1 < numOutputs ? outputs[p->channel + 1] : scratch_.data();
            p->io.audioOut = p->out;
            p->io.numAudioOut = 2;
        }
        handles_.push_back(p->handle);
        ios_.push_back(&p->io);
    }
    buildControlPorts(t, numSamples, handles_, ios_);
    if (handles_.empty()) return;
    engine_->processAll(handles_.data(), ios_.data(), (int)handles_.size());
    sendMidi();
}

void AppController::handleIncomingMidiMessage(juce::MidiInput* source, const juce::MidiMessage& message) {
    if (message.getRawDataSize() > 3 || message.isSysEx()) return;
    const double arrived = juce::Time::getMillisecondCounterHiRes() * 0.001;
    // Waits only for the message thread swapping ports, never for audio: no message is dropped.
    const juce::SpinLock::ScopedLockType lock(midiLock_);
    for (auto* list : {&midiPorts_, &devicePorts_})
    for (auto& m : *list) {
        const bool mine = m->input ? source == m->input.get() : (source && source->getIdentifier() == m->identifier);
        if (!mine || m->inHandle == 0) continue;
        const auto scope = m->fifo.write(1);
        engine::MidiEvent e;
        e.offset = 0;
        e.size = (uint8_t)message.getRawDataSize();
        std::memcpy(e.bytes, message.getRawData(), e.size);
        if (scope.blockSize1 > 0) {
            m->fifoData[(size_t)scope.startIndex1] = e;
            m->fifoTime[(size_t)scope.startIndex1] = arrived;
        }
        return;
    }
}

// ---- the timer: Link settings from the board, title, bridge heartbeat --------------------------

/// MIDI Device nodes (spec §12): the node names a controller; the app opens it
/// and feeds the node. Nodes come and go with the board (add, delete, undo).
void AppController::syncDeviceNodes() {
    std::vector<std::pair<juce::String, juce::String>> wanted;  // port id, device name
    if (auto* nodes = engine_->board()["nodes"].getArray())
        for (const auto& n : *nodes)
            if (n["type"].toString() == "midi-device" && n["port"].toString().isNotEmpty())
                wanted.push_back({n["port"].toString(), n["device"].toString()});
    bool same = wanted.size() == devicePorts_.size();
    for (size_t i = 0; same && i < wanted.size(); ++i)
        same = devicePorts_[i]->id == wanted[i].first && devicePorts_[i]->name == wanted[i].second;
    if (same) return;

    std::vector<std::unique_ptr<MidiPort>> next;
    for (const auto& [port, device] : wanted) {
        std::unique_ptr<MidiPort> p;
        for (auto& old : devicePorts_)
            if (old && old->id == port && old->name == device) p = std::move(old);
        if (!p) {
            p = std::make_unique<MidiPort>();
            p->id = port;
            p->name = device;
            p->inBlock.reserve(engine::kMaxMidiEvents);
            p->outBlock.resize(engine::kMaxMidiEvents);
            for (const auto& d : juce::MidiInput::getAvailableDevices())
                if (d.name == device) {
                    p->identifier = d.identifier;
                    p->input = juce::MidiInput::openDevice(d.identifier, this);
                    if (p->input) p->input->start();
                }
            // Keep the engine instance when only the device changed.
            for (auto& old : devicePorts_)
                if (old && old->id == port) std::swap(p->inHandle, old->inHandle);
            if (p->inHandle == 0) p->inHandle = addInstance(PortKind::MidiDevice, port, device.isEmpty() ? "MIDI Device" : device);
        }
        next.push_back(std::move(p));
    }
    std::vector<std::unique_ptr<MidiPort>> gone;
    {
        const juce::SpinLock::ScopedLockType lock(portsLock_);
        const juce::SpinLock::ScopedLockType midiLock(midiLock_);
        gone = std::move(devicePorts_);
        devicePorts_ = std::move(next);
    }
    for (auto& g : gone)
        if (g) removeInstance(g->inHandle);  // the node was deleted
}

void AppController::timerCallback() {
    if (bridge_) bridge_->poll();
    syncDeviceNodes();
    // The Link node's settings (spec §11.4).
    const auto& board = engine_->board();
    if (auto* nodes = board["nodes"].getArray())
        for (const auto& n : *nodes)
            if (n["port"].toString() == "link")
                if (const auto* spec = engine::Registry::get().find("link")) {
                    const auto& params = n["params"];
                    quantum_ = spec->params[0].fromNormalised((float)params.getProperty("quantum", 0.2f));
                    clock_.setStartStopSync(spec->params[1].fromNormalised((float)params.getProperty("startstop", 1.0f)) >= 0.5f);
                }
    updateTitle();
}

// ---- projects ---------------------------------------------------------------------------------

bool AppController::dirty() const { return engine_->boardGeneration() != savedGeneration_; }

void AppController::updateTitle() {
    const juce::String title = projectName(project_) + (dirty() ? u8(" •") : "") + u8(" — Bleep Patch");
    if (title == lastTitle_) return;
    lastTitle_ = title;
    engine::setBoardWindowTitle(title);
}

void AppController::newProject() {
    const auto json = engine::board::toJson(engine::board::create()).toStdString();
    engine_->loadBoard(main_, json.data(), json.size());
    engine_->reconcileNow();
    project_ = juce::File();
    savedGeneration_ = engine_->boardGeneration();
    updateTitle();
}

bool AppController::openProject(const juce::File& file) {
    const auto doc = juce::JSON::parse(file.loadFileAsString());
    if (!doc["board"].isObject()) {
        juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::WarningIcon, "Can't open project",
                                               file.getFullPathName() + " is not a Bleep Patch project.");
        return false;
    }
    const auto json = engine::board::toJson(doc["board"]).toStdString();
    engine_->loadBoard(main_, json.data(), json.size());
    engine_->reconcileNow();
    project_ = file;
    savedGeneration_ = engine_->boardGeneration();
    settings_->setValue("lastProject", file.getFullPathName());
    if (doc["tempo"].isDouble() || doc["tempo"].isInt()) clock_.setTempo((double)doc["tempo"]);
    updateTitle();
    return true;
}

void AppController::loadPatch(const juce::var& board, double tempo, const juce::String& name) {
    if (!board["nodes"].isArray()) return;
    confirmDiscard([this, board, tempo, name] {
        const auto json = engine::board::toJson(board).toStdString();
        engine_->loadBoard(main_, json.data(), json.size());
        engine_->reconcileNow();
        project_ = juce::File();  // a patch is a starting point: Save asks for a new file
        savedGeneration_ = engine_->boardGeneration();
        if (tempo >= 20.0 && tempo <= 400.0) clock_.setTempo(tempo);
        if (!clock_.playing()) clock_.setPlaying(true);  // demo patches play with the transport
        commands_.commandStatusChanged();
        updateTitle();
        juce::ignoreUnused(name);
    });
}

bool AppController::saveProject(const juce::File& file) {
    const size_t len = engine_->saveBoard(main_, nullptr, 0);
    std::string json(len, '\0');
    engine_->saveBoard(main_, json.data(), len);
    auto* o = new juce::DynamicObject();
    o->setProperty("format", 1);
    o->setProperty("app", "Bleep Patch");
    o->setProperty("tempo", clock_.tempo());
    o->setProperty("board", juce::JSON::parse(juce::String::fromUTF8(json.data(), (int)json.size())));
    if (!file.replaceWithText(juce::JSON::toString(juce::var(o)))) {
        juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::WarningIcon, "Can't save project",
                                               "Could not write " + file.getFullPathName());
        return false;
    }
    project_ = file;
    savedGeneration_ = engine_->boardGeneration();
    settings_->setValue("lastProject", file.getFullPathName());
    updateTitle();
    return true;
}

void AppController::save(std::function<void()> then) {
    if (project_ == juce::File()) return saveAs(std::move(then));
    if (saveProject(project_) && then) then();
}

void AppController::saveAs(std::function<void()> then) {
    const auto start = project_ != juce::File() ? project_
                                               : juce::File::getSpecialLocation(juce::File::userDocumentsDirectory)
                                                     .getChildFile("Untitled" + juce::String(kProjectSuffix));
    chooser_ = std::make_unique<juce::FileChooser>("Save Bleep Patch project", start, "*" + juce::String(kProjectSuffix));
    chooser_->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting,
                          [this, then](const juce::FileChooser& c) {
                              auto f = c.getResult();
                              if (f == juce::File()) return;
                              if (!f.hasFileExtension(kProjectSuffix)) f = f.withFileExtension(kProjectSuffix);
                              if (saveProject(f) && then) then();
                          });
}

void AppController::confirmDiscard(std::function<void()> then) {
    if (!dirty()) return then();
    juce::AlertWindow::showYesNoCancelBox(
        juce::MessageBoxIconType::QuestionIcon, "Save changes to " + projectName(project_) + "?",
        "Your changes are lost if you don't save them.", "Save", "Don't Save", "Cancel", nullptr,
        juce::ModalCallbackFunction::create([this, then](int result) {
            if (result == 1) save(then);
            else if (result == 2) then();
        }));
}

// ---- menus ------------------------------------------------------------------------------------

juce::StringArray AppController::getMenuBarNames() { return {"File", "Transport"}; }

juce::PopupMenu AppController::getMenuForIndex(int index, const juce::String&) {
    juce::PopupMenu m;
    if (index == 0) {
        m.addCommandItem(&commands_, cmdNew);
        m.addCommandItem(&commands_, cmdOpen);
        m.addCommandItem(&commands_, cmdPresets);
        m.addSeparator();
        m.addCommandItem(&commands_, cmdSave);
        m.addCommandItem(&commands_, cmdSaveAs);
        m.addSeparator();
        m.addCommandItem(&commands_, cmdSettings);
    } else {
        m.addCommandItem(&commands_, cmdPlay);
        m.addCommandItem(&commands_, cmdLink);
    }
    return m;
}

void AppController::getAllCommands(juce::Array<juce::CommandID>& c) {
    c.addArray({cmdNew, cmdOpen, cmdPresets, cmdSave, cmdSaveAs, cmdSettings, cmdPlay, cmdLink});
}

void AppController::getCommandInfo(juce::CommandID id, juce::ApplicationCommandInfo& info) {
    const auto cmd = juce::ModifierKeys::commandModifier;
    switch (id) {
        case cmdNew: info.setInfo("New", "New project", "File", 0); info.addDefaultKeypress('n', cmd); break;
        case cmdOpen: info.setInfo(u8("Open…"), "Open a project", "File", 0); info.addDefaultKeypress('o', cmd); break;
        case cmdPresets:
            info.setInfo(u8("Presets…"), "Browse the demo patches and your own patches", "File", 0);
            info.addDefaultKeypress('p', cmd);
            break;
        case cmdSave: info.setInfo("Save", "Save the project", "File", 0); info.addDefaultKeypress('s', cmd); break;
        case cmdSaveAs:
            info.setInfo(u8("Save As…"), "Save the project as", "File", 0);
            info.addDefaultKeypress('s', cmd | juce::ModifierKeys::shiftModifier);
            break;
        case cmdSettings: info.setInfo(u8("Settings…"), "Audio, MIDI and Link", "File", 0); info.addDefaultKeypress(',', cmd); break;
        case cmdPlay:
            info.setInfo(clock_.playing() ? "Stop" : "Play", "Start or stop the transport", "Transport", 0);
            info.addDefaultKeypress(juce::KeyPress::returnKey, cmd);
            break;
        case cmdLink:
            info.setInfo("Ableton Link", "Sync tempo, beat and start/stop with Link", "Transport", 0);
            info.setTicked(clock_.enabled());
            info.setActive(LinkClock::available());
            break;
        default: break;
    }
}

bool AppController::perform(const InvocationInfo& info) {
    switch (info.commandID) {
        case cmdNew: confirmDiscard([this] { newProject(); }); return true;
        case cmdOpen:
            confirmDiscard([this] {
                chooser_ = std::make_unique<juce::FileChooser>(
                    "Open Bleep Patch project", juce::File::getSpecialLocation(juce::File::userDocumentsDirectory),
                    "*" + juce::String(kProjectSuffix));
                chooser_->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
                                      [this](const juce::FileChooser& c) {
                                          if (c.getResult().existsAsFile()) openProject(c.getResult());
                                      });
            });
            return true;
        case cmdPresets: engine::openPresetBrowser(); return true;
        case cmdSave: save(); return true;
        case cmdSaveAs: saveAs(); return true;
        case cmdSettings: showSettings(); return true;
        case cmdPlay:
            clock_.setPlaying(!clock_.playing());
            commands_.commandStatusChanged();
            return true;
        case cmdLink:
            setLinkEnabled(!clock_.enabled());
            commands_.commandStatusChanged();
            return true;
        default: return false;
    }
}

void AppController::showSettings() {
    if (settingsWindow_) {
        settingsWindow_->toFront(true);
        return;
    }
    juce::DialogWindow::LaunchOptions o;
    o.content.setOwned(new SettingsComponent(*this));
    o.dialogTitle = "Settings";
    o.dialogBackgroundColour = juce::Colour(0xff1d2027);
    o.escapeKeyTriggersCloseButton = true;
    o.useNativeTitleBar = true;
    o.resizable = true;
    settingsWindow_ = o.launchAsync();
}

}  // namespace bleep::app
