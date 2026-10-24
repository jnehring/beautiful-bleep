// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// EngineBoard.cpp — the board document and the cell presets of a port.
#include "EngineInternal.h"
#include "Media.h"

namespace bleep::engine {

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
    implicit_ = false;
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

void Engine::updateImplicitBoard() {
    if (mainHandle_ != 0) {
        implicit_ = false;
        return;
    }
    bool any = false;
    for (const auto& s : instances_) any = any || !s->presetJson.empty();
    if (any && !implicit_) {
        implicit_ = true;
        setBoard(board::create(), true);
    } else if (!any && implicit_) {
        implicit_ = false;
        clearBoard();
    }
}

void Engine::attachPreset(PortSlot& s, const juce::String& portNodeId) {
    const juce::var preset = board::fromJson(juce::String(s.presetJson));
    if (!preset.isObject()) return;
    if (const auto old = board::attachedCell(board_, portNodeId); old.isNotEmpty()) board::removeCell(board_, old);
    const auto* port = board::findNode(board_, portNodeId);
    const double x = port ? (double)port->getProperty("x") : 40.0;  // the cell sits right below its port, left-aligned
    const double y = port ? (double)port->getProperty("y") + 110.0 : 150.0;
    const auto cell = board::insertPreset(board_, preset, x, y);
    if (cell.isEmpty()) return;
    board::attachHost(board_, portNodeId, cell, preset["plays"], s.kind == PortKind::AudioInsert);
    board_ = board::sanitise(board_);
}

namespace {

/// A preset's audio (its `media` map: { "<id>.wav": { name, data: base64 } }) goes into the media folder, and the map
/// is dropped from the document the slot keeps (it would only bloat the host's saved state: the files are in the folder).
/// Returns the document unchanged when it carries none.
std::string takeMedia(const char* json, size_t length) {
    if (std::memchr(json, 'm', length) == nullptr || juce::String::fromUTF8(json, (int)length).indexOf("\"media\"") < 0)
        return std::string(json, length);
    try {
        juce::var doc = board::fromJson(juce::String::fromUTF8(json, (int)length));
        auto* obj = doc.getDynamicObject();
        if (!obj || !obj->hasProperty("media")) return std::string(json, length);
        if (auto* files = obj->getProperty("media").getDynamicObject())
            for (const auto& f : files->getProperties()) {
                juce::MemoryBlock bytes;
                juce::MemoryOutputStream out(bytes, false);
                if (!juce::Base64::convertFromBase64(out, f.value["data"].toString())) continue;
                media::import((const uint8_t*)bytes.getData(), bytes.getSize(), f.value["name"].toString().toStdString(), nullptr);
            }
        obj->removeProperty("media");
        return board::toJson(doc).toStdString();
    } catch (...) {
        return std::string(json, length);
    }
}

}  // namespace

void Engine::setCellPreset(int handle, const char* json, size_t length, bool replace) noexcept {
    auto s = slotShared(handle);
    if (!s || json == nullptr) return;
    if (s->kind != PortKind::Instrument && s->kind != PortKind::AudioInsert) return;
    s->restored = true;  // the saved state has arrived: its node may appear
    if (!replace && !s->presetJson.empty()) return;
    s->presetJson = takeMedia(json, length);
    updateImplicitBoard();
    if (!hasBoard()) return;
    auto* node = board::findNodeByPort(board_, juce::String(s->id));
    if (node == nullptr) {
        reconcile(true);  // adds the port node and attaches the preset
        return;
    }
    const juce::String portNodeId = node->getProperty("id").toString();
    if (!replace && board::attachedCell(board_, portNodeId).isNotEmpty()) return;  // the board's copy wins
    beginGesture();
    attachPreset(*s, portNodeId);
    boardEdited(true);
}

size_t Engine::cellPreset(int handle, char* out, size_t capacity) noexcept {
    auto s = slotShared(handle);
    if (!s) return 0;
    std::string result = s->presetJson;
    if (hasBoard() && !s->presetJson.empty())
        if (const auto* node = board::findNodeByPort(board_, juce::String(s->id))) {
            const auto cell = board::attachedCell(board_, node->getProperty("id").toString());
            if (cell.isNotEmpty()) {
                juce::var snapshot = board::extractPreset(board_, cell);
                const juce::var meta = board::fromJson(juce::String(s->presetJson));
                for (const char* key : {"name", "description", "category", "tags", "plays"})
                    if (meta.hasProperty(key)) snapshot.getDynamicObject()->setProperty(key, meta[key]);
                result = board::toJson(snapshot).toStdString();
            }
        }
    if (out && capacity > 0) std::memcpy(out, result.data(), std::min(capacity, result.size()));
    return result.size();
}

/// The knobs of the instance's cell that the host can automate: the controls of its panel marked `expose`, or
/// else its first 16 dials and sliders, in panel order. [{node, param, name, value}]
juce::var Engine::cellParams(int handle) {
    juce::Array<juce::var> list;
    auto s = slotShared(handle);
    const auto* port = s && hasBoard() ? board::findNodeByPort(board_, juce::String(s->id)) : nullptr;
    const juce::String cell = port ? board::attachedCell(board_, port->getProperty("id").toString()) : juce::String();
    if (cell.isEmpty()) return juce::var(list);
    const juce::var* panel = nullptr;
    if (const auto* panels = board_["panels"].getArray())
        for (const auto& q : *panels)
            if (q["cell"].toString() == cell) { panel = &q; break; }
    if (panel == nullptr) return juce::var(list);
    struct Pick { juce::String node, param, name; };
    std::vector<Pick> exposed, fallback;
    if (const auto* controls = (*panel)["controls"].getArray())
        for (const auto& c : *controls) {
            const juce::String type = c["type"].toString();
            if (type != "dial" && type != "slider") continue;
            const auto* wires = c["wire"].getArray();
            if (wires == nullptr || wires->isEmpty()) continue;
            const juce::String ref = (*wires)[0]["param"].toString();
            const int dot = ref.indexOf(".");
            if (dot <= 0) continue;
            Pick p{ref.substring(0, dot), ref.substring(dot + 1), c["label"].toString()};
            (c["expose"] ? exposed : fallback).push_back(p);
        }
    auto& chosen = exposed.empty() ? fallback : exposed;
    for (const auto& p : chosen) {
        if ((int)list.size() >= 16) break;
        const auto* node = board::findNode(board_, p.node);
        if (node == nullptr) continue;
        const ModuleSpec* spec = Registry::get().find(node->getProperty("type").toString().toStdString(), node->getProperty("version").toString().toStdString());
        const int i = spec ? spec->paramIndex(p.param.toStdString()) : -1;
        if (i < 0) continue;
        double value = spec->params[(size_t)i].defaultNormalised();
        if (const auto* params = node->getProperty("params").getDynamicObject())
            if (params->hasProperty(juce::Identifier(p.param))) value = params->getProperty(juce::Identifier(p.param));
        auto* o = new juce::DynamicObject();
        o->setProperty("node", p.node);
        o->setProperty("param", p.param);
        o->setProperty("name", p.name.isNotEmpty() ? p.name : node->getProperty("name").toString() + " " + juce::String(spec->params[(size_t)i].name));
        o->setProperty("value", value);
        list.add(juce::var(o));
    }
    return juce::var(list);
}

}  // namespace bleep::engine
