// SPDX-License-Identifier: GPL-3.0-only
// Attenuverter node (doc/specs/modules/attenuverter.md): scale and offset;
// an unpatched input makes it a manual constant.
#include "AttenuverterDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

class AttenuverterModule final : public Module {
public:
    enum { Scale, Offset, Clip };

    using Module::Module;

    void process(const ProcessContext& c) override {
        const int clip = (int)setting(Clip);
        for (int i = 0; i < c.numSamples; ++i) {
            const float in = c.inputConnected[0] ? c.inputs[0][i] : 1.0f;
            c.outputs[0][i] = patch::attenuverterTick(in, value(c, Scale, i), value(c, Offset, i), clip);
        }
    }
};

}  // namespace

void registerAttenuverterModule(Registry& r) {
    ModuleSpec s;
    s.type = "attenuverter";
    s.name = "Attenuverter";
    s.category = "Utility/Signal";
    s.colour = "#c4b5fd";
    s.description = "Scale and offset; unpatched, a manual constant.";
    s.params.push_back(ParamSpec::number("scale", "Scale", -2.0f, 2.0f, 1.0f));
    s.params.push_back(ParamSpec::number("offset", "Offset", -1.0f, 1.0f, 0.0f));
    s.params.push_back(ParamSpec::choice("clip", "Clip", {"Off", "Soft", "Hard"}, 0));
    s.inputs.push_back({"in", "In", Signal::Control});
    s.outputs.push_back({"out", "Out", Signal::Control, true});
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<AttenuverterModule>(spec); });
}

}  // namespace bleep::engine
