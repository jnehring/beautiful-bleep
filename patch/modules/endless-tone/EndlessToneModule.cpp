// SPDX-License-Identifier: GPL-3.0-or-later
// Endless Tone node (doc/specs/modules/endless-tone.md): the tone that keeps rising or falling.
#include "EndlessToneDsp.h"
#include "Registry.h"

#include "dsp/OscCore.h"

#include <atomic>

namespace bleep::engine {
namespace {

using patch::EndlessParams;
using patch::EndlessToneDsp;

class EndlessToneModule final : public Module {
public:
    enum { Coarse, Fine, Rate, Direction, Width, Count, Timbre, Spread, Phase, Level };
    enum { Pitch, ResetIn };
    enum { OutL, OutR, Loop, Wrap };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        dsp_.reset();
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"loop", loop_.load(std::memory_order_relaxed)});
    }

    void process(const ProcessContext& c) override {
        EndlessParams p;
        for (int i = 0; i < c.numSamples; ++i) {
            const bool r = c.inputs[ResetIn][i] > 0.5f;
            if (r && !resetPrev_) dsp_.reset();
            resetPrev_ = r;
            p.centreHz = dsp::osc::kC4Hz * std::exp2(std::clamp((double)c.inputs[Pitch][i] + value(c, Coarse, i) / 12.0 + value(c, Fine, i) / 1200.0, -6.0, 5.0));
            p.speed = value(c, Rate, i) * value(c, Direction, i);
            p.width = value(c, Width, i);
            p.count = (int)std::lround(value(c, Count, i));
            p.timbre = value(c, Timbre, i);
            p.spread = value(c, Spread, i);
            p.phase = value(c, Phase, i);
            const auto f = dsp_.tick(p);
            const float level = value(c, Level, i);
            c.outputs[OutL][i] = std::clamp(f.l * level, -4.0f, 4.0f);
            c.outputs[OutR][i] = std::clamp(f.r * level, -4.0f, 4.0f);
            c.outputs[Loop][i] = f.loop;
            c.outputs[Wrap][i] = f.wrap ? 1.0f : 0.0f;
            last_ = f.loop;
        }
        loop_.store(last_, std::memory_order_relaxed);
    }

private:
    EndlessToneDsp dsp_;
    bool resetPrev_ = false;
    float last_ = 0.0f;
    std::atomic<double> loop_{0.0};
};

}  // namespace

static void registerEndlessToneModule(Registry& r) {
    ModuleSpec s;
    s.type = "endless-tone";
    s.name = "Endless Tone";
    s.category = "Sources/Generators";
    s.colour = "#38bdf8";
    s.description = "A tone that rises or falls for ever: octave-spaced partials under a spectral window, with rate, "
                    "direction, width, count, timbre, stereo spread and a loop phase output.";
    s.params = {ParamSpec::number("coarse", "Pitch", -36.0f, 36.0f, 0.0f, "st", 1),
                ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0),
                ParamSpec::number("rate", "Rate", 0.0f, 2.0f, 0.25f, "oct/s", 2),
                ParamSpec::percent("direction", "Direction", -1.0f, 1.0f, 1.0f),
                ParamSpec::percent("width", "Width", 0.0f, 1.0f, 0.4f),
                ParamSpec::steppedInt("count", "Count", 6, 12, 9),
                ParamSpec::percent("timbre", "Timbre", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("spread", "Spread", 0.0f, 1.0f, 0.3f),
                ParamSpec::percent("phase", "Phase", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 0.6f)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch}, {"reset", "Reset", Signal::Trigger}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true},
                 {"loop", "Loop", Signal::Control, false}, {"wrap", "Wrap", Signal::Trigger, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<EndlessToneModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerEndlessToneModule);

}  // namespace bleep::engine
