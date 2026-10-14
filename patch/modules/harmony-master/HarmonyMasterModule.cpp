// SPDX-License-Identifier: MIT
// Harmony Master node (doc/specs/modules/harmony-master.md): the board's key,
// scale and chord from the knobs, a progression or played chords, published
// on a harmony bus for the followers, and played as pitches and notes.
#include "HarmonyMasterDsp.h"
#include "Handoff.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <atomic>

namespace bleep::engine {
namespace {

using patch::HarmonyMasterDsp;
using patch::HmProgression;
using patch::HmSlot;

/// "diatonic-triad", "diatonic-seventh" or a chord-table id → quality setting value.
int qualityFromId(const juce::String& id) {
    if (id == "diatonic-triad") return patch::kHmDiatonicTriad;
    if (id == "diatonic-seventh") return patch::kHmDiatonicSeventh;
    return dsp::chordQualityIndex(id.toRawUTF8());
}
juce::String qualityId(int q) {
    if (q == patch::kHmDiatonicTriad) return "diatonic-triad";
    if (q == patch::kHmDiatonicSeventh) return "diatonic-seventh";
    return dsp::chordQuality(q).id;
}

bool isNumber(const juce::var& v) { return v.isInt() || v.isInt64() || v.isDouble(); }

/// The node's data, parsed and clamped. `fresh`: nothing saved yet.
HmProgression parseSlots(const juce::var& data, bool& fresh) {
    const auto* slots = data.isObject() ? data["slots"].getArray() : nullptr;
    fresh = slots == nullptr;
    if (fresh) return HmProgression::defaults();
    HmProgression p;
    for (const auto& v : *slots) {
        if (p.count >= patch::kHmMaxSlots) break;
        if (!v.isObject()) continue;
        HmSlot s;
        if (isNumber(v["deg"])) {
            s.degree = juce::jlimit(1, 7, (int)std::lround((double)v["deg"]));
        } else if (isNumber(v["root"])) {
            s.degree = 0;
            s.root = ((int)std::lround((double)v["root"]) % 12 + 12) % 12;
        } else {
            continue;  // neither degree nor root: dropped
        }
        const int q = qualityFromId(v["q"].toString());
        s.quality = q == -1 ? patch::kHmDiatonicTriad : q;
        if (isNumber(v["bass"])) s.bass = ((int)std::lround((double)v["bass"]) % 12 + 12) % 12;
        s.beats = patch::hmSnapLength(isNumber(v["len"]) ? (double)v["len"] : 4.0);
        p.slots[p.count++] = s;
    }
    return p;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    bool fresh = false;
    const HmProgression p = parseSlots(in, fresh);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> slots;
    for (int i = 0; i < p.count; ++i) {
        const HmSlot& s = p.slots[i];
        auto* o = new juce::DynamicObject();
        if (s.degree > 0) o->setProperty("deg", s.degree);
        else o->setProperty("root", s.root);
        o->setProperty("q", qualityId(s.quality));
        if (s.bass >= 0) o->setProperty("bass", s.bass);
        o->setProperty("len", s.beats);
        slots.add(juce::var(o));
    }
    out->setProperty("slots", slots);
    return juce::JSON::toString(result, true).toStdString();
}

class HarmonyMasterModule final : public Module {
public:
    enum { Degree, Slot, Velocity, Source, Key, Scale, Quality, Advance, Policy, Latch, Octave, Bus };
    enum { NotesIn, Next, Reset, Transpose };
    enum { KeyOut, Root, Bass, Tone1, Tone2, Tone3, Tone4, NotesOut, Change, DegreeOut };

    explicit HarmonyMasterModule(const ModuleSpec& spec) : Module(spec) {
        progression_.publish(std::make_shared<const HmProgression>(HmProgression::defaults()));
        serialBase_ = (uint32_t)(reinterpret_cast<uintptr_t>(this) >> 4) * 2654435761u;
    }

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        bool fresh = false;
        progression_.publish(std::make_shared<const HmProgression>(parseSlots(juce::JSON::parse(juce::String(json)), fresh)));
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"key", (double)key_.load()});
        out.push_back({"root", (double)root_.load()});
        out.push_back({"bass", (double)bass_.load()});
        out.push_back({"quality", (double)quality_.load()});
        out.push_back({"scale", (double)scale_.load()});
        out.push_back({"chord", (double)chord_.load()});
        out.push_back({"degree", (double)degree_.load()});
        out.push_back({"slot", (double)slot_.load()});
        out.push_back({"conflict", conflict_.load() ? 1.0 : 0.0});
        out.push_back({"held", (double)held_.load()});
    }

    void process(const ProcessContext& c) override {
        dsp_.setProgression(progression_.get());
        patch::HmParams p;
        p.source = (int)setting(Source);
        p.key = (int)setting(Key);
        p.scale = (int)setting(Scale);
        const int q = (int)setting(Quality);
        p.quality = q == 0 ? patch::kHmDiatonicTriad : q == 1 ? patch::kHmDiatonicSeventh : q - 2;
        p.advance = (int)setting(Advance);
        p.adapt = setting(Policy) >= 0.5f;
        p.latch = setting(Latch) >= 0.5f;
        p.octave = (int)setting(Octave);
        const int bus = std::clamp((int)setting(Bus), 0, dsp::kHarmonyBuses - 1);

        const Transport& tr = *c.transport;
        patch::HmInput in;
        in.running = tr.playing && tr.ppqValid;
        NoteBuffer& notes = *c.notesOut[NotesOut];
        notes.clear();
        const NoteBuffer* held = c.notesIn[NotesIn];
        int nextEvent = 0;
        patch::HmOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            if (held)
                for (; nextEvent < held->count && held->events[nextEvent].offset <= i; ++nextEvent) {
                    const NoteEvent& e = held->events[nextEvent];
                    if (e.type == NoteEvent::On && e.value > 0.0f) dsp_.noteOn(e.note);
                    else if (e.type == NoteEvent::On || e.type == NoteEvent::Off) dsp_.noteOff(e.note);
                }
            p.degree = (int)value(c, Degree, i);
            p.slot = (int)value(c, Slot, i);
            p.velocity = value(c, Velocity, i);
            in.next = c.inputs[Next][i];
            in.reset = c.inputs[Reset][i];
            in.transpose = c.inputs[Transpose][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, o, kMaxNotesPerChunk - notes.count, dsp::noteEmitter(notes, i));
            c.outputs[KeyOut][i] = o.key;
            c.outputs[Root][i] = o.root;
            c.outputs[Bass][i] = o.bass;
            for (int k = 0; k < 4; ++k) c.outputs[Tone1 + k][i] = o.tone[k];
            c.outputs[Change][i] = o.change;
            c.outputs[DegreeOut][i] = o.degree;
        }
        publish(c, bus);

        const dsp::HarmonyState& h = dsp_.context();
        key_.store(h.key);
        root_.store(h.chordRoot);
        bass_.store(h.bass);
        quality_.store(h.quality);
        scale_.store(h.scale);
        chord_.store(h.chord);
        degree_.store(h.degree);
        slot_.store(dsp_.slot());
        held_.store(dsp_.heldCount());
    }

