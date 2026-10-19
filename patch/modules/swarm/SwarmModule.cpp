// SPDX-License-Identifier: GPL-3.0-or-later
// Swarm node (doc/specs/modules/swarm-oscillator.md): up to 16 oscillators spread
// over a chord or scale around one pitch, gliding, drifting, cross-modulating
// and scattered in stereo.
#include "Registry.h"
#include "SwarmDsp.h"

#include <atomic>

namespace bleep::engine {
namespace {

using patch::SwarmDsp;
using patch::SwarmParams;

class SwarmModule final : public Module {
public:
    enum { Octave, Coarse, Fine, Count, Chord, Spread, Range, Warp, Detune, Drift, CrossFm, Glide, Width,
           Pattern, Stack, Quality, Seed };
    enum { Pitch, Reshuffle, Sync };
    enum { OutL, OutR, Root, Upper, SpreadOut };
    enum { ReshuffleButton };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"count", (double)count_.load(std::memory_order_relaxed)});
        out.push_back({"stackSize", (double)stackSize_.load(std::memory_order_relaxed)});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        auto copy = [](const std::atomic<float>* a, int n) {
            std::vector<float> v((size_t)n);
            for (int i = 0; i < n; ++i) v[(size_t)i] = a[i].load(std::memory_order_relaxed);
            return v;
        };
        const int n = count_.load(std::memory_order_relaxed);
        out.push_back({"pitch", copy(pitch_, n)});
        out.push_back({"pan", copy(pan_, n)});
        out.push_back({"level", copy(level_, n)});
        out.push_back({"stack", copy(stack_, stackSize_.load(std::memory_order_relaxed))});
    }

    void process(const ProcessContext& c) override {
        pollCommands([&](const Command& cmd) {
            if (cmd.index == ReshuffleButton && cmd.value > 0.5f) dsp_.reshuffle();
        });
        if (c.transportStarted) dsp_.restart();
        dsp_.setOutputsUsed(c.isOutputConnected(Root), c.isOutputConnected(Upper));
        SwarmParams p;
        p.pattern = (int)setting(Pattern);
        p.stack = (int)setting(Stack);
        p.high = setting(Quality) >= 0.5f;
        p.seed = (uint32_t)setting(Seed);
        for (int i = 0; i < c.numSamples; ++i) {
            p.pitch = value(c, Octave, i) + value(c, Coarse, i) / 12.0f + value(c, Fine, i) / 1200.0f + c.inputs[Pitch][i];
            p.count = value(c, Count, i);
            p.set = (int)setting(Chord);
            p.spread = value(c, Spread, i);
            p.range = (int)value(c, Range, i);
            p.warp = value(c, Warp, i);
            p.detune = value(c, Detune, i);
            p.drift = value(c, Drift, i);
            p.crossFm = value(c, CrossFm, i);
            p.glide = value(c, Glide, i);
            p.width = value(c, Width, i);
            const auto f = dsp_.tick(p, c.inputs[Sync][i], c.inputs[Reshuffle][i]);
            c.outputs[OutL][i] = f.l;
            c.outputs[OutR][i] = f.r;
            c.outputs[Root][i] = f.root;
            c.outputs[Upper][i] = f.upper;
            c.outputs[SpreadOut][i] = f.spread;
        }
        const int n = dsp_.oscillators();
        for (int k = 0; k < n; ++k) {
            pitch_[k].store(dsp_.pitchOf(k), std::memory_order_relaxed);
            pan_[k].store(dsp_.panOf(k), std::memory_order_relaxed);
            level_[k].store(dsp_.levelOf(k), std::memory_order_relaxed);
        }
        const int m = std::min(dsp_.stackSize(), SwarmDsp::kMaxStack);
        for (int i = 0; i < m; ++i) stack_[i].store((float)dsp_.stackNote(i), std::memory_order_relaxed);
        stackSize_.store(m, std::memory_order_relaxed);
        count_.store(n, std::memory_order_relaxed);
    }

private:
    SwarmDsp dsp_;
    std::atomic<int> count_{0}, stackSize_{0};
    std::atomic<float> pitch_[SwarmDsp::kMaxOsc] = {}, pan_[SwarmDsp::kMaxOsc] = {}, level_[SwarmDsp::kMaxOsc] = {};
    std::atomic<float> stack_[SwarmDsp::kMaxStack] = {};
};

}  // namespace

static void registerSwarmModule(Registry& r) {
    ModuleSpec s;
    s.type = "swarm";
    s.name = "Swarm";
    s.category = "Sources/Chords";
    s.colour = "#facc15";
    s.description = "A cloud of up to 16 oscillators spread over a chord or scale: blooms from unison into the chord, "
                    "drifts, cross-modulates and fills the stereo field.";
    std::vector<std::string> sets, groups;
    for (int i = 0; i < patch::numSwarmSets(); ++i) {
        sets.emplace_back(patch::swarmSet(i).name);
        groups.emplace_back(i < 16 ? "Chords" : "Scales");
    }
    ParamSpec chord = ParamSpec::choice("chord", "Chord", sets, patch::kSwarmMinor7);
    chord.choiceGroups = std::move(groups);
    s.params = {ParamSpec::steppedInt("octave", "Octave", -4, 4, 0).inGroup("Pitch"),
                ParamSpec::number("coarse", "Coarse", -12.0f, 12.0f, 0.0f, "st", 1).inGroup("Pitch"),
                ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0).inGroup("Pitch"),
                ParamSpec::number("count", "Count", 1.0f, 16.0f, 8.0f, "", 1).inGroup("Cloud"),
                chord.inGroup("Cloud"),
                ParamSpec::percent("spread", "Spread", 0.0f, 1.0f, 0.3f).inGroup("Cloud"),
                ParamSpec::steppedInt("range", "Range", 1, 4, 2).inGroup("Cloud"),
                ParamSpec::percent("warp", "Warp", 0.0f, 1.0f, 0.0f).inGroup("Tone"),
                ParamSpec::number("detune", "Detune", 0.0f, 50.0f, 8.0f, "ct", 1).inGroup("Tone"),
                ParamSpec::percent("drift", "Drift", 0.0f, 1.0f, 0.2f).inGroup("Tone"),
                ParamSpec::percent("crossfm", "Cross FM", 0.0f, 1.0f, 0.0f).inGroup("Tone"),
                ParamSpec::seconds("glide", "Glide", 0.0f, 5.0f, 0.5f, 0.3f).inGroup("Motion"),
                ParamSpec::percent("width", "Width", 0.0f, 1.0f, 0.5f).inGroup("Motion"),
                ParamSpec::choice("pattern", "Pattern", {"Fan", "Alternate", "Random", "Outer"}, 0),
                ParamSpec::choice("stack", "Stack", {"Up", "Centred", "Down"}, 0),
                ParamSpec::choice("quality", "Quality", {"Normal (1×)", "High (2×)"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch}, {"reshuffle", "Reshuffle", Signal::Trigger},
                {"sync", "Sync", Signal::Trigger}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},    {"r", "Out R", Signal::Audio, true},
                 {"root", "Root", Signal::Audio, true},  {"upper", "Upper", Signal::Audio, true},
                 {"spread", "Spread", Signal::Control, false}};
    s.buttons = {{"reshuffle", "Reshuffle"}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SwarmModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerSwarmModule);

}  // namespace bleep::engine
