// SPDX-License-Identifier: MIT
#include "PresetLibrary.h"

#include "Board.h"

#include <BoardWeb.h>

namespace bleep::patch {

using engine::PortKind;

namespace {

/// A file compiled into the plugin (board/ui), by its original name.
juce::String resource(const char* filename) {
    for (int i = 0; i < BoardWeb::namedResourceListSize; ++i) {
        if (juce::String(BoardWeb::originalFilenames[i]) != filename) continue;
        int size = 0;
        const char* data = BoardWeb::getNamedResource(BoardWeb::namedResourceList[i], size);
        return juce::String::fromUTF8(data, size);
    }
    return {};
}

juce::Array<PresetEntry> load(const char* role) {
    juce::Array<PresetEntry> list;
    const auto presets = engine::board::fromJson(resource("factory-presets.json"));
    const auto panels = engine::board::fromJson(resource("factory-panels.json"));
    const auto* all = presets["presets"].getArray();
    if (all == nullptr) return list;
    for (const auto& p : *all) {
        const juce::var preset = p["preset"];
        if (!preset["plays"].hasProperty(role)) continue;
        juce::var doc = engine::board::fromJson(engine::board::toJson(preset));
        const juce::String name = p["name"].toString();
        doc.getDynamicObject()->setProperty("name", name);
        if (panels["panels"].hasProperty(name.toRawUTF8())) doc.getDynamicObject()->setProperty("panels", panels["panels"][name.toRawUTF8()]);
        list.add({name, p["category"].toString(), preset["description"].toString(), engine::board::toJson(doc)});
    }
    return list;
}

}  // namespace

const juce::Array<PresetEntry>& PresetLibrary::forKind(PortKind kind) {
    static const juce::Array<PresetEntry> instruments = load("instrument"), effects = load("effect");
    return kind == PortKind::AudioInsert ? effects : instruments;
}

const PresetEntry* PresetLibrary::find(PortKind kind, const juce::String& name) {
    for (const auto& e : forKind(kind))
        if (e.name == name) return &e;
    return nullptr;
}

juce::String PresetLibrary::defaultName(PortKind kind) { return kind == PortKind::AudioInsert ? "Empty FX" : "Warm Saws"; }

}  // namespace bleep::patch
