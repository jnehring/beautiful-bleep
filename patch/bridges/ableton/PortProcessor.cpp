// SPDX-License-Identifier: MIT
#include "PortProcessor.h"

#include "PortEditor.h"
#include "PresetLibrary.h"

#include "Board.h"

#include <cmath>

namespace bleep::patch {

using engine::PortKind;

namespace {

const char* productName(PortKind k) {
    switch (k) {
        case PortKind::Patch: return "Bleep Board";
        case PortKind::MidiIn: return "Bleep MIDI In";
        case PortKind::MidiOut: return "Bleep MIDI Out";
        case PortKind::AudioIn: return "Bleep Audio In";
        case PortKind::AudioOut: return "Bleep Audio Out";
        case PortKind::Instrument: return "Bleep Instrument";
        case PortKind::AudioInsert: return "Bleep FX";
        case PortKind::AudioBridge:  // Bleep Audio Bridge and Link nodes belong to the standalone app
        case PortKind::Link:
        case PortKind::MidiDevice:
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
    if (loadsPresets())
        for (int k = 0; k < kSlots; ++k) {
            slots_[(size_t)k] = new SlotParameter(k);
            slotDirty_[(size_t)k] = false;
            addParameter(slots_[(size_t)k]);
            slots_[(size_t)k]->addListener(this);
        }
    if (canBridge()) {
        // Not automatable: it re-plumbs the plugin, it isn't a knob.
        boardChoice_ = new juce::AudioParameterChoice(juce::ParameterID("board", 1), "Board", juce::StringArray{"This set", "App", "Web"}, 0,
                                                juce::AudioParameterChoiceAttributes().withAutomatable(false));
        addParameter(boardChoice_);
        bridgeMidiIn_.resize(bridge::kMaxMidi);
        bridgeMidiOut_.resize(bridge::kMaxMidi);
    }
    midiIn_.resize(engine::kMaxMidiEvents);
    midiOut_.resize(engine::kMaxMidiEvents);
    startTimerHz(loadsPresets() ? 30 : 4);
}

PortProcessor::~PortProcessor() {
    stopTimer();
    for (auto* p : slots_)
        if (p) p->removeListener(this);
}

void PortProcessor::parameterValueChanged(int index, float) {
    // Any thread. Our own writes (the knob moved, a set loaded) do not come back as the host's.
    if (ignoring_) return;
    for (int k = 0; k < kSlots; ++k)
        if (slots_[(size_t)k] && slots_[(size_t)k]->getParameterIndex() == index) slotDirty_[(size_t)k] = true;
}

/// The 16 parameters follow the cell's knobs both ways (cell-plugins.md §11.4). Message thread.
void PortProcessor::pollSlots() {
    auto call = [&](const char* method, const juce::String& args) {
        const size_t len = engine().uiCall(handle(), method, args.toRawUTF8(), nullptr, 0);
        std::string out(len, '\0');
        if (len > 0) engine().uiCall(handle(), "__last", "[]", out.data(), len);
        return juce::JSON::parse(juce::String::fromUTF8(out.data(), (int)len));
    };
    // The host moved a parameter: set its knob.
    for (int k = 0; k < kSlots; ++k)
        if (slotDirty_[(size_t)k].exchange(false) && mapping_[(size_t)k].node.isNotEmpty())
            call("setParam", juce::JSON::toString(juce::var(juce::Array<juce::var>{
                                 mapping_[(size_t)k].node, mapping_[(size_t)k].param,
                                 (double)slots_[(size_t)k]->get()}), true));
    // The knobs: which ones, what they are called, and where they stand now (a knob moved on the panel).
    if (++slotTick_ < 6 && slotsGeneration_ == engine().boardGeneration()) return;
    slotTick_ = 0;
    slotsGeneration_ = engine().boardGeneration();
    const auto list = call("cellParams", "[]");
    bool titles = false;
    ignoring_ = true;
    for (int k = 0; k < kSlots; ++k) {
        const auto& e = list.isArray() && k < list.size() ? list[k] : juce::var();
        Mapped m{e["node"].toString(), e["param"].toString()};
        const juce::String name = e["name"].toString();
        if (slots_[(size_t)k]->shownName() != name) {
            slots_[(size_t)k]->setShownName(name);
            titles = true;
        }
        mapping_[(size_t)k] = m;
        if (m.node.isNotEmpty() && !slotDirty_[(size_t)k] && std::fabs(slots_[(size_t)k]->get() - (float)(double)e["value"]) > 1e-4f)
            slots_[(size_t)k]->setValueNotifyingHost((float)(double)e["value"]);
    }
    ignoring_ = false;
    if (titles) updateHostDisplay(ChangeDetails().withParameterInfoChanged(true));
}

const juce::String PortProcessor::getName() const { return productName(kind_); }

bool PortProcessor::acceptsMidi() const {
    return kind_ == PortKind::MidiIn || kind_ == PortKind::MidiOut || kind_ == PortKind::AudioOut ||
           kind_ == PortKind::Instrument;
}

bool PortProcessor::reportsLatency() const noexcept {
    return kind_ == PortKind::AudioOut || kind_ == PortKind::Instrument || kind_ == PortKind::AudioInsert;
}

bool PortProcessor::canBridge() const noexcept {
    return kind_ == PortKind::MidiIn || kind_ == PortKind::MidiOut || kind_ == PortKind::AudioIn || kind_ == PortKind::AudioOut;
}

bridge::Board PortProcessor::board() const noexcept {
    return boardChoice_ ? (bridge::Board)boardChoice_->getIndex() : bridge::Board::ThisSet;
}

bool PortProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    const auto out = layouts.getMainOutputChannelSet();
    if (out != juce::AudioChannelSet::mono() && out != juce::AudioChannelSet::stereo()) return false;
    if (layouts.inputBuses.isEmpty()) return true;
    return layouts.getMainInputChannelSet() == out;
}

void PortProcessor::prepareToPlay(double sampleRate, int maxBlock) {
    engine().prepare(handle(), sampleRate, maxBlock);
    client_.prepare(sampleRate, maxBlock);
    bridgeRet_.setSize(2, juce::jmax(maxBlock, 1));
    latency_ = reportsLatency() ? (bridged() ? client_.latencySamples() : engine().latencySamples()) : 0;
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

    if (bridged()) {
        // The other side is the app's board or a browser's: hand the block over and play back what returns.
        bridge::BridgeClient::Block b;
        b.numSamples = n;
        b.numChannels = juce::jmax(1, juce::jmin(2, outs));
        b.transport.sampleRate = io.transport.sampleRate;
        b.transport.samplePos = io.transport.samplePos;
        b.transport.bpm = io.transport.bpm;
        b.transport.ppq = io.transport.ppq;
        b.transport.ppqValid = io.transport.ppqValid ? 1 : 0;
        b.transport.playing = io.transport.playing ? 1 : 0;
        b.offline = isNonRealtime();
        int count = 0;
        if (kind_ == PortKind::MidiIn)
            for (const auto m : midi) {
                if (count >= bridge::kMaxMidi) break;
                const auto msg = m.getMessage();
                if (msg.getRawDataSize() > 3 || msg.isSysEx()) continue;
                auto& e = bridgeMidiIn_[(size_t)count++];
                e.offset = m.samplePosition;
                e.size = (uint8_t)msg.getRawDataSize();
                std::memcpy(e.bytes, msg.getRawData(), e.size);
            }
        b.midiIn = kind_ == PortKind::MidiIn ? bridgeMidiIn_.data() : nullptr;
        b.numMidiIn = count;
        b.midiOut = kind_ == PortKind::MidiOut ? bridgeMidiOut_.data() : nullptr;
        if (kind_ == PortKind::AudioIn) b.in = inPtrs;
        float* retPtrs[2] = {nullptr, nullptr};
        if (kind_ == PortKind::AudioOut) {
            retPtrs[0] = outPtrs[0];
            retPtrs[1] = outPtrs[1];
            b.ret = retPtrs;
        }
        const bool got = client_.exchange(b);
        switch (kind_) {
            case PortKind::MidiIn: audio.clear(); break;
            case PortKind::MidiOut:
                audio.clear();
                midi.clear();
                for (int i = 0; i < std::clamp(b.numMidiOut, 0, bridge::kMaxMidi); ++i) {
                    const int sz = std::min<int>(bridgeMidiOut_[(size_t)i].size, 3);
                    if (sz < 1) continue;
                    midi.addEvent(bridgeMidiOut_[(size_t)i].bytes, sz,
                                  juce::jlimit(0, juce::jmax(0, n - 1), bridgeMidiOut_[(size_t)i].offset));
                }
                break;
            case PortKind::AudioOut:
                midi.clear();
                if (!got) audio.clear();
                break;
            default: break;  // Audio In: the track's audio passes through
        }
        return;
    }

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
        case PortKind::MidiDevice:
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
    if (boardChoice_) root.setAttribute("board", boardChoice_->getIndex());
    if (loadsPresets()) {
        // The cell as it is on the board, edits included; Bleep Board's board holds it too (the board wins on restore).
        const size_t len = engine().cellPreset(handle(), nullptr, 0);
        if (len > 0) {
            std::string json(len, '\0');
            engine().cellPreset(handle(), json.data(), len);
            root.createNewChildElement("Preset")->addTextElement(juce::String::fromUTF8(json.data(), (int)json.size()));
        }
    }
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
    ignoring_ = true;  // a saved value is not the host moving the knob
    for (auto* p : getParameters())
        if (auto* f = dynamic_cast<juce::AudioParameterFloat*>(p); f && xml->hasAttribute(f->paramID))
            *f = (float)xml->getDoubleAttribute(f->paramID);
    ignoring_ = false;
    if (boardChoice_ && xml->hasAttribute("board")) *boardChoice_ = xml->getIntAttribute("board", 0);
    stateRestored_ = true;
    if (loadsPresets())
        if (auto* p = xml->getChildByName("Preset")) {
            const auto json = p->getAllSubText().toStdString();
            engine().setCellPreset(handle(), json.data(), json.size(), false);
        }
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
    track_ = name;
    if (bridged()) client_.setIdentity(client_.identity(), name.toStdString());
    const auto colour = properties.colour.value_or(juce::Colours::transparentBlack);
    engine().setTrack(handle(), name.toRawUTF8(), colour.getARGB());
}

void PortProcessor::loadPreset(const juce::String& name) {
    if (const auto* e = PresetLibrary::find(kind_, name))
        engine().setCellPreset(handle(), e->json.toRawUTF8(), (size_t)e->json.getNumBytesAsUTF8(), true);
}

juce::String PortProcessor::presetName() const {
    const size_t len = engine().cellPreset(handle(), nullptr, 0);
    if (len == 0) return {};
    std::string json(len, '\0');
    engine().cellPreset(handle(), json.data(), len);
    return engine::board::fromJson(juce::String::fromUTF8(json.data(), (int)len))["name"].toString();
}

/// The Board menu changed (or the plugin was just loaded): tell the engine and the bridge. Message thread.
void PortProcessor::applyBoard() {
    const int b = boardChoice_ ? boardChoice_->getIndex() : 0;
    if (b == appliedBoard_) return;
    appliedBoard_ = b;
    // A bridged plugin has no node of its own on this set's board: its node turns into a ghost, cables kept.
    if (engine().supports(1)) engine().setBridged(handle(), b != 0);
    char id[64];
    engine().instanceId(handle(), id, sizeof id);
    client_.setIdentity(b != 0 ? id : "", track_.toStdString());
    client_.setPort((uint32_t)kind_, (bridge::Board)b);
    if (reportsLatency()) {
        latency_ = b != 0 ? client_.latencySamples() : engine().latencySamples();
        setLatencySamples(latency_);
    }
}

void PortProcessor::timerCallback() {
    if (boardChoice_) {
        applyBoard();
        if (bridged()) {
            client_.poll();
            if (reportsLatency() && client_.latencySamples() != latency_.load()) {
                latency_ = client_.latencySamples();  // the app's share of a web round trip changed
                setLatencySamples(latency_);
            }
        }
    }
    if (loadsPresets() && stateRestored_) pollSlots();
    // A new instance starts with a preset; a saved set (setStateInformation ran) keeps what it had, even nothing.
    if (loadsPresets() && !stateRestored_) {
        stateRestored_ = true;
        if (engine().cellPreset(handle(), nullptr, 0) == 0) loadPreset(PresetLibrary::defaultName(kind_));
    }
    if (reportsLatency() && !bridged()) {
        const int l = engine().latencySamples();
        if (l != latency_.load()) {
            latency_ = l;
            setLatencySamples(l);
        }
    }
    // Board edits change the set: Bleep Board stores the board (spec §5.4).
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
