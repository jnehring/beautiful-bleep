// SPDX-License-Identifier: MIT
#include "ModuleProcessor.h"

#include "ModuleEditor.h"

#include <mutex>

namespace bleep::patch {

namespace {

/// One bus mapping per process, shared by all module instances.
std::shared_ptr<bleep::Bus> sharedBus() {
    static std::mutex mutex;
    static std::weak_ptr<bleep::Bus> weak;
    std::lock_guard<std::mutex> lock(mutex);
    if (auto bus = weak.lock()) return bus;
    auto bus = std::make_shared<bleep::Bus>();
    if (bus->ok()) weak = bus;
    return bus;
}

juce::String uidToHex(uint64_t uid) { return juce::String::toHexString((juce::int64)uid).paddedLeft('0', 16); }

uint64_t hexToUid(const juce::String& s) { return (uint64_t)s.getHexValue64(); }

}  // namespace

ModuleProcessor::ModuleProcessor(const BusesProperties& buses, Description description,
                                 juce::AudioProcessorValueTreeState::ParameterLayout layout)
    : juce::AudioProcessor(buses),
      description_(std::move(description)),
      apvts_(*this, nullptr, "PARAMS", std::move(layout)),
      bus_(sharedBus()),
      instanceName_(description_.product) {
    if (bus_->ok()) {
        endpoint_ = std::make_unique<bleep::Endpoint>(*bus_, instanceName_.toRawUTF8(),
                                                      description_.product.toRawUTF8(),
                                                      description_.vendor.toRawUTF8());
        if (!endpoint_->ok()) endpoint_.reset();
    }
    if (endpoint_) seenPatchVersion_ = endpoint_->patchVersion();
    startTimerHz(4);
}

ModuleProcessor::~ModuleProcessor() {
    stopTimer();
    endpoint_.reset(); // unregister before the bus mapping can go away
}

int ModuleProcessor::addModulation(const juce::String& parameterId) {
    auto m = std::make_unique<Modulation>();
    m->param = apvts_.getParameter(parameterId);
    jassert(m->param != nullptr);
    m->buffer.assign(BB_MAX_BLOCK_SAMPLES, m->param->getValue());
    m->scratch.assign(BB_MAX_BLOCK_SAMPLES, 0.0f);
    m->display = m->param->getValue();
    if (auto* ep = endpoint()) m->input = ep->addInput(m->param->getName(BB_PORT_NAME_BYTES - 1).toRawUTF8());
    mods_.push_back(std::move(m));
    return (int)mods_.size() - 1;
}

int ModuleProcessor::addSignalInput(const juce::String& name, bb_signal_type type) {
    auto in = std::make_unique<SignalInput>();
    in->name = name;
    in->type = type;
    in->buffer.assign(BB_MAX_BLOCK_SAMPLES, 0.0f);
    if (auto* ep = endpoint()) in->input = ep->addInput(name.toRawUTF8(), type);
    inputs_.push_back(std::move(in));
    return (int)inputs_.size() - 1;
}

int ModuleProcessor::addOutput(const juce::String& name, bb_signal_type type, bb_polarity polarity) {
    auto out = std::make_unique<Output>();
    out->name = name;
    out->type = type;
    out->polarity = polarity;
    out->buffer.assign(BB_MAX_BLOCK_SAMPLES, 0.0f);
    if (auto* ep = endpoint()) out->output = ep->addOutput(name.toRawUTF8(), type, polarity);
    outputs_.push_back(std::move(out));
    return (int)outputs_.size() - 1;
}

bool ModuleProcessor::isModulated(const juce::String& parameterId) const {
    for (const auto& m : mods_)
        if (auto* p = dynamic_cast<juce::AudioProcessorParameterWithID*>(m->param); p && p->paramID == parameterId)
            return true;
    return false;
}

juce::String ModuleProcessor::busStatus() const {
    if (!bus_ || !bus_->ok())
        return juce::String("Bleep Bus offline: ") + bb_error_string(bus_ ? bus_->error() : BB_ERR_SHARED_MEMORY);
    if (!endpoint_) return "Bleep Bus: could not register (bus full?)";
    return "Bleep Bus " + juce::String(BB_SPEC_VERSION_MAJOR) + "." + juce::String(BB_SPEC_VERSION_MINOR) + " · " +
           uidToHex(uid());
}

void ModuleProcessor::setInstanceName(const juce::String& name, bool notifyHost) {
    instanceName_ = name.isEmpty() ? description_.product : name.substring(0, BB_NAME_BYTES - 1);
    if (auto* ep = endpoint()) ep->setName(instanceName_.toStdString());
    if (notifyHost) updateHostDisplay(ChangeDetails().withNonParameterStateChanged(true));
}

bool ModuleProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    const auto out = layouts.getMainOutputChannelSet();
    if (out != juce::AudioChannelSet::mono() && out != juce::AudioChannelSet::stereo()) return false;
    if (layouts.inputBuses.isEmpty()) return true;
    return layouts.getMainInputChannelSet() == out;
}

void ModuleProcessor::prepareToPlay(double sampleRate, int) {
    for (auto& m : mods_) std::fill(m->buffer.begin(), m->buffer.end(), m->param->getValue());
    prepareModule(sampleRate);
    resetModule();
}

