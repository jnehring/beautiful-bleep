// SPDX-License-Identifier: MIT
#include "PortProcessor.h"

#include "PortEditor.h"

namespace bleep::patch {

using engine::PortKind;

namespace {

const char* productName(PortKind k) {
    switch (k) {
        case PortKind::Patch: return "Bleep Patch";
        case PortKind::MidiIn: return "Bleep MIDI In";
        case PortKind::MidiOut: return "Bleep MIDI Out";
        case PortKind::AudioIn: return "Bleep Audio In";
        case PortKind::AudioOut: return "Bleep Audio Out";
        case PortKind::Instrument: return "Bleep Instrument";
        case PortKind::AudioInsert: return "Bleep Audio Insert";
        case PortKind::AudioBridge:  // Bleep Audio Bridge and Link nodes belong to the standalone app
        case PortKind::Link:
        case PortKind::None: break;
    }
    return "Bleep";
}

bool hasAudioInput(PortKind k) { return k == PortKind::Patch || k == PortKind::AudioIn || k == PortKind::AudioInsert; }

constexpr int kMaxDelay = 2 * engine::kMaxHostBlock;

}  // namespace

PortProcessor::BusesProperties PortProcessor::busesFor(PortKind k) {
    BusesProperties b;
    if (hasAudioInput(k)) b = b.withInput("Input", juce::AudioChannelSet::stereo(), true);
    return b.withOutput("Output", juce::AudioChannelSet::stereo(), true);
}

PortProcessor::PortProcessor(PortKind kind)
    : juce::AudioProcessor(busesFor(kind)), kind_(kind), instance_(kind) {
    if (kind_ == PortKind::Patch) {
        for (int k = 0; k < engine::kNumMacros; ++k) {
            const auto id = "macro" + juce::String(k + 1);
            macros_[(size_t)k] = new juce::AudioParameterFloat(juce::ParameterID(id, 1), "Macro " + juce::String(k + 1),
                                                               0.0f, 1.0f, 0.0f);
            addParameter(macros_[(size_t)k]);
        }
    }
    if (kind_ == PortKind::AudioInsert) {
        mix_ = new juce::AudioParameterFloat(juce::ParameterID("mix", 1), "Dry/Wet", 0.0f, 1.0f, 1.0f);
        addParameter(mix_);
    }
    midiIn_.resize(engine::kMaxMidiEvents);
    midiOut_.resize(engine::kMaxMidiEvents);
    startTimerHz(4);
}

PortProcessor::~PortProcessor() { stopTimer(); }

const juce::String PortProcessor::getName() const { return productName(kind_); }

bool PortProcessor::acceptsMidi() const {
    return kind_ == PortKind::MidiIn || kind_ == PortKind::MidiOut || kind_ == PortKind::AudioOut ||
           kind_ == PortKind::Instrument;
}

bool PortProcessor::reportsLatency() const noexcept {
    return kind_ == PortKind::AudioOut || kind_ == PortKind::Instrument || kind_ == PortKind::AudioInsert;
}

bool PortProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    const auto out = layouts.getMainOutputChannelSet();
    if (out != juce::AudioChannelSet::mono() && out != juce::AudioChannelSet::stereo()) return false;
    if (layouts.inputBuses.isEmpty()) return true;
    return layouts.getMainInputChannelSet() == out;
}

void PortProcessor::prepareToPlay(double sampleRate, int maxBlock) {
    engine().prepare(handle(), sampleRate, maxBlock);
    latency_ = reportsLatency() ? engine().latencySamples() : 0;
    setLatencySamples(latency_);
    board_.setSize(2, juce::jmax(maxBlock, 1));
    delay_.setSize(2, kMaxDelay + engine::kMaxHostBlock);
    delay_.clear();
    delayPos_ = 0;
}

