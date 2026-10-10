// SPDX-License-Identifier: MIT
// Chorus node (doc/chorus.md): stereo chorus (two delay voices per channel) or flanger (one),
// built on DaisySP's modulated delay (MIT, see LICENSE).
#include "ChorusDsp.h"
#include "Registry.h"

#include <algorithm>

namespace bleep::engine {
namespace {

using patch::ModDelayVoice;

class ChorusModule final : public Module {
public:
    enum { Rate, Depth, Delay, Feedback, Spread, Mode, Mix };
    enum { InL, InR };
    enum { OutL, OutR };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        for (auto& v : voice_) v.prepare(sampleRate);
        reset();
    }
    void reset() override {
        for (auto& v : voice_) v.reset();
        phase_ = 0.0;
    }

    void process(const ProcessContext& c) override {
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        const bool flanger = setting(Mode) >= 0.5f;
        for (int i = 0; i < c.numSamples; ++i) {
            phase_ += (double)value(c, Rate, i) / sampleRate_;
            phase_ -= std::floor(phase_);
            const float depth = value(c, Depth, i), delay = value(c, Delay, i), fb = value(c, Feedback, i);
            const double offsetR = 0.5 * (double)value(c, Spread, i);  // right channel's LFO, up to half a cycle later
            const float mix = value(c, Mix, i);
            const float in[2] = {c.inputs[InL][i], inR[i]};
            for (int ch = 0; ch < 2; ++ch) {
                const double ph = phase_ + (ch ? offsetR : 0.0);
                float wet = voice_[ch * 2].tick(in[ch], patch::triangleLfo(ph), delay, depth, fb, flanger);
                if (!flanger) {  // the second voice swings the other way
                    wet += voice_[ch * 2 + 1].tick(in[ch], patch::triangleLfo(ph + 0.5), delay * 1.27f, depth, fb, false);
                    wet *= 0.5f;
                }
                c.outputs[ch][i] = in[ch] + mix * (wet - in[ch]);
            }
        }
    }

private:
    ModDelayVoice voice_[4];  // L voice 1 and 2, R voice 1 and 2
    double phase_ = 0.0;
};

}  // namespace

static void registerChorusModule(Registry& r) {
    ModuleSpec s;
    s.type = "chorus";
    s.name = "Chorus";
    s.category = "Audio";
    s.colour = "#14b8a6";
    s.description = "Stereo chorus (two swinging delay voices per side) or flanger (one, with feedback). "
                    "Rate, depth, delay and feedback can all be modulated.";
    s.params = {ParamSpec::exponential("rate", "Rate", 0.02f, 10.0f, 0.6f, "Hz"),
                ParamSpec::percent("depth", "Depth", 0.0f, 1.0f, 0.5f),
                ParamSpec::exponential("delay", "Delay", 0.1f, 25.0f, 9.0f, "ms"),
                ParamSpec::percent("feedback", "Feedback", -1.0f, 1.0f, 0.0f),
                ParamSpec::percent("spread", "Spread", 0.0f, 1.0f, 0.5f),
                ParamSpec::choice("mode", "Mode", {"Chorus", "Flanger"}, 0),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 0.5f)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ChorusModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerChorusModule);

}  // namespace bleep::engine
