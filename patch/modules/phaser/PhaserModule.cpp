// SPDX-License-Identifier: MIT
// Phaser node (doc/phaser.md): a swept allpass cascade per channel, mixed with the dry signal.
#include "PhaserDsp.h"
#include "Registry.h"

#include <algorithm>
#include <cmath>

namespace bleep::engine {
namespace {

using patch::PhaserDsp;

class PhaserModule final : public Module {
public:
    enum { Rate, Depth, Centre, Feedback, Stages, Spread, Mix };
    enum { InL, InR };
    enum { OutL, OutR };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_[0].prepare(sampleRate);
        dsp_[1].prepare(sampleRate);
    }
    void reset() override {
        dsp_[0].reset();
        dsp_[1].reset();
        phase_ = 0.0;
    }

    void process(const ProcessContext& c) override {
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        const int stages = 2 * (1 + std::clamp((int)setting(Stages), 0, 5));  // 2, 4, 6, 8, 10, 12
        for (int i = 0; i < c.numSamples; ++i) {
            phase_ += (double)value(c, Rate, i) / sampleRate_;
            phase_ -= std::floor(phase_);
            const float depth = value(c, Depth, i), centre = value(c, Centre, i), fb = value(c, Feedback, i);
            const double offsetR = 0.5 * (double)value(c, Spread, i);
            const float mix = value(c, Mix, i);
            const float in[2] = {c.inputs[InL][i], inR[i]};
            for (int ch = 0; ch < 2; ++ch) {
                // A sine sweep of up to ±3 octaves around the centre frequency.
                const float lfo = (float)std::sin(6.283185307179586 * (phase_ + (ch ? offsetR : 0.0)));
                const float hz = centre * std::exp2(3.0f * depth * lfo);
                const float wet = dsp_[ch].tick(in[ch], hz, stages, fb);
                c.outputs[ch][i] = in[ch] + mix * (wet - in[ch]);  // 50 % gives the deepest notches
            }
        }
    }

private:
    PhaserDsp dsp_[2];
    double phase_ = 0.0;
};

}  // namespace

static void registerPhaserModule(Registry& r) {
    ModuleSpec s;
    s.type = "phaser";
    s.name = "Phaser";
    s.category = "Effects/Movement";
    s.colour = "#f97316";
    s.description = "Stereo phaser: 2 to 12 swept allpass stages, feedback in both polarities, "
                    "a stereo LFO offset. Mixed with the dry signal it makes moving notches.";
    s.params = {ParamSpec::exponential("rate", "Rate", 0.02f, 10.0f, 0.3f, "Hz"),
                ParamSpec::percent("depth", "Depth", 0.0f, 1.0f, 0.6f),
                ParamSpec::exponential("centre", "Centre", 80.0f, 6000.0f, 700.0f, "Hz"),
                ParamSpec::percent("feedback", "Feedback", -0.95f, 0.95f, 0.4f),
                ParamSpec::choice("stages", "Stages", {"2", "4", "6", "8", "10", "12"}, 1),
                ParamSpec::percent("spread", "Spread", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 0.5f)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<PhaserModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerPhaserModule);

}  // namespace bleep::engine
