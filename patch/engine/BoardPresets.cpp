// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// BoardPresets.cpp — cells as presets: insert, extract, remove and find the cell of a port.
#include "BoardInternal.h"

namespace bleep::engine {

namespace board {

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

}  // namespace board
}  // namespace bleep::engine
