// SPDX-License-Identifier: MIT
// Dial node (doc/specs/modules/dial.md): one big knob, scaled to a range, as a
// control signal.
#include "DialDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

class DialModule final : public Module {
public:
    enum { Value, Min, Max, Smooth, Steps };
    enum { Out };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        patch::DialParams p;
        p.steps = (int)setting(Steps);
        for (int i = 0; i < c.numSamples; ++i) {
            p.value = value(c, Value, i);
            p.min = value(c, Min, i);
            p.max = value(c, Max, i);
            p.smooth = value(c, Smooth, i);
            c.outputs[Out][i] = dsp_.tick(p);
        }
    }

private:
    patch::DialDsp dsp_;
};

}  // namespace

void registerDialModule(Registry& r) {
    ModuleSpec s;
    s.type = "dial";
    s.name = "Dial";
    s.category = "Controllers/Panel";
    s.colour = "#fda4af";
    s.description = "One big knob as a control signal, scaled to a range, smooth or in steps.";
    s.params = {ParamSpec::percent("value", "Value", 0.0f, 1.0f, 0.5f),
                ParamSpec::number("min", "Min", -1.0f, 1.0f, 0.0f),
                ParamSpec::number("max", "Max", -1.0f, 1.0f, 1.0f),
                ParamSpec::seconds("smooth", "Smooth", 0.0f, 2.0f, 0.2f, 0.02f),
                ParamSpec::integer("steps", "Steps", 0, 24, 0)};
    s.outputs = {{"out", "Out", Signal::Control, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<DialModule>(spec); });
}

}  // namespace bleep::engine
