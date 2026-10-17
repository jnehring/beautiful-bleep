// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// DrumModule.h — turns a drum voice (modules/*-drums/dsp) into a node. Every
// drum node has the same outside:
//
//   inputs   one or more trigger jacks (a rising edge plays the voice), then
//            Velocity (sampled at the trigger; unpatched = full velocity)
//   output   Out (audio, mono)
//   knobs    the voice's own, then Level (always last)
//
// A voice provides prepare(sr), reset(), trigger(input, velocity) and
// tick(const Params&) → sample.
#pragma once

#include "Registry.h"
#include "dsp/Smoothing.h"

#include <algorithm>
#include <array>

namespace bleep::engine {

template <class Voice, int Triggers = 1>
class DrumModule final : public Module {
public:
    using Params = typename Voice::Params;
    /// Reads the voice's knobs at sample i.
    using Reader = Params (*)(const Module&, const ProcessContext&, int);

    DrumModule(const ModuleSpec& spec, Reader read) : Module(spec), read_(read) {}

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        voice_.prepare(sampleRate);
    }
    void reset() override {
        voice_.reset();
        for (auto& e : edges_) e.reset();
    }

    void process(const ProcessContext& c) override {
        constexpr int velocity = Triggers;
        const int level = (int)spec().params.size() - 1;
        for (int i = 0; i < c.numSamples; ++i) {
            for (int t = 0; t < Triggers; ++t)
                if (edges_[(size_t)t].process(c.inputs[t][i]) > 0)
                    voice_.trigger(t, c.inputConnected[velocity] ? std::clamp(c.inputs[velocity][i], 0.0f, 1.0f) : 1.0f);
            c.outputs[0][i] = voice_.tick(read_(*this, c, i)) * value(c, level, i);
        }
    }

private:
    Voice voice_;
    Reader read_;
    std::array<dsp::GateEdge, Triggers> edges_;
};

/// The common outside of a drum node: `params` gets Level appended. The
/// category is Drums/<kit>, so each kit gets its own submenu (Module › Drums › kit).
inline ModuleSpec drumSpec(const char* kit, const char* type, const char* name, const char* colour, const char* description,
                           std::vector<ParamSpec> params, std::vector<JackSpec> triggers = {{"trig", "Trig", Signal::Trigger}}) {
    ModuleSpec s;
    s.type = type;
    s.name = name;
    s.category = std::string("Drums/") + kit;
    s.colour = colour;
    s.description = description;
    params.push_back(ParamSpec::percent("level", "Level", 0.0f, 1.0f, 0.8f));
    s.params = std::move(params);
    s.inputs = std::move(triggers);
    s.inputs.push_back({"velocity", "Velocity", Signal::Control});
    s.outputs = {{"out", "Out", Signal::Audio, true}};
    return s;
}

template <class Voice, int Triggers = 1>
void addDrum(Registry& r, ModuleSpec spec, typename DrumModule<Voice, Triggers>::Reader read) {
    r.add(std::move(spec), [read](const ModuleSpec& s) { return std::make_unique<DrumModule<Voice, Triggers>>(s, read); });
}

}  // namespace bleep::engine
