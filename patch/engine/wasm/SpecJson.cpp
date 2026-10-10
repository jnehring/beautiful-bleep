// SPDX-License-Identifier: MIT
#include "SpecJson.h"

namespace bleep::engine {
namespace {

std::string str(const juce::var& v) { return v.isString() ? v.toString().toStdString() : std::string(); }
bool flag(const juce::var& v) { return v.isBool() && (bool)v; }

std::vector<std::string> strings(const juce::var& v) {
    std::vector<std::string> out;
    if (auto* a = v.getArray())
        for (const auto& x : *a) out.push_back(str(x));
    return out;
}

void showAndNames(const juce::var& o, ShowIf& show, std::string& namesBy, std::vector<std::string>& names) {
    if (o["show"].isObject()) show = {str(o["show"]["param"]), (int)o["show"]["min"], (int)o["show"]["max"]};
    if (o["names"].isObject()) {
        namesBy = str(o["names"]["by"]);
        names = strings(o["names"]["list"]);
    }
}

bool jacks(const juce::var& list, std::vector<JackSpec>& out, std::string& error) {
    if (auto* a = list.getArray())
        for (const auto& j : *a) {
            JackSpec jack;
            jack.id = str(j["id"]);
            jack.name = str(j["name"]);
            if (jack.id.empty() || !signalFromName(str(j["type"]), jack.type)) { error = "a jack without an id or a known signal type"; return false; }
            jack.bipolar = flag(j["bipolar"]);
            jack.normal = str(j["normal"]);
            showAndNames(j, jack.show, jack.namesBy, jack.names);
            out.push_back(std::move(jack));
        }
    return true;
}

}  // namespace

bool specFromJson(const juce::var& j, ModuleSpec& s, std::string& error) {
    s = ModuleSpec{};
    s.type = str(j["type"]);
    if (s.type.empty()) { error = "a node type without an id"; return false; }
    s.name = str(j["name"]);
    s.category = str(j["category"]);
    s.colour = str(j["colour"]);
    s.description = str(j["description"]);
    if (!portKindFromName(str(j["port"]), s.port)) { error = "unknown port kind"; return false; }
    s.userCreatable = flag(j["creatable"]);
    s.standaloneOnly = flag(j["standaloneOnly"]);
    s.memoryHeavy = flag(j["memoryHeavy"]);
    s.groupColumns = flag(j["groupColumns"]);
    s.harmony = str(j["harmony"]) == "writer" ? HarmonyRole::Writer : str(j["harmony"]) == "reader" ? HarmonyRole::Reader : HarmonyRole::None;
    if (auto* params = j["params"].getArray())
        for (const auto& pj : *params) {
            ParamSpec p;
            p.id = str(pj["id"]);
            p.name = str(pj["name"]);
            const std::string kind = str(pj["kind"]);
            p.kind = kind == "choice" ? ParamSpec::Kind::Choice : kind == "bool" ? ParamSpec::Kind::Bool : kind == "int" ? ParamSpec::Kind::Int : ParamSpec::Kind::Float;
            const std::string map = str(pj["map"]);
            p.map = map == "exp" ? ParamSpec::Map::Exponential : map == "skew" ? ParamSpec::Map::Skew : ParamSpec::Map::Linear;
            if (!formatFromName(str(pj["format"]), p.format)) p.format = ParamSpec::Format::Number;
            p.min = (float)(double)pj["min"];
            p.max = (float)(double)pj["max"];
            p.def = (float)(double)pj["def"];
            if (pj["centre"].isDouble() || pj["centre"].isInt()) p.centre = (float)(double)pj["centre"];
            p.decimals = pj["decimals"].isVoid() ? 2 : (int)pj["decimals"];
            p.label = str(pj["label"]);
            p.choices = strings(pj["choices"]);
            p.choiceGroups = strings(pj["groups"]);
            p.modulatable = !pj["modulatable"].isBool() || (bool)pj["modulatable"];
            p.group = str(pj["group"]);
            showAndNames(pj, p.show, p.namesBy, p.names);
            if (p.id.empty()) { error = "a parameter without an id"; return false; }
            s.params.push_back(std::move(p));
        }
    if (!jacks(j["inputs"], s.inputs, error) || !jacks(j["outputs"], s.outputs, error)) return false;
    if (auto* buttons = j["buttons"].getArray())
        for (const auto& b : *buttons) s.buttons.push_back({str(b["id"]), str(b["name"]), flag(b["momentary"])});
    return true;
}

}  // namespace bleep::engine
