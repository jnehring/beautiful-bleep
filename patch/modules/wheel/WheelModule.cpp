// SPDX-License-Identifier: GPL-3.0-or-later
// Wheel node (doc/specs/modules/wheel.md): a pitch or mod wheel as a control
// signal.
#include "Registry.h"
#include "WheelDsp.h"

namespace bleep::engine {
namespace {

class WheelModule final : public Module {
public:
    enum { Value, Min, Max, Smooth, Spring };
    enum { Out };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        patch::WheelParams p;
        for (int i = 0; i < c.numSamples; ++i) {
            p.value = value(c, Value, i);
            p.min = value(c, Min, i);
            p.max = value(c, Max, i);
            p.smooth = value(c, Smooth, i);
            c.outputs[Out][i] = dsp_.tick(p);
        }
    }

private:
    patch::WheelDsp dsp_;
};

}  // namespace

static void registerWheelModule(Registry& r) {
    ModuleSpec s;
    s.type = "wheel";
    s.name = "Wheel";
    s.category = "Controllers/Performance";
    s.colour = "#fda4af";
    s.description = "A pitch or mod wheel as a control signal; springs back to the middle.";
    s.params = {ParamSpec::percent("value", "Value", 0.0f, 1.0f, 0.5f),
                ParamSpec::number("min", "Min", -1.0f, 1.0f, -1.0f),
                ParamSpec::number("max", "Max", -1.0f, 1.0f, 1.0f),
                ParamSpec::seconds("smooth", "Smooth", 0.0f, 2.0f, 0.2f, 0.02f),
                ParamSpec::toggle("spring", "Spring", true)};
    s.outputs = {{"out", "Out", Signal::Control, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<WheelModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerWheelModule);

}  // namespace bleep::engine
