// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// The presets compiled into Bleep Instrument and Bleep FX: each plugin's library is not empty, only holds
// presets that play its role, has the default preset, and the hand-written presets are in it.
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
    check(PresetLibrary::find(PortKind::Instrument, "Basic Poly") != nullptr, "a hand-written preset is there");
    for (const auto& e : instruments) check(PresetLibrary::find(PortKind::AudioInsert, e.name) == nullptr || e.name.isEmpty(),
                                            "no preset plays both roles in this build");
    return failures ? 1 : 0;
}
