// SPDX-License-Identifier: GPL-3.0-or-later
// VCA node: stereo amplifier. Gain starts at 0, so an envelope patched into
// the Gain knob opens it fully (the modulation offset, spec §5.6).
// The Gain knob runs 0 – 400 % (+12 dB of make-up gain at the top).
#include "Registry.h"

#include <algorithm>
#include <cmath>

namespace bleep::engine {
namespace {

class VcaModule final : public Module {
public:
    enum { Gain, Response };
    enum { InL, InR };
    enum { OutL, OutR };

    using Module::Module;

    void process(const ProcessContext& c) override {
        const bool exponential = setting(Response) >= 0.5f;
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        for (int i = 0; i < c.numSamples; ++i) {
            float g = value(c, Gain, i);                 // 0..4 (0 – 400 %)
            if (exponential && g < 1.0f) g = g * g * g;   // ≈ −60 dB … 0 dB, musical fades; linear above unity
            c.outputs[OutL][i] = c.inputs[InL][i] * g;
            c.outputs[OutR][i] = inR[i] * g;
        }
    }
};

}  // namespace

void registerVcaModule(Registry& r) {
    ModuleSpec s;
    s.type = "vca";
    s.name = "VCA";
    s.category = "Audio/Mixing";
    s.colour = "#fb7185";
    s.description = "Stereo amplifier. Patch an envelope into Gain; Gain starts at 0 and goes up to 400 %.";
    s.params = {ParamSpec::percent("gain", "Gain", 0.0f, 4.0f, 0.0f),
                ParamSpec::choice("response", "Response", {"Linear", "Exponential"}, 1)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<VcaModule>(spec); });
}

}  // namespace bleep::engine
