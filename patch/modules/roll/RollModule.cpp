// SPDX-License-Identifier: GPL-3.0-only
// Roll node (doc/specs/modules/roll.md): eight pattern slots of free-length
// notes from the node's data, timing from the transport or a clock, notes and
// low / high / latest-note CV out.
#include "RollDsp.h"
#include "Handoff.h"
#include "Registry.h"
#include "dsp/Harmony.h"
#include "dsp/SeqClock.h"
#include "dsp/SeqNotes.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <memory>

namespace bleep::engine {
namespace {

using patch::RollBank;
using patch::RollDsp;
using patch::RollNote;
using patch::RollSlot;

int number(const juce::var& v, int def) {
    return v.isDouble() || v.isInt() || v.isInt64() || v.isBool() ? (int)(double)v : def;
}

/// A new module plays this: a short rising line in slot 1.
void defaultNotes(RollSlot& s) {
    s.bars = 1;
    s.loopStart = 0;
    s.loopEnd = patch::kRollTicksPerBar;
    const int pitches[4] = {60, 63, 67, 70};
    s.count = 4;
    for (int i = 0; i < 4; ++i) {
        RollNote n;
        n.t = i * 48;
        n.l = 36;
        n.pitch = (uint8_t)pitches[i];
        n.vel = 100;
        s.notes[(size_t)i] = n;
    }
}

RollSlot parseSlot(const juce::var& v) {
    RollSlot s;
    s.bars = juce::jlimit(1, patch::kRollMaxBars, number(v["bars"], 2));
    const int len = s.length();
    s.loopStart = 0;
    s.loopEnd = len;
    if (const auto* a = v["loop"].getArray(); a && a->size() == 2) {
        s.loopStart = juce::jlimit(0, len - 1, number((*a)[0], 0));
        s.loopEnd = juce::jlimit(s.loopStart + 1, len, number((*a)[1], len));
    }
    if (const auto* a = v["notes"].getArray()) {
        for (const auto& item : *a) {
            const auto* f = item.getArray();
            if (f == nullptr || f->size() < 3 || s.count >= patch::kRollMaxNotes) continue;
            RollNote n;
            n.t = juce::jlimit(0, len - 1, number((*f)[0], 0));
            n.l = juce::jlimit(1, len - n.t, number((*f)[1], 24));
            n.pitch = (uint8_t)juce::jlimit(0, 127, number((*f)[2], 60));
            n.vel = (uint8_t)juce::jlimit(1, 127, f->size() > 3 ? number((*f)[3], 100) : 100);
            n.prob = (uint8_t)juce::jlimit(0, 100, f->size() > 4 ? number((*f)[4], 100) : 100);
            n.ratchet = (uint8_t)juce::jlimit(1, patch::kRollMaxRatchet, f->size() > 5 ? number((*f)[5], 1) : 1);
            s.notes[(size_t)s.count++] = n;
        }
    }
    std::sort(s.notes.begin(), s.notes.begin() + s.count, [](const RollNote& a, const RollNote& b) {
        return a.t != b.t ? a.t < b.t : a.pitch < b.pitch;
    });
    return s;
}

RollBank parseBank(const juce::var& data) {
    RollBank bank;
    const auto* slots = data["slots"].getArray();
    for (int i = 0; i < patch::kRollSlots; ++i) {
        if (slots == nullptr) {
            RollSlot s;
            if (i == 0) defaultNotes(s);
            bank[(size_t)i] = s;
        } else {
            bank[(size_t)i] = i < slots->size() ? parseSlot((*slots)[i]) : RollSlot{};
        }
    }
    return bank;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const RollBank bank = parseBank(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    out->setProperty("slot", juce::jlimit(0, patch::kRollSlots - 1, number(in["slot"], 0)));
    out->setProperty("grid", juce::jlimit(1, patch::kRollTicksPerBeat, number(in["grid"], 24)));
    out->setProperty("ghost", (bool)in.getProperty("ghost", true));
    juce::Array<juce::var> slots;
    for (const auto& s : bank) {
        auto* o = new juce::DynamicObject();
        o->setProperty("bars", (int)s.bars);
        o->setProperty("loop", juce::Array<juce::var>{(int)s.loopA(), (int)s.loopB()});
        juce::Array<juce::var> notes;
        for (int i = 0; i < s.count; ++i) {
            const RollNote& n = s.notes[(size_t)i];
            notes.add(juce::Array<juce::var>{(int)n.t, (int)n.l, (int)n.pitch, (int)n.vel, (int)n.prob, (int)n.ratchet});
        }
        o->setProperty("notes", notes);
        slots.add(juce::var(o));
    }
    out->setProperty("slots", slots);
    return juce::JSON::toString(result, true).toStdString();
}

class RollModule final : public Module {
public:
    enum { Morph, Humanise, Length, Swing, Slot, MorphTo, Speed, ClockStep, Root, Scale, Octave, Quantize, Harmony, Change, Seed, SyncTo };
    enum { Clock, Reset, Transpose, Pattern };
    enum { Notes, LowPitch, LowGate, HighPitch, HighGate, LastPitch, LastGate, VelocityOut, Trigger, Loop, Position };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        dsp_.reset();
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        auto bank = std::make_shared<RollBank>(parseBank(juce::JSON::parse(juce::String(json))));
        handoff_.publish(std::move(bank));
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"pos", (double)pos_.load()});
        out.push_back({"slot", (double)slot_.load()});
        out.push_back({"prev", (double)prev_.load()});
        out.push_back({"voices", (double)voices_.load()});
        out.push_back({"root", (double)root_.load()});
        out.push_back({"mask", (double)mask_.load()});
    }

