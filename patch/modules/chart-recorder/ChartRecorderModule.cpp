// SPDX-License-Identifier: GPL-3.0-or-later
// Chart Recorder node (doc/specs/modules/chart-recorder.md): a sprung pen draws
// the input onto a looping strip; the strip replays as modulation.
//
// The strip lives on the audio thread (atomics in ChartRecorderDsp). Node data
// edited in the view arrives through setData and RtHandoff; data the module
// wrote itself goes back to the board through takeData (on Record falling, at
// the end of a pass, on Clear and every 5 s of writing). The view gets the
// heads and the pen as live values, and the strip as live arrays: the whole
// strip after a load, clear or resize, otherwise only the points written since
// its last read.
#include "ChartRecorderDsp.h"
#include "Handoff.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <limits>

namespace bleep::engine {
namespace {

using patch::ChartRecorderDsp;
using patch::ChartStripData;

ChartStripData parseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    double n = std::numeric_limits<double>::quiet_NaN();
    const juce::var nv = in["n"];
    if (nv.isInt() || nv.isInt64() || nv.isDouble()) n = (double)nv;
    const juce::var pv = in["pcm16"];
    const std::string pcm = pv.isString() ? pv.toString().toStdString() : std::string();
    std::vector<double> marks;
    if (const auto* a = in["marks"].getArray())
        for (const auto& m : *a)
            marks.push_back(m.isInt() || m.isInt64() || m.isDouble() ? (double)m : std::numeric_limits<double>::quiet_NaN());
    return patch::chartSanitise(n, pcm, marks);
}

std::string serialise(const ChartStripData& d) {
    auto* o = new juce::DynamicObject();
    juce::var result(o);
    o->setProperty("v", 1);
    o->setProperty("n", d.n);
    o->setProperty("pcm16", juce::String(patch::chartEncodePcm16(d.points.data(), d.n)));
    juce::Array<juce::var> marks;
    for (int m : d.marks) marks.add(m);
    o->setProperty("marks", marks);
    return juce::JSON::toString(result, true).toStdString();
}

std::string sanitiseData(const std::string& json) { return serialise(parseData(json)); }

/// Parsed node data for the audio thread; `gen` tells a new load from the current one.
struct LoadedStrip {
    ChartStripData data;
    uint64_t gen = 0;
};

class ChartRecorderModule final : public Module {
public:
    enum { Gain, Response, WritingSpeed, Damping, Friction, PaperSpeed, ReplaySpeed, Offset,
           Detector, LogRange, Paper, LengthFree, LengthBars, Record, ReplaySync, Interp };
    enum { In, RecordIn, Mark, HoldPaper, Clear, Reset };
    enum { Pen, Replay, Marker, Position };
    enum { ClearButton, ArmButton, HoldButton };  // ModuleSpec::buttons

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        if (json == taken_) {  // our own snapshot coming back: the strip already has it
            taken_.clear();
            return;
        }
        auto d = std::make_shared<LoadedStrip>();
        d->data = parseData(json);
        d->gen = ++gen_;
        handoff_.publish(std::move(d));
    }

    bool takeData(std::string& json) override {
        if (!dsp_.takeSnapshotRequest()) return false;
        ChartStripData d;
        d.n = dsp_.n();
        d.points.resize((size_t)d.n);
        for (int k = 0; k < d.n; ++k) d.points[(size_t)k] = dsp_.point(k);
        for (int i = 0; i < dsp_.markCount(); ++i) d.marks.push_back(dsp_.mark(i));
        d.marks = patch::chartSanitiseMarks(std::vector<double>(d.marks.begin(), d.marks.end()), d.n);
        json = taken_ = serialise(d);
        return true;
    }

