// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// CodeNodes.h — Code nodes (doc/specs/bleep-script.md): a module written in Bleep Script and compiled by the board UI, run for one node.
// The UI sends the compiled module with the node's `code` property; the engine registers a node type for that node and source and the
// board compiler (Board.cpp parse, via Registry.h codeNodeSpec) maps the node to it.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace bleep::engine {

/// The node type a Code node runs as for this `code` ({source, settings, ...} as JSON): "code:<node id>:<hash of source and settings>".
/// The id changes with the source, because a node keeps its running module while its type id stays the same. Empty if there is no source.
std::string codeTypeId(const std::string& nodeId, const std::string& codeJson);

/// Registers the module for the node: refused (false, with `error`) unless it is a conforming Bleep module with exactly one node type that
/// imports nothing the ABI does not allow (the same checks as an installed module). The module's own limits apply: memory, time per call.
/// Message thread. The caller recompiles the board afterwards (Engine::modulesChanged).
bool registerCodeModule(const std::string& nodeId, const std::string& codeJson, const uint8_t* wasm, size_t size, std::string& error);

}  // namespace bleep::engine