    void process(const ProcessContext& c) override {
        dsp_.setBank(handoff_.get());
        patch::RollParams p;
        p.speed = (int)setting(Speed);
        p.clockStep = (int)setting(ClockStep);
        p.root = (int)setting(Root);
        p.scale = (int)setting(Scale);
        int mask = -1, root = p.root;
        if (const int bus = (int)setting(Harmony); bus > 0 && c.harmony != nullptr) {
            const dsp::HarmonyState& h = c.harmony[bus - 1];
            if (h.valid) {
                p.root = root = h.key;
                p.scaleMask = mask = h.scale;
            }
        }
        if (mask < 0) mask = dsp::scales()[(size_t)std::clamp(p.scale, 0, (int)dsp::scales().size() - 1)].mask;
        p.octave = (int)setting(Octave);
        p.snap = (int)setting(Quantize) == 1;
        p.change = (int)setting(Change);
        p.seed = (uint32_t)setting(Seed);
        const Transport& tr = *c.transport;
        patch::RollTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        patch::RollInputs in;
        in.clockPatched = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        in.patternPatched = c.inputConnected[Pattern];
        NoteBuffer& notes = *c.notesOut[Notes];
        notes.clear();
        patch::RollOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            p.morph = value(c, Morph, i);
            p.humanise = value(c, Humanise, i);
            p.lengthScale = value(c, Length, i);
            p.swing = value(c, Swing, i);
            p.slot = (int)std::lround(value(c, Slot, i)) - 1;
            p.morphTo = (int)std::lround(value(c, MorphTo, i)) - 1;
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            in.clock = c.inputs[Clock][i];
            in.reset = c.inputs[Reset][i];
            in.transpose = c.inputs[Transpose][i];
            in.pattern = c.inputs[Pattern][i];
            dsp_.tick(p, in, t, o, dsp::noteEmitter(notes, i));
            c.outputs[LowPitch][i] = o.lowPitch;
            c.outputs[LowGate][i] = o.lowGate;
            c.outputs[HighPitch][i] = o.highPitch;
            c.outputs[HighGate][i] = o.highGate;
            c.outputs[LastPitch][i] = o.lastPitch;
            c.outputs[LastGate][i] = o.lastGate;
            c.outputs[VelocityOut][i] = o.velocity;
            c.outputs[Trigger][i] = o.trigger;
            c.outputs[Loop][i] = o.loop;
            c.outputs[Position][i] = o.position;
        }
        pos_.store(dsp_.position());
        slot_.store(dsp_.playingSlot());
        prev_.store(dsp_.previousSlot());
        voices_.store(dsp_.sounding());
        root_.store(root);
        mask_.store(mask);
    }

