// SPDX-License-Identifier: MIT
// Filter node: stereo ZDF state-variable filter. Every control is a
// destination; cutoff modulation works in octaves and may run at audio rate.
#include "FilterDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

using patch::FilterDsp;
using patch::FilterParams;

class FilterModule final : public Module {
public:
    enum { Cutoff, Resonance, Drive, Morph, Mix, KeyTrack, Type };
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
    s.description = "Stereo multimode filter with several algorithms (Type): LP/BP/HP/notch morph, drive, key tracking, envelope out.";
    ParamSpec mode = ParamSpec::number("mode", "Mode", 0.0f, 1.0f, 0.0f);
    mode.format = ParamSpec::Format::FilterMode;
    s.params = {ParamSpec::hertz("cutoff", "Cutoff", 20.0f, 20000.0f, 2000.0f),
                ParamSpec::percent("resonance", "Resonance", 0.0f, 1.0f, 0.2f),
                ParamSpec::percent("drive", "Drive", 0.0f, 1.0f, 0.0f),
                mode,
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("keytrack", "Key Track", 0.0f, 1.0f, 0.0f),
                ParamSpec::choice("type", "Type", {"Clean", "Rough"}, 0)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}, {"pitch", "Pitch", Signal::Pitch}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true},
                 {"env", "Env", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<FilterModule>(spec); });
}

}  // namespace bleep::engine
