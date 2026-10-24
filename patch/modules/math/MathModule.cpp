// SPDX-License-Identifier: GPL-3.0-only
// Math node: two rows, each one operation (add, subtract, multiply, divide, power, min, max) on
// A and B. A patched input replaces its constant knob.
#include "MathDsp.h"
#include "Registry.h"

#include <algorithm>

namespace bleep::engine {
namespace {

class MathModule final : public Module {
public:
    // params per row: Op, A, B (row 2 follows row 1)
    enum { Op1, A1, B1, Op2, A2, B2 };
    enum { InA1, InB1, InA2, InB2 };
    enum { Out1, Out2 };

    using Module::Module;

    void process(const ProcessContext& c) override {
        for (int row = 0; row < 2; ++row) {
            if (!c.outputConnected[row]) continue;  // unread: skip, notably the powf
            const int base = row * 3, jack = row * 2;
            const auto op = (patch::MathOp)std::clamp((int)setting(base), 0, 6);
            const bool pa = c.inputConnected[jack], pb = c.inputConnected[jack + 1];
            for (int i = 0; i < c.numSamples; ++i) {
                const float a = pa ? c.inputs[jack][i] : value(c, base + 1, i);
                const float b = pb ? c.inputs[jack + 1][i] : value(c, base + 2, i);
                c.outputs[row][i] = patch::mathApply(op, a, b);
            }
        }
    }
};

}  // namespace

static void registerMathModule(Registry& r) {
    ModuleSpec s;
    s.type = "math";
    s.name = "Math";
    s.category = "Utility/Signal";
    s.colour = "#fcd34d";
    s.description = "Two rows of arithmetic on signals: add, subtract, multiply, divide, power, min, max.";
    const std::vector<std::string> ops = {"Add", "Subtract", "Multiply", "Divide", "Power", "Min", "Max"};
    s.params = {ParamSpec::choice("op1", "Op 1", ops, 2),
                ParamSpec::number("a1", "A1 Constant", -10.0f, 10.0f, 1.0f),
                ParamSpec::number("b1", "B1 Constant", -10.0f, 10.0f, 1.0f),
                ParamSpec::choice("op2", "Op 2", ops, 0),
                ParamSpec::number("a2", "A2 Constant", -10.0f, 10.0f, 0.0f),
                ParamSpec::number("b2", "B2 Constant", -10.0f, 10.0f, 0.0f)};
    s.inputs = {{"ina1", "A1", Signal::Control}, {"inb1", "B1", Signal::Control},
                {"ina2", "A2", Signal::Control}, {"inb2", "B2", Signal::Control}};
    s.outputs = {{"out1", "Out 1", Signal::Control, true}, {"out2", "Out 2", Signal::Control, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<MathModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerMathModule);

}  // namespace bleep::engine
