// SPDX-License-Identifier: GPL-3.0-or-later
// Recall node (doc/specs/modules/recall.md): random gates and voltages that can
// repeat their own recent past. Captured loops live in the node's data; the
// Capture buttons snapshot a ring on the audio thread and the view writes it
// into the data (with "use" on).
#include "Handoff.h"
#include "RecallDsp.h"
#include "Registry.h"
#include "dsp/SeqClock.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <memory>

namespace bleep::engine {
namespace {

using patch::kRecallSlots;
using patch::kRecallT;
using patch::kRecallX;
using patch::RecallCapture;
using patch::RecallCaptures;
using patch::RecallDsp;

/// One section's data: {"use": bool, "loop": [[n, …], …]} with up to 16 rows of
/// up to `width` numbers in [0, 1). Short rows are padded at run time.
RecallCapture parseSection(const juce::var& in, int width) {
    RecallCapture c;
    c.use = (bool)in.getProperty("use", false);
    if (const auto* rows = in["loop"].getArray()) {
        c.length = std::min(kRecallSlots, rows->size());
        for (int s = 0; s < c.length; ++s) {
            const auto* row = (*rows)[s].getArray();
            if (!row) continue;
            int n = 0;
            for (int j = 0; j < std::min(width, row->size()); ++j) {
                const juce::var v = (*row)[j];
                if (!(v.isDouble() || v.isInt() || v.isInt64())) break;
                const double x = (double)v;
                c.values[(size_t)s][(size_t)j] = (float)std::clamp(std::isfinite(x) ? x : 0.0, 0.0, 0.999999);
                n = j + 1;
            }
            c.count[(size_t)s] = (uint8_t)n;
        }
    }
    return c;
}

juce::var sectionJson(const RecallCapture& c) {
    auto* o = new juce::DynamicObject();
    juce::var v(o);
    o->setProperty("use", c.use);
    juce::Array<juce::var> rows;
    for (int s = 0; s < c.length; ++s) {
        juce::Array<juce::var> row;
        for (int j = 0; j < c.count[(size_t)s]; ++j) row.add((double)c.values[(size_t)s][(size_t)j]);
        rows.add(row);
    }
    o->setProperty("loop", rows);
    return v;
}

RecallCaptures parseData(const juce::var& in) {
    return {parseSection(in["t"], kRecallT), parseSection(in["x"], kRecallX)};
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const RecallCaptures c = parseData(in);
    auto* o = new juce::DynamicObject();
    juce::var out(o);
    o->setProperty("t", sectionJson(c.t));
    o->setProperty("x", sectionJson(c.x));
    return juce::JSON::toString(out, true).toStdString();
}

class RecallModule final : public Module {
public:
    enum { TBias, TJitter, TRecall, GateLength, XSpread, XBias, XSteps, XRecall, Rate,
           Sync, TMode, TLoop, XSource, XMode, XRange, XLoop, Root, Scale, Seed, SyncTo };
    enum { Clock, Reset, XClock };
    enum { T1, T2, ClockOut, X1, X2, X3, XTrig };
    enum { CaptureT, CaptureX };  // buttons

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        captured_.publish(std::make_shared<const RecallCaptures>(parseData(juce::JSON::parse(juce::String(json)))));
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"tick", (double)tick_.load()});
        out.push_back({"tCaptures", (double)captures_[0].load(std::memory_order_acquire)});
        out.push_back({"xCaptures", (double)captures_[1].load(std::memory_order_acquire)});
        out.push_back({"tCaptureLength", (double)captureLength_[0].load()});
        out.push_back({"xCaptureLength", (double)captureLength_[1].load()});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> lanes(16);
        for (int i = 0; i < 16; ++i) lanes[(size_t)i] = lanes_[(size_t)i].load(std::memory_order_relaxed);
        out.push_back({"lanes", std::move(lanes)});
        for (int k = 0; k < 3; ++k) {
            std::vector<float> d(32);
            for (int i = 0; i < 32; ++i) d[(size_t)i] = draws_[(size_t)k][(size_t)i].load(std::memory_order_relaxed);
            out.push_back({"x" + std::to_string(k + 1), std::move(d)});
        }
        // The last captured rings, flattened (row-major, 4 or 9 numbers per slot).
        const int widths[2] = {kRecallT, kRecallX};
        const char* names[2] = {"tCapture", "xCapture"};
        for (int s = 0; s < 2; ++s) {
            const int len = captureLength_[(size_t)s].load(std::memory_order_acquire);
            std::vector<float> v((size_t)(len * widths[s]));
            for (int r = 0; r < len; ++r)
                for (int j = 0; j < widths[s]; ++j)
                    v[(size_t)(r * widths[s] + j)] = capture_[(size_t)s][(size_t)r][(size_t)j].load(std::memory_order_relaxed);
            out.push_back({names[s], std::move(v)});
        }
    }

    void process(const ProcessContext& c) override {
        patch::RecallParams p;
        p.sync = (int)setting(Sync);
        p.tMode = (patch::RecallTMode)std::clamp((int)setting(TMode), 0, 3);
        p.tLoop = (int)setting(TLoop);
        p.xSource = (patch::RecallXSource)std::clamp((int)setting(XSource), 0, 3);
        p.sorted = setting(XMode) >= 0.5f;
        p.xRange = (patch::RecallXRange)std::clamp((int)setting(XRange), 0, 2);
        p.xLoop = (int)setting(XLoop);
        p.root = (int)setting(Root);
        p.scale = dsp::scales()[(size_t)std::clamp((int)setting(Scale), 0, (int)dsp::scales().size() - 1)].mask;
        p.seed = (uint32_t)setting(Seed);
        p.captured = captured_.get();
        pollCommands([&](const Command& cmd) {
            if (cmd.value < 0.5f) return;
            const int s = cmd.index == CaptureT ? 0 : 1;
            if (s == 0) dsp_.captureT(p);
            else dsp_.captureX(p);
            publishCapture(s, s == 0 ? dsp_.tSnapshot() : dsp_.xSnapshot(), s == 0 ? kRecallT : kRecallX);
        });
        patch::RecallInput in;
        in.clockPatched = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        in.xClockPatched = c.inputConnected[XClock];
        in.running = c.transport->playing && c.transport->ppqValid;
        in.bpm = c.transport->bpm;
        patch::RecallFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.tBias = cachedValue(c, TBias, i);
            p.tJitter = cachedValue(c, TJitter, i);
            p.tRecall = cachedValue(c, TRecall, i);
            p.gateLength = cachedValue(c, GateLength, i);
            p.xSpread = cachedValue(c, XSpread, i);
            p.xBias = cachedValue(c, XBias, i);
            p.xSteps = cachedValue(c, XSteps, i);
            p.xRecall = cachedValue(c, XRecall, i);
            p.rateHz = cachedValue(c, Rate, i);
            in.clock = c.inputs[Clock][i];
            in.reset = c.inputs[Reset][i];
            in.xClock = c.inputs[XClock][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, f);
            c.outputs[T1][i] = f.t1;
            c.outputs[T2][i] = f.t2;
            c.outputs[ClockOut][i] = f.clock;
            c.outputs[X1][i] = f.x[0];
            c.outputs[X2][i] = f.x[1];
            c.outputs[X3][i] = f.x[2];
            c.outputs[XTrig][i] = f.xTrig;
        }
        tick_.store(dsp_.tickIndex(), std::memory_order_relaxed);
        const auto lanes = dsp_.lanes();
        for (int i = 0; i < 16; ++i) lanes_[(size_t)i].store((float)lanes[(size_t)i], std::memory_order_relaxed);
        for (int k = 0; k < 3; ++k)
            for (int i = 0; i < 32; ++i) draws_[(size_t)k][(size_t)i].store(dsp_.draw(k, i), std::memory_order_relaxed);
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

    void publishCapture(int s, const RecallDsp::Snapshot& snap, int width) noexcept {
        for (int r = 0; r < snap.length; ++r)
            for (int j = 0; j < width; ++j)
                capture_[(size_t)s][(size_t)r][(size_t)j].store(snap.values[(size_t)r][(size_t)j], std::memory_order_relaxed);
        captureLength_[(size_t)s].store(snap.length, std::memory_order_release);
        captures_[(size_t)s].fetch_add(1, std::memory_order_release);
    }

    RecallDsp dsp_;
    RtHandoff<RecallCaptures> captured_;
    std::atomic<int64_t> tick_{0};
    std::array<std::atomic<float>, 16> lanes_{};
    std::array<std::array<std::atomic<float>, 32>, 3> draws_{};
    std::array<std::array<std::array<std::atomic<float>, kRecallX>, kRecallSlots>, 2> capture_{};
    std::array<std::atomic<int>, 2> captureLength_{};
    std::array<std::atomic<uint32_t>, 2> captures_{};
    std::array<float, 32> knobNorm_ = [] {
        std::array<float, 32> a;
        a.fill(-1.0f);
        return a;
    }();
    std::array<float, 32> knobUnits_{};
};

}  // namespace

