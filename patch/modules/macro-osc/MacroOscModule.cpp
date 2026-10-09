// SPDX-License-Identifier: MIT
// Macro Osc node (specs/modules/macro-oscillator.md): sixteen synthesis
// models behind one stepped Model knob; Tone, Shape and Blend (and Aux) are
// renamed per model; Trigger and Accent strike a built-in decay and low-pass
// gate. The view gets a scope of Out and Aux (one or two cycles, triggered on
// a rising zero crossing, or a rolling 50 ms window) and 1024 raw samples for
// its spectrum.
#include "MacroOscDsp.h"
#include "Registry.h"
#include "dsp/Smoothing.h"

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::MacroOscDsp;
using patch::MacroOscParams;

class MacroOscModule final : public Module {
public:
    enum { Model, Octave, Coarse, Fine, Tone, Shape, Blend, FmDepth, Decay, GateColour, Level, Quality, Seed };
    enum { PitchIn, FmIn, TrigIn, AccentIn };
    enum { Out, Aux, Env };
    static constexpr int kScope = 256, kRaw = 1024;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        captureEvery_ = std::max(1, (int)(sampleRate / 25.0));
        reset();
    }
    void reset() override {
        dsp_.reset();
        trig_.reset();
        captureLeft_ = 0;
        capturing_ = armed_ = false;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"model", (double)model_.load(std::memory_order_relaxed)});
        out.push_back({"hz", (double)hz_.load(std::memory_order_relaxed)});
        out.push_back({"env", (double)env_.load(std::memory_order_relaxed)});
        out.push_back({"span", (double)span_.load(std::memory_order_relaxed)});
        out.push_back({"sr", sampleRate_});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> a((size_t)kScope), b((size_t)kScope), r((size_t)kRaw);
        for (size_t i = 0; i < (size_t)kScope; ++i) {
            a[i] = scopeOut_[i].load(std::memory_order_relaxed);
            b[i] = scopeAux_[i].load(std::memory_order_relaxed);
        }
        for (size_t i = 0; i < (size_t)kRaw; ++i) r[i] = raw_[i].load(std::memory_order_relaxed);
        out.push_back({"scope", std::move(a)});
        out.push_back({"scopeAux", std::move(b)});
        out.push_back({"raw", std::move(r)});
    }

    void process(const ProcessContext& c) override {
        dsp_.setQuality((int)setting(Quality));
        dsp_.setSeed((uint32_t)setting(Seed), c.voice);
        if (c.transportStarted) dsp_.reseed();
        dsp_.setGated(c.inputConnected[TrigIn]);
        const bool auxWanted = c.isOutputConnected(Aux);
        dsp_.setWantAux(auxWanted || capturing_ || armed_);
        const bool accentPatched = c.inputConnected[AccentIn];

        MacroOscParams p;
        for (int i = 0; i < c.numSamples; ++i) {
            if (i == 0 || (i & 7) == 0) {  // the skewed / stepped knobs every 8 samples
                p.model = (int)value(c, Model, i);
                p.decay = value(c, Decay, i);
                p.level = value(c, Level, i);
                p.gateColour = value(c, GateColour, i);
                pitchKnobs_ = value(c, Octave, i) + value(c, Coarse, i) / 12.0f + value(c, Fine, i) / 1200.0f;
            }
            const float pin = c.inputs[PitchIn][i];
            p.pitch = (double)pitchKnobs_ + (std::isfinite(pin) ? (double)pin : 0.0);
            p.fm = c.inputs[FmIn][i];
            p.fmDepth = value(c, FmDepth, i);
            p.tone = value(c, Tone, i);
            p.shape = value(c, Shape, i);
            p.blend = value(c, Blend, i);
            const bool trig = trig_.process(c.inputs[TrigIn][i]) > 0;
            const float accent = accentPatched ? c.inputs[AccentIn][i] : 1.0f;
            const auto f = dsp_.process(p, trig, accent);
            c.outputs[Out][i] = f.out;
            c.outputs[Aux][i] = f.aux;
            c.outputs[Env][i] = f.env;
            capture(f.out, f.aux);
        }
        model_.store((float)dsp_.model(), std::memory_order_relaxed);
        hz_.store((float)dsp_.hz(), std::memory_order_relaxed);
        env_.store(dsp_.env(), std::memory_order_relaxed);
    }

