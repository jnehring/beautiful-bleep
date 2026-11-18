// SPDX-License-Identifier: GPL-3.0-only
// Oscillator node: triangle core, a waveform and a secondary one with Morph between them, linear (optionally
// through zero) or exponential FM and hard sync. One output.
#include "OscillatorDsp.h"
#include "Registry.h"

#include <algorithm>
#include <cmath>

namespace bleep::engine {
namespace {

using patch::OscillatorDsp;
using patch::OscillatorParams;
using patch::OscWave;

class OscillatorModule final : public Module {
public:
    enum { Octave, Coarse, Fine, Wave, Wave2, Morph, PulseWidth, FmDepth, FmMode, HardSync, ThroughZero };
    enum { Pitch, Fm, Sync };
    enum { Out };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        const float octave = setting(Octave) - 3.0f;  // choice index 0..6 → −3..+3
        OscillatorParams p;
        p.wave = wave(setting(Wave));
        p.wave2 = wave(setting(Wave2));
        p.expFm = setting(FmMode) >= 0.5f;
        p.hardSync = setting(HardSync) >= 0.5f;
        p.throughZero = setting(ThroughZero) >= 0.5f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.pitch = octave + value(c, Coarse, i) / 12.0f + value(c, Fine, i) / 1200.0f + c.inputs[Pitch][i];
            p.morph = value(c, Morph, i);
            p.pulseWidth = value(c, PulseWidth, i);
            p.fmDepth = value(c, FmDepth, i);
            c.outputs[Out][i] = dsp_.tick(p, c.inputs[Fm][i], c.inputs[Sync][i]);
        }
    }

private:
    static OscWave wave(float index) noexcept { return (OscWave)std::clamp((int)std::lround(index), 0, 3); }

    OscillatorDsp dsp_;
};

}  // namespace

void registerOscillatorModule(Registry& r) {
    ModuleSpec s;
    s.type = "oscillator";
    s.name = "Oscillator";
    s.category = "Sources/Oscillators";
    s.colour = "#5eead4";
    s.description = "Triangle-core oscillator: two waveforms with a morph between them, through-zero FM and hard sync.";
    ParamSpec coarse = ParamSpec::number("coarse", "Coarse", -12.0f, 12.0f, 0.0f, "st", 1);
    const std::vector<std::string> waves = {"Sine", "Triangle", "Saw", "Square"};
    ParamSpec fine = ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0);
    s.params = {ParamSpec::choice("octave", "Octave", {"-3", "-2", "-1", "0", "+1", "+2", "+3"}, 3),
                coarse,
                fine,
                ParamSpec::choice("wave", "Waveform", waves, 2),
                ParamSpec::choice("wave2", "Secondary", waves, 3),
                ParamSpec::percent("morph", "Morph", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("pw", "Pulse Width", 0.05f, 0.95f, 0.5f),
                ParamSpec::percent("fmdepth", "FM Depth", 0.0f, 1.0f, 0.0f),
                ParamSpec::choice("fmmode", "FM Mode", {"Linear", "Exponential"}, 0),
                ParamSpec::toggle("hardsync", "Hard Sync", true),
                ParamSpec::toggle("tzfm", "Through-Zero", true)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch}, {"fm", "FM", Signal::Audio}, {"sync", "Sync", Signal::Gate}};
    s.outputs = {{"out", "Out", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<OscillatorModule>(spec); });
}

}  // namespace bleep::engine
