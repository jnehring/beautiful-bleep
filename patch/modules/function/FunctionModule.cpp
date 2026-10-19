// SPDX-License-Identifier: GPL-3.0-or-later
// Function node: slope generator (LFO / envelope) with four related outputs.
#include "FunctionDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

using patch::FunctionDsp;
using patch::FunctionParams;
using patch::SampleClock;

std::vector<std::string> syncChoices() {
    std::vector<std::string> v;
    for (const char* s : dsp::syncNames()) v.emplace_back(s);
    return v;
}

class FunctionModule final : public Module {
public:
    enum { Rise, Fall, Shape, Spread, Cycle, Sync };
    enum { Trig };
    enum { A, B, C, D, Eoc };

    using Module::Module;

    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        if (c.transportStarted) dsp_.reset();
        FunctionParams p;
        p.cycle = setting(Cycle) >= 0.5f;
        p.sync = (int)setting(Sync);
        SampleClock clk;
        clk.sampleRate = sampleRate_;
        clk.bpm = c.transport->bpm;
        clk.locked = c.transport->playing && c.transport->ppqValid;
        const float* trig = c.inputs[Trig];
        for (int i = 0; i < c.numSamples; ++i) {
            p.rise = value(c, Rise, i);
            p.fall = value(c, Fall, i);
            p.shape = value(c, Shape, i);
            p.spread = value(c, Spread, i);
            clk.ppq = c.ppqAt(i);
            float frame[4];
            dsp_.tick(p, trig[i], clk, frame, c.outputs[Eoc][i]);
            for (int k = 0; k < 4; ++k) c.outputs[A + k][i] = frame[k];
        }
    }

private:
    FunctionDsp dsp_;
};

}  // namespace

void registerFunctionModule(Registry& r) {
    ModuleSpec s;
    s.type = "function";
    s.name = "Function";
    s.category = "Modulation/Slopes";
    s.colour = "#4fd1c5";
    s.description = "Rise/fall slope generator: LFO, envelope or slew, with four related outputs.";
    s.params = {ParamSpec::seconds("rise", "Rise", 0.001f, 10.0f, 0.25f, 0.25f),
                ParamSpec::seconds("fall", "Fall", 0.001f, 10.0f, 0.25f, 0.25f),
                ParamSpec::number("shape", "Shape", -1.0f, 1.0f, 0.0f),
                ParamSpec::percent("spread", "Spread", 0.0f, 1.0f, 0.0f),
                ParamSpec::toggle("cycle", "Cycle", true),
                ParamSpec::choice("sync", "Sync", syncChoices(), 0)};
    s.inputs = {{"trig", "Trig", Signal::Gate}};
    s.outputs = {{"a", "A", Signal::Control, false}, {"b", "B", Signal::Control, false},
                 {"c", "C", Signal::Control, false}, {"d", "D", Signal::Control, false},
                 {"eoc", "EOC", Signal::Trigger, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<FunctionModule>(spec); });
}

}  // namespace bleep::engine