void PortProcessor::processBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi) {
    juce::ScopedNoDenormals noDenormals;
    const int n = audio.getNumSamples();
    const int ins = getTotalNumInputChannels(), outs = audio.getNumChannels();
    for (int ch = ins; ch < outs; ++ch) audio.clear(ch, 0, n);

    engine::BlockIO io;
    io.numSamples = n;
    io.transport.sampleRate = getSampleRate() > 0.0 ? getSampleRate() : 48000.0;
    io.transport.samplePos = fallbackPos_;
    fallbackPos_ += n;
    if (auto* head = getPlayHead())
        if (auto pos = head->getPosition()) {
            if (auto s = pos->getTimeInSamples()) io.transport.samplePos = *s;
            if (auto b = pos->getBpm()) io.transport.bpm = *b;
            if (auto p = pos->getPpqPosition()) {
                io.transport.ppq = *p;
                io.transport.ppqValid = true;
            }
            io.transport.playing = pos->getIsPlaying() || pos->getIsRecording();
        }

    const float* inPtrs[2] = {audio.getReadPointer(0), audio.getReadPointer(juce::jmin(1, outs - 1))};
    float* outPtrs[2] = {audio.getWritePointer(0), audio.getWritePointer(juce::jmin(1, outs - 1))};
    float* boardPtrs[2] = {nullptr, nullptr};

    if (kind_ == PortKind::Patch) {
        for (int k = 0; k < engine::kNumMacros; ++k) macroValues_[k] = macros_[(size_t)k]->get();
        io.macros = macroValues_;
    }
    if (kind_ == PortKind::AudioIn || kind_ == PortKind::AudioInsert) {
        io.audioIn = inPtrs;
        io.numAudioIn = juce::jmin(2, juce::jmax(1, ins));
    }
    if (kind_ == PortKind::AudioOut || kind_ == PortKind::Instrument) {
        io.audioOut = outPtrs;
        io.numAudioOut = juce::jmin(2, outs);
    }
    if (kind_ == PortKind::AudioInsert) {
        if (board_.getNumSamples() < n) board_.setSize(2, n, false, false, true);
        boardPtrs[0] = board_.getWritePointer(0);
        boardPtrs[1] = board_.getWritePointer(1);
        io.audioOut = boardPtrs;
        io.numAudioOut = 2;
    }
    if (kind_ == PortKind::MidiIn || kind_ == PortKind::Instrument) {
        int count = 0;
        for (const auto m : midi) {
            if (count >= (int)midiIn_.size()) break;
            const auto msg = m.getMessage();
            if (msg.getRawDataSize() > 3 || msg.isSysEx()) continue;
            auto& e = midiIn_[(size_t)count++];
            e.offset = m.samplePosition;
            e.size = (uint8_t)msg.getRawDataSize();
            std::memcpy(e.bytes, msg.getRawData(), e.size);
        }
        io.midiIn = midiIn_.data();
        io.numMidiIn = count;
    }
    if (kind_ == PortKind::MidiOut) {
        io.midiOut = midiOut_.data();
        io.midiOutCapacity = (int)midiOut_.size();
    }

    engine().process(handle(), io);

    switch (kind_) {
        case PortKind::MidiIn:
            audio.clear();
            break;
        case PortKind::MidiOut:
            audio.clear();
            midi.clear();  // only the board plays
            for (int i = 0; i < io.numMidiOut; ++i) {
                const auto& e = midiOut_[(size_t)i];
                midi.addEvent(e.bytes, e.size, juce::jlimit(0, juce::jmax(0, n - 1), e.offset));
            }
            break;
        case PortKind::AudioOut:
        case PortKind::Instrument:
            midi.clear();
            if (!io.boardAudioValid) audio.clear();
            break;
        case PortKind::AudioInsert: {
            // Dry is delayed by the board latency, so dry and wet line up.
            const int length = juce::jlimit(0, kMaxDelay, latency_.load());
            const int size = delay_.getNumSamples();
            const float mix = mix_->get();
            for (int ch = 0; ch < juce::jmin(2, outs); ++ch) {
                float* d = delay_.getWritePointer(ch);
                float* o = audio.getWritePointer(ch);
                const float* wet = io.boardAudioValid ? board_.getReadPointer(ch) : nullptr;
                int w = delayPos_;
                for (int i = 0; i < n; ++i) {
                    d[w] = o[i];
                    int r = w - length;
                    if (r < 0) r += size;
                    const float dry = d[r];
                    o[i] = wet ? dry + mix * (wet[i] - dry) : dry;
                    if (++w == size) w = 0;
                }
            }
            delayPos_ = (delayPos_ + n) % size;
            break;
        }
        case PortKind::Patch:
        case PortKind::AudioIn:
        case PortKind::AudioBridge:
        case PortKind::Link:
        case PortKind::None:
            break;  // audio passes through untouched
    }
}

juce::AudioProcessorEditor* PortProcessor::createEditor() { return new PortEditor(*this); }

void PortProcessor::getStateInformation(juce::MemoryBlock& dest) {
    juce::XmlElement root("BleepPort");
    root.setAttribute("format", 1);
    root.setAttribute("kind", engine::portKindName(kind_));
    char id[64];
    engine().instanceId(handle(), id, sizeof id);
    root.setAttribute("id", id);
    for (auto* p : getParameters())
        if (auto* f = dynamic_cast<juce::AudioParameterFloat*>(p)) root.setAttribute(f->paramID, f->get());
    if (kind_ == PortKind::Patch) {
        const size_t len = engine().saveBoard(handle(), nullptr, 0);
        std::string json(len, '\0');
        engine().saveBoard(handle(), json.data(), len);
        root.createNewChildElement("Board")->addTextElement(juce::String::fromUTF8(json.data(), (int)json.size()));
    }
    copyXmlToBinary(root, dest);
}

void PortProcessor::setStateInformation(const void* data, int sizeInBytes) {
    auto xml = getXmlFromBinary(data, sizeInBytes);
    if (!xml || !xml->hasTagName("BleepPort")) return;
    engine().restoreInstanceId(handle(), xml->getStringAttribute("id").toRawUTF8());
    for (auto* p : getParameters())
        if (auto* f = dynamic_cast<juce::AudioParameterFloat*>(p); f && xml->hasAttribute(f->paramID))
            *f = (float)xml->getDoubleAttribute(f->paramID);
    if (kind_ == PortKind::Patch)
        if (auto* b = xml->getChildByName("Board")) {
            const auto json = b->getAllSubText().toStdString();
            engine().loadBoard(handle(), json.data(), json.size());
            seenGeneration_ = engine().boardGeneration();
        }
}

void PortProcessor::updateTrackProperties(const TrackProperties& properties) {
    // Called on the message thread by Live's VST3 host.
    const auto name = properties.name.value_or(juce::String());
    const auto colour = properties.colour.value_or(juce::Colours::transparentBlack);
    engine().setTrack(handle(), name.toRawUTF8(), colour.getARGB());
}

void PortProcessor::timerCallback() {
    if (reportsLatency()) {
        const int l = engine().latencySamples();
        if (l != latency_.load()) {
            latency_ = l;
            setLatencySamples(l);
        }
    }
    // Board edits change the set: Bleep Patch stores the board (spec §5.4).
    if (kind_ == PortKind::Patch && engine().state(handle()) == engine::PortState::Ok) {
        const uint64_t g = engine().boardGeneration();
        if (g != seenGeneration_) {
            seenGeneration_ = g;
            updateHostDisplay(ChangeDetails().withNonParameterStateChanged(true));
        }
    }
}

}  // namespace bleep::patch

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new bleep::patch::PortProcessor(bleep::engine::PortKind::BLEEP_PORT_KIND);
}
