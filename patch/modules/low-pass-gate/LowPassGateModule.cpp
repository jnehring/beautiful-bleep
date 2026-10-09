// SPDX-License-Identifier: MIT
// Low Pass Gate node: a vactrol-modelled filter + VCA, opened by CV and Ping
// flashes (doc/specs/modules/low-pass-gate.md). Light and Active outputs for
// Voice Cells; the view draws the cell's last 2 s and the current cutoff.
#include "LowPassGateDsp.h"
#include "Registry.h"
#include "dsp/Smoothing.h"

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::LowPassGateDsp;
using patch::LowPassGateParams;

class LowPassGateModule final : public Module {
public:
    enum { Level, Response, PingKnob, Resonance, Brightness, Drive, Bleed, Mode, Cell };
    enum { InL, InR, Cv, Ping, Velocity };
    enum { OutL, OutR, Light, Active };
    enum { PingButton };

    static constexpr int kHistory = 128;          // points over 2 s
    static constexpr double kHistorySeconds = 2.0;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        pointLen_ = std::max(1, (int)(kHistorySeconds * sampleRate / kHistory));
        reset();
    }
    void reset() override {
        dsp_.reset();
        edge_.reset();
        button_ = false;
        pointLeft_ = pointLen_;
        peakC_ = peakL_ = 0.0f;
    }

    void process(const ProcessContext& c) override {
        bool buttonPing = false;
        pollCommands([&](const Command& cmd) {
            if (cmd.index != PingButton) return;
            const bool down = cmd.value > 0.5f;
            if (down && !button_) buttonPing = true;
            button_ = down;
        });
        const bool velocityPatched = c.inputConnected[Velocity];
        const bool cvPatched = c.inputConnected[Cv];
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        LowPassGateParams p;
        p.mode = (int)setting(Mode);
        p.cell = (int)setting(Cell);
        constexpr int kSub = 8;
        for (int s0 = 0; s0 < c.numSamples; s0 += kSub) {
            p.level = value(c, Level, s0);
            p.response = value(c, Response, s0);
            p.ping = value(c, PingKnob, s0);
            p.resonance = value(c, Resonance, s0);
            p.brightness = value(c, Brightness, s0);
            p.drive = value(c, Drive, s0);
            p.bleed = value(c, Bleed, s0);
            dsp_.set(p);
            if (buttonPing) {
                dsp_.ping(dsp_.pingHeight());
                buttonPing = false;
            }
            const int end = std::min(c.numSamples, s0 + kSub);
            for (int i = s0; i < end; ++i) {
                if (edge_.process(c.inputs[Ping][i]) > 0) {
                    const float vel = velocityPatched ? std::clamp(c.inputs[Velocity][i], 0.0f, 1.0f) : 1.0f;
                    dsp_.ping(dsp_.pingHeight() * vel);
                }
                float cv = cvPatched ? c.inputs[Cv][i] : 0.0f;
                if (!std::isfinite(cv)) cv = 0.0f;
                const auto f = dsp_.tick(c.inputs[InL][i], inR[i], cv);
                c.outputs[OutL][i] = std::clamp(f.l, -10.0f, 10.0f);
                c.outputs[OutR][i] = std::clamp(f.r, -10.0f, 10.0f);
                c.outputs[Light][i] = std::min(f.light, 1.0f);
                c.outputs[Active][i] = f.active ? 1.0f : 0.0f;
                record(f.light, dsp_.light());
            }
        }
        cutoff_.store(dsp_.cutoffHz(), std::memory_order_relaxed);
        open_.store(dsp_.openness(), std::memory_order_relaxed);
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"cutoff", cutoff_.load(std::memory_order_relaxed)});
        out.push_back({"c", open_.load(std::memory_order_relaxed)});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> c((size_t)kHistory), l((size_t)kHistory);
        const int w = write_.load(std::memory_order_acquire);
        for (int k = 0; k < kHistory; ++k) {
            const int i = (w + k) % kHistory;  // oldest first
            c[(size_t)k] = histC_[(size_t)i].load(std::memory_order_relaxed);
            l[(size_t)k] = histL_[(size_t)i].load(std::memory_order_relaxed);
        }
        out.push_back({"c", std::move(c)});
        out.push_back({"light", std::move(l)});
    }

private:
    /// Keeps the peak of c and of the light over each history point.
    void record(float c, float light) noexcept {
        peakC_ = std::max(peakC_, c);
        peakL_ = std::max(peakL_, light);
        if (--pointLeft_ > 0) return;
        pointLeft_ = pointLen_;
        const int w = write_.load(std::memory_order_relaxed);
        histC_[(size_t)w].store(peakC_, std::memory_order_relaxed);
        histL_[(size_t)w].store(peakL_, std::memory_order_relaxed);
        write_.store((w + 1) % kHistory, std::memory_order_release);
        peakC_ = peakL_ = 0.0f;
    }

    LowPassGateDsp dsp_;
    dsp::GateEdge edge_;
    bool button_ = false;
    int pointLen_ = 750, pointLeft_ = 750;
    float peakC_ = 0.0f, peakL_ = 0.0f;
    std::array<std::atomic<float>, kHistory> histC_{}, histL_{};
    std::atomic<int> write_{0};
    std::atomic<float> cutoff_{0.0f}, open_{0.0f};
};

}  // namespace

static void registerLowPassGateModule(Registry& r) {
    ModuleSpec s;
    s.type = "low-pass-gate";
    s.name = "Low Pass Gate";
    s.category = "Audio";
    s.colour = "#4ade80";
    s.description = "Filter and VCA in one, opened by a modelled vactrol: fast to open, slow and darkening to close. "
                    "Ping it for an organic pluck; Active frees a Voice Cell's voice.";
    s.params = {ParamSpec::percent("level", "Level", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("response", "Response", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("ping", "Ping", 0.0f, 1.0f, 0.8f),
                ParamSpec::percent("resonance", "Resonance", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("brightness", "Brightness", 0.0f, 1.0f, 0.75f),
                ParamSpec::percent("drive", "Drive", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("bleed", "Bleed", 0.0f, 1.0f, 0.0f),
                ParamSpec::choice("mode", "Mode", {"LP", "VCA", "Both"}, 2),
                ParamSpec::choice("cell", "Cell", {"Fast", "Classic", "Slow memory"}, 1)};
    s.inputs = {{"l", "In L", Signal::Audio},
                {"r", "In R", Signal::Audio},
                {"cv", "CV", Signal::Control},
                {"ping", "Ping", Signal::Trigger},
                {"velocity", "Velocity", Signal::Control}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},
                 {"r", "Out R", Signal::Audio, true},
                 {"light", "Light", Signal::Control, false},
                 {"active", "Active", Signal::Gate, false}};
    s.buttons = {{"ping", "Ping", true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<LowPassGateModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerLowPassGateModule);

}  // namespace bleep::engine
