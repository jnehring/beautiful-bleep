// SPDX-License-Identifier: GPL-3.0-only
// Attenuverter node (doc/specs/modules/attenuverter.md): one scale and offset
// shared by two inputs; an unpatched input is a manual constant.
#include "AttenuverterDsp.h"
#include "Registry.h"

#include <string>

namespace bleep::engine {
namespace {

class AttenuverterModule final : public Module {
public:
    enum { Scale, Offset, Clip };

    using Module::Module;

    void process(const ProcessContext& c) override {
        const int clip = (int)setting(Clip);
        for (int i = 0; i < c.numSamples; ++i) {
            const float scale = value(c, Scale, i), offset = value(c, Offset, i);
            for (int r = 0; r < 2; ++r) {
                const float in = c.inputConnected[r] ? c.inputs[r][i] : 1.0f;
                c.outputs[r][i] = patch::attenuverterTick(in, scale, offset, clip);
            }
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
    s.description = "One scale and offset for two signals; unpatched, a manual constant.";
    s.params.push_back(ParamSpec::number("scale", "Scale", -2.0f, 2.0f, 1.0f));
    s.params.push_back(ParamSpec::number("offset", "Offset", -1.0f, 1.0f, 0.0f));
    s.params.push_back(ParamSpec::choice("clip", "Clip", {"Off", "Soft", "Hard"}, 0));
    for (const char* n : {"1", "2"}) {
        s.inputs.push_back({std::string("in") + n, std::string("In ") + n, Signal::Control});
        s.outputs.push_back({std::string("out") + n, std::string("Out ") + n, Signal::Control, true});
    }
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<AttenuverterModule>(spec); });
}

}  // namespace bleep::engine