private:
    RollDsp dsp_;
    std::string data_;  // message thread
    RtHandoff<RollBank> handoff_;
    std::atomic<int> pos_{0}, slot_{0}, prev_{0}, voices_{0}, root_{0}, mask_{0xfff};
};

}  // namespace

static void registerRollModule(Registry& r) {
    ModuleSpec s;
    s.type = "roll";
    s.name = "Roll";
    s.category = "Sequencing/Melodic";
    s.colour = "#7cc4a4";
    s.description = "Free-length notes drawn on a pitch grid, up to 8 bars, overlapping and polyphonic, with eight pattern slots, a ghost of the last slot and a Morph between two.";
    std::vector<std::string> roots, scales, speeds, steps;
    for (const char* n : {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}) roots.emplace_back(n);
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    for (const char* n : RollDsp::speedNames()) speeds.emplace_back(n);
    for (const char* n : RollDsp::clockStepNames()) steps.emplace_back(n);
    s.params = {ParamSpec::percent("morph", "Morph", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("humanise", "Humanise", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("length", "Length", 0.1f, 2.0f, 1.0f),
                ParamSpec::percent("swing", "Swing", 0.5f, 0.75f, 0.5f),
                ParamSpec::steppedInt("slot", "Slot", 1, patch::kRollSlots, 1),
                ParamSpec::steppedInt("morphto", "Morph To", 1, patch::kRollSlots, 2),
                ParamSpec::choice("speed", "Speed", speeds, 2),
                ParamSpec::choice("clockstep", "Clock Step", steps, 1),
                ParamSpec::choice("root", "Root", roots, 0),
                ParamSpec::choice("scale", "Scale", scales, 2),
                ParamSpec::integer("octave", "Octave", -3, 3, 0),
                ParamSpec::choice("quantize", "Quantize", {"Off", "To scale"}, 0),
                ParamSpec::choice("harmony", "Harmony", {"Off", "Bus A", "Bus B", "Bus C", "Bus D"}, 0),
                ParamSpec::choice("change", "Slot Change", {"Immediate", "Next bar", "Loop end"}, 1),
                ParamSpec::integer("seed", "Seed", 0, 999, 1),
                ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto)};
    s.harmony = HarmonyRole::Reader;  // follows a Harmony Master when Harmony is set
    s.inputs = {{"clock", "Clock", Signal::Trigger},
                {"reset", "Reset", Signal::Trigger},
                {"transpose", "Transpose", Signal::Pitch},
                {"pattern", "Pattern", Signal::Control}};
    s.outputs = {{"notes", "Notes", Signal::Notes, false},
                 {"lowpitch", "Low Pitch", Signal::Pitch, true},
                 {"lowgate", "Low Gate", Signal::Gate, false},
                 {"highpitch", "High Pitch", Signal::Pitch, true},
                 {"highgate", "High Gate", Signal::Gate, false},
                 {"lastpitch", "Last Pitch", Signal::Pitch, true},
                 {"lastgate", "Last Gate", Signal::Gate, false},
                 {"velocity", "Velocity", Signal::Control, false},
                 {"trigger", "Trigger", Signal::Trigger, false},
                 {"loop", "Loop", Signal::Trigger, false},
                 {"position", "Position", Signal::Control, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<RollModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerRollModule);

}  // namespace bleep::engine
