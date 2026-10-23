// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// EngineCompile.cpp — compiling the board, reconciling ports, and the state the UI shows.
#include "EngineInternal.h"

#include <algorithm>
#include <cstdio>
#include <tuple>
#include <utility>

namespace bleep::engine {

void Engine::modulesChanged() {
    if (!hasBoard()) return;
    board_ = board::sanitise(board_);  // nodes that were placeholders get their module's parameters and data
    recompile();
    generation_.fetch_add(1);
}

void Engine::recompile() {
    std::map<std::string, std::shared_ptr<PortSlot>> ports;
    for (const auto& s : instances_) {
        s->writesOut.store(false, std::memory_order_relaxed);  // compile sets it again for an Audio Out node
        if ((s->kind != PortKind::Patch || s->handle == mainHandle_) && !s->bridged) ports[s->id] = s;
        // Bleep Board is also a MIDI In and an Audio Out: a port id names one node, so each gets its own.
        if (s->kind == PortKind::Patch && s->handle == mainHandle_ && !s->bridged) {
            ports[s->id + kBoardMidiSuffix] = s;
            ports[s->id + kBoardAudioSuffix] = s;
        }
    }
    std::unique_ptr<Program> next;
    if (hasBoard()) {
        BoardModel model = board::parse(board_);
        board::addPanelSources(model, board_);
        next = Program::compile(model, modules_, ports, sampleRate_, nullptr, !standalone_);
    }
    else modules_.clear();
    // The modules inside Voice Cells, one per voice, for knob changes and views.
    inner_.clear();
    for (const auto& [id, m] : modules_)
        if (auto cell = std::dynamic_pointer_cast<VoiceCellModule>(m)) {
            std::map<std::string, std::vector<std::shared_ptr<Module>>> found;
            cell->collect(found);
            for (auto& [nodeId, mods] : found) inner_[nodeId] = Inner{std::move(mods), cell};
        }
    const Program* fresh = next.get();
    if (Program* old = program_.exchange(next.release(), std::memory_order_seq_cst)) retired_.push_back(old);
    for (const auto& s : instances_) s->local.store(fresh != nullptr && fresh->localGroup(s.get()) >= 0, std::memory_order_relaxed);
}

void Engine::collectGarbage() {
    Program* busy = inFlight_.load(std::memory_order_seq_cst);
    retired_.erase(std::remove_if(retired_.begin(), retired_.end(),
                                  [&](Program* p) {
                                      if (p == busy) return false;
                                      for (const auto& s : instances_)  // a plugin running its cell in its own block
                                          if (s->hazard.load(std::memory_order_seq_cst) == p) return false;
                                      delete p;
                                      return true;
                                  }),
                   retired_.end());
}

namespace {

/// Where the next top-level node goes on a board that already has some: left-aligned with what is there, one row
/// below its lowest node (a node is about 110 tall, with the gap).
std::pair<double, double> belowExisting(const juce::var& doc) {
    double left = 1e9, bottom = 0.0;
    if (const auto* a = doc["nodes"].getArray())
        for (const auto& n : *a) {
            if (n["parent"].toString().isNotEmpty()) continue;
            left = std::min(left, (double)n["x"]);
            bottom = std::max(bottom, (double)n["y"] + 110.0);
        }
    return {left > 1e8 ? 40.0 : left, bottom > 0.0 ? bottom : 40.0};
}

}  // namespace

void Engine::reconcile(bool force) {
    if (!hasBoard()) return;
    bool changed = false;
    int inputs = 0, outputs = 0;
    // The standalone app starts an empty board with just In 1/2 and Out 1/2; the other ports (MIDI, Link, more audio
    // channels) are added from the Add menu, and may be deleted again.
    const bool emptyBoard = board_["nodes"].getArray() == nullptr || board_["nodes"].getArray()->isEmpty();
    for (const auto& s : instances_) {
        if (s->kind == PortKind::Patch && s->handle == mainHandle_ && !standalone_ && !s->bridged && !s->seeded && emptyBoard &&
            (force || s->restored || nowMs() - s->registeredAt >= 500.0)) {
            // A new Bleep Board starts with a MIDI In and an Audio Out of its own (a saved board is left alone).
            s->seeded = true;
            if (const auto* midi = Registry::get().forPort(PortKind::MidiIn))
                board::addNode(board_, *midi, 40.0, 40.0, juce::String(s->id + kBoardMidiSuffix));
            if (const auto* audio = Registry::get().forPort(PortKind::AudioOut))
                board::addNode(board_, *audio, 760.0, 40.0, juce::String(s->id + kBoardAudioSuffix));
            changed = true;
            inputs = 1;  // the Macros node goes below the MIDI In
        }
        if (s->kind == PortKind::Patch && (s->handle != mainHandle_ || standalone_)) continue;
        if (s->kind == PortKind::MidiDevice && !s->remote) continue;  // its node comes first; the app follows it
        if (s->bridged) continue;                                      // its other side is another board
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
        if (standalone_ && appOwnsPort(s->kind) && !s->remote && !(emptyBoard && (s->id == "device-in-1" || s->id == "device-out-1"))) continue;
        const ModuleSpec* spec = Registry::get().forPort(s->kind);
        if (spec == nullptr) continue;
        const bool toTrack = (sendsToTrack(s->kind) && s->kind != PortKind::Instrument &&
                              s->kind != PortKind::AudioInsert && s->kind != PortKind::AudioBridge) ||
                             s->kind == PortKind::MidiOut;
        double x = toTrack ? 760.0 : 40.0;
        double y = 40.0 + 110.0 * (toTrack ? outputs++ : inputs++);
        if (!emptyBoard) std::tie(x, y) = belowExisting(board_);  // a board with a patch: add below it, never over it
        const auto id = board::addNode(board_, *spec, x, y, juce::String(s->id));
        if (auto* n = board::findNode(board_, id); n && s->trackName.size()) {
            n->setProperty("track", juce::String(s->trackName));
            n->setProperty("name", juce::String(s->trackName));
        }
        if (!s->presetJson.empty()) attachPreset(*s, id);
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
        if (const uint32_t n = m->takeRunaways())
            std::fprintf(stderr, "[engine] %s (%s) produced NaN or a runaway level %u time(s); silenced and reset\n",
                         id.c_str(), m->spec().type.c_str(), n);
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
        // Bleep Board is also a MIDI In and an Audio Out (see recompile): the same slot answers for their port ids.
        if (s->kind == PortKind::Patch && s->handle == mainHandle_ && !s->bridged)
            for (const auto& [suffix, kind] : {std::pair{kBoardMidiSuffix, PortKind::MidiIn}, std::pair{kBoardAudioSuffix, PortKind::AudioOut}}) {
                auto* q = new juce::DynamicObject();
                q->setProperty("kind", portKindName(kind));
                q->setProperty("track", juce::String(s->trackName));
                q->setProperty("live", p->getProperty("live"));
                q->setProperty("main", true);
                o->setProperty(juce::Identifier(s->id + suffix), juce::var(q));
            }
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
        // How much each output moved since the last call: the cables' pulse.
        auto* act = new juce::DynamicObject();
        for (size_t k = 0; k < spec.outputs.size(); ++k)
            if (const float a = m->outputDisplay((int)k).activity(); a > 1e-4f)
                act->setProperty(juce::Identifier(spec.outputs[k].id), a);
        n->setProperty("activity", juce::var(act));
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
    {  // the side menu's Transport section
        auto* t = new juce::DynamicObject();
        t->setProperty("bpm", uiBpm_.load(std::memory_order_relaxed));
        t->setProperty("playing", uiPlaying_.load(std::memory_order_relaxed));
        root->setProperty("transport", juce::var(t));
    }
    if (statusProvider_) root->setProperty("status", statusProvider_());
    return juce::var(root);
}

juce::String Engine::statusLine() const {
    juce::String s;
    if (statusProvider_) return statusProvider_();
    if (!hasBoard()) return "No board in this set. Add Bleep Board.";
    s << "Latency " << const_cast<Engine*>(this)->latencySamples() << u8(" smp · ") << juce::String(sampleRate_ / 1000.0, 1)
      << " kHz";
    return s;
}

}  // namespace bleep::engine
