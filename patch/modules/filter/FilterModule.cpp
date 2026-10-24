// SPDX-License-Identifier: GPL-3.0-only
// Filter node: stereo multimode filter with the algorithms of "The Art of VA
// Filter Design" (Type). Every knob is a destination; cutoff modulation works
// in octaves and may run at audio rate.
#include "FilterDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

using patch::FilterDsp;
using patch::FilterParams;
namespace va = patch::va;

class FilterModule final : public Module {
public:
    enum { Cutoff, Resonance, Drive, Morph, Mix, KeyTrack, Type, Gain, Vowel, Damping, Slope };
    enum { InL, InR, Pitch };
    enum { OutL, OutR, Env };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        // A mono source (only L patched) feeds both channels.
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        FilterParams p;
        p.type = (int)setting(Type);
        for (int i = 0; i < c.numSamples; ++i) {
            p.cutoff = c.params[Cutoff][i];  // normalised = octave domain
            p.resonance = value(c, Resonance, i);
            p.drive = value(c, Drive, i);
            p.morph = std::round(value(c, Morph, i)) / 3.0f;  // Mode steps: LP, BP, HP, Notch
            p.gain = value(c, Gain, i);
            p.vowel = value(c, Vowel, i);
            p.damping = value(c, Damping, i);
            p.slope = (int)std::round(value(c, Slope, i)) + 1;  // 6 dB per section
            p.mix = value(c, Mix, i);
            p.keyTrack = value(c, KeyTrack, i);
            float frame[2] = {c.inputs[InL][i], inR[i]};
            c.outputs[Env][i] = dsp_.tick(p, c.inputs[Pitch][i], frame, 2);
            c.outputs[OutL][i] = frame[0];
            c.outputs[OutR][i] = frame[1];
        }
    }

private:
    FilterDsp dsp_;
};

}  // namespace

void registerFilterModule(Registry& r) {
    ModuleSpec s;
    s.type = "filter";
    s.name = "Multi Filter";
    s.category = "Audio/Filters";
    s.colour = "#f472b6";
    s.description = "Stereo multimode filter: 32 virtual-analog algorithms (SVF, ladders, 1-poles, shelves, phasers, flanger, "
                    "Sallen-Key, vowel formants, tuned comb, staircase), LP/BP/HP/notch mode, drive, key tracking, envelope out.";
    ParamSpec mode = ParamSpec::stepped("mode", "Mode", {"LP", "BP", "HP", "Notch"}, 0);
    std::vector<std::string> names, groups;
    for (const auto& group : patch::va::typeGroups())
        for (const char* name : group.types) {
            names.emplace_back(name);
            groups.emplace_back(group.name);
        }
    ParamSpec types = ParamSpec::choice("type", "Type", names, 0);
    types.choiceGroups = std::move(groups);
    types.legacyChoices = patch::va::legacyNames();  // boards saved with the 25-algorithm list
    s.params = {ParamSpec::hertz("cutoff", "Cutoff", 20.0f, 20000.0f, 2000.0f),
                ParamSpec::percent("resonance", "Resonance", 0.0f, 1.0f, 0.2f),
                ParamSpec::percent("drive", "Drive", 0.0f, 1.0f, 0.0f),
                mode,
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("keytrack", "Key Track", 0.0f, 1.0f, 0.0f),
                types,
                ParamSpec::number("gain", "Gain", -24.0f, 24.0f, 0.0f, "dB", 1),
                // Per-type controls (appended: saved boards keep their parameters).
                ParamSpec::percent("vowel", "Vowel", 0.0f, 1.0f, 0.0f).when("type", (int)va::FilterType::Vowel, (int)va::FilterType::Vowel),
                ParamSpec::percent("damping", "Damping", 0.0f, 1.0f, 0.3f).when("type", (int)va::FilterType::CombPositive, (int)va::FilterType::CombNegative),
                ParamSpec::stepped("slope", "Slope", {"6 dB", "12 dB", "18 dB", "24 dB", "30 dB", "36 dB", "42 dB", "48 dB"}, 3)
                    .when("type", (int)va::FilterType::StaircaseLp, (int)va::FilterType::StaircaseHp)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}, {"pitch", "Pitch", Signal::Pitch}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true},
                 {"env", "Env", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<FilterModule>(spec); });
}

}  // namespace bleep::engine
