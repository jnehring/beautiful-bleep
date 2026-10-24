// SPDX-License-Identifier: GPL-3.0-only
// Pitch Snap node (doc/specs/modules/pitch-snap.md): a real-time pitch corrector.
// Audio in; the same audio with its pitch pulled onto the notes of a scale (its own,
// or the board's harmony), plus the note it is aiming at as a CV.
#include "Registry.h"
#include "PitchSnapDsp.h"
#include "dsp/Harmony.h"

#include <algorithm>
#include <atomic>

namespace bleep::engine {
namespace {

class PitchSnapModule final : public Module {
public:
    enum { Amount, Speed, Drift, DriftTime, Offset, Formant, Root, Scale, Source, Target, Low, High, Tracking, Latency };
    enum { In, OffsetIn };
    enum { Out, TargetOut, PitchOut, ShiftOut };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"note", (double)note_.load(std::memory_order_relaxed)});
        out.push_back({"voiced", voiced_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
    }

    void process(const ProcessContext& c) override {
        patch::PitchSnapParams p;
        const int bus = (int)setting(Source) - 1;
        const dsp::HarmonyState* h = bus >= 0 && bus < dsp::kHarmonyBuses && c.harmony && c.harmony[bus].valid ? &c.harmony[bus] : nullptr;
        if (h) {
            p.scaleMask = dsp::absoluteScale(*h);
            p.chordMask = dsp::absoluteChord(*h);
        } else {
            p.scaleMask = dsp::rotateMask(dsp::scales()[(size_t)std::clamp((int)setting(Scale), 0, 16)].mask, (int)setting(Root));
            p.chordMask = 0;
        }
        p.target = h ? (int)setting(Target) : 0;
        p.amount = value(c, Amount, 0);
        p.speed = value(c, Speed, 0);
        p.drift = value(c, Drift, 0);
        p.driftTime = value(c, DriftTime, 0);
        p.formant = setting(Formant) > 0.5f;
        p.minHz = value(c, Low, 0);
        p.maxHz = value(c, High, 0);
        p.tracking = (int)setting(Tracking);
        p.aligned = setting(Latency) < 0.5f;
        const float knobOffset = value(c, Offset, 0);
        const bool cv = c.inputConnected[OffsetIn];
        patch::PitchSnapFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.offsetSemis = knobOffset + (cv ? 12.0f * c.inputs[OffsetIn][i] : 0.0f);
            f = dsp_.tick(c.inputs[In][i], p);
            c.outputs[Out][i] = f.out;
            c.outputs[TargetOut][i] = f.target;
            c.outputs[PitchOut][i] = f.pitch;
            c.outputs[ShiftOut][i] = f.shift;
        }
        note_.store(dsp_.note(), std::memory_order_relaxed);
        voiced_.store(f.voiced, std::memory_order_relaxed);
    }

private:
    patch::PitchSnapDsp dsp_;
    std::atomic<int> note_{0};
    std::atomic<bool> voiced_{false};
};

}  // namespace

static void registerPitchSnapModule(Registry& r) {
    ModuleSpec s;
    s.type = "pitch-snap";
    s.name = "Pitch Snap";
    s.category = "Effects/Movement";
    s.colour = "#f472b6";
    s.description = "Corrects the pitch of a voice or instrument in real time: it follows the pitch, picks the nearest "
                    "note of a scale or of the board's harmony and shifts toward it, hard or natural, with Drift to keep vibrato.";
    std::vector<std::string> roots, scales;
    for (int k = 0; k < 12; ++k) roots.emplace_back(dsp::pitchClassName(k));
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    s.params = {ParamSpec::percent("amount", "Amount", 0.0f, 1.0f, 1.0f).inGroup("Correction"),
                ParamSpec::percent("speed", "Speed", 0.0f, 1.0f, 0.85f).inGroup("Correction"),
                ParamSpec::percent("drift", "Drift", 0.0f, 1.0f, 0.0f).inGroup("Correction"),
                ParamSpec::seconds("drifttime", "Drift Time", 0.05f, 1.0f, 0.3f, 0.3f).inGroup("Correction"),
                ParamSpec::number("offset", "Offset", -24.0f, 24.0f, 0.0f, "st", 2).inGroup("Correction"),
                ParamSpec::toggle("formant", "Formant Preserve", true).inGroup("Correction"),
                ParamSpec::choice("root", "Root", roots, 0).inGroup("Notes"),
                ParamSpec::choice("scale", "Scale", scales, 1).inGroup("Notes"),
                ParamSpec::choice("source", "Harmony", {"Off", "Bus A", "Bus B", "Bus C", "Bus D"}, 0).inGroup("Notes"),
                ParamSpec::choice("target", "Target", {"Scale", "Chord", "Chord + Scale"}, 0).when("source", 1, 4).inGroup("Notes"),
                ParamSpec::hertz("low", "Low", 30.0f, 400.0f, 70.0f).inGroup("Tracking"),
                ParamSpec::hertz("high", "High", 200.0f, 2000.0f, 900.0f).inGroup("Tracking"),
                ParamSpec::choice("tracking", "Tracking", {"Fast", "Steady", "Rock Solid"}, 1).inGroup("Tracking"),
                ParamSpec::choice("latency", "Latency", {"Aligned", "Quick"}, 0).inGroup("Tracking")};
    s.inputs = {{"in", "In", Signal::Audio}, {"pitchoffset", "Offset", Signal::Pitch}};
    s.outputs = {{"out", "Out", Signal::Audio, true},
                 {"target", "Target", Signal::Pitch, true},
                 {"pitch", "Pitch", Signal::Pitch, true},
                 {"shift", "Shift", Signal::Control, true}};
    s.harmony = HarmonyRole::Reader;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<PitchSnapModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerPitchSnapModule);

}  // namespace bleep::engine
