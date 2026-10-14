// SPDX-License-Identifier: MIT
// Clock Div node (doc/specs/modules/clock-divider.md): eight clock dividers
// of one base clock, each with its own division.
#include "ClockDividerDsp.h"
#include "Registry.h"
#include "dsp/SeqClock.h"

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::ClockDividerDsp;
using patch::kCdMaxDivision;
using patch::kCdOutputs;

class ClockDividerModule final : public Module {
public:
    enum { Div1 = 0, Width = kCdOutputs, Base, Realign, Output, GateLength, SyncTo };
    enum { Clock, Reset };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override { out.push_back({"step", (double)step_.load()}); }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> gates;
        for (int k = 0; k < kCdOutputs; ++k) gates.push_back(gates_[(size_t)k].load() ? 1.0f : 0.0f);
        out.push_back({"gates", std::move(gates)});
    }

    void process(const ProcessContext& c) override {
        patch::CdParams p;
        p.baseBeats = dsp::sequencerRateBeats((int)setting(Base));
        p.realign = patch::cdRealignBars((int)setting(Realign));
        p.trigger = setting(Output) >= 0.5f;
        p.gateBase = setting(GateLength) >= 0.5f;
        const Transport& tr = *c.transport;
        patch::CdInput in;
        in.clocked = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        in.running = tr.playing && tr.ppqValid;
        in.ppqPerSample = c.ppqPerSample;
        in.bpm = tr.bpm;
        patch::CdOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            for (int k = 0; k < kCdOutputs; ++k) p.div[k] = (int)value(c, Div1 + k, i);
            p.width = value(c, Width, i);
            in.clock = c.inputs[Clock][i];
            in.reset = c.inputs[Reset][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, o);
            for (int k = 0; k < kCdOutputs; ++k) c.outputs[k][i] = o.out[k];
        }
        for (int k = 0; k < kCdOutputs; ++k) gates_[(size_t)k].store(dsp_.high(k));
        step_.store((int)dsp_.step());
    }

private:
    ClockDividerDsp dsp_;
    std::array<std::atomic<bool>, kCdOutputs> gates_{};
    std::atomic<int> step_{0};
};

}  // namespace

static void registerClockDividerModule(Registry& r) {
    ModuleSpec s;
    s.type = "clock-divider";
    s.name = "Clock Div";
    s.category = "Sequencing/Clock";
    s.colour = "#e9b44c";
    s.description = "Eight clock dividers of one base clock, each output with its own division from /1 to /64.";
    std::vector<std::string> rates;
    for (int i = 0; i < dsp::kNumSequencerRates; ++i) rates.emplace_back(dsp::sequencerRate(i).name);
    static constexpr int defaults[kCdOutputs] = {2, 3, 4, 5, 6, 8, 16, 32};
    for (int k = 0; k < kCdOutputs; ++k)
        s.params.push_back(ParamSpec::steppedInt("div" + std::to_string(k + 1), "Div " + std::to_string(k + 1), 1, kCdMaxDivision, defaults[k]));
    s.params.push_back(ParamSpec::percent("width", "Width", 0.01f, 0.99f, 0.5f).when("output", 0, 0));
    s.params.push_back(ParamSpec::choice("base", "Base", rates, 9));
    s.params.push_back(ParamSpec::choice("realign", "Realign", {"Never", "1 bar", "2 bars", "4 bars", "8 bars"}, 0));
    s.params.push_back(ParamSpec::choice("output", "Output", {"Gate", "Trigger"}, 0));
    s.params.push_back(ParamSpec::choice("gatelength", "Gate Length", {"Division", "Base Step"}, 0).when("output", 0, 0));
    s.params.push_back(ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto));
    for (int k = 0; k < kCdOutputs; ++k)
        s.outputs.push_back({"out" + std::to_string(k + 1), "Out " + std::to_string(k + 1), Signal::Gate, false});
    s.inputs = {{"clock", "Clock", Signal::Trigger}, {"reset", "Reset", Signal::Trigger}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ClockDividerModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerClockDividerModule);

}  // namespace bleep::engine