    void command(const std::string& id, float value) override {
        if (id == "sync") dsp_.requestFull();  // a view opened: send it the whole strip
        else Module::command(id, value);
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"p", (double)p_.load()});
        out.push_back({"q", (double)q_.load()});
        out.push_back({"u", (double)u_.load()});
        out.push_back({"rec", (double)rec_.load()});
        out.push_back({"writing", writing_.load() ? 1.0 : 0.0});
        out.push_back({"held", held_.load() ? 1.0 : 0.0});
        out.push_back({"n", (double)dsp_.n()});
        out.push_back({"seconds", (double)seconds_.load()});
    }

    /// "strip": every point (−2 = blank) after a load, clear, resize or when the
    /// view fell behind; otherwise "ink": [index, value, …] written since the last
    /// read. "marks": the marked indices.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        const uint32_t w = dsp_.inkWritten();
        const bool full = dsp_.takeFullRequest() || w - inkRead_ > (uint32_t)patch::kChartInkRing;
        auto units = [&](int k) {
            const int16_t s = dsp_.point(k);
            return s == patch::kChartBlank ? -2.0f : (float)patch::chartUnits(s);
        };
        if (full) {
            const int n = dsp_.n();
            std::vector<float> v((size_t)n);
            for (int k = 0; k < n; ++k) v[(size_t)k] = units(k);
            out.push_back({"strip", std::move(v)});
        } else if (w != inkRead_) {
            std::vector<float> v;
            v.reserve((size_t)(w - inkRead_) * 2);
            int last = -1;
            for (uint32_t i = inkRead_; i != w; ++i) {
                const int k = dsp_.inkAt(i);
                if (k == last || k >= dsp_.n()) continue;
                last = k;
                v.push_back((float)k);
                v.push_back(units(k));
            }
            out.push_back({"ink", std::move(v)});
        }
        inkRead_ = w;
        std::vector<float> m;
        for (int i = 0; i < dsp_.markCount(); ++i) m.push_back((float)dsp_.mark(i));
        out.push_back({"marks", std::move(m)});
    }

    void process(const ProcessContext& c) override {
        if (const LoadedStrip* d = handoff_.get(); d != nullptr && d->gen != loadedGen_) {
            dsp_.load(d->data);
            loadedGen_ = d->gen;
        }
        const bool canWrite = c.voice <= 0;  // inside a Voice Cell only voice 0 writes
        bool arm = false;
        pollCommands([&](const Command& cmd) {
            if (cmd.index == ClearButton && cmd.value > 0.5f && canWrite) dsp_.clear();
            if (cmd.index == ArmButton && cmd.value > 0.5f) arm = true;
            if (cmd.index == HoldButton && cmd.value > 0.5f) holdToggle_ = !holdToggle_;
        });

        patch::ChartParams p;
        p.detector = (int)setting(Detector);
        p.logRange = patch::chartLogRanges()[(size_t)std::clamp((int)setting(LogRange), 0, 3)];
        p.paper = (int)setting(Paper);
        p.lengthSeconds = patch::chartFreeLengths()[(size_t)std::clamp((int)setting(LengthFree), 0, 8)];
        p.bars = patch::chartBarLengths()[(size_t)std::clamp((int)setting(LengthBars), 0, 6)];
        p.record = (int)setting(Record);
        p.replaySync = (int)setting(ReplaySync);
        p.interp = (int)setting(Interp);
        const Transport& tr = *c.transport;
        dsp_.configure(p, tr.bpm);

        patch::ChartInput in;
        in.playing = tr.playing && tr.ppqValid;
        in.bpm = tr.bpm;
        in.canWrite = canWrite;
        patch::ChartFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.gainDb = cachedValue(c, Gain, i);
            p.response = cachedValue(c, Response, i);
            p.writingSpeed = cachedValue(c, WritingSpeed, i);
            p.damping = cachedValue(c, Damping, i);
            p.friction = cachedValue(c, Friction, i);
            p.paperSpeed = cachedValue(c, PaperSpeed, i);
            p.replaySpeed = cachedValue(c, ReplaySpeed, i);
            p.offset = cachedValue(c, Offset, i);
            in.in = c.inputs[In][i];
            in.record = c.inputs[RecordIn][i];
            in.mark = c.inputs[Mark][i];
            in.hold = holdToggle_ ? 1.0f : c.inputs[HoldPaper][i];
            in.clear = c.inputs[Clear][i];
            in.reset = c.inputs[Reset][i];
            in.arm = arm && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, f);
            c.outputs[Pen][i] = f.pen;
            c.outputs[Replay][i] = f.replay;
            c.outputs[Marker][i] = f.marker;
            c.outputs[Position][i] = f.position;
        }
        p_.store((float)dsp_.writeHead(), std::memory_order_relaxed);
        q_.store((float)dsp_.readPosition(), std::memory_order_relaxed);
        u_.store((float)dsp_.pen(), std::memory_order_relaxed);
        rec_.store(dsp_.recState(), std::memory_order_relaxed);
        writing_.store(dsp_.writing(), std::memory_order_relaxed);
        held_.store(in.hold >= 0.5f, std::memory_order_relaxed);
        seconds_.store((float)ChartRecorderDsp::stripSeconds(p, tr.bpm), std::memory_order_relaxed);
    }

