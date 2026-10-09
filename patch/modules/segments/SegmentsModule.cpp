// SPDX-License-Identifier: MIT
// Segments node (doc/specs/modules/segments.md): a chain of up to 8 ramp, step
// and hold segments with loops, a sustain point and per-segment gates. The
// segment types and flags are node data; times, levels and curves are knobs.
#include "SegmentsDsp.h"
#include "Handoff.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <memory>
#include <string>

namespace bleep::engine {
namespace {

using patch::kSegments;
using patch::SegmentDef;
using patch::SegmentsDsp;
using patch::SegmentTable;

const char* const kTypes[] = {"ramp", "step", "hold"};
const char* const kWaits[] = {"time", "gate", "trigger"};
const char* const kSegIns[] = {"advance", "jump"};

template <size_t N>
int pick(const juce::var& v, const char* const (&names)[N], int def) {
    const juce::String s = v.toString();
    for (size_t i = 0; i < N; ++i)
        if (s == names[i]) return (int)i;
    return def;
}

/// The node data, cleaned: 8 entries; a document without any gets the ADSR,
/// missing entries are Ramp segments; unknown strings take the defaults.
SegmentTable parseSegments(const juce::var& data) {
    const auto* list = data["segments"].getArray();
    if (list == nullptr) return patch::defaultSegments();
    SegmentTable t{};
    for (int i = 0; i < std::min(list->size(), kSegments); ++i) {
        const juce::var s = (*list)[i];
        SegmentDef& d = t[(size_t)i];
        d.type = (uint8_t)pick(s["type"], kTypes, patch::SegRamp);
        d.loop = s["loop"].isBool() ? (bool)s["loop"] : false;
        d.wait = (uint8_t)pick(s["wait"], kWaits, patch::WaitGate);
        d.segIn = (uint8_t)pick(s["segIn"], kSegIns, patch::SegInAdvance);
        const int sync = dsp::noteValueIndex(s["sync"].toString().toRawUTF8());
        d.sync = sync >= SegmentsDsp::kFirstSync ? sync : dsp::noteValueIndex("1/4");
    }
    return t;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const SegmentTable t = parseSegments(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> list;
    for (const SegmentDef& d : t) {
        auto* o = new juce::DynamicObject();
        o->setProperty("type", kTypes[d.type]);
        o->setProperty("loop", d.loop);
        o->setProperty("wait", kWaits[d.wait]);
        o->setProperty("segIn", kSegIns[d.segIn]);
        o->setProperty("sync", dsp::noteValues()[(size_t)SegmentsDsp::clampSync(d.sync)].name);
        list.add(juce::var(o));
    }
    out->setProperty("segments", list);
    return juce::JSON::toString(result, true).toStdString();
}

class SegmentsModule final : public Module {
public:
    static constexpr int kTimeScale = 3 * kSegments, kVelAmount = kTimeScale + 1, kCount = kTimeScale + 2,
                         kRun = kTimeScale + 3, kRelease = kTimeScale + 4, kSync = kTimeScale + 5;
    static int time(int n) { return 3 * n; }
    static int level(int n) { return 3 * n + 1; }
    static int shape(int n) { return 3 * n + 2; }
    enum { Gate, VelocityIn, SegIn1 };
    enum { Out, Inv, SegOut1, LoopOut = SegOut1 + kSegments, EndOut, ActiveOut };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        handoff_.publish(std::make_shared<const SegmentTable>(parseSegments(juce::JSON::parse(juce::String(json)))));
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"segment", (double)segment_.load()});
        out.push_back({"u", (double)u_.load()});
        out.push_back({"level", (double)level_.load()});
    }

