// SPDX-License-Identifier: MIT
//
// InstalledModules.h — the modules installed on this machine, made known to the engine (developers/modules/library.md, M3).
#pragma once

#include "Registry.h"
#include "library/Client.h"

#include <string>
#include <vector>

namespace bleep::engine {

struct LoadReport {
    std::string slug, version, source;   ///< source: "registry" or "local"
    std::string status;                  ///< what the signature check said: signed, unsigned, expired, revoked, invalid
    std::string why;                     ///< why it was or was not loaded, in words
    bool loaded = false;
    std::vector<std::string> types;      ///< the node types it added
};

/// Registers the node types of every installed module that is allowed to load. Nothing is compiled yet: a module compiles
/// when a node of its type first gets prepared. Message thread, before the audio runs or while a board is rebuilt.
std::vector<LoadReport> loadInstalledModules(Registry& registry, const library::Client& client);

}  // namespace bleep::engine