private:
    /// The view's scope: armed ~25 times a second; pitched models wait for a
    /// rising zero crossing (at most 40 ms) and show two cycles, the others
    /// show 50 ms. The raw window starts at the same sample.
    void capture(float out, float aux) noexcept {
        if (!armed_ && !capturing_) {
            if (--captureLeft_ > 0) return;
            captureLeft_ = captureEvery_;
            armed_ = true;
            waited_ = 0;
            const int m = dsp_.model();
            periodic_ = patch::macro::isPeriodic(m);
            const double seconds = periodic_ ? 2.0 / std::max(dsp_.hz(), 1.0) : 0.05;
            step_ = std::max(seconds * sampleRate_ / kScope, 1.0 / 64.0);
            span_.store((float)seconds, std::memory_order_relaxed);
        }
        if (armed_) {
            const bool cross = lastOut_ < 0.0f && out >= 0.0f;
            lastOut_ = out;
            if (periodic_ && !cross && ++waited_ < (int)(0.04 * sampleRate_)) return;
            armed_ = false;
            capturing_ = true;
            pos_ = 0.0;
            n_ = 0;
            rawN_ = 0;
            history_ = 0;
        }
        if (rawN_ < kRaw) raw_[(size_t)rawN_++].store(out, std::memory_order_relaxed);
        // Scope points at fractional steps: linear between this and the last sample.
        while (n_ < kScope && pos_ <= (double)history_) {
            const float t = (float)(pos_ - (double)(history_ - 1));
            const float o = history_ == 0 ? out : prevOut_ + std::clamp(t, 0.0f, 1.0f) * (out - prevOut_);
            const float a = history_ == 0 ? aux : prevAux_ + std::clamp(t, 0.0f, 1.0f) * (aux - prevAux_);
            scopeOut_[(size_t)n_].store(o, std::memory_order_relaxed);
            scopeAux_[(size_t)n_].store(a, std::memory_order_relaxed);
            ++n_;
            pos_ += step_;
        }
        prevOut_ = out, prevAux_ = aux;
        ++history_;
        if (n_ >= kScope && rawN_ >= kRaw) capturing_ = false;
    }

    MacroOscDsp dsp_;
    dsp::GateEdge trig_;
    float pitchKnobs_ = 0.0f;

    int captureEvery_ = 1920, captureLeft_ = 0, waited_ = 0, n_ = 0, rawN_ = 0, history_ = 0;
    bool armed_ = false, capturing_ = false, periodic_ = true;
    double step_ = 1.0, pos_ = 0.0;
    float lastOut_ = 0.0f, prevOut_ = 0.0f, prevAux_ = 0.0f;
    std::array<std::atomic<float>, kScope> scopeOut_{}, scopeAux_{};
    std::array<std::atomic<float>, kRaw> raw_{};
    std::atomic<float> model_{0.0f}, hz_{0.0f}, env_{0.0f}, span_{0.0f};
};

}  // namespace

static void registerMacroOscModule(Registry& r) {
    ModuleSpec s;
    s.type = "macro-osc";
    s.name = "Macro Osc";
    s.category = "Sources";
    s.colour = "#38bdf8";
    s.description = "Sixteen synthesis models behind one Model knob and three macro knobs: analog pair, fold, FM, phase "
                    "warp, grains, harmonics, wavetables, chords, vowels, noise, dust, string, modal, kick, snare, metal. "
                    "Aux carries a second voice; Trigger strikes a built-in decay and low-pass gate.";
    const std::vector<std::string> models = {"VA Pair", "Fold",       "FM",   "Phase Warp", "Grain", "Harmonic",
                                             "Table",   "Chord",      "Vowel", "Noise Band", "Dust",  "Pluck",
                                             "Modal",   "Kick",       "Snare", "Metal"};
    ParamSpec model = ParamSpec::stepped("model", "Model", models, 0).inGroup("Model");
    model.choiceGroups = {"Pitched", "Pitched", "Pitched", "Pitched", "Pitched", "Pitched", "Pitched", "Pitched",
                          "Pitched", "Noise",   "Noise",   "Struck",  "Struck",  "Struck",  "Struck",  "Struck"};
    s.params = {
        model,
        ParamSpec::steppedInt("octave", "Octave", -4, 4, 0).inGroup("Pitch"),
        ParamSpec::number("coarse", "Coarse", -12.0f, 12.0f, 0.0f, "st", 1).inGroup("Pitch"),
        ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0).inGroup("Pitch"),
        ParamSpec::percent("tone", "Tone", 0.0f, 1.0f, 0.5f)
            .inGroup("Macro")
            .namedBy("model", {"Detune", "Fold", "Ratio", "Warp", "Formant", "Centre", "Bank", "Chord", "Vowel",
                               "Resonance", "Density", "Bright", "Material", "Sweep", "Snappy", "Colour"}),
        ParamSpec::percent("shape", "Shape", 0.0f, 1.0f, 0.5f)
            .inGroup("Macro")
            .namedBy("model", {"Wave", "Bias", "Index", "Resonance", "Width", "Width", "X", "Voicing", "Size", "Mode",
                               "Colour", "Damping", "Bright", "Punch", "Tone", "Spread"}),
        ParamSpec::percent("blend", "Blend", 0.0f, 1.0f, 0.0f)
            .inGroup("Macro")
            .namedBy("model", {"Sync", "Source", "Feedback", "Mix", "Pair", "Odd/Even", "Y", "Wave", "Breath", "Clock",
                               "Bipolar", "Position", "Stretch", "Drive", "Noise Colour", "Ring"}),
        ParamSpec::percent("fmDepth", "FM Depth", 0.0f, 1.0f, 0.0f).inGroup("Pitch"),
        ParamSpec::seconds("decay", "Decay", 0.005f, 10.0f, 0.6f, 0.4f).inGroup("Gate"),
        ParamSpec::percent("gateColour", "Gate Colour", 0.0f, 1.0f, 0.5f).inGroup("Gate"),
        ParamSpec::percent("level", "Level", 0.0f, 1.0f, 0.8f).inGroup("Gate"),
        ParamSpec::choice("quality", "Quality", {"Eco", "Normal", "High"}, 1),
        ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch},
                {"fm", "FM", Signal::Audio},
                {"trig", "Trigger", Signal::Trigger},
                {"accent", "Accent", Signal::Control}};
    s.outputs = {{"out", "Out", Signal::Audio, true},
                 JackSpec{"aux", "Aux", Signal::Audio, true}.namedBy(
                     "model", {"Aux (Osc 2)", "Aux (Drive)", "Aux (Mod)", "Aux (Sub)", "Aux (Sine)", "Aux (Odd)",
                               "Aux (Oct −1)", "Aux (Root)", "Aux (Breath)", "Aux (Other)", "Aux (Impulses)",
                               "Aux (Exciter)", "Aux (Odd)", "Aux (Click)", "Aux (Noise)", "Aux (Raw)"}),
                 {"env", "Env", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<MacroOscModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerMacroOscModule);

}  // namespace bleep::engine