void ModuleProcessor::processBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi) {
    juce::ScopedNoDenormals noDenormals;
    for (int ch = getTotalNumInputChannels(); ch < getTotalNumOutputChannels(); ++ch)
        audio.clear(ch, 0, audio.getNumSamples());

    const int numSamples = audio.getNumSamples();
    const double sampleRate = getSampleRate() > 0.0 ? getSampleRate() : 48000.0;
    const auto transport = juce_helpers::readTransport(getPlayHead(), fallbackSamplePos_);
    fallbackSamplePos_ += numSamples;
    const bool started = transport.playing && !wasPlaying_;
    wasPlaying_ = transport.playing;
    if (started) resetModule();

    auto* ep = endpoint();
    const double ppqPerSample = transport.bpm / 60.0 / sampleRate;

    juce_helpers::forEachBusBlock(transport, sampleRate, numSamples, [&](const bb_block_info& info, int offset) {
        const auto n = (uint32_t)info.num_samples;
        if (ep) ep->beginBlock(info);

        for (auto& m : mods_) {
            const float base = m->param->getValue();
            const uint32_t present = m->input.valid() ? m->input.read(m->scratch.data(), n) : 0;
            float* dst = m->buffer.data();
            if (present == 0) {
                std::fill(dst, dst + n, base);
            } else {
                const float* mod = m->scratch.data();
                for (uint32_t i = 0; i < n; ++i) dst[i] = juce::jlimit(0.0f, 1.0f, base + mod[i]);
            }
            m->active = present > 0;
            m->display = dst[n - 1];
        }
        for (auto& in : inputs_) {
            uint32_t present = 0;
            if (in->input.valid())
                present = in->input.read(in->buffer.data(), n);
            else
                std::fill(in->buffer.begin(), in->buffer.begin() + n, 0.0f);
            in->patched = present > 0;
        }

        RenderBlock block;
        block.start = offset;
        block.numSamples = (int)n;
        block.sampleRate = sampleRate;
        block.bpm = transport.bpm;
        block.playing = transport.playing;
        block.transportStarted = started && offset == 0;
        block.ppqValid = transport.hasPpq;
        block.ppqStart = transport.ppq + ppqPerSample * offset;
        block.ppqPerSample = ppqPerSample;
        renderModule(block, audio, midi);

        for (auto& out : outputs_) {
            if (out->output.valid()) out->output.write(out->buffer.data(), n);
            out->display = out->buffer[n - 1];
        }
        if (ep) ep->endBlock();
    });
}

juce::AudioProcessorEditor* ModuleProcessor::createEditor() { return new ModuleEditor(*this); }

void ModuleProcessor::getStateInformation(juce::MemoryBlock& dest) {
    juce::ValueTree root("BleepModule");
    root.setProperty("format", 1, nullptr);
    root.setProperty("product", description_.product, nullptr);
    root.setProperty("uid", uidToHex(uid()), nullptr);
    root.setProperty("name", instanceName_, nullptr);
    if (auto* ep = endpoint()) root.setProperty("connections", juce::String(ep->saveConnections()), nullptr);
    root.appendChild(apvts_.copyState(), nullptr);
    if (auto xml = root.createXml()) copyXmlToBinary(*xml, dest);
}

void ModuleProcessor::setStateInformation(const void* data, int sizeInBytes) {
    auto xml = getXmlFromBinary(data, sizeInBytes);
    if (!xml || !xml->hasTagName("BleepModule")) return;
    auto root = juce::ValueTree::fromXml(*xml);
    if (auto params = root.getChildWithName(apvts_.state.getType()); params.isValid())
        apvts_.replaceState(params);
    setInstanceName(root.getProperty("name").toString(), false);
    if (auto* ep = endpoint()) {
        // A duplicated device arrives with a UID that is already live: keep
        // the fresh one, but still take over the saved cables.
        if (const uint64_t saved = hexToUid(root.getProperty("uid").toString()); saved != 0) ep->setUid(saved);
        ep->loadConnections(root.getProperty("connections").toString().toStdString());
        seenPatchVersion_ = ep->patchVersion();
    }
}

void ModuleProcessor::updateTrackProperties(const TrackProperties& properties) {
    const juce::ScopedLock lock(trackNameLock_);
    pendingTrackName_ = properties.name.value_or(juce::String());
    trackNameDirty_ = true;
}

void ModuleProcessor::timerCallback() {
    auto* ep = endpoint();
    if (!ep) return;
    juce::String trackName;
    bool apply = false;
    {
        const juce::ScopedLock lock(trackNameLock_);
        std::swap(apply, trackNameDirty_);
        trackName = pendingTrackName_;
    }
    if (apply) ep->setTrackName(trackName.toStdString());

    // A patchbay in another window changed our cables: the set is dirty.
    if (const uint32_t v = ep->patchVersion(); v != seenPatchVersion_) {
        seenPatchVersion_ = v;
        updateHostDisplay(ChangeDetails().withNonParameterStateChanged(true));
    }
}

}  // namespace bleep::patch
