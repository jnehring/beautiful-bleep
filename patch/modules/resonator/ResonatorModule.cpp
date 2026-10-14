// SPDX-License-Identifier: MIT
// Resonator node: a tuned body (modal, sympathetic strings or a plucked
// string) that rings with its input and with an internal exciter on each
// strum, up to four voices round robin (doc/specs/modules/resonator.md). The
// view draws the active voice's modes or strings from live arrays.
#include "Registry.h"
#include "ResonatorDsp.h"
#include "dsp/Smoothing.h"

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::ResonatorDsp;
using patch::ResonatorModel;
using patch::ResonatorParams;

class ResonatorModule final : public Module {
public:
    enum { Frequency, Structure, Brightness, Damping, Position, InputGain, Exciter, Width, Dry, Model, Polyphony, Modes,
           StrumSource, Seed };
    enum { In, Strum, Pitch };
    enum { Odd, Even, Mix };
    enum { StrumButton };

    static constexpr int kMaxShown = 64;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        viewEvery_ = std::max(1, (int)(sampleRate / 30.0));
        reset();
    }
    void reset() override {
        dsp_.reset();
        edge_.reset();
        sub_ = 0;
    }

    void process(const ProcessContext& c) override {
        bool button = false;
        pollCommands([&](const Command& cmd) { button = button || (cmd.index == StrumButton && cmd.value > 0.5f); });
        if (c.transportStarted) dsp_.resetCount();
        ResonatorParams p;
        p.model = (ResonatorModel)std::clamp((int)setting(Model), 0, 2);
        static constexpr int polys[3] = {1, 2, 4}, modes[3] = {16, 32, 64};
        p.polyphony = polys[std::clamp((int)setting(Polyphony), 0, 2)];
        p.modes = modes[std::clamp((int)setting(Modes), 0, 2)];
        p.inputOnsets = setting(StrumSource) > 0.5f;
        p.seed = (uint64_t)setting(Seed);
        const float* in = c.inputs[In];
        const float* pitch = c.inputs[Pitch];
        for (int i = 0; i < c.numSamples; ++i) {
            if (sub_ == 0) {
                read(c, i, p);
                dsp_.set(p);
            }
            sub_ = (sub_ + 1) % ResonatorDsp::kSub;
            const bool strum = edge_.process(c.inputs[Strum][i]) > 0;
            if (strum || (button && i == 0)) dsp_.strum(std::isfinite(pitch[i]) ? pitch[i] : 0.0f);
            const auto f = dsp_.tick(in[i], pitch[i]);
            c.outputs[Odd][i] = f.odd;
            c.outputs[Even][i] = f.even;
            c.outputs[Mix][i] = std::clamp(f.odd + f.even, -10.0f, 10.0f);
        }
        viewLeft_ -= c.numSamples;
        if (viewLeft_ <= 0) {
            viewLeft_ = viewEvery_;
            publishView();
        }
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"active", active_.load(std::memory_order_relaxed)});
        for (int v = 0; v < ResonatorDsp::kVoices; ++v)
            out.push_back({"voiceEnergy" + std::to_string(v + 1), energy_[(size_t)v].load(std::memory_order_relaxed)});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        const int n = shown_.load(std::memory_order_acquire);
        std::vector<float> hz((size_t)n), amp((size_t)n), level((size_t)n);
        for (size_t k = 0; k < (size_t)n; ++k) {
            hz[k] = hz_[k].load(std::memory_order_relaxed);
            amp[k] = amp_[k].load(std::memory_order_relaxed);
            level[k] = level_[k].load(std::memory_order_relaxed);
        }
        out.push_back({"modeHz", std::move(hz)});
        out.push_back({"modeAmp", std::move(amp)});
        out.push_back({"modeLevel", std::move(level)});
    }

