// SPDX-License-Identifier: GPL-3.0-or-later
// Note Gate node (doc/specs/modules/note-gate.md): notes in, the notes that
// pass out (remapped, reshaped), and a trigger for each note that passed or
// was stopped. The remap table, the drawn velocity curve and the step lane
// are the node's data.
#include "NoteGateDsp.h"
#include "Handoff.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <atomic>

namespace bleep::engine {
namespace {

using patch::GateTable;

GateTable parseTable(const juce::var& data) {
    GateTable t;
    if (const auto* a = data["remap"].getArray())
        for (int i = 0; i < 12 && i < a->size(); ++i) {
            const juce::var& x = (*a)[i];
            if (x.isDouble() || x.isInt() || x.isInt64()) t.remap[(size_t)i] = (int8_t)juce::jlimit(-1, 11, (int)std::lround((double)x));
        }
    if (const auto* a = data["curve"].getArray(); a && a->size() == patch::kGateCurvePoints)
        for (int i = 0; i < patch::kGateCurvePoints; ++i) {
            const juce::var& x = (*a)[i];
            if (x.isDouble() || x.isInt() || x.isInt64()) t.curve[(size_t)i] = juce::jlimit(0.0f, 1.0f, (float)(double)x);
        }
    if (const auto* a = data["steps"].getArray()) {
        uint16_t m = 0;
        for (int i = 0; i < patch::kGateSteps; ++i) {
            const bool on = i >= a->size() ? true : ((*a)[i].isBool() ? (bool)(*a)[i] : (double)(*a)[i] != 0.0);
            if (on) m = (uint16_t)(m | (1u << i));
        }
        t.steps = m;
    }
    return t;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const GateTable t = parseTable(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> remap, curve, steps;
    for (int i = 0; i < 12; ++i) remap.add((int)t.remap[(size_t)i]);
    for (int i = 0; i < patch::kGateCurvePoints; ++i) curve.add(std::round((double)t.curve[(size_t)i] * 1000.0) / 1000.0);
    for (int i = 0; i < patch::kGateSteps; ++i) steps.add((t.steps >> i) & 1 ? 1 : 0);
    out->setProperty("remap", remap);
    out->setProperty("curve", curve);
    out->setProperty("steps", steps);
    return juce::JSON::toString(result, true).toStdString();
}

class NoteGateModule final : public Module {
public:
    enum { Low, High, RangeMode, Floor, Ceiling, FloorMode, CurveMode, Bend, Remap, GateMode, StepsRule, BarBeats, Every, Offset,
           Density, Window };
    enum { Notes, Gate };
    enum { NotesOut, Passed, Blocked };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.reset();
        pulse_ = std::max(1, (int)(sampleRate * 0.002));
    }
    void reset() override {
        dsp_.reset();
        passLeft_ = blockLeft_ = 0;
        wasConnected_ = false;
        base_ = 0;
    }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        handoff_.publish(std::make_shared<const GateTable>(parseTable(juce::JSON::parse(juce::String(json)))));
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"passed", (double)passed_.load()});
        out.push_back({"blocked", (double)blocked_.load()});
        out.push_back({"why", (double)why_.load()});
        out.push_back({"step", (double)step_.load()});
        out.push_back({"open", open_.load() ? 1.0 : 0.0});
        out.push_back({"lastvel", (double)lastVel_.load()});
    }

    void process(const ProcessContext& c) override {
        const GateTable* tp = handoff_.get();
        static const GateTable kDefault;
        const GateTable& table = tp ? *tp : kDefault;
        patch::GateParams p;
        p.blockInside = setting(RangeMode) >= 0.5f;
        p.liftFloor = setting(FloorMode) >= 0.5f;
        p.drawnCurve = setting(CurveMode) >= 0.5f;
        p.remap = setting(Remap) >= 0.5f;
        p.stepsOn = setting(StepsRule) >= 0.5f;
        p.barBeats = setting(BarBeats);
        p.every = (int)setting(Every);
        p.offset = (int)setting(Offset);
        p.densityMax = (int)setting(Density);
        static constexpr double kWindow[4] = {1.0, 2.0, 4.0, 8.0};
        p.windowBeats = kWindow[std::clamp((int)setting(Window), 0, 3)];
        p.bpm = c.transport->bpm;
        p.sampleRate = sampleRate_;
        p.ppqValid = c.transport->ppqValid;
        const bool gatePatched = c.inputConnected[Gate];
        const bool invert = setting(GateMode) >= 0.5f;

        const bool connected = c.inputConnected[Notes];
        NoteBuffer& out = *c.notesOut[NotesOut];
        out.clear();
        auto emit = [&](int offset) {
            return [&out, offset](bool on, int note, float pitch, float velocity) {
                NoteEvent ev;
                ev.type = on ? NoteEvent::On : NoteEvent::Off;
                ev.offset = (int16_t)offset;
                ev.note = note;
                ev.pitch = pitch;
                ev.value = velocity;
                out.push(ev);
            };
        };
        if (!connected && wasConnected_) dsp_.flush(emit(0));
        wasConnected_ = connected;

        const NoteBuffer* in = connected ? c.notesIn[Notes] : nullptr;
        int e = 0;
        for (int i = 0; i < c.numSamples; ++i) {
            for (; in && e < in->count && in->events[e].offset <= i; ++e) {
                const NoteEvent& ev = in->events[e];
                if (ev.type == NoteEvent::On) {
                    p.low = (int)value(c, Low, i);
                    p.high = (int)value(c, High, i);
                    p.floor = value(c, Floor, i);
                    p.ceiling = value(c, Ceiling, i);
                    p.bend = value(c, Bend, i);
                    const float g = c.inputs[Gate][i];
                    p.open = !gatePatched || ((g >= 0.5f) != invert);
                    p.ppq = c.ppqAt(i);
                    const auto v = dsp_.noteOn(ev.note, ev.pitch, ev.value, p, table, base_ + i, emit(i));
                    why_.store((int)v);
                    if (v == patch::GatePassed) {
                        passLeft_ = pulse_;
                        passed_.fetch_add(1, std::memory_order_relaxed);
                        lastVel_.store(ev.value);
                    } else {
                        blockLeft_ = pulse_;
                        blocked_.fetch_add(1, std::memory_order_relaxed);
                    }
                    step_.store(patch::NoteGateDsp::stepAt(p.ppq, p.barBeats));
                } else if (ev.type == NoteEvent::Off) {
                    dsp_.noteOff(ev.note, emit(i));
                } else if (ev.type != NoteEvent::Pressure) {
                    out.pushController(ev);
                }
            }
            c.outputs[Passed][i] = passLeft_ > 0 ? 1.0f : 0.0f;
            c.outputs[Blocked][i] = blockLeft_ > 0 ? 1.0f : 0.0f;
            if (passLeft_ > 0) --passLeft_;
            if (blockLeft_ > 0) --blockLeft_;
        }
        base_ += c.numSamples;
        open_.store(!gatePatched || ((c.numSamples > 0 ? c.inputs[Gate][c.numSamples - 1] >= 0.5f : true) != invert));
        if (p.ppqValid) step_.store(patch::NoteGateDsp::stepAt(c.ppqAt(c.numSamples - 1 < 0 ? 0 : c.numSamples - 1), p.barBeats));
    }

