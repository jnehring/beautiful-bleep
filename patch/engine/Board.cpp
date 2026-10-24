// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Board.cpp — the board model, parsing a document into it, and finding and adding nodes.
#include "BoardInternal.h"

namespace bleep::engine {

// ---- BoardModel ------------------------------------------------------------

const NodeModel* BoardModel::node(const std::string& nodeId) const noexcept {
    for (const auto& n : nodes)
        if (n.id == nodeId) return &n;
    return nullptr;
}

bool BoardModel::outputType(const NodeModel& n, const std::string& jack, Signal& type) const noexcept {
    if (n.type == kPatchbayOut && isBayChannel(jack)) {  // a channel's type is the signal that goes in at the other end
        type = Signal::Control;
        return true;
    }
    const std::vector<CellJack>* jacks = nullptr;
    if (n.type == kCell) jacks = &n.cellOutputs;
    else if (n.type == kVoiceCell) {
        if (jack == "l" || jack == "r") {  // fixed (spec §8.3.1)
            type = Signal::Audio;
            return true;
        }
        jacks = &n.cellOutputs;
    } else if (n.type == kCellIn) {
        if (const auto* cell = node(n.parent)) jacks = &cell->cellInputs;
    } else if (n.type == kVoiceIn && n.spec && n.spec->outputIndex(jack) < 0) {
        // A Voice Cell's shared inputs also leave over Voice In (a Voice Cell needs no Cell In).
        if (const auto* cell = node(n.parent)) jacks = &cell->cellInputs;
    }
    if (jacks) {
        for (const auto& j : *jacks)
            if (j.id == jack) {
                type = j.type;
                return true;
            }
        return false;
    }
    if (!n.spec) return false;
    const int i = n.spec->outputIndex(jack);
    if (i < 0) return false;
    type = n.spec->outputs[(size_t)i].type;
    return true;
}

bool BoardModel::inputType(const NodeModel& n, const std::string& jack, Signal& type) const noexcept {
    if (n.type == kPatchbayIn && isBayChannel(jack)) {  // any signal but notes
        type = Signal::Control;
        return true;
    }
    const std::vector<CellJack>* jacks = nullptr;
    if (n.type == kCell) jacks = &n.cellInputs;
    else if (n.type == kVoiceCell) {
        if (jack == "notes") {
            type = Signal::Notes;
            return true;
        }
        jacks = &n.cellInputs;
    } else if (n.type == kCellOut) {
        if (const auto* cell = node(n.parent)) jacks = &cell->cellOutputs;
    }
    if (jacks) {
        for (const auto& j : *jacks)
            if (j.id == jack) {
                type = j.type;
                return true;
            }
        return false;
    }
    if (!n.spec) return false;
    if (const int i = n.spec->inputIndex(jack); i >= 0) {
        type = n.spec->inputs[(size_t)i].type;
        return true;
    }
    if (const int p = n.spec->paramIndex(jack); p >= 0 && n.spec->params[(size_t)p].drivable()) {
        type = Signal::Control;
        return true;
    }
    return false;
}


namespace board {

juce::String newId(const char* prefix) {
    return juce::String(prefix) + juce::Uuid().toString().substring(0, 10);
}

juce::var create() {
    auto* o = new juce::DynamicObject();
    o->setProperty("format", kFormat);
    o->setProperty("id", juce::Uuid().toDashedString());
    o->setProperty("nodes", juce::Array<juce::var>());
    o->setProperty("cables", juce::Array<juce::var>());
    return juce::var(o);
}

juce::String toJson(const juce::var& doc) { return juce::JSON::toString(doc, true); }

juce::var fromJson(const juce::String& json) {
    juce::var v;
    // saved state comes from the host project: refuse absurd nesting before JUCE parses it
    if (json.isNotEmpty() && !bleep::safejson::exceedsDepth(json, bleep::safejson::kProjectMaxDepth) && juce::JSON::parse(json, v).wasOk()) return v;
    return {};
}


/// A choice stored against an earlier list (ParamSpec::legacyChoices) moves to the same name in the
/// current list. The two grids (k / (old − 1), j / (new − 1)) only meet at 0 and 1, and the ends
/// of such lists stay in place, so a value on the current grid is left alone.
static float migrateLegacyChoice(const ParamSpec& p, float x) {
    const int oldN = (int)p.legacyChoices.size(), newN = (int)p.choices.size();
    if (oldN < 2 || newN < 2 || oldN == newN) return x;
    const auto onGrid = [x](int n) {
        const float r = x * (float)(n - 1);
        return std::fabs(r - std::round(r)) < 0.005f;
    };
    if (onGrid(newN) || !onGrid(oldN)) return x;
    const int k = (int)std::round(x * (float)(oldN - 1));
    const auto it = std::find(p.choices.begin(), p.choices.end(), p.legacyChoices[(size_t)k]);
    if (it == p.choices.end()) return x;
    return (float)(it - p.choices.begin()) / (float)(newN - 1);
}

/// The LFO's Sync was once a list of lengths (Free, 1/32 … 8 bars); it is now Free, Clock or Tempo with a
/// separate Rate in note values. A board saved with a length keeps it: Tempo at that length.
static void migrateLfoSync(NodeModel& node) {
    static const char* const names[] = {"Free", "1/32", "1/16", "1/8", "1/4", "1/2", "1 bar", "2 bars", "4 bars", "8 bars"};
    const ParamSpec* sync = nullptr;
    const ParamSpec* division = nullptr;
    for (const auto& p : node.spec->params) {
        if (p.id == "sync") sync = &p;
        if (p.id == "division") division = &p;
    }
    if (!sync || !division || sync->choices.size() != 3) return;
    const auto it = node.params.find("sync");
    if (it == node.params.end()) return;
    const float r = it->second * 9.0f;
    const int k = (int)std::lround(r);
    if (k < 1 || k > 9 || std::fabs(r - (float)k) > 0.005f) return;
    const std::string name = k == 6 ? "1/1" : names[k];
    const auto d = std::find(division->choices.begin(), division->choices.end(), name);
    if (d == division->choices.end()) return;
    it->second = 1.0f;  // Tempo
    node.params["division"] = (float)(d - division->choices.begin()) / (float)(division->choices.size() - 1);
}

BoardModel parse(const juce::var& doc) {
    const auto& reg = Registry::get();
    BoardModel m;
    m.id = sstr(doc, "id");
    if (auto* a = doc["nodes"].getArray()) {
        for (const auto& n : *a) {
            NodeModel node;
            node.id = sstr(n, "id");
            node.type = sstr(n, "type");
            node.name = sstr(n, "name");
            node.parent = sstr(n, "parent");
            node.port = sstr(n, "port");
            node.muted = (bool)n.getProperty("muted", false);
            node.bypassed = (bool)n.getProperty("bypassed", false);
            node.version = sstr(n, "version");
            node.spec = reg.find(node.type, node.version);   // null for a pinned version that is not installed: a placeholder
            if (node.type == kCode) {   // a Code node runs as a type of its own (Registry.h, codeNodeSpec)
                node.spec = codeNodeSpec(node.id, n.hasProperty("code") ? juce::JSON::toString(n["code"], true).toStdString() : std::string());
                if (node.spec) node.type = node.spec->type;
            }
            if (node.spec)
                for (const auto& p : node.spec->params) {
                    float x = juce::jlimit(0.0f, 1.0f,
                                           (float)n["params"].getProperty(juce::Identifier(p.id), p.defaultNormalised()));
                    if (!p.legacyChoices.empty()) x = migrateLegacyChoice(p, x);
                    node.params[p.id] = x;
                }
            if (node.spec && node.type == "lfo" && !n["params"].hasProperty("division")) migrateLfoSync(node);
            if (n.hasProperty("data")) node.data = juce::JSON::toString(n["data"], true).toStdString();
            node.cellInputs = parseJacks(n["inputs"]);
            node.cellOutputs = parseJacks(n["outputs"]);
            m.nodes.push_back(std::move(node));
        }
    }
    if (auto* a = doc["cables"].getArray()) {
        for (const auto& c : *a) {
            CableModel cable;
            cable.id = sstr(c, "id");
            cable.from = {sstr(c["from"], "node"), sstr(c["from"], "jack")};
            cable.to = {sstr(c["to"], "node"), sstr(c["to"], "jack")};
            cable.amount = (float)num(c, "amount", 1.0);
            m.cables.push_back(std::move(cable));
        }
    }
    return m;
}

void addPanelSources(BoardModel& model, const juce::var& doc) {
    const auto& reg = Registry::get();
    auto* panels = doc["panels"].getArray();
    if (panels == nullptr) return;
    auto inVoiceCell = [&](const NodeModel& n) {  // inside a Voice Cell: not reachable from the top level
        std::string p = n.parent;
        for (int depth = 0; !p.empty() && depth < 64; ++depth) {
            const NodeModel* q = model.node(p);
            if (q == nullptr) break;
            if (q->type == kVoiceCell) return true;
            p = q->parent;
        }
        return false;
    };
    auto add = [&](const std::string& id, const char* type, const std::string& node, const std::string& fromJack,
                   const std::string& toJack, float amount) -> NodeModel* {
        NodeModel n;
        n.id = id;
        n.type = type;
        n.name = type;
        n.spec = reg.find(type);
        if (n.spec == nullptr) return nullptr;
        for (const auto& p : n.spec->params) n.params[p.id] = p.defaultNormalised();
        model.nodes.push_back(std::move(n));
        CableModel c;
        c.id = "~k" + id;
        c.from = {id, fromJack};
        c.to = {node, toJack};
        c.amount = amount;
        model.cables.push_back(std::move(c));
        return &model.nodes.back();
    };
    // "node.jack": the node id has no dot, the jack or knob id may.
    auto split = [](const std::string& ref, std::string& node, std::string& jack) {
        const auto dot = ref.find('.');
        if (dot == std::string::npos) return false;
        node = ref.substr(0, dot);
        jack = ref.substr(dot + 1);
        return true;
    };
    for (const auto& panel : *panels) {
        const std::string cellId = sstr(panel, "cell"), panelId = sstr(panel, "id");
        const NodeModel* cell0 = cellId.empty() ? nullptr : model.node(cellId);
        auto* controls = panel["controls"].getArray();
        // Board panels (no cell) wire to any node; a cell's panel to the nodes inside it, and its own jacks.
        if (controls == nullptr || (!cellId.empty() && cell0 == nullptr)) continue;
        const bool voiceCell = cell0 != nullptr && cell0->type == kVoiceCell && !inVoiceCell(*cell0);  // (adding nodes moves the vector)
        for (const auto& c : *controls) {
            const std::string type = sstr(c, "type"), controlId = sstr(c, "id");
            auto* wires = c["wire"].getArray();
            if (wires == nullptr) continue;
            int index = 0;
            for (const auto& w : *wires) {
                const std::string id = "~" + panelId + ":" + controlId + ":" + std::to_string(index++);
                std::string nodeId, jack;
                if (w.hasProperty("notes")) {
                    if (voiceCell) add(id, "keyboard", cellId, "notes", "notes", 1.0f);
                    continue;
                }
                if (w.hasProperty("cell")) { nodeId = cellId; jack = sstr(w, "cell"); }
                else if (w.hasProperty("jack")) { if (!split(sstr(w, "jack"), nodeId, jack)) continue; }
                else if (w.hasProperty("param") && sstr(w, "mode") == "mod") { if (!split(sstr(w, "param"), nodeId, jack)) continue; }
                else continue;   // knobs set directly, commands: the UI does them
                const NodeModel* target = nodeId.empty() ? nullptr : model.node(nodeId);
                Signal jt{};
                if (target == nullptr || inVoiceCell(*target) || !model.inputType(*target, jack, jt)) continue;
                if (type == "button" && (jt == Signal::Trigger || jt == Signal::Gate)) {
                    add(id, "button", nodeId, jt == Signal::Trigger ? "trigger" : "gate", jack, 1.0f);
                    continue;
                }
                double lo = 0.0, hi = 1.0;
                if (auto* r = w["range"].getArray(); r != nullptr && r->size() == 2) { lo = (double)(*r)[0]; hi = (double)(*r)[1]; }
                // The saved value: a number, or [x, y] for an XY pad (the wire's axis picks one).
                juce::var saved = c["value"];
                if (auto* pair = saved.getArray()) saved = pair->size() == 2 ? (*pair)[sstr(w, "axis") == "y" ? 1 : 0] : juce::var();
                const double x = juce::jlimit(0.0, 1.0, saved.isVoid() ? ((lo < 0.0 && hi > 0.0) ? -lo / (hi - lo) : 0.0) : (double)saved);
                const double signal = juce::jlimit(-1.0, 1.0, lo + x * (hi - lo));
                const float amount = juce::jlimit(-1.0f, 1.0f, (float)num(w, "amount", 1.0));
                if (NodeModel* n = add(id, "dial", nodeId, "out", jack, amount)) {
                    // The Dial runs -1…+1 here; the UI sets "value" as (signal + 1) / 2.
                    n->params["value"] = (float)((signal + 1.0) * 0.5);
                    n->params["min"] = 0.0f;
                    n->params["max"] = 1.0f;
                    n->params["steps"] = 0.0f;
                }
            }
        }
    }
}

juce::DynamicObject* findNode(const juce::var& doc, const juce::String& id) {
    if (auto* a = doc["nodes"].getArray())
        for (const auto& n : *a)
            if (str(n, "id") == id) return n.getDynamicObject();
    return nullptr;
}

juce::DynamicObject* findNodeByPort(const juce::var& doc, const juce::String& portId) {
    if (portId.isEmpty()) return nullptr;
    if (auto* a = doc["nodes"].getArray())
        for (const auto& n : *a)
            if (str(n, "port") == portId) return n.getDynamicObject();
    return nullptr;
}

juce::DynamicObject* findCable(const juce::var& doc, const juce::String& id) {
    if (auto* a = doc["cables"].getArray())
        for (const auto& c : *a)
            if (str(c, "id") == id) return c.getDynamicObject();
    return nullptr;
}

juce::String addNode(juce::var& doc, const ModuleSpec& spec, double x, double y, const juce::String& portId) {
    auto* o = new juce::DynamicObject();
    const juce::String id = newId("n");
    o->setProperty("id", id);
    o->setProperty("type", juce::String(spec.type));
    o->setProperty("name", juce::String(spec.name));
    o->setProperty("x", x);
    o->setProperty("y", y);
    o->setProperty("parent", juce::String());
    o->setProperty("muted", false);
    if (portId.isNotEmpty()) o->setProperty("port", portId);
    auto* params = new juce::DynamicObject();
    for (const auto& p : spec.params) params->setProperty(juce::Identifier(p.id), p.defaultNormalised());
    o->setProperty("params", juce::var(params));
    if (spec.sanitiseData) o->setProperty("data", fromJson(juce::String(spec.sanitiseData({}))));
    if (auto* a = doc["nodes"].getArray()) a->add(juce::var(o));
    return id;
}

}  // namespace board
}  // namespace bleep::engine
