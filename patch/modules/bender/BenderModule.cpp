// SPDX-License-Identifier: MIT
// Bender node (doc/specs/modules/bender.md): seeded glitches on a segment grid.
// Freeze latches in the node's data (ORed with the gate); Glitch is a view
// button and a trigger input. The view's look-ahead of the next bar's
// decisions is computed here on the message thread from the same hash.
#include "BenderDsp.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <cmath>

namespace bleep::engine {
namespace {

using patch::BenderDsp;

constexpr int kFirstSync = 5, kLastSync = 24;  // noteValues(): "1/1" … "1/64T"
constexpr int kDefaultSync = 17 - kFirstSync + 1;  // 1/16

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    const juce::var v = in.getProperty("freezeLatched", false);
    out->setProperty("freezeLatched", v.isBool() || v.isInt() || v.isDouble() ? (bool)v : false);
    return juce::JSON::toString(result, true).toStdString();
}

class BenderModule final : public Module {
public:
    enum { Time, Chance, Repeats, Bend, BendVar, Slice, Corrupt, Edge, Mix, Sync, Mode, CorruptWhen, BendSteps, Now, Seed };
    enum { InL, InR, Clock, Glitch, Freeze };
    enum { OutL, OutR, Active, Segment, Random };
    enum { GlitchButton };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        freezeLatched_.store((bool)juce::JSON::parse(juce::String(json)).getProperty("freezeLatched", false));
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"active", glitching_.load() ? 1.0 : 0.0});
        out.push_back({"freeze", frozen_.load() ? 1.0 : 0.0});
        out.push_back({"head", (double)head_.load()});
        out.push_back({"synced", synced_.load() ? 1.0 : 0.0});
        out.push_back({"ppq", ppq_.load()});
        out.push_back({"beats", beats_.load()});
    }
    /// "history": the last 64 segments (0 pass, 1 glitch, 2 repeating,
    /// 3 sliced). "plan": with transport sync, the decisions of the current
    /// and the next bar from the same hash (forced glitches excluded).
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> h(64);
        for (size_t i = 0; i < h.size(); ++i) h[i] = (float)history_[i].load(std::memory_order_relaxed);
        out.push_back({"history", std::move(h)});
        std::vector<float> plan;
        const double beats = beats_.load();
        if (synced_.load() && beats > 0.0) {
            const double barStart = 4.0 * std::floor(ppq_.load() / 4.0);
            const int64_t k0 = (int64_t)std::floor(barStart / beats + 1e-9);
            const int count = std::clamp((int)std::lround(8.0 / beats), 1, 256);
            const int repeats = std::max(repeats_.load(), 1);
            const float chance = chance_.load(), slice = slice_.load();
            const uint32_t seed = seed_.load();
            int left = 0;
            for (int64_t k = k0 - repeats; k < k0 + count; ++k) {
                float code = 0.0f;
                if (left > 0) {
                    --left;
                    code = slice > 0.0f ? 3.0f : 2.0f;
                } else if (patch::bender::glitchDraw(seed, k, chance)) {
                    left = repeats - 1;
                    code = 1.0f;
                }
                if (k >= k0) plan.push_back(code);
            }
        }
        out.push_back({"plan", std::move(plan)});
    }

    void process(const ProcessContext& c) override {
        bool glitchButton = false;
        pollCommands([&](const Command& cmd) {
            if (cmd.index == GlitchButton && cmd.value > 0.5f) glitchButton = true;
        });
        const Transport& tr = *c.transport;
        if (c.transportStarted) dsp_.restart();
        patch::BenderParams p;
        const int sync = (int)setting(Sync);
        p.syncBeats = sync > 0 ? dsp::noteValueBeats(kFirstSync + sync - 1) : 0.0;
        p.mode = (int)setting(Mode);
        p.always = setting(CorruptWhen) >= 0.5f;
        p.bendSteps = (int)setting(BendSteps);
        p.now = setting(Now) >= 0.5f;
        p.seed = (uint32_t)setting(Seed);
        patch::BenderInput in;
        in.clockPatched = c.inputConnected[Clock];
        in.running = tr.playing && tr.ppqValid;
        in.bpm = tr.bpm;
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        const bool latched = freezeLatched_.load();
        patch::BenderFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.timeSeconds = value(c, Time, i);
            p.chance = value(c, Chance, i);
            p.repeats = (int)value(c, Repeats, i);
            p.bend = value(c, Bend, i);
            p.bendVar = value(c, BendVar, i);
            p.slice = value(c, Slice, i);
            p.corrupt = value(c, Corrupt, i);
            p.edge = value(c, Edge, i);
            p.mix = value(c, Mix, i);
            in.l = c.inputs[InL][i];
            in.r = inR[i];
            in.clock = c.inputs[Clock][i];
            in.glitch = std::max(c.inputs[Glitch][i], glitchButton && i == 0 ? 1.0f : 0.0f);
            in.freeze = latched || c.inputs[Freeze][i] >= 0.5f;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, f);
            c.outputs[OutL][i] = f.l;
            c.outputs[OutR][i] = f.r;
            c.outputs[Active][i] = f.active;
            c.outputs[Segment][i] = f.segment;
            c.outputs[Random][i] = f.random;
        }
        std::array<uint8_t, 64> h{};
        dsp_.history(h);
        for (size_t i = 0; i < h.size(); ++i) history_[i].store(h[i], std::memory_order_relaxed);
        glitching_.store(dsp_.glitching());
        frozen_.store(in.freeze);
        head_.store(dsp_.headPosition());
        synced_.store(p.syncBeats > 0.0 && in.running && !in.clockPatched);
        ppq_.store(c.ppqStart);
        beats_.store(p.syncBeats);
        chance_.store(p.chance);
        slice_.store(p.slice);
        repeats_.store(p.repeats);
        seed_.store(p.seed);
    }

