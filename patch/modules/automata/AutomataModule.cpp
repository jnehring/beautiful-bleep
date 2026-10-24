// SPDX-License-Identifier: GPL-3.0-only
// Automata node (doc/specs/modules/automata.md): a sequencer driven by a small
// evolving system. The Markov transition table lives in the node's data; the
// view edits it. Learned weights, the cells and the string are shown live.
#include "Registry.h"
#include "AutomataDsp.h"
#include "dsp/Harmony.h"
#include "dsp/SeqClock.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::AutomataDsp;
using patch::kAutoStates;

constexpr int kTable = AutomataDsp::kTable;

/// Stepwise motion is likely, big leaps rare, a rest now and then.
std::array<uint8_t, kTable> defaultTable() {
    std::array<uint8_t, kTable> t{};
    static constexpr int byDistance[8] = {1, 5, 3, 2, 1, 1, 0, 0};
    for (int i = 0; i < kAutoStates; ++i)
        for (int j = 0; j < kAutoStates; ++j) {
            int w;
            if (i == 8 || j == 8) w = (i == 8 && j == 8) ? 0 : 1;
            else w = byDistance[std::abs(i - j)];
            t[(size_t)(i * kAutoStates + j)] = (uint8_t)w;
        }
    return t;
}

std::array<uint8_t, kTable> parseTable(const juce::var& in) {
    std::array<uint8_t, kTable> t = defaultTable();
    const juce::var arr = in.getProperty("table", juce::var());
    if (const auto* a = arr.getArray())
        for (int i = 0; i < kTable && i < a->size(); ++i) {
            const juce::var& v = (*a)[i];
            if (v.isInt() || v.isInt64() || v.isDouble()) t[(size_t)i] = (uint8_t)std::clamp((int)(double)v, 0, 9);
        }
    return t;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const auto t = parseTable(in);
    juce::Array<juce::var> a;
    for (uint8_t v : t) a.add((int)v);
    auto* o = new juce::DynamicObject();
    juce::var out(o);
    o->setProperty("table", a);
    return juce::JSON::toString(out, true).toStdString();
}

class AutomataModule final : public Module {
public:
    enum { Mode, Rule, Size, LifeRule, Turns, Lsys, Density, Interference, Learn, RewindBy, Spread, GateLength, Rate, Sync,
           SyncTo, Seed, Root, Scale, Harmony };
    enum { Clock, Reset, Rewind, LearnIn, Transpose };
    enum { Gate, Pitch, Velocity, Birth, DensityOut, Step };
    enum CommandIndex { RewindButton };

