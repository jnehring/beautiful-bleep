// SPDX-License-Identifier: MIT
// Dual Filter node (doc/specs/modules/dual-filter.md): two multimode SVFs under
// one Cutoff, pulled apart by Spread, in serial, parallel or stereo routing.
// Cutoff and Spread modulation work in octaves and may run at audio rate.
#include "DualFilterDsp.h"
#include "Registry.h"

namespace bleep::engine {
namespace {

using patch::DualFilterDsp;
using patch::DualFilterParams;

class DualFilterModule final : public Module {
public:
    enum { Cutoff, Spread, Res1, Res2, Mode1, Mode2, Balance, Drive, KeyTrack, Mix, Routing, Link, Character };
    enum { InL, InR, Pitch };
    enum { OutL, OutR, F1, F2, Env };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        // A mono source (only L patched) feeds both channels.
        const bool stereo = c.inputConnected[InR];
        const float* inR = stereo ? c.inputs[InR] : c.inputs[InL];
        DualFilterParams p;
        p.routing = (int)setting(Routing);
        p.link = (int)setting(Link);
        p.character = (int)setting(Character);
        patch::DualFilterFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.cutoff = c.params[Cutoff][i];  // normalised = octave domain
            p.spread = value(c, Spread, i);
            p.res1 = value(c, Res1, i);
            p.res2 = value(c, Res2, i);
            p.mode1 = value(c, Mode1, i);
            p.mode2 = value(c, Mode2, i);
            p.balance = value(c, Balance, i);
            p.drive = value(c, Drive, i);
            p.keyTrack = value(c, KeyTrack, i);
            p.mix = value(c, Mix, i);
            f.in[0] = c.inputs[InL][i];
            f.in[1] = inR[i];
            dsp_.tick(p, c.inputs[Pitch][i], f, stereo);
            c.outputs[OutL][i] = f.out[0];
            c.outputs[OutR][i] = f.out[1];
            c.outputs[F1][i] = f.f1;
            c.outputs[F2][i] = f.f2;
            c.outputs[Env][i] = f.env;
        }
    }

private:
    DualFilterDsp dsp_;
};

}  // namespace

static void registerDualFilterModule(Registry& r) {
    ModuleSpec s;
    s.type = "dual-filter";
    s.name = "Dual Filter";
    s.category = "Audio/Filters";
    s.colour = "#f9a8d4";
    s.description = "Two morphing state-variable filters under one Cutoff, pulled apart by Spread: "
                    "serial, parallel or stereo; formant pairs, wide band-passes, stereo filtering.";
    const auto mode = [](const char* id, const char* name) {
        ParamSpec m = ParamSpec::number(id, name, 0.0f, 1.0f, 0.0f);
        m.format = ParamSpec::Format::FilterMode;
        return m;
    };
    s.params = {ParamSpec::hertz("cutoff", "Cutoff", 20.0f, 20000.0f, 1000.0f),
                ParamSpec::number("spread", "Spread", -5.0f, 5.0f, 1.0f, "oct", 2),
                ParamSpec::percent("res1", "Res 1", 0.0f, 1.0f, 0.2f).inGroup("Filter 1"),
                ParamSpec::percent("res2", "Res 2", 0.0f, 1.0f, 0.2f).inGroup("Filter 2"),
                mode("mode1", "Mode 1").inGroup("Filter 1"),
                mode("mode2", "Mode 2").inGroup("Filter 2").namedBy("link", {"Mode 2", "Mode 2 Offset", "Mode 2 Offset"}),
                ParamSpec::percent("balance", "Balance", -1.0f, 1.0f, 0.0f),
                ParamSpec::percent("drive", "Drive", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("keyTrack", "Key Track", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
                ParamSpec::choice("routing", "Routing", {"Serial", "Parallel", "Parallel (F2 inverted)", "Stereo"}, 0),
                ParamSpec::choice("link", "Link", {"Off", "Same", "Mirror"}, 0),
                ParamSpec::choice("character", "Character", {"Clean", "Saturating"}, 0)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}, {"pitch", "Pitch", Signal::Pitch}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},
                 {"r", "Out R", Signal::Audio, true},
                 JackSpec{"f1", "F1 Out", Signal::Audio, true}.namedBy("routing", {"F1 Out", "F1 Out", "F1 Out", "F1 (L)"}),
                 JackSpec{"f2", "F2 Out", Signal::Audio, true}.namedBy("routing", {"F2 Out", "F2 Out", "F2 Out", "F2 (R)"}),
                 {"env", "Env", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<DualFilterModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerDualFilterModule);

}  // namespace bleep::engine
