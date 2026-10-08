// SPDX-License-Identifier: MIT
// Additive Osc node (specs/modules/additive-oscillator.md): 64 sine partials
// shaped by spectral knobs; the drawn spectrum is node data; the final
// partial levels and frequencies are live arrays for the spectrum view.
#include "AdditiveOscDsp.h"
#include "Handoff.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::AdditiveDrawn;
using patch::AdditiveOscDsp;
using patch::AdditiveOscParams;
using patch::kAdditivePartials;

/// The drawn levels in `data` (padded with 1/n, clamped to 0..1); false if
/// the data has none.
bool parseDrawn(const juce::var& data, AdditiveDrawn& out) {
    out = patch::additiveDefaultDrawn();
    const auto* a = data["drawn"].getArray();
    if (a == nullptr) return false;
    for (int i = 0; i < kAdditivePartials && i < a->size(); ++i) {
        const juce::var v = (*a)[i];
        if (v.isDouble() || v.isInt() || v.isInt64()) {
            const double x = (double)v;
            out[(size_t)i] = std::isfinite(x) ? (float)juce::jlimit(0.0, 1.0, std::round(x * 1e4) / 1e4) : 0.0f;
        }
    }
    return true;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    AdditiveDrawn d;
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    if (parseDrawn(in, d)) {  // a new module has no data until Drawn is edited
        juce::Array<juce::var> levels;
        for (float v : d) levels.add(std::round((double)v * 1e4) / 1e4);
        out->setProperty("drawn", levels);
    }
    return juce::JSON::toString(result, true).toStdString();
}

class AdditiveOscModule final : public Module {
public:
    enum {
        Octave, Coarse, Fine, Partials, Tilt, OddEven, Stretch, Shift, Comb, CombSpacing, CombPhase,
        Chorus, ChorusRate, Width, Decay, Damp, Base, Phases, Normalise, Seed
    };
    enum { Pitch, Trigger };
    enum { OutL, OutR, Odd, Even, Fundamental };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.setPhases(setting(Phases) >= 0.5f, (uint32_t)setting(Seed));
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        auto d = std::make_shared<AdditiveDrawn>();
        parseDrawn(juce::JSON::parse(juce::String(json)), *d);
        drawn_.publish(std::move(d));
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"limit", 0.45 * sampleRate_});  // the band limit, for the spectrum view
    }

    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> levels(kAdditivePartials), hz(kAdditivePartials);
        for (size_t i = 0; i < levels.size(); ++i) {
            levels[i] = shownLevel_[i].load(std::memory_order_relaxed);
            hz[i] = shownHz_[i].load(std::memory_order_relaxed);
        }
        out.push_back({"levels", std::move(levels)});
        out.push_back({"hz", std::move(hz)});
    }

    void process(const ProcessContext& c) override {
        dsp_.setPhases(setting(Phases) >= 0.5f, (uint32_t)setting(Seed));
        if (c.transportStarted) dsp_.reset();
        dsp_.setDrawn(drawn_.get());
        AdditiveOscParams p;
        p.base = (int)setting(Base);
        p.normalise = setting(Normalise) >= 0.5f;
        const float* trig = c.inputs[Trigger];
        for (int i = 0; i < c.numSamples; ++i) {
            if (trig[i] >= 0.5f && lastTrig_ < 0.5f) dsp_.trigger();
            lastTrig_ = trig[i];
            p.pitch = value(c, Octave, i) + value(c, Coarse, i) / 12.0f + value(c, Fine, i) / 1200.0f + c.inputs[Pitch][i];
            if ((i & 7) == 0) {  // the spectral knobs only matter at control rate
                p.partials = value(c, Partials, i);
                p.tilt = value(c, Tilt, i);
                p.oddEven = value(c, OddEven, i);
                p.stretch = value(c, Stretch, i);
                p.shift = value(c, Shift, i);
                p.comb = value(c, Comb, i);
                p.combSpacing = value(c, CombSpacing, i);
                p.combPhase = value(c, CombPhase, i);
                p.chorus = value(c, Chorus, i);
                p.chorusRate = value(c, ChorusRate, i);
                p.width = value(c, Width, i);
                p.decay = value(c, Decay, i);
                p.damp = value(c, Damp, i);
            }
            const auto f = dsp_.process(p);
            c.outputs[OutL][i] = f.outL;
            c.outputs[OutR][i] = f.outR;
            c.outputs[Odd][i] = f.odd;
            c.outputs[Even][i] = f.even;
            c.outputs[Fundamental][i] = f.fundamental;
        }
        for (int k = 0; k < kAdditivePartials; ++k) {
            shownLevel_[(size_t)k].store(dsp_.displayLevel(k), std::memory_order_relaxed);
            shownHz_[(size_t)k].store(dsp_.displayHz(k), std::memory_order_relaxed);
        }
    }

