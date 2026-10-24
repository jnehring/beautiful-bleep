// SPDX-License-Identifier: GPL-3.0-only
// Rotating Div node (doc/specs/modules/rotating-divider.md): eight dividers of
// one base clock; Rotate shifts the set of divisions across the outputs.
#include "RotatingDividerDsp.h"
#include "Registry.h"
#include "dsp/SeqClock.h"

#include <juce_core/juce_core.h>

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::kRdOutputs;
using patch::RotatingDividerDsp;

/// The custom set from the node's data: eight values 1–64, padded with 1…8.
std::array<int, kRdOutputs> parseCustom(const juce::var& data) {
    std::array<int, kRdOutputs> c{1, 2, 3, 4, 5, 6, 7, 8};
    const auto* a = data.isObject() ? data["custom"].getArray() : nullptr;
    if (!a) return c;
    for (int i = 0; i < kRdOutputs && i < a->size(); ++i) {
        const juce::var v = (*a)[i];
        if (v.isInt() || v.isInt64() || v.isDouble()) c[(size_t)i] = juce::jlimit(1, 64, (int)std::lround((double)v));
    }
    return c;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const auto c = parseCustom(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> custom;
    for (int v : c) custom.add(v);
    out->setProperty("custom", custom);
    return juce::JSON::toString(result, true).toStdString();
}

class RotatingDividerModule final : public Module {
public:
    enum { Rotate, Width, Set, RotateMode, Sync, Base, Realign, Output, GateLength, SyncTo };
    enum { Clock, Reset };
    enum { Out1 = 0, Stair = kRdOutputs, Align };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        const auto c = parseCustom(juce::JSON::parse(juce::String(json)));
        for (int i = 0; i < kRdOutputs; ++i) custom_[(size_t)i].store(c[(size_t)i]);
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"step", (double)step_.load()});
        out.push_back({"pending", pending_.load() ? 1.0 : 0.0});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> div, next, gates;
        for (int k = 0; k < kRdOutputs; ++k) {
            div.push_back((float)div_[(size_t)k].load());
            next.push_back((float)next_[(size_t)k].load());
            gates.push_back(gates_[(size_t)k].load() ? 1.0f : 0.0f);
        }
        out.push_back({"div", std::move(div)});
        out.push_back({"next", std::move(next)});
        out.push_back({"gates", std::move(gates)});
    }

    void process(const ProcessContext& c) override {
        int custom[kRdOutputs];
        for (int k = 0; k < kRdOutputs; ++k) custom[k] = custom_[(size_t)k].load();
        patch::RdParams p;
        p.set = (int)setting(Set);
        p.extend = setting(RotateMode) >= 0.5f;
        p.sync = (int)setting(Sync);
        p.baseBeats = dsp::sequencerRateBeats((int)setting(Base));
        p.realign = patch::rdRealignBars((int)setting(Realign));
        p.trigger = setting(Output) >= 0.5f;
        p.gateBase = setting(GateLength) >= 0.5f;
        p.custom = custom;
        const Transport& tr = *c.transport;
        patch::RdInput in;
        in.clocked = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        in.running = tr.playing && tr.ppqValid;
        in.ppqPerSample = c.ppqPerSample;
        in.bpm = tr.bpm;
        patch::RdOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            p.rotate = (int)value(c, Rotate, i);
            p.width = value(c, Width, i);
            in.clock = c.inputs[Clock][i];
            in.reset = c.inputs[Reset][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, o);
            for (int k = 0; k < kRdOutputs; ++k) c.outputs[Out1 + k][i] = o.out[k];
            c.outputs[Stair][i] = o.stair;
            c.outputs[Align][i] = o.align;
        }
        for (int k = 0; k < kRdOutputs; ++k) {
            div_[(size_t)k].store(dsp_.divisions()[k]);
            next_[(size_t)k].store(dsp_.pending()[k]);
            gates_[(size_t)k].store(dsp_.high(k));
        }
        step_.store((int)dsp_.step());
        pending_.store(dsp_.hasPending());
    }

private:
    RotatingDividerDsp dsp_;
    std::array<std::atomic<int>, kRdOutputs> custom_{1, 2, 3, 4, 5, 6, 7, 8}, div_{}, next_{};
    std::array<std::atomic<bool>, kRdOutputs> gates_{};
    std::atomic<int> step_{0};
    std::atomic<bool> pending_{false};
};

}  // namespace

static void registerRotatingDividerModule(Registry& r) {
    ModuleSpec s;
    s.type = "rotating-divider";
    s.name = "Rotating Div";
    s.category = "Sequencing/Clock";
    s.colour = "#f4a259";
    s.description = "Eight clock dividers of one base clock. Rotate shifts the set of divisions across the outputs.";
    std::vector<std::string> rates;
    for (int i = 0; i < dsp::kNumSequencerRates; ++i) rates.emplace_back(dsp::sequencerRate(i).name);
    s.params = {ParamSpec::steppedInt("rotate", "Rotate", 0, patch::kRdMaxRotate, 0),
                ParamSpec::percent("width", "Width", 0.01f, 0.99f, 0.5f).when("output", 0, 0),
                ParamSpec::choice("set", "Set", {"Integers", "Odds", "Evens", "Primes", "Powers of 2", "Fibonacci", "Custom"}, 0),
                ParamSpec::choice("rotatemode", "Rotate Mode", {"Wrap", "Extend"}, 0),
                ParamSpec::choice("sync", "Rotate Sync", {"Immediate", "Next Step", "Next Bar"}, 1),
                ParamSpec::choice("base", "Base", rates, 9),
                ParamSpec::choice("realign", "Realign", {"Never", "1 bar", "2 bars", "4 bars", "8 bars"}, 0),
                ParamSpec::choice("output", "Output", {"Gate", "Trigger"}, 0),
                ParamSpec::choice("gatelength", "Gate Length", {"Division", "Base Step"}, 0).when("output", 0, 0),
                ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto)};
    s.inputs = {{"clock", "Clock", Signal::Trigger}, {"reset", "Reset", Signal::Trigger}};
    for (int k = 0; k < kRdOutputs; ++k)
        s.outputs.push_back({"out" + std::to_string(k + 1), "Out " + std::to_string(k + 1), Signal::Gate, false});
    s.outputs.push_back({"stair", "Stair", Signal::Control, false});
    s.outputs.push_back({"align", "Align", Signal::Trigger, false});
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<RotatingDividerModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerRotatingDividerModule);

}  // namespace bleep::engine
