// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// Registry.h — every node type the board knows: modules, ports and the cell
// structure nodes. Modules register themselves in Registry.cpp.
#pragma once

#include "Module.h"

#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace bleep::engine {

/// Structural node types: they carry no DSP and are flattened by the compiler.
constexpr const char* kCell = "cell";
constexpr const char* kCellIn = "cell-in";
constexpr const char* kCellOut = "cell-out";
constexpr const char* kPatchbayIn = "patchbay-in";    ///< sources in, one bundle out (doc/specs/modules/patchbay.md)
constexpr const char* kPatchbayOut = "patchbay-out";  ///< one bundle in, the same channels out
/// Voice Cells (spec §8.3): the cell is a real node; Voice In/Out are structural.
constexpr const char* kVoiceCell = "voice-cell";
constexpr const char* kVoiceIn = "voice-in";
constexpr const char* kVoiceOut = "voice-out";

class Registry {
public:
    using Factory = std::function<std::unique_ptr<Module>(const ModuleSpec&)>;

    static const Registry& get();
    /// The same registry, for adding node types after start: installed modules (engine/wasm/WasmRegistry.h).
    /// Only on the message thread, like every other use of the registry.
    static Registry& instance();

    const ModuleSpec* find(const std::string& type) const noexcept;
    /// The node type of a port plugin, e.g. PortKind::MidiIn → "midi-in".
    const ModuleSpec* forPort(PortKind kind) const noexcept;
    const std::vector<const ModuleSpec*>& all() const noexcept { return order_; }
    /// Creates the DSP for a node type; null for structural types.
    std::unique_ptr<Module> create(const std::string& type) const;

    /// Adds a node type. One whose id is already there is **replaced** for everything that looks it up from now on (a new
    /// version of an installed module); the old spec stays alive, because nodes that run with it hold a reference.
    void add(ModuleSpec spec, Factory factory);

private:
    Registry();
    struct Entry {
        std::unique_ptr<ModuleSpec> spec;
        Factory factory;
    };
    std::vector<Entry> entries_;
    std::vector<const ModuleSpec*> order_;
};

/// Modules added after the first set register themselves, so a new module
/// touches no shared file: put `BLEEP_REGISTER_MODULE(registerFooModule);`
/// after the function in FooModule.cpp. Registry() calls them in name order.
using RegisterFn = void (*)(Registry&);
struct AutoRegister {
    AutoRegister(const char* name, RegisterFn fn);
};
#define BLEEP_REGISTER_MODULE(fn) static const ::bleep::engine::AutoRegister bleepAutoRegister_##fn(#fn, fn)

// Registration functions, one per source file (called by Registry()).
void registerFunctionModule(Registry&);
void registerLfoModule(Registry&);
void registerRandomModule(Registry&);
void registerUtilityModule(Registry&);
void registerFilterModule(Registry&);
void registerOscillatorModule(Registry&);
void registerAdsrModule(Registry&);
void registerVcaModule(Registry&);
void registerCvToNotesModule(Registry&);
void registerStepSequencerModule(Registry&);
void registerDrumGridModule(Registry&);
void registerNoiseModule(Registry&);
void registerRingDrumsModules(Registry&);
void registerPunchDrumsModules(Registry&);
void registerAttenuverterModule(Registry&);
void registerCvMixerModule(Registry&);
void registerAudioMixerModule(Registry&);
void registerMultiplierModule(Registry&);
void registerCrossfaderModule(Registry&);
void registerLogicModule(Registry&);
void registerQuantizerModule(Registry&);
void registerSwitchModule(Registry&);
void registerNotesToCvModule(Registry&);
void registerDialModule(Registry&);
void registerButtonModule(Registry&);
void registerKeyboardModule(Registry&);
void registerLevelMeterModule(Registry&);
void registerPortModules(Registry&);

}  // namespace bleep::engine