private:
    patch::NoteGateDsp dsp_;
    std::string data_;
    RtHandoff<GateTable> handoff_;
    int pulse_ = 96, passLeft_ = 0, blockLeft_ = 0;
    int64_t base_ = 0;
    bool wasConnected_ = false;
    std::atomic<uint32_t> passed_{0}, blocked_{0};
    std::atomic<int> why_{0}, step_{0};
    std::atomic<bool> open_{true};
    std::atomic<float> lastVel_{0.0f};
};

}  // namespace

static void registerNoteGateModule(Registry& r) {
    ModuleSpec s;
    s.type = "note-gate";
    s.name = "Note Gate";
    s.category = "Sequencing/Melodic";
    s.colour = "#e0a458";
    s.description = "Filters, remaps and reshapes a note stream: range window, velocity limits and curve, pitch-class remap, gate input and rule lanes.";
    s.params = {ParamSpec::steppedInt("low", "Low Note", 0, 127, 0).inGroup("Range"),
                ParamSpec::steppedInt("high", "High Note", 0, 127, 127).inGroup("Range"),
                ParamSpec::choice("rangemode", "Window", {"Pass Inside", "Block Inside"}, 0).inGroup("Range"),
                ParamSpec::percent("floor", "Floor", 0.0f, 1.0f, 0.0f).inGroup("Velocity"),
                ParamSpec::percent("ceiling", "Ceiling", 0.0f, 1.0f, 1.0f).inGroup("Velocity"),
                ParamSpec::choice("floormode", "Below Floor", {"Drop", "Lift"}, 0).inGroup("Velocity"),
                ParamSpec::choice("curvemode", "Curve", {"Knob", "Drawn"}, 0).inGroup("Velocity"),
                ParamSpec::percent("bend", "Bend", -1.0f, 1.0f, 0.0f).inGroup("Velocity").when("curvemode", 0, 0),
                ParamSpec::choice("remap", "Remap", {"Off", "On"}, 0),
                ParamSpec::choice("gatemode", "Gate Input", {"Pass When High", "Block When High"}, 0),
                ParamSpec::choice("stepsrule", "Step Lane", {"Off", "On"}, 0).inGroup("Rules"),
                ParamSpec::integer("barbeats", "Beats Per Bar", 1, 8, 4).inGroup("Rules"),
                ParamSpec::integer("every", "Every Nth", 1, 8, 1).inGroup("Rules"),
                ParamSpec::integer("offset", "Nth Offset", 0, 7, 0).inGroup("Rules"),
                ParamSpec::integer("density", "Density Limit", 0, 16, 0).inGroup("Rules"),
                ParamSpec::choice("window", "Density Window", {"1 beat", "2 beats", "1 bar", "2 bars"}, 0).inGroup("Rules")};
    s.inputs = {{"notes", "Notes", Signal::Notes}, {"gate", "Gate", Signal::Gate}};
    s.outputs = {{"notes", "Notes", Signal::Notes, false}, {"passed", "Passed", Signal::Trigger, false}, {"blocked", "Blocked", Signal::Trigger, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<NoteGateModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerNoteGateModule);

}  // namespace bleep::engine
