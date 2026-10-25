// SPDX-License-Identifier: GPL-3.0-only
// Select node (doc/specs/modules/select.md): picks one of up to 8 inputs for
// Out. The slot is chosen by the Select knob (or a CV on it), moved by Next
// triggers or the transport, or jumped to by Trig k triggers.
#include "Registry.h"

#include "dsp/SlotSelector.h"
#include "dsp/Tempo.h"

#include <atomic>
#include <cmath>
#include <string>

namespace bleep::engine {
namespace {

using dsp::kMaxSlots;

class SelectModule final : public Module {
public:
    // Params.
    enum { Select = 0, Fade, Inputs, Order, Rate, Curve, ResetIn, Trigs, ChangedOut, Seed };
    // Inputs: In 1–8, then these; Trig 1–8 follow Reset.
    enum { Next = kMaxSlots, Reset, Trig };
    // Outputs.
    enum { Out = 0, Changed };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"slot", (double)position_.load()});
    }

    void process(const ProcessContext& c) override {
        dsp::SlotParams p;
        p.slots = (int)setting(Inputs);
        p.order = (int)setting(Order);
        p.curve = (int)setting(Curve);
        p.seed = (uint32_t)setting(Seed);
        const double beats = dsp::syncBeats((int)setting(Rate));
        dsp::SlotClock clk;
        clk.transport = !c.inputConnected[Next] && beats > 0.0;
        clk.playing = c.transport && c.transport->playing && c.transport->ppqValid;
        clk.trigs = std::min((int)setting(Trigs), p.slots);
        float trig[kMaxSlots] = {};
        clk.trig = trig;
        dsp::SlotFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.select = value(c, Select, i);
            p.fade = value(c, Fade, i);
            clk.next = c.inputs[Next][i];
            clk.reset = c.inputs[Reset][i];
            for (int k = 0; k < clk.trigs; ++k) trig[k] = c.inputs[Trig + k][i];
            if (clk.transport && clk.playing) clk.tick = (int64_t)std::floor(c.ppqAt(i) / beats + 1e-9);
            dsp_.tick(clk, p, f);
            float out = 0.0f;
            for (int k = 0; k < p.slots; ++k)
                if (f.gain[k] > 0.0f) out += f.gain[k] * c.inputs[k][i];
            c.outputs[Out][i] = out;
            c.outputs[Changed][i] = f.changed ? 1.0f : 0.0f;
        }
        position_.store(dsp_.position());
    }

private:
    dsp::SlotSelector dsp_;
    std::atomic<int> position_{0};
};

}  // namespace

static void registerSelectModule(Registry& r) {
    ModuleSpec s;
    s.type = "select";
    s.name = "Select";
    s.category = "Utility/Logic & Routing";
    s.colour = "#d8b4fe";
    s.description = "Picks one of up to 8 inputs for the output: by the Select knob or a CV on it, stepped by "
                    "triggers or the song, or jumped to with a trigger per input.";
    std::vector<std::string> rates;
    for (const char* n : dsp::syncNames()) rates.emplace_back(n);
    rates[0] = "Off";
    s.params.push_back(ParamSpec::number("select", "Select", 0.0f, 1.0f, 0.0f));
    s.params.push_back(ParamSpec::seconds("fade", "Fade", 0.0f, 2.0f, 0.05f, 0.002f));
    s.params.push_back(ParamSpec::integer("inputs", "Inputs", 2, kMaxSlots, 4));
    s.params.push_back(ParamSpec::choice("order", "Order", {"Forward", "Backward", "Ping-Pong", "Random"}, 0));
    s.params.push_back(ParamSpec::choice("rate", "Rate", rates, 0));
    s.params.push_back(ParamSpec::choice("curve", "Fade Curve", {"Equal Power", "Linear"}, 0));
    s.params.push_back(ParamSpec::choice("resetin", "Reset Input", {"Off", "On"}, 0));
    s.params.push_back(ParamSpec::integer("trigs", "Slot Triggers", 0, kMaxSlots, 0));
    s.params.push_back(ParamSpec::choice("changedout", "Changed Output", {"Off", "On"}, 0));
    s.params.push_back(ParamSpec::integer("seed", "Seed", 0, 999, 1));
    for (int k = 1; k <= kMaxSlots; ++k)
        s.inputs.push_back(JackSpec{"in" + std::to_string(k), "In " + std::to_string(k), Signal::Audio}.when("inputs", k, kMaxSlots));
    s.inputs.push_back({"next", "Next", Signal::Trigger});
    s.inputs.push_back(JackSpec{"reset", "Reset", Signal::Trigger}.when("resetin", 1, 1));
    for (int k = 1; k <= kMaxSlots; ++k)
        s.inputs.push_back(JackSpec{"trig" + std::to_string(k), "Trig " + std::to_string(k), Signal::Trigger}.when("trigs", k, kMaxSlots));
    s.outputs.push_back({"out", "Out", Signal::Audio, true});
    s.outputs.push_back(JackSpec{"changed", "Changed", Signal::Trigger, false}.when("changedout", 1, 1));
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SelectModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerSelectModule);

}  // namespace bleep::engine
