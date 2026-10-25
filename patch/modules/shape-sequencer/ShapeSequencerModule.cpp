// SPDX-License-Identifier: GPL-3.0-only
// Shape Sequencer node (doc/specs/modules/shape-sequencer.md): a looping control
// voltage drawn from shapes placed in grid slots. The slots (shape, levels,
// curve) are node data; length, grid, sync and the output stage are knobs.
#include "ShapeSequencerDsp.h"
#include "Handoff.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <atomic>
#include <memory>
#include <string>

namespace bleep::engine {
namespace {

using patch::kShapeSlots;
using patch::ShapeSequencerDsp;
using patch::ShapeSlot;
using patch::ShapeTable;

const char* const kTypes[] = {"empty", "ramp", "curve", "tri", "plat", "pulse"};  // ShapeType order
const double kLengthBars[] = {0.25, 0.5, 1.0, 2.0, 4.0, 8.0};
const double kGridPerBar[] = {1.0, 2.0, 4.0, 8.0, 16.0, 32.0};

float clamped(const juce::var& v, float lo, float hi, float def) {
    return v.isDouble() || v.isInt() ? std::clamp((float)(double)v, lo, hi) : def;
}

/// The node data, cleaned: 32 entries; a document without any gets the default loop;
/// unknown types are empty, levels are 0…1 and the curve −1…+1.
ShapeTable parseSlots(const juce::var& data) {
    const auto* list = data["slots"].getArray();
    if (list == nullptr) return patch::defaultShapeTable();
    ShapeTable t{};
    for (int i = 0; i < std::min(list->size(), kShapeSlots); ++i) {
        const juce::var s = (*list)[i];
        ShapeSlot& d = t[(size_t)i];
        const juce::String type = s["t"].toString();
        for (size_t k = 0; k < std::size(kTypes); ++k)
            if (type == kTypes[k]) d.type = (uint8_t)k;
        d.a = clamped(s["a"], 0.0f, 1.0f, 0.0f);
        d.b = clamped(s["b"], 0.0f, 1.0f, 0.0f);
        d.c = clamped(s["c"], -1.0f, 1.0f, 0.0f);
        if (d.type == patch::ShapePlateau) d.b = d.a;
    }
    return t;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const ShapeTable t = parseSlots(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> list;
    for (const ShapeSlot& d : t) {
        auto* o = new juce::DynamicObject();
        o->setProperty("t", kTypes[d.type]);
        o->setProperty("a", d.a);
        o->setProperty("b", d.b);
        o->setProperty("c", d.c);
        list.add(juce::var(o));
    }
    out->setProperty("slots", list);
    return juce::JSON::toString(result, true).toStdString();
}

class ShapeSequencerModule final : public Module {
public:
    enum { Length, Grid, Sync, Playback, Polarity, Depth, Offset, Slew, Rate };
    enum { Trig, Reset };
    enum { Out, SlotTrig, Cycle };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        handoff_.publish(std::make_shared<const ShapeTable>(parseSlots(juce::JSON::parse(juce::String(json)))));
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"phase", phase_.load()});
        out.push_back({"active", active_.load() ? 1.0 : 0.0});
        out.push_back({"out", (double)out_.load()});
    }

    void process(const ProcessContext& c) override {
        static const ShapeTable defaults = patch::defaultShapeTable();
        const ShapeTable* table = handoff_.get();
        const ShapeTable& d = table ? *table : defaults;
        patch::ShapeParams p;
        const double bars = kLengthBars[std::clamp((int)setting(Length), 0, 5)];
        p.lengthBeats = 4.0 * bars;
        p.gridBeats = 4.0 / kGridPerBar[std::clamp((int)setting(Grid), 0, 5)];
        p.sync = (int)setting(Sync);
        p.once = setting(Playback) >= 0.5f;
        p.bipolar = setting(Polarity) >= 0.5f;
        const Transport& tr = *c.transport;
        patch::ShapeTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        patch::ShapeFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.depth = value(c, Depth, i);
            p.offset = value(c, Offset, i);
            p.slew = value(c, Slew, i);
            p.rate = std::pow(2.0, std::clamp((int)value(c, Rate, i), 0, 4) - 2);
            t.ppq = c.ppqAt(i);
            dsp_.tick(p, d, c.inputs[Trig][i], c.inputs[Reset][i], t, f);
            c.outputs[Out][i] = f.out;
            c.outputs[SlotTrig][i] = f.slotTrig;
            c.outputs[Cycle][i] = f.cycle;
        }
        phase_.store(f.phase);
        active_.store(f.active);
        out_.store(f.out);
    }

private:
    ShapeSequencerDsp dsp_;
    RtHandoff<ShapeTable> handoff_;
    std::string data_;
    std::atomic<double> phase_{0.0};
    std::atomic<bool> active_{false};
    std::atomic<float> out_{0.0f};
};

}  // namespace

static void registerShapeSequencerModule(Registry& r) {
    ModuleSpec s;
    s.type = "shape-sequencer";
    s.name = "Shape Sequencer";
    s.category = "Modulation/LFOs";
    s.colour = "#5eead4";
    s.description = "A looping control voltage drawn from shapes: pick a length and a grid, place saws, curves, plateaus and pulses in the slots, and bend them with the mouse.";
    s.params = {ParamSpec::choice("length", "Length", {"1/4 bar", "1/2 bar", "1 bar", "2 bars", "4 bars", "8 bars"}, 2),
                ParamSpec::choice("grid", "Grid", {"1/1", "1/2", "1/4", "1/8", "1/16", "1/32"}, 2),
                ParamSpec::choice("sync", "Sync", {"Transport", "Trigger", "Gate"}, 0),
                ParamSpec::choice("playback", "Playback", {"Loop", "Once"}, 0).when("sync", 1, 1),
                ParamSpec::choice("polarity", "Polarity", {"Unipolar", "Bipolar"}, 0),
                ParamSpec::percent("depth", "Depth", 0.0f, 1.0f, 1.0f),
                ParamSpec::number("offset", "Offset", -1.0f, 1.0f, 0.0f, "", 2),
                ParamSpec::percent("slew", "Slew", 0.0f, 1.0f, 0.0f),
                ParamSpec::stepped("rate", "Rate", {"1/4x", "1/2x", "1x", "2x", "4x"}, 2)};
    s.inputs = {{"trig", "Trig / Gate", Signal::Gate}, {"reset", "Reset", Signal::Trigger}};
    s.outputs = {{"out", "Out", Signal::Control, true}, {"slot", "Slot", Signal::Trigger, false}, {"cycle", "Cycle", Signal::Trigger, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ShapeSequencerModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerShapeSequencerModule);

}  // namespace bleep::engine
