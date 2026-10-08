// SPDX-License-Identifier: MIT
// Utility node: attenuverter, offset, mixer, shaper, slew and comparator.
#include "Registry.h"
#include "UtilityDsp.h"

namespace bleep::engine {
namespace {

using patch::UtilityDsp;
using patch::UtilityMode;
using patch::UtilityParams;

class UtilityModule final : public Module {
public:
    enum { ScaleX, ScaleY, Offset, Slew, Threshold, Mode };
    enum { X, Y, Clock };
    enum { Out, Gate, Inv };

    using Module::Module;

    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        UtilityParams p;
        p.mode = (UtilityMode)std::clamp((int)setting(Mode), 0, 4);
        for (int i = 0; i < c.numSamples; ++i) {
            p.scaleX = value(c, ScaleX, i);
            p.scaleY = value(c, ScaleY, i);
            p.offset = value(c, Offset, i);
            p.slew = value(c, Slew, i);
            p.threshold = value(c, Threshold, i);
            dsp_.tick(p, c.inputs[X][i], c.inputs[Y][i], c.inputs[Clock][i], sampleRate_, c.outputs[Out][i],
                      c.outputs[Gate][i], c.outputs[Inv][i]);
        }
    }

private:
    UtilityDsp dsp_;
};

}  // namespace

void registerUtilityModule(Registry& r) {
    ModuleSpec s;
    s.type = "utility";
    s.name = "Utility";
    s.category = "Modulation";
    s.colour = "#a78bfa";
    s.description = "The glue: attenuverter, offset, mixer, rectify/fold/quantize, S&H, slew, comparator.";
    s.params = {ParamSpec::number("scalex", "Scale X", -1.0f, 1.0f, 1.0f),
                ParamSpec::number("scaley", "Scale Y", -1.0f, 1.0f, 0.0f),
                ParamSpec::number("offset", "Offset", -1.0f, 1.0f, 0.0f),
                ParamSpec::seconds("slew", "Slew", 0.0f, 5.0f, 0.1f, 0.0f),
                ParamSpec::number("threshold", "Threshold", -1.0f, 1.0f, 0.0f),
                ParamSpec::choice("mode", "Mode", {"Through", "Rectify", "Fold", "Quantize", "Sample & Hold"}, 0)};
    s.inputs = {{"x", "X", Signal::Control}, {"y", "Y", Signal::Control}, {"clock", "Clock", Signal::Gate}};
    s.outputs = {{"out", "Out", Signal::Control, true},
                 {"gate", "Gate", Signal::Gate, false},
                 {"inv", "Inv", Signal::Control, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<UtilityModule>(spec); });
}

}  // namespace bleep::engine
