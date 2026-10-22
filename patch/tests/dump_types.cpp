// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// Prints every node type as JSON, the way the board UI receives it. The board
// UI's browser demo (scripts/run/ui-server.py) uses a copy in board/ui/demo-types.json:
//
//   bleep_dump_types --write patch/board/ui/demo-types.json
//   bleep_dump_types --check patch/board/ui/demo-types.json   (ctest: the copy is current)
//
// It also checks the factory cell presets the way the engine will load them:
//
//   bleep_dump_types --check-presets patch/board/ui/factory-presets.json   (ctest)
#include "Board.h"
#include "Registry.h"

#include <cmath>
#include <cstdio>

namespace {

/// Every preset survives board::sanitise unchanged: no warnings, no dropped
/// nodes or cables, every knob known and in range, node data kept.
int checkPresets(const juce::File& file) {
    using namespace bleep::engine;
    const juce::var doc = juce::JSON::parse(file.loadFileAsString());
    const auto* presets = doc["presets"].getArray();
    if (presets == nullptr || presets->isEmpty()) {
        std::printf("%s: no presets\n", file.getFullPathName().toRawUTF8());
        return 1;
    }
    int failures = 0;
    auto fail = [&](const juce::String& preset, const juce::String& what) {
        std::printf("factory preset '%s': %s\n", preset.toRawUTF8(), what.toRawUTF8());
        ++failures;
    };
    for (const auto& entry : *presets) {
        const juce::String name = entry["name"].toString();
        const juce::var preset = entry["preset"];
        if (name.isEmpty() || entry["category"].toString().isEmpty() || preset["description"].toString().isEmpty())
            fail(name, "needs a name, a category and a description");
        const auto* nodes = preset["nodes"].getArray();
        const auto* cables = preset["cables"].getArray();
        if (nodes == nullptr || cables == nullptr) {
            fail(name, "has no nodes or cables");
            continue;
        }
        bool hasRoot = false;
        for (const auto& n : *nodes)
            hasRoot = hasRoot || (n["id"] == preset["root"] && n["parent"].toString().isEmpty());
        if (!hasRoot) fail(name, "its root isn't a top-level node");

        juce::StringArray warnings;
        const juce::var out = board::sanitise(preset, &warnings);
        for (const auto& w : warnings) fail(name, w);
        if (out["nodes"].size() != nodes->size())
            fail(name, juce::String(nodes->size()) + " nodes became " + juce::String(out["nodes"].size()));
        if (out["cables"].size() != cables->size())
            fail(name, juce::String(cables->size()) + " cables became " + juce::String(out["cables"].size()));

        for (const auto& n : *nodes) {
            const ModuleSpec* spec = Registry::get().find(n["type"].toString().toStdString());
            if (spec == nullptr) continue;  // sanitise warned
            if (auto* params = n["params"].getDynamicObject()) {
                for (const auto& prop : params->getProperties()) {
                    const std::string id = prop.name.toString().toStdString();
                    const int i = spec->paramIndex(id);
                    const double v = prop.value;
                    if (i < 0) fail(name, n["name"].toString() + ": unknown knob '" + juce::String(id) + "'");
                    else if (!(v >= 0.0 && v <= 1.0))
                        fail(name, n["name"].toString() + "." + juce::String(id) + " = " + juce::String(v) + " is outside 0…1");
                }
            }
            if (n.hasProperty("data") && spec->sanitiseData == nullptr)
                fail(name, n["name"].toString() + ": has data, but its type keeps none");
        }
    }
    std::printf("%d factory presets checked, %d problems\n", presets->size(), failures);
    return failures == 0 ? 0 : 1;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc == 3 && juce::String(argv[1]) == "--check-presets")
        return checkPresets(juce::File::getCurrentWorkingDirectory().getChildFile(argv[2]));
    const juce::String json =
        juce::JSON::toString(bleep::engine::board::describeTypes(), false).removeCharacters("\r") + "\n";   // JUCE ends lines with \r\n; replace("\r\n", "\n") copies the whole string per line, which took minutes on 1 MB. The JSON escapes any \r inside a string.
    if (argc == 3) {
        const juce::File file(juce::File::getCurrentWorkingDirectory().getChildFile(argv[2]));
        if (juce::String(argv[1]) == "--write") return file.replaceWithText(json, false, false, "\n") ? 0 : 1;
        if (juce::String(argv[1]) == "--check") {
            if (file.loadFileAsString() == json) return 0;
            std::printf("%s is out of date: run bleep_dump_types --write %s\n", argv[2], argv[2]);
            return 1;
        }
    }
    std::printf("%s", json.toRawUTF8());
    return 0;
}
