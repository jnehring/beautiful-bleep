// SPDX-License-Identifier: MIT
// BoardTypes.cpp — describeTypes: the node types, as the board page needs them.
#include "BoardInternal.h"

namespace bleep::engine {

namespace board {

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
