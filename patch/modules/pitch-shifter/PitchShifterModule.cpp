// SPDX-License-Identifier: MIT
// Pitch Shifter node (doc/pitch-shifter.md): shifts a stereo signal by a musical
// interval with two crossfading delay heads; feedback makes climbing spirals.
// The algorithm is DaisySP's PitchShifter (MIT, see LICENSE).
#include "PitchShifterDsp.h"
#include "Registry.h"

#include <algorithm>

namespace bleep::engine {
namespace {

using patch::PitchShifterDsp;
using patch::PitchShifterParams;

class PitchShifterModule final : public Module {
public:
    enum { Pitch, Fine, Window, Drift, Feedback, Mix };
    enum { InL, InR };
    enum { OutL, OutR };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_[0].prepare(sampleRate, 1u);
        dsp_[1].prepare(sampleRate, 7u);
    }
    void reset() override {
        dsp_[0].reset();
        dsp_[1].reset();
    }

    void process(const ProcessContext& c) override {
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];  // mono in feeds both
        PitchShifterParams p;
        for (int i = 0; i < c.numSamples; ++i) {
            p.semitones = value(c, Pitch, i) + value(c, Fine, i) * 0.01f;
            p.windowMs = value(c, Window, i);
            p.drift = value(c, Drift, i);
            p.feedback = value(c, Feedback, i);
            const float mix = value(c, Mix, i);
            const float l = c.inputs[InL][i], r = inR[i];
            c.outputs[OutL][i] = l + mix * (dsp_[0].tick(l, p) - l);
            c.outputs[OutR][i] = r + mix * (dsp_[1].tick(r, p) - r);
        }
    }

private:
    PitchShifterDsp dsp_[2];
};

}  // namespace

static void registerPitchShifterModule(Registry& r) {
    ModuleSpec s;
    s.type = "pitch-shifter";
    s.name = "Pitch Shifter";
    s.category = "Effects/Movement";
    s.colour = "#c026d3";
    s.description = "Shifts the pitch of audio by a musical interval, two crossfading delay heads, with drift "
                    "for tape flutter and feedback for climbing spirals. Put it before a reverb for a shimmer.";
    ParamSpec pitch = ParamSpec::number("pitch", "Pitch", -24.0f, 24.0f, 12.0f, "st", 2);
    pitch.format = ParamSpec::Format::Semitones;
    s.params = {pitch,
                ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 1),
                ParamSpec::exponential("window", "Window", 20.0f, 340.0f, 80.0f, "ms"),
                ParamSpec::percent("drift", "Drift", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("feedback", "Feedback", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<PitchShifterModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerPitchShifterModule);

}  // namespace bleep::engine
