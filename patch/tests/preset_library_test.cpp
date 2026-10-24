// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// The presets compiled into Bleep Instrument and Bleep FX: each plugin's library is not empty, only holds
// presets that play its role and has the default preset. (There are no hand-written presets at the moment: hand-written-presets.json
// is empty. When some come back, check one here by name.)
#include "Engine.h"
#include "PresetLibrary.h"

#include <cstdio>

using bleep::engine::PortKind;
using bleep::patch::PresetLibrary;

namespace bleep::engine {
// The engine can open a board window; this test never does.
std::unique_ptr<BoardUi> createBoardUi(Engine&) { return nullptr; }
}  // namespace bleep::engine

static int failures = 0;
static void check(bool ok, const char* what) {
    if (!ok) {
        std::printf("FAIL: %s\n", what);
        ++failures;
    }
}

int main() {
    const auto& instruments = PresetLibrary::forKind(PortKind::Instrument);
    const auto& effects = PresetLibrary::forKind(PortKind::AudioInsert);
    std::printf("instruments %d, effects %d\n", instruments.size(), effects.size());
    check(instruments.size() > 100, "the instrument library has the factory instruments");
    check(effects.size() > 5, "the effect library has the factory effects");
    check(PresetLibrary::find(PortKind::Instrument, PresetLibrary::defaultName(PortKind::Instrument)) != nullptr,
          "the default instrument exists");
    check(PresetLibrary::find(PortKind::AudioInsert, PresetLibrary::defaultName(PortKind::AudioInsert)) != nullptr,
          "the default effect exists");
    // The Starters (an empty instrument and an empty effect) are in the library of their role and not in the other one.
    check(PresetLibrary::find(PortKind::Instrument, "Empty Instrument") != nullptr, "the Empty Instrument starter is in the instrument library");
    check(PresetLibrary::find(PortKind::AudioInsert, "Empty FX") != nullptr, "the Empty FX starter is in the effect library");
    check(PresetLibrary::find(PortKind::AudioInsert, "Empty Instrument") == nullptr, "an instrument is not in the effect library");
    for (const auto& e : instruments) check(PresetLibrary::find(PortKind::AudioInsert, e.name) == nullptr || e.name.isEmpty(),
                                            "no preset plays both roles in this build");
    return failures ? 1 : 0;
}
