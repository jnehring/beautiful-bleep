// SPDX-License-Identifier: GPL-3.0-only
// Polymeter Seq node (doc/specs/modules/polymeter-sequencer.md): six parameter
// tracks in up to 8 slots from the node's data, base ticks from the
// transport or a clock, notes and CV out.
#include "PolymeterSequencerDsp.h"
#include "Handoff.h"
#include "Registry.h"
#include "dsp/SeqClock.h"

#include <juce_core/juce_core.h>

#include <atomic>

namespace bleep::engine {
namespace {

using patch::kPolySlots;
using patch::kPolySteps;
using patch::kPolyTracks;
using patch::PolyPattern;
using patch::PolySlot;
using patch::PolyTrack;
using patch::PolymeterSequencerDsp;

const char* const kTrackKeys[kPolyTracks] = {"trig", "note", "oct", "gate", "prob", "ratch"};
const char* const kDirections[4] = {"fwd", "bwd", "pp", "rnd"};

int number(const juce::var& v, int def) {
    return v.isDouble() || v.isInt() || v.isInt64() || v.isBool() ? (int)v : def;
}

/// A step value of track k, clamped.
int clampStep(int k, int v) {
    switch (k) {
        case patch::PolyTrig: return juce::jlimit(0, 2, v);
        case patch::PolyNote: return juce::jlimit(patch::kPolyMinDegree, patch::kPolyMaxDegree, v);
        case patch::PolyOct: return juce::jlimit(-3, 3, v);
        case patch::PolyGate: return v < 0 ? patch::kPolyTie : juce::jlimit(5, 100, v);
        case patch::PolyProb: return juce::jlimit(0, 100, v);
        default: return juce::jlimit(1, 8, v);
    }
}

PolyTrack parseTrack(int k, const juce::var& t, const PolyTrack& def) {
    if (!t.isObject()) return def;
    PolyTrack r = def;
    r.length = (uint8_t)juce::jlimit(1, kPolySteps, number(t["len"], def.length));
    r.lo = (uint8_t)juce::jlimit(0, r.length - 1, number(t["lo"], 0));
    r.hi = (uint8_t)juce::jlimit((int)r.lo, r.length - 1, number(t["hi"], r.length - 1));
    const juce::String div = t["div"].toString();
    for (int d = 0; d < patch::kPolyDivisions; ++d)
        if (div == patch::polyDivisionNames()[(size_t)d]) r.division = (uint8_t)d;
    const juce::String dir = t["dir"].toString();
    for (int d = 0; d < 4; ++d)
        if (dir == kDirections[d]) r.direction = (uint8_t)d;
    r.mute = (bool)t.getProperty("mute", false);
    r.steps.fill((int8_t)patch::polyNeutral(k));
    r.shape.fill(0);
    if (const auto* a = t["steps"].getArray()) {
        for (int i = 0; i < kPolySteps && i < a->size(); ++i) {
            const juce::var v = (*a)[i];
            if (const auto* pair = v.getArray(); pair && pair->size() >= 1) {  // Ratchet: [count, shape]
                r.steps[(size_t)i] = (int8_t)clampStep(k, number((*pair)[0], 1));
                r.shape[(size_t)i] = (uint8_t)juce::jlimit(0, 2, pair->size() > 1 ? number((*pair)[1], 0) : 0);
            } else {
                r.steps[(size_t)i] = (int8_t)clampStep(k, number(v, patch::polyNeutral(k)));
            }
        }
    }
    return r;
}

/// The node's data, parsed and clamped; missing slots get the default pattern.
PolyPattern parsePattern(const juce::var& data) {
    PolyPattern p;
    const PolySlot def = patch::polyDefaultSlot();
    const auto* slots = data["slots"].getArray();
    for (int s = 0; s < kPolySlots; ++s) {
        p[(size_t)s] = def;
        if (!slots || s >= slots->size()) continue;
        const juce::var tracks = (*slots)[s]["tracks"];
        for (int k = 0; k < kPolyTracks; ++k) p[(size_t)s][(size_t)k] = parseTrack(k, tracks[kTrackKeys[k]], def[(size_t)k]);
    }
    return p;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const PolyPattern p = parsePattern(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    out->setProperty("slot", juce::jlimit(0, kPolySlots - 1, number(in["slot"], 0)));
    juce::Array<juce::var> slots;
    for (const auto& slot : p) {
        auto* tracks = new juce::DynamicObject();
        for (int k = 0; k < kPolyTracks; ++k) {
            const PolyTrack& t = slot[(size_t)k];
            auto* o = new juce::DynamicObject();
            o->setProperty("len", (int)t.length);
            o->setProperty("lo", (int)t.lo);
            o->setProperty("hi", (int)t.hi);
            o->setProperty("div", juce::String(patch::polyDivisionNames()[t.division]));
            o->setProperty("dir", juce::String(kDirections[t.direction]));
            o->setProperty("mute", t.mute);
            juce::Array<juce::var> steps;
            for (int i = 0; i < kPolySteps; ++i) {
                if (k == patch::PolyRatch) steps.add(juce::Array<juce::var>{(int)t.steps[(size_t)i], (int)t.shape[(size_t)i]});
                else steps.add((int)t.steps[(size_t)i]);
            }
            o->setProperty("steps", steps);
            tracks->setProperty(kTrackKeys[k], juce::var(o));
        }
        auto* so = new juce::DynamicObject();
        so->setProperty("tracks", juce::var(tracks));
        slots.add(juce::var(so));
    }
    out->setProperty("slots", slots);
    // Randomize options (spec §4.5), kept for the view.
    const juce::var r = in["randomize"];
    auto* ro = new juce::DynamicObject();
    const auto dens = r.getProperty("density", 0.5);
    ro->setProperty("density", juce::jlimit(0.0, 1.0, dens.isDouble() || dens.isInt() ? (double)dens : 0.5));
    int lo = 0, hi = 7;
    if (const auto* a = r["degrees"].getArray(); a && a->size() == 2) {
        lo = juce::jlimit(patch::kPolyMinDegree, patch::kPolyMaxDegree, number((*a)[0], 0));
        hi = juce::jlimit(patch::kPolyMinDegree, patch::kPolyMaxDegree, number((*a)[1], 7));
        if (lo > hi) std::swap(lo, hi);
    }
    ro->setProperty("degrees", juce::Array<juce::var>{lo, hi});
    ro->setProperty("stepwise", (bool)r.getProperty("stepwise", true));
    const auto rc = r.getProperty("ratchet", 0.1);
    ro->setProperty("ratchet", juce::jlimit(0.0, 1.0, rc.isDouble() || rc.isInt() ? (double)rc : 0.1));
    out->setProperty("randomize", juce::var(ro));
    return juce::JSON::toString(result, true).toStdString();
}

class PolymeterSequencerModule final : public Module {
public:
    enum { GateScale, ProbBias, RatchetAmt, Swing, Velocity, Spread, Rate, Root, Scale, Octave, SlotsUsed, PatternChange, Seed, SyncTo };
    enum { Clock, Reset, Transpose, Pattern, Hold };
    enum { Notes, Pitch, Gate, VelocityOut, Trigger, Bar, TrackEnds };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        const juce::var v = juce::JSON::parse(juce::String(json));
        dataSlot_.store(juce::jlimit(0, kPolySlots - 1, number(v["slot"], 0)));
        auto p = std::make_shared<PolyPattern>(parsePattern(v));
        if (published_ && *published_ == *p) return;  // only the slot or the options changed
        published_ = p;
        cycle_.store(PolymeterSequencerDsp::cycleTicks((*p)[(size_t)dataSlot_.load()]));
        handoff_.publish(std::move(p));
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        static const char* names[kPolyTracks] = {"pos0", "pos1", "pos2", "pos3", "pos4", "pos5"};
        for (int k = 0; k < kPolyTracks; ++k) out.push_back({names[k], (double)pos_[(size_t)k].load()});
        out.push_back({"slot", (double)slot_.load()});
        out.push_back({"cycle", (double)cycle_.load()});
        out.push_back({"sounding", sounding_.load() ? 1.0 : 0.0});
    }

    void process(const ProcessContext& c) override {
        dsp_.setPattern(handoff_.get());
        patch::PolyParams p;
        p.rate = (int)setting(Rate);
        p.root = (int)setting(Root);
        p.scale = (int)setting(Scale);
        p.octave = (int)setting(Octave);
        p.slotsUsed = (int)setting(SlotsUsed);
        p.change = (int)setting(PatternChange);
        p.seed = (uint32_t)setting(Seed);
        const Transport& tr = *c.transport;
        patch::PolyTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        patch::PolyInputs in;
        in.clockPatched = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        in.patternPatched = c.inputConnected[Pattern];
        in.dataSlot = dataSlot_.load();
        NoteBuffer& notes = *c.notesOut[Notes];
        notes.clear();
        patch::PolyOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            p.gateScale = value(c, GateScale, i);
            p.probBias = value(c, ProbBias, i);
            p.ratchetAmount = value(c, RatchetAmt, i);
            p.swing = value(c, Swing, i);
            p.velocity = value(c, Velocity, i);
            p.spread = value(c, Spread, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            in.clock = c.inputs[Clock][i];
            in.reset = c.inputs[Reset][i];
            in.transpose = c.inputs[Transpose][i];
            in.pattern = c.inputs[Pattern][i];
            in.hold = c.inputs[Hold][i];
            dsp_.tick(p, in, t, o, dsp::noteEmitter(notes, i));
            c.outputs[Pitch][i] = o.pitch;
            c.outputs[Gate][i] = o.gate;
            c.outputs[VelocityOut][i] = o.velocity;
            c.outputs[Trigger][i] = o.trigger;
            c.outputs[Bar][i] = o.bar;
            c.outputs[TrackEnds][i] = o.trackEnds;
        }
        for (int k = 0; k < kPolyTracks; ++k) pos_[(size_t)k].store(dsp_.trackPosition(k));
        slot_.store(dsp_.slot());
        cycle_.store(dsp_.cycle());
        sounding_.store(dsp_.sounding());
    }

private:
    PolymeterSequencerDsp dsp_;
    std::string data_;  // message thread
    std::shared_ptr<const PolyPattern> published_;  // message thread
    RtHandoff<PolyPattern> handoff_;
    std::atomic<int> dataSlot_{0}, slot_{0};
    std::atomic<int64_t> cycle_{1};
    std::atomic<bool> sounding_{false};
    std::array<std::atomic<int>, kPolyTracks> pos_{};
};

}  // namespace

static void registerPolymeterSequencerModule(Registry& r) {
    ModuleSpec s;
    s.type = "polymeter-sequencer";
    s.name = "Polymeter Seq";
    s.category = "Sequencing/Melodic";
    s.colour = "#f59e6b";
    s.description = "A step split into six tracks (trigger, note, octave, gate, probability, ratchet), each with its own length and division.";
    std::vector<std::string> rates, roots, scales;
    for (int i = 0; i < dsp::kNumSequencerRates; ++i) rates.emplace_back(dsp::sequencerRate(i).name);
    for (const char* n : {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}) roots.emplace_back(n);
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    s.params = {ParamSpec::percent("gatescale", "Gate Scale", 0.1f, 2.0f, 1.0f),
                ParamSpec::percent("probbias", "Prob. Bias", -1.0f, 1.0f, 0.0f),
                ParamSpec::percent("ratchetamt", "Ratchet Amt", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("swing", "Swing", 0.5f, 0.75f, 0.5f),
                ParamSpec::percent("velocity", "Velocity", 0.0f, 1.0f, 0.8f),
                ParamSpec::percent("spread", "Spread", 0.0f, 1.0f, 0.0f),
                ParamSpec::choice("rate", "Rate", rates, 9),
                ParamSpec::choice("root", "Root", roots, 0),
                ParamSpec::choice("scale", "Scale", scales, 12),
                ParamSpec::integer("octave", "Octave", -3, 3, 0),
                ParamSpec::integer("slots", "Slots used", 1, kPolySlots, 1),
                ParamSpec::choice("patternchange", "Pattern Change", {"Immediate", "Next track end", "Next full cycle", "Next bar"}, 3),
                ParamSpec::integer("seed", "Seed", 0, 999, 1),
                ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto)};
    s.inputs = {{"clock", "Clock", Signal::Trigger},
                {"reset", "Reset", Signal::Trigger},
                {"transpose", "Transpose", Signal::Pitch},
                {"pattern", "Pattern", Signal::Control},
                {"hold", "Hold", Signal::Gate}};
    s.outputs = {{"notes", "Notes", Signal::Notes, false},    {"pitch", "Pitch", Signal::Pitch, true},
                 {"gate", "Gate", Signal::Gate, false},       {"velocity", "Velocity", Signal::Control, false},
                 {"trigger", "Trigger", Signal::Trigger, false}, {"bar", "Bar", Signal::Trigger, false},
                 {"trackends", "Track Ends", Signal::Trigger, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<PolymeterSequencerModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerPolymeterSequencerModule);

}  // namespace bleep::engine
