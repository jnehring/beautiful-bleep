// SPDX-License-Identifier: GPL-3.0-only
// Stage Seq node (doc/specs/modules/stage-sequencer.md): stages from the node's
// data, pulses from the transport or a clock, notes and CV out.
#include "StageSequencerDsp.h"
#include "Registry.h"
#include "dsp/SeqClock.h"

#include <juce_core/juce_core.h>

#include <atomic>

namespace bleep::engine {
namespace {

using patch::Stage;
using patch::StagePattern;
using patch::StageSequencerDsp;

/// A new module: a bass-and-lead line of 8 stages, 12 pulses long, so it
/// drifts across the bar lines.
StagePattern defaultPattern() {
    static const int pitch[8] = {0, 0, 7, 4, 0, 7, 12, 7};
    static const int pulses[8] = {2, 1, 1, 2, 1, 1, 3, 1};
    static const int gate[8] = {patch::StageHold,  patch::StageEvery, patch::StageEvery, patch::StageHold,
                                patch::StageFirst, patch::StageEvery, patch::StageHold,  patch::StageRatchet};
    StagePattern p{};
    for (int i = 0; i < 8; ++i) {
        Stage& s = p[(size_t)i];
        s.pitch = (int8_t)pitch[i];
        s.pulses = (uint8_t)pulses[i];
        s.gate = (uint8_t)gate[i];
        s.velocity = (uint8_t)(i % 4 == 0 ? 110 : 90);
    }
    p[0].accent = p[4].accent = true;
    p[6].slide = true;
    return p;
}

/// The node's data, parsed and clamped.
StagePattern parseStages(const juce::var& data) {
    const auto* stages = data["stages"].getArray();
    if (stages == nullptr) return defaultPattern();
    StagePattern p{};
    for (int i = 0; i < patch::kStages && i < stages->size(); ++i) {
        const juce::var v = (*stages)[i];
        Stage& s = p[(size_t)i];
        s.pitch = (int8_t)juce::jlimit(patch::kStageMinPitch, patch::kStageMaxPitch, (int)v.getProperty("p", 0));
        s.pulses = (uint8_t)juce::jlimit(1, patch::kStageMaxPulses, (int)v.getProperty("n", 1));
        s.gate = (uint8_t)juce::jlimit(0, 4, (int)v.getProperty("g", (int)patch::StageEvery));
        s.ratchet = (uint8_t)juce::jlimit(2, 4, (int)v.getProperty("r", 2));
        s.slide = (int)v.getProperty("s", 0) != 0;
        s.velocity = (uint8_t)juce::jlimit(1, 127, (int)v.getProperty("v", 100));
        s.accent = (int)v.getProperty("a", 0) != 0;
    }
    return p;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const StagePattern p = parseStages(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> stages;
    for (const auto& s : p) {
        auto* o = new juce::DynamicObject();
        o->setProperty("p", (int)s.pitch);
        o->setProperty("n", (int)s.pulses);
        o->setProperty("g", (int)s.gate);
        o->setProperty("r", (int)s.ratchet);
        o->setProperty("s", s.slide ? 1 : 0);
        o->setProperty("v", (int)s.velocity);
        o->setProperty("a", s.accent ? 1 : 0);
        stages.add(juce::var(o));
    }
    out->setProperty("stages", stages);
    // Randomize options (spec §5), kept for the view.
    const juce::var r = in["randomize"];
    auto* ro = new juce::DynamicObject();
    auto number = [&](const char* key, double def, double lo, double hi) {
        const auto v = r.getProperty(key, def);
        return juce::jlimit(lo, hi, v.isDouble() || v.isInt() || v.isInt64() ? (double)v : def);
    };
    juce::Array<juce::var> lanes;
    if (const auto* a = r["lanes"].getArray())
        for (const auto& l : *a)
            for (const char* known : {"pitch", "pulses", "gate", "slide", "accent", "velocity"})
                if (l.toString() == known && !lanes.contains(l)) lanes.add(juce::String(known));
    if (r["lanes"].getArray() == nullptr) lanes = {"pitch", "pulses", "gate"};
    ro->setProperty("lanes", lanes);
    ro->setProperty("octaves", (int)number("octaves", 1, 1, 3));
    ro->setProperty("maxPulses", (int)number("maxPulses", 4, 1, 8));
    ro->setProperty("slide", number("slide", 0.15, 0.0, 1.0));
    ro->setProperty("accent", number("accent", 0.15, 0.0, 1.0));
    out->setProperty("randomize", juce::var(ro));
    return juce::JSON::toString(result, true).toStdString();
}

class StageSequencerModule final : public Module {
public:
    enum { GateLength, SlideTime, Accent, Swing, Stages, Rate, Mode, Phrase, Root, Scale, Octave, Seed, SyncTo };
    enum { Clock, Reset, Hold, Transpose };
    enum { Notes, Pitch, Gate, Velocity, AccentOut, Trigger, StageOut, StageStart, End };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        const StagePattern p = parseStages(juce::JSON::parse(juce::String(json)));
        const juce::SpinLock::ScopedLockType lock(lock_);
        pending_ = p;
        hasPending_ = true;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"stage", (double)stage_.load()});
        out.push_back({"pulse", (double)pulse_.load()});
        out.push_back({"sounding", sounding_.load() ? 1.0 : 0.0});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> trail;
        const int n = trailLen_.load();
        for (int i = 0; i < n && i < 8; ++i) trail.push_back((float)trail_[(size_t)i].load());
        out.push_back({"trail", std::move(trail)});
    }

