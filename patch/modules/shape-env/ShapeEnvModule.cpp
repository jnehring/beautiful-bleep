// SPDX-License-Identifier: GPL-3.0-or-later
// Shape Env node (doc/specs/modules/shape-envelope.md): an envelope / LFO that
// plays shapes from the shared library or eight user-drawn slots (node data).
#include "ShapeEnvDsp.h"
#include "Handoff.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <cmath>
#include <memory>
#include <vector>

namespace bleep::engine {
namespace {

using patch::ShapeEnvDsp;
using patch::UserShapes;

using patch::UserSlot;

UserSlot parseSlot(const juce::var& v) {
    UserSlot s;
    const auto* pts = v["points"].getArray();
    if (!v.isObject() || pts == nullptr || pts->isEmpty()) return s;
    std::vector<double> values;
    for (const auto& x : *pts) values.push_back(x.isDouble() || x.isInt() || x.isInt64() ? (double)x : 0.0);
    const juce::var sus = v["sustain"];
    const double sustain = sus.isDouble() || sus.isInt() || sus.isInt64() ? (double)sus : -1.0;
    s.set(values.data(), (int)values.size(), sustain, v["kind"].toString() == "cycle", (bool)v.getProperty("bipolar", false));
    return s;
}

std::array<UserSlot, patch::kUserShapes> parseSlots(const juce::var& data) {
    std::array<UserSlot, patch::kUserShapes> slots{};
    if (const auto* user = data["user"].getArray())
        for (int i = 0; i < std::min(user->size(), patch::kUserShapes); ++i) slots[(size_t)i] = parseSlot((*user)[i]);
    return slots;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const auto slots = parseSlots(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> user;
    for (const auto& s : slots) {
        if (!s.used) {
            user.add(juce::var());
            continue;
        }
        auto* o = new juce::DynamicObject();
        juce::Array<juce::var> pts;
        for (float v : s.points) pts.add((double)v);
        o->setProperty("points", pts);
        o->setProperty("sustain", s.sustain >= 0.0f ? juce::var((double)s.sustain) : juce::var());
        o->setProperty("kind", s.cycle ? "cycle" : "envelope");
        o->setProperty("bipolar", s.bipolar);
        user.add(juce::var(o));
    }
    out->setProperty("user", user);
    return juce::JSON::toString(result, true).toStdString();
}

std::shared_ptr<const UserShapes> buildShapes(const std::array<UserSlot, patch::kUserShapes>& slots) {
    auto shapes = std::make_shared<UserShapes>();
    for (size_t i = 0; i < slots.size(); ++i) slots[i].build((*shapes)[i]);
    return shapes;
}

class ShapeEnvModule final : public Module {
public:
    enum { Time, Shape, Morph, Level, VelAmount, Skew, Mode, Sync, Reverse, Retrigger };
    enum { Trig, Gate, Velocity };
    enum { Out, Inv, Phase, End, Active };
    static constexpr int kPreview = 128, kThumb = 48;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        auto shapes = buildShapes(parseSlots(juce::JSON::parse(juce::String(json))));
        msgShapes_ = shapes;
        handoff_.publish(std::move(shapes));
        thumbsWanted_.store(true);
    }

    void command(const std::string& id, float value) override {
        if (id == "thumbs") thumbsWanted_.store(true);
        else Module::command(id, value);
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"phase", (double)phase_.load()});
        out.push_back({"holding", holding_.load() ? 1.0 : 0.0});
        out.push_back({"playing", (double)playing_.load()});
        const UserShapes* u = msgShapes_.get();
        const int s = shape_.load();
        const float morph = morph_.load();
        const auto in = ShapeEnvDsp::morphedInfo(s, morph, u);
        out.push_back({"sustain", ShapeEnvDsp::holdPhase(in.sustain, skew_.load(), setting(Reverse) >= 0.5f)});
        out.push_back({"bipolar", in.bipolar ? 1.0 : 0.0});
    }

    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        const UserShapes* u = msgShapes_.get();
        std::vector<float> preview(kPreview);
        const int s = shape_.load();
        const float morph = morph_.load(), skew = skew_.load();
        const bool reverse = setting(Reverse) >= 0.5f;
        for (int i = 0; i < kPreview; ++i)
            preview[(size_t)i] = ShapeEnvDsp::lookup(s, morph, skew, reverse, (double)i / (kPreview - 1), u);
        out.push_back({"preview", std::move(preview)});
        if (thumbsWanted_.exchange(false)) {  // every shape at 48 points, for the browser
            std::vector<float> thumbs((size_t)(ShapeEnvDsp::kShapes * kThumb));
            for (int k = 0; k < ShapeEnvDsp::kShapes; ++k)
                for (int i = 0; i < kThumb; ++i)
                    thumbs[(size_t)(k * kThumb + i)] = ShapeEnvDsp::table(k, u).at((double)i / (kThumb - 1));
            out.push_back({"thumbs", std::move(thumbs)});
        }
    }

    void process(const ProcessContext& c) override {
        const UserShapes* user = handoff_.get();
        patch::ShapeEnvParams p;
        p.mode = (int)setting(Mode);
        p.sync = (int)setting(Sync);
        p.reverse = setting(Reverse) >= 0.5f;
        p.ignoreRetrigger = setting(Retrigger) >= 0.5f;
        const Transport& tr = *c.transport;
        patch::ShapeEnvTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        const bool velocityPatched = c.inputConnected[Velocity];
        patch::ShapeEnvFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.time = value(c, Time, i);
            p.shape = (int)setting(Shape);
            p.morph = value(c, Morph, i);
            p.level = value(c, Level, i);
            p.velAmount = value(c, VelAmount, i);
            p.skew = value(c, Skew, i);
            t.ppq = c.ppqAt(i);
            dsp_.tick(p, c.inputs[Trig][i], c.inputs[Gate][i], velocityPatched ? c.inputs[Velocity][i] : 1.0f, t, user, f);
            c.outputs[Out][i] = f.out;
            c.outputs[Inv][i] = f.inv;
            c.outputs[Phase][i] = f.phase;
            c.outputs[End][i] = f.end;
            c.outputs[Active][i] = f.active;
        }
        phase_.store((float)dsp_.phase());
        holding_.store(dsp_.holding());
        playing_.store(dsp_.playingShape());
        shape_.store(p.shape);
        morph_.store(p.morph);
        skew_.store(p.skew);
    }

