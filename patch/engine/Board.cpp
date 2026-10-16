// SPDX-License-Identifier: MIT
#include "Board.h"

#include <cmath>
#include <cstring>
#include <set>

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
namespace {

juce::String str(const juce::var& v, const char* key) { return v.getProperty(key, {}).toString(); }
std::string sstr(const juce::var& v, const char* key) { return str(v, key).toStdString(); }

juce::var jackVar(const CellJack& j) {
    auto* o = new juce::DynamicObject();
    o->setProperty("id", juce::String(j.id));
    o->setProperty("name", juce::String(j.name));
    o->setProperty("type", signalName(j.type));
    return juce::var(o);
}

std::vector<CellJack> parseJacks(const juce::var& list) {
    std::vector<CellJack> out;
    std::set<std::string> seen;
    if (auto* a = list.getArray()) {
        for (const auto& j : *a) {
            CellJack c;
            c.id = sstr(j, "id");
            c.name = sstr(j, "name");
            if (c.id.empty() || !seen.insert(c.id).second) continue;
            if (!signalFromName(sstr(j, "type"), c.type)) c.type = Signal::Control;
            if (c.name.empty()) c.name = c.id;
            out.push_back(std::move(c));
        }
    }
    return out;
}

double num(const juce::var& v, const char* key, double fallback) {
    const auto p = v.getProperty(key, fallback);
    return p.isDouble() || p.isInt() || p.isInt64() ? (double)p : fallback;
}

}  // namespace

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
    if (json.isNotEmpty() && juce::JSON::parse(json, v).wasOk()) return v;
    return {};
}

