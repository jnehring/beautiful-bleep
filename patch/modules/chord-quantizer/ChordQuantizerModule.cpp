// SPDX-License-Identifier: MIT
// Chord Quantizer node (specs/modules/chord-quantizer.md): a pitch picks a
// chord root, the chord is voiced, voice-led and strummed onto four pitch
// outputs and a note set; Follow takes the chord from a Harmony Master.
#include "ChordQuantizerDsp.h"
#include "Registry.h"

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::ChordQuantizerDsp;

class ChordQuantizerModule final : public Module {
public:
    enum { Chord, Stack, Inversion, Strum, Velocity, Mode, Root, Scale, Harmony, Voices, Voicing, Lead, Anchor, Range,
           StrumOrder, Hysteresis };
    enum { Pitch, Trig, Gate };
    enum { Voice1, Voice2, Voice3, Voice4, RootOut, Notes, Change };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"root", (double)root_.load()});
        out.push_back({"quality", (double)quality_.load()});
        out.push_back({"noHarmony", noHarmony_.load() ? 1.0 : 0.0});
        out.push_back({"busRoot", (double)busRoot_.load()});
        out.push_back({"busQuality", (double)busQuality_.load()});
        out.push_back({"key", (double)key_.load()});
        out.push_back({"scale", (double)scale_.load()});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> v, p;
        for (int i = 0; i < count_.load(); ++i) v.push_back((float)voices_[(size_t)i].load());
        for (int i = 0; i < prevCount_.load(); ++i) p.push_back((float)prev_[(size_t)i].load());
        out.push_back({"voices", std::move(v)});
        out.push_back({"prev", std::move(p)});
    }

    void process(const ProcessContext& c) override {
        patch::CqParams p;
        p.mode = (int)setting(Mode);
        p.root = (int)setting(Root);
        p.scale = (int)setting(Scale);
        p.voices = (int)setting(Voices);
        p.voicing = (int)setting(Voicing);
        p.lead = (int)setting(Lead);
        p.anchor = (int)setting(Anchor);
        p.range = (int)setting(Range);
        p.strumDown = setting(StrumOrder) >= 0.5f;
        p.hysteresis = setting(Hysteresis);
        const int bus = (int)setting(Harmony) - 1;
        const dsp::HarmonyState* h =
            bus >= 0 && bus < dsp::kHarmonyBuses && c.harmony && c.harmony[bus].valid ? &c.harmony[bus] : nullptr;
        // Chromatic ignores the bus; Diatonic takes key and scale from it; Follow the chord.
        patch::CqInput in;
        in.harmony = p.mode == patch::CqChromatic ? nullptr : h;
        in.trigPatched = c.inputConnected[Trig];
        in.gatePatched = c.inputConnected[Gate];
        NoteBuffer& notes = *c.notesOut[Notes];
        notes.clear();
        patch::CqOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            p.chord = (int)value(c, Chord, i);
            p.stack = (int)value(c, Stack, i);
            p.inversion = (int)value(c, Inversion, i);
            p.strum = value(c, Strum, i);
            p.velocity = value(c, Velocity, i);
            in.pitch = c.inputs[Pitch][i];
            in.trig = c.inputs[Trig][i];
            in.gate = c.inputs[Gate][i];
            dsp_.tick(p, in, o, kMaxNotesPerChunk - notes.count, dsp::noteEmitter(notes, i));
            for (int k = 0; k < 4; ++k) c.outputs[Voice1 + k][i] = o.voice[k];
            c.outputs[RootOut][i] = o.root;
            c.outputs[Change][i] = o.change;
        }
        const auto& d = dsp_.chord();
        root_.store(dsp::pitchClass(d.root));
        quality_.store(dsp::findChordQuality(d.mask()));
        noHarmony_.store(!h && (p.mode == patch::CqFollow || (p.mode == patch::CqDiatonic && bus >= 0)));
        busRoot_.store(h ? h->chordRoot : -1);
        busQuality_.store(h ? h->quality : -1);
        key_.store(h ? h->key : p.root);
        scale_.store(h ? h->scale : dsp::scales()[(size_t)std::clamp(p.scale, 0, 16)].mask);
        const int n = std::min(dsp_.count(), 4), m = std::min(dsp_.previousCount(), 4);
        for (int i = 0; i < n; ++i) voices_[(size_t)i].store(dsp_.voices()[i]);
        for (int i = 0; i < m; ++i) prev_[(size_t)i].store(dsp_.previous()[i]);
        count_.store(n);
        prevCount_.store(m);
    }

