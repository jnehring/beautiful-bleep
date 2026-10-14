// SPDX-License-Identifier: MIT
// Delay node (doc/delay.md): a stereo delay with free or tempo-synced times, feedback with low and high cut,
// and a ping-pong mode.
#include "DelayDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

using patch::DelayDsp;
using patch::DelayParams;

class DelayModule final : public Module {
public:
    enum { TimeL, TimeR, Feedback, LowCut, HighCut, Mix, Sync, RateL, RateR, Mode, Link };
    enum { InL, InR };
    enum { OutL, OutR };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        fresh_ = true;
    }
    void reset() override {
        dsp_.reset();
        fresh_ = true;
    }

    void process(const ProcessContext& c) override {
        const bool sync = setting(Sync) >= 0.5f;
        const bool link = setting(Link) >= 0.5f;  // Link: the right side follows the left
        DelayParams p;
        p.pingPong = setting(Mode) >= 0.5f;
        const double bpm = c.transport ? c.transport->bpm : 120.0;
        if (sync) {
            p.timeL = (float)dsp::beatsToSeconds(patch::delayRateBeats((int)setting(RateL)), bpm);
            p.timeR = (float)dsp::beatsToSeconds(patch::delayRateBeats((int)setting(link ? RateL : RateR)), bpm);
        }
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        for (int i = 0; i < c.numSamples; ++i) {
            if (!sync) {
                p.timeL = value(c, TimeL, i) * 0.001f;
                p.timeR = value(c, link ? TimeL : TimeR, i) * 0.001f;
            }
            if (fresh_) {
                dsp_.snapTimes(p);
                fresh_ = false;
            }
            p.feedback = value(c, Feedback, i);
            p.lowCutHz = value(c, LowCut, i);
            p.highCutHz = value(c, HighCut, i);
            p.mix = value(c, Mix, i);
            dsp_.tick(p, c.inputs[InL][i], inR[i], c.outputs[OutL][i], c.outputs[OutR][i]);
        }
    }

private:
    DelayDsp dsp_;
    bool fresh_ = true;
};

}  // namespace

static void registerDelayModule(Registry& r) {
    ModuleSpec s;
    s.type = "delay";
    s.name = "Delay";
    s.category = "Effects/Space & Time";
    s.colour = "#5b8def";
    s.description = "A simple stereo delay: free or tempo-synced times for each side, feedback with low and high cut, "
                    "and a ping-pong mode.";
    s.memoryHeavy = true;
    std::vector<std::string> rates;
    for (const char* n : patch::delayRateNames()) rates.emplace_back(n);
    s.params = {ParamSpec::exponential("timel", "Time L", 1.0f, 2000.0f, 300.0f, "ms").when("sync", 0, 0),
                ParamSpec::exponential("timer", "Time R", 1.0f, 2000.0f, 300.0f, "ms").when("sync", 0, 0),
                ParamSpec::percent("feedback", "Feedback", 0.0f, 1.0f, 0.4f),
                ParamSpec::exponential("lowcut", "Low Cut", 20.0f, 2000.0f, 20.0f, "Hz"),
                ParamSpec::exponential("highcut", "High Cut", 500.0f, 20000.0f, 20000.0f, "Hz"),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 0.5f),
                ParamSpec::choice("sync", "Sync", {"Free", "Tempo"}, 0),
                ParamSpec::choice("ratel", "Rate L", rates, 5).when("sync", 1, 1),
                ParamSpec::choice("rater", "Rate R", rates, 5).when("sync", 1, 1),
                ParamSpec::choice("mode", "Mode", {"Stereo", "Ping-Pong"}, 0),
                ParamSpec::toggle("link", "Link L/R", false)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<DelayModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerDelayModule);

}  // namespace bleep::engine
