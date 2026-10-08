// SPDX-License-Identifier: MIT
// Switch node (specs/modules/switch.md): a sequential switch with up to 8
// steps, 8 → 1 and 1 → 8 at once, stepped by triggers, the transport or
// Select, with fades that never jump.
#include "Registry.h"
#include "SwitchDsp.h"

#include "dsp/Tempo.h"

#include <atomic>
#include <cmath>
#include <string>

namespace bleep::engine {
namespace {

using patch::kSwitchSteps;

class SwitchModule final : public Module {
public:
    // Params: Level 1–8 at 0–7, then these.
    enum { Select = kSwitchSteps, Fade, Length, Order, Rate, Curve, Mode, Idle, Seed };
    // Inputs: In 1–8 at 0–7, then these.
    enum { In = kSwitchSteps, Step, Reset };
    // Outputs: Out, Out 1–8 at 1–8, then these.
    enum { Out = 0, Gate = kSwitchSteps + 1, End, Position, Changed };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"step", (double)position_.load()});
    }

    void process(const ProcessContext& c) override {
        patch::SwitchParams p;
        p.length = (int)setting(Length);
        p.order = (int)setting(Order);
        p.curve = (int)setting(Curve);
        p.glide = setting(Mode) >= 0.5f;
        p.hold = setting(Idle) >= 0.5f;
        p.seed = (uint32_t)setting(Seed);
        const double beats = dsp::syncBeats((int)setting(Rate));
        bool patched[kSwitchSteps];
        for (int k = 0; k < kSwitchSteps; ++k) patched[k] = c.inputConnected[k];
        patch::SwitchClock clk;
        clk.transport = !c.inputConnected[Step] && beats > 0.0;
        clk.playing = c.transport && c.transport->playing && c.transport->ppqValid;
        float in[kSwitchSteps];
        patch::SwitchFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            for (int k = 0; k < kSwitchSteps; ++k) {
                p.level[k] = value(c, k, i);
                in[k] = c.inputs[k][i];
            }
            p.select = value(c, Select, i);
            p.fade = value(c, Fade, i);
            clk.step = c.inputs[Step][i];
            clk.reset = c.inputs[Reset][i];
            if (clk.transport && clk.playing) clk.tick = (int64_t)std::floor(c.ppqAt(i) / beats + 1e-9);
            dsp_.tick(in, patched, c.inputs[In][i], clk, p, f);
            c.outputs[Out][i] = f.out;
            for (int k = 0; k < kSwitchSteps; ++k) c.outputs[1 + k][i] = f.outs[k];
            c.outputs[Gate][i] = f.gate;
            c.outputs[End][i] = f.end;
            c.outputs[Position][i] = f.position;
            c.outputs[Changed][i] = f.changed;
        }
        position_.store(dsp_.position());
    }

private:
    patch::SwitchDsp dsp_;
    std::atomic<int> position_{0};
};

}  // namespace

void registerSwitchModule(Registry& r) {
    ModuleSpec s;
    s.type = "switch";
    s.name = "Switch";
    s.category = "Utility";
    s.colour = "#c4b5fd";
    s.description = "Sequential switch: 8 inputs to one output and one input to 8 outputs, stepped by triggers, "
                    "the transport or Select.";
    std::vector<std::string> rates;
    for (const char* n : dsp::syncNames()) rates.emplace_back(n);
    rates[0] = "Off";
    for (int k = 1; k <= kSwitchSteps; ++k)
        s.params.push_back(ParamSpec::number("level" + std::to_string(k), "Level " + std::to_string(k), -1.0f, 1.0f, 1.0f));
    s.params.push_back(ParamSpec::number("select", "Select", 0.0f, 1.0f, 0.0f));
    s.params.push_back(ParamSpec::seconds("fade", "Fade", 0.0f, 2.0f, 0.05f, 0.002f));
    s.params.push_back(ParamSpec::integer("length", "Length", 2, kSwitchSteps, 4));
    s.params.push_back(ParamSpec::choice("order", "Direction", {"Forward", "Backward", "Ping-Pong", "Random", "Random Walk"}, 0));
    s.params.push_back(ParamSpec::choice("rate", "Rate", rates, 0));
    s.params.push_back(ParamSpec::choice("curve", "Fade Curve", {"Equal Power", "Linear"}, 0));
    s.params.push_back(ParamSpec::choice("mode", "Mode", {"Crossfade", "Glide"}, 0));
    s.params.push_back(ParamSpec::choice("idle", "Idle Outputs", {"Zero", "Hold"}, 0));
    s.params.push_back(ParamSpec::integer("seed", "Seed", 0, 999, 1));
    for (int k = 1; k <= kSwitchSteps; ++k)
        s.inputs.push_back({"in" + std::to_string(k), "In " + std::to_string(k), Signal::Audio});
    s.inputs.push_back({"in", "In", Signal::Audio});
    s.inputs.push_back({"step", "Step", Signal::Trigger});
    s.inputs.push_back({"reset", "Reset", Signal::Trigger});
    s.outputs.push_back({"out", "Out", Signal::Audio, true});
    for (int k = 1; k <= kSwitchSteps; ++k)
        s.outputs.push_back({"out" + std::to_string(k), "Out " + std::to_string(k), Signal::Audio, true});
    s.outputs.push_back({"gate", "Gate", Signal::Gate, false});
    s.outputs.push_back({"end", "End", Signal::Trigger, false});
    s.outputs.push_back({"position", "Position", Signal::Control, false});
    s.outputs.push_back({"changed", "Changed", Signal::Trigger, false});
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SwitchModule>(spec); });
}

}  // namespace bleep::engine
