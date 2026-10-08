// SPDX-License-Identifier: MIT
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
/// Voice Cells (spec §8.3): the cell is a real node; Voice In/Out are structural.
constexpr const char* kVoiceCell = "voice-cell";
constexpr const char* kVoiceIn = "voice-in";
constexpr const char* kVoiceOut = "voice-out";

class Registry {
public:
    using Factory = std::function<std::unique_ptr<Module>(const ModuleSpec&)>;

    static const Registry& get();

    const ModuleSpec* find(const std::string& type) const noexcept;
    /// The node type of a port plugin, e.g. PortKind::MidiIn → "midi-in".
    const ModuleSpec* forPort(PortKind kind) const noexcept;
    const std::vector<const ModuleSpec*>& all() const noexcept { return order_; }
    /// Creates the DSP for a node type; null for structural types.
    std::unique_ptr<Module> create(const std::string& type) const;

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

// Registration functions, one per source file (called by Registry()).
void registerFunctionModule(Registry&);
void registerRandomModule(Registry&);
void registerUtilityModule(Registry&);
void registerFilterModule(Registry&);
void registerOscillatorModule(Registry&);
void registerAdsrModule(Registry&);
void registerVcaModule(Registry&);
void registerCvToNotesModule(Registry&);
void registerStepSequencerModule(Registry&);
void registerPortModules(Registry&);

}  // namespace bleep::engine
