// SPDX-License-Identifier: GPL-3.0-only
// Patch Bay In (doc/specs/modules/patchbay.md): a pass-through the engine never runs. The board compiler (Program::compile)
// replaces every chain through a bundle cable by plain cables; the channels (c1, c2 …) live in the cables, not in the spec.
#include "Registry.h"

namespace bleep::engine {
namespace {

class PatchbayInModule final : public Module {
public:
    using Module::Module;
    void process(const ProcessContext&) override {}
};

}  // namespace

static void registerPatchbayInModule(Registry& r) {
    ModuleSpec s;
    s.type = "patchbay-in";
    s.name = "Patch Bay In";
    s.category = "Utility/Logic & Routing";
    s.colour = "#a78bfa";
    s.description = "Collects signals into one bundle cable: every input you patch adds a channel, and a free one is always left.";
    s.inputs = {};
    s.outputs = {{"bundle", "Bundle", Signal::Patchbay, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<PatchbayInModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerPatchbayInModule);

}  // namespace bleep::engine