private:
    BenderDsp dsp_;
    std::atomic<bool> freezeLatched_{false}, frozen_{false}, glitching_{false}, synced_{false};
    std::atomic<float> head_{-1.0f}, chance_{0.25f}, slice_{0.0f};
    std::atomic<double> ppq_{0.0}, beats_{0.25};
    std::atomic<int> repeats_{4};
    std::atomic<uint32_t> seed_{1};
    std::atomic<uint8_t> history_[64] = {};
};

}  // namespace

static void registerBenderModule(Registry& r) {
    ModuleSpec s;
    s.type = "bender";
    s.name = "Bender";
    s.category = "Audio";
    s.colour = "#d8b4fe";
    s.description = "Glitches by chance: repeats, re-pitches, reverses, slices and corrupts pieces of the input. "
                    "Seeded by the song position, so a glitch you like comes back every time.";
    std::vector<std::string> sync{"Free"};
    for (int i = kFirstSync; i <= kLastSync; ++i) sync.emplace_back(dsp::noteValues()[(size_t)i].name);
    s.params = {ParamSpec::seconds("time", "Time", 0.001f, 2.0f, 0.125f, 0.125f),
                ParamSpec::percent("chance", "Chance", 0.0f, 1.0f, 0.25f),
                ParamSpec::steppedInt("repeats", "Repeats", 1, 16, 4),
                ParamSpec::number("bend", "Bend", -2.0f, 2.0f, 1.0f, "×", 2).inGroup("Glitch"),
                ParamSpec::percent("bendvar", "Bend Var", 0.0f, 1.0f, 0.0f).inGroup("Glitch"),
                ParamSpec::percent("slice", "Slice", 0.0f, 1.0f, 0.0f).inGroup("Glitch"),
                ParamSpec::percent("corrupt", "Corrupt", 0.0f, 1.0f, 0.0f).inGroup("Glitch"),
                ParamSpec::percent("edge", "Edge", 0.0f, 1.0f, 0.7f),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
                ParamSpec::choice("sync", "Sync", sync, kDefaultSync),
                ParamSpec::choice("mode", "Mode", {"Crush", "Dropout", "Fold", "Shuffle", "Smear"}, 0),
                ParamSpec::choice("corruptwhen", "Corrupt When", {"Glitches only", "Always"}, 0),
                ParamSpec::choice("bendsteps", "Bend Steps", {"Free", "Octaves", "Fifths + octaves", "Semitones"}, 1),
                ParamSpec::toggle("now", "Now", false),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"l", "In L", Signal::Audio},
                {"r", "In R", Signal::Audio},
                {"clock", "Clock", Signal::Trigger},
                {"glitch", "Glitch", Signal::Trigger},
                {"freeze", "Freeze", Signal::Gate}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},
                 {"r", "Out R", Signal::Audio, true},
                 {"active", "Active", Signal::Gate, false},
                 {"segment", "Segment", Signal::Trigger, false},
                 {"random", "Random", Signal::Control, true}};
    s.buttons = {{"glitch", "Glitch"}};
    s.memoryHeavy = true;
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<BenderModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerBenderModule);

}  // namespace bleep::engine
