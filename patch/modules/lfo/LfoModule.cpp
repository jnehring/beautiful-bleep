// SPDX-License-Identifier: GPL-3.0-or-later
// LFO node (doc/specs/modules/lfo.md): classic waveforms, free or synced.
#include "LfoDsp.h"
#include "Registry.h"

#include <atomic>

namespace bleep::engine {
namespace {

using patch::LfoDsp;

class LfoModule final : public Module {
public:
    enum { Rate, Phase, PulseWidth, Fade, Wave, Sync, Polarity, Seed };
    enum { Reset };
    enum { Out, Sine, Triangle, Saw, Square, Random, Cycle };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"phase", (double)phase_.load()});
    }

    void process(const ProcessContext& c) override {
        patch::LfoParams p;
        p.wave = (int)setting(Wave);
        p.sync = (int)setting(Sync);
        p.unipolar = setting(Polarity) >= 0.5f;
        p.seed = (uint32_t)setting(Seed);
        patch::LfoTime t;
        t.running = c.transport->playing && c.transport->ppqValid;
        t.bpm = c.transport->bpm;
        patch::LfoFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.rateHz = value(c, Rate, i);
            p.phase = value(c, Phase, i);
            p.pulseWidth = value(c, PulseWidth, i);
            p.fade = value(c, Fade, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            dsp_.tick(p, c.inputs[Reset][i], t, f);
            c.outputs[Out][i] = f.out;
            c.outputs[Sine][i] = f.sine;
            c.outputs[Triangle][i] = f.triangle;
            c.outputs[Saw][i] = f.saw;
            c.outputs[Square][i] = f.square;
            c.outputs[Random][i] = f.random;
            c.outputs[Cycle][i] = f.cycle;
        }
        phase_.store((float)dsp_.phase());
    }

private:
    LfoDsp dsp_;
    std::atomic<float> phase_{0.0f};
};

}  // namespace

void registerLfoModule(Registry& r) {
    ModuleSpec s;
    s.type = "lfo";
    s.name = "LFO";
    s.category = "Modulation/LFOs";
    s.colour = "#7dd3fc";
    s.description = "Low-frequency oscillator: classic waves, free or locked to the bars, with a fade-in.";
    std::vector<std::string> sync;
    for (const char* n : dsp::syncNames()) sync.emplace_back(n);
    auto phase = ParamSpec::number("phase", "Phase", 0.0f, 360.0f, 0.0f, "\xc2\xb0", 0);
    auto fade = ParamSpec::seconds("fade", "Fade", 0.0f, 10.0f, 1.0f, 0.0f);
    s.params = {ParamSpec::hertz("rate", "Rate", 0.01f, 50.0f, 1.0f),
                phase,
                ParamSpec::percent("pw", "Pulse Width", 0.05f, 0.95f, 0.5f),
                fade,
                ParamSpec::choice("wave", "Wave",
                                  {"Sine", "Triangle", "Saw Up", "Saw Down", "Square", "Random Step", "Random Smooth"}, 0),
                ParamSpec::choice("sync", "Sync", sync, 0),
                ParamSpec::choice("polarity", "Polarity", {"Bipolar", "Unipolar"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"reset", "Reset", Signal::Trigger}};
    s.outputs = {{"out", "Out", Signal::Control, true},       {"sine", "Sine", Signal::Control, true},
                 {"triangle", "Triangle", Signal::Control, true}, {"saw", "Saw", Signal::Control, true},
                 {"square", "Square", Signal::Control, true},  {"random", "Random", Signal::Control, true},
                 {"cycle", "Cycle", Signal::Trigger, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<LfoModule>(spec); });
}

}  // namespace bleep::engine
