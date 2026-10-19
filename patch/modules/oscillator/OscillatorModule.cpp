// SPDX-License-Identifier: GPL-3.0-or-later
// Oscillator node: triangle core with waveform morph, through-zero FM, hard sync, sub.
#include "OscillatorDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

using patch::OscillatorDsp;
using patch::OscillatorParams;

class OscillatorModule final : public Module {
public:
    enum { Octave, Coarse, Fine, Shape, PulseWidth, FmDepth };
    enum { Pitch, Fm, Sync };
    enum { Out, Sine, Triangle, Saw, Square, Sub };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        const float octave = setting(Octave) - 3.0f;  // choice index 0..6 → −3..+3
        OscillatorParams p;
        for (int i = 0; i < c.numSamples; ++i) {
            p.pitch = octave + value(c, Coarse, i) / 12.0f + value(c, Fine, i) / 1200.0f + c.inputs[Pitch][i];
            p.shape = value(c, Shape, i);
            p.pulseWidth = value(c, PulseWidth, i);
            p.fmDepth = value(c, FmDepth, i);
            const auto o = dsp_.tick(p, c.inputs[Fm][i], c.inputs[Sync][i]);
            c.outputs[Out][i] = o.out;
            c.outputs[Sine][i] = o.sine;
            c.outputs[Triangle][i] = o.triangle;
            c.outputs[Saw][i] = o.saw;
            c.outputs[Square][i] = o.square;
            c.outputs[Sub][i] = o.sub;
        }
    }

private:
    OscillatorDsp dsp_;
};

}  // namespace

void registerOscillatorModule(Registry& r) {
    ModuleSpec s;
    s.type = "oscillator";
    s.name = "Oscillator";
    s.category = "Sources/Oscillators";
    s.colour = "#5eead4";
    s.description = "Triangle-core oscillator: waveform morph, through-zero FM, hard sync and a sub octave.";
    ParamSpec coarse = ParamSpec::number("coarse", "Coarse", -12.0f, 12.0f, 0.0f, "st", 1);
    ParamSpec fine = ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0);
    s.params = {ParamSpec::choice("octave", "Octave", {"-3", "-2", "-1", "0", "+1", "+2", "+3"}, 3),
                coarse,
                fine,
                ParamSpec::percent("shape", "Shape", 0.0f, 1.0f, 2.0f / 3.0f),
                ParamSpec::percent("pw", "Pulse Width", 0.05f, 0.95f, 0.5f),
                ParamSpec::percent("fm", "FM Depth", 0.0f, 1.0f, 0.0f)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch}, {"fm", "FM", Signal::Audio}, {"sync", "Sync", Signal::Gate}};
    s.outputs = {{"out", "Out", Signal::Audio, true},      {"sine", "Sine", Signal::Audio, true},
                 {"triangle", "Triangle", Signal::Audio, true}, {"saw", "Saw", Signal::Audio, true},
                 {"square", "Square", Signal::Audio, true}, {"sub", "Sub", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<OscillatorModule>(spec); });
}

}  // namespace bleep::engine
