// SPDX-License-Identifier: MIT
// Crossfader node (doc/specs/modules/crossfader.md): stereo A/B blend,
// equal-power or linear.
#include "CrossfaderDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

class CrossfaderModule final : public Module {
public:
    enum { Fade, Curve };
    enum { AL, AR, BL, BR };
    enum { OutL, OutR };

    using Module::Module;

    void process(const ProcessContext& c) override {
        const int curve = (int)setting(Curve);
        const float* ar = c.inputConnected[AR] ? c.inputs[AR] : c.inputs[AL];  // mono → both
        const float* br = c.inputConnected[BR] ? c.inputs[BR] : c.inputs[BL];
        for (int i = 0; i < c.numSamples; ++i) {
            float a, b;
            patch::crossfadeGains(value(c, Fade, i), curve, a, b);
            c.outputs[OutL][i] = a * c.inputs[AL][i] + b * c.inputs[BL][i];
            c.outputs[OutR][i] = a * ar[i] + b * br[i];
        }
    }
};

}  // namespace

void registerCrossfaderModule(Registry& r) {
    ModuleSpec s;
    s.type = "crossfader";
    s.name = "Crossfader";
    s.category = "Audio";
    s.colour = "#fb7185";
    s.description = "Blends two stereo signals with one knob, equal-power or linear.";
    s.params = {ParamSpec::number("fade", "Fade", 0.0f, 1.0f, 0.5f),
                ParamSpec::choice("curve", "Curve", {"Equal Power", "Linear"}, 0)};
    s.inputs = {{"al", "A L", Signal::Audio}, {"ar", "A R", Signal::Audio},
                {"bl", "B L", Signal::Audio}, {"br", "B R", Signal::Audio}};
    s.outputs = {{"outl", "Out L", Signal::Audio, true}, {"outr", "Out R", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<CrossfaderModule>(spec); });
}

}  // namespace bleep::engine
