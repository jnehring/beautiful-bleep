// SPDX-License-Identifier: MIT
#include "AppController.h"
#include "../common/SafeJson.h"

#include <future>

#include "BoardWindow.h"
#include "Media.h"

namespace bleep::app {

using engine::PortKind;

namespace {

/// Non-ASCII text (·, —, …) must reach juce::String as UTF-8.
inline juce::String u8(const char* text) { return juce::String::fromUTF8(text); }


enum Command { cmdNew = 1, cmdOpen, cmdPresets, cmdSave, cmdSaveAs, cmdSettings, cmdDocs, cmdAbout, cmdPlay, cmdLink };

constexpr const char* kProjectSuffix = ".bleepboard";
constexpr const char* kVirtualPrefix = "Bleep App ";

juce::String projectName(const juce::File& f) { return f == juce::File() ? juce::String("Untitled") : f.getFileNameWithoutExtension(); }

}  // namespace

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

// ---- System Audio ----------------------------------------------------------------------------------

void AppController::applySystemAudio() {
    std::unique_ptr<SystemAudio> next;
    systemError_ = {};
    if (systemEnabled_) {
        next = SystemAudio::create();
        if (!next) {
            systemError_ = SystemAudio::unsupportedReason();
            if (systemError_.isEmpty()) systemError_ = "System audio capture is not available.";
        } else {
            SystemAudioOptions options;
            options.excludeOwnProcess = systemExclude_;
            options.source = systemSource_.toStdString();
            const auto error = next->start(options);
            if (!error.empty()) {
                systemError_ = juce::String::fromUTF8(error.c_str());
                next.reset();
            }
        }
    }
    std::unique_ptr<SystemAudio> old;
    {
        const juce::SpinLock::ScopedLockType lock(portsLock_);
        old = std::move(system_);
        system_ = std::move(next);
    }
    old.reset();  // joins the capture thread: not under the lock
    syncPorts();
}

juce::var AppController::systemAudioState() {
    auto* o = new juce::DynamicObject();
    const auto reason = SystemAudio::unsupportedReason();
    o->setProperty("supported", reason.empty());
    o->setProperty("reason", juce::String::fromUTF8(reason.c_str()));
    o->setProperty("canExclude", SystemAudio::canExclude());
    o->setProperty("enabled", systemEnabled_);
    o->setProperty("exclude", systemExclude_);
    o->setProperty("source", systemSource_);

    // The list of outputs asks the sound server: not at every refresh of the Settings page.
    const auto now = juce::Time::getMillisecondCounter();
    if (reason.empty() && (systemSourcesAt_ == 0 || now - systemSourcesAt_ > 15000)) {
        systemSources_ = SystemAudio::sources();
        systemSourcesAt_ = (juce::int64)now;
    }
    juce::Array<juce::var> sources;
    for (const auto& [id, name] : systemSources_) {
        auto* e = new juce::DynamicObject();
        e->setProperty("id", juce::String::fromUTF8(id.c_str()));
        e->setProperty("name", juce::String::fromUTF8(name.c_str()));
        sources.add(juce::var(e));
    }
    o->setProperty("sources", sources);

    o->setProperty("running", system_ != nullptr);
    if (system_) {
        const float peak = system_->ring().takePeak();  // since Settings last looked
        o->setProperty("rate", system_->sampleRate());
        o->setProperty("excluding", system_->excluding());
        o->setProperty("signal", peak > 1.0e-4f);
        const auto problem = system_->problem();
        o->setProperty("problem", juce::String::fromUTF8(problem.c_str()));
    }
    o->setProperty("error", systemError_);
#if JUCE_MAC
    o->setProperty("hint", u8("Silent? macOS asks once for permission. Allow Bleep App under System Settings → Privacy & Security → Screen & System Audio Recording (System Audio Recording Only)."));
#endif
    return juce::var(o);
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
      << "\nsystem audio: "
      << (system_ ? juce::String("capturing at ") + juce::String(system_->sampleRate(), 0) + " Hz" +
                        (system_->excluding() ? ", own sound left out" : ", own sound included") + ", frames " +
                        juce::String((juce::int64)system_->ring().head()) + ", peak " + juce::String(system_->ring().takePeak(), 4) +
                        ", underruns " + juce::String(systemReader_.underruns()) + ", overruns " + juce::String(systemReader_.overruns())
                  : (systemError_.isNotEmpty() ? systemError_ : juce::String(systemEnabled_ ? "off" : "off (not enabled)")))
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
    if (!forceSystem_) settings_->setValue("systemAudio", systemEnabled_);  // --system-audio is for this run only
    settings_->setValue("systemAudioExclude", systemExclude_);
    settings_->setValue("systemAudioSource", systemSource_);
    settings_->setValue("link", clock_.enabled());
    settings_->setValue("tempo", clock_.tempo());
    if (!forceWeb_) {
        settings_->setValue("webEnabled", webEnabled_);
        settings_->setValue("webPort", webPort_);
    }
    {
        const juce::CriticalSection::ScopedLockType lock(originsLock_);
        juce::StringArray lines;
        for (const auto& o : allowedOrigins_) lines.add(juce::String(o));
        settings_->setValue("webOrigins", lines.joinIntoString("\n"));
    }
    settings_->saveIfNeeded();
}

// ---- audio ----------------------------------------------------------------------------------

void AppController::audioDeviceAboutToStart(juce::AudioIODevice* device) {
    sampleRate_ = device->getCurrentSampleRate();
    latencyMicros_ = (int64_t)(1.0e6 * device->getOutputLatencyInSamples() / std::max(1.0, sampleRate_.load()));
    const int block = device->getCurrentBufferSizeSamples();
    blockSize_ = block;
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
    if (hub_ && hub_->running()) hub_->collect(t, n, handles, ios);  // Bleep Play pages' nodes
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
        if (p->system) {
            if (!system_) continue;
            // The capture has its own clock and sample rate: read it at the device's.
            const double in = system_->sampleRate();
            if (std::fabs(in - systemReaderIn_) > 0.5 || std::fabs(sampleRate_ - systemReaderOut_) > 0.5) {
                systemReaderIn_ = in;
                systemReaderOut_ = sampleRate_;
                systemReader_.prepare(in, sampleRate_, blockSize_);
            }
            systemReader_.process(system_->ring(), systemL_.data(), systemR_.data(), numSamples);
            p->in[0] = systemL_.data();
            p->in[1] = systemR_.data();
            p->io.audioIn = p->in;
            p->io.numAudioIn = 2;
        } else if (p->input) {
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
    if (hub_ && hub_->running()) hub_->after(handles_, ios_);
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

void AppController::applyHostControl() {
    auto& hc = engine::hostControl();
    hc.linkAvailable = LinkClock::available();
    hc.linkEnabled = clock_.enabled();
    hc.linkPeers = clock_.peers();
    const int link = hc.takeLink(), sync = hc.takeStartStopSync(), play = hc.takePlay();
    const double tempo = hc.takeTempo();
    // While Live drives the app through Bleep Audio Bridge, Live is the leader (as for web requests): the requests are dropped.
    if (bridge_ && bridge_->driving()) return;
    // Link on or off from a board is not remembered as the app's own setting (File → Settings keeps that).
    if (link >= 0) clock_.enable(link == 1);
    if (sync >= 0) clock_.setStartStopSync(sync == 1);
    if (tempo >= 20.0 && tempo <= 400.0) clock_.setTempo(tempo);
    if (play == engine::HostControl::Stop) clock_.setPlaying(false);
    else if (play == engine::HostControl::Start) clock_.setPlaying(true, true);
    else if (play == engine::HostControl::Continue) clock_.setPlaying(true, false);
    if (play >= 0) commands_.commandStatusChanged();  // the Transport menu's Play / Stop
}

void AppController::timerCallback() {
    if (bridge_) bridge_->poll();
    if (hub_ && hub_->running()) hub_->poll();
    if (system_) system_->poll();
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
    const juce::String title = projectName(project_) + (dirty() ? u8(" •") : "") + u8(" — Bleep App");
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
    const auto doc = bleep::safejson::parse(file.loadFileAsString(), bleep::safejson::kProjectMaxDepth);
    if (!doc["board"].isObject()) {
        juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::WarningIcon, "Can't open project",
                                               file.getFullPathName() + " is not a Bleep App project.");
        return false;
    }
    const auto json = engine::board::toJson(doc["board"]).toStdString();
    engine_->loadBoard(main_, json.data(), json.size());
    engine_->reconcileNow();
    project_ = file;
    savedGeneration_ = engine_->boardGeneration();
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
        if (!clock_.playing()) clock_.setPlaying(true);  // demo boards play with the transport
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
    o->setProperty("app", "Bleep App");
    o->setProperty("tempo", clock_.tempo());
    o->setProperty("board", bleep::safejson::parse(juce::String::fromUTF8(json.data(), (int)json.size())));
    if (!file.replaceWithText(juce::JSON::toString(juce::var(o)))) {
        juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::WarningIcon, "Can't save project",
                                               "Could not write " + file.getFullPathName());
        return false;
    }
    project_ = file;
    savedGeneration_ = engine_->boardGeneration();
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
    chooser_ = std::make_unique<juce::FileChooser>("Save Bleep App project", start, "*" + juce::String(kProjectSuffix));
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

juce::StringArray AppController::getMenuBarNames() { return {"File", "Help"}; }

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
        m.addCommandItem(&commands_, cmdDocs);
        m.addSeparator();
        m.addCommandItem(&commands_, cmdAbout);
    }
    return m;
}

