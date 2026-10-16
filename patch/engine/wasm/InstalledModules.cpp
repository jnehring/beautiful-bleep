// SPDX-License-Identifier: MIT
#include "InstalledModules.h"

#include "WasmRegistry.h"

namespace bleep::engine {

std::vector<LoadReport> loadInstalledModules(Registry& registry, const library::Client& client) {
    std::vector<LoadReport> reports;
    for (const library::InstalledModule& m : client.installed()) {
        LoadReport r;
        r.slug = m.slug;
        r.version = m.version;
        r.source = m.source;
        r.status = m.result.status;
        r.why = m.why;
        if (m.allowed) {
            std::vector<uint8_t> wasm;
            std::string spec, error;
            std::shared_ptr<WasmPackage> package;
            if (!client.contentOf(m, wasm, spec, error)) {
                r.why = error;
            } else {
                package = spec.empty() ? WasmPackage::load(wasm.data(), wasm.size(), error) : WasmPackage::lazy(std::move(wasm), spec, error);
                if (!package) r.why = error;
                else if (!registerPackage(registry, package, error)) r.why = error;
                else {
                    r.loaded = true;
                    r.types = package->types;
                }
            }
        }
        reports.push_back(std::move(r));
    }
    return reports;
}

}  // namespace bleep::engine
