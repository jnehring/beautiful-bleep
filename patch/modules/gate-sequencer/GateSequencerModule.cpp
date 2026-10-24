// SPDX-License-Identifier: GPL-3.0-only
// Gate Sequencer node (doc/specs/modules/gate-sequencer.md): four tracks of deep
// steps from the node's data, gates, triggers, velocities and notes out.
#include "GateSequencerDsp.h"
#include "Registry.h"
#include "dsp/SeqClock.h"

#include <juce_core/juce_core.h>

#include <atomic>

namespace bleep::engine {
namespace {

using patch::GatePattern;
using patch::GateSequencerDsp;
using patch::GateStep;
using patch::kGateSteps;
using patch::kGateTracks;

/// A new module: a kick on the beats, a snare on 2 and 4 with a ghost, hats
/// on the 8ths that breathe on the off-beats with a ratchet at the end, and
/// an empty fourth track.
GatePattern defaultPattern() {
    GatePattern p{};
    auto on = [&](int t, int i, int prob = 100, int vel = 100) {
        GateStep& s = p[(size_t)t].steps[(size_t)i];
        s.on = true;
        s.prob = (uint8_t)prob;
        s.velocity = (uint8_t)vel;
    };
    for (int i = 0; i < 16; i += 4) on(0, i, 100, 120);
    on(1, 4, 100, 110);
    on(1, 12, 100, 110);
    on(1, 15, 35, 50);
    for (int i = 0; i < 16; i += 2) on(2, i, i % 4 == 2 ? 60 : 100, i % 4 == 0 ? 100 : 75);
    p[2].steps[14].ratchet = 3;
    p[2].steps[14].shape = patch::GateFaster;
    return p;
}

int number(const juce::var& o, const char* key, int def, int lo, int hi) {
    const auto v = o.getProperty(key, def);
    return juce::jlimit(lo, hi, v.isDouble() || v.isInt() || v.isInt64() || v.isBool() ? (int)v : def);
}

/// The node's data, parsed and clamped.
GatePattern parseTracks(const juce::var& data) {
    const auto* tracks = data["tracks"].getArray();
    if (tracks == nullptr) return defaultPattern();
    GatePattern p{};
    for (int t = 0; t < kGateTracks && t < tracks->size(); ++t) {
        const juce::var tr = (*tracks)[t];
        p[(size_t)t].mute = (bool)tr.getProperty("mute", false);
        const auto* steps = tr["steps"].getArray();
        if (steps == nullptr) continue;
        for (int i = 0; i < kGateSteps && i < steps->size(); ++i) {
            const juce::var v = (*steps)[i];
            GateStep& s = p[(size_t)t].steps[(size_t)i];
            s.on = number(v, "on", 0, 0, 1) != 0;
            s.prob = (uint8_t)number(v, "p", 100, 0, 100);
            s.length = (uint8_t)number(v, "l", 50, 1, 100);
            s.tie = number(v, "t", 0, 0, 1) != 0;
            s.ratchet = (uint8_t)number(v, "r", 1, 1, 8);
            s.shape = (uint8_t)number(v, "rs", 0, 0, 2);
            s.nudge = (int8_t)number(v, "n", 0, -50, 50);
            s.velocity = (uint8_t)number(v, "v", 100, 1, 127);
            if (const auto* c = v["c"].getArray(); c && c->size() == 2) {
                s.cond = (uint8_t)juce::jlimit(0, 7, (int)(*c)[0]);
                const int arg = (int)(*c)[1];
                s.condB = (uint8_t)juce::jlimit(2, 8, arg % 10);
                s.condA = (uint8_t)juce::jlimit(1, (int)s.condB, arg / 10);
            }
        }
    }
    return p;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const GatePattern p = parseTracks(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> tracks;
    for (const auto& tr : p) {
        auto* to = new juce::DynamicObject();
        to->setProperty("mute", tr.mute);
        juce::Array<juce::var> steps;
        for (const auto& s : tr.steps) {
            auto* o = new juce::DynamicObject();
            o->setProperty("on", s.on ? 1 : 0);
            o->setProperty("p", (int)s.prob);
            o->setProperty("l", (int)s.length);
            o->setProperty("t", s.tie ? 1 : 0);
            o->setProperty("r", (int)s.ratchet);
            o->setProperty("rs", (int)s.shape);
            o->setProperty("n", (int)s.nudge);
            o->setProperty("c", juce::Array<juce::var>{(int)s.cond, s.cond == patch::GateAB ? s.condA * 10 + s.condB : 0});
            o->setProperty("v", (int)s.velocity);
            steps.add(juce::var(o));
        }
        to->setProperty("steps", steps);
        tracks.add(juce::var(to));
    }
    out->setProperty("tracks", tracks);
    return juce::JSON::toString(result, true).toStdString();
}

class GateSequencerModule final : public Module {
public:
    enum { Chance1, Chance2, Chance3, Chance4, NudgeDepth, RatchetDecay, Swing,
           Length1, Length2, Length3, Length4, Rate1, Rate2, Rate3, Rate4, Dice, Seed, Note1, Note2, Note3, Note4, SyncTo };
    enum { Clock, Reset, Fill, Mute1 };
    enum { Gate1 = 0, Trig1 = 4, Vel1 = 8, Notes = 12, Cycle = 13 };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        const GatePattern p = parseTracks(juce::JSON::parse(juce::String(json)));
        const juce::SpinLock::ScopedLockType lock(lock_);
        pending_ = p;
        hasPending_ = true;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        static const char* pos[] = {"pos1", "pos2", "pos3", "pos4"};
        static const char* up[] = {"upcoming1", "upcoming2", "upcoming3", "upcoming4"};
        for (int t = 0; t < kGateTracks; ++t) {
            out.push_back({pos[t], (double)pos_[(size_t)t].load()});
            out.push_back({up[t], (double)upcoming_[(size_t)t].load()});
        }
        out.push_back({"hits", (double)hits_.load()});
    }

    void process(const ProcessContext& c) override {
        {
            const juce::SpinLock::ScopedTryLockType lock(lock_);
            if (lock.isLocked() && hasPending_) {
                dsp_.setPattern(pending_);
                hasPending_ = false;
            }
        }
        patch::GateParams p;
        for (int t = 0; t < kGateTracks; ++t) {
            p.length[(size_t)t] = (int)setting(Length1 + t);
            p.rate[(size_t)t] = (int)setting(Rate1 + t);
            p.note[(size_t)t] = (int)setting(Note1 + t);
        }
        p.dice = (int)setting(Dice);
        p.seed = (uint32_t)setting(Seed);
        const Transport& tr = *c.transport;
        patch::GateTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        patch::GateInputs in;
        in.clockPatched = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        NoteBuffer& notes = *c.notesOut[Notes];
        notes.clear();
        patch::GateOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            for (int k = 0; k < kGateTracks; ++k) {
                p.chance[(size_t)k] = value(c, Chance1 + k, i);
                in.mute[(size_t)k] = c.inputs[Mute1 + k][i];
            }
            p.nudgeDepth = value(c, NudgeDepth, i);
            p.ratchetDecay = value(c, RatchetDecay, i);
            p.swing = value(c, Swing, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            in.clock = c.inputs[Clock][i];
            in.reset = c.inputs[Reset][i];
            in.fill = c.inputs[Fill][i];
            dsp_.tick(p, in, t, o, dsp::noteEmitter(notes, i));
            for (int k = 0; k < kGateTracks; ++k) {
                c.outputs[Gate1 + k][i] = o.gate[(size_t)k];
                c.outputs[Trig1 + k][i] = o.trig[(size_t)k];
                c.outputs[Vel1 + k][i] = o.vel[(size_t)k];
            }
            c.outputs[Cycle][i] = o.cycle;
        }
        for (int k = 0; k < kGateTracks; ++k) {
            pos_[(size_t)k].store(dsp_.position(k));
            upcoming_[(size_t)k].store(dsp_.upcoming(k));
        }
        hits_.store(dsp_.hits());
    }

private:
    GateSequencerDsp dsp_;
    std::string data_;  // message thread
    juce::SpinLock lock_;
    GatePattern pending_{};
    bool hasPending_ = false;
    std::array<std::atomic<int>, kGateTracks> pos_{};
    std::array<std::atomic<uint32_t>, kGateTracks> upcoming_{};
    std::atomic<uint32_t> hits_{0};
};

}  // namespace

static void registerGateSequencerModule(Registry& r) {
    ModuleSpec s;
    s.type = "gate-sequencer";
    s.name = "Gate Sequencer";
    s.category = "Sequencing/Drum";
    s.colour = "#d4e157";
    s.description = "Four tracks of 32 deep steps: probability, ratchets, nudge and conditions. Each track has its own length and rate.";
    std::vector<std::string> rates;
    for (int i = 0; i < dsp::kNumSequencerRates; ++i) rates.emplace_back(dsp::sequencerRate(i).name);
    const int notes[4] = {36, 38, 42, 46};
    for (int t = 1; t <= 4; ++t)
        s.params.push_back(ParamSpec::percent("chance" + std::to_string(t), "Chance " + std::to_string(t), 0.0f, 2.0f, 1.0f)
                               .inGroup("Chance"));
    s.params.push_back(ParamSpec::percent("nudgedepth", "Nudge Depth", 0.0f, 1.0f, 1.0f).inGroup("Feel"));
    s.params.push_back(ParamSpec::percent("ratchetdecay", "Ratchet Decay", 0.0f, 1.0f, 0.0f).inGroup("Feel"));
    s.params.push_back(ParamSpec::percent("swing", "Swing", 0.5f, 0.75f, 0.5f).inGroup("Feel"));
    for (int t = 1; t <= 4; ++t)
        s.params.push_back(ParamSpec::integer("length" + std::to_string(t), "Length " + std::to_string(t), 1, kGateSteps, 16));
    for (int t = 1; t <= 4; ++t)
        s.params.push_back(ParamSpec::choice("rate" + std::to_string(t), "Rate " + std::to_string(t), rates, 9));
    s.params.push_back(ParamSpec::choice("dice", "Dice",
                                         {"New every loop", "Repeat every 2", "Repeat every 4", "Repeat every 8", "Fixed"}, 0));
    s.params.push_back(ParamSpec::integer("seed", "Seed", 0, 999, 1));
    for (int t = 1; t <= 4; ++t)
        s.params.push_back(ParamSpec::integer("note" + std::to_string(t), "Note " + std::to_string(t), 0, 127, notes[t - 1]));
    s.params.push_back(ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto));
    s.inputs = {{"clock", "Clock", Signal::Trigger}, {"reset", "Reset", Signal::Trigger}, {"fill", "Fill", Signal::Gate}};
    for (int t = 1; t <= 4; ++t) s.inputs.push_back({"mute" + std::to_string(t), "Mute " + std::to_string(t), Signal::Gate});
    for (int t = 1; t <= 4; ++t) s.outputs.push_back({"gate" + std::to_string(t), "Gate " + std::to_string(t), Signal::Gate, false});
    for (int t = 1; t <= 4; ++t) s.outputs.push_back({"trig" + std::to_string(t), "Trig " + std::to_string(t), Signal::Trigger, false});
    for (int t = 1; t <= 4; ++t) s.outputs.push_back({"vel" + std::to_string(t), "Vel " + std::to_string(t), Signal::Control, false});
    s.outputs.push_back({"notes", "Notes", Signal::Notes, false});
    s.outputs.push_back({"cycle", "Cycle", Signal::Trigger, false});
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<GateSequencerModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerGateSequencerModule);

}  // namespace bleep::engine
