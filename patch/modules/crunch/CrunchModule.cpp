// SPDX-License-Identifier: MIT
// Crunch node (doc/crunch.md): overdrive → sample-rate reduction → bit crush → tone, stereo.
// DaisySP's Overdrive (after Plaits) and Decimator, MIT, see LICENSE.
#include "CrunchDsp.h"
#include "Registry.h"

#include <algorithm>

namespace bleep::engine {
namespace {

using patch::CrunchDsp;
using patch::CrunchParams;

class CrunchModule final : public Module {
public:
    enum { Drive, Bits, Rate, Tone, Level, Mix };
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
    }

    void process(const ProcessContext& c) override {
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        CrunchParams p;
        for (int i = 0; i < c.numSamples; ++i) {
            p.drive = value(c, Drive, i);
            p.bits = value(c, Bits, i);
            p.rate = value(c, Rate, i);
            p.toneHz = value(c, Tone, i);
            const float level = value(c, Level, i), mix = value(c, Mix, i);
            const float in[2] = {c.inputs[InL][i], inR[i]};
            for (int ch = 0; ch < 2; ++ch)
                c.outputs[ch][i] = in[ch] + mix * (dsp_[ch].tick(in[ch], p) * level - in[ch]);
        }
    }

private:
    CrunchDsp dsp_[2];
};

}  // namespace

static void registerCrunchModule(Registry& r) {
    ModuleSpec s;
    s.type = "crunch";
    s.name = "Crunch";
    s.category = "Effects";
    s.colour = "#dc2626";
    s.description = "Overdrive, bit crusher and sample-rate reducer in one, with a tone low-pass: "
                    "from warm saturation to broken digital grit.";
    s.params = {ParamSpec::percent("drive", "Drive", 0.0f, 1.0f, 0.3f),
                ParamSpec::number("bits", "Bits", 1.0f, 16.0f, 16.0f, "bit", 1),
                ParamSpec::percent("rate", "Rate Red.", 0.0f, 1.0f, 0.0f),
                ParamSpec::exponential("tone", "Tone", 500.0f, 20000.0f, 20000.0f, "Hz"),
                ParamSpec::number("level", "Level", 0.0f, 2.0f, 1.0f, "", 2),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<CrunchModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerCrunchModule);

}  // namespace bleep::engine
