// SPDX-License-Identifier: MIT
#include "Registry.h"

namespace bleep::engine {

const Registry& Registry::get() {
    static const Registry registry;
    return registry;
}

Registry::Registry() {
    registerOscillatorModule(*this);
    registerFunctionModule(*this);
    registerLfoModule(*this);
    registerRandomModule(*this);
    registerAdsrModule(*this);
    registerFilterModule(*this);
    registerVcaModule(*this);
    registerUtilityModule(*this);
    registerCvToNotesModule(*this);
    registerStepSequencerModule(*this);
    registerPortModules(*this);

    // Cells (spec §8): their jacks live in the board, not in the spec.
    ModuleSpec cell;
    cell.type = kCell;
    cell.name = "Cell";
    cell.category = "Cells";
    cell.colour = "#9aa3b5";
    cell.description = "A group of nodes with its own jacks. Double-click to enter.";
    add(cell, nullptr);
    ModuleSpec in;
    in.type = kCellIn;
    in.name = "Cell In";
    in.category = "Cells";
    in.colour = "#9aa3b5";
    in.userCreatable = false;
    add(in, nullptr);
    ModuleSpec out = in;
    out.type = kCellOut;
    out.name = "Cell Out";
    add(out, nullptr);

    // Voice Cells (spec §8.3). The cell's jacks: Notes, Out L/R, plus its shared jacks.
    ModuleSpec voice;
    voice.type = kVoiceCell;
    voice.name = "Voice Cell";
    voice.category = "Cells";
    voice.colour = "#c084fc";
    voice.description = "Patch one voice inside; the cell plays it once per note, up to 16 voices.";
    voice.params = {ParamSpec::integer("voices", "Voices", 1, 16, 8),
                    ParamSpec::choice("allocation", "Allocation", {"Round robin", "Lowest free", "Reuse same note"}, 0),
                    ParamSpec::choice("stealing", "Stealing", {"Oldest", "Quietest", "Lowest note", "Highest note", "None"}, 0),
                    ParamSpec::choice("mode", "Mode", {"Poly", "Mono", "Legato"}, 0),
                    ParamSpec::seconds("glide", "Glide", 0.0f, 5.0f, 0.2f, 0.0f),
                    ParamSpec::choice("glidemode", "Glide Mode", {"Always", "Legato only"}, 0),
                    ParamSpec::percent("spread", "Stereo Spread", 0.0f, 1.0f, 0.0f),
                    ParamSpec::choice("output", "Output", {"Sum", "Compensated"}, 1)};
    for (auto& p : voice.params) p.modulatable = false;
    voice.inputs = {{"notes", "Notes", Signal::Notes}};
    voice.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}};
    add(voice, nullptr);  // built by the compiler (VoiceCellModule::create)

    ModuleSpec vin;
    vin.type = kVoiceIn;
    vin.name = "Voice In";
    vin.category = "Cells";
    vin.colour = "#c084fc";
    vin.userCreatable = false;
    vin.outputs = {{"pitch", "Pitch", Signal::Pitch, true},      {"gate", "Gate", Signal::Gate, false},
                   {"trigger", "Trigger", Signal::Trigger, false}, {"velocity", "Velocity", Signal::Control, false},
                   {"release", "Release", Signal::Control, false}, {"pressure", "Pressure", Signal::Control, false},
                   {"voice", "Voice #", Signal::Control, false},   {"random", "Random", Signal::Control, true}};
    add(vin, nullptr);
    ModuleSpec vout;
    vout.type = kVoiceOut;
    vout.name = "Voice Out";
    vout.category = "Cells";
    vout.colour = "#c084fc";
    vout.userCreatable = false;
    vout.inputs = {{"l", "Out L", Signal::Audio}, {"r", "Out R", Signal::Audio}, {"active", "Active", Signal::Gate}};
    add(vout, nullptr);
}

void Registry::add(ModuleSpec spec, Factory factory) {
    Entry e{std::make_unique<ModuleSpec>(std::move(spec)), std::move(factory)};
    order_.push_back(e.spec.get());
    entries_.push_back(std::move(e));
}

const ModuleSpec* Registry::find(const std::string& type) const noexcept {
    for (const auto& e : entries_)
        if (e.spec->type == type) return e.spec.get();
    return nullptr;
}

const ModuleSpec* Registry::forPort(PortKind kind) const noexcept {
    if (kind == PortKind::None) return nullptr;
    for (const auto& e : entries_)
        if (e.spec->port == kind) return e.spec.get();
    return nullptr;
}

std::unique_ptr<Module> Registry::create(const std::string& type) const {
    for (const auto& e : entries_)
        if (e.spec->type == type) return e.factory ? e.factory(*e.spec) : nullptr;
    return nullptr;
}

}  // namespace bleep::engine
