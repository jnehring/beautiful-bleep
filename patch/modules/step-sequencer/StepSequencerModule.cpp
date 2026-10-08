// SPDX-License-Identifier: MIT
// Step Sequencer node (specs/modules/step-sequencer.md): steps from the
// node's data, timing from the transport or a clock, notes and CV out.
#include "StepSequencerDsp.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <atomic>

namespace bleep::engine {
namespace {

using patch::SeqPattern;
using patch::StepSequencerDsp;

/// The node's data, parsed and clamped. `fresh`: no steps saved yet.
SeqPattern parseSteps(const juce::var& data, bool& fresh) {
    SeqPattern p{};
    const auto* steps = data["steps"].getArray();
    fresh = steps == nullptr;
    if (fresh) return p;  // a new module: all On, pitch 0, velocity 100
    for (int i = 0; i < patch::kSeqSteps; ++i) {
        auto& s = p[(size_t)i];
        if (i >= steps->size()) {
            s.gate = patch::SeqOff;
            continue;
        }
        const juce::var st = (*steps)[i];
        s.gate = (uint8_t)juce::jlimit(0, 2, (int)st.getProperty("g", 0));
        s.pitch = (int8_t)juce::jlimit(patch::kSeqMinPitch, patch::kSeqMaxPitch, (int)st.getProperty("p", 0));
        s.velocity = (uint8_t)juce::jlimit(1, 127, (int)st.getProperty("v", 100));
    }
    return p;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    bool fresh = false;
    const SeqPattern p = parseSteps(in, fresh);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> steps;
    for (const auto& s : p) {
        auto* o = new juce::DynamicObject();
        o->setProperty("g", (int)s.gate);
        o->setProperty("p", (int)s.pitch);
        o->setProperty("v", (int)s.velocity);
        steps.add(juce::var(o));
    }
    out->setProperty("steps", steps);
    // Randomizer options (spec §4.5), kept for the view.
    const juce::var r = in["randomize"];
    auto* ro = new juce::DynamicObject();
    auto number = [&](const char* key, double def, double lo, double hi) {
        const auto v = r.getProperty(key, def);
        return juce::jlimit(lo, hi, v.isDouble() || v.isInt() || v.isInt64() ? (double)v : def);
    };
    ro->setProperty("density", number("density", 0.6, 0.0, 1.0));
    ro->setProperty("octaves", (int)number("octaves", 1, 1, 3));
    double lo = 0.6, hi = 1.0;
    if (const auto* a = r["velocity"].getArray(); a && a->size() == 2) {
        lo = juce::jlimit(0.01, 1.0, (double)(*a)[0]);
        hi = juce::jlimit(0.01, 1.0, (double)(*a)[1]);
        if (lo > hi) std::swap(lo, hi);
    }
    ro->setProperty("velocity", juce::Array<juce::var>{lo, hi});
    out->setProperty("randomize", juce::var(ro));
    return juce::JSON::toString(result, true).toStdString();
}

class StepSequencerModule final : public Module {
public:
    enum { GateLength, Swing, Variation, VariationRange, Length, Rate, Direction, Root, Scale, Octave, Seed };
    enum { Clock, Reset, Transpose };
    enum { Notes, Pitch, Gate, Velocity, Trigger, End, Step };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        bool fresh = false;
        const SeqPattern p = parseSteps(juce::JSON::parse(juce::String(json)), fresh);
        const juce::SpinLock::ScopedLockType lock(lock_);
        pending_ = p;
        hasPending_ = true;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"step", (double)step_.load()});
        out.push_back({"varied", (double)varied_.load()});
        out.push_back({"sounding", sounding_.load() ? 1.0 : 0.0});
    }

    void process(const ProcessContext& c) override {
        {
            const juce::SpinLock::ScopedTryLockType lock(lock_);
            if (lock.isLocked() && hasPending_) {
                dsp_.setPattern(pending_);
                hasPending_ = false;
            }
        }
        patch::SeqParams p;
        p.length = (int)setting(Length);
        p.rate = (int)setting(Rate);
        p.direction = (int)setting(Direction);
        p.root = (int)setting(Root);
        p.scale = (int)setting(Scale);
        p.octave = (int)setting(Octave);
        p.seed = (uint32_t)setting(Seed);
        const Transport& tr = *c.transport;
        patch::SeqTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        NoteBuffer& notes = *c.notesOut[Notes];
        notes.clear();
        patch::SeqOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            p.gateLength = value(c, GateLength, i);
            p.swing = value(c, Swing, i);
            p.variation = value(c, Variation, i);
            p.variationRange = value(c, VariationRange, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            dsp_.tick(p, c.inputs[Clock][i], c.inputConnected[Clock], c.inputs[Reset][i], c.inputs[Transpose][i], t, o,
                      [&](bool on, int note, float pitch, float velocity) {
                          NoteEvent e;
                          e.type = on ? NoteEvent::On : NoteEvent::Off;
                          e.offset = (int16_t)i;
                          e.note = note;
                          e.pitch = pitch;
                          e.value = velocity;
                          notes.push(e);
                      });
            c.outputs[Pitch][i] = o.pitch;
            c.outputs[Gate][i] = o.gate;
            c.outputs[Velocity][i] = o.velocity;
            c.outputs[Trigger][i] = o.trigger;
            c.outputs[End][i] = o.end;
            c.outputs[Step][i] = o.step;
        }
        step_.store(dsp_.playingStep());
        varied_.store(dsp_.variedSteps());
        sounding_.store(dsp_.sounding());
    }

