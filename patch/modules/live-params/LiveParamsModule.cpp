// SPDX-License-Identifier: GPL-3.0-or-later
// Live Params node: four control inputs for one Bleep Live Link Max for Live device (the one with the same channel),
// which modulates, switches or selects parameters of Ableton Live (or of any plugin in the set). The node only
// publishes its inputs (LiveParamsDsp.h); the bridge sends them to the device, which owns the mapping to Live's parameters.
#include "LiveParamsDsp.h"
#include "Registry.h"

#include <algorithm>
#include <cmath>
#include <string>

namespace bleep::engine {
namespace {

class LiveParamsModule final : public Module {
public:
    enum { Channel };

    using Module::Module;

    ~LiveParamsModule() override { leave(); }

    void reset() override { leave(); }

    void process(const ProcessContext& c) override {
        patch::LiveParamsMailbox& box = patch::liveParams();
        const int ch = std::clamp((int)std::lround(setting(Channel)), 1, patch::kNumChannels);
        if (ch != channel_) {   // the Channel setting moved: the old channel's rows are no longer ours
            leave();
            channel_ = ch;
        }
        for (int r = 0; r < patch::kRowsPerChannel; ++r)
            box.publish((ch - 1) * patch::kRowsPerChannel + r, c.inputConnected[r],
                        c.inputConnected[r] ? c.inputs[r][c.numSamples - 1] : 0.0f);
    }

private:
    void leave() {
        if (channel_ > 0) patch::liveParams().clearChannel(channel_);
        channel_ = 0;
    }

    int channel_ = 0;   ///< the channel whose rows this node publishes (0: none yet)
};

}  // namespace

static void registerLiveParamsModule(Registry& r) {
    ModuleSpec s;
    s.type = "live-params";
    s.name = "Live Params";
    s.category = "Ports";
    s.colour = "#ff9f43";
    s.description = "Modulates, switches and selects parameters of Ableton Live, or of any plugin in the set: four rows, "
                    "matching one Bleep Live Link Max for Live device with the same channel. In the device you pick the "
                    "parameter for each row.";
    s.params = {ParamSpec::integer("channel", "Channel", 1, patch::kNumChannels, 1)};
    for (int r = 1; r <= patch::kRowsPerChannel; ++r)
        s.inputs.push_back({"r" + std::to_string(r), "Row " + std::to_string(r), Signal::Control});
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<LiveParamsModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerLiveParamsModule);

}  // namespace bleep::engine