static void registerRecallModule(Registry& r) {
    ModuleSpec s;
    s.type = "recall";
    s.name = "Recall";
    s.category = "Sequencing/Generative";
    s.colour = "#e11d48";
    s.description = "Random gates (T) and random voltages (X) on one clock. Recall repeats the recent past, "
                    "up to a locked loop you can capture.";
    std::vector<std::string> sync, roots, scales;
    for (int i = 0; i < RecallDsp::numSyncs(); ++i) sync.emplace_back(RecallDsp::syncName(i));
    for (const char* n : {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}) roots.emplace_back(n);
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    s.params = {ParamSpec::percent("tbias", "T Bias", 0.0f, 1.0f, 0.5f).inGroup("T"),
                ParamSpec::percent("tjitter", "T Jitter", 0.0f, 1.0f, 0.0f).inGroup("T"),
                ParamSpec::percent("trecall", "T Recall", 0.0f, 1.0f, 0.0f).inGroup("T"),
                ParamSpec::percent("gatelength", "Gate Length", 0.01f, 1.0f, 0.5f).inGroup("T"),
                ParamSpec::percent("xspread", "X Spread", 0.0f, 1.0f, 0.6f).inGroup("X"),
                ParamSpec::percent("xbias", "X Bias", 0.0f, 1.0f, 0.5f).inGroup("X"),
                ParamSpec::percent("xsteps", "X Steps", 0.0f, 1.0f, 0.5f).inGroup("X"),
                ParamSpec::percent("xrecall", "X Recall", 0.0f, 1.0f, 0.0f).inGroup("X"),
                ParamSpec::hertz("rate", "Rate", 0.1f, 40.0f, 4.0f).when("sync", 0, 0),
                ParamSpec::choice("sync", "Sync", sync, 11),
                ParamSpec::choice("tmode", "T Mode", {"Coin", "Chance", "Ratchet", "Drums"}, 0),
                ParamSpec::steppedInt("tloop", "T Loop", 1, 16, 8),
                ParamSpec::choice("xsource", "X Source", {"Tick", "T1", "T2", "External"}, 0),
                ParamSpec::choice("xmode", "X Mode", {"Independent", "Sorted"}, 0),
                ParamSpec::choice("xrange", "X Range", {"Bipolar", "Unipolar", "Wide"}, 0),
                ParamSpec::steppedInt("xloop", "X Loop", 1, 16, 8),
                ParamSpec::choice("root", "Root", roots, 0),
                ParamSpec::choice("scale", "Scale", scales, 1),
                ParamSpec::integer("seed", "Seed", 0, 999, 1),
                ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto)};
    s.inputs = {{"clock", "Clock", Signal::Trigger}, {"reset", "Reset", Signal::Trigger}, {"xclock", "X Clock", Signal::Trigger}};
    s.outputs = {{"t1", "T1", Signal::Gate, false},         {"t2", "T2", Signal::Gate, false},
                 {"clock", "Clock", Signal::Trigger, false}, {"x1", "X1", Signal::Control, true},
                 {"x2", "X2", Signal::Control, true},       {"x3", "X3", Signal::Control, true},
                 {"xtrig", "X Trig", Signal::Trigger, false}};
    s.buttons = {{"captureT", "Capture T"}, {"captureX", "Capture X"}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<RecallModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerRecallModule);

}  // namespace bleep::engine
