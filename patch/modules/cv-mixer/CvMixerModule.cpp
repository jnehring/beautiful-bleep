// SPDX-License-Identifier: MIT
// CV Mixer node (doc/specs/modules/cv-mixer.md): four bipolar channels combined
// by sum, average, max, min or scan.
#include "CvMixerDsp.h"
#include "Registry.h"

#include <string>

namespace bleep::engine {
namespace {

using patch::kCvMixerChannels;

class CvMixerModule final : public Module {
public:
    // Params: Level 1–4 at 0–3, then these.
    enum { Scan = kCvMixerChannels, Master, Offset, Mode, Clip };
    enum { Out, Inv, Abs };

    using Module::Module;

    void process(const ProcessContext& c) override {
        patch::CvMixerParams p;
        p.mode = (int)setting(Mode);
        p.clip = (int)setting(Clip);
        float ch[kCvMixerChannels];
        bool active[kCvMixerChannels];
        patch::CvMixerFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            for (int k = 0; k < kCvMixerChannels; ++k) {
                const float level = value(c, k, i);
                // In 1 unpatched is a constant +1: Level 1 becomes an offset.
                const float in = c.inputConnected[k] ? c.inputs[k][i] : (k == 0 ? 1.0f : 0.0f);
                ch[k] = in * level;
                active[k] = c.inputConnected[k] || (k == 0 && level != 0.0f);
            }
            p.scan = value(c, Scan, i);
            p.master = value(c, Master, i);
            p.offset = value(c, Offset, i);
            patch::cvMixerTick(ch, active, p, f);
            c.outputs[Out][i] = f.out;
            c.outputs[Inv][i] = f.inv;
            c.outputs[Abs][i] = f.abs;
        }
    }
};

}  // namespace

void registerCvMixerModule(Registry& r) {
    ModuleSpec s;
    s.type = "cv-mixer";
    s.name = "CV Mixer";
    s.category = "Utility/Signal";
    s.colour = "#c4b5fd";
    s.description = "Four bipolar channels combined by sum, average, max, min or a scan across them.";
    for (int k = 1; k <= kCvMixerChannels; ++k) {
        const std::string n = std::to_string(k);
        s.params.push_back(ParamSpec::number("level" + n, "Level " + n, -1.0f, 1.0f, k == 1 ? 1.0f : 0.0f));
        s.inputs.push_back({"in" + n, "In " + n, Signal::Control});
    }
    s.params.push_back(ParamSpec::number("scan", "Scan", 0.0f, 1.0f, 0.0f));
    s.params.push_back(ParamSpec::number("master", "Master", 0.0f, 2.0f, 1.0f));
    s.params.push_back(ParamSpec::number("offset", "Offset", -1.0f, 1.0f, 0.0f));
    s.params.push_back(ParamSpec::choice("mode", "Mode", {"Sum", "Average", "Max", "Min", "Scan"}, 0));
    s.params.push_back(ParamSpec::choice("clip", "Clip", {"Off", "Soft", "Hard"}, 1));
    s.outputs = {{"out", "Out", Signal::Control, true},
                 {"inv", "Inv", Signal::Control, true},
                 {"abs", "Abs", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<CvMixerModule>(spec); });
}

}  // namespace bleep::engine
