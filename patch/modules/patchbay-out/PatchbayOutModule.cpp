// SPDX-License-Identifier: GPL-3.0-only
// Patch Bay Out (doc/specs/modules/patchbay.md): a pass-through the engine never runs. The board compiler (Program::compile)
// replaces every chain through a bundle cable by plain cables; the channels (c1, c2 …) live in the cables, not in the spec.
#include "Registry.h"

namespace bleep::engine {
namespace {

class PatchbayOutModule final : public Module {
public:
    using Module::Module;
    void process(const ProcessContext&) override {}
};

}  // namespace

static void registerPatchbayOutModule(Registry& r) {
    ModuleSpec s;
    s.type = "patchbay-out";
    s.name = "Patch Bay Out";
    s.category = "Utility/Logic & Routing";
    s.colour = "#a78bfa";
    s.description = "Splits a bundle cable back into its channels, named like the signals that go in at the other end.";
    s.inputs = {{"bundle", "Bundle", Signal::Patchbay}};
    s.outputs = {};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<PatchbayOutModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerPatchbayOutModule);

}  // namespace bleep::engine
