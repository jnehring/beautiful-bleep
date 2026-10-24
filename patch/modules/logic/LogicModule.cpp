// SPDX-License-Identifier: GPL-3.0-only
// Logic node (doc/specs/modules/logic.md): boolean gates, a flip-flop and edge
// triggers for gates and triggers.
#include "LogicDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

class LogicModule final : public Module {
public:
    enum { Threshold, Hysteresis, FlipSource };
    enum { A, B, C, Flip, Reset };
    enum { And, Or, Xor, Nand, Nor, NotA, FF, Rise, Fall, Change };

    using Module::Module;

    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        patch::LogicParams p;
        p.flipFromA = setting(FlipSource) >= 0.5f;
        p.cPatched = c.inputConnected[C];
        patch::LogicInputs in;
        patch::LogicFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.threshold = value(c, Threshold, i);
            p.hysteresis = value(c, Hysteresis, i);
            in = {c.inputs[A][i], c.inputs[B][i], c.inputs[C][i], c.inputs[Flip][i], c.inputs[Reset][i]};
            dsp_.tick(in, p, f);
            c.outputs[And][i] = f.andOut;
            c.outputs[Or][i] = f.orOut;
            c.outputs[Xor][i] = f.xorOut;
            c.outputs[Nand][i] = f.nandOut;
            c.outputs[Nor][i] = f.norOut;
            c.outputs[NotA][i] = f.notA;
            c.outputs[FF][i] = f.ff;
            c.outputs[Rise][i] = f.rise;
            c.outputs[Fall][i] = f.fall;
            c.outputs[Change][i] = f.change;
        }
    }

private:
    patch::LogicDsp dsp_;
};

}  // namespace

void registerLogicModule(Registry& r) {
    ModuleSpec s;
    s.type = "logic";
    s.name = "Logic";
    s.category = "Utility/Logic & Routing";
    s.colour = "#86efac";
    s.description = "AND, OR, XOR and friends for gates, plus a flip-flop and edge triggers.";
    s.params = {ParamSpec::number("threshold", "Threshold", -1.0f, 1.0f, 0.5f),
                ParamSpec::number("hysteresis", "Hysteresis", 0.0f, 0.5f, 0.02f),
                ParamSpec::choice("flipsource", "Flip Source", {"Flip Jack", "A Rising Edge"}, 0)};
    s.inputs = {{"a", "A", Signal::Gate}, {"b", "B", Signal::Gate}, {"c", "C", Signal::Gate},
                {"flip", "Flip", Signal::Trigger}, {"reset", "Reset", Signal::Trigger}};
    s.outputs = {{"and", "AND", Signal::Gate, false},     {"or", "OR", Signal::Gate, false},
                 {"xor", "XOR", Signal::Gate, false},     {"nand", "NAND", Signal::Gate, false},
                 {"nor", "NOR", Signal::Gate, false},     {"nota", "NOT A", Signal::Gate, false},
                 {"ff", "FF", Signal::Gate, false},       {"rise", "Rise", Signal::Trigger, false},
                 {"fall", "Fall", Signal::Trigger, false}, {"change", "Change", Signal::Trigger, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<LogicModule>(spec); });
}

}  // namespace bleep::engine