private:
    ShapeEnvDsp dsp_;
    RtHandoff<UserShapes> handoff_;
    std::shared_ptr<const UserShapes> msgShapes_;  // message thread: preview and thumbnails
    std::string data_;
    mutable std::atomic<bool> thumbsWanted_{true};
    std::atomic<float> phase_{0.0f}, morph_{0.0f}, skew_{0.0f};
    std::atomic<int> shape_{0}, playing_{0};
    std::atomic<bool> holding_{false};
};

}  // namespace

static void registerShapeEnvModule(Registry& r) {
    ModuleSpec s;
    s.type = "shape-env";
    s.name = "Shape Env";
    s.category = "Modulation/Envelopes";
    s.colour = "#fda4af";
    s.description = "Envelope and LFO that plays shapes from a library of 96, plus 8 you draw: one-shot, gated or looped.";
    std::vector<std::string> names, groups, sync;
    for (int i = 0; i < dsp::ShapeLibrary::kFactoryShapes; ++i) {
        const auto& in = dsp::ShapeLibrary::info(i);
        names.emplace_back(in.name);
        groups.emplace_back(dsp::ShapeLibrary::familyName(in.family));
    }
    for (int i = 1; i <= patch::kUserShapes; ++i) {
        names.push_back("User " + std::to_string(i));
        groups.emplace_back("User");
    }
    for (int i = 0; i < ShapeEnvDsp::kSyncChoices; ++i) sync.emplace_back(ShapeEnvDsp::syncName(i));
    auto shape = ParamSpec::choice("shape", "Shape", names, 0);
    shape.choiceGroups = groups;
    s.params = {ParamSpec::seconds("time", "Time", 0.001f, 60.0f, 0.5f, 0.5f),
                shape,
                ParamSpec::percent("morph", "Morph", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("velamount", "Vel Amount", 0.0f, 1.0f, 0.0f),
                ParamSpec::number("skew", "Skew", -1.0f, 1.0f, 0.0f),
                ParamSpec::choice("mode", "Mode", {"One-shot", "Gated", "Loop"}, 0),
                ParamSpec::choice("sync", "Sync", sync, 0),
                ParamSpec::toggle("reverse", "Reverse", false),
                ParamSpec::choice("retrigger", "Retrigger", {"Restart", "Ignore"}, 0).when("mode", 0, 1)};
    s.inputs = {{"trig", "Trig", Signal::Trigger}, {"gate", "Gate", Signal::Gate}, {"velocity", "Velocity", Signal::Control}};
    s.outputs = {{"out", "Out", Signal::Control, true},       {"inv", "Inv", Signal::Control, true},
                 {"phase", "Phase", Signal::Control, false},  {"end", "End", Signal::Trigger, false},
                 {"active", "Active", Signal::Gate, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ShapeEnvModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerShapeEnvModule);

}  // namespace bleep::engine
