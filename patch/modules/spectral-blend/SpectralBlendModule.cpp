// SPDX-License-Identifier: GPL-3.0-or-later
// Spectral Blend node (doc/specs/modules/spectral-blend.md): two audio inputs
// cross-synthesised in the frequency domain, magnitude from one and phase from the
// other or any morph between, with a tilt across the spectrum, blur, a three-region
// spectral gate, smear and freeze.
#include "Registry.h"
#include "SpectralBlendDsp.h"

#include <algorithm>
#include <cmath>

namespace bleep::engine {
namespace {

class SpectralBlendModule final : public Module {
public:
    enum { Magnitude, Phase, Tilt, Pivot, Blur, Smear, GateLow, GateMid, GateHigh, SplitLow, SplitHigh, InvertGate, Freeze,
           Size, Law, Mix, Level };
    enum { InA, InB, FreezeIn };
    enum { Out };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        dsp_.setSize(patch::SpectralBlendDsp::sizeFor((int)setting(Size)));
        patch::SpectralBlendParams p;
        p.geometric = setting(Law) > 0.5f;
        p.invertGate = setting(InvertGate) > 0.5f;
        const bool frozenKnob = setting(Freeze) > 0.5f;
        p.splitHz[0] = value(c, SplitLow, 0);
        p.splitHz[1] = std::max(value(c, SplitHigh, 0), p.splitHz[0]);
        // the spectral controls are read once per chunk: a frame is made only every hop
        p.magnitude = value(c, Magnitude, 0);
        p.phase = value(c, Phase, 0);
        p.tilt = value(c, Tilt, 0);
        p.pivotHz = value(c, Pivot, 0);
        p.blur = value(c, Blur, 0);
        p.smear = value(c, Smear, 0);
        p.gateDb[0] = value(c, GateLow, 0);
        p.gateDb[1] = value(c, GateMid, 0);
        p.gateDb[2] = value(c, GateHigh, 0);
        p.mix = value(c, Mix, 0);
        const float gain = std::pow(10.0f, value(c, Level, 0) / 20.0f);
        for (int i = 0; i < c.numSamples; ++i) {
            level_ += 0.01f * (gain - level_);
            p.level = level_;
            p.freeze = frozenKnob || c.inputs[FreezeIn][i] > 0.5f;
            c.outputs[Out][i] = dsp_.tick(c.inputs[InA][i], c.inputs[InB][i], p);
        }
    }

private:
    patch::SpectralBlendDsp dsp_;
    float level_ = 1.0f;
};

}  // namespace

static void registerSpectralBlendModule(Registry& r) {
    ModuleSpec s;
    s.type = "spectral-blend";
    s.name = "Spectral Blend";
    s.category = "Audio/Mangling";
    s.colour = "#818cf8";
    s.description = "Cross-synthesis of two sounds in the frequency domain: the magnitudes of one with the phases of the "
                    "other, or any morph between, bent across the spectrum by Tilt, with blur, a spectral gate and freeze.";
    s.params = {ParamSpec::percent("magnitude", "Magnitude", 0.0f, 1.0f, 0.0f).inGroup("Blend"),
                ParamSpec::percent("phase", "Phase", 0.0f, 1.0f, 1.0f).inGroup("Blend"),
                ParamSpec::number("tilt", "Tilt", -1.0f, 1.0f, 0.0f, "", 2).inGroup("Blend"),
                ParamSpec::hertz("pivot", "Pivot", 100.0f, 8000.0f, 1000.0f).inGroup("Blend"),
                ParamSpec::percent("blur", "Blur", 0.0f, 1.0f, 0.0f).inGroup("Shape"),
                ParamSpec::percent("smear", "Smear", 0.0f, 1.0f, 0.0f).inGroup("Shape"),
                ParamSpec::number("gatelow", "Gate Low", -90.0f, 0.0f, -90.0f, "dB", 0).inGroup("Gate"),
                ParamSpec::number("gatemid", "Gate Mid", -90.0f, 0.0f, -90.0f, "dB", 0).inGroup("Gate"),
                ParamSpec::number("gatehigh", "Gate High", -90.0f, 0.0f, -90.0f, "dB", 0).inGroup("Gate"),
                ParamSpec::hertz("splitlow", "Split Low", 80.0f, 2000.0f, 400.0f).inGroup("Gate"),
                ParamSpec::hertz("splithigh", "Split High", 800.0f, 12000.0f, 3000.0f).inGroup("Gate"),
                ParamSpec::toggle("invertgate", "Invert Gate", false).inGroup("Gate"),
                ParamSpec::toggle("freeze", "Freeze", false).inGroup("Output"),
                ParamSpec::choice("size", "FFT Size", {"512", "1024", "2048", "4096"}, 2).inGroup("Output"),
                ParamSpec::choice("law", "Morph Law", {"Linear", "Geometric"}, 0).inGroup("Blend"),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f).inGroup("Output"),
                ParamSpec::number("level", "Level", -24.0f, 12.0f, 0.0f, "dB", 1).inGroup("Output")};
    s.inputs = {{"a", "In A", Signal::Audio}, JackSpec{"b", "In B", Signal::Audio}.normalledTo("a"), {"freezegate", "Freeze", Signal::Gate}};
    s.outputs = {{"out", "Out", Signal::Audio, true}};
    s.memoryHeavy = false;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SpectralBlendModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerSpectralBlendModule);

}  // namespace bleep::engine