juce::var sanitise(const juce::var& in, juce::StringArray* warnings) {
    auto warn = [&](const juce::String& w) {
        if (warnings) warnings->add(w);
    };
    const auto& reg = Registry::get();
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    out->setProperty("format", kFormat);
    juce::String boardId = str(in, "id");
    out->setProperty("id", boardId.isNotEmpty() ? boardId : juce::Uuid().toDashedString());
    if (in.hasProperty("view")) out->setProperty("view", in["view"]);
    // Front panels (doc/specs/panels.md): UI documents the engine keeps as they are, if each is an object with an id.
    if (auto* a = in["panels"].getArray()) {
        juce::Array<juce::var> panels;
        for (const auto& p : *a)
            if (p.getDynamicObject() && str(p, "id").isNotEmpty()) panels.add(p);
        if (!panels.isEmpty()) out->setProperty("panels", panels);
    }

    // ---- nodes -------------------------------------------------------------
    juce::Array<juce::var> nodes;
    std::set<juce::String> ids, ports, cells;
    if (auto* a = in["nodes"].getArray()) {
        for (const auto& n : *a)
            if ((str(n, "type") == kCell || str(n, "type") == kVoiceCell) && str(n, "id").isNotEmpty())
                cells.insert(str(n, "id"));
        for (const auto& n : *a) {
            const juce::String id = str(n, "id"), type = str(n, "type");
            const ModuleSpec* spec = reg.find(type.toStdString());
            if (id.isEmpty()) {
                warn("dropped a node without an id");
                continue;
            }
            if (spec == nullptr) {
                // A module that is not installed (developers/reference/store.md, section 9): the node stays, with everything it was saved with,
                // so the board is not damaged by opening it on a machine without that module. The compiler leaves it out, and
                // cables to it are kept; the UI shows a placeholder. Installing the module brings the node back to life.
                if (!ids.insert(id).second) {
                    warn("dropped duplicate node '" + id + "'");
                    continue;
                }
                auto* o = new juce::DynamicObject();
                if (auto* src = n.getDynamicObject())
                    for (const auto& prop : src->getProperties()) o->setProperty(prop.name, prop.value);
                o->setProperty("id", id);
                o->setProperty("type", type);
                o->setProperty("name", str(n, "name").isNotEmpty() ? str(n, "name") : type);
                o->setProperty("x", num(n, "x", 0.0));
                o->setProperty("y", num(n, "y", 0.0));
                juce::String parent = str(n, "parent");
                if (parent.isNotEmpty() && (cells.count(parent) == 0 || parent == id)) parent = {};
                o->setProperty("parent", parent);
                o->setProperty("muted", (bool)n.getProperty("muted", false));
                o->setProperty("missing", true);
                if (!n.hasProperty("params")) o->setProperty("params", juce::var(new juce::DynamicObject()));
                nodes.add(juce::var(o));
                warn("kept node '" + id + "' of type '" + type + "' as a placeholder (not installed)");
                continue;
            }
            if (!ids.insert(id).second) {
                warn("dropped duplicate node '" + id + "'");
                continue;
            }
            auto* o = new juce::DynamicObject();
            // Keep fields the UI owns (e.g. collapsed state), then normalise ours.
            if (auto* src = n.getDynamicObject())
                for (const auto& prop : src->getProperties()) o->setProperty(prop.name, prop.value);
            o->setProperty("id", id);
            o->setProperty("type", type);
            juce::String name = str(n, "name");
            o->setProperty("name", name.isNotEmpty() ? name : juce::String(spec->name));
            o->setProperty("x", num(n, "x", 0.0));
            o->setProperty("y", num(n, "y", 0.0));
            juce::String parent = str(n, "parent");
            if (parent.isNotEmpty() && (cells.count(parent) == 0 || parent == id)) parent = {};
            if (spec->port != PortKind::None) {
                if (parent.isNotEmpty()) warn("moved port '" + id + "' to the top level");
                parent = {};  // spec §6: ports live on the top level
                const juce::String port = str(n, "port");
                if (port.isEmpty() || !ports.insert(port).second) {
                    warn("dropped port node '" + id + "' without a unique port");
                    ids.erase(id);
                    delete o;
                    continue;
                }
            }
            if ((type == kCellIn || type == kCellOut || type == kVoiceIn || type == kVoiceOut) && parent.isEmpty()) {
                warn("dropped cell boundary '" + id + "' outside a cell");
                ids.erase(id);
                delete o;
                continue;
            }
            o->setProperty("parent", parent);
            o->setProperty("muted", (bool)n.getProperty("muted", false));
            o->removeProperty("missing");  // its module is here (again)
            auto* params = new juce::DynamicObject();
            const juce::var savedParams = n["params"];
            for (const auto& p : spec->params) {
                float v = p.defaultNormalised();
                const auto saved = savedParams.getProperty(juce::Identifier(p.id), juce::var());
                if (saved.isDouble() || saved.isInt() || saved.isInt64()) v = juce::jlimit(0.0f, 1.0f, (float)saved);
                params->setProperty(juce::Identifier(p.id), v);
            }
            o->setProperty("params", juce::var(params));
            if (spec->sanitiseData) {
                const auto saved = n["data"];
                const std::string json = saved.isVoid() ? std::string() : juce::JSON::toString(saved, true).toStdString();
                o->setProperty("data", fromJson(juce::String(spec->sanitiseData(json))));
            } else {
                o->removeProperty("data");
            }
            if (type == kCell || type == kVoiceCell) {
                juce::Array<juce::var> ins, outs;
                // A Voice Cell's fixed jacks (notes, l, r) can't be shared jacks; notes stay outside.
                auto reserved = [&](const CellJack& j, bool input) {
                    if (type != kVoiceCell) return false;
                    return j.type == Signal::Notes || (input ? j.id == "notes" : (j.id == "l" || j.id == "r"));
                };
                for (const auto& j : parseJacks(n["inputs"]))
                    if (!reserved(j, true)) ins.add(jackVar(j));
                for (const auto& j : parseJacks(n["outputs"]))
                    if (!reserved(j, false)) outs.add(jackVar(j));
                o->setProperty("inputs", ins);
                o->setProperty("outputs", outs);
            } else {
                o->removeProperty("inputs");
                o->removeProperty("outputs");
            }
            nodes.add(juce::var(o));
        }
    }
    // A cell inside itself (directly or via a loop of parents) is lifted to the top.
    for (auto& n : nodes) {
        std::set<juce::String> seen{str(n, "id")};
        juce::String p = str(n, "parent");
        while (p.isNotEmpty()) {
            if (!seen.insert(p).second) {
                n.getDynamicObject()->setProperty("parent", juce::String());
                warn("broke a cell loop at '" + str(n, "id") + "'");
                break;
            }
            juce::String next;
            for (const auto& m : nodes)
                if (str(m, "id") == p) next = str(m, "parent");
            p = next;
        }
    }
    auto typeOf = [&](const juce::String& nodeId) {
        for (const auto& m : nodes)
            if (str(m, "id") == nodeId) return str(m, "type");
        return juce::String();
    };
    // Voice In / Voice Out only inside Voice Cells; Voice Cells don't nest (spec §8.3.1).
    for (int i = nodes.size(); --i >= 0;) {
        const auto t = str(nodes[i], "type");
        if ((t == kVoiceIn || t == kVoiceOut) && typeOf(str(nodes[i], "parent")) != kVoiceCell) {
            warn("dropped '" + str(nodes[i], "id") + "' outside a Voice Cell");
            ids.erase(str(nodes[i], "id"));
            nodes.remove(i);
        }
    }
    for (auto& n : nodes) {
        if (str(n, "type") != kVoiceCell) continue;
        for (juce::String p = str(n, "parent"); p.isNotEmpty();) {
            if (typeOf(p) == kVoiceCell) {
                warn("moved Voice Cell '" + str(n, "id") + "' out of another Voice Cell");
                n.getDynamicObject()->setProperty("parent", juce::String());
                break;
            }
            juce::String next;
            for (const auto& m : nodes)
                if (str(m, "id") == p) next = str(m, "parent");
            p = next;
        }
    }
    // Every cell has at least one Cell In and one Cell Out (more are fine, to lay out cables); a Voice Cell has
    // exactly one Voice In and Voice Out, and no Cell In is added to it (one it already has stays).
    for (const auto& cellId : cells) {
        if (ids.count(cellId) == 0) continue;
        std::vector<const char*> boundaries{kCellIn, kCellOut};
        if (typeOf(cellId) == kVoiceCell) {
            boundaries.erase(boundaries.begin());  // a Voice Cell's shared inputs come in over Voice In
            boundaries.push_back(kVoiceIn);
            boundaries.push_back(kVoiceOut);
        }
        for (const char* t : boundaries) {
            int count = 0;
            const bool single = std::strcmp(t, kCellIn) != 0 && std::strcmp(t, kCellOut) != 0;
            for (int i = nodes.size(); --i >= 0;)
                if (str(nodes[i], "type") == t && str(nodes[i], "parent") == cellId && (++count > 1 && single)) {
                    ids.erase(str(nodes[i], "id"));
                    nodes.remove(i);
                }
            if (count == 0) {
                const bool isIn = std::strcmp(t, kCellIn) == 0 || std::strcmp(t, kVoiceIn) == 0;
                const bool voice = std::strcmp(t, kVoiceIn) == 0 || std::strcmp(t, kVoiceOut) == 0;
                auto* o = new juce::DynamicObject();
                const juce::String id = newId(voice ? (isIn ? "vi" : "vo") : (isIn ? "ci" : "co"));
                o->setProperty("id", id);
                o->setProperty("type", t);
                o->setProperty("name", juce::String(reg.find(t)->name));
                o->setProperty("x", isIn ? 40.0 : 900.0);
                o->setProperty("y", voice ? 60.0 : 420.0);
                o->setProperty("parent", cellId);
                o->setProperty("muted", false);
                o->setProperty("params", juce::var(new juce::DynamicObject()));
                ids.insert(id);
                nodes.add(juce::var(o));
            }
        }
    }
    out->setProperty("nodes", nodes);

    // ---- cables --------------------------------------------------------------
    BoardModel model = parse(result);  // nodes only so far
    juce::Array<juce::var> cables;
    std::set<juce::String> cableIds, pairs;
    if (auto* a = in["cables"].getArray()) {
        for (const auto& c : *a) {
            const juce::var from = c["from"], to = c["to"];
            const std::string fn = sstr(from, "node"), fj = sstr(from, "jack");
            const std::string tn = sstr(to, "node"), tj = sstr(to, "jack");
            const NodeModel* src = model.node(fn);
            const NodeModel* dst = model.node(tn);
            Signal st{}, dt{};
            // a node of a module that is not installed has no jacks to check: its cables are kept as they were saved
            const bool placeholder = (src && !src->spec) || (dst && !dst->spec);
            if (!src || !dst || (!placeholder && (!model.outputType(*src, fj, st) || !model.inputType(*dst, tj, dt)))) {
                warn("dropped cable to unknown jacks " + juce::String(fn + "." + fj + " → " + tn + "." + tj));
                continue;
            }
            if (!placeholder && !compatible(st, dt)) {
                warn("dropped incompatible cable " + juce::String(fn + "." + fj + " → " + tn + "." + tj));
                continue;
            }
            if (src->parent != dst->parent) {  // spec §7.6
                warn("dropped cable across a cell border " + juce::String(fn + " → " + tn));
                continue;
            }
            const juce::String pair = juce::String(fn + "\n" + fj + "\n" + tn + "\n" + tj);
            if (!pairs.insert(pair).second) continue;
            juce::String id = str(c, "id");
            if (id.isEmpty() || !cableIds.insert(id).second) {
                id = newId("k");
                cableIds.insert(id);
            }
            auto* o = new juce::DynamicObject();
            o->setProperty("id", id);
            auto* f = new juce::DynamicObject();
            f->setProperty("node", juce::String(fn));
            f->setProperty("jack", juce::String(fj));
            auto* t = new juce::DynamicObject();
            t->setProperty("node", juce::String(tn));
            t->setProperty("jack", juce::String(tj));
            o->setProperty("from", juce::var(f));
            o->setProperty("to", juce::var(t));
            o->setProperty("amount", juce::jlimit(-1.0, 1.0, num(c, "amount", 1.0)));
            cables.add(juce::var(o));
        }
    }
    out->setProperty("cables", cables);
    return result;
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
            node.spec = reg.find(node.type);
            if (node.spec)
                for (const auto& p : node.spec->params)
                    node.params[p.id] = juce::jlimit(
                        0.0f, 1.0f, (float)n["params"].getProperty(juce::Identifier(p.id), p.defaultNormalised()));
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

namespace {

bool isCellType(const juce::String& type) { return type == "cell" || type == "voice-cell"; }

juce::var deepCopy(const juce::var& v) { return fromJson(toJson(v)); }

juce::var makeCable(const juce::String& fromNode, const juce::String& fromJack, const juce::String& toNode,
                    const juce::String& toJack) {
    auto* c = new juce::DynamicObject();
    auto* from = new juce::DynamicObject();
    auto* to = new juce::DynamicObject();
    from->setProperty("node", fromNode);
    from->setProperty("jack", fromJack);
    to->setProperty("node", toNode);
    to->setProperty("jack", toJack);
    c->setProperty("id", newId("k"));
    c->setProperty("from", juce::var(from));
    c->setProperty("to", juce::var(to));
    c->setProperty("amount", 1.0);
    return juce::var(c);
}

/// The ids of a cell and of everything inside it, however deep.
std::set<juce::String> cellTree(const juce::var& doc, const juce::String& cellId) {
    std::set<juce::String> ids{cellId};
    bool grew = true;
    while (grew) {
        grew = false;
        if (const auto* list = doc["nodes"].getArray())
            for (const auto& n : *list)
                if (ids.count(n["parent"].toString()) && ids.insert(n["id"].toString()).second) grew = true;
    }
    return ids;
}

/// Jack ids of the cell's root of a kind ("inputs" or "outputs"), audio only.
juce::StringArray audioJacks(const juce::var& root, const char* which) {
    juce::StringArray ids;
    if (const auto* list = root[which].getArray())
        for (const auto& j : *list)
            if (j["type"].toString() == "audio") ids.add(j["id"].toString());
    return ids;
}

}  // namespace

juce::String insertPreset(juce::var& doc, const juce::var& presetIn, double x, double y) {
    const juce::var preset = deepCopy(presetIn);
    const auto* nodes = preset["nodes"].getArray();
    const auto* cables = preset["cables"].getArray();
    auto* target = doc["nodes"].getArray();
    if (nodes == nullptr || cables == nullptr || target == nullptr || doc["cables"].getArray() == nullptr) return {};
    const juce::String rootId = preset["root"].toString();
    std::map<juce::String, juce::String> map;
    for (const auto& n : *nodes) map[n["id"].toString()] = newId(isCellType(n["type"].toString()) ? "c" : "n");
    if (!map.count(rootId)) return {};
    for (const auto& n : *nodes) {
        auto* o = n.getDynamicObject();
        const juce::String old = n["id"].toString();
        o->setProperty("id", map[old]);
        o->setProperty("parent", old == rootId ? juce::String() : (map.count(n["parent"].toString()) ? map[n["parent"].toString()] : juce::String()));
        o->removeProperty("port");
        if (old == rootId) {
            o->setProperty("x", std::round(x));
            o->setProperty("y", std::round(y));
        }
        target->add(n);
    }
    for (const auto& c : *cables) {
        const juce::String a = c["from"]["node"].toString(), b = c["to"]["node"].toString();
        if (!map.count(a) || !map.count(b)) continue;
        doc["cables"].getArray()->add(makeCable(map[a], c["from"]["jack"].toString(), map[b], c["to"]["jack"].toString()));
        doc["cables"].getArray()->getReference(doc["cables"].size() - 1).getDynamicObject()->setProperty("amount", c["amount"]);
    }
    // Panels: they travel with the preset, bound to the new cell and its nodes.
    if (const auto* panels = preset["panels"].getArray()) {
        if (!doc["panels"].isArray()) doc.getDynamicObject()->setProperty("panels", juce::Array<juce::var>());
        std::map<juce::String, juce::String> pmap;
        for (const auto& q : *panels) pmap[q["id"].toString()] = newId("p");
        auto key = [&](const juce::String& k) { return map.count(k) ? map[k] : k; };  // "this" stays
        auto ref = [&](const juce::String& r) {
            const int i = r.indexOf(".");
            return i < 0 ? key(r) : key(r.substring(0, i)) + r.substring(i);
        };
        for (const auto& q : *panels) {
            if (q["cell"].toString().isNotEmpty() && !map.count(q["cell"].toString())) continue;
            auto* o = q.getDynamicObject();
            o->setProperty("id", pmap[q["id"].toString()]);
            if (q["cell"].toString().isNotEmpty()) o->setProperty("cell", key(q["cell"].toString()));
            o->removeProperty("open");
            // the modules a panel made (a stack), its Panel cell and its bays, by target module
            if (auto* modules = q["modules"].getArray())
                for (auto& m : *modules) m = juce::var(key(m.toString()));
            if (q["panelCell"].toString().isNotEmpty()) o->setProperty("panelCell", key(q["panelCell"].toString()));
            for (const char* field : {"bays", "groups"})
                if (auto* old = q[field].getDynamicObject()) {
                    auto* mapped = new juce::DynamicObject();
                    for (const auto& prop : old->getProperties()) {
                        juce::var value = prop.value;
                        if (auto* v = value.getDynamicObject(); v && std::strcmp(field, "bays") == 0) {
                            for (const char* f : {"in", "out"}) v->setProperty(f, key(v->getProperty(f).toString()));
                            if (auto* path = v->getProperty("path").getArray())
                                for (auto& id : *path) id = juce::var(key(id.toString()));
                        }
                        mapped->setProperty(juce::Identifier(key(prop.name.toString())), value);
                    }
                    o->setProperty(field, juce::var(mapped));
                }
            if (auto* controls = q["controls"].getArray())
                for (auto& c : *controls) {
                    auto* co = c.getDynamicObject();
                    if (auto* wires = c["wire"].getArray())
                        for (auto& w : *wires) {
                            for (const char* k : {"param", "jack", "command"})
                                if (w[k].toString().isNotEmpty()) w.getDynamicObject()->setProperty(k, ref(w[k].toString()));
                            for (const char* k : {"press", "keyboard"})   // a Button or Keyboard module: just its id
                                if (w[k].toString().isNotEmpty()) w.getDynamicObject()->setProperty(k, key(w[k].toString()));
                        }
                    // a control made with panel-wiring.js: what it controls and the module it is made with
                    if (auto* target = c["target"].getDynamicObject())
                        if (target->hasProperty("node")) target->setProperty("node", key(target->getProperty("node").toString()));
                    if (c["module"].toString().isNotEmpty()) co->setProperty("module", key(c["module"].toString()));
                    if (auto* src = c["source"].getDynamicObject()) {
                        juce::Array<juce::var> outs;
                        const auto& o2 = c["source"]["out"];
                        if (auto* arr = o2.getArray()) for (const auto& r : *arr) outs.add(ref(r.toString()));
                        else if (o2.toString().isNotEmpty()) outs.add(ref(o2.toString()));
                        src->setProperty("out", outs);
                    }
                    if (c["node"].toString().isNotEmpty()) co->setProperty("node", key(c["node"].toString()));
                    if (c["type"].toString() == "panel" && pmap.count(c["panel"].toString())) co->setProperty("panel", pmap[c["panel"].toString()]);
                }
            doc["panels"].getArray()->add(q);
        }
    }
    return map[rootId];
}

void attachHost(juce::var& doc, const juce::String& portNodeId, const juce::String& cellId, const juce::var& plays,
                bool effect) {
    auto* cables = doc["cables"].getArray();
    auto* root = findNode(doc, cellId);
    if (cables == nullptr || root == nullptr) return;
    const juce::var rootVar(root);
    auto wire = [&](const juce::String& fromNode, const juce::String& fromJack, const juce::String& toNode,
                    const juce::String& toJack) { cables->add(makeCable(fromNode, fromJack, toNode, toJack)); };
    juce::StringArray outs;
    if (effect) {
        const auto& e = plays["effect"];
        if (const auto* in = e["in"].getArray())
            for (int i = 0; i < in->size() && i < 2; ++i) wire(portNodeId, i == 0 ? "l" : "r", cellId, (*in)[i].toString());
        if (const auto* out = e["out"].getArray())
            for (const auto& o : *out) outs.add(o.toString());
    } else {
        const auto& notes = plays["instrument"]["notes"];
        if (notes.toString() == "voice") {
            wire(portNodeId, "notes", cellId, "notes");
            outs = {"l", "r"};
        } else {
            // A hi-hat cell has a trigger per note ({default, "46": "open"}); the first version feeds the default.
            const auto& t = notes["trigger"];
            if (t.isString()) wire(portNodeId, "trigger", cellId, t.toString());
            else if (t["default"].isString()) wire(portNodeId, "trigger", cellId, t["default"].toString());
            for (const char* k : {"velocity", "pitch", "gate"})
                if (notes[k].isString()) wire(portNodeId, k, cellId, notes[k].toString());
            if (notes["notes"].isString()) wire(portNodeId, "notes", cellId, notes["notes"].toString());  // the stream itself
            outs = audioJacks(rootVar, "outputs");
        }
        // A cell that plays in time follows the host: its Clock and Run come from the transport.
        if (const auto* ins = root->getProperty("inputs").getArray())
            for (const auto& in : *ins) {
                const auto id = in["id"].toString();
                if (id == "clock") wire(portNodeId, "clock", cellId, id);
                else if (id == "run") wire(portNodeId, "playing", cellId, id);
            }
    }
    for (int i = 0; i < outs.size() && i < 2; ++i) wire(cellId, outs[i], portNodeId, i == 0 ? "l" : "r");
    if (outs.size() == 1) wire(cellId, outs[0], portNodeId, "r");
}

juce::String attachedCell(const juce::var& doc, const juce::String& portNodeId) {
    for (const auto& c : *doc["cables"].getArray()) {
        const juce::String a = c["from"]["node"].toString(), b = c["to"]["node"].toString();
        const juce::String other = a == portNodeId ? b : b == portNodeId ? a : juce::String();
        if (other.isEmpty()) continue;
        if (auto* n = findNode(doc, other); n && isCellType(n->getProperty("type").toString()) &&
                                            n->getProperty("parent").toString().isEmpty())
            return other;
    }
    return {};
}

void removeCell(juce::var& doc, const juce::String& cellId) {
    const auto ids = cellTree(doc, cellId);
    if (auto* nodes = doc["nodes"].getArray())
        for (int i = nodes->size(); --i >= 0;)
            if (ids.count((*nodes)[i]["id"].toString())) nodes->remove(i);
    if (auto* cables = doc["cables"].getArray())
        for (int i = cables->size(); --i >= 0;)
            if (ids.count((*cables)[i]["from"]["node"].toString()) || ids.count((*cables)[i]["to"]["node"].toString()))
                cables->remove(i);
    if (auto* panels = doc["panels"].getArray())
        for (int i = panels->size(); --i >= 0;)
            if (ids.count((*panels)[i]["cell"].toString())) panels->remove(i);
}

juce::var extractPreset(const juce::var& doc, const juce::String& cellId) {
    const auto ids = cellTree(doc, cellId);
    juce::Array<juce::var> nodes, cables, panels;
    if (const auto* list = doc["nodes"].getArray())
        for (const auto& n : *list)
            if (ids.count(n["id"].toString())) nodes.add(deepCopy(n));
    if (const auto* list = doc["cables"].getArray())
        for (const auto& c : *list)
            if (ids.count(c["from"]["node"].toString()) && ids.count(c["to"]["node"].toString())) cables.add(deepCopy(c));
    if (const auto* list = doc["panels"].getArray())
        for (const auto& q : *list)
            if (q["cell"].toString() == cellId) panels.add(deepCopy(q));
    auto* o = new juce::DynamicObject();
    o->setProperty("format", 1);
    o->setProperty("root", cellId);
    o->setProperty("nodes", nodes);
    o->setProperty("cables", cables);
    if (!panels.isEmpty()) o->setProperty("panels", panels);
    return juce::var(o);
}

namespace {
/// Optional view metadata shared by params and jacks: "show" {param, min, max}
/// and "names" {by, list}.
void describeShowAndNames(juce::DynamicObject* o, const ShowIf& show, const std::string& namesBy,
                          const std::vector<std::string>& names) {
    if (show.active()) {
        auto* s = new juce::DynamicObject();
        s->setProperty("param", juce::String(show.param));
        s->setProperty("min", show.min);
        s->setProperty("max", show.max);
        o->setProperty("show", juce::var(s));
    }
    if (!namesBy.empty() && !names.empty()) {
        auto* n = new juce::DynamicObject();
        n->setProperty("by", juce::String(namesBy));
        juce::Array<juce::var> list;
        for (const auto& x : names) list.add(juce::String(x));
        n->setProperty("list", list);
        o->setProperty("names", juce::var(n));
    }
}
}  // namespace

juce::var describeTypes() {
    juce::Array<juce::var> types;
    for (const ModuleSpec* s : Registry::get().all()) {
        auto* t = new juce::DynamicObject();
        t->setProperty("type", juce::String(s->type));
        t->setProperty("name", juce::String(s->name));
        t->setProperty("category", juce::String(s->category));
        t->setProperty("colour", juce::String(s->colour));
        t->setProperty("description", juce::String(s->description));
        t->setProperty("port", portKindName(s->port));
        t->setProperty("creatable", s->userCreatable);
        t->setProperty("standaloneOnly", s->standaloneOnly);
        juce::Array<juce::var> params, inputs, outputs;
        for (const auto& p : s->params) {
            auto* o = new juce::DynamicObject();
            o->setProperty("id", juce::String(p.id));
            o->setProperty("name", juce::String(p.name));
            const char* kind = p.kind == ParamSpec::Kind::Choice ? "choice"
                               : p.kind == ParamSpec::Kind::Bool ? "bool"
                               : p.kind == ParamSpec::Kind::Int  ? "int"
                                                                 : "float";
            o->setProperty("kind", kind);
            o->setProperty("default", p.defaultNormalised());
            o->setProperty("steps", p.numSteps());
            o->setProperty("modulatable", p.drivable());   // a cable can end here, on a knob or a cableable setting
            o->setProperty("cableable", p.cableable);
            if (!p.choices.empty()) {
                juce::Array<juce::var> c;
                for (const auto& x : p.choices) c.add(juce::String(x));
                o->setProperty("choices", c);
            }
            if (!p.choiceGroups.empty()) {
                juce::Array<juce::var> g;
                for (const auto& x : p.choiceGroups) g.add(juce::String(x));
                o->setProperty("groups", g);
            }
            o->setProperty("min", p.min);
            o->setProperty("max", p.max);
            o->setProperty("def", p.def);
            o->setProperty("format", formatName(p.format));
            o->setProperty("decimals", p.decimals);
            if (!p.label.empty()) o->setProperty("label", juce::String(p.label));
            // How units map to 0..1 (ParamSpec::toNormalised), for tools that write
            // values in units, e.g. the factory preset build (patch/presets).
            if (p.map == ParamSpec::Map::Exponential) o->setProperty("map", "exp");
            if (p.map == ParamSpec::Map::Skew) {
                o->setProperty("map", "skew");
                o->setProperty("centre", p.centre);
            }
            if (!p.group.empty()) o->setProperty("group", juce::String(p.group));
            describeShowAndNames(o, p.show, p.namesBy, p.names);
            params.add(juce::var(o));
        }
        auto jacks = [](const std::vector<JackSpec>& list, juce::Array<juce::var>& dst) {
            for (const auto& j : list) {
                auto* o = new juce::DynamicObject();
                o->setProperty("id", juce::String(j.id));
                o->setProperty("name", juce::String(j.name));
                o->setProperty("type", signalName(j.type));
                o->setProperty("bipolar", j.bipolar);
                describeShowAndNames(o, j.show, j.namesBy, j.names);
                if (!j.normal.empty()) o->setProperty("normal", juce::String(j.normal));
                dst.add(juce::var(o));
            }
        };
        jacks(s->inputs, inputs);
        jacks(s->outputs, outputs);
        t->setProperty("params", params);
        t->setProperty("inputs", inputs);
        t->setProperty("outputs", outputs);
        if (!s->buttons.empty()) {
            juce::Array<juce::var> buttons;
            for (const auto& b : s->buttons) {
                auto* o = new juce::DynamicObject();
                o->setProperty("id", juce::String(b.id));
                o->setProperty("name", juce::String(b.name));
                o->setProperty("momentary", b.momentary);
                buttons.add(juce::var(o));
            }
            t->setProperty("buttons", buttons);
        }
        if (s->memoryHeavy) t->setProperty("memoryHeavy", true);
        if (s->groupColumns) t->setProperty("groupColumns", true);
        if (s->harmony != HarmonyRole::None)
            t->setProperty("harmony", s->harmony == HarmonyRole::Writer ? "writer" : "reader");
        types.add(juce::var(t));
    }
    return types;
}

}  // namespace board
}  // namespace bleep::engine
