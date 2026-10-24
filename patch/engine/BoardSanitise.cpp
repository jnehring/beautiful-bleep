// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// BoardSanitise.cpp — sanitise: a document from outside becomes one the engine can trust.
#include "BoardInternal.h"

namespace bleep::engine {

namespace board {

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
    // Settings of this board (not of a module): what Bleep Board does with latency.
    if (in["settings"].getDynamicObject() != nullptr) {
        auto* settings = new juce::DynamicObject();
        if (in["settings"].hasProperty("zeroHostLatencyInputs"))
            settings->setProperty("zeroHostLatencyInputs", (bool)in["settings"]["zeroHostLatencyInputs"]);
        if (!settings->getProperties().isEmpty()) out->setProperty("settings", juce::var(settings));
        else delete settings;
    }
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
            const ModuleSpec* spec = reg.find(type.toStdString(), str(n, "version").toStdString());   // a pinned version that is not installed has none
            if (type == kCode)   // a Code node has the jacks and knobs of the module its source declares (Registry.h, codeNodeSpec)
                spec = codeNodeSpec(id.toStdString(), n.hasProperty("code") ? juce::JSON::toString(n["code"], true).toStdString() : std::string());
            if (id.isEmpty()) {
                warn("dropped a node without an id");
                continue;
            }
            if (spec == nullptr) {
                // A module that is not installed (developers/modules/library.md, section 9): the node stays, with everything it was saved with,
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

}  // namespace board
}  // namespace bleep::engine
