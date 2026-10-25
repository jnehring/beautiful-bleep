// SPDX-License-Identifier: GPL-3.0-only
// Index node (doc/specs/modules/index.md): a CV, Up/Down triggers, the
// transport or gates become a whole-number step. Out is the step as
// i / (Steps − 1), the position a dropdown, a toggle or a Live Params row
// reads; Index is the raw whole number.
#include "Registry.h"

#include "dsp/IndexStepper.h"
#include "dsp/Tempo.h"

#include <atomic>
#include <cmath>
#include <string>

namespace bleep::engine {
namespace {

using dsp::kMaxIndexGates;

class IndexModule final : public Module {
public:
    // Params.
    enum { Offset = 0, Mode, Steps, Range, Order, Wrap, Rate, Gates, DefaultStep, ChangedOut, Seed };
    // Inputs: In, Up, Down, Reset, then Gate 1–8.
    enum { In = 0, Up, Down, Reset, Gate };
    // Outputs.
    enum { Out = 0, IndexOut, Changed };

    using Module::Module;

    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"step", (double)step_.load()});
    }

    void process(const ProcessContext& c) override {
        dsp::IndexParams p;
        p.mode = (int)setting(Mode);
        p.steps = (int)setting(Steps);
        p.bipolar = (int)setting(Range) == 1;
        p.order = (int)setting(Order);
        p.stop = (int)setting(Wrap) == 1;
        p.gates = (int)setting(Gates);
        p.defaultStep = (int)setting(DefaultStep);
        p.seed = (uint32_t)setting(Seed);
        const double beats = dsp::syncBeats((int)setting(Rate));
        dsp::IndexClock clk;
        clk.transport = !c.inputConnected[Up] && beats > 0.0;
        clk.playing = c.transport && c.transport->playing && c.transport->ppqValid;
        float gate[kMaxIndexGates] = {};
        clk.gate = gate;
        const float last = (float)std::max(1, std::clamp(p.steps, 2, dsp::kMaxIndexSteps) - 1);
        for (int i = 0; i < c.numSamples; ++i) {
            p.offset = value(c, Offset, i);
            clk.in = c.inputs[In][i];
            clk.up = c.inputs[Up][i];
            clk.down = c.inputs[Down][i];
            clk.reset = c.inputs[Reset][i];
            for (int k = 0; k < kMaxIndexGates; ++k) gate[k] = c.inputs[Gate + k][i];
            if (clk.transport && clk.playing) clk.tick = (int64_t)std::floor(c.ppqAt(i) / beats + 1e-9);
            bool changed = false;
            const int s = dsp_.tick(clk, p, changed);
            c.outputs[Out][i] = (float)s / last;
            c.outputs[IndexOut][i] = (float)s;
            c.outputs[Changed][i] = changed ? 1.0f : 0.0f;
        }
        step_.store(dsp_.step());
    }

private:
    dsp::IndexStepper dsp_;
    std::atomic<int> step_{0};
};

}  // namespace

static void registerIndexModule(Registry& r) {
    ModuleSpec s;
    s.type = "index";
    s.name = "Index";
    s.category = "Utility/Logic & Routing";
    s.colour = "#fcd34d";
    s.description = "Turns a CV, triggers, the song or gates into a whole-number step. Out carries the step as "
                    "i / (Steps - 1), the position a dropdown, a toggle or a Live Params row reads.";
    std::vector<std::string> rates;
    for (const char* n : dsp::syncNames()) rates.emplace_back(n);
    rates[0] = "Off";
    s.params.push_back(ParamSpec::number("offset", "Offset", 0.0f, 1.0f, 0.0f));
    s.params.push_back(ParamSpec::choice("mode", "Mode", {"CV", "Count", "Gates", "Binary"}, 0));
    s.params.push_back(ParamSpec::integer("steps", "Steps", 2, dsp::kMaxIndexSteps, 4));
    s.params.push_back(ParamSpec::choice("range", "Input Range", {"0…1", "−1…+1"}, 0).when("mode", 0, 0));
    s.params.push_back(ParamSpec::choice("order", "Order", {"Forward", "Backward", "Ping-Pong", "Random"}, 0).when("mode", 1, 1));
    s.params.push_back(ParamSpec::choice("wrap", "Wrap", {"Wrap", "Stop"}, 0).when("mode", 1, 1));
    s.params.push_back(ParamSpec::choice("rate", "Rate", rates, 0).when("mode", 1, 1));
    s.params.push_back(ParamSpec::integer("gates", "Gate Inputs", 1, kMaxIndexGates, 3).when("mode", 2, 3));
    s.params.push_back(ParamSpec::integer("default", "Default Step", 0, dsp::kMaxIndexSteps - 1, 0).when("mode", 2, 2));
    s.params.push_back(ParamSpec::choice("changedout", "Changed Output", {"Off", "On"}, 0));
    s.params.push_back(ParamSpec::integer("seed", "Seed", 0, 999, 1).when("mode", 1, 1));
    s.inputs.push_back(JackSpec{"in", "In", Signal::Control}.when("mode", 0, 0));
    s.inputs.push_back(JackSpec{"up", "Up", Signal::Trigger}.when("mode", 1, 1));
    s.inputs.push_back(JackSpec{"down", "Down", Signal::Trigger}.when("mode", 1, 1));
    s.inputs.push_back(JackSpec{"reset", "Reset", Signal::Trigger}.when("mode", 1, 1));
    for (int k = 1; k <= kMaxIndexGates; ++k)
        s.inputs.push_back(JackSpec{"gate" + std::to_string(k), "Gate " + std::to_string(k), Signal::Gate}.when("gates", k, kMaxIndexGates));
    s.outputs.push_back({"out", "Out", Signal::Control, false});
    s.outputs.push_back({"index", "Index", Signal::Control, false});
    s.outputs.push_back(JackSpec{"changed", "Changed", Signal::Trigger, false}.when("changedout", 1, 1));
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<IndexModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerIndexModule);

}  // namespace bleep::engine
