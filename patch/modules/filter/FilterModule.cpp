// SPDX-License-Identifier: GPL-3.0-only
// Filter node: stereo multimode filter with the algorithms of "The Art of VA
// Filter Design" (Type). Every knob is a destination; cutoff modulation works
// in octaves and may run at audio rate.
#include "FilterDsp.h"
#include "Registry.h"
#include "dsp/SpectrumTap.h"

namespace bleep::engine {
namespace {

using patch::FilterDsp;
using patch::FilterParams;
namespace va = patch::va;

class FilterModule final : public Module {
public:
    enum { Cutoff, Resonance, Drive, Morph, Mix, KeyTrack, Type, Gain, Vowel, Damping, Slope, Analog };
    enum { InL, InR, Pitch };
    enum { OutL, OutR, Env };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    /// For the view: the audio going in and out (log-spaced dB, 20 Hz ... 20 kHz) and the sample rate, drawn behind the response curve.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> in(kBins), wet(kBins);
        tap_.spectrum(false, sampleRate_, in);
        tap_.spectrum(true, sampleRate_, wet);
        out.emplace_back("spectrumIn", std::move(in));
        out.emplace_back("spectrumOut", std::move(wet));
        out.emplace_back("sampleRate", std::vector<float>{(float)sampleRate_});
    }

    void process(const ProcessContext& c) override {
        // A mono source (only L patched) feeds both channels.
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        FilterParams p;
        p.type = (int)setting(Type);
        p.morph = std::round(setting(Morph)) / 3.0f;  // Mode: LP, BP, HP, Notch
        for (int i = 0; i < c.numSamples; ++i) {
            p.cutoff = c.params[Cutoff][i];  // normalised = octave domain
            p.resonance = value(c, Resonance, i);
            p.drive = value(c, Drive, i);
            p.gain = value(c, Gain, i);
            p.vowel = value(c, Vowel, i);
            p.damping = value(c, Damping, i);
            p.slope = (int)std::round(value(c, Slope, i)) + 1;  // 6 dB per section
            p.mix = value(c, Mix, i);
            p.analog = value(c, Analog, i);
            p.keyTrack = value(c, KeyTrack, i);
            float frame[2] = {c.inputs[InL][i], inR[i]};
            c.outputs[Env][i] = dsp_.tick(p, c.inputs[Pitch][i], frame, 2);
            c.outputs[OutL][i] = frame[0];
            c.outputs[OutR][i] = frame[1];
            tap_.push(0.5f * (c.inputs[InL][i] + inR[i]), 0.5f * (frame[0] + frame[1]));
        }
    }

private:
    static constexpr int kBins = 128;

    FilterDsp dsp_;
    dsp::SpectrumTap tap_;
};

}  // namespace

void registerFilterModule(Registry& r) {
    ModuleSpec s;
    s.type = "filter";
    s.name = "Multi Filter";
    s.category = "Audio/Filters";
    s.colour = "#f472b6";
    s.description = "Stereo multimode filter: 38 virtual-analog algorithms (SVF, ladders, 1-poles, shelves, phasers, flanger, "
                    "Sallen-Key, vowel formants, tuned comb, staircase, op-amp, diode, OTA and CMOS circuits), LP/BP/HP/notch "
                    "mode, drive per algorithm, analog character, key tracking, envelope out.";
    using T = va::FilterType;
    // Mode only where it does something: the multimode types mix LP, BP, HP and notch; the phasers and the
    // flanger read it as polarity (Phaser 2-Pole also as notch spacing). A setting, so a cable sets it.
    ParamSpec mode = ParamSpec::choice("mode", "Mode", {"Low-pass", "Band-pass", "High-pass", "Notch"}, 0)
                         .whenAny("type", {(int)T::Svf, (int)T::Ladder, (int)T::LadderFeedbackHp, (int)T::LadderTanh,
                                           (int)T::LadderHyperbolic, (int)T::LadderNonlinear, (int)T::Phaser1, (int)T::Phaser2,
                                           (int)T::Flanger, (int)T::Biquad, (int)T::SvfAtanh, (int)T::SvfHyperbolic,
                                           (int)T::SvfSaturating, (int)T::SlewSvf, (int)T::DiodePair, (int)T::Ota4,
                                           (int)T::CmosSvf});
    std::vector<std::string> names, groups;
    for (const auto& group : patch::va::typeGroups())
        for (const char* name : group.types) {
            names.emplace_back(name);
            groups.emplace_back(group.name);
        }
    // Resonance on every type but the 1-poles, which have none.
    std::vector<int> resonant;
    for (int t = 0; t < va::kNumTypes; ++t)
        if ((t < (int)T::OnePoleLp || t > (int)T::OnePoleHighShelf) && t != (int)T::NaiveOnePole) resonant.push_back(t);
    ParamSpec types = ParamSpec::choice("type", "Type", names, 0);
    types.choiceGroups = std::move(groups);
    types.legacyChoices = patch::va::legacyLists();  // boards saved with the 25- and the 32-algorithm lists
    // Analog on every type but the two digital ones.
    std::vector<int> analogTypes;
    for (int t = 0; t < va::kNumTypes; ++t)
        if (t != (int)T::NaiveOnePole && t != (int)T::Biquad) analogTypes.push_back(t);
    s.params = {ParamSpec::hertz("cutoff", "Cutoff", 20.0f, 20000.0f, 2000.0f),
                ParamSpec::percent("resonance", "Resonance", 0.0f, 1.0f, 0.2f).whenAny("type", resonant),
                ParamSpec::percent("drive", "Drive", 0.0f, 1.0f, 0.0f),
                mode,
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("keytrack", "Key Track", 0.0f, 1.0f, 0.0f),
                types,
                ParamSpec::number("gain", "Gain", -24.0f, 24.0f, 0.0f, "dB", 1)
                    .whenAny("type", {(int)T::SvfBandShelf, (int)T::OnePoleLowShelf, (int)T::OnePoleHighShelf, (int)T::Vowel}),
                // Per-type controls (appended: saved boards keep their parameters).
                ParamSpec::percent("vowel", "Vowel", 0.0f, 1.0f, 0.0f).when("type", (int)va::FilterType::Vowel, (int)va::FilterType::Vowel),
                ParamSpec::percent("damping", "Damping", 0.0f, 1.0f, 0.3f).when("type", (int)va::FilterType::CombPositive, (int)va::FilterType::CombNegative),
                ParamSpec::stepped("slope", "Slope", {"6 dB", "12 dB", "18 dB", "24 dB", "30 dB", "36 dB", "42 dB", "48 dB"}, 3)
                    .when("type", (int)va::FilterType::StaircaseLp, (int)va::FilterType::StaircaseHp),
                ParamSpec::percent("analog", "Analog", 0.0f, 1.0f, 0.5f).whenAny("type", analogTypes)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}, {"pitch", "Pitch", Signal::Pitch}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true},
                 {"env", "Env", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<FilterModule>(spec); });
}

}  // namespace bleep::engine
