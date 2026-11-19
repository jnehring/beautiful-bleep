// SPDX-License-Identifier: GPL-3.0-only
// Oscillator node: triangle core, a waveform and a secondary one with Morph between them, linear (optionally
// through zero) or exponential FM or phase modulation, hard sync, a sub oscillator mixed into Out, Drift, a Reset
// input that restarts the cycle at Phase, and a Sync Out pulse at each cycle start. Pitch: Tuned (Octave, Coarse
// in semitones, Fine in cents, from C4) or Free (Coarse and Fine in Hz, no Octave); the Pitch input is 1 V/oct in
// both.
#include "OscillatorDsp.h"
#include "Registry.h"

#include <algorithm>
#include <atomic>
#include <cmath>

namespace bleep::engine {
namespace {

using patch::OscillatorDsp;
using patch::OscillatorParams;
using patch::OscWave;

class OscillatorModule final : public Module {
public:
    enum { Octave, Coarse, Fine, Wave, Wave2, Morph, PulseWidth, FmDepth, FmMode, HardSync, ThroughZero, FreePitch, FreeCoarse, FreeFine,
           Phase, SubLevel, SubOctave, SubWave, Drift };
    enum { Pitch, Fm, Sync, Reset };
    enum { Out, SyncOut };

    explicit OscillatorModule(const ModuleSpec& spec) : Module(spec) {
        // Each Oscillator (and each voice of a Voice Cell) drifts its own way.
        static std::atomic<uint64_t> instances{0};
        dsp_.seedDrift(0x05c1ull + instances.fetch_add(1, std::memory_order_relaxed));
    }

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        const float octave = setting(Octave) - 3.0f;  // choice index 0..6 → −3..+3
        const bool free = setting(FreePitch) >= 0.5f;
        OscillatorParams p;
        p.freePitch = free;
        p.wave = wave(setting(Wave));
        p.wave2 = wave(setting(Wave2));
        const int fmMode = (int)std::lround(setting(FmMode));   // Linear, Phase, Exponential
        p.phaseMod = fmMode == 1;
        p.expFm = fmMode == 2;
        p.subOctaves = setting(SubOctave) >= 0.5f ? 2 : 1;
        p.subSine = setting(SubWave) >= 0.5f;
        const bool syncOut = c.isOutputConnected(SyncOut);
        p.hardSync = setting(HardSync) >= 0.5f;
        p.throughZero = setting(ThroughZero) >= 0.5f;
        for (int i = 0; i < c.numSamples; ++i) {
            if (free) {
                p.freeHz = value(c, FreeCoarse, i) + value(c, FreeFine, i);
                p.pitch = c.inputs[Pitch][i];
            } else {
                p.pitch = octave + value(c, Coarse, i) / 12.0f + value(c, Fine, i) / 1200.0f + c.inputs[Pitch][i];
            }
            p.morph = value(c, Morph, i);
            p.pulseWidth = value(c, PulseWidth, i);
            p.fmDepth = value(c, FmDepth, i);
            p.phase = value(c, Phase, i) / 360.0f;
            p.subLevel = value(c, SubLevel, i);
            p.drift = value(c, Drift, i);
            c.outputs[Out][i] = dsp_.tick(p, c.inputs[Fm][i], c.inputs[Sync][i], c.inputs[Reset][i]);
            if (syncOut) c.outputs[SyncOut][i] = dsp_.syncOut() ? 1.0f : 0.0f;
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
    s.description = "Triangle-core oscillator: two waveforms with a morph between them, a sub oscillator, through-zero FM, "
                    "phase modulation, hard sync and analog drift.";
    ParamSpec coarse = ParamSpec::number("coarse", "Coarse", -12.0f, 12.0f, 0.0f, "st", 1);
    const std::vector<std::string> waves = {"Sine", "Triangle", "Saw", "Square"};
    ParamSpec fine = ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0);
    s.params = {ParamSpec::choice("octave", "Octave", {"-3", "-2", "-1", "0", "+1", "+2", "+3"}, 3).when("freepitch", 0, 0),
                coarse.when("freepitch", 0, 0),
                fine.when("freepitch", 0, 0),
                ParamSpec::choice("wave", "Waveform", waves, 2),
                ParamSpec::choice("wave2", "Secondary", waves, 3),
                ParamSpec::percent("morph", "Morph", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("pw", "Pulse Width", 0.05f, 0.95f, 0.5f),
                ParamSpec::percent("fmdepth", "FM Depth", 0.0f, 1.0f, 0.0f),
                // Phase sits between the two, so boards saved with two modes keep Exponential (stored as 1).
                ParamSpec::choice("fmmode", "FM Mode", {"Linear", "Phase", "Exponential"}, 0),
                ParamSpec::toggle("hardsync", "Hard Sync", true),
                ParamSpec::toggle("tzfm", "Through-Zero", true),
                // Pitch mode: off Tuned (Octave, Coarse in semitones, Fine in cents), on Free (Coarse and Fine in Hz).
                // Free Coarse starts at C4, so switching over at the defaults keeps the pitch.
                ParamSpec::toggle("freepitch", "Free", false),
                ParamSpec::hertz("freehz", "Coarse", 0.1f, 20000.0f, 261.63f).when("freepitch", 1, 1),
                ParamSpec::number("freefine", "Fine", -10.0f, 10.0f, 0.0f, "Hz", 2).when("freepitch", 1, 1),
                ParamSpec::number("phase", "Phase", 0.0f, 360.0f, 0.0f, "°", 0),
                ParamSpec::percent("sublevel", "Sub Level", 0.0f, 1.0f, 0.0f),
                ParamSpec::choice("suboct", "Sub Octave", {"-1", "-2"}, 0),
                ParamSpec::choice("subwave", "Sub Wave", {"Square", "Sine"}, 0),
                ParamSpec::percent("drift", "Drift", 0.0f, 1.0f, 0.0f)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch},
                {"fm", "FM", Signal::Audio},
                {"sync", "Sync", Signal::Gate},
                {"reset", "Reset", Signal::Trigger}};
    s.outputs = {{"out", "Out", Signal::Audio, true}, {"syncout", "Sync Out", Signal::Gate, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<OscillatorModule>(spec); });
}

}  // namespace bleep::engine
