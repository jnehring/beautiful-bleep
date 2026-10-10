// SPDX-License-Identifier: MIT
#include "WasmRegistry.h"

#include "SpecJson.h"

namespace bleep::engine {

bool registerPackage(Registry& registry, const std::shared_ptr<WasmPackage>& package, std::string& error) {
    const juce::var specs = juce::JSON::parse(juce::String(package->specJson));
    std::vector<ModuleSpec> built;
    for (int i = 0; i < specs.size(); ++i) {
        ModuleSpec spec;
        if (!specFromJson(specs[i], spec, error)) return false;
        const int index = package->indexOf(spec.type);
        spec.sanitiseData = [package, index](const std::string& json) { return package->sanitiseData(index, json); };
        built.push_back(std::move(spec));
    }
    for (auto& spec : built)
        registry.add(std::move(spec), [package](const ModuleSpec& s) { return std::make_unique<WasmModule>(s, package); });
    return true;
}

}  // namespace bleep::engine