private:
    /// Writes the context (as at the chunk end) to the bus, unless another
    /// Harmony Master that runs earlier owns it: then this one publishes
    /// nothing and reports the conflict.
    void publish(const ProcessContext& c, int bus) {
        if (!c.harmony) return;
        if (bus != bus_ && bus_ >= 0 && owned_) c.harmony[bus_].valid = false;  // leave the old bus empty
        if (bus != bus_) owned_ = false;
        bus_ = bus;
        dsp::HarmonyState& b = c.harmony[bus];
        const bool mine = !b.valid || (owned_ && b.serial == written_.serial && dsp::sameHarmony(b, written_));
        conflict_.store(!mine);
        owned_ = mine;
        if (!mine) return;
        written_ = dsp_.context();
        written_.valid = true;
        written_.serial = serialBase_ + dsp_.context().serial;
        b = written_;
    }

    HarmonyMasterDsp dsp_;
    RtHandoff<HmProgression> progression_;
    std::string data_;  // message thread
    int bus_ = -1;
    bool owned_ = false;
    dsp::HarmonyState written_;
    uint32_t serialBase_ = 0;
    std::atomic<int> key_{0}, root_{0}, bass_{0}, quality_{dsp::ChordMajor}, scale_{0xab5}, chord_{0x91}, degree_{1},
        slot_{0}, held_{0};
    std::atomic<bool> conflict_{false};
};

}  // namespace

static void registerHarmonyMasterModule(Registry& r) {
    ModuleSpec s;
    s.type = "harmony-master";
    s.name = "Harmony Master";
    s.category = "Utility/Harmony";
    s.colour = "#9333ea";
    s.description = "The board's key, scale and chord, from the knobs, a progression or played chords. Followers quantize to it.";
    std::vector<std::string> roots, scales, qualities{"Diatonic Triad", "Diatonic Seventh"}, groups{"Diatonic", "Diatonic"};
    for (int k = 0; k < 12; ++k) roots.emplace_back(dsp::pitchClassName(k));
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    for (const auto& q : dsp::chordQualities()) {
        qualities.emplace_back(q.label);
        groups.emplace_back("Chord");
    }
    auto quality = ParamSpec::choice("quality", "Quality", qualities, 0);
    quality.choiceGroups = groups;
    s.params = {ParamSpec::steppedInt("degree", "Degree", 1, 7, 1),
                ParamSpec::steppedInt("slot", "Slot", 1, patch::kHmMaxSlots, 1).when("advance", 2, 2),
                ParamSpec::percent("velocity", "Velocity", 0.01f, 1.0f, 0.7f),
                ParamSpec::choice("source", "Source", {"Manual", "Progression", "Detect"}, 0),
                ParamSpec::choice("key", "Key", roots, 0),
                ParamSpec::choice("scale", "Scale", scales, 1),
                quality,
                ParamSpec::choice("advance", "Advance", {"Transport", "Trigger", "Select"}, 0).when("source", 1, 1),
                ParamSpec::choice("policy", "Scale Policy", {"Keep", "Adapt"}, 0),
                ParamSpec::toggle("latch", "Latch", true).when("source", 2, 2),
                ParamSpec::integer("octave", "Octave", -3, 3, 0),
                ParamSpec::choice("bus", "Bus", {"A", "B", "C", "D"}, 0)};
    s.inputs = {{"notes", "Notes", Signal::Notes},
                {"next", "Next", Signal::Trigger},
                {"reset", "Reset", Signal::Trigger},
                {"transpose", "Transpose", Signal::Pitch}};
    s.outputs = {{"key", "Key", Signal::Pitch, true},          {"root", "Root", Signal::Pitch, true},
                 {"bass", "Bass", Signal::Pitch, true},        {"tone1", "Tone 1", Signal::Pitch, true},
                 {"tone2", "Tone 2", Signal::Pitch, true},     {"tone3", "Tone 3", Signal::Pitch, true},
                 {"tone4", "Tone 4", Signal::Pitch, true},     {"notes", "Notes", Signal::Notes, false},
                 {"change", "Change", Signal::Trigger, false}, {"degree", "Degree", Signal::Control, false}};
    s.harmony = HarmonyRole::Writer;
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<HarmonyMasterModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerHarmonyMasterModule);

}  // namespace bleep::engine
