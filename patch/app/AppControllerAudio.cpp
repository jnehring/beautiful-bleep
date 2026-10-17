// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// AppControllerAudio.cpp — System Audio, the audio callback, MIDI and the timer.
#include "AppControllerInternal.h"

namespace bleep::app {

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

}  // namespace bleep::app
