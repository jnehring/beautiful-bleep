// SPDX-License-Identifier: GPL-3.0-only
// Pitch Follower node (doc/specs/modules/pitch-follower.md): audio in, the pitch of
// a single voice or instrument out as V/oct, with a gate, a confidence signal and
// an envelope.
#include "PitchFollowerDsp.h"
#include "Registry.h"

#include <atomic>

namespace bleep::engine {
namespace {

class PitchFollowerModule final : public Module {
public:
    enum { Low, High, Glide, Hold, Confidence, Guard, Vote, Release };
    enum { In };
    enum { Pitch, Gate, ConfidenceOut, Env };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"hz", (double)hz_.load(std::memory_order_relaxed)});
        out.push_back({"confidence", (double)conf_.load(std::memory_order_relaxed)});
    }

    void process(const ProcessContext& c) override {
        patch::PitchFollowerParams p;
        p.minHz = value(c, Low, 0);
        p.maxHz = value(c, High, 0);
        p.confidence = value(c, Confidence, 0);
        p.glide = value(c, Glide, 0);
        p.hold = value(c, Hold, 0);
        p.release = value(c, Release, 0);
        p.guard = (int)setting(Guard);
        p.vote = (int)value(c, Vote, 0);
        patch::PitchFollowerFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            dsp_.tick(c.inputs[In][i], p, f);
            c.outputs[Pitch][i] = f.pitch;
            c.outputs[Gate][i] = f.gate;
            c.outputs[ConfidenceOut][i] = f.confidence;
            c.outputs[Env][i] = f.env;
        }
        hz_.store(f.gate > 0.5f ? dsp_.hz() : 0.0f, std::memory_order_relaxed);
        conf_.store(f.confidence, std::memory_order_relaxed);
    }

private:
    patch::PitchFollowerDsp dsp_;
    std::atomic<float> hz_{0.0f}, conf_{0.0f};
};

}  // namespace

static void registerPitchFollowerModule(Registry& r) {
    ModuleSpec s;
    s.type = "pitch-follower";
    s.name = "Pitch Follower";
    s.category = "Modulation/Followers";
    s.colour = "#34d399";
    s.description = "Finds the pitch of a single voice or instrument and outputs it as V/oct, with a gate, a "
                    "confidence signal and an envelope. An octave guard and a vote keep it steady.";
    s.params = {ParamSpec::hertz("low", "Low", 30.0f, 500.0f, 60.0f).inGroup("Range"),
                ParamSpec::hertz("high", "High", 200.0f, 5000.0f, 1500.0f).inGroup("Range"),
                ParamSpec::seconds("glide", "Glide", 0.0f, 2.0f, 0.1f, 0.03f).inGroup("Output"),
                ParamSpec::seconds("hold", "Hold", 0.0f, 2.0f, 0.2f, 0.25f).inGroup("Output"),
                ParamSpec::percent("confidence", "Confidence", 0.3f, 0.98f, 0.75f).inGroup("Detection"),
                ParamSpec::choice("guard", "Octave Guard", {"Off", "Light", "Firm"}, 1).inGroup("Detection"),
                ParamSpec::stepped("vote", "Vote", {"Off", "3", "5", "7", "9"}, 0).inGroup("Detection"),
                ParamSpec::seconds("release", "Env Release", 0.005f, 2.0f, 0.2f, 0.15f).inGroup("Output")};
    s.inputs = {{"in", "In", Signal::Audio}};
    s.outputs = {{"pitch", "Pitch", Signal::Pitch, true},
                 {"gate", "Gate", Signal::Gate, false},
                 {"confidence", "Confidence", Signal::Control, false},
                 {"env", "Env", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<PitchFollowerModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerPitchFollowerModule);

}  // namespace bleep::engine
