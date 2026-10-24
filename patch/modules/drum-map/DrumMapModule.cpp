// SPDX-License-Identifier: GPL-3.0-only
// Drum Map node (doc/specs/modules/drum-map.md): kick, snare and hats from the
// generated map plus the user's edited nodes (node data), triggers,
// accents, velocities and notes out.
#include "DrumMapDsp.h"
#include "Handoff.h"
#include "Registry.h"
#include "dsp/SeqClock.h"

#include <juce_core/juce_core.h>

#include <atomic>

namespace bleep::engine {
namespace {

using patch::DrumMapDsp;
using patch::DrumMapTable;
using patch::kDrumGrid;
using patch::kDrumSteps;
using patch::kDrumVoices;

const char* const kVoiceKeys[kDrumVoices] = {"kick", "snare", "hats"};

/// The edited nodes, "column,row" → lanes (missing lanes and steps from the factory node).
struct UserNodes {
    std::array<bool, patch::kDrumNodes> edited{};
    DrumMapTable table = patch::drumFactoryMap();
};

UserNodes parseNodes(const juce::var& data) {
    UserNodes u;
    const auto* nodes = data["nodes"].getDynamicObject();
    if (!nodes) return u;
    for (const auto& [name, value] : nodes->getProperties()) {
        const juce::String key = name.toString();
        const int comma = key.indexOfChar(',');
        if (comma <= 0) continue;
        const juce::String cs = key.substring(0, comma).trim(), rs = key.substring(comma + 1).trim();
        if (!cs.containsOnly("0123456789") || !rs.containsOnly("0123456789") || cs.isEmpty() || rs.isEmpty()) continue;
        const int c = cs.getIntValue(), r = rs.getIntValue();
        if (c < 0 || c >= kDrumGrid || r < 0 || r >= kDrumGrid || !value.isObject()) continue;
        const size_t idx = (size_t)(r * kDrumGrid + c);
        u.edited[idx] = true;
        for (int v = 0; v < kDrumVoices; ++v)
            if (const auto* lane = value[kVoiceKeys[v]].getArray())
                for (int s = 0; s < kDrumSteps && s < lane->size(); ++s) {
                    const juce::var x = (*lane)[s];
                    if (x.isDouble() || x.isInt() || x.isInt64())
                        u.table[idx].lanes[(size_t)v][(size_t)s] = (uint8_t)juce::jlimit(0, 255, (int)std::lround((double)x));
                }
    }
    return u;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const UserNodes u = parseNodes(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    auto* nodes = new juce::DynamicObject();
    for (int r = 0; r < kDrumGrid; ++r)
        for (int c = 0; c < kDrumGrid; ++c) {
            const size_t idx = (size_t)(r * kDrumGrid + c);
            if (!u.edited[idx]) continue;
            auto* node = new juce::DynamicObject();
            for (int v = 0; v < kDrumVoices; ++v) {
                juce::Array<juce::var> lane;
                for (int s = 0; s < kDrumSteps; ++s) lane.add((int)u.table[idx].lanes[(size_t)v][(size_t)s]);
                node->setProperty(kVoiceKeys[v], lane);
            }
            nodes->setProperty(juce::String(c) + "," + juce::String(r), juce::var(node));
        }
    out->setProperty("nodes", juce::var(nodes));
    return juce::JSON::toString(result, true).toStdString();
}

class DrumMapModule final : public Module {
public:
    enum { X, Y, KickDensity, SnareDensity, HatsDensity, FillAmount, Chaos, Accent, Swing, NoteLength,
           Length, Rate, ChaosRate, Seed, KickNote, SnareNote, HatsNote, SyncTo };
    enum { Clock, Reset, Fill };
    enum { Kick, Snare, Hats, KickAcc, SnareAcc, HatsAcc, KickVel, SnareVel, HatsVel, Notes, Step, End };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        const UserNodes u = parseNodes(juce::JSON::parse(juce::String(json)));
        auto table = std::make_shared<const DrumMapTable>(u.table);
        published_ = table;
        edited_ = u.edited;
        handoff_.publish(std::move(table));
    }

    /// The view picks a node to edit: its levels come back as the live array "node".
    void command(const std::string& id, float value) override {
        if (id == "editnode") editNode_.store((int)std::lround(value));
        else Module::command(id, value);
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"step", (double)step_.load()});
        out.push_back({"px", (double)px_.load()});
        out.push_back({"py", (double)py_.load()});
        out.push_back({"hits", (double)hits_.load()});
        static const char* dens[kDrumVoices] = {"kd", "sd", "hd"};
        for (int v = 0; v < kDrumVoices; ++v) out.push_back({dens[v], (double)density_[(size_t)v].load()});
        out.push_back({"accent", (double)accent_.load()});
        uint32_t edited = 0;
        for (int i = 0; i < patch::kDrumNodes; ++i)
            if (edited_[(size_t)i]) edited |= 1u << i;
        out.push_back({"edited", (double)edited});
    }

    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        const DrumMapTable& map = published_ ? *published_ : patch::drumFactoryMap();
        // The pattern as it plays now: levels at the modulated X/Y, after Chaos.
        std::vector<float> levels((size_t)(kDrumVoices * kDrumSteps));
        const float x = px_.load(), y = py_.load(), chaos = chaos_.load();
        const uint32_t seed = (uint32_t)seed_.load();
        const int64_t block = block_.load();
        for (int v = 0; v < kDrumVoices; ++v)
            for (int s = 0; s < kDrumSteps; ++s)
                levels[(size_t)(v * kDrumSteps + s)] = patch::drumChaos(patch::drumLevel(map, x, y, v, s), chaos, seed, block, s, v);
        out.push_back({"levels", std::move(levels)});
        const int node = editNode_.load();
        if (node >= 0 && node < patch::kDrumNodes) {
            std::vector<float> lanes;
            for (int v = 0; v < kDrumVoices; ++v)
                for (int s = 0; s < kDrumSteps; ++s) lanes.push_back((float)map[(size_t)node].lanes[(size_t)v][(size_t)s]);
            out.push_back({"node", std::move(lanes)});
        }
    }

    void process(const ProcessContext& c) override {
        dsp_.setMap(handoff_.get());
        patch::DrumParams p;
        p.length = (int)setting(Length);
        p.rate = (int)setting(Rate);
        p.chaosRate = (int)setting(ChaosRate);
        p.seed = (uint32_t)setting(Seed);
        p.note = {(int)setting(KickNote), (int)setting(SnareNote), (int)setting(HatsNote)};
        const Transport& tr = *c.transport;
        patch::DrumTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        patch::DrumInputs in;
        in.clockPatched = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        NoteBuffer& notes = *c.notesOut[Notes];
        notes.clear();
        patch::DrumOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            p.x = value(c, X, i);
            p.y = value(c, Y, i);
            for (int v = 0; v < kDrumVoices; ++v) p.density[(size_t)v] = value(c, KickDensity + v, i);
            p.fillAmount = value(c, FillAmount, i);
            p.chaos = value(c, Chaos, i);
            p.accent = value(c, Accent, i);
            p.swing = value(c, Swing, i);
            p.noteLength = value(c, NoteLength, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            in.clock = c.inputs[Clock][i];
            in.reset = c.inputs[Reset][i];
            in.fill = c.inputs[Fill][i];
            dsp_.tick(p, in, t, o, dsp::noteEmitter(notes, i));
            for (int v = 0; v < kDrumVoices; ++v) {
                c.outputs[Kick + v][i] = o.trig[(size_t)v];
                c.outputs[KickAcc + v][i] = o.accent[(size_t)v];
                c.outputs[KickVel + v][i] = o.vel[(size_t)v];
            }
            c.outputs[Step][i] = o.step;
            c.outputs[End][i] = o.end;
        }
        const bool fill = c.numSamples > 0 && c.inputs[Fill][c.numSamples - 1] >= 0.5f;
        step_.store(dsp_.step());
        px_.store(p.x);
        py_.store(p.y);
        chaos_.store(p.chaos);
        seed_.store((int)p.seed);
        block_.store(dsp_.block());
        hits_.store(dsp_.hits());
        accent_.store(p.accent);
        for (int v = 0; v < kDrumVoices; ++v)
            density_[(size_t)v].store(std::clamp(p.density[(size_t)v] + (fill ? p.fillAmount : 0.0f), 0.0f, 1.0f));
    }