private:
    ChordQuantizerDsp dsp_;
    std::atomic<int> root_{0}, quality_{dsp::ChordMajor}, busRoot_{-1}, busQuality_{-1}, key_{0}, scale_{0xab5};
    std::atomic<bool> noHarmony_{false};
    std::array<std::atomic<int>, 4> voices_{}, prev_{};
    std::atomic<int> count_{0}, prevCount_{0};
};

}  // namespace

static void registerChordQuantizerModule(Registry& r) {
    ModuleSpec s;
    s.type = "chord-quantizer";
    s.name = "Chord Quantizer";
    s.category = "Utility";
    s.colour = "#9f8cf7";
    s.description = "One pitch in, a voiced chord out: four pitches and notes. Voice Leading picks the inversion that moves least.";
    std::vector<std::string> chords, stacks, roots, scales;
    for (int i = 0; i < dsp::kNumChordOscQualities; ++i) chords.emplace_back(dsp::chordQualities()[(size_t)i].label);
    for (const auto& st : dsp::scaleStacks()) stacks.emplace_back(st.name);
    for (int k = 0; k < 12; ++k) roots.emplace_back(dsp::pitchClassName(k));
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    auto hysteresis = ParamSpec::percent("hysteresis", "Hysteresis", 0.0f, 0.5f, 0.1f);
    hysteresis.modulatable = false;
    s.params = {ParamSpec::stepped("chord", "Chord", chords, dsp::ChordMajor).when("mode", 0, 0),
                ParamSpec::stepped("stack", "Chord", stacks, dsp::StackTriad).when("mode", 1, 1),
                ParamSpec::steppedInt("inversion", "Inversion", -3, 3, 0),
                ParamSpec::seconds("strum", "Strum", 0.0f, 0.1f, 0.03f, 0.0f),
                ParamSpec::percent("velocity", "Velocity", 0.01f, 1.0f, 0.8f),
                ParamSpec::choice("mode", "Mode", {"Chromatic", "Diatonic", "Follow"}, 0),
                ParamSpec::choice("root", "Root", roots, 0).when("mode", 1, 2),
                ParamSpec::choice("scale", "Scale", scales, 1).when("mode", 1, 2),
                ParamSpec::choice("harmony", "Harmony", {"Off", "Bus A", "Bus B", "Bus C", "Bus D"}, 0).when("mode", 1, 2),
                ParamSpec::integer("voices", "Voices", 1, 4, 4),
                ParamSpec::choice("voicing", "Voicing", {"Close", "Drop 2", "Drop 3", "Spread", "Open"}, 0),
                ParamSpec::choice("lead", "Voice Leading", {"Off", "Smooth", "Smooth + Top"}, 0),
                ParamSpec::choice("anchor", "Anchor", {"Bass", "Centre", "Top"}, 0),
                ParamSpec::integer("range", "Range", 1, 4, 2),
                ParamSpec::choice("strumorder", "Strum Order", {"Up", "Down"}, 0),
                hysteresis};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch}, {"trig", "Trig", Signal::Trigger}, {"gate", "Gate", Signal::Gate}};
    s.outputs = {{"voice1", "Voice 1", Signal::Pitch, true}, {"voice2", "Voice 2", Signal::Pitch, true},
                 {"voice3", "Voice 3", Signal::Pitch, true}, {"voice4", "Voice 4", Signal::Pitch, true},
                 {"root", "Root", Signal::Pitch, true},     {"notes", "Notes", Signal::Notes, false},
                 {"change", "Change", Signal::Trigger, false}};
    s.harmony = HarmonyRole::Reader;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ChordQuantizerModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerChordQuantizerModule);

}  // namespace bleep::engine
