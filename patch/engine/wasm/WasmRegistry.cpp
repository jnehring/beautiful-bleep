// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "WasmRegistry.h"

#include "SpecJson.h"

namespace bleep::engine {

bool registerPackage(Registry& registry, const std::shared_ptr<WasmPackage>& package, std::string& error, const std::string& version, bool older) {
    const juce::var specs = juce::JSON::parse(juce::String(package->specJson));
    std::vector<ModuleSpec> built;
    for (int i = 0; i < specs.size(); ++i) {
        ModuleSpec spec;
        if (!specFromJson(specs[i], spec, error)) return false;
        spec.version = version;
        const int index = package->indexOf(spec.type);
        spec.sanitiseData = [package, index](const std::string& json) { return package->sanitiseData(index, json); };
        built.push_back(std::move(spec));
    }
    for (auto& spec : built) {
        auto factory = [package](const ModuleSpec& s) { return std::make_unique<WasmModule>(s, package); };
        if (older) registry.addOlder(std::move(spec), std::move(factory));
        else registry.add(std::move(spec), std::move(factory));
    }
    return true;
}

}  // namespace bleep::engine
