// SPDX-License-Identifier: GPL-3.0-or-later
// Organic LFOs node (doc/specs/modules/organic-lfos.md): eight related LFOs with
// seeded drift, a shared wave twist, Sum and Max, free or locked to the bars.
#include "OrganicLfosDsp.h"
#include "Registry.h"

#include <array>
#include <atomic>
#include <string>

namespace bleep::engine {
namespace {

using patch::OrganicLfosDsp;

class OrganicLfosModule final : public Module {
public:
    enum { Rate, Spread, Drift, Twist, Scatter, Level, Lock, Anchor, Polarity, Seed };
    enum { Reset };
    enum { Out1, Sum = Out1 + OrganicLfosDsp::kLfos, Max };
    static constexpr int kLfos = OrganicLfosDsp::kLfos;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> rates(kLfos);
        for (int k = 0; k < kLfos; ++k) rates[(size_t)k] = rate_[(size_t)k].load();
        out.push_back({"rates", std::move(rates)});
    }

    void process(const ProcessContext& c) override {
        patch::OrganicParams p;
        p.bars = setting(Lock) >= 0.5f;
        p.anchor = setting(Anchor) >= 0.5f;
        p.unipolar = setting(Polarity) >= 0.5f;
        p.seed = (uint32_t)setting(Seed);
        const Transport& tr = *c.transport;
        patch::OrganicTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        patch::OrganicFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.rate = c.params[Rate][i];  // normalised: Hz, or a note value with Lock = Bars
            p.spread = value(c, Spread, i);
            p.drift = value(c, Drift, i);
            p.twist = value(c, Twist, i);
            p.scatter = value(c, Scatter, i);
            p.level = value(c, Level, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            dsp_.tick(p, c.inputs[Reset][i], t, f);
            for (int k = 0; k < kLfos; ++k) c.outputs[Out1 + k][i] = f.out[k];
            c.outputs[Sum][i] = f.sum;
            c.outputs[Max][i] = f.max;
        }
        for (int k = 0; k < kLfos; ++k) rate_[(size_t)k].store((float)dsp_.liveRate(k));
    }

private:
    OrganicLfosDsp dsp_;
    std::array<std::atomic<float>, kLfos> rate_{};
};

}  // namespace

static void registerOrganicLfosModule(Registry& r) {
    ModuleSpec s;
    s.type = "organic-lfos";
    s.name = "Organic LFOs";
    s.category = "Modulation/LFOs";
    s.colour = "#bef264";
    s.description = "Eight slow LFOs that move like a group of living things: related, never quite in step, the same on every render.";
    s.params = {ParamSpec::hertz("rate", "Rate", 0.002f, 20.0f, 0.2f),
                ParamSpec::number("spread", "Spread", -1.0f, 1.0f, 0.5f),
                ParamSpec::percent("drift", "Drift", 0.0f, 1.0f, 0.3f),
                ParamSpec::number("twist", "Twist", -1.0f, 1.0f, 0.0f),
                ParamSpec::percent("scatter", "Scatter", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 1.0f),
                ParamSpec::choice("lock", "Lock", {"Free", "Bars"}, 0),
                ParamSpec::toggle("anchor", "Anchor", true),
                ParamSpec::choice("polarity", "Polarity", {"Bipolar", "Unipolar"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"reset", "Reset", Signal::Trigger}};
    for (int k = 1; k <= OrganicLfosDsp::kLfos; ++k)
        s.outputs.push_back({"out" + std::to_string(k), "Out " + std::to_string(k), Signal::Control, true});
    s.outputs.push_back({"sum", "Sum", Signal::Control, true});
    s.outputs.push_back({"max", "Max", Signal::Control, true});
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<OrganicLfosModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerOrganicLfosModule);

}  // namespace bleep::engine