    void process(const ProcessContext& c) override {
        {
            const juce::SpinLock::ScopedTryLockType lock(lock_);
            if (lock.isLocked() && hasPending_) {
                dsp_.setPattern(pending_);
                hasPending_ = false;
            }
        }
        patch::StageParams p;
        p.stages = (int)setting(Stages);
        p.rate = (int)setting(Rate);
        p.mode = (int)setting(Mode);
        p.phrase = (int)setting(Phrase);
        p.root = (int)setting(Root);
        p.scale = (int)setting(Scale);
        p.octave = (int)setting(Octave);
        p.seed = (uint32_t)setting(Seed);
        const Transport& tr = *c.transport;
        patch::StageTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        patch::StageInputs in;
        in.clockPatched = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        NoteBuffer& notes = *c.notesOut[Notes];
        notes.clear();
        patch::StageOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            p.gateLength = value(c, GateLength, i);
            p.slideTime = value(c, SlideTime, i);
            p.accent = value(c, Accent, i);
            p.swing = value(c, Swing, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            in.clock = c.inputs[Clock][i];
            in.reset = c.inputs[Reset][i];
            in.hold = c.inputs[Hold][i];
            in.transpose = c.inputs[Transpose][i];
            dsp_.tick(p, in, t, o, dsp::noteEmitter(notes, i));
            c.outputs[Pitch][i] = o.pitch;
            c.outputs[Gate][i] = o.gate;
            c.outputs[Velocity][i] = o.velocity;
            c.outputs[AccentOut][i] = o.accent;
            c.outputs[Trigger][i] = o.trigger;
            c.outputs[StageOut][i] = o.stage;
            c.outputs[StageStart][i] = o.stageStart;
            c.outputs[End][i] = o.end;
        }
        stage_.store(dsp_.playingStage());
        pulse_.store(dsp_.playingPulse());
        sounding_.store(dsp_.sounding());
        int trail[8];
        const int n = dsp_.trail(trail, 8);
        for (int i = 0; i < n; ++i) trail_[(size_t)i].store(trail[i]);
        trailLen_.store(n);
    }

private:
    StageSequencerDsp dsp_;
    std::string data_;  // message thread
    juce::SpinLock lock_;
    StagePattern pending_{};
    bool hasPending_ = false;
    std::atomic<int> stage_{0}, pulse_{0}, trailLen_{0};
    std::atomic<bool> sounding_{false};
    std::array<std::atomic<int>, 8> trail_{};
};

}  // namespace

static void registerStageSequencerModule(Registry& r) {
    ModuleSpec s;
    s.type = "stage-sequencer";
    s.name = "Stage Seq";
    s.category = "Sequencing/Melodic";
    s.colour = "#e3a73b";
    s.description = "Up to 16 stages, each a pitch held for 1–8 pulses with its own gate mode, slide and accent.";
    std::vector<std::string> rates, roots, scales;
    for (int i = 0; i < dsp::kNumSequencerRates; ++i) rates.emplace_back(dsp::sequencerRate(i).name);
    for (const char* n : {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}) roots.emplace_back(n);
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    s.params = {ParamSpec::percent("gatelength", "Gate Length", 0.01f, 1.0f, 0.5f),
                ParamSpec::seconds("slidetime", "Slide Time", 0.001f, 2.0f, 0.15f, 0.08f),
                ParamSpec::percent("accent", "Accent", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("swing", "Swing", 0.5f, 0.75f, 0.5f),
                ParamSpec::integer("stages", "Stages", 1, patch::kStages, 8),
                ParamSpec::choice("rate", "Rate", rates, 9),
                ParamSpec::choice("mode", "Mode", {"Forward", "Reverse", "Pendulum", "Random", "Brownian"}, 0),
                ParamSpec::choice("phrase", "Phrase", {"1 bar", "2 bars", "4 bars", "8 bars", "16 bars"}, 2)
                    .when("mode", 3, 4),
                ParamSpec::choice("root", "Root", roots, 0),
                ParamSpec::choice("scale", "Scale", scales, 1),
                ParamSpec::integer("octave", "Octave", -3, 3, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1),
                ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto)};
    s.inputs = {{"clock", "Clock", Signal::Trigger},
                {"reset", "Reset", Signal::Trigger},
                {"hold", "Hold", Signal::Gate},
                {"transpose", "Transpose", Signal::Pitch}};
    s.outputs = {{"notes", "Notes", Signal::Notes, false},       {"pitch", "Pitch", Signal::Pitch, true},
                 {"gate", "Gate", Signal::Gate, false},          {"velocity", "Velocity", Signal::Control, false},
                 {"accentgate", "Accent", Signal::Gate, false},     {"trigger", "Trigger", Signal::Trigger, false},
                 {"stage", "Stage", Signal::Control, false},     {"stagestart", "Stage Start", Signal::Trigger, false},
                 {"end", "End", Signal::Trigger, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<StageSequencerModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerStageSequencerModule);

}  // namespace bleep::engine
