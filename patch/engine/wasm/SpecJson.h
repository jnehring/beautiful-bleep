// SPDX-License-Identifier: MIT
//
// SpecJson.h — a node type's ModuleSpec from the description a module file carries (bleep_spec_json, module-abi.md
// section 7): the inverse of board::describeTypes(), so the engine cannot tell an installed module from a compiled-in one.
#pragma once

#include "Spec.h"

#include <juce_core/juce_core.h>

#include <string>

namespace bleep::engine {

/// False, with `error`, if `json` is not a node type description. `sanitiseData` is left empty: the caller sets it.
bool specFromJson(const juce::var& json, ModuleSpec& out, std::string& error);

}  // namespace bleep::engine
