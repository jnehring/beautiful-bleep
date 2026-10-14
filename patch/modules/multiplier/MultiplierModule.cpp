// SPDX-License-Identifier: MIT
// Multiplier node (doc/specs/modules/multiplier.md): two four-quadrant
// multipliers with bias, chained, optionally oversampled.
#include "MultiplierDsp.h"
#include "Registry.h"

#include <algorithm>

namespace bleep::engine {
namespace {

class MultiplierModule final : public Module {
public:
    enum { BiasX1, BiasY1, Gain1, BiasX2, BiasY2, Gain2, Oversampling };
    enum { X1, Y1, X2, Y2 };
    enum { Out1, Out2 };

    using Module::Module;

    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        static constexpr int factors[] = {1, 2, 4};
        const int factor = factors[std::clamp((int)setting(Oversampling), 0, 2)];
        if (factor != factor_) {
            dsp_.reset();
            factor_ = factor;
        }
        patch::MultiplierInputs in;
        in.x2Patched = c.inputConnected[X2];
        const bool y1 = c.inputConnected[Y1], y2 = c.inputConnected[Y2];
        patch::MultiplierSection s1, s2;
        for (int i = 0; i < c.numSamples; ++i) {
            in.x1 = c.inputs[X1][i];
            in.y1 = y1 ? c.inputs[Y1][i] : 1.0f;
            in.x2 = c.inputs[X2][i];
            in.y2 = y2 ? c.inputs[Y2][i] : 1.0f;
            s1 = {value(c, BiasX1, i), value(c, BiasY1, i), value(c, Gain1, i)};
            s2 = {value(c, BiasX2, i), value(c, BiasY2, i), value(c, Gain2, i)};
            dsp_.tick(in, s1, s2, factor, c.outputs[Out1][i], c.outputs[Out2][i]);
        }
    }

private:
    patch::MultiplierDsp dsp_;
    int factor_ = 1;
};

}  // namespace

void registerMultiplierModule(Registry& r) {
    ModuleSpec s;
    s.type = "multiplier";
    s.name = "Multiplier";
    s.category = "Utility/Signal";
    s.colour = "#c4b5fd";
    s.description = "Two four-quadrant multipliers: ring modulation, or one modulator scaling another.";
    s.params = {ParamSpec::number("biasx1", "Bias X1", -1.0f, 1.0f, 0.0f),
                ParamSpec::number("biasy1", "Bias Y1", -1.0f, 1.0f, 0.0f),
                ParamSpec::number("gain1", "Gain 1", -2.0f, 2.0f, 1.0f),
                ParamSpec::number("biasx2", "Bias X2", -1.0f, 1.0f, 0.0f),
                ParamSpec::number("biasy2", "Bias Y2", -1.0f, 1.0f, 0.0f),
                ParamSpec::number("gain2", "Gain 2", -2.0f, 2.0f, 1.0f),
                ParamSpec::choice("oversampling", "Oversampling", {"Off", "2x", "4x"}, 0)};
    s.inputs = {{"x1", "X1", Signal::Control}, {"y1", "Y1", Signal::Control},
                {"x2", "X2", Signal::Control}, {"y2", "Y2", Signal::Control}};
    s.outputs = {{"out1", "Out 1", Signal::Control, true}, {"out2", "Out 2", Signal::Control, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<MultiplierModule>(spec); });
}

}  // namespace bleep::engine
