// SPDX-License-Identifier: MIT
// Quantizer Suite node (doc/specs/modules/quantizer-suite.md): four quantizer
// channels (Quantize, Transpose, Arp, Follow) with normalled inputs, a note
// mask per channel in the node's data, and a merged Notes output.
#include "QuantizerSuiteDsp.h"
#include "dsp/SeqNotes.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::kQsChannels;
using patch::QuantizerSuiteDsp;

/// The four masks from the node's data (4095 = every note).
std::array<uint16_t, kQsChannels> parseMasks(const juce::var& data) {
    std::array<uint16_t, kQsChannels> m{0xfff, 0xfff, 0xfff, 0xfff};
    const auto* a = data.isObject() ? data["masks"].getArray() : nullptr;
    if (!a) return m;
    for (int i = 0; i < kQsChannels && i < a->size(); ++i) {
        const juce::var v = (*a)[i];
        if (v.isInt() || v.isInt64() || v.isDouble()) m[(size_t)i] = (uint16_t)((int64_t)(double)v & 0xfff);
    }
    return m;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const auto m = parseMasks(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> masks;
    for (uint16_t v : m) masks.add((int)v);
    out->setProperty("masks", masks);
    return juce::JSON::toString(result, true).toStdString();
}

constexpr const char* kLetters[kQsChannels] = {"a", "b", "c", "d"};
constexpr const char* kNames[kQsChannels] = {"A", "B", "C", "D"};

class QuantizerSuiteModule final : public Module {
public:
    // Per channel (base k · kPerChannel): knobs, then settings.
    enum { Steps, Slew, Mode, Root, Scale, Harmony, Sample, Octave, Chord, Order, Span, Target, NotesOn, kPerChannel };
    static constexpr int kShared = kQsChannels * kPerChannel;
    enum { Hysteresis = kShared, Link, Velocity, Seed };
    // Inputs: In A–D, Trig A–D, Reset.
    enum { InA = 0, TrigA = 4, Reset = 8 };
    // Outputs: Out A–D, Change A–D, Notes.
    enum { OutA = 0, ChangeA = 4, Notes = 8 };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        const auto m = parseMasks(juce::JSON::parse(juce::String(json)));
        for (int i = 0; i < kQsChannels; ++i) masks_[(size_t)i].store(m[(size_t)i]);
    }

    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> notes, arp, scale, chord, noHarmony, key;
        for (int k = 0; k < kQsChannels; ++k) {
            notes.push_back((float)notes_[(size_t)k].load());
            arp.push_back((float)arp_[(size_t)k].load());
            scale.push_back((float)scale_[(size_t)k].load());
            chord.push_back((float)chord_[(size_t)k].load());
            noHarmony.push_back(noHarmony_[(size_t)k].load() ? 1.0f : 0.0f);
            key.push_back((float)key_[(size_t)k].load());
        }
        out.push_back({"notes", std::move(notes)});
        out.push_back({"arp", std::move(arp)});
        out.push_back({"scale", std::move(scale)});
        out.push_back({"chord", std::move(chord)});
        out.push_back({"noHarmony", std::move(noHarmony)});
        out.push_back({"key", std::move(key)});
    }

    void process(const ProcessContext& c) override {
        patch::QsParams p;
        const bool link = setting(Link) >= 0.5f;
        p.seed = (uint32_t)setting(Seed);
        patch::QsInput in;
        for (int k = 0; k < kQsChannels; ++k) {
            const int b = k * kPerChannel, src = link ? 0 : b;  // Link: B–D use A's Root, Scale, Harmony
            auto& cp = p.ch[k];
            cp.mode = (int)setting(b + Mode);
            cp.root = (int)setting(src + Root);
            cp.scale = (int)setting(src + Scale);
            cp.sample = (int)setting(b + Sample);
            cp.octave = (int)setting(b + Octave);
            cp.chord = (int)setting(b + Chord);
            cp.order = (int)setting(b + Order);
            cp.span = (int)setting(b + Span);
            cp.target = (int)setting(b + Target);
            cp.notes = setting(b + NotesOn) >= 0.5f;
            cp.mask = masks_[(size_t)k].load();
            const int bus = (int)setting(src + Harmony) - 1;
            const bool valid = bus >= 0 && bus < dsp::kHarmonyBuses && c.harmony && c.harmony[bus].valid;
            cp.harmony = valid ? &c.harmony[bus] : nullptr;
            noHarmony_[(size_t)k].store(!valid && (cp.mode == patch::QsFollow || bus >= 0));
            in.trigFed[k] = c.inputConnected[TrigA + k] || (k > 0 && in.trigFed[k - 1]);
            const uint16_t sc = cp.harmony ? cp.harmony->scale : dsp::scales()[(size_t)std::clamp(cp.scale, 0, 16)].mask;
            const int key = cp.harmony ? cp.harmony->key : cp.root;
            scale_[(size_t)k].store(dsp::rotateMask(sc, key));
            key_[(size_t)k].store(key);
            chord_[(size_t)k].store(cp.harmony ? dsp::absoluteChord(*cp.harmony) : 0);
        }
        const Transport& tr = *c.transport;
        in.running = tr.playing && tr.ppqValid;
        NoteBuffer& notes = *c.notesOut[Notes];
        notes.clear();
        patch::QsOutputs o;
        // Hysteresis, Velocity and Slew once per chunk; Steps per sample.
        p.hysteresis = value(c, Hysteresis, 0);
        p.velocity = value(c, Velocity, 0);
        for (int k = 0; k < kQsChannels; ++k) p.ch[k].slew = value(c, k * kPerChannel + Slew, 0);
        for (int i = 0; i < c.numSamples; ++i) {
            for (int k = 0; k < kQsChannels; ++k) {
                const int b = k * kPerChannel;
                p.ch[k].steps = (int)value(c, b + Steps, i);
                in.in[k] = c.inputs[InA + k][i];
                in.trig[k] = c.inputs[TrigA + k][i];
            }
            in.reset = c.inputs[Reset][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, o, kMaxNotesPerChunk - notes.count, [&](int ch, bool on, int note, float pitch, float vel) {
                dsp::noteEmitter(notes, i, ch)(on, note, pitch, vel);
            });
            for (int k = 0; k < kQsChannels; ++k) {
                c.outputs[OutA + k][i] = o.out[k];
                c.outputs[ChangeA + k][i] = o.change[k];
            }
        }
        for (int k = 0; k < kQsChannels; ++k) {
            notes_[(size_t)k].store(dsp_.note(k));
            arp_[(size_t)k].store(dsp_.arpIndex(k));
        }
    }

