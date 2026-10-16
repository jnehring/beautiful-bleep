// SPDX-License-Identifier: MIT
// AppControllerSettings.cpp — the Settings section of the board window and the web link.
#include "AppControllerInternal.h"

namespace bleep::app {

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
    o->setProperty("host", "app");

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
