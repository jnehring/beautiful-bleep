// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "CodeNodes.h"

#include "Registry.h"
#include "SpecJson.h"
#include "WasmModule.h"
#include "WasmRegistry.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <cstdio>
#include <vector>

namespace bleep::engine {

namespace {

constexpr size_t kMaxModuleBytes = size_t(8) << 20;   // a Code node's module is small; the library's own limit is higher

std::string fnv1a(const std::string& text) {
    uint64_t h = 1469598103934665603ull;
    for (unsigned char c : text) { h ^= c; h *= 1099511628211ull; }
    char buf[20];
    std::snprintf(buf, sizeof buf, "%016llx", (unsigned long long)h);
    return buf;
}

/// What the type id is made of: the source, and the settings sorted by name ("CHANNELS=8;"). The same source and settings are the same module.
struct Code {
    std::string source, settings;
    juce::var interface;
};

bool parseCode(const std::string& codeJson, Code& out) {
    if (codeJson.empty()) return false;
    const juce::var code = juce::JSON::parse(juce::String(codeJson));
    if (!code.isObject()) return false;
    out.source = code["source"].toString().toStdString();
    out.interface = code["interface"];
    if (auto* s = code["settings"].getDynamicObject()) {
        std::vector<std::pair<std::string, std::string>> items;
        for (const auto& p : s->getProperties()) items.emplace_back(p.name.toString().toStdString(), p.value.toString().toStdString());
        std::sort(items.begin(), items.end());
        for (const auto& [k, v] : items) out.settings += k + "=" + v + ";";
    }
    return !out.source.empty();
}

std::string typeIdOf(const std::string& nodeId, const Code& c) { return "code:" + nodeId + ":" + fnv1a(c.source + '\0' + c.settings); }

/// The spec a Code node runs with (Registry.h): the registered type if the UI has compiled this source, else one made from the description
/// saved on the node, which has no DSP (the node is silent) but has its jacks and knobs, so cables and knob values survive loading a board.
const ModuleSpec* resolve(const std::string& nodeId, const std::string& codeJson) {
    auto& registry = Registry::instance();
    Code code;
    if (!parseCode(codeJson, code)) return registry.find(kCode);
    const std::string type = typeIdOf(nodeId, code);
    if (const auto* known = registry.find(type)) return known;
    const juce::var iface = code.interface.isArray() ? code.interface[0] : code.interface;
    if (!iface.isObject() || iface["kind"].toString() == "patch") return registry.find(kCode);   // not compiled yet, or a patch script (no module)
    ModuleSpec spec;
    std::string error;
    if (!specFromJson(iface, spec, error)) return registry.find(kCode);
    spec.type = type;
    spec.userCreatable = false;
    spec.sanitiseData = nullptr;
    registry.add(std::move(spec), nullptr);
    return registry.find(type);
}

void registerCodeNodes(Registry& registry) {
    setCodeNodeResolver(&resolve);
    ModuleSpec spec;
    spec.type = kCode;
    spec.name = "Code";
    spec.category = "Utility/Script";
    spec.colour = "#94a3b8";
    spec.description = "A module written in code (Bleep Script): its jacks, knobs and sound come from the source. Open it to edit and compile.";
    registry.add(std::move(spec), nullptr);   // the Add menu's entry; a node of it runs as the type its source makes
}
BLEEP_REGISTER_MODULE(registerCodeNodes);

}  // namespace

std::string codeTypeId(const std::string& nodeId, const std::string& codeJson) {
    Code code;
    return parseCode(codeJson, code) ? typeIdOf(nodeId, code) : std::string();
}

bool registerCodeModule(const std::string& nodeId, const std::string& codeJson, const uint8_t* wasm, size_t size, std::string& error) {
    Code code;
    if (nodeId.empty() || !parseCode(codeJson, code)) { error = "the node has no source"; return false; }
    if (size == 0 || size > kMaxModuleBytes) { error = "the module is empty or too large"; return false; }
    auto package = WasmPackage::load(wasm, size, error);   // compiles it, checks the ABI, and refuses imports the ABI does not allow
    if (!package) return false;
    if (package->types.size() != 1) { error = "a Code node's module has exactly one node type"; return false; }
    const std::string type = typeIdOf(nodeId, code);
    if (!package->retype(type)) { error = "the module's node type could not be named"; return false; }
    return registerPackage(Registry::instance(), package, error);
}

}  // namespace bleep::engine