    explicit AutomataModule(const ModuleSpec& spec) : Module(spec) {
        const auto d = defaultTable();
        for (int i = 0; i < kTable; ++i) table_[(size_t)i].store(d[(size_t)i], std::memory_order_relaxed);
    }

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        const auto t = parseTable(json.empty() ? juce::var() : juce::JSON::parse(juce::String(json)));
        for (int i = 0; i < kTable; ++i) table_[(size_t)i].store(t[(size_t)i], std::memory_order_relaxed);
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"gen", (double)gen_.load()});
        out.push_back({"at", (double)at_.load()});
        out.push_back({"len", (double)len_.load()});
        out.push_back({"density", (double)density_.load()});
        out.push_back({"gate", (double)gate_.load()});
        out.push_back({"degree", (double)degree_.load()});
        out.push_back({"birth", (double)birth_.load()});
    }
    /// The cells (Rule, Life, Ant), the string symbols (Lsys) or the effective
    /// transition table, row by row, 0…1 (Markov).
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> v(kView);
        for (int w = 0; w < kViewWords; ++w) {
            const uint64_t x = view_[(size_t)w].load(std::memory_order_relaxed);
            for (int b = 0; b < 8; ++b) v[(size_t)(w * 8 + b)] = (float)((x >> (8 * b)) & 0xffu) / 255.0f;
        }
        out.push_back({"cells", std::move(v)});
    }

    void process(const ProcessContext& c) override {
        patch::AutomataParams p;
        p.mode = (int)setting(Mode);
        p.seed = (uint32_t)setting(Seed);
        p.lifeRule = (int)setting(LifeRule);
        p.turns = (int)setting(Turns);
        p.lsys = (int)setting(Lsys);
        p.sync = (int)setting(Sync);
        p.root = (int)setting(Root);
        p.scale = dsp::scales()[(size_t)std::clamp((int)setting(Scale), 0, (int)dsp::scales().size() - 1)].mask;
        if (const int bus = (int)setting(Harmony); bus > 0 && c.harmony != nullptr) {
            const dsp::HarmonyState& h = c.harmony[bus - 1];
            if (h.valid) {
                p.root = h.key;
                p.scale = h.scale;
            }
        }
        p.rule = (int)value(c, Rule, 0);
        p.size = (int)value(c, Size, 0);
        p.rewindBy = (int)value(c, RewindBy, 0);
        p.spread = (int)value(c, Spread, 0);
        uint8_t table[kTable];
        for (int i = 0; i < kTable; ++i) table[i] = table_[(size_t)i].load(std::memory_order_relaxed);
        dsp_.setTable(table);
        pollCommands([&](const Command& cmd) {
            if (cmd.index == RewindButton && cmd.value > 0.5f) dsp_.rewind(p.rewindBy);
        });
        patch::AutomataInput in;
        in.clockPatched = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        in.learnPatched = c.inputConnected[LearnIn];
        in.running = c.transport->playing && c.transport->ppqValid;
        in.bpm = c.transport->bpm;
        patch::AutomataFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.density = cachedValue(c, Density, i);
            p.interference = cachedValue(c, Interference, i);
            p.learn = cachedValue(c, Learn, i);
            p.gateLength = cachedValue(c, GateLength, i);
            p.rateHz = cachedValue(c, Rate, i);
            in.clock = c.inputs[Clock][i];
            in.reset = c.inputs[Reset][i];
            in.rewind = c.inputs[Rewind][i];
            in.learn = c.inputs[LearnIn][i];
            in.transpose = c.inputs[Transpose][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, f);
            c.outputs[Gate][i] = f.gate;
            c.outputs[Pitch][i] = f.pitch;
            c.outputs[Velocity][i] = f.velocity;
            c.outputs[Birth][i] = f.birth;
            c.outputs[DensityOut][i] = f.density;
            c.outputs[Step][i] = f.step;
            if (f.birth > 0.5f) birth_.store(birth_.load() + 1);
        }
        publish(p);
    }

private:
    static constexpr int kView = 96, kViewWords = kView / 8;

    float cachedValue(const ProcessContext& c, int k, int s) noexcept {
        const float n = c.params[k][s];
        if (n < knobNorm_[(size_t)k] || n > knobNorm_[(size_t)k]) {
            knobNorm_[(size_t)k] = n;
            knobUnits_[(size_t)k] = value(c, k, s);
        }
        return knobUnits_[(size_t)k];
    }

    void publish(const patch::AutomataParams& p) {
        const patch::AutoState& s = dsp_.state();
        std::array<uint8_t, kView> v{};
        int at = 0, len = 0;
        const int64_t g = dsp_.generation();
        switch ((patch::AutoMode)std::clamp(p.mode, 0, 4)) {
            case patch::AutoMode::Rule: {
                len = AutomataDsp::clampSize(p.size);
                for (int i = 0; i < len; ++i) v[(size_t)i] = s.cell[(size_t)i] ? 255 : 0;
                at = (int)(g % len);
                break;
            }
            case patch::AutoMode::Life:
                len = 64;
                for (int i = 0; i < 64; ++i) v[(size_t)i] = s.cell[(size_t)i] ? 255 : 0;
                at = (int)(g & 7);
                break;
            case patch::AutoMode::Ant: {
                len = 64;
                const int k = (int)std::strlen(patch::antTurns()[(size_t)std::clamp(p.turns, 0, 4)]);
                for (int i = 0; i < 64; ++i) v[(size_t)i] = (uint8_t)(255 * s.cell[(size_t)i] / std::max(1, k));
                at = s.ay * 8 + s.ax;
                break;
            }
            case patch::AutoMode::Markov: {
                len = kTable;
                std::array<uint8_t, kTable> t{};
                dsp_.effectiveTable(t.data());
                for (int i = 0; i < kTable; ++i) v[(size_t)i] = t[(size_t)i];
                at = s.deg;
                break;
            }
            case patch::AutoMode::Lsys:
                len = s.len;
                for (int i = 0; i < s.len; ++i) v[(size_t)i] = (uint8_t)(10 + s.str[(size_t)i] * 40);
                at = std::max(0, (int)s.head - 1);
                break;
        }
        for (int w = 0; w < kViewWords; ++w) {
            uint64_t x = 0;
            for (int b = 0; b < 8; ++b) x |= (uint64_t)v[(size_t)(w * 8 + b)] << (8 * b);
            view_[(size_t)w].store(x, std::memory_order_relaxed);
        }
        gen_.store((double)g);
        at_.store(at);
        len_.store(len);
        density_.store(patch::AutomataDsp::densityOf(s, p));
        gate_.store(dsp_.lastEvent().gate ? 1 : 0);
        degree_.store(dsp_.lastEvent().degree);
    }

    AutomataDsp dsp_;
    std::array<std::atomic<uint8_t>, kTable> table_{};
    std::array<std::atomic<uint64_t>, kViewWords> view_{};
    std::atomic<double> gen_{0.0};
    std::atomic<int> at_{0}, len_{0}, gate_{0}, degree_{0}, birth_{0};
    std::atomic<float> density_{0.0f};
    std::array<float, 32> knobNorm_ = [] {
        std::array<float, 32> a;
        a.fill(-1.0f);
        return a;
    }();
    std::array<float, 32> knobUnits_{};
};

}  // namespace