private:
    StepSequencerDsp dsp_;
    std::string data_;  // message thread
    juce::SpinLock lock_;
    SeqPattern pending_{};
    bool hasPending_ = false;
    std::atomic<int> step_{0};
    std::atomic<uint32_t> varied_{0};
    std::atomic<bool> sounding_{false};
};

}  // namespace

void registerStepSequencerModule(Registry& r) {
    ModuleSpec s;
    s.type = "step-sequencer";
    s.name = "Step Sequencer";
    s.category = "Sequencing";
    s.colour = "#f6c453";
    s.description = "Up to 32 steps of gate, pitch and velocity, quantized to a scale. Notes out plays a Voice Cell.";
    std::vector<std::string> rates, roots, scales;
    for (const char* n : StepSequencerDsp::rateNames()) rates.emplace_back(n);
    for (const char* n : {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}) roots.emplace_back(n);
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    auto range = ParamSpec::number("varrange", "Var. Range", 0.0f, 24.0f, 12.0f, "st", 0);
    s.params = {ParamSpec::percent("gatelength", "Gate Length", 0.01f, 1.0f, 0.5f),
                ParamSpec::percent("swing", "Swing", 0.5f, 0.75f, 0.5f),
                ParamSpec::percent("variation", "Variation", 0.0f, 1.0f, 0.0f),
                range,
                ParamSpec::integer("length", "Length", 1, patch::kSeqSteps, 16),
                ParamSpec::choice("rate", "Rate", rates, 9),
                ParamSpec::choice("direction", "Direction", {"Forward", "Backward", "Ping-Pong", "Random"}, 0),
                ParamSpec::choice("root", "Root", roots, 0),
                ParamSpec::choice("scale", "Scale", scales, 1),
                ParamSpec::integer("octave", "Octave", -3, 3, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"clock", "Clock", Signal::Trigger}, {"reset", "Reset", Signal::Trigger}, {"transpose", "Transpose", Signal::Pitch}};
    s.outputs = {{"notes", "Notes", Signal::Notes, false},       {"pitch", "Pitch", Signal::Pitch, true},
                 {"gate", "Gate", Signal::Gate, false},          {"velocity", "Velocity", Signal::Control, false},
                 {"trigger", "Trigger", Signal::Trigger, false}, {"end", "End", Signal::Trigger, false},
                 {"step", "Step", Signal::Control, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<StepSequencerModule>(spec); });
}

}  // namespace bleep::engine