private:
    QuantizerSuiteDsp dsp_;
    std::array<std::atomic<uint16_t>, kQsChannels> masks_{0xfff, 0xfff, 0xfff, 0xfff};
    std::array<std::atomic<int>, kQsChannels> notes_{}, arp_{}, scale_{}, chord_{}, key_{};
    std::array<std::atomic<bool>, kQsChannels> noHarmony_{};
};

}  // namespace

static void registerQuantizerSuiteModule(Registry& r) {
    ModuleSpec s;
    s.type = "quantizer-suite";
    s.name = "Quantizer Suite";
    s.category = "Utility";
    s.colour = "#7cb7f5";
    s.description = "Four quantizers: scale with a note mask, transpose in the scale, arpeggiate, or follow a Harmony Master. "
                    "Unpatched inputs take the previous channel's.";
    std::vector<std::string> roots, scales, chords;
    for (int k = 0; k < 12; ++k) roots.emplace_back(dsp::pitchClassName(k));
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    for (int i = 0; i < 7; ++i) chords.emplace_back(patch::qsArpChord(i).name);
    for (int k = 0; k < kQsChannels; ++k) {
        const std::string id = kLetters[k], n = kNames[k], m = id + ".mode";
        const std::string group = "Channel " + n;
        const bool linked = k > 0;
        auto root = ParamSpec::choice(id + ".root", "Root " + n, roots, 0);
        auto scale = ParamSpec::choice(id + ".scale", "Scale " + n, scales, 1);
        auto harmony = ParamSpec::choice(id + ".harmony", "Harmony " + n, {"Off", "Bus A", "Bus B", "Bus C", "Bus D"}, 0);
        if (linked) {
            root = root.when("link", 0, 0);
            scale = scale.when("link", 0, 0);
            harmony = harmony.when("link", 0, 0);
        }
        s.params.push_back(ParamSpec::steppedInt(id + ".steps", "Steps " + n, -14, 14, 2 * k).inGroup(group).when(m, 1, 3));
        s.params.push_back(ParamSpec::seconds(id + ".slew", "Slew " + n, 0.0f, 2.0f, 0.2f, 0.0f).inGroup(group));
        s.params.push_back(ParamSpec::choice(m, "Mode " + n, {"Quantize", "Transpose", "Arp", "Follow"}, k == 0 ? 0 : 1));
        s.params.push_back(root);
        s.params.push_back(scale);
        s.params.push_back(harmony);
        s.params.push_back(ParamSpec::choice(id + ".sample", "Sample " + n, {"Continuous", "Trigger", "Track & Hold"}, 0));
        s.params.push_back(ParamSpec::integer(id + ".octave", "Octave " + n, -3, 3, 0));
        s.params.push_back(ParamSpec::choice(id + ".chord", "Chord " + n, chords, 0).when(m, 2, 2));
        s.params.push_back(
            ParamSpec::choice(id + ".order", "Order " + n, {"Up", "Down", "Up-Down", "Converge", "Random"}, 0).when(m, 2, 2));
        s.params.push_back(ParamSpec::integer(id + ".span", "Span " + n, 1, 4, 1).when(m, 2, 2));
        s.params.push_back(
            ParamSpec::choice(id + ".target", "Target " + n, {"Scale", "Chord", "Chord + Scale", "Root"}, 1).when(m, 3, 3));
        s.params.push_back(ParamSpec::toggle(id + ".notes", "Notes " + n, true));
    }
    s.params.push_back(ParamSpec::percent("hysteresis", "Hysteresis", 0.0f, 0.5f, 0.1f));
    s.params.push_back(ParamSpec::toggle("link", "Link", true));
    s.params.push_back(ParamSpec::percent("velocity", "Velocity", 0.01f, 1.0f, 0.8f));
    s.params.push_back(ParamSpec::integer("seed", "Seed", 0, 999, 0));
    for (int k = 0; k < kQsChannels; ++k) {
        JackSpec j{std::string("in") + kLetters[k], std::string("In ") + kNames[k], Signal::Pitch};
        if (k > 0) j = j.normalledTo(std::string("in") + kLetters[k - 1]);
        s.inputs.push_back(j);
    }
    for (int k = 0; k < kQsChannels; ++k) {
        JackSpec j{std::string("trig") + kLetters[k], std::string("Trig ") + kNames[k], Signal::Trigger};
        if (k > 0) j = j.normalledTo(std::string("trig") + kLetters[k - 1]);
        s.inputs.push_back(j);
    }
    s.inputs.push_back({"reset", "Reset", Signal::Trigger});
    for (int k = 0; k < kQsChannels; ++k)
        s.outputs.push_back({std::string("out") + kLetters[k], std::string("Out ") + kNames[k], Signal::Pitch, true});
    for (int k = 0; k < kQsChannels; ++k)
        s.outputs.push_back({std::string("change") + kLetters[k], std::string("Change ") + kNames[k], Signal::Trigger, false});
    s.outputs.push_back({"notes", "Notes", Signal::Notes, false});
    s.harmony = HarmonyRole::Reader;
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<QuantizerSuiteModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerQuantizerSuiteModule);

}  // namespace bleep::engine
