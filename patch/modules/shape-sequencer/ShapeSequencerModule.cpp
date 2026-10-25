// SPDX-License-Identifier: GPL-3.0-only
// Shape Sequencer node (doc/specs/modules/shape-sequencer.md): a looping control
// voltage drawn from shapes placed on a step grid. The shapes (position, length, levels,
// curve) are node data; length, grid, sync and the output stage are knobs.
#include "ShapeSequencerDsp.h"
#include "Handoff.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <atomic>
#include <memory>
#include <vector>
#include <string>

namespace bleep::engine {
namespace {

using patch::kMaxShapes;
using patch::ShapeSegment;
using patch::ShapeSequencerDsp;
using patch::ShapeTable;

const char* const kTypes[] = {"empty", "ramp", "curve", "tri", "plat", "pulse"};  // ShapeType order

float clamped(const juce::var& v, float lo, float hi, float def) {
    return v.isDouble() || v.isInt() ? std::clamp((float)(double)v, lo, hi) : def;
}

/// The node data, cleaned: up to 64 shapes sorted by start, each with a positive length that ends where the next one starts;
/// unknown or empty types are dropped, levels are 0…1 and the curve −1…+1. A document without a list gets the default loop.
ShapeTable parseShapes(const juce::var& data) {
    const auto* list = data["shapes"].getArray();
    if (list == nullptr) return patch::defaultShapeTable();
    std::vector<ShapeSegment> v;
    for (const juce::var& s : *list) {
        ShapeSegment d;
        const juce::String type = s["t"].toString();
        for (size_t k = 1; k < std::size(kTypes); ++k)
            if (type == kTypes[k]) d.type = (uint8_t)k;
        d.start = s["s"].isDouble() || s["s"].isInt() ? std::max(0.0, (double)s["s"]) : 0.0;
        d.len = s["n"].isDouble() || s["n"].isInt() ? std::min(64.0, (double)s["n"]) : 0.0;
        if (d.type == patch::ShapeEmpty || d.len < 1e-4) continue;
        d.a = clamped(s["a"], 0.0f, 1.0f, 0.0f);
        d.b = clamped(s["b"], 0.0f, 1.0f, 0.0f);
        d.c = clamped(s["c"], -1.0f, 1.0f, 0.0f);
        if (d.type == patch::ShapePlateau) d.b = d.a;
        v.push_back(d);
    }
    std::stable_sort(v.begin(), v.end(), [](const ShapeSegment& x, const ShapeSegment& y) { return x.start < y.start; });
    ShapeTable t;
    for (size_t i = 0; i < v.size() && t.count < kMaxShapes; ++i) {
        ShapeSegment d = v[i];
        if (i + 1 < v.size()) d.len = std::min(d.len, v[i + 1].start - d.start);
        if (d.len < 1e-4) continue;
        t.seg[(size_t)t.count++] = d;
    }
    return t;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const ShapeTable t = parseShapes(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> list;
    for (int i = 0; i < t.count; ++i) {
        const ShapeSegment& d = t.seg[(size_t)i];
        auto* o = new juce::DynamicObject();
        o->setProperty("t", kTypes[d.type]);
        o->setProperty("s", d.start);
        o->setProperty("n", d.len);
        o->setProperty("a", d.a);
        o->setProperty("b", d.b);
        o->setProperty("c", d.c);
        list.add(juce::var(o));
    }
    out->setProperty("shapes", list);
    return juce::JSON::toString(result, true).toStdString();
}

class ShapeSequencerModule final : public Module {
public:
    enum { Length, Steps, Sync, Playback, Polarity, Depth, Offset, Slew, Rate };
    enum { Trig, Reset };
    enum { Out, StepTrig, Cycle };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        handoff_.publish(std::make_shared<const ShapeTable>(parseShapes(juce::JSON::parse(juce::String(json)))));
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
        p.lengthBeats = std::clamp((double)setting(Length), 1.0, 64.0);
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
            c.outputs[StepTrig][i] = f.stepTrig;
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
    s.description = "A looping control voltage drawn from shapes: pick a length and a number of steps, place saws, curves, plateaus and pulses on the steps, and bend them with the mouse.";
    s.params = {ParamSpec::integer("length", "Length (beats)", 1, 64, 4),
                ParamSpec::integer("steps", "Steps", 1, 32, 4),
                ParamSpec::choice("sync", "Sync", {"Transport", "Trigger", "Gate"}, 0),
                ParamSpec::choice("playback", "Playback", {"Loop", "Once"}, 0).when("sync", 1, 1),
                ParamSpec::choice("polarity", "Polarity", {"Unipolar", "Bipolar"}, 0),
                ParamSpec::percent("depth", "Depth", 0.0f, 1.0f, 1.0f),
                ParamSpec::number("offset", "Offset", -1.0f, 1.0f, 0.0f, "", 2),
                ParamSpec::percent("slew", "Slew", 0.0f, 1.0f, 0.0f),
                ParamSpec::stepped("rate", "Rate", {"1/4x", "1/2x", "1x", "2x", "4x"}, 2)};
    s.inputs = {{"trig", "Trig / Gate", Signal::Gate}, {"reset", "Reset", Signal::Trigger}};
    s.outputs = {{"out", "Out", Signal::Control, true}, {"step", "Step", Signal::Trigger, false}, {"cycle", "Cycle", Signal::Trigger, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ShapeSequencerModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerShapeSequencerModule);

}  // namespace bleep::engine
