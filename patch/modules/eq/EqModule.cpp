// SPDX-License-Identifier: MIT
// EQ node (doc/eq.md): low shelf, two bells and a high shelf, stereo.
#include "EqDsp.h"
#include "Registry.h"

#include <algorithm>

namespace bleep::engine {
namespace {

using patch::EqBand;
using patch::EqDsp;

class EqModule final : public Module {
public:
    // Per band: frequency, gain, (Q for the bells). Then the output level.
    enum { LowHz, LowGain, M1Hz, M1Gain, M1Q, M2Hz, M2Gain, M2Q, HighHz, HighGain, Level };
    enum { InL, InR };
    enum { OutL, OutR };
    static constexpr int kBlock = 16;  // bands are redesigned every 16 samples at most

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
        EqBand bands[EqDsp::kBands];
        float level = 1.0f;
        for (int i = 0; i < c.numSamples; ++i) {
            if (i % kBlock == 0) {
                bands[0] = {EqBand::LowShelf, value(c, LowHz, i), value(c, LowGain, i), 0.7f};
                bands[1] = {EqBand::Peak, value(c, M1Hz, i), value(c, M1Gain, i), value(c, M1Q, i)};
                bands[2] = {EqBand::Peak, value(c, M2Hz, i), value(c, M2Gain, i), value(c, M2Q, i)};
                bands[3] = {EqBand::HighShelf, value(c, HighHz, i), value(c, HighGain, i), 0.7f};
                dsp_[0].setBands(bands);
                dsp_[1].setBands(bands);
                level = std::pow(10.0f, value(c, Level, i) * 0.05f);
            }
            c.outputs[OutL][i] = dsp_[0].tick(c.inputs[InL][i]) * level;
            c.outputs[OutR][i] = dsp_[1].tick(inR[i]) * level;
        }
    }

private:
    EqDsp dsp_[2];
};

}  // namespace

static void registerEqModule(Registry& r) {
    ModuleSpec s;
    s.type = "eq";
    s.name = "EQ";
    s.category = "Effects/Dynamics & EQ";
    s.colour = "#0ea5e9";
    s.description = "Four-band parametric equaliser: low shelf, two peaking bands, high shelf. "
                    "Frequency and gain of every band can be modulated.";
    auto gain = [](const char* id, const char* name) { return ParamSpec::number(id, name, -15.0f, 15.0f, 0.0f, "dB", 1); };
    auto q = [](const char* id) { return ParamSpec::exponential(id, "Q", 0.3f, 8.0f, 1.0f); };
    s.params = {ParamSpec::exponential("lowHz", "Low Freq", 30.0f, 1000.0f, 120.0f, "Hz").inGroup("Low shelf"),
                gain("lowGain", "Low Gain").inGroup("Low shelf"),
                ParamSpec::exponential("m1Hz", "Mid 1 Freq", 80.0f, 8000.0f, 400.0f, "Hz").inGroup("Mid 1"),
                gain("m1Gain", "Mid 1 Gain").inGroup("Mid 1"),
                q("m1Q").inGroup("Mid 1"),
                ParamSpec::exponential("m2Hz", "Mid 2 Freq", 200.0f, 16000.0f, 2500.0f, "Hz").inGroup("Mid 2"),
                gain("m2Gain", "Mid 2 Gain").inGroup("Mid 2"),
                q("m2Q").inGroup("Mid 2"),
                ParamSpec::exponential("highHz", "High Freq", 1000.0f, 18000.0f, 8000.0f, "Hz").inGroup("High shelf"),
                gain("highGain", "High Gain").inGroup("High shelf"),
                ParamSpec::number("level", "Level", -18.0f, 6.0f, 0.0f, "dB", 1)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<EqModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerEqModule);

}  // namespace bleep::engine