private:
    AdditiveOscDsp dsp_;
    RtHandoff<AdditiveDrawn> drawn_;
    std::string data_;
    float lastTrig_ = 0.0f;
    std::array<std::atomic<float>, kAdditivePartials> shownLevel_{}, shownHz_{};
};

}  // namespace

void registerAdditiveOscModule(Registry& r) {
    ModuleSpec s;
    s.type = "additive-osc";
    s.name = "Additive Osc";
    s.category = "Sources";
    s.colour = "#a3e635";
    s.description = "64 sine partials shaped by tilt, odd/even, stretch, comb and chorus, or a drawn spectrum. Never aliases.";
    ParamSpec decay = ParamSpec::seconds("decay", "Decay", 0.01f, AdditiveOscDsp::kSustain, 1.0f, AdditiveOscDsp::kSustain);
    s.params = {ParamSpec::steppedInt("octave", "Octave", -4, 4, 0).inGroup("Pitch"),
                ParamSpec::number("coarse", "Coarse", -12.0f, 12.0f, 0.0f, "st", 1).inGroup("Pitch"),
                ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0).inGroup("Pitch"),
                ParamSpec::number("partials", "Partials", 1.0f, 64.0f, 32.0f, "", 1).inGroup("Spectrum"),
                ParamSpec::number("tilt", "Tilt", -24.0f, 12.0f, 0.0f, "dB/oct", 1).inGroup("Spectrum"),
                ParamSpec::number("oddEven", "Odd/Even", -1.0f, 1.0f, 0.0f).inGroup("Spectrum"),
                ParamSpec::number("stretch", "Stretch", -1.0f, 1.0f, 0.0f).inGroup("Spectrum"),
                ParamSpec::number("shift", "Shift", -1.0f, 1.0f, 0.0f).inGroup("Spectrum"),
                ParamSpec::percent("comb", "Comb", 0.0f, 1.0f, 0.0f).inGroup("Comb"),
                ParamSpec::number("combSpacing", "Comb Spacing", 2.0f, 16.0f, 4.0f, "", 1).inGroup("Comb"),
                ParamSpec::percent("combPhase", "Comb Phase", 0.0f, 1.0f, 0.0f).inGroup("Comb"),
                ParamSpec::number("chorus", "Chorus", 0.0f, 50.0f, 0.0f, "ct", 1).inGroup("Motion"),
                ParamSpec::hertz("chorusRate", "Chorus Rate", 0.01f, 5.0f, 0.3f).inGroup("Motion"),
                ParamSpec::percent("width", "Width", 0.0f, 1.0f, 0.0f).inGroup("Motion"),
                decay.inGroup("Decay"),
                ParamSpec::percent("damp", "Damp", 0.0f, 1.0f, 0.5f).inGroup("Decay"),
                ParamSpec::choice("base", "Base", {"Saw", "Square", "Flat", "Drawn"}, 0),
                ParamSpec::choice("phases", "Phases", {"Aligned", "Random"}, 1),
                ParamSpec::toggle("normalise", "Normalise", true),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch}, {"trigger", "Trigger", Signal::Trigger}};
    s.outputs = {{"outL", "Out L", Signal::Audio, true},
                 {"outR", "Out R", Signal::Audio, true},
                 {"odd", "Odd", Signal::Audio, true},
                 {"even", "Even", Signal::Audio, true},
                 {"fundamental", "Fundamental", Signal::Audio, true}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<AdditiveOscModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerAdditiveOscModule);

}  // namespace bleep::engine
