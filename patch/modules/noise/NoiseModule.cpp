// SPDX-License-Identifier: MIT
// Noise node: white, pink, brown and blue noise, and a Colour sweep.
#include "NoiseDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

using patch::NoiseDsp;

class NoiseModule final : public Module {
public:
    enum { Colour, Level };
    enum { Out, White, Pink, Brown, Blue };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        for (int i = 0; i < c.numSamples; ++i) {
            const auto f = dsp_.next();
            c.outputs[Out][i] = NoiseDsp::colour(f, value(c, Colour, i)) * value(c, Level, i);
            c.outputs[White][i] = f.white;
            c.outputs[Pink][i] = f.pink;
            c.outputs[Brown][i] = f.brown;
            c.outputs[Blue][i] = f.blue;
        }
    }

private:
    NoiseDsp dsp_;
};

}  // namespace

void registerNoiseModule(Registry& r) {
    ModuleSpec s;
    s.type = "noise";
    s.name = "Noise";
    s.category = "Sources/Generators";
    s.colour = "#cbd5e1";
    s.description = "White, pink, brown and blue noise. Colour sweeps from dark brown to bright violet.";
    s.params = {ParamSpec::percent("colour", "Colour", -1.0f, 1.0f, 0.0f),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 1.0f)};
    s.outputs = {{"out", "Out", Signal::Audio, true},     {"white", "White", Signal::Audio, true},
                 {"pink", "Pink", Signal::Audio, true},   {"brown", "Brown", Signal::Audio, true},
                 {"blue", "Blue", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<NoiseModule>(spec); });
}

}  // namespace bleep::engine