private:
    void read(const ProcessContext& c, int i, ResonatorParams& p) const noexcept {
        p.frequency = value(c, Frequency, i);
        p.structure = value(c, Structure, i);
        p.brightness = value(c, Brightness, i);
        p.damping = value(c, Damping, i);
        p.position = value(c, Position, i);
        p.inputGainDb = value(c, InputGain, i);
        p.exciter = value(c, Exciter, i);
        p.width = value(c, Width, i);
        p.dry = value(c, Dry, i);
    }

    /// The active voice's modes (Modal), strings (Sympathetic) or nothing
    /// (String: the view draws the string from the knobs).
    void publishView() noexcept {
        const int a = dsp_.activeVoice();
        active_.store((float)a, std::memory_order_relaxed);
        for (int v = 0; v < ResonatorDsp::kVoices; ++v)
            energy_[(size_t)v].store(dsp_.voiceLevel(v), std::memory_order_relaxed);
        int n = 0;
        if (dsp_.model() == ResonatorModel::Modal) {
            const auto& b = dsp_.bank(a);
            n = std::min(b.activeModes(), kMaxShown);
            for (int k = 0; k < n; ++k) {
                hz_[(size_t)k].store(b.modeHz(k), std::memory_order_relaxed);
                amp_[(size_t)k].store(b.modeGain(k), std::memory_order_relaxed);
                level_[(size_t)k].store(dsp_.ringing(a) ? b.modeLevel(k) : 0.0f, std::memory_order_relaxed);
            }
        } else if (dsp_.model() == ResonatorModel::Sympathetic) {
            n = 8;
            for (int k = 0; k < n; ++k) {
                hz_[(size_t)k].store(dsp_.voiceHz(a) * std::exp2(dsp_.interval(a, k) / 12.0f), std::memory_order_relaxed);
                amp_[(size_t)k].store(1.0f, std::memory_order_relaxed);
                level_[(size_t)k].store(dsp_.ringing(a) ? std::fabs(dsp_.sympathetic(a).string(k).output()) : 0.0f,
                                        std::memory_order_relaxed);
            }
        }
        shown_.store(n, std::memory_order_release);
    }

    ResonatorDsp dsp_;
    dsp::GateEdge edge_;
    int sub_ = 0, viewEvery_ = 1600, viewLeft_ = 0;
    std::array<std::atomic<float>, kMaxShown> hz_{}, amp_{}, level_{};
    std::array<std::atomic<float>, ResonatorDsp::kVoices> energy_{};
    std::atomic<int> shown_{0};
    std::atomic<float> active_{0.0f};
};

}  // namespace

static void registerResonatorModule(Registry& r) {
    ModuleSpec s;
    s.type = "resonator";
    s.name = "Resonator";
    s.category = "Effects/Textures";
    s.colour = "#0891b2";
    s.description = "A tuned resonant body that rings when something hits it: modal (string, bar, plate, bell), "
                    "sympathetic strings or a plucked string. Feed it audio or strum it; up to four voices.";
    ParamSpec frequency = ParamSpec::number("frequency", "Frequency", -48.0f, 48.0f, 0.0f, "st", 1);
    frequency.format = ParamSpec::Format::Semitones;
    s.params = {frequency,
                ParamSpec::percent("structure", "Structure", 0.0f, 1.0f, 0.25f)
                    .namedBy("model", {"Structure", "Tuning", "Stiffness"}),
                ParamSpec::percent("brightness", "Brightness", 0.0f, 1.0f, 0.6f),
                ParamSpec::percent("damping", "Damping", 0.0f, 1.0f, 0.45f),
                ParamSpec::percent("position", "Position", 0.0f, 1.0f, 0.3f),
                ParamSpec::number("inputgain", "Input Gain", -24.0f, 24.0f, 0.0f, "dB", 1),
                ParamSpec::percent("exciter", "Exciter", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("width", "Width", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("dry", "Dry", 0.0f, 1.0f, 0.0f),
                ParamSpec::choice("model", "Model", {"Modal", "Sympathetic", "String"}, 0),
                ParamSpec::choice("polyphony", "Polyphony", {"1", "2", "4"}, 0),
                ParamSpec::choice("modes", "Modes", {"16", "32", "64"}, 1).when("model", 0, 0),
                ParamSpec::choice("strumsource", "Strum Source", {"Jack", "Input onsets"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"in", "In", Signal::Audio}, {"strum", "Strum", Signal::Trigger}, {"pitch", "Pitch", Signal::Pitch}};
    s.outputs = {{"odd", "Odd", Signal::Audio, true},
                 {"even", "Even", Signal::Audio, true},
                 {"mix", "Mix", Signal::Audio, true}};
    s.buttons = {{"strum", "Strum"}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ResonatorModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerResonatorModule);

}  // namespace bleep::engine
