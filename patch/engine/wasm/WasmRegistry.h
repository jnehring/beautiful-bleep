// SPDX-License-Identifier: MIT
//
// WasmRegistry.h — makes the node types of an installed module file known to the engine.
#pragma once

#include "Registry.h"
#include "WasmModule.h"

namespace bleep::engine {

/// Adds every node type of the package to the registry (replacing one of the same id: a new version). Message thread.
/// False, with `error`, if its description is not usable; nothing is then added.
bool registerPackage(Registry& registry, const std::shared_ptr<WasmPackage>& package, std::string& error);

}  // namespace bleep::engine
