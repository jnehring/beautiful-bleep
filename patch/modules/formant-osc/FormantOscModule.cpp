// SPDX-License-Identifier: MIT
// Formant Osc node (doc/specs/modules/formant-oscillator.md): a pulse-formant
// oscillator with a second formant on the right channel, square and sub.
#include "FormantOscDsp.h"
#include "Registry.h"

#include <atomic>

namespace bleep::engine {
namespace {

using patch::FormantOscDsp;
using patch::FormantOscParams;

class FormantOscModule final : public Module {
public:
    enum { Octave, Coarse, Fine, Formant, Narrow, Body, Reset, Roll, Spread, FmDepth, Tracking, Start, Quality };
    enum { Pitch, FormantCv, FormantFm, Sync };
    enum { OutL, OutR, FormantOut, Square, Sub };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"f0", (double)f0_.load(std::memory_order_relaxed)});
        out.push_back({"ff", (double)ff_.load(std::memory_order_relaxed)});
        out.push_back({"ff2", (double)ff2_.load(std::memory_order_relaxed)});
    }

    void process(const ProcessContext& c) override {
        dsp_.setOversampling(setting(Quality) >= 0.5f ? 2 : 1);
        FormantOscParams p;
        p.fixed = setting(Tracking) >= 0.5f;
        p.cosine = setting(Start) >= 0.5f;
        bool want[FormantOscDsp::kOutputs];
        for (int k = 0; k < FormantOscDsp::kOutputs; ++k) want[k] = c.isOutputConnected(k);
        const float* sync = c.inputs[Sync];
        for (int i = 0; i < c.numSamples; ++i) {
            p.pitch = value(c, Octave, i) + value(c, Coarse, i) / 12.0f + value(c, Fine, i) / 1200.0f + c.inputs[Pitch][i];
            p.formant = value(c, Formant, i);
            p.formantCv = c.inputs[FormantCv][i];
            p.fm = c.inputs[FormantFm][i];
            p.fmDepth = value(c, FmDepth, i);
            p.narrow = value(c, Narrow, i);
            p.body = value(c, Body, i);
            p.reset = value(c, Reset, i);
            p.roll = value(c, Roll, i);
            p.spread = value(c, Spread, i);
            const bool edge = sync[i] >= 0.5f && lastSync_ < 0.5f;
            lastSync_ = sync[i];
            const auto f = dsp_.process(p, edge, want);
            c.outputs[OutL][i] = f.outL;
            c.outputs[OutR][i] = f.outR;
            c.outputs[FormantOut][i] = f.formant;
            c.outputs[Square][i] = f.square;
            c.outputs[Sub][i] = f.sub;
        }
        f0_.store((float)dsp_.f0(), std::memory_order_relaxed);
        ff_.store((float)dsp_.formantHz(), std::memory_order_relaxed);
        ff2_.store((float)dsp_.formant2Hz(), std::memory_order_relaxed);
    }

private:
    FormantOscDsp dsp_;
    float lastSync_ = 0.0f;
    std::atomic<float> f0_{0.0f}, ff_{0.0f}, ff2_{0.0f};
};

}  // namespace

static void registerFormantOscModule(Registry& r) {
    ModuleSpec s;
    s.type = "formant-osc";
    s.name = "Formant Osc";
    s.category = "Sources";
    s.colour = "#e879f9";
    s.description = "Pulse-formant oscillator: a resonant peak that sweeps through zero, vocal and filter-like with no filter.";
    s.params = {ParamSpec::steppedInt("octave", "Octave", -4, 4, 0).inGroup("Pitch"),
                ParamSpec::number("coarse", "Coarse", -12.0f, 12.0f, 0.0f, "st", 1).inGroup("Pitch"),
                ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0).inGroup("Pitch"),
                ParamSpec::number("formant", "Formant", -6.0f, 6.0f, 2.0f, "oct", 2).inGroup("Formant"),
                ParamSpec::percent("narrow", "Narrow", 0.0f, 1.0f, 0.3f).inGroup("Formant"),
                ParamSpec::percent("body", "Body", 0.0f, 1.0f, 0.7f).inGroup("Formant"),
                ParamSpec::percent("reset", "Reset", 0.0f, 1.0f, 1.0f).inGroup("Motion"),
                ParamSpec::percent("roll", "Roll", 0.0f, 1.0f, 0.0f).inGroup("Motion"),
                ParamSpec::number("spread", "Spread", -1.0f, 1.0f, 0.0f, "oct", 2).inGroup("Motion"),
                ParamSpec::percent("fmDepth", "FM Depth", 0.0f, 1.0f, 0.0f).inGroup("Motion"),
                ParamSpec::choice("tracking", "Tracking", {"Ratio", "Fixed"}, 0),
                ParamSpec::choice("start", "Start", {"Sine", "Cosine"}, 1),
                ParamSpec::choice("quality", "Quality", {"Normal (1×)", "High (2×)"}, 0)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch},
                {"formantCv", "Formant CV", Signal::Pitch},
                {"formantFm", "Formant FM", Signal::Audio},
                {"sync", "Sync", Signal::Trigger}};
    s.outputs = {{"outL", "Out L", Signal::Audio, true},
                 {"outR", "Out R", Signal::Audio, true},
                 {"formant", "Formant", Signal::Audio, true},
                 {"square", "Square", Signal::Audio, true},
                 {"sub", "Sub", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<FormantOscModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerFormantOscModule);

}  // namespace bleep::engine
