// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "InstalledModules.h"

#include "WasmRegistry.h"

#include <map>

namespace bleep::engine {

std::vector<LoadReport> loadInstalledModules(Registry& registry, const library::Client& client) {
    std::vector<LoadReport> reports;
    const auto all = client.installed(false, true);
    // Per module the newest version is the one nodes get (an older one is there because a board pins it): the highest version,
    // and with the same version the later one (a copy made by hand is read after the library's).
    std::map<std::string, const library::InstalledModule*> newest;
    for (const library::InstalledModule& m : all) {
        const auto it = newest.find(m.slug);
        if (it == newest.end() || !library::versionNewer(it->second->version, m.version)) newest[m.slug] = &m;
    }
    for (const library::InstalledModule& m : all) {
        LoadReport r;
        r.slug = m.slug;
        r.version = m.version;
        r.source = m.source;
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
                else if (!registerPackage(registry, package, error, m.version, newest[m.slug] != &m)) r.why = error;
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
