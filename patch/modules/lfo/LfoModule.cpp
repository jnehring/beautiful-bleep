// SPDX-License-Identifier: GPL-3.0-only
// LFO node (doc/specs/modules/lfo.md): classic waveforms, free or synced.
#include "LfoDsp.h"
#include "Registry.h"

#include <atomic>

namespace bleep::engine {
namespace {

using patch::LfoDsp;

class LfoModule final : public Module {
public:
    enum { Rate, Phase, PulseWidth, Fade, Wave, Sync, Polarity, Morph, Division, Skew, Curve };
    enum { Reset, Clock };
    enum { Out };

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
        if (p.sync == patch::LfoClock && !c.inputConnected[Clock]) p.sync = patch::LfoFree;
        p.unipolar = setting(Polarity) >= 0.5f;
        patch::LfoTime t;
        t.running = c.transport->playing && c.transport->ppqValid;
        t.bpm = c.transport->bpm;
        patch::LfoFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.rateHz = value(c, Rate, i);
            p.cycleBeats = dsp::noteValueBeats(dsp::kNumNoteValues - 1 - (int)value(c, Division, i));
            p.morph = value(c, Morph, i);
            p.skew = value(c, Skew, i);
            p.curve = value(c, Curve, i);
            p.phase = value(c, Phase, i);
            p.pulseWidth = value(c, PulseWidth, i);
            p.fade = value(c, Fade, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            dsp_.tick(p, c.inputs[Reset][i], c.inputs[Clock][i], t, f);
            c.outputs[Out][i] = f.out;
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
    s.description = "Low-frequency oscillator: classic waves, free, on a clock or on the tempo, with a morph and a fade-in.";
    // Shortest first: 1/64T … 16 bars.
    std::vector<std::string> divisions;
    for (int i = dsp::kNumNoteValues - 1; i >= 0; --i) divisions.emplace_back(dsp::noteValues()[(size_t)i].name);
    auto phase = ParamSpec::number("phase", "Phase", 0.0f, 360.0f, 0.0f, "\xc2\xb0", 0);
    auto fade = ParamSpec::seconds("fade", "Fade", 0.0f, 10.0f, 1.0f, 0.0f);
    s.params = {ParamSpec::hertz("rate", "Rate", 0.01f, 50.0f, 1.0f).when("sync", 0, 0),
                phase,
                ParamSpec::percent("pw", "Width", 0.05f, 0.95f, 0.5f).when("wave", 4, 4),
                fade,
                ParamSpec::choice("wave", "Wave",
                                  {"Sine", "Triangle", "Saw Up", "Saw Down", "Square", "Random Step", "Random Smooth"}, 0),
                ParamSpec::choice("sync", "Sync", {"Free", "Clock", "Tempo"}, 0),
                ParamSpec::choice("polarity", "Polarity", {"Bipolar", "Unipolar"}, 0),
                ParamSpec::percent("morph", "Morph", 0.0f, 1.0f, 0.5f),
                ParamSpec::stepped("division", "Rate", divisions, dsp::kNumNoteValues - 1 - dsp::noteValueIndex("1/4")).when("sync", 1, 2),
                ParamSpec::number("skew", "Skew", -1.0f, 1.0f, 0.0f, "", 2),
                ParamSpec::number("curve", "Curve", -1.0f, 1.0f, 0.0f, "", 2)};
    s.inputs = {{"reset", "Reset", Signal::Trigger}, {"clock", "Clock", Signal::Trigger}};
    s.outputs = {{"out", "Out", Signal::Control, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<LfoModule>(spec); });
}

}  // namespace bleep::engine
