// SPDX-License-Identifier: MIT
#include "Engine.h"

#include "Media.h"
#include "VoiceCell.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#if JUCE_WINDOWS
#include <windows.h>
#include <process.h>
#else
#include <dlfcn.h>
#include <unistd.h>
#endif

namespace bleep::engine {

namespace {

/// Non-ASCII text (·, —, …) must reach juce::String as UTF-8.
inline juce::String u8(const char* text) { return juce::String::fromUTF8(text); }


void copyOut(const juce::String& s, char* out, int capacity) {
    if (out == nullptr || capacity <= 0) return;
    const auto utf8 = s.toStdString();
    const size_t n = std::min(utf8.size(), (size_t)capacity - 1);
    std::memcpy(out, utf8.data(), n);
    out[n] = 0;
}

double nowMs() { return juce::Time::getMillisecondCounterHiRes(); }

bool sendsToTrack(PortKind k) {
    return k == PortKind::MidiOut || k == PortKind::AudioOut || k == PortKind::Instrument || k == PortKind::AudioInsert ||
           k == PortKind::AudioBridge;
}

}  // namespace

// ---- lifetime ------------------------------------------------------------------

Engine::Engine() {
    media::setFolder(juce::File::getSpecialLocation(juce::File::userMusicDirectory)
                         .getChildFile("Bleep Patch").getChildFile("Media").getFullPathName().toStdString());
    startTimerHz(10);
}

Engine::~Engine() {
    stopTimer();
    ui_.reset();
    delete program_.exchange(nullptr);
    for (auto* p : retired_) delete p;
    for (auto& t : table_) t.store(nullptr);
}

void Engine::retain() noexcept { refs_.fetch_add(1); }

PortSlot* Engine::slot(int handle) const noexcept {
    return handle > 0 && handle < kMaxInstances ? table_[handle].load(std::memory_order_acquire) : nullptr;
}

std::shared_ptr<PortSlot> Engine::slotShared(int handle) const {
    for (const auto& s : instances_)
        if (s->handle == handle) return s;
    return nullptr;
}

// ---- instances --------------------------------------------------------------------

int Engine::registerInstance(PortKind kind) noexcept {
    int handle = 0;
    for (int h = 1; h < kMaxInstances; ++h)
        if (table_[h].load() == nullptr && slotShared(h) == nullptr) {
            handle = h;
            break;
        }
    if (handle == 0) return 0;
    auto s = std::make_shared<PortSlot>();
    s->kind = kind;
    s->handle = handle;
    s->id = juce::Uuid().toDashedString().toStdString();
    s->registeredAt = nowMs();
    instances_.push_back(s);
    table_[handle].store(s.get(), std::memory_order_release);
    if (kind == PortKind::Patch && mainHandle_ == 0) {
        mainHandle_ = handle;
        setBoard(board::create(), true);
    }
    return handle;
}

void Engine::unregisterInstance(int handle) noexcept {
    if (handle <= 0 || handle >= kMaxInstances) return;
    table_[handle].store(nullptr, std::memory_order_release);
    instances_.erase(std::remove_if(instances_.begin(), instances_.end(),
                                    [&](const auto& s) { return s->handle == handle; }),
                     instances_.end());
    if (handle == mainHandle_) {
        // Deleting Bleep Patch removes the board from the set (spec §5.4).
        clearBoard();
        promoteMain();
    } else {
        recompile();  // the port's node becomes a ghost
        if (ui_) ui_->boardChanged();
    }
}

void Engine::restoreInstanceId(int handle, const char* savedId) noexcept {
    auto s = slotShared(handle);
    if (!s || savedId == nullptr || *savedId == 0) return;
    s->restored = true;
    const std::string id(savedId);
    if (id == s->id) return;
    for (const auto& other : instances_)
        if (other != s && other->id == id) return;  // a duplicated device keeps its fresh ID (spec §5.4)
    const juce::String fresh(s->id);
    s->id = id;
    // A node that appeared for the fresh ID before the state arrived goes again.
    if (hasBoard() && board::findNodeByPort(board_, juce::String(id)) != nullptr)
        if (auto* n = board::findNodeByPort(board_, fresh)) {
            const juce::String nodeId = n->getProperty("id").toString();
            bool cabled = false;
            if (auto* cables = board_["cables"].getArray())
                for (const auto& c : *cables)
                    cabled |= c["from"]["node"].toString() == nodeId || c["to"]["node"].toString() == nodeId;
            if (!cabled)
                if (auto* nodes = board_["nodes"].getArray())
                    for (int i = nodes->size(); --i >= 0;)
                        if ((*nodes)[i]["id"].toString() == nodeId) nodes->remove(i);
        }
    recompile();
    if (ui_) ui_->boardChanged();
}

void Engine::instanceId(int handle, char* out, int capacity) noexcept {
    auto s = slotShared(handle);
    copyOut(s ? juce::String(s->id) : juce::String(), out, capacity);
}

void Engine::setTrack(int handle, const char* trackName, uint32_t argb) noexcept {
    if (auto s = slotShared(handle)) {
        s->trackName = trackName ? trackName : "";
        s->trackColour = argb;
    }
}

void Engine::prepare(int handle, double sampleRate, int maxBlock) noexcept {
    // Hosts may call this off the message thread: only touch atomics here.
    PortSlot* s = slot(handle);
    if (s == nullptr) return;
    s->maxBlock = maxBlock;
    int m = maxBlock_.load();
    while (maxBlock > m && !maxBlock_.compare_exchange_weak(m, maxBlock)) {}
    if (sampleRate > 0.0) pendingRate_.store(sampleRate);
    if (juce::MessageManager::existsAndIsCurrentThread()) applySampleRate();
}

void Engine::applySampleRate() {
    const double rate = pendingRate_.exchange(0.0);
    if (rate <= 0.0 || juce::exactlyEqual(rate, sampleRate_)) return;
    sampleRate_ = rate;
    modules_.clear();  // modules are prepared for one rate: start them fresh
    recompile();
}

PortState Engine::state(int handle) noexcept {
    auto s = slotShared(handle);
    if (s && s->kind == PortKind::Patch && handle != mainHandle_) return PortState::InactiveMain;
    return hasBoard() ? PortState::Ok : PortState::NoBoard;
}

int Engine::latencySamples() noexcept {
    const int m = maxBlock_.load();
    return 2 * (m > 0 ? m : 512);
}

void Engine::statusText(int handle, char* out, int capacity) noexcept {
    auto s = slotShared(handle);
    juce::String text;
    switch (state(handle)) {
        case PortState::InactiveMain: text = "Inactive: this set already has a board."; break;
        case PortState::NoBoard: text = "No board in this set. Add Bleep Patch."; break;
        case PortState::VersionMismatch: text = "Another version of Bleep Patch is loaded."; break;
        case PortState::Ok: {
            const int l = latencySamples();
            text = "Board running";
            if (s && s->kind != PortKind::Patch && s->kind != PortKind::MidiIn && s->kind != PortKind::AudioIn)
                text << u8(" · latency ") << l << " smp (" << juce::String(1000.0 * l / sampleRate_, 1) << " ms)";
            if (s && s->resyncs.load() > 0) text << u8(" · resyncs ") << (int)s->resyncs.load();
            if (s && s->drops.load() > 0) text << u8(" · drops ") << (int)s->drops.load();
            break;
        }
    }
    copyOut(text, out, capacity);
}

void Engine::nodeName(int handle, char* out, int capacity) noexcept {
    auto s = slotShared(handle);
    juce::DynamicObject* n = s && hasBoard() ? board::findNodeByPort(board_, juce::String(s->id)) : nullptr;
    copyOut(n ? n->getProperty("name").toString() : juce::String(), out, capacity);
}

void Engine::setNodeName(int handle, const char* name) noexcept {
    auto s = slotShared(handle);
    if (!s || !hasBoard() || name == nullptr) return;
    if (auto* n = board::findNodeByPort(board_, juce::String(s->id))) {
        beginGesture();
        n->setProperty("name", juce::String::fromUTF8(name).substring(0, 63));
        boardEdited(true);
    }
}

// ---- the board -------------------------------------------------------------------

size_t Engine::saveBoard(int handle, char* out, size_t capacity) noexcept {
    auto s = slotShared(handle);
    if (!s) return 0;
    if (handle == mainHandle_) s->savedBoard = board::toJson(board_).toStdString();
    const std::string& json = s->savedBoard;
    if (out && capacity > 0) std::memcpy(out, json.data(), std::min(capacity, json.size()));
    return json.size();
}

void Engine::loadBoard(int handle, const char* json, size_t length) noexcept {
    auto s = slotShared(handle);
    if (!s || json == nullptr) return;
    s->savedBoard.assign(json, length);
    s->restored = true;
    if (handle == mainHandle_) {
        auto doc = board::fromJson(juce::String::fromUTF8(json, (int)length));
        setBoard(doc.isObject() ? doc : board::create(), true);
    }
}

void Engine::replaceBoardWith(int handle) noexcept {
    auto s = slotShared(handle);
    if (!s || handle == mainHandle_ || !hasBoard() || s->savedBoard.empty()) return;
    beginGesture();
    board_ = board::sanitise(board::fromJson(juce::String(s->savedBoard)));
    boardEdited(true);
    reconcile(true);
}

void Engine::setBoard(juce::var doc, bool resetUndo) {
    board_ = board::sanitise(doc);
    if (resetUndo) {
        undo_.clear();
        redo_.clear();
    }
    modules_.clear();
    boardEdited(true);
}

void Engine::boardEdited(bool notifyUi) {
    generation_.fetch_add(1);
    recompile();
    if (notifyUi && ui_) ui_->boardChanged();
}

void Engine::clearBoard() {
    mainHandle_ = 0;
    board_ = juce::var();
    undo_.clear();
    redo_.clear();
    modules_.clear();
    generation_.fetch_add(1);
    recompile();
    if (ui_) ui_->boardChanged();
}

void Engine::promoteMain() {
    for (const auto& s : instances_)
        if (s->kind == PortKind::Patch) {
            mainHandle_ = s->handle;
            auto doc = board::fromJson(juce::String(s->savedBoard));
            setBoard(doc.isObject() ? doc : board::create(), true);
            return;
        }
}

juce::var Engine::commit(const juce::var& edited, const juce::String& label) {
    juce::ignoreUnused(label);
    if (!hasBoard()) return board_;
    auto clean = board::sanitise(edited);
    // Ports can't be deleted from the board (spec §6): put back what went missing.
    if (auto* oldNodes = board_["nodes"].getArray()) {
        bool restored = false;
        for (const auto& n : *oldNodes) {
            const auto* spec = Registry::get().find(n["type"].toString().toStdString());
            if (spec && spec->userCreatable) continue;  // e.g. MIDI Device: the user may delete it
            if (n["port"].toString().isNotEmpty() && board::findNode(clean, n["id"].toString()) == nullptr) {
                clean["nodes"].getArray()->add(n);
                restored = true;
            }
        }
        if (restored) clean = board::sanitise(clean);
    }
    undo_.push_back(board::toJson(board_));
    if ((int)undo_.size() > kUndoLimit) undo_.erase(undo_.begin());
    redo_.clear();
    board_ = clean;
    boardEdited(false);
    return board_;
}

bool Engine::undo() {
    if (undo_.empty() || !hasBoard()) return false;
    redo_.push_back(board::toJson(board_));
    board_ = board::sanitise(board::fromJson(undo_.back()));
    undo_.pop_back();
    boardEdited(false);
    reconcile(true);  // ports added since then come back
    return true;
}

bool Engine::redo() {
    if (redo_.empty() || !hasBoard()) return false;
    undo_.push_back(board::toJson(board_));
    board_ = board::sanitise(board::fromJson(redo_.back()));
    redo_.pop_back();
    boardEdited(false);
    reconcile(true);
    return true;
}

void Engine::beginGesture() {
    if (!hasBoard()) return;
    undo_.push_back(board::toJson(board_));
    if ((int)undo_.size() > kUndoLimit) undo_.erase(undo_.begin());
    redo_.clear();
}

void Engine::setParam(const juce::String& nodeId, const juce::String& paramId, float v) {
    auto* n = hasBoard() ? board::findNode(board_, nodeId) : nullptr;
    if (n == nullptr) return;
    v = juce::jlimit(0.0f, 1.0f, v);
    if (auto* params = n->getProperty("params").getDynamicObject()) params->setProperty(paramId, v);
    if (auto m = modules_.find(nodeId.toStdString()); m != modules_.end()) {
        const int i = m->second->spec().paramIndex(paramId.toStdString());
        if (i >= 0) m->second->setKnob(i, v);
    }
    // Inside a Voice Cell: every voice (spec §8.3.2).
    if (auto in = inner_.find(nodeId.toStdString()); in != inner_.end())
        for (const auto& m : in->second.modules) {
            const int i = m->spec().paramIndex(paramId.toStdString());
            if (i >= 0) m->setKnob(i, v);
        }
    generation_.fetch_add(1);
}

void Engine::setData(const juce::String& nodeId, const juce::var& data) {
    auto* n = hasBoard() ? board::findNode(board_, nodeId) : nullptr;
    if (n == nullptr) return;
    const auto* spec = Registry::get().find(n->getProperty("type").toString().toStdString());
    if (spec == nullptr || !spec->sanitiseData) return;
    const std::string json = spec->sanitiseData(juce::JSON::toString(data, true).toStdString());
    n->setProperty("data", board::fromJson(juce::String(json)));
    if (auto m = modules_.find(nodeId.toStdString()); m != modules_.end()) m->second->setData(json);
    if (auto in = inner_.find(nodeId.toStdString()); in != inner_.end())
        for (const auto& m : in->second.modules) m->setData(json);
    generation_.fetch_add(1);
}

void Engine::command(const juce::String& nodeId, const juce::String& id, float value) {
    const std::string node = nodeId.toStdString(), cmd = id.toStdString();
    if (auto m = modules_.find(node); m != modules_.end()) m->second->command(cmd, value);
    if (auto in = inner_.find(node); in != inner_.end())
        for (const auto& m : in->second.modules) m->command(cmd, value);
}

juce::var Engine::importMedia(const juce::String& name, const juce::MemoryBlock& bytes) {
    auto* o = new juce::DynamicObject();
    std::string error;
    auto clip = media::import((const uint8_t*)bytes.getData(), bytes.getSize(), name.toStdString(), &error);
    if (!clip) {
        o->setProperty("error", juce::String(error));
        return juce::var(o);
    }
    o->setProperty("id", juce::String(clip->id));
    o->setProperty("name", name);
    o->setProperty("seconds", clip->seconds());
    o->setProperty("channels", clip->numChannels());
    return juce::var(o);
}

juce::var Engine::exportMedia(const juce::String& nodeId, const juce::String& slot) {
    auto* o = new juce::DynamicObject();
    std::shared_ptr<const MediaClip> clip;
    if (auto m = modules_.find(nodeId.toStdString()); m != modules_.end()) clip = m->second->exportMedia(slot.toStdString());
    const std::string id = clip ? media::save(*clip) : std::string();
    if (id.empty()) {
        o->setProperty("error", clip ? "could not write to the media folder" : "nothing to save");
        return juce::var(o);
    }
    o->setProperty("id", juce::String(id));
    o->setProperty("seconds", clip->seconds());
    o->setProperty("channels", clip->numChannels());
    return juce::var(o);
}

void Engine::setAmount(const juce::String& cableId, float amount) {
    auto* c = hasBoard() ? board::findCable(board_, cableId) : nullptr;
    if (c == nullptr) return;
    c->setProperty("amount", juce::jlimit(-1.0f, 1.0f, amount));
    generation_.fetch_add(1);
    recompile();
}

void Engine::recompile() {
    std::map<std::string, std::shared_ptr<PortSlot>> ports;
    for (const auto& s : instances_)
        if (s->kind != PortKind::Patch || s->handle == mainHandle_) ports[s->id] = s;
    std::unique_ptr<Program> next;
    if (hasBoard()) next = Program::compile(board::parse(board_), modules_, ports, sampleRate_);
    else modules_.clear();
    // The modules inside Voice Cells, one per voice, for knob changes and views.
    inner_.clear();
    for (const auto& [id, m] : modules_)
        if (auto cell = std::dynamic_pointer_cast<VoiceCellModule>(m)) {
            std::map<std::string, std::vector<std::shared_ptr<Module>>> found;
            cell->collect(found);
            for (auto& [nodeId, mods] : found) inner_[nodeId] = Inner{std::move(mods), cell};
        }
    if (Program* old = program_.exchange(next.release(), std::memory_order_seq_cst)) retired_.push_back(old);
}

void Engine::collectGarbage() {
    Program* busy = inFlight_.load(std::memory_order_seq_cst);
    retired_.erase(std::remove_if(retired_.begin(), retired_.end(),
                                  [&](Program* p) {
                                      if (p == busy) return false;
                                      delete p;
                                      return true;
                                  }),
                   retired_.end());
}

void Engine::reconcile(bool force) {
    if (!hasBoard()) return;
    bool changed = false;
    int inputs = 0, outputs = 0;
    for (const auto& s : instances_) {
        if (s->kind == PortKind::Patch && (s->handle != mainHandle_ || standalone_)) continue;
        if (s->kind == PortKind::MidiDevice) continue;  // its node comes first; the app follows it
        auto* existing = board::findNodeByPort(board_, juce::String(s->id));
        if (existing != nullptr) {
            // Keep the last known track on the node, so ghosts still say where they were.
            if (s->trackName.size() && existing->getProperty("track").toString() != juce::String(s->trackName)) {
                existing->setProperty("track", juce::String(s->trackName));
                existing->setProperty("colour", "#" + juce::String::toHexString((int)(s->trackColour & 0xffffff)).paddedLeft('0', 6));
                changed = true;
            }
            continue;
        }
        if (!force && !s->restored && nowMs() - s->registeredAt < 500.0) continue;  // wait for setState
        const ModuleSpec* spec = Registry::get().forPort(s->kind);
        if (spec == nullptr) continue;
        const bool toTrack = (sendsToTrack(s->kind) && s->kind != PortKind::Instrument &&
                              s->kind != PortKind::AudioInsert && s->kind != PortKind::AudioBridge) ||
                             s->kind == PortKind::MidiOut;
        const double x = toTrack ? 760.0 : 40.0;
        const double y = 40.0 + 110.0 * (toTrack ? outputs++ : inputs++);
        const auto id = board::addNode(board_, *spec, x, y, juce::String(s->id));
        if (auto* n = board::findNode(board_, id); n && s->trackName.size()) {
            n->setProperty("track", juce::String(s->trackName));
            n->setProperty("name", juce::String(s->trackName));
        }
        changed = true;
    }
    if (changed) boardEdited(true);
}

void Engine::reconcileNow() { reconcile(true); }

void Engine::timerCallback() {
    applySampleRate();
    collectGarbage();
    reconcile(false);
    pollModuleData();
}

void Engine::pollModuleData() {
    if (!hasBoard()) return;
    bool changed = false;
    for (const auto& [id, m] : modules_) {
        std::string json;
        if (!m->takeData(json)) continue;
        const ModuleSpec& spec = m->spec();
        auto* n = board::findNode(board_, juce::String(id));
        if (n == nullptr || !spec.sanitiseData) continue;
        const std::string clean = spec.sanitiseData(json);
        n->setProperty("data", board::fromJson(juce::String(clean)));
        m->setData(clean);
        changed = true;
    }
    if (changed) {
        generation_.fetch_add(1);
        if (ui_) ui_->boardChanged();
    }
}

juce::var Engine::ports() const {
    auto* o = new juce::DynamicObject();
    const int64_t now = ticks_.load();
    for (const auto& s : instances_) {
        auto* p = new juce::DynamicObject();
        p->setProperty("kind", portKindName(s->kind));
        p->setProperty("track", juce::String(s->trackName));
        p->setProperty("live", now - s->lastBlock.load() < 16 && s->lastBlock.load() >= 0);
        p->setProperty("main", s->handle == mainHandle_);
        o->setProperty(juce::Identifier(s->id), juce::var(p));
    }
    return juce::var(o);
}

juce::var Engine::liveState(const std::set<juce::String>& detailed) const {
    auto* root = new juce::DynamicObject();
    auto* nodes = new juce::DynamicObject();
    std::vector<std::pair<std::string, std::shared_ptr<Module>>> shown(modules_.begin(), modules_.end());
    for (const auto& [id, in] : inner_)  // inside Voice Cells: the voice that started last
        if (!in.modules.empty())
            shown.push_back({id, in.modules[(size_t)std::clamp(in.cell->displayVoice(), 0, (int)in.modules.size() - 1)]});
    for (const auto& [id, m] : shown) {
        auto* n = new juce::DynamicObject();
        if (auto cell = std::dynamic_pointer_cast<VoiceCellModule>(m)) n->setProperty("voices", (int)cell->activeVoices());
        auto* outs = new juce::DynamicObject();
        const auto& spec = m->spec();
        for (size_t k = 0; k < spec.outputs.size(); ++k)
            outs->setProperty(juce::Identifier(spec.outputs[k].id), m->outputDisplay((int)k).value.load());
        n->setProperty("outputs", juce::var(outs));
        if (detailed.count(juce::String(id))) {
            auto* params = new juce::DynamicObject();
            for (size_t i = 0; i < spec.params.size(); ++i) {
                auto* p = new juce::DynamicObject();
                const float eff = m->paramDisplay((int)i).value.load();
                const bool active = m->paramDisplay((int)i).active.load();
                p->setProperty("v", m->knob((int)i));
                p->setProperty("e", eff);
                p->setProperty("a", active);
                p->setProperty("t", juce::String(spec.params[i].text(spec.params[i].fromNormalised(active ? eff : m->knob((int)i)))));
                params->setProperty(juce::Identifier(spec.params[i].id), juce::var(p));
            }
            n->setProperty("params", juce::var(params));
            std::vector<std::pair<std::string, double>> extra;
            m->liveValues(extra);
            for (const auto& [key, value] : extra) n->setProperty(juce::Identifier(key), value);
            std::vector<std::pair<std::string, std::vector<float>>> arrays;
            m->liveArrays(arrays);
            if (!arrays.empty()) {
                auto* a = new juce::DynamicObject();
                for (const auto& [key, values] : arrays) {
                    juce::Array<juce::var> list;
                    list.ensureStorageAllocated((int)values.size());
                    for (float v : values) list.add(std::isfinite(v) ? v : 0.0f);
                    a->setProperty(juce::Identifier(key), list);
                }
                n->setProperty("arrays", juce::var(a));
            }
        }
        nodes->setProperty(juce::Identifier(id), juce::var(n));
    }
    root->setProperty("nodes", juce::var(nodes));
    root->setProperty("ports", ports());
    if (statusProvider_) root->setProperty("status", statusProvider_());
    return juce::var(root);
}

juce::String Engine::statusLine() const {
    juce::String s;
    if (statusProvider_) return statusProvider_();
    if (!hasBoard()) return "No board in this set. Add Bleep Patch.";
    s << "Latency " << const_cast<Engine*>(this)->latencySamples() << u8(" smp · ") << juce::String(sampleRate_ / 1000.0, 1)
      << " kHz";
    return s;
}

// ---- the board window ------------------------------------------------------------

void Engine::editorOpened(int handle) noexcept { openBoard(handle); }

void Engine::openBoard(int handle) noexcept {
    if (!ui_) ui_ = createBoardUi(*this);
    if (!ui_) return;
    juce::String focus;
    if (auto s = slotShared(handle); s && hasBoard())
        if (auto* n = board::findNodeByPort(board_, juce::String(s->id))) focus = n->getProperty("id").toString();
    ui_->show(focus);
}

// ---- audio -------------------------------------------------------------------------

namespace {

void silence(BlockIO& io) noexcept {
    for (int ch = 0; ch < io.numAudioOut; ++ch)
        if (io.audioOut[ch]) std::fill_n(io.audioOut[ch], io.numSamples, 0.0f);
}

/// Hands a plugin's host block `c` to the engine. [RT]
void writeIn(PortSlot& s, int64_t c, const BlockIO& io) noexcept {
    const int n = std::min(io.numSamples, kMaxHostBlock);
    PortFrame& f = s.in[c % kRing];
    f.beginWrite(c);
    f.numSamples = n;
    f.transport = io.transport;
    f.numChannels = std::min(io.numAudioIn, 2);
    for (int ch = 0; ch < f.numChannels; ++ch)
        if (io.audioIn[ch]) std::memcpy(f.audio[ch], io.audioIn[ch], sizeof(float) * (size_t)n);
    f.numMidi = 0;
    for (int i = 0; i < io.numMidiIn && f.numMidi < kMaxMidiEvents; ++i)
        if (io.midiIn[i].offset < n) f.midi[f.numMidi++] = io.midiIn[i];
    if (io.macros) std::memcpy(f.macros, io.macros, sizeof(f.macros));
    f.endWrite();
}

/// Copies the board's output for host block `want` to the plugin. [RT]
void readOut(PortSlot& s, int64_t want, BlockIO& io) noexcept {
    if (io.numAudioOut == 0 && io.midiOut == nullptr) return;
    const PortFrame& o = s.out[((want % kRing) + kRing) % kRing];
    const uint32_t s1 = o.seq.load(std::memory_order_acquire);
    if (want < 0 || (s1 & 1u) != 0 || o.block != want) {
        silence(io);
        return;
    }
    const int m = std::min(std::min(io.numSamples, kMaxHostBlock), o.numSamples);
    for (int ch = 0; ch < io.numAudioOut; ++ch) {
        if (!io.audioOut[ch]) continue;
        std::memcpy(io.audioOut[ch], o.audio[std::min(ch, 1)], sizeof(float) * (size_t)m);
        std::fill(io.audioOut[ch] + m, io.audioOut[ch] + io.numSamples, 0.0f);
    }
    int midi = 0;
    if (io.midiOut)
        for (int i = 0; i < o.numMidi && midi < io.midiOutCapacity; ++i)
            if (o.midi[i].offset < io.numSamples) io.midiOut[midi++] = o.midi[i];
    std::atomic_thread_fence(std::memory_order_acquire);
    if (o.seq.load(std::memory_order_relaxed) != s1) {  // overwritten while we copied
        s.drops.fetch_add(1, std::memory_order_relaxed);
        silence(io);
        return;
    }
    io.numMidiOut = midi;
    io.boardAudioValid = true;
}

}  // namespace

void Engine::process(int handle, BlockIO& io) noexcept {
    io.numMidiOut = 0;
    io.boardAudioValid = false;
    PortSlot* s = slot(handle);
    if (s == nullptr) {
        silence(io);
        return;
    }

    // Which host block is this? The first plugin of a block claims it (spec §5.3).
    int64_t T = ticks_.load(std::memory_order_acquire);
    int64_t c = s->counter < 0 ? T : s->counter + 1;
    bool claimed = false;
    if (c == T + 1) {
        int64_t expected = T;
        claimed = ticks_.compare_exchange_strong(expected, c, std::memory_order_acq_rel);
        if (!claimed && expected != c) {
            c = expected;
            s->resyncs.fetch_add(1, std::memory_order_relaxed);
        }
    } else if (c != T) {
        c = T;  // joined late, or Live skipped this plugin: follow the engine
        if (s->counter >= 0) s->resyncs.fetch_add(1, std::memory_order_relaxed);
    }
    s->counter = c;
    s->lastBlock.store(c, std::memory_order_relaxed);

    writeIn(*s, c, io);
    if (claimed) runTick(c, io);
    readOut(*s, c - 2, io);  // the tick in block c-1 processed block c-2
}

void Engine::processAll(const int* handles, BlockIO* const* ios, int count) noexcept {
    if (count <= 0) return;
    // One thread drives every port: no claiming, and no latency inside the engine.
    const int64_t c = ticks_.load(std::memory_order_relaxed) + 1;
    for (int k = 0; k < count; ++k) {
        ios[k]->numMidiOut = 0;
        ios[k]->boardAudioValid = false;
        if (PortSlot* s = slot(handles[k])) {
            s->counter = c;
            s->lastBlock.store(c, std::memory_order_relaxed);
            writeIn(*s, c, *ios[k]);
        }
    }
    ticks_.store(c, std::memory_order_release);
    runTick(c + 1, *ios[0]);  // processes block c
    for (int k = 0; k < count; ++k) {
        if (PortSlot* s = slot(handles[k])) readOut(*s, c, *ios[k]);
        else silence(*ios[k]);
    }
}

void Engine::runTick(int64_t block, const BlockIO& claimer) noexcept {
    Program* p = nullptr;
    do {
        p = program_.load(std::memory_order_seq_cst);
        inFlight_.store(p, std::memory_order_seq_cst);
    } while (p != program_.load(std::memory_order_seq_cst));

    if (p != nullptr) {
        // The tick in block N processes what the plugins handed over in block N-1.
        const int64_t b = block - 1;
        const int idx = (int)(b % kRing);
        Transport t = claimer.transport;
        int n = std::min(claimer.numSamples, kMaxHostBlock);
        bool found = false;
        for (const auto& slotPtr : p->slots()) {
            PortSlot& s = *slotPtr;
            s.tickInValid = readFrame(s.in[idx], b, s.tickIn);
            if (s.tickInValid && !found) {
                t = s.tickIn.transport;
                n = s.tickIn.numSamples;
                found = true;
            }
        }
        const bool started = t.playing && !wasPlaying_;
        wasPlaying_ = t.playing;
        for (auto& st : p->steps()) {
            if (!st.port) continue;
            st.io.in = st.port->tickInValid ? &st.port->tickIn : nullptr;
            st.io.out = nullptr;
            if (st.portWritesOut) {
                PortFrame& o = st.port->out[idx];
                o.beginWrite(b);
                o.numSamples = n;
                o.numChannels = 2;
                o.numMidi = 0;
                std::fill_n(o.audio[0], n, 0.0f);
                std::fill_n(o.audio[1], n, 0.0f);
                st.io.out = &o;
            }
        }
        p->run(t, n, started);
        for (auto& st : p->steps())
            if (st.io.out) st.io.out->endWrite();
    }
    inFlight_.store(nullptr, std::memory_order_seq_cst);
}

// ---- finding the engine: one per process ---------------------------------------------

namespace {

constexpr const char* kEnvName = "BLEEP_PATCH_ENGINE";

juce::String abiTag() {
    return juce::String(kAbiTag) + "/" + juce::String((int)sizeof(BlockIO)) + "/" +
           juce::String((int)sizeof(MidiEvent)) + "/" + juce::String((int)sizeof(Transport)) + "/" +
           juce::String((int)sizeof(void*));
}

int processId() {
#if JUCE_WINDOWS
    return _getpid();
#else
    return (int)getpid();
#endif
}

/// Keeps this binary loaded for the rest of the process: other binaries hold
/// pointers into its code once they share its engine.
void pinThisBinary() {
#if JUCE_WINDOWS
    HMODULE module = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
                       reinterpret_cast<LPCWSTR>(&pinThisBinary), &module);
#else
    Dl_info info{};
    if (dladdr(reinterpret_cast<void*>(&pinThisBinary), &info) != 0 && info.dli_fname != nullptr)
        dlopen(info.dli_fname, RTLD_NOW | RTLD_NODELETE);
#endif
}

void setEnv(const char* value) {
#if JUCE_WINDOWS
    _putenv_s(kEnvName, value ? value : "");
#else
    if (value) setenv(kEnvName, value, 1);
    else unsetenv(kEnvName);
#endif
}

/// Stands in when another build owns the process's engine.
class MismatchEngine final : public IEngine {
public:
    void retain() noexcept override { ++refs_; }
    void release() noexcept override {
        if (--refs_ == 0) delete this;
    }
    int registerInstance(PortKind) noexcept override { return 1; }
    void unregisterInstance(int) noexcept override {}
    void restoreInstanceId(int, const char*) noexcept override {}
    void instanceId(int, char* out, int capacity) noexcept override { copyOut({}, out, capacity); }
    void setTrack(int, const char*, uint32_t) noexcept override {}
    void prepare(int, double, int) noexcept override {}
    PortState state(int) noexcept override { return PortState::VersionMismatch; }
    void statusText(int, char* out, int capacity) noexcept override {
        copyOut("Another version of Bleep Patch is loaded. Restart Live after updating.", out, capacity);
    }
    void nodeName(int, char* out, int capacity) noexcept override { copyOut({}, out, capacity); }
    void setNodeName(int, const char*) noexcept override {}
    int latencySamples() noexcept override { return 0; }
    void process(int, BlockIO& io) noexcept override {
        io.numMidiOut = 0;
        io.boardAudioValid = false;
        for (int ch = 0; ch < io.numAudioOut; ++ch)
            if (io.audioOut[ch]) std::fill_n(io.audioOut[ch], io.numSamples, 0.0f);
    }
    size_t saveBoard(int, char*, size_t) noexcept override { return 0; }
    void loadBoard(int, const char*, size_t) noexcept override {}
    uint64_t boardGeneration() noexcept override { return 0; }
    void replaceBoardWith(int) noexcept override {}
    void editorOpened(int) noexcept override {}
    void openBoard(int) noexcept override {}

private:
    int refs_ = 1;
};

Engine* g_ownEngine = nullptr;  ///< the engine this binary created, if any

}  // namespace

void Engine::release() noexcept {
    if (refs_.fetch_sub(1) != 1) return;
    if (g_ownEngine == this) {
        g_ownEngine = nullptr;
        setEnv(nullptr);
    }
    delete this;
}

IEngine* acquireEngine() {
    const juce::String tag = abiTag();
    if (const char* env = std::getenv(kEnvName); env != nullptr && *env != 0) {
        // "<pid>|<pointer>|<abi tag>"
        const juce::StringArray parts = juce::StringArray::fromTokens(env, "|", "");
        if (parts.size() == 3 && parts[0].getIntValue() == processId()) {
            if (parts[2] != tag) return new MismatchEngine();
            auto* engine = reinterpret_cast<IEngine*>((uintptr_t)parts[1].getHexValue64());
            engine->retain();
            return engine;
        }
    }
    pinThisBinary();
    auto* engine = new Engine();
    g_ownEngine = engine;
    const juce::String value = juce::String(processId()) + "|" +
                               juce::String::toHexString((juce::int64)(uintptr_t)static_cast<IEngine*>(engine)) +
                               "|" + tag;
    setEnv(value.toRawUTF8());
    return engine;
}

}  // namespace bleep::engine
