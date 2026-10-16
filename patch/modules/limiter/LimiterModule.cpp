// SPDX-License-Identifier: MIT
// Limiter node (doc/limiter.md): a stereo-linked brickwall limiter with lookahead.
#include "LimiterDsp.h"
#include "Registry.h"

#include <algorithm>
#include <atomic>
#include <cmath>

namespace bleep::engine {
namespace {

using patch::LimiterDsp;
using patch::LimiterParams;

constexpr float kLookaheadMs[] = {0.0f, 1.0f, 2.0f, 5.0f};

class LimiterModule final : public Module {
public:
    enum { Ceiling, Release, Input, Lookahead };
    enum { InL, InR };
    enum { OutL, OutR, Reduction };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"reductionDb", (double)reduction_.load()});
    }

    void process(const ProcessContext& c) override {
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        const int mode = std::clamp((int)std::lround(setting(Lookahead)), 0, 3);
        dsp_.setLookahead(std::max(1, (int)std::lround(kLookaheadMs[mode] * 0.001 * sampleRate_)));
        LimiterParams p;
        float worst = 1.0f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.ceilingDb = value(c, Ceiling, i);
            p.releaseMs = value(c, Release, i);
            p.inputDb = value(c, Input, i);
            const float x[2] = {c.inputs[InL][i], inR[i]};
            float y[2];
            const float g = dsp_.tick(x, y, p);
            c.outputs[OutL][i] = y[0];
            c.outputs[OutR][i] = y[1];
            c.outputs[Reduction][i] = std::min(-20.0f * std::log10(std::max(g, 1e-6f)) * (1.0f / 12.0f), 1.0f);
            worst = std::min(worst, g);
        }
        reduction_.store(20.0f * std::log10(std::max(worst, 1e-6f)));
    }

private:
    LimiterDsp dsp_;
    std::atomic<float> reduction_{0.0f};
};

}  // namespace

static void registerLimiterModule(Registry& r) {
    ModuleSpec s;
    s.type = "limiter";
    s.name = "Limiter";
    s.category = "Effects/Dynamics & EQ";
    s.colour = "#64748b";
    s.description = "Brickwall stereo limiter: nothing passes the ceiling. Lookahead, release, input gain "
                    "and a gain reduction output you can patch.";
    s.params = {ParamSpec::number("ceiling", "Ceiling", -12.0f, 0.0f, -0.3f, "dB", 1),
                ParamSpec::exponential("release", "Release", 10.0f, 1000.0f, 100.0f, "ms"),
                ParamSpec::number("input", "Input", 0.0f, 24.0f, 0.0f, "dB", 1),
                ParamSpec::choice("lookahead", "Lookahead", {"Off", "1 ms", "2 ms", "5 ms"}, 2)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true},
                 {"reduction", "Reduction", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<LimiterModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerLimiterModule);

}  // namespace bleep::engine
