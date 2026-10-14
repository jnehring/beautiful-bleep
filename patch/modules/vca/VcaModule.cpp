// SPDX-License-Identifier: MIT
// VCA node: stereo amplifier. Gain starts at 0, so an envelope patched into
// the Gain knob opens it fully (the modulation offset, spec §5.6).
// Range scales the result to 200 % or 400 % (the knob and envelopes keep their meaning).
#include "Registry.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::engine {
namespace {

class VcaModule final : public Module {
public:
    enum { Gain, Response, Range };
    enum { InL, InR };
    enum { OutL, OutR };

    using Module::Module;

    void process(const ProcessContext& c) override {
        const bool exponential = setting(Response) >= 0.5f;
        const float range = std::array<float, 3>{1.0f, 2.0f, 4.0f}[(size_t)std::clamp((int)std::lround(setting(Range)), 0, 2)];
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        for (int i = 0; i < c.numSamples; ++i) {
            float g = c.params[Gain][i];                   // 0..1
            if (exponential) g = g * g * g;               // ≈ −60 dB … 0 dB, musical fades
            g *= range;                                   // up to 400 %: +12 dB of make-up gain
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
    s.description = "Stereo amplifier. Patch an envelope into Gain; Gain starts at 0, so the envelope opens it fully.";
    s.params = {ParamSpec::percent("gain", "Gain", 0.0f, 1.0f, 0.0f),
                ParamSpec::choice("response", "Response", {"Linear", "Exponential"}, 1),
                ParamSpec::choice("range", "Range", {"100 %", "200 %", "400 %"}, 0)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<VcaModule>(spec); });
}

}  // namespace bleep::engine
