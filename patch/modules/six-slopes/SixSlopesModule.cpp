// SPDX-License-Identifier: GPL-3.0-or-later
// Six Slopes node (doc/specs/modules/six-slopes.md): six slope generators with
// shared controls, harmonic rate ratios and normalled triggers.
#include "SixSlopesDsp.h"
#include "Registry.h"

#include <array>
#include <atomic>
#include <string>

namespace bleep::engine {
namespace {

using patch::SixSlopesDsp;

class SixSlopesModule final : public Module {
public:
    enum { Rate, Harmonics, Skew, Curve, Level, Tilt, Mode, Snap, Sync, Polarity };
    enum { Trig1, Trig2, Trig3, Trig4, Trig5, Trig6, Pitch };
    enum { Out1, Out2, Out3, Out4, Out5, Out6, Sum, End1, Active };
    static constexpr int kChannels = SixSlopesDsp::kChannels;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> ratios(kChannels), hz(kChannels), phases(kChannels);
        for (int k = 0; k < kChannels; ++k) {
            ratios[(size_t)k] = ratio_[(size_t)k].load();
            hz[(size_t)k] = hz_[(size_t)k].load();
            phases[(size_t)k] = phase_[(size_t)k].load();
        }
        out.push_back({"ratios", std::move(ratios)});
        out.push_back({"hz", std::move(hz)});
        out.push_back({"phases", std::move(phases)});
    }

    void process(const ProcessContext& c) override {
        patch::SixParams p;
        p.mode = (int)setting(Mode);
        p.snap = (int)setting(Snap);
        p.sync = (int)setting(Sync);
        p.bipolar = setting(Polarity) >= 0.5f;
        const Transport& tr = *c.transport;
        patch::SixTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        patch::SixFrame f;
        float trig[kChannels];
        for (int i = 0; i < c.numSamples; ++i) {
            p.rate = c.params[Rate][i];  // normalised: the mode maps it
            p.pitch = c.inputs[Pitch][i];
            p.harmonics = value(c, Harmonics, i);
            p.skew = value(c, Skew, i);
            p.curve = value(c, Curve, i);
            p.level = value(c, Level, i);
            p.tilt = value(c, Tilt, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            // Unpatched triggers already read the nearest patched one above (JackSpec normals).
            for (int k = 0; k < kChannels; ++k) trig[k] = c.inputs[Trig1 + k][i];
            dsp_.tick(p, trig, t, f);
            for (int k = 0; k < kChannels; ++k) c.outputs[Out1 + k][i] = f.out[k];
            c.outputs[Sum][i] = f.sum;
            c.outputs[End1][i] = f.end1;
            c.outputs[Active][i] = f.active;
        }
        for (int k = 0; k < kChannels; ++k) {
            ratio_[(size_t)k].store((float)dsp_.ratioOf(k));
            hz_[(size_t)k].store((float)dsp_.hzOf(k));
            phase_[(size_t)k].store((float)dsp_.phase(k));
        }
    }

private:
    SixSlopesDsp dsp_;
    std::array<std::atomic<float>, kChannels> ratio_{}, hz_{}, phase_{};
};

}  // namespace

static void registerSixSlopesModule(Registry& r) {
    ModuleSpec s;
    s.type = "six-slopes";
    s.name = "Six Slopes";
    s.category = "Modulation/Slopes";
    s.colour = "#d97706";
    s.description = "Six slope generators with shared controls: Harmonics spreads their rates over overtone or undertone ratios.";
    std::vector<std::string> sync;
    for (int i = 0; i < SixSlopesDsp::kSyncChoices; ++i) sync.emplace_back(SixSlopesDsp::syncName(i));
    // Rate is declared in the slope modes' range; the view shows it as a time, or a note in Sound mode.
    s.params = {ParamSpec::hertz("rate", "Rate", 0.02f, 1000.0f, 2.0f),
                ParamSpec::number("harmonics", "Harmonics", -1.0f, 1.0f, 0.0f),
                ParamSpec::percent("skew", "Skew", 0.0f, 1.0f, 0.25f),
                ParamSpec::number("curve", "Curve", -1.0f, 1.0f, 0.0f),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 1.0f),
                ParamSpec::number("tilt", "Tilt", -1.0f, 1.0f, 0.0f),
                ParamSpec::choice("mode", "Mode", {"AR", "ASR", "Loop", "Sound"}, 0),
                ParamSpec::choice("snap", "Snap", {"Off", "Integer", "Just"}, 0),
                ParamSpec::choice("sync", "Sync", sync, 0).when("mode", 0, 2),
                ParamSpec::choice("polarity", "Polarity", {"Unipolar", "Bipolar"}, 0).when("mode", 2, 2)};
    for (int k = 1; k <= SixSlopesDsp::kChannels; ++k) {
        JackSpec j{"trig" + std::to_string(k), "Trig " + std::to_string(k), Signal::Gate};
        s.inputs.push_back(k == 1 ? j : j.normalledTo("trig" + std::to_string(k - 1)));
    }
    s.inputs.push_back({"pitch", "Pitch", Signal::Pitch});
    for (int k = 1; k <= SixSlopesDsp::kChannels; ++k)
        s.outputs.push_back({"out" + std::to_string(k), "Out " + std::to_string(k), Signal::Control, false});
    s.outputs.push_back({"sum", "Sum", Signal::Control, false});
    s.outputs.push_back({"end1", "End 1", Signal::Trigger, false});
    s.outputs.push_back({"active", "Active", Signal::Gate, false});
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SixSlopesModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerSixSlopesModule);

}  // namespace bleep::engine
