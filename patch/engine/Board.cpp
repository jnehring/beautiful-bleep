// SPDX-License-Identifier: MIT
#include "Board.h"

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
    if (const int p = n.spec->paramIndex(jack); p >= 0 && n.spec->params[(size_t)p].modulatable) {
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
            if (id.isEmpty() || spec == nullptr) {
                warn("dropped node '" + id + "' of unknown type '" + type + "'");
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
    // exactly one Voice In and Voice Out.
    for (const auto& cellId : cells) {
        if (ids.count(cellId) == 0) continue;
        std::vector<const char*> boundaries{kCellIn, kCellOut};
        if (typeOf(cellId) == kVoiceCell) {
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
            if (!src || !dst || !model.outputType(*src, fj, st) || !model.inputType(*dst, tj, dt)) {
                warn("dropped cable to unknown jacks " + juce::String(fn + "." + fj + " → " + tn + "." + tj));
                continue;
            }
            if (!compatible(st, dt)) {
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
            o->setProperty("modulatable", p.modulatable);
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
        if (s->harmony != HarmonyRole::None)
            t->setProperty("harmony", s->harmony == HarmonyRole::Writer ? "writer" : "reader");
        types.add(juce::var(t));
    }
    return types;
}

}  // namespace board
}  // namespace bleep::engine