void AppController::getAllCommands(juce::Array<juce::CommandID>& c) {
    c.addArray({cmdNew, cmdOpen, cmdPresets, cmdSave, cmdSaveAs, cmdSettings, cmdDocs, cmdAbout, cmdPlay, cmdLink});
}

void AppController::getCommandInfo(juce::CommandID id, juce::ApplicationCommandInfo& info) {
    const auto cmd = juce::ModifierKeys::commandModifier;
    switch (id) {
        case cmdNew: info.setInfo("New", "New project", "File", 0); info.addDefaultKeypress('n', cmd); break;
        case cmdOpen: info.setInfo(u8("Open…"), "Open a project", "File", 0); info.addDefaultKeypress('o', cmd); break;
        case cmdPresets:
            info.setInfo(u8("Presets…"), "Browse the demo boards and your own boards", "File", 0);
            info.addDefaultKeypress('p', cmd);
            break;
        case cmdSave: info.setInfo("Save", "Save the project", "File", 0); info.addDefaultKeypress('s', cmd); break;
        case cmdSaveAs:
            info.setInfo(u8("Save As…"), "Save the project as", "File", 0);
            info.addDefaultKeypress('s', cmd | juce::ModifierKeys::shiftModifier);
            break;
        case cmdSettings: info.setInfo(u8("Settings…"), "Audio, MIDI, Link, the Library and Security", "File", 0); info.addDefaultKeypress(',', cmd); break;
        case cmdDocs: info.setInfo("Documentation", "Open the getting-started guide in your browser", "Help", 0); break;
        case cmdAbout: info.setInfo("Info", "About Bleep", "Help", 0); break;
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
                    "Open Bleep App project", juce::File::getSpecialLocation(juce::File::userDocumentsDirectory),
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
        case cmdDocs: engine::openBoardMenu("docs"); return true;
        case cmdAbout: engine::openBoardMenu("about"); return true;
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

void AppController::showSettings() { engine::openSettings(); }

// ---- the Settings section of the board window ------------------------------------------------

namespace {
juce::var namesOf(const juce::StringArray& names) {
    juce::Array<juce::var> a;
    for (const auto& n : names) a.add(n);
    return a;
}
juce::var numbersOf(const juce::Array<double>& v) {
    juce::Array<juce::var> a;
    for (auto n : v) a.add(n);
    return a;
}
juce::var numbersOf(const juce::Array<int>& v) {
    juce::Array<juce::var> a;
    for (auto n : v) a.add(n);
    return a;
}
juce::var channelsOf(const juce::StringArray& names, const juce::BigInteger& on) {
    juce::Array<juce::var> a;
    for (int i = 0; i < names.size(); ++i) {
        auto* c = new juce::DynamicObject();
        c->setProperty("name", names[i]);
        c->setProperty("on", on[i]);
        a.add(juce::var(c));
    }
    return a;
}
juce::BigInteger bitsOf(const juce::var& flags, int count) {
    juce::BigInteger b;
    if (auto* a = flags.getArray())
        for (int i = 0; i < a->size() && i < count; ++i) b.setBit(i, (bool)(*a)[i]);
    return b;
}
}  // namespace

juce::var AppController::settingsState() {
    auto* o = new juce::DynamicObject();

    auto* audio = new juce::DynamicObject();
    juce::StringArray types;
    for (auto* t : devices_.getAvailableDeviceTypes()) types.add(t->getTypeName());
    audio->setProperty("types", namesOf(types));
    audio->setProperty("type", devices_.getCurrentAudioDeviceType());
    if (auto* type = devices_.getCurrentDeviceTypeObject()) {
        audio->setProperty("outputs", namesOf(type->getDeviceNames(false)));
        audio->setProperty("inputs", namesOf(type->getDeviceNames(true)));
    }
    const auto setup = devices_.getAudioDeviceSetup();
    audio->setProperty("output", setup.outputDeviceName);
    audio->setProperty("input", setup.inputDeviceName);
    if (auto* d = devices_.getCurrentAudioDevice()) {
        const double rate = d->getCurrentSampleRate();
        audio->setProperty("running", true);
        audio->setProperty("rate", rate);
        audio->setProperty("rates", numbersOf(d->getAvailableSampleRates()));
        audio->setProperty("buffer", d->getCurrentBufferSizeSamples());
        audio->setProperty("buffers", numbersOf(d->getAvailableBufferSizes()));
        audio->setProperty("latencyMs", 1000.0 * (d->getOutputLatencyInSamples() + d->getInputLatencyInSamples()) / std::max(1.0, rate));
        audio->setProperty("xruns", d->getXRunCount());
        audio->setProperty("outputChannels", channelsOf(d->getOutputChannelNames(), d->getActiveOutputChannels()));
        audio->setProperty("inputChannels", channelsOf(d->getInputChannelNames(), d->getActiveInputChannels()));
    } else {
        audio->setProperty("running", false);
    }
    audio->setProperty("cpu", devices_.getCpuUsage());
    o->setProperty("audio", juce::var(audio));

    auto* midi = new juce::DynamicObject();
    juce::Array<juce::var> ins, outs;
    for (const auto& d : juce::MidiInput::getAvailableDevices()) {
        if (d.name.startsWith(kVirtualPrefix)) continue;
        auto* e = new juce::DynamicObject();
        e->setProperty("id", d.identifier);
        e->setProperty("name", d.name);
        e->setProperty("on", devices_.isMidiInputDeviceEnabled(d.identifier));
        ins.add(juce::var(e));
    }
    for (const auto& d : juce::MidiOutput::getAvailableDevices()) {
        if (d.name.startsWith(kVirtualPrefix)) continue;
        auto* e = new juce::DynamicObject();
        e->setProperty("id", d.identifier);
        e->setProperty("name", d.name);
        outs.add(juce::var(e));
    }
    midi->setProperty("inputs", ins);
    midi->setProperty("outputs", outs);
    midi->setProperty("output", devices_.getDefaultMidiOutputIdentifier());
    midi->setProperty("virtualPorts", virtualPorts_);
    o->setProperty("midi", juce::var(midi));

    auto* link = new juce::DynamicObject();
    link->setProperty("available", LinkClock::available());
    link->setProperty("enabled", clock_.enabled());
    link->setProperty("peers", clock_.peers());
    link->setProperty("tempo", clock_.tempo());
    link->setProperty("playing", clock_.playing());
    o->setProperty("link", juce::var(link));
    o->setProperty("system", systemAudioState());
    o->setProperty("web", webState());
    return juce::var(o);
}

// ---- the web link (Settings → Web connection) ---------------------------------------------------------------

juce::var AppController::webState() {
    auto* o = new juce::DynamicObject();
    o->setProperty("enabled", webEnabled_);
    o->setProperty("running", hub_ && hub_->running());
    o->setProperty("port", webPort_);
    o->setProperty("error", webError_);
    juce::Array<juce::var> origins;
    {
        const juce::CriticalSection::ScopedLockType lock(originsLock_);
        for (const auto& s : allowedOrigins_) origins.add(juce::String(s));
    }
    o->setProperty("origins", origins);
    o->setProperty("page", hub_ && hub_->running() ? "http://127.0.0.1:" + juce::String(hub_->port()) + "/" : juce::String());
    if (hub_) o->setProperty("link", hub_->status());
    return juce::var(o);
}

void AppController::applyWeb() {
    if (!hub_) return;
    webError_ = {};
    if (hub_->running() && (!webEnabled_ || hub_->port() != webPort_)) hub_->stop();
    if (webEnabled_ && !hub_->running()) {
        // Where the board page lives: a folder the user set, or the one next to the app (scripts/build/build-web.sh).
        std::string root;
        if (const char* env = std::getenv("BLEEP_WEB_ROOT"); env && *env) root = env;
        else {
            const auto bundled = juce::File::getSpecialLocation(juce::File::currentApplicationFile).getChildFile("Contents/Resources/web");
            if (bundled.isDirectory()) root = bundled.getFullPathName().toStdString();
        }
        if (!hub_->start(webPort_, root)) {
            webError_ = "Port " + juce::String(webPort_) + " is taken. Pick another one.";
            webEnabled_ = false;
        }
    }
}

/// An origin the app doesn't know asks to connect (§4). Called on a handshake thread: it waits for the answer.
bool AppController::askPairing(const std::string& origin) {
    auto answer = std::make_shared<std::promise<bool>>();
    auto future = answer->get_future();
    juce::MessageManager::callAsync([origin, answer] {
        juce::AlertWindow::showAsync(
            juce::MessageBoxOptions()
                .withIconType(juce::MessageBoxIconType::QuestionIcon)
                .withTitle("Connect Bleep Play?")
                .withMessage(juce::String(origin) + " wants to connect to Bleep App on this computer. It will be able to send and "
                             "receive audio and MIDI and see your tempo. Allow only pages you opened yourself.")
                .withButton("Deny")      // first: the default (Return); result 1
                .withButton("Allow")     // second: result 2, the only one that allows
                .withButton("Not now"),  // last: result 0, what Escape and a closed window give; counts as a denial
            [answer](int result) { answer->set_value(result == 2); });
    });
    // The handshake waits up to 30 s (bridges.md §10.2); a dialog nobody answers is a denial.
    return future.wait_for(std::chrono::seconds(30)) == std::future_status::ready && future.get();
}

/// What the page's Settings section asks for. Returns the new state, plus `error` when the audio device refused.
juce::var AppController::settingsCall(const juce::String& fn, const juce::var& arg) {
    juce::String error;
    if (fn == "audio") {
        if (arg["type"].isString() && arg["type"].toString() != devices_.getCurrentAudioDeviceType())
            devices_.setCurrentAudioDeviceType(arg["type"].toString(), true);
        auto setup = devices_.getAudioDeviceSetup();
        if (arg["output"].isString() && arg["output"].toString() != setup.outputDeviceName) {
            setup.outputDeviceName = arg["output"].toString();
            setup.useDefaultOutputChannels = true;
        }
        if (arg["input"].isString() && arg["input"].toString() != setup.inputDeviceName) {
            setup.inputDeviceName = arg["input"].toString();
            setup.useDefaultInputChannels = true;
        }
        if (!arg["rate"].isVoid()) setup.sampleRate = (double)arg["rate"];
        if (!arg["buffer"].isVoid()) setup.bufferSize = (int)arg["buffer"];
        if (arg["outputChannels"].isArray()) {
            setup.outputChannels = bitsOf(arg["outputChannels"], 64);
            setup.useDefaultOutputChannels = false;
        }
        if (arg["inputChannels"].isArray()) {
            setup.inputChannels = bitsOf(arg["inputChannels"], 64);
            setup.useDefaultInputChannels = false;
        }
        error = devices_.setAudioDeviceSetup(setup, true);
        if (error.isEmpty() && !arg["buffer"].isVoid())
            if (auto* d = devices_.getCurrentAudioDevice(); d && d->getCurrentBufferSizeSamples() != (int)arg["buffer"])
                error = "The device runs at " + juce::String(d->getCurrentBufferSizeSamples()) + " samples, not " +
                        juce::String((int)arg["buffer"]) + ": it does not offer that buffer size with this input and output.";
    } else if (fn == "systemAudio") {
        if (!arg["on"].isVoid()) systemEnabled_ = (bool)arg["on"];
        if (!arg["exclude"].isVoid()) systemExclude_ = (bool)arg["exclude"];
        if (arg["source"].isString()) systemSource_ = arg["source"].toString();
        if (arg["refresh"]) systemSourcesAt_ = 0;
        saveSettings();
        applySystemAudio();
        error = systemError_;
    } else if (fn == "midiInput") {
        devices_.setMidiInputDeviceEnabled(arg["id"].toString(), (bool)arg["on"]);
    } else if (fn == "midiOutput") {
        devices_.setDefaultMidiOutputDevice(arg["id"].toString());
        syncPorts();
        saveSettings();
    } else if (fn == "virtualPorts") {
        setVirtualPorts((int)arg["n"]);
    } else if (fn == "link") {
        setLinkEnabled((bool)arg["on"]);
        commands_.commandStatusChanged();
    } else if (fn == "tempo") {
        clock_.setTempo(juce::jlimit(20.0, 400.0, (double)arg["bpm"]));
        saveSettings();
    } else if (fn == "play") {
        clock_.setPlaying((bool)arg["on"], true);
        commands_.commandStatusChanged();
    } else if (fn == "web") {
        if (!arg["on"].isVoid()) webEnabled_ = (bool)arg["on"];
        if (!arg["port"].isVoid()) webPort_ = juce::jlimit(1024, 65535, (int)arg["port"]);
        applyWeb();
        saveSettings();
        error = webError_;
    } else if (fn == "webForget") {
        {
            const juce::CriticalSection::ScopedLockType lock(originsLock_);
            allowedOrigins_.erase(arg["origin"].toString().toStdString());
        }
        saveSettings();
    }
    auto state = settingsState();
    if (error.isNotEmpty()) state.getDynamicObject()->setProperty("error", error);
    return state;
}

}  // namespace bleep::app
