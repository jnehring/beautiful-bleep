// SPDX-License-Identifier: MIT
// Envelope Follower node (doc/specs/modules/envelope-follower.md): audio or CV
// in, a smooth control signal out, plus an inverted copy and a threshold gate.
#include "EnvelopeFollowerDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

class EnvelopeFollowerModule final : public Module {
public:
    enum { Attack, Release, Gain, Threshold, Detector, Rectify };
    enum { In };
    enum { Env, Inverted, Gate, Trigger };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        patch::EnvelopeFollowerParams p;
        p.detector = (int)setting(Detector);
        p.rectify = (int)setting(Rectify);
        patch::EnvelopeFollowerFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.attack = value(c, Attack, i);
            p.release = value(c, Release, i);
            p.gain = value(c, Gain, i);
            p.threshold = value(c, Threshold, i);
            dsp_.tick(c.inputs[In][i], p, f);
            c.outputs[Env][i] = f.env;
            c.outputs[Inverted][i] = f.inverted;
            c.outputs[Gate][i] = f.gate;
            c.outputs[Trigger][i] = f.trigger;
        }
    }

private:
    patch::EnvelopeFollowerDsp dsp_;
};

}  // namespace

static void registerEnvelopeFollowerModule(Registry& r) {
    ModuleSpec s;
    s.type = "envelope-follower";
    s.name = "Envelope Follower";
    s.category = "Modulation";
    s.colour = "#f0abfc";
    s.description = "Turns the loudness of audio, or the movement of a CV, into a smooth control signal "
                    "with its own attack and release, plus a threshold gate.";
    s.params = {ParamSpec::seconds("attack", "Attack", 0.0f, 2.0f, 0.02f, 0.01f),
                ParamSpec::seconds("release", "Release", 0.0f, 5.0f, 0.3f, 0.2f),
                ParamSpec::number("gain", "Gain", 0.0f, 8.0f, 1.0f, "×", 2),
                ParamSpec::percent("threshold", "Threshold", 0.0f, 1.0f, 0.3f),
                ParamSpec::choice("detector", "Detector", {"Peak", "RMS"}, 0),
                ParamSpec::choice("rectify", "Rectify", {"Full", "Positive", "Negative", "None (signed)"}, 0)
                    .when("detector", 0, 0)};
    s.inputs = {{"in", "In", Signal::Audio}};
    s.outputs = {{"env", "Env", Signal::Control, true},
                 {"inverted", "Inverted", Signal::Control, true},
                 {"gate", "Gate", Signal::Gate, false},
                 {"trigger", "Trigger", Signal::Trigger, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<EnvelopeFollowerModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerEnvelopeFollowerModule);

}  // namespace bleep::engine