    void process(const ProcessContext& c) override {
        static const SegmentTable defaults = patch::defaultSegments();
        const SegmentTable* table = handoff_.get();
        const SegmentTable& d = table ? *table : defaults;
        patch::SegmentsParams p;
        p.count = (int)setting(kCount);
        p.freeRun = setting(kRun) >= 0.5f;
        p.finish = setting(kRelease) >= 0.5f;
        p.sync = setting(kSync) >= 0.5f;
        // Every segment's knobs at the chunk start; the running one's every sample.
        for (int n = 0; n < kSegments; ++n) readSegment(c, p, n, 0);
        const Transport& tr = *c.transport;
        patch::SegmentsTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        const bool velocityPatched = c.inputConnected[VelocityIn];
        float segIns[kSegments];
        patch::SegmentsFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            if (const int s = dsp_.segment(); s >= 0) readSegment(c, p, s, i);
            p.timeScale = value(c, kTimeScale, i);
            p.velAmount = value(c, kVelAmount, i);
            for (int n = 0; n < kSegments; ++n) segIns[n] = c.inputs[SegIn1 + n][i];
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            dsp_.tick(p, d, c.inputs[Gate][i], velocityPatched ? c.inputs[VelocityIn][i] : 1.0f, segIns, t, f);
            c.outputs[Out][i] = f.out;
            c.outputs[Inv][i] = -f.out;
            for (int n = 0; n < kSegments; ++n) c.outputs[SegOut1 + n][i] = f.segment == n ? 1.0f : 0.0f;
            c.outputs[LoopOut][i] = f.loop;
            c.outputs[EndOut][i] = f.end;
            c.outputs[ActiveOut][i] = f.active;
        }
        segment_.store(dsp_.segment());
        u_.store((float)dsp_.elapsedShare());
        level_.store(dsp_.level());
    }

private:
    void readSegment(const ProcessContext& c, patch::SegmentsParams& p, int n, int i) const noexcept {
        p.time[n] = value(c, time(n), i);
        p.level[n] = value(c, level(n), i);
        p.shape[n] = value(c, shape(n), i);
    }

    SegmentsDsp dsp_;
    RtHandoff<SegmentTable> handoff_;
    std::string data_;
    std::atomic<int> segment_{-1};
    std::atomic<float> u_{0.0f}, level_{0.0f};
};

}  // namespace

static void registerSegmentsModule(Registry& r) {
    ModuleSpec s;
    s.type = "segments";
    s.name = "Segments";
    s.category = "Modulation";
    s.colour = "#ca8a04";
    s.description = "A chain of up to 8 ramp, step and hold segments: any envelope, or with a loop, an LFO of any shape.";
    // A new module is an ADSR (segments.md 4.6); unused segments are Ramp 250 ms → 0.
    const float times[kSegments] = {0.005f, 0.3f, 0.25f, 0.4f, 0.25f, 0.25f, 0.25f, 0.25f};
    const float levels[kSegments] = {1.0f, 0.7f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
    const float shapes[kSegments] = {0.0f, 0.5f, 0.0f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f};
    for (int n = 0; n < kSegments; ++n) {
        const std::string k = std::to_string(n + 1);
        const std::string g = "Segment " + k;
        s.params.push_back(ParamSpec::seconds("time" + k, "Time " + k, 0.0005f, 30.0f, 0.25f, times[n]).inGroup(g).when("count", n + 1, 8));
        s.params.push_back(ParamSpec::number("level" + k, "Level " + k, -1.0f, 1.0f, levels[n]).inGroup(g).when("count", n + 1, 8));
        s.params.push_back(ParamSpec::number("shape" + k, "Shape " + k, -1.0f, 1.0f, shapes[n]).inGroup(g).when("count", n + 1, 8));
    }
    s.params.push_back(ParamSpec::exponential("timescale", "Time Scale", 0.1f, 10.0f, 1.0f, "\xc3\x97").inGroup("Chain"));
    s.params.push_back(ParamSpec::percent("velamount", "Vel Amount", 0.0f, 1.0f, 0.0f).inGroup("Chain"));
    s.params.push_back(ParamSpec::integer("count", "Count", 1, kSegments, 4));
    s.params.push_back(ParamSpec::choice("run", "Run", {"Gated", "Free"}, 0));
    s.params.push_back(ParamSpec::choice("release", "Release", {"Jump", "Finish"}, 0));
    s.params.push_back(ParamSpec::toggle("sync", "Sync", false));
    s.inputs = {{"gate", "Gate", Signal::Gate}, {"velocity", "Velocity", Signal::Control}};
    for (int n = 1; n <= kSegments; ++n)
        s.inputs.push_back(JackSpec{"segin" + std::to_string(n), "Seg " + std::to_string(n), Signal::Trigger}.when("count", n, 8));
    s.outputs = {{"out", "Out", Signal::Control, true}, {"inv", "Inv", Signal::Control, true}};
    for (int n = 1; n <= kSegments; ++n)
        s.outputs.push_back(JackSpec{"seg" + std::to_string(n), "Seg " + std::to_string(n), Signal::Gate, false}.when("count", n, 8));
    s.outputs.push_back({"loop", "Loop", Signal::Trigger, false});
    s.outputs.push_back({"end", "End", Signal::Trigger, false});
    s.outputs.push_back({"active", "Active", Signal::Gate, false});
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SegmentsModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerSegmentsModule);

}  // namespace bleep::engine
