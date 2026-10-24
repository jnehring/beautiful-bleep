// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// WasmRegistry.h — makes the node types of an installed module file known to the engine.
#pragma once

#include "Registry.h"
#include "WasmModule.h"

namespace bleep::engine {

/// Adds every node type of the package to the registry (replacing one of the same id: a new version). Message thread.
/// False, with `error`, if its description is not usable; nothing is then added.
/// `version`: the module's version, put on every spec (nodes can pin it). `older`: not the newest of its types: found by
/// `Registry::find(type, version)` only (an older version a board pins, next to the newest).
bool registerPackage(Registry& registry, const std::shared_ptr<WasmPackage>& package, std::string& error, const std::string& version = {},
                     bool older = false);

}  // namespace bleep::engine
