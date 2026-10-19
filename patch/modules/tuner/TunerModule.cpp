// SPDX-License-Identifier: GPL-3.0-or-later
// Tuner node (doc/specs/modules/tuner.md): audio in, the note, its error in cents
// and an in-tune gate out; the view shows a needle, the note name and the frequency.
#include "Registry.h"
#include "TunerDsp.h"

#include <atomic>

namespace bleep::engine {
namespace {

class TunerModule final : public Module {
public:
    enum { Reference, Tolerance, Damping, Low, High, Names, Guard };
    enum { In };
    enum { Cents, InTune, Pitch };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"hz", (double)hz_.load(std::memory_order_relaxed)});
        out.push_back({"midi", (double)midi_.load(std::memory_order_relaxed)});
        out.push_back({"cents", (double)cents_.load(std::memory_order_relaxed)});
        out.push_back({"heard", heard_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
        out.push_back({"have", have_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
        out.push_back({"inTune", inTune_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
        out.push_back({"confidence", (double)conf_.load(std::memory_order_relaxed)});
    }

    void process(const ProcessContext& c) override {
        patch::TunerParams p;
        p.referenceA = value(c, Reference, 0);
        p.tolerance = value(c, Tolerance, 0);
        p.damping = value(c, Damping, 0);
        p.minHz = value(c, Low, 0);
        p.maxHz = value(c, High, 0);
        p.guard = (int)setting(Guard);
        patch::TunerFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            dsp_.tick(c.inputs[In][i], p, f);
            c.outputs[Cents][i] = std::clamp(f.cents / 50.0f, -1.0f, 1.0f);
            c.outputs[InTune][i] = f.inTune;
            c.outputs[Pitch][i] = f.volts;
        }
        hz_.store(dsp_.hz(), std::memory_order_relaxed);
        midi_.store(dsp_.midi(), std::memory_order_relaxed);
        cents_.store(f.cents, std::memory_order_relaxed);
        heard_.store(f.voiced, std::memory_order_relaxed);
        have_.store(dsp_.haveNote(), std::memory_order_relaxed);
        inTune_.store(f.inTune > 0.5f, std::memory_order_relaxed);
        conf_.store(dsp_.confidence(), std::memory_order_relaxed);
    }

private:
    patch::TunerDsp dsp_;
    std::atomic<float> hz_{0.0f}, cents_{0.0f}, conf_{0.0f};
    std::atomic<int> midi_{69};
    std::atomic<bool> heard_{false}, have_{false}, inTune_{false};
};

}  // namespace

static void registerTunerModule(Registry& r) {
    ModuleSpec s;
    s.type = "tuner";
    s.name = "Tuner";
    s.category = "Utility/Metering";
    s.colour = "#a3e635";
    s.description = "A chromatic tuner: the note, a needle for the error in cents and the frequency, with a cents CV "
                    "and an in-tune gate for patching.";
    s.params = {ParamSpec::number("reference", "Reference A", 400.0f, 480.0f, 440.0f, "Hz", 1),
                ParamSpec::number("tolerance", "In Tune", 1.0f, 25.0f, 5.0f, "ct", 1),
                ParamSpec::seconds("damping", "Damping", 0.01f, 0.6f, 0.1f, 0.08f),
                ParamSpec::hertz("low", "Low", 25.0f, 400.0f, 40.0f),
                ParamSpec::hertz("high", "High", 200.0f, 4000.0f, 1400.0f),
                ParamSpec::choice("names", "Names", {"Sharps", "Flats"}, 0),
                ParamSpec::choice("guard", "Octave Guard", {"Off", "Light", "Firm"}, 1)};
    s.inputs = {{"in", "In", Signal::Audio}};
    s.outputs = {{"cents", "Cents", Signal::Control, true},
                 {"intune", "In Tune", Signal::Gate, false},
                 {"pitch", "Pitch", Signal::Pitch, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<TunerModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerTunerModule);

}  // namespace bleep::engine