static void registerAutomataModule(Registry& r) {
    ModuleSpec s;
    s.type = "automata";
    s.name = "Automata";
    s.category = "Sequencing/Generative";
    s.colour = "#14b8a6";
    s.description = "A sequencer grown by a small evolving system: a ring of cells, a grid, a Markov chain, a walker "
                    "or a rewriting string. Interference keeps it from repeating; Rewind steps it back.";
    std::vector<std::string> sync, roots, scales, lifeRules, turns, lsys;
    for (const char* n : dsp::syncNames()) sync.emplace_back(n);
    for (const char* n : {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}) roots.emplace_back(n);
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    for (const auto& lr : patch::lifeRules()) lifeRules.emplace_back(lr.name);
    for (const char* t : patch::antTurns()) turns.emplace_back(t);
    for (const auto& l : patch::lsysSets()) lsys.emplace_back(l.name);
    s.params = {ParamSpec::choice("mode", "Mode", {"Ring", "Grid", "Chain", "Walker", "Rewrite"}, 0),
                ParamSpec::steppedInt("rule", "Rule", 0, 255, 30).when("mode", 0, 0),
                ParamSpec::steppedInt("cells", "Cells", 4, 32, 16).when("mode", 0, 0),
                ParamSpec::choice("gridrule", "Grid Rule", lifeRules, 0).when("mode", 1, 1),
                ParamSpec::choice("turns", "Turns", turns, 1).when("mode", 3, 3),
                ParamSpec::choice("rules", "Rules", lsys, 0).when("mode", 4, 4),
                ParamSpec::percent("density", "Density", 0.0f, 1.0f, 0.35f).when("mode", 0, 3),
                ParamSpec::percent("interference", "Interference", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("learn", "Learn", 0.0f, 1.0f, 0.0f).when("mode", 2, 2),
                ParamSpec::steppedInt("rewindby", "Rewind By", 1, 16, 4),
                ParamSpec::integer("octaves", "Octaves", 1, 3, 1),
                ParamSpec::percent("gatelength", "Gate Length", 0.01f, 1.0f, 0.5f),
                ParamSpec::hertz("rate", "Rate", 0.05f, 50.0f, 4.0f).when("sync", 0, 0),
                ParamSpec::choice("sync", "Sync", sync, 2),
                ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto),
                ParamSpec::integer("seed", "Seed", 0, 999, 1),
                ParamSpec::choice("root", "Root", roots, 0),
                ParamSpec::choice("scale", "Scale", scales, 12),
                ParamSpec::choice("harmony", "Harmony", {"Off", "Bus A", "Bus B", "Bus C", "Bus D"}, 0)};
    s.inputs = {{"clock", "Clock", Signal::Trigger}, {"reset", "Reset", Signal::Trigger}, {"rewind", "Rewind", Signal::Gate},
                {"learn", "Learn", Signal::Pitch}, {"transpose", "Transpose", Signal::Pitch}};
    s.outputs = {{"gate", "Gate", Signal::Gate, false},       {"pitch", "Pitch", Signal::Pitch, true},
                 {"velocity", "Velocity", Signal::Control, false}, {"birth", "Birth", Signal::Trigger, false},
                 {"density", "Density", Signal::Control, false}, {"step", "Step", Signal::Trigger, false}};
    s.buttons = {{"rewind", "Rewind"}};
    s.harmony = HarmonyRole::Reader;
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<AutomataModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerAutomataModule);

}  // namespace bleep::engine