private:
    DrumMapDsp dsp_;
    std::string data_;                               // message thread
    std::shared_ptr<const DrumMapTable> published_;  // message thread
    std::array<bool, patch::kDrumNodes> edited_{};   // message thread
    RtHandoff<DrumMapTable> handoff_;
    std::atomic<int> step_{0}, seed_{1}, editNode_{-1};
    std::atomic<int64_t> block_{0};
    std::atomic<uint32_t> hits_{0};
    std::atomic<float> px_{0.25f}, py_{0.25f}, chaos_{0.0f}, accent_{0.78f};
    std::array<std::atomic<float>, kDrumVoices> density_{};
};

}  // namespace

static void registerDrumMapModule(Registry& r) {
    ModuleSpec s;
    s.type = "drum-map";
    s.name = "Drum Map";
    s.category = "Sequencing/Drum";
    s.colour = "#f08a4b";
    s.description = "Kick, snare and hats from a map of patterns: move X and Y to travel between rhythms, Density to thin or fill.";
    std::vector<std::string> rates;
    for (const char* n : patch::drumRateNames()) rates.emplace_back(n);
    s.params = {ParamSpec::percent("x", "X", 0.0f, 1.0f, 0.25f).inGroup("Map"),
                ParamSpec::percent("y", "Y", 0.0f, 1.0f, 0.25f).inGroup("Map"),
                ParamSpec::percent("kickdensity", "Kick Density", 0.0f, 1.0f, 0.5f).inGroup("Density"),
                ParamSpec::percent("snaredensity", "Snare Density", 0.0f, 1.0f, 0.5f).inGroup("Density"),
                ParamSpec::percent("hatsdensity", "Hats Density", 0.0f, 1.0f, 0.5f).inGroup("Density"),
                ParamSpec::percent("fillamount", "Fill Amount", 0.0f, 1.0f, 0.35f).inGroup("Density"),
                ParamSpec::percent("chaos", "Chaos", 0.0f, 1.0f, 0.0f).inGroup("Feel"),
                ParamSpec::percent("accent", "Accent", 0.5f, 1.0f, 0.78f).inGroup("Feel"),
                ParamSpec::percent("swing", "Swing", 0.5f, 0.75f, 0.5f).inGroup("Feel"),
                ParamSpec::percent("notelength", "Note Length", 0.1f, 1.0f, 0.5f).inGroup("Feel"),
                ParamSpec::integer("length", "Length", 1, kDrumSteps, kDrumSteps),
                ParamSpec::choice("rate", "Rate", rates, 2),
                ParamSpec::choice("chaosrate", "Chaos Rate", {"Every bar", "Every 2 bars", "Every 4 bars", "Every 8 bars", "Frozen"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1),
                ParamSpec::integer("kicknote", "Kick Note", 0, 127, 36),
                ParamSpec::integer("snarenote", "Snare Note", 0, 127, 38),
                ParamSpec::integer("hatsnote", "Hats Note", 0, 127, 42),
                ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto)};
    s.inputs = {{"clock", "Clock", Signal::Trigger}, {"reset", "Reset", Signal::Trigger}, {"fill", "Fill", Signal::Gate}};
    s.outputs = {{"kick", "Kick", Signal::Trigger, false},
                 {"snare", "Snare", Signal::Trigger, false},
                 {"hats", "Hats", Signal::Trigger, false},
                 {"kickacc", "Kick Acc", Signal::Trigger, false},
                 {"snareacc", "Snare Acc", Signal::Trigger, false},
                 {"hatsacc", "Hats Acc", Signal::Trigger, false},
                 {"kickvel", "Kick Vel", Signal::Control, false},
                 {"snarevel", "Snare Vel", Signal::Control, false},
                 {"hatsvel", "Hats Vel", Signal::Control, false},
                 {"notes", "Notes", Signal::Notes, false},
                 {"step", "Step", Signal::Control, false},
                 {"end", "End", Signal::Trigger, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<DrumMapModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerDrumMapModule);

}  // namespace bleep::engine
