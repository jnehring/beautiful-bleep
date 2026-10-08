// SPDX-License-Identifier: MIT
// Filter node: stereo multimode filter with the algorithms of "The Art of VA
// Filter Design" (Type). Every knob is a destination; cutoff modulation works
// in octaves and may run at audio rate.
#include "FilterDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

using patch::FilterDsp;
using patch::FilterParams;

class FilterModule final : public Module {
public:
    enum { Cutoff, Resonance, Drive, Morph, Mix, KeyTrack, Type, Gain };
    enum { InL, InR, Pitch };
    enum { OutL, OutR, Env };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        // A mono source (only L patched) feeds both channels.
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        FilterParams p;
        p.type = (int)setting(Type);
        for (int i = 0; i < c.numSamples; ++i) {
            p.cutoff = c.params[Cutoff][i];  // normalised = octave domain
            p.resonance = value(c, Resonance, i);
            p.drive = value(c, Drive, i);
            p.morph = value(c, Morph, i);
            p.gain = value(c, Gain, i);
            p.mix = value(c, Mix, i);
            p.keyTrack = value(c, KeyTrack, i);
            float frame[2] = {c.inputs[InL][i], inR[i]};
            c.outputs[Env][i] = dsp_.tick(p, c.inputs[Pitch][i], frame, 2);
            c.outputs[OutL][i] = frame[0];
            c.outputs[OutR][i] = frame[1];
        }
    }

private:
    FilterDsp dsp_;
};

}  // namespace

void registerFilterModule(Registry& r) {
    ModuleSpec s;
    s.type = "filter";
    s.name = "Multi Filter";
    s.category = "Audio";
    s.colour = "#f472b6";
    s.description = "Stereo multimode filter: 25 virtual-analog algorithms (SVF, ladders, 1-poles, shelves, phasers, flanger), "
                    "LP/BP/HP/notch morph, drive, key tracking, envelope out.";
    ParamSpec mode = ParamSpec::number("mode", "Mode", 0.0f, 1.0f, 0.0f);
    mode.format = ParamSpec::Format::FilterMode;
    std::vector<std::string> names, groups;
    for (const auto& group : patch::va::typeGroups())
        for (const char* name : group.types) {
            names.emplace_back(name);
            groups.emplace_back(group.name);
        }
    ParamSpec types = ParamSpec::choice("type", "Type", names, 0);
    types.choiceGroups = std::move(groups);
    s.params = {ParamSpec::hertz("cutoff", "Cutoff", 20.0f, 20000.0f, 2000.0f),
                ParamSpec::percent("resonance", "Resonance", 0.0f, 1.0f, 0.2f),
                ParamSpec::percent("drive", "Drive", 0.0f, 1.0f, 0.0f),
                mode,
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("keytrack", "Key Track", 0.0f, 1.0f, 0.0f),
                types,
                ParamSpec::number("gain", "Gain", -24.0f, 24.0f, 0.0f, "dB", 1)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}, {"pitch", "Pitch", Signal::Pitch}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true},
                 {"env", "Env", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<FilterModule>(spec); });
}

}  // namespace bleep::engine