private:
    /// value(), recomputed only when the knob moves (fromNormalised may cost a pow).
    float cachedValue(const ProcessContext& c, int k, int s) noexcept {
        const float n = c.params[k][s];
        if (n < knobNorm_[(size_t)k] || n > knobNorm_[(size_t)k]) {
            knobNorm_[(size_t)k] = n;
            knobUnits_[(size_t)k] = value(c, k, s);
        }
        return knobUnits_[(size_t)k];
    }

    ChartRecorderDsp dsp_;
    RtHandoff<LoadedStrip> handoff_;
    uint64_t loadedGen_ = 0;     // audio thread
    std::string data_, taken_;   // message thread
    uint64_t gen_ = 0;
    mutable uint32_t inkRead_ = 0;
    bool holdToggle_ = false;
    std::atomic<float> p_{0.0f}, q_{0.0f}, u_{0.0f}, seconds_{8.0f};
    std::atomic<int> rec_{0};
    std::atomic<bool> writing_{false}, held_{false};
    std::array<float, 16> knobNorm_ = [] {
        std::array<float, 16> a;
        a.fill(-1.0f);
        return a;
    }();
    std::array<float, 16> knobUnits_{};
};

}  // namespace

static void registerChartRecorderModule(Registry& r) {
    ModuleSpec s;
    s.type = "chart-recorder";
    s.name = "Chart Recorder";
    s.category = "Modulation/Followers";
    s.colour = "#a3e635";
    s.description = "A sprung pen draws the input onto a looping paper strip; the strip replays as modulation, at any speed or backwards.";
    auto response = ParamSpec::exponential("response", "Response", 0.001f, 2.0f, 0.05f);
    response.format = ParamSpec::Format::Seconds;
    auto writing = ParamSpec::exponential("writingspeed", "Writing Speed", 1.0f, 1000.0f, 100.0f, "mm/s");
    writing.decimals = 0;
    s.params = {ParamSpec::number("gain", "Gain", -24.0f, 24.0f, 0.0f, "dB", 1),
                response,
                writing,
                ParamSpec::percent("damping", "Damping", 0.0f, 1.0f, 0.7f),
                ParamSpec::percent("friction", "Friction", 0.0f, 1.0f, 0.0f),
                ParamSpec::exponential("paperspeed", "Paper Speed", 0.25f, 4.0f, 1.0f, "×").when("paper", 0, 0),
                ParamSpec::number("replayspeed", "Replay Speed", -4.0f, 4.0f, 1.0f, "×"),
                ParamSpec::percent("offset", "Offset", 0.0f, 1.0f, 0.0f),
                ParamSpec::choice("detector", "Detector", {"DC", "Rectified", "RMS", "Peak", "Log dB"}, 0),
                ParamSpec::choice("logrange", "Log Range", {"10 dB", "25 dB", "50 dB", "75 dB"}, 2).when("detector", 4, 4),
                ParamSpec::choice("paper", "Paper", {"Free", "Transport"}, 1),
                ParamSpec::choice("lengthfree", "Length", {"1 s", "2 s", "5 s", "10 s", "30 s", "1 min", "2 min", "5 min", "10 min"}, 3)
                    .when("paper", 0, 0),
                ParamSpec::choice("lengthbars", "Length", {"1 bar", "2 bars", "4 bars", "8 bars", "16 bars", "32 bars", "64 bars"}, 2)
                    .when("paper", 1, 1),
                ParamSpec::choice("record", "Record", {"Always", "Gate", "Armed"}, 1),
                ParamSpec::choice("replaysync", "Replay Sync", {"Free", "Song"}, 1),
                ParamSpec::choice("interp", "Interpolation", {"Step", "Linear", "Smooth"}, 1)};
    s.inputs = {{"in", "In", Signal::Control},          {"record", "Record", Signal::Gate},
                {"mark", "Mark", Signal::Trigger},      {"hold", "Hold Paper", Signal::Gate},
                {"clear", "Clear", Signal::Trigger},    {"reset", "Reset", Signal::Trigger}};
    s.outputs = {{"pen", "Pen", Signal::Control, true},         {"replay", "Replay", Signal::Control, true},
                 {"marker", "Marker", Signal::Trigger, false},  {"position", "Position", Signal::Control, false}};
    s.buttons = {{"clear", "Clear"}, {"arm", "Arm"}, {"hold", "Hold Paper"}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ChartRecorderModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerChartRecorderModule);

}  // namespace bleep::engine
