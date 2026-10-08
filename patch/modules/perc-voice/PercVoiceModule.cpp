// SPDX-License-Identifier: MIT
// Perc Voice node: kicks, toms, bells and noisy hits from eight partials and
// three engines (specs/modules/perc-voice.md). Env and Active outputs for
// Voice Cells; a Hit button auditions it; the view draws the partials.
#include "PercVoiceDsp.h"
#include "Registry.h"
#include "dsp/Smoothing.h"

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::PercHit;
using patch::PercParams;
using patch::PercVoiceDsp;

class PercVoiceModule final : public Module {
public:
    enum { Pitch, Tone, Morph, Click, Decay, Damp, Sweep, Spread, Level, Engine, Track, Drive, Seed };
    enum { Trig, Accent, PitchIn, Choke };
    enum { OutL, OutR, Env, Active };
    enum { HitButton };

    static constexpr int kN = patch::perc::kPartials;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        viewEvery_ = std::max(1, (int)(sampleRate / 30.0));
        reset();
    }
    void reset() override {
        dsp_.reset();
        trig_.reset();
        choke_.reset();
        viewLeft_ = 0;
    }

    void process(const ProcessContext& c) override {
        bool hit = false;
        pollCommands([&](const Command& cmd) { hit = hit || (cmd.index == HitButton && cmd.value > 0.5f); });
        if (c.transportStarted) dsp_.resetCount();
        const bool accentPatched = c.inputConnected[Accent];
        PercParams p;
        p.track = setting(Track) > 0.5f;
        p.drive = (int)setting(Drive);
        p.seed = (uint64_t)setting(Seed);
        read(c, 0, p);
        for (int i = 0; i < c.numSamples; ++i) {
            // Knobs every 8 samples (the DSP updates its partials at that rate).
            if (i > 0 && (i & 7) == 0) read(c, i, p);
            const float pitchIn = c.inputs[PitchIn][i];
            const bool trig = trig_.process(c.inputs[Trig][i]) > 0;
            if (trig || (hit && i == 0)) {
                if (i & 7) read(c, i, p);
                PercHit h;
                h.engine = (patch::PercEngine)std::clamp((int)value(c, Engine, i), 0, 2);
                h.accent = trig && accentPatched ? std::clamp(c.inputs[Accent][i], 0.0f, 1.0f) : 0.7f;
                h.pitch = std::isfinite(pitchIn) ? pitchIn : 0.0f;
                dsp_.strike(h, p);
            }
            if (choke_.process(c.inputs[Choke][i]) > 0) dsp_.choke();
            if (!dsp_.active()) {
                c.outputs[OutL][i] = c.outputs[OutR][i] = c.outputs[Env][i] = c.outputs[Active][i] = 0.0f;
                continue;
            }
            const auto f = dsp_.tick(p, std::isfinite(pitchIn) ? pitchIn : 0.0f);
            c.outputs[OutL][i] = f.l;
            c.outputs[OutR][i] = f.r;
            c.outputs[Env][i] = f.env;
            c.outputs[Active][i] = f.active ? 1.0f : 0.0f;
        }
        // The partial display, about 30 times a second.
        viewLeft_ -= c.numSamples;
        if (viewLeft_ <= 0) {
            viewLeft_ = viewEvery_;
            const auto parts = dsp_.partials(p);
            for (int k = 0; k < kN; ++k) {
                ratio_[(size_t)k].store(parts.ratio[k], std::memory_order_relaxed);
                amp_[(size_t)k].store(parts.amp[k], std::memory_order_relaxed);
                decay_[(size_t)k].store(parts.decay[k], std::memory_order_relaxed);
            }
        }
    }

    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> r((size_t)kN), a((size_t)kN), d((size_t)kN);
        for (size_t k = 0; k < (size_t)kN; ++k) {
            r[k] = ratio_[k].load(std::memory_order_relaxed);
            a[k] = amp_[k].load(std::memory_order_relaxed);
            d[k] = decay_[k].load(std::memory_order_relaxed);
        }
        out.push_back({"ratios", std::move(r)});
        out.push_back({"amps", std::move(a)});
        out.push_back({"decays", std::move(d)});
    }

private:
    void read(const ProcessContext& c, int i, PercParams& p) const noexcept {
        p.pitchHz = value(c, Pitch, i);
        p.tone = value(c, Tone, i);
        p.morph = value(c, Morph, i);
        p.click = value(c, Click, i);
        p.decay = value(c, Decay, i);
        p.damp = value(c, Damp, i);
        p.sweep = value(c, Sweep, i);
        p.spread = value(c, Spread, i);
        p.level = value(c, Level, i);
    }

    PercVoiceDsp dsp_;
    dsp::GateEdge trig_, choke_;
    int viewEvery_ = 1600, viewLeft_ = 0;
    std::array<std::atomic<float>, kN> ratio_{}, amp_{}, decay_{};
};

}  // namespace

void registerPercVoiceModule(Registry& r) {
    ModuleSpec s;
    s.type = "perc-voice";
    s.name = "Perc Voice";
    s.category = "Sources";
    s.colour = "#fdba74";
    s.description = "One percussion voice from kick to bell: Tone walks the partials from sine through membrane and bar to "
                    "metal; FM, Modal and Noise Bank engines; Click, Sweep, Decay and Damp shape the hit.";
    s.params = {ParamSpec::hertz("pitch", "Pitch", 20.0f, 4000.0f, 55.0f),
                ParamSpec::percent("tone", "Tone", 0.0f, 1.0f, 0.2f),
                ParamSpec::percent("morph", "Morph", 0.0f, 1.0f, 0.5f)
                    .namedBy("engine", {"FM Index", "Balance", "Width"}),
                ParamSpec::percent("click", "Click", 0.0f, 1.0f, 0.3f),
                ParamSpec::seconds("decay", "Decay", 0.01f, 8.0f, 0.6f, 0.4f),
                ParamSpec::percent("damp", "Damp", 0.0f, 1.0f, 0.4f),
                ParamSpec::percent("sweep", "Sweep", 0.0f, 1.0f, 0.4f),
                ParamSpec::percent("spread", "Spread", 0.0f, 1.0f, 0.2f),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 0.8f),
                ParamSpec::stepped("engine", "Engine", {"FM", "Modal", "Noise Bank"}, 1),
                ParamSpec::toggle("track", "Track", false),
                ParamSpec::choice("drive", "Drive", {"Clean", "Warm", "Hot"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"trig", "Trig", Signal::Trigger},
                {"accent", "Accent", Signal::Control},
                {"pitch", "Pitch", Signal::Pitch},
                {"choke", "Choke", Signal::Trigger}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},
                 {"r", "Out R", Signal::Audio, true},
                 {"env", "Env", Signal::Control, false},
                 {"active", "Active", Signal::Gate, false}};
    s.buttons = {{"hit", "Hit"}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<PercVoiceModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerPercVoiceModule);

}  // namespace bleep::engine
