// SPDX-License-Identifier: MIT
// ADSR node: attack, decay, sustain, release with velocity and retrigger.
#include "AdsrDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

using patch::AdsrDsp;
using patch::AdsrParams;

class AdsrModule final : public Module {
public:
    enum { Attack, Decay, Sustain, Release, Velocity };
    enum { Gate, Retrigger, VelocityIn };
    enum { Env, End, Active };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        AdsrParams p;
        const bool velocityPatched = c.inputConnected[VelocityIn];
        for (int i = 0; i < c.numSamples; ++i) {
            p.attack = value(c, Attack, i);
            p.decay = value(c, Decay, i);
            p.sustain = value(c, Sustain, i);
            p.release = value(c, Release, i);
            p.velocityAmount = value(c, Velocity, i);
            const auto f = dsp_.tick(p, c.inputs[Gate][i], c.inputs[Retrigger][i],
                                     velocityPatched ? c.inputs[VelocityIn][i] : 1.0f);
            c.outputs[Env][i] = f.env;
            c.outputs[End][i] = f.end;
            c.outputs[Active][i] = f.active;
        }
    }

private:
    AdsrDsp dsp_;
};

}  // namespace

void registerAdsrModule(Registry& r) {
    ModuleSpec s;
    s.type = "adsr";
    s.name = "ADSR";
    s.category = "Modulation/Envelopes";
    s.colour = "#fbbf24";
    s.description = "Attack, decay, sustain, release. Active stays high while the envelope runs: patch it into a Voice Cell's Voice Out.";
    s.params = {ParamSpec::seconds("attack", "Attack", 0.001f, 10.0f, 0.2f, 0.005f),
                ParamSpec::seconds("decay", "Decay", 0.001f, 10.0f, 0.4f, 0.3f),
                ParamSpec::percent("sustain", "Sustain", 0.0f, 1.0f, 0.7f),
                ParamSpec::seconds("release", "Release", 0.001f, 20.0f, 0.6f, 0.4f),
                ParamSpec::percent("velamount", "Vel Amount", 0.0f, 1.0f, 0.5f)};
    s.inputs = {{"gate", "Gate", Signal::Gate}, {"retrig", "Retrigger", Signal::Trigger},
                {"velocity", "Velocity", Signal::Control}};
    s.outputs = {{"env", "Env", Signal::Control, false}, {"end", "End", Signal::Trigger, false},
                 {"active", "Active", Signal::Gate, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<AdsrModule>(spec); });
}

}  // namespace bleep::engine
