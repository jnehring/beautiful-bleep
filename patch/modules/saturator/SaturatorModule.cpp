// SPDX-License-Identifier: GPL-3.0-or-later
// Saturator node (doc/saturator.md): organic, anti-aliased saturation, stereo.
#include "Registry.h"
#include "SaturatorDsp.h"

namespace bleep::engine {
namespace {

using patch::SaturatorDsp;
using patch::SaturatorParams;

class SaturatorModule final : public Module {
public:
    enum { Drive, Bias, Color, Sag, Age, Tone, Level, Mix, Character, Quality };
    enum { InL, InR };
    enum { OutL, OutR };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_[0].prepare(sampleRate, 0x9e3779b9u);  // a different drift on each side
        dsp_[1].prepare(sampleRate, 0x7f4a7c15u);
    }
    void reset() override {
        dsp_[0].reset();
        dsp_[1].reset();
    }

    void process(const ProcessContext& c) override {
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        SaturatorParams p;
        p.character = (int)setting(Character);
        p.quality = (int)setting(Quality);
        for (int i = 0; i < c.numSamples; ++i) {
            p.drive = value(c, Drive, i);
            p.bias = value(c, Bias, i);
            p.color = value(c, Color, i);
            p.sag = value(c, Sag, i);
            p.age = value(c, Age, i);
            p.toneHz = value(c, Tone, i);
            p.level = value(c, Level, i);
            p.mix = value(c, Mix, i);
            const float in[2] = {c.inputs[InL][i], inR[i]};
            for (int ch = 0; ch < 2; ++ch) c.outputs[ch][i] = dsp_[ch].tick(in[ch], p);
        }
    }

private:
    SaturatorDsp dsp_[2];
};

}  // namespace

static void registerSaturatorModule(Registry& r) {
    ModuleSpec s;
    s.type = "saturator";
    s.name = "Saturator";
    s.category = "Effects/Distortion";
    s.colour = "#f59e0b";
    s.description = "Warm, organic saturation without the digital edge: tube, tape or diode curves, "
                    "a frequency-dependent drive, power-supply sag and slow drift.";
    s.params = {ParamSpec::percent("drive", "Drive", 0.0f, 1.0f, 0.4f),
                ParamSpec::percent("bias", "Bias", -1.0f, 1.0f, 0.0f),
                ParamSpec::percent("color", "Color", -1.0f, 1.0f, 0.0f),
                ParamSpec::percent("sag", "Sag", 0.0f, 1.0f, 0.3f),
                ParamSpec::percent("age", "Age", 0.0f, 1.0f, 0.2f),
                ParamSpec::exponential("tone", "Tone", 500.0f, 20000.0f, 20000.0f, "Hz"),
                ParamSpec::number("level", "Level", 0.0f, 2.0f, 1.0f, "", 2),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
                ParamSpec::choice("character", "Character", {"Tube", "Tape", "Diode"}, 0),
                ParamSpec::choice("quality", "Quality", {"Eco (2×)", "Normal (4×)"}, 1)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SaturatorModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerSaturatorModule);

}  // namespace bleep::engine
