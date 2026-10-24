// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// EngineEdit.cpp — what the board window does to the engine: UI calls, commit, undo, parameters and media.
#include "EngineInternal.h"

namespace bleep::engine {

juce::var Engine::uiMessage() const {
    auto* o = new juce::DynamicObject();
    o->setProperty("board", hasBoard() ? board_ : juce::var());
    o->setProperty("ports", ports());
    o->setProperty("canUndo", canUndo());
    o->setProperty("canRedo", canRedo());
    o->setProperty("status", statusLine());
    return juce::var(o);
}

juce::var Engine::uiDispatch(int handle, const juce::String& m, const juce::var& a) {
    if (m == "init") {
        auto r = uiMessage();
        auto* o = r.getDynamicObject();
        o->setProperty("types", board::describeTypes());
        o->setProperty("standalone", standalone_);
        o->setProperty("plugin", true);
        juce::String cell;
        if (auto s = slotShared(handle); s && hasBoard())
            if (const auto* node = board::findNodeByPort(board_, juce::String(s->id)))
                cell = board::attachedCell(board_, node->getProperty("id").toString());
        o->setProperty("pluginCell", cell);
        return r;
    }
    if (m == "board") return uiMessage();
    if (m == "liveLinkInfo") return liveLinkInfo();
    if (m == "cellParams") return cellParams(handle);
    if (m == "pluginCell") {  // {cell: id}: JSON results are objects or arrays, never a bare string
        juce::String cell;
        if (auto s = slotShared(handle); s && hasBoard())
            if (const auto* node = board::findNodeByPort(board_, juce::String(s->id)))
                cell = board::attachedCell(board_, node->getProperty("id").toString());
        auto* o = new juce::DynamicObject();
        o->setProperty("cell", cell);
        return juce::var(o);
    }
    if (m == "types") return board::describeTypes();
    if (m == "commit") {
        commit(a[0], a[1].toString());
        return uiMessage();
    }
    if (m == "undo" || m == "redo" || m == "beginGesture") {
        if (m == "undo") undo();
        else if (m == "redo") redo();
        else beginGesture();
        return uiMessage();
    }
    if (m == "setBoardSetting") {
        setBoardSetting(a[0].toString(), a[1]);
        return uiMessage();
    }
    if (m == "setParam") setParam(a[0].toString(), a[1].toString(), (float)a[2]);
    else if (m == "setAmount") setAmount(a[0].toString(), (float)a[1]);
    else if (m == "setData") setData(a[0].toString(), a[1]);
    else if (m == "command") command(a[0].toString(), a[1].toString(), (float)a[2]);
    else if (m == "perform") perform(a[0].toString(), a[1].toString(), a[2]);
    else if (m == "exportMedia") return exportMedia(a[0].toString(), a[1].toString());
    else if (m == "revealMedia") return revealMedia(a[0].toString());
    else if (m == "importMedia") {
        juce::MemoryOutputStream decoded;
        if (!juce::Base64::convertFromBase64(decoded, a[1].toString())) {
            auto* o = new juce::DynamicObject();
            o->setProperty("error", "could not read the file");
            return juce::var(o);
        }
        return importMedia(a[0].toString(), decoded.getMemoryBlock());
    } else if (m == "registerCode") {   // [node id, the node's code, the module's bytes as base64]
        juce::MemoryOutputStream decoded;
        if (!juce::Base64::convertFromBase64(decoded, a[2].toString())) {
            auto* o = new juce::DynamicObject();
            o->setProperty("error", "could not read the module");
            return juce::var(o);
        }
        return registerCode(a[0].toString(), a[1], decoded.getMemoryBlock());
    } else if (m == "readMedia") {
        return readMedia(a[0].toString());
    } else if (m == "liveState") {
        std::set<juce::String> watched;
        if (const auto* ids = a[0].getArray())
            for (const auto& id : *ids) watched.insert(id.toString());
        return liveState(watched);
    }
    return {};
}

size_t Engine::uiCall(int handle, const char* method, const char* argsJson, char* out, size_t capacity) noexcept {
    if (method == nullptr) return 0;
    if (juce::String(method) != "__last") {
        const juce::var args = bleep::safejson::parse(juce::String::fromUTF8(argsJson ? argsJson : "[]"));
        uiLast_ = board::toJson(uiDispatch(handle, method, args)).toStdString();
    }
    if (out && capacity > 0) std::memcpy(out, uiLast_.data(), std::min(capacity, uiLast_.size()));
    return uiLast_.size();
}

/// A project loaded into Bleep Board brings an Audio Out and a MIDI In whose port is only the bare suffix (the page cannot know
/// the plugin's id): they become this Bleep Board's own, unless the board already has one.
void Engine::claimBoardPorts(const juce::var& doc) {
    if (standalone_ || mainHandle_ == 0) return;
    std::string id;
    for (const auto& s : instances_)
        if (s->kind == PortKind::Patch && s->handle == mainHandle_) id = s->id;
    auto* nodes = doc["nodes"].getArray();
    if (id.empty() || nodes == nullptr) return;
    for (const char* suffix : {kBoardMidiSuffix, kBoardAudioSuffix}) {
        const juce::String own = juce::String(id) + suffix;
        bool taken = false;
        for (const auto& n : *nodes) taken = taken || n["port"].toString() == own;
        for (auto& n : *nodes) {
            if (n["port"].toString() != suffix) continue;
            if (taken) continue;
            n.getDynamicObject()->setProperty("port", own);
            taken = true;
        }
    }
}

juce::var Engine::commit(const juce::var& edited, const juce::String& label) {
    juce::ignoreUnused(label);
    if (!hasBoard()) return board_;
    claimBoardPorts(edited);
    auto clean = board::sanitise(edited);
    // Ports can't be deleted from the board (spec §6): put back what went missing.
    if (auto* oldNodes = board_["nodes"].getArray()) {
        bool restored = false;
        for (const auto& n : *oldNodes) {
            const auto* spec = Registry::get().find(n["type"].toString().toStdString());
            if (spec && (spec->userCreatable || (standalone_ && appOwnsPort(spec->port)))) continue;  // the user may delete it
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
    const bool panelSource = nodeId.startsWithChar('~');  // a panel control's hidden source: not in the saved board
    if (n == nullptr && !panelSource) return;
    v = juce::jlimit(0.0f, 1.0f, v);
    if (n != nullptr)
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

void Engine::setBoardSetting(const juce::String& key, const juce::var& value) {
    if (!hasBoard() || key != "zeroHostLatencyInputs") return;
    auto* doc = board_.getDynamicObject();
    if (doc == nullptr) return;
    juce::var settings = doc->getProperty("settings");
    if (settings.getDynamicObject() == nullptr) settings = juce::var(new juce::DynamicObject());
    if (zeroHostLatencyInputs() == (bool)value) return;
    settings.getDynamicObject()->setProperty(key, (bool)value);
    doc->setProperty("settings", settings);
    updateLatencyModel();   // the plugins ask for their latency on their timers
    generation_.fetch_add(1);
}

void Engine::setData(const juce::String& nodeId, const juce::var& data) {
    auto* n = hasBoard() ? board::findNode(board_, nodeId) : nullptr;
    if (n == nullptr) return;
    const auto* spec = Registry::get().find(n->getProperty("type").toString().toStdString(), n->getProperty("version").toString().toStdString());
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

juce::var Engine::registerCode(const juce::String& nodeId, const juce::var& code, const juce::MemoryBlock& wasm) {
    auto* o = new juce::DynamicObject();
#if defined(BLEEP_WASM_MODULES)
    std::string error;
    if (registerCodeModule(nodeId.toStdString(), juce::JSON::toString(code, true).toStdString(), static_cast<const uint8_t*>(wasm.getData()), wasm.getSize(), error)) {
        modulesChanged();   // nodes of this id now run the new module
        o->setProperty("ok", true);
    } else {
        o->setProperty("error", juce::String(error));
    }
#else
    (void)nodeId; (void)code; (void)wasm;
    o->setProperty("error", "this build cannot run Code nodes");
#endif
    return juce::var(o);
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

juce::var Engine::readMedia(const juce::String& id) {
    auto* o = new juce::DynamicObject();
    if (!media::validId(id.toStdString())) {
        o->setProperty("error", "not a media id");
        return juce::var(o);
    }
    const juce::File file = juce::File(juce::String(media::folder())).getChildFile(id);
    juce::MemoryBlock bytes;
    if (!file.existsAsFile() || !file.loadFileAsData(bytes) || bytes.getSize() == 0) {
        o->setProperty("error", "not in the media folder");
        return juce::var(o);
    }
    o->setProperty("data", juce::Base64::toBase64(bytes.getData(), bytes.getSize()));
    o->setProperty("name", id);
    return juce::var(o);
}

juce::var Engine::revealMedia(const juce::String& id) {
    auto* o = new juce::DynamicObject();
    const juce::File file = media::validId(id.toStdString()) ? juce::File(juce::String(media::folder())).getChildFile(id) : juce::File();
    if (!file.existsAsFile()) {
        o->setProperty("error", "not in the media folder");
        return juce::var(o);
    }
    file.revealToUser();
    o->setProperty("ok", true);
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

void Engine::perform(const juce::String& nodeId, const juce::String& action, const juce::var& args) {
    std::vector<double> values;
    if (const auto* a = args.getArray())
        for (const auto& v : *a) values.push_back((double)v);
    const std::string id = nodeId.toStdString(), name = action.toStdString();
    if (auto m = modules_.find(id); m != modules_.end()) m->second->perform(name, values);
    if (auto in = inner_.find(id); in != inner_.end())
        for (const auto& m : in->second.modules) m->perform(name, values);
}

void Engine::setAmount(const juce::String& cableId, float amount) {
    auto* c = hasBoard() ? board::findCable(board_, cableId) : nullptr;
    if (c == nullptr) return;
    c->setProperty("amount", juce::jlimit(-1.0f, 1.0f, amount));
    generation_.fetch_add(1);
    recompile();
}

}  // namespace bleep::engine
