// SPDX-License-Identifier: MIT
#include "Registry.h"

#include <algorithm>

namespace bleep::engine {

namespace {
std::vector<std::pair<std::string, RegisterFn>>& autoRegistered() {
    static std::vector<std::pair<std::string, RegisterFn>> list;
    return list;
}
}  // namespace

AutoRegister::AutoRegister(const char* name, RegisterFn fn) { autoRegistered().emplace_back(name, fn); }

Registry& Registry::instance() {
    static Registry registry;
    return registry;
}

const Registry& Registry::get() { return instance(); }

Registry::Registry() {
#ifndef BLEEP_NO_BUNDLED_MODULES  // the apps and plugins get their modules from the Bleep Store (CMake: BLEEP_PATCH_BUNDLE_MODULES)
    registerOscillatorModule(*this);
    registerNoiseModule(*this);
    registerFunctionModule(*this);
    registerLfoModule(*this);
    registerRandomModule(*this);
    registerAdsrModule(*this);
    registerFilterModule(*this);
    registerVcaModule(*this);
    registerUtilityModule(*this);
    registerCvToNotesModule(*this);
    registerNotesToCvModule(*this);
    registerAttenuverterModule(*this);
    registerCvMixerModule(*this);
    registerMultiplierModule(*this);
    registerLogicModule(*this);
    registerQuantizerModule(*this);
    registerSwitchModule(*this);
    registerAudioMixerModule(*this);
    registerCrossfaderModule(*this);
    registerLevelMeterModule(*this);
    registerDialModule(*this);
    registerButtonModule(*this);
    registerKeyboardModule(*this);
    registerStepSequencerModule(*this);
    registerDrumGridModule(*this);
    registerRingDrumsModules(*this);
    registerPunchDrumsModules(*this);
#endif
    {
        auto list = autoRegistered();
        std::sort(list.begin(), list.end());
        for (const auto& [name, fn] : list) fn(*this);
    }
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
    in.userCreatable = true;  // inside a cell, as many as you like (the UI offers them there only)
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
    const auto old = std::find_if(order_.begin(), order_.end(), [&](const ModuleSpec* s) { return s->type == e.spec->type; });
    if (old != order_.end()) *old = e.spec.get();  // a new version takes the old one's place in the lists
    else order_.push_back(e.spec.get());
    entries_.push_back(std::move(e));
}

const ModuleSpec* Registry::find(const std::string& type) const noexcept {
    for (auto it = entries_.rbegin(); it != entries_.rend(); ++it)  // the newest first: a replaced type is found as its new version
        if (it->spec->type == type) return it->spec.get();
    return nullptr;
}

const ModuleSpec* Registry::forPort(PortKind kind) const noexcept {
    if (kind == PortKind::None) return nullptr;
    for (const auto& e : entries_)
        if (e.spec->port == kind) return e.spec.get();
    return nullptr;
}

std::unique_ptr<Module> Registry::create(const std::string& type) const {
    for (auto it = entries_.rbegin(); it != entries_.rend(); ++it)
        if (it->spec->type == type) return it->factory ? it->factory(*it->spec) : nullptr;
    return nullptr;
}

}  // namespace bleep::engine
