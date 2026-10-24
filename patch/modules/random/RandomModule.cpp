// SPDX-License-Identifier: GPL-3.0-only
// Random node: seeded stepped randomness with a looping memory.
#include "RandomDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

using patch::RandomDsp;
using patch::RandomParams;

class RandomModule final : public Module {
public:
    enum { Rate, Spread, Bias, Smooth, Loop, Sync, Length, Quantize, Seed };
    enum { Clock };
    enum { Out, Trig };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        if (c.transportStarted) dsp_.restart();
        RandomParams p;
        p.sync = (int)setting(Sync);
        const int len = (int)setting(Length);
        p.length = RandomDsp::kLengths[(size_t)std::clamp(len, 0, (int)RandomDsp::kLengths.size() - 1)];
        p.quantize = setting(Quantize) >= 0.5f;
        p.seed = (uint32_t)setting(Seed);
        const bool locked = c.transport->playing && c.transport->ppqValid;
        for (int i = 0; i < c.numSamples; ++i) {
            p.rateHz = value(c, Rate, i);
            p.spread = value(c, Spread, i);
            p.bias = value(c, Bias, i);
            p.smooth = value(c, Smooth, i);
            p.loop = value(c, Loop, i);
            dsp_.tick(p, c.inputs[Clock][i], c.inputConnected[Clock], c.transport->bpm, c.ppqAt(i), locked,
                      c.outputs[Out][i], c.outputs[Trig][i]);
        }
    }

private:
    RandomDsp dsp_;
};

}  // namespace

void registerRandomModule(Registry& r) {
    ModuleSpec s;
    s.type = "random";
    s.name = "Random";
    s.category = "Modulation/Random";
    s.colour = "#f6a85b";
    s.description = "Seeded stepped randomness. Loop moves from always new to a locked loop.";
    std::vector<std::string> sync;
    for (const char* n : dsp::syncNames()) sync.emplace_back(n);
    std::vector<std::string> lengths;
    for (int n : RandomDsp::kLengths) lengths.push_back(std::to_string(n) + " steps");
    s.params = {ParamSpec::hertz("rate", "Rate", 0.05f, 50.0f, 2.0f),
                ParamSpec::percent("spread", "Spread", 0.0f, 1.0f, 1.0f),
                ParamSpec::number("bias", "Bias", -1.0f, 1.0f, 0.0f),
                ParamSpec::percent("smooth", "Smooth", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("loop", "Loop", 0.0f, 1.0f, 0.0f),
                ParamSpec::choice("sync", "Sync", sync, 4),
                ParamSpec::choice("length", "Length", lengths, 5),
                ParamSpec::toggle("quantize", "Semitones", false),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"clock", "Clock", Signal::Gate}};
    s.outputs = {{"out", "Out", Signal::Control, true}, {"trig", "Trig", Signal::Trigger, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<RandomModule>(spec); });
}

}  // namespace bleep::engine
