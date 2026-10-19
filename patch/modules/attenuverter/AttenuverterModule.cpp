// SPDX-License-Identifier: GPL-3.0-or-later
// Attenuverter node (doc/specs/modules/attenuverter.md): four rows of scale and
// offset; an unpatched row is a manual constant.
#include "AttenuverterDsp.h"
#include "Registry.h"

#include <string>

namespace bleep::engine {
namespace {

using patch::kAttenuverterRows;

class AttenuverterModule final : public Module {
public:
    // Params: scale n at 2n, offset n at 2n + 1, then Clip.
    enum { Clip = 2 * kAttenuverterRows };
    enum { Sum = kAttenuverterRows };

    using Module::Module;

    void process(const ProcessContext& c) override {
        const int clip = (int)setting(Clip);
        float in[kAttenuverterRows], scale[kAttenuverterRows], offset[kAttenuverterRows];
        patch::AttenuverterFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            for (int r = 0; r < kAttenuverterRows; ++r) {
                in[r] = c.inputConnected[r] ? c.inputs[r][i] : 1.0f;
                scale[r] = value(c, 2 * r, i);
                offset[r] = value(c, 2 * r + 1, i);
            }
            patch::attenuverterTick(in, scale, offset, clip, f);
            for (int r = 0; r < kAttenuverterRows; ++r) c.outputs[r][i] = f.out[r];
            c.outputs[Sum][i] = f.sum;
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
    s.description = "Four rows of scale and offset; unpatched rows are manual constants.";
    for (int k = 1; k <= kAttenuverterRows; ++k) {
        const std::string n = std::to_string(k);
        const std::string ch = "Ch " + n;
        s.params.push_back(ParamSpec::number("scale" + n, "Scale " + n, -2.0f, 2.0f, 1.0f).inGroup(ch));
        s.params.push_back(ParamSpec::number("offset" + n, "Offset " + n, -1.0f, 1.0f, 0.0f).inGroup(ch));
        s.inputs.push_back({"in" + n, "In " + n, Signal::Control});
        s.outputs.push_back({"out" + n, "Out " + n, Signal::Control, true});
    }
    s.groupColumns = true;
    s.params.push_back(ParamSpec::choice("clip", "Clip", {"Off", "Soft", "Hard"}, 0));
    s.outputs.push_back({"sum", "Sum", Signal::Control, true});
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<AttenuverterModule>(spec); });
}

}  // namespace bleep::engine
