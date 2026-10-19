// SPDX-License-Identifier: GPL-3.0-or-later
// Clock Mult node (doc/specs/modules/clock-multiplier.md): six faster clocks
// of one clock, each at its own ratio, with skips, swing and humanize.
#include "ClockMultiplierDsp.h"
#include "Registry.h"
#include "dsp/SeqClock.h"

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::kCmOutputs;

class ClockMultiplierModule final : public Module {
public:
    enum { Ratio1 = 0, Skip1 = kCmOutputs, Swing = 2 * kCmOutputs, Humanize, Width, Lock, Base, Output, KeepBeat, Seed, SyncTo };
    enum { Clock, Reset };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> gates;
        for (int k = 0; k < kCmOutputs; ++k) gates.push_back(gates_[(size_t)k].load() ? 1.0f : 0.0f);
        out.push_back({"gates", std::move(gates)});
    }

    void process(const ProcessContext& c) override {
        patch::CmParams p;
        p.baseBeats = dsp::sequencerRateBeats((int)setting(Base));
        p.trigger = setting(Output) >= 0.5f;
        p.keepBeat = setting(KeepBeat) >= 0.5f;
        p.seed = (uint64_t)setting(Seed);
        const Transport& tr = *c.transport;
        patch::CmInput in;
        in.clocked = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        in.running = tr.playing && tr.ppqValid;
        in.ppqPerSample = c.ppqPerSample;
        patch::CmOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            for (int k = 0; k < kCmOutputs; ++k) {
                p.ratio[k] = (int)value(c, Ratio1 + k, i);
                p.skip[k] = value(c, Skip1 + k, i);
            }
            p.swing = value(c, Swing, i);
            p.humanize = value(c, Humanize, i);
            p.width = value(c, Width, i);
            p.lock = value(c, Lock, i);
            in.clock = c.inputs[Clock][i];
            in.reset = c.inputs[Reset][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, o);
            for (int k = 0; k < kCmOutputs; ++k) c.outputs[k][i] = o.out[k];
            c.outputs[kCmOutputs][i] = o.any;
        }
        for (int k = 0; k < kCmOutputs; ++k) gates_[(size_t)k].store(dsp_.high(k));
    }

private:
    patch::ClockMultiplierDsp dsp_;
    std::array<std::atomic<bool>, kCmOutputs> gates_{};
};

}  // namespace

static void registerClockMultiplierModule(Registry& r) {
    ModuleSpec s;
    s.type = "clock-multiplier";
    s.name = "Clock Mult";
    s.category = "Sequencing/Clock";
    s.colour = "#e9b44c";
    s.description = "Six faster clocks of one clock, each at its own ratio, with skips, swing and humanize on the in-between ticks and a phase lock.";
    std::vector<std::string> ratios;
    for (int i = 0; i < patch::kCmRatios; ++i) ratios.emplace_back(patch::cmRatios()[i].name);
    static constexpr int defaults[kCmOutputs] = {12, 14, 16, 9, 7, 20};  // 2, 3, 4, 3/2, 5/4, 8 (cmRatios())
    for (int k = 0; k < kCmOutputs; ++k)
        s.params.push_back(ParamSpec::stepped("ratio" + std::to_string(k + 1), "Ratio " + std::to_string(k + 1), ratios, defaults[k]).inGroup("Ratios"));
    for (int k = 0; k < kCmOutputs; ++k)
        s.params.push_back(ParamSpec::percent("skip" + std::to_string(k + 1), "Skip " + std::to_string(k + 1), 0.0f, 1.0f, 0.0f).inGroup("Skips"));
    s.params.push_back(ParamSpec::percent("swing", "Swing", 0.0f, 1.0f, 0.0f).inGroup("Feel"));
    s.params.push_back(ParamSpec::percent("humanize", "Humanize", 0.0f, 1.0f, 0.0f).inGroup("Feel"));
    s.params.push_back(ParamSpec::percent("width", "Width", 0.01f, 0.99f, 0.5f).when("output", 0, 0));
    s.params.push_back(ParamSpec::percent("lock", "Phase Lock", 0.0f, 1.0f, 1.0f).inGroup("Feel"));
    std::vector<std::string> rates;
    for (int i = 0; i < dsp::kNumSequencerRates; ++i) rates.emplace_back(dsp::sequencerRate(i).name);
    s.params.push_back(ParamSpec::choice("base", "Base", rates, 3));
    s.params.push_back(ParamSpec::choice("output", "Output", {"Gate", "Trigger"}, 0));
    s.params.push_back(ParamSpec::toggle("keepbeat", "Keep Beat", true));
    s.params.push_back(ParamSpec::integer("seed", "Seed", 0, 999, 1));
    s.params.push_back(ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto));
    for (int k = 0; k < kCmOutputs; ++k)
        s.outputs.push_back({"out" + std::to_string(k + 1), "Out " + std::to_string(k + 1), Signal::Gate, false});
    s.outputs.push_back({"any", "Any", Signal::Gate, false});
    s.inputs = {{"clock", "Clock", Signal::Trigger}, {"reset", "Reset", Signal::Trigger}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ClockMultiplierModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerClockMultiplierModule);

}  // namespace bleep::engine
