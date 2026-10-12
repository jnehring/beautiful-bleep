// SPDX-License-Identifier: MIT
// XY Pad node (doc/specs/modules/xy-pad.md): two control signals from one
// point on a pad.
#include "Registry.h"
#include "XyPadDsp.h"

namespace bleep::engine {
namespace {

class XyPadModule final : public Module {
public:
    enum { X, Y, Min, Max, Smooth };
    enum { OutX, OutY };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        patch::XyPadParams p;
        for (int i = 0; i < c.numSamples; ++i) {
            p.x = value(c, X, i);
            p.y = value(c, Y, i);
            p.min = value(c, Min, i);
            p.max = value(c, Max, i);
            p.smooth = value(c, Smooth, i);
            dsp_.tick(p, c.outputs[OutX][i], c.outputs[OutY][i]);
        }
    }

private:
    patch::XyPadDsp dsp_;
};

}  // namespace

static void registerXyPadModule(Registry& r) {
    ModuleSpec s;
    s.type = "xy-pad";
    s.name = "XY Pad";
    s.category = "Controllers";
    s.colour = "#fda4af";
    s.description = "Two control signals from one point on a pad.";
    s.params = {ParamSpec::percent("x", "X", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("y", "Y", 0.0f, 1.0f, 0.5f),
                ParamSpec::number("min", "Min", -1.0f, 1.0f, 0.0f),
                ParamSpec::number("max", "Max", -1.0f, 1.0f, 1.0f),
                ParamSpec::seconds("smooth", "Smooth", 0.0f, 2.0f, 0.2f, 0.02f)};
    s.outputs = {{"x", "X", Signal::Control, true}, {"y", "Y", Signal::Control, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<XyPadModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerXyPadModule);

}  // namespace bleep::engine
