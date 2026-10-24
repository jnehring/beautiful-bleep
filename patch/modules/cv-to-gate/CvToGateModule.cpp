// SPDX-License-Identifier: GPL-3.0-only
// CV to Gate node: CV above a threshold becomes a gate, either following the input or of a fixed length.
#include "CvToGateDsp.h"
#include "Registry.h"

#include <cmath>

namespace bleep::engine {
namespace {

class CvToGateModule final : public Module {
public:
    enum { Threshold, Length };
    enum { In };
    enum { Gate };

    using Module::Module;

    void prepare(double sampleRate) override { rate_ = sampleRate; }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        for (int i = 0; i < c.numSamples; ++i) {
            const float len = value(c, Length, i);
            const int samples = len < 0.0005f ? 0 : std::max(1, (int)std::lround(len * rate_));
            c.outputs[Gate][i] = dsp_.tick(c.inputs[In][i], value(c, Threshold, i), samples);
        }
    }

private:
    patch::CvToGateDsp dsp_;
    double rate_ = 48000.0;
};

}  // namespace

static void registerCvToGateModule(Registry& r) {
    ModuleSpec s;
    s.type = "cv-to-gate";
    s.name = "CV to Gate";
    s.category = "Utility/Logic & Routing";
    s.colour = "#86efac";
    s.description = "Turns CV above a threshold into a gate, following the input or of a set length.";
    s.params = {ParamSpec::number("threshold", "Threshold", -10.0f, 10.0f, 0.5f),
                ParamSpec::seconds("length", "Length", 0.0f, 10.0f, 0.1f, 0.0f)};
    s.inputs = {{"in", "In", Signal::Control}};
    s.outputs = {{"gate", "Gate", Signal::Gate, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<CvToGateModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerCvToGateModule);

}  // namespace bleep::engine
