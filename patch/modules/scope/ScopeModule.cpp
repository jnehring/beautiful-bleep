// SPDX-License-Identifier: GPL-3.0-or-later
// Scope node (doc/specs/modules/scope.md): two to four signals drawn over time,
// started by a trigger, with cursors for measuring in the view. What it
// measures on one trace comes out as signals: Amplitude, Frequency and Valid.
//
// The audio thread publishes a finished (or, for slow sweeps, growing) frame
// into atomics under a sequence counter; liveArrays copies it when the counter
// says it is new and unchanged while it was read.
#include "Registry.h"
#include "ScopeDsp.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using namespace patch;

constexpr size_t kFrameSize = (size_t)kScopeTraces * kScopeColumns * 2;

/// Cursor positions live in the node's data: time in divisions (0..10), level in divisions (-4..4).
std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    auto num = [&](const char* key, double lo, double hi, double def) {
        const juce::var v = in[juce::Identifier(key)];
        const double x = (v.isInt() || v.isInt64() || v.isDouble()) ? (double)v : def;
        out->setProperty(juce::Identifier(key), std::clamp(x, lo, hi));
    };
    num("t1", 0.0, 10.0, 3.0);
    num("t2", 0.0, 10.0, 7.0);
    num("v1", -4.0, 4.0, 2.0);
    num("v2", -4.0, 4.0, -2.0);
    return juce::JSON::toString(result, true).toStdString();
}

class ScopeModule final : public Module {
public:
    enum { Timebase, Level, Edge, Source, Mode, Hold, Measure, Channels };  // the trace knobs follow; the view reads them
    enum { Amp = 4, Freq, Valid };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"freq", (double)freq_.load(std::memory_order_relaxed)});
        out.push_back({"amp", (double)amp_.load(std::memory_order_relaxed)});
        out.push_back({"valid", valid_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
        out.push_back({"trig", trig_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
    }

    /// "frame": [sweep seconds, write column (-1 = whole), columns, traces, min/max pairs ...] once per new frame,
    /// else empty.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> f;
        const uint32_t s1 = seq_.load(std::memory_order_acquire);
        if (s1 != lastSent_ && (s1 & 1u) == 0) {
            f.resize(4 + kFrameSize);
            f[0] = sweep_.load(std::memory_order_relaxed);
            f[1] = (float)writeCol_.load(std::memory_order_relaxed);
            f[2] = (float)kScopeColumns;
            f[3] = (float)kScopeTraces;
            for (size_t i = 0; i < kFrameSize; ++i) f[4 + i] = shown_[i].load(std::memory_order_relaxed);
            std::atomic_thread_fence(std::memory_order_acquire);
            if (seq_.load(std::memory_order_relaxed) != s1) f.clear();
            else lastSent_ = s1;
        }
        out.push_back({"frame", std::move(f)});
    }

    void process(const ProcessContext& c) override {
        ScopeParams p;
        p.channels = (int)setting(Channels);
        p.timeDiv = value(c, Timebase, 0) * 0.001f;
        p.level = value(c, Level, 0);
        p.edge = (int)setting(Edge);
        p.source = std::min((int)setting(Source), p.channels - 1);
        p.mode = (int)setting(Mode);
        p.hold = setting(Hold) > 0.5f;
        p.measure = std::min((int)setting(Measure), p.channels - 1);
        float in[kScopeTraces] = {};
        for (int i = 0; i < c.numSamples; ++i) {
            for (int t = 0; t < p.channels; ++t) {
                in[t] = c.inputs[t][i];
                c.outputs[t][i] = in[t];
            }
            dsp_.tick(p, in);
            c.outputs[Amp][i] = dsp_.amplitude();
            c.outputs[Freq][i] = scopeHzToPitch(dsp_.frequency());
            c.outputs[Valid][i] = dsp_.valid() ? 1.0f : 0.0f;
        }
        for (int t = p.channels; t < kScopeTraces; ++t)
            if (c.outputs[t]) std::fill(c.outputs[t], c.outputs[t] + c.numSamples, 0.0f);
        if (dsp_.published() != published_) {
            published_ = dsp_.published();
            seq_.fetch_add(1, std::memory_order_release);  // odd: being written
            const ScopeFrame& f = dsp_.frame();
            for (size_t i = 0; i < kFrameSize; ++i) shown_[i].store(f[i], std::memory_order_relaxed);
            sweep_.store((float)dsp_.sweepSeconds(), std::memory_order_relaxed);
            writeCol_.store(dsp_.writeColumn(), std::memory_order_relaxed);
            seq_.fetch_add(1, std::memory_order_release);
        }
        freq_.store(dsp_.frequency(), std::memory_order_relaxed);
        amp_.store(dsp_.amplitude(), std::memory_order_relaxed);
        valid_.store(dsp_.valid(), std::memory_order_relaxed);
        trig_.store(dsp_.triggered(), std::memory_order_relaxed);
    }

private:
    ScopeDsp dsp_;
    uint32_t published_ = 0;
    mutable uint32_t lastSent_ = 0;
    std::atomic<uint32_t> seq_{0};
    std::array<std::atomic<float>, kFrameSize> shown_{};
    std::atomic<float> sweep_{0.01f}, freq_{0.0f}, amp_{0.0f};
    std::atomic<int> writeCol_{-1};
    std::atomic<bool> valid_{false}, trig_{false};
};

}  // namespace

static void registerScopeModule(Registry& r) {
    ModuleSpec s;
    s.type = "scope";
    s.name = "Scope";
    s.category = "Utility/Metering";
    s.colour = "#5eead4";
    s.description = "Two to four signals over time on a triggered display with cursors; the amplitude and frequency of one "
                    "trace come out as signals.";
    auto timebase = ParamSpec::exponential("timebase", "Time / Div", 0.05f, 1000.0f, 1.0f, "ms");  // milliseconds: the knob reads 0.05 ms … 1000 ms
    timebase.decimals = 2;
    static const char* const kColours[8] = {"Mint", "Amber", "Sky", "Rose", "Lime", "Violet", "White", "Orange"};
    std::vector<std::string> colours(kColours, kColours + 8);
    s.params = {timebase.inGroup("Time"),
                ParamSpec::number("level", "Trigger Level", -2.0f, 2.0f, 0.0f, "", 2).inGroup("Trigger"),
                ParamSpec::choice("edge", "Edge", {"Rising", "Falling", "Either"}, 0).inGroup("Trigger"),
                ParamSpec::choice("source", "Source", {"Trace 1", "Trace 2", "Trace 3", "Trace 4"}, 0).inGroup("Trigger"),
                ParamSpec::choice("mode", "Mode", {"Auto", "Normal", "Free Run"}, 0).inGroup("Trigger"),
                ParamSpec::toggle("hold", "Hold", false).inGroup("Time"),
                ParamSpec::choice("measure", "Measure", {"Trace 1", "Trace 2", "Trace 3", "Trace 4"}, 0).inGroup("Outputs"),
                ParamSpec::steppedInt("channels", "Traces", 2, 4, 2).inGroup("Time"),
                ParamSpec::toggle("cursors", "Cursors", true).inGroup("Time")};
    for (int t = 0; t < kScopeTraces; ++t) {
        const std::string n = std::to_string(t + 1), group = "Trace " + n;
        auto scale = ParamSpec::exponential("scale" + n, "Scale " + n, 0.05f, 20.0f, 1.0f, "×");
        scale.decimals = 2;
        auto add = [&](ParamSpec p) {
            p = p.inGroup(group);
            s.params.push_back(t >= 2 ? p.when("channels", t + 1, 4) : p);
        };
        add(scale);
        add(ParamSpec::number("pos" + n, "Position " + n, -4.0f, 4.0f, 0.0f, "div", 1));
        add(ParamSpec::choice("colour" + n, "Colour " + n, colours, t == 0 ? 0 : t == 1 ? 1 : t == 2 ? 2 : 3));
    }
    s.inputs = {{"in1", "In 1", Signal::Audio},
                {"in2", "In 2", Signal::Audio},
                JackSpec{"in3", "In 3", Signal::Audio}.when("channels", 3, 4),
                JackSpec{"in4", "In 4", Signal::Audio}.when("channels", 4, 4)};
    s.outputs = {{"out1", "Out 1", Signal::Audio, true},
                 {"out2", "Out 2", Signal::Audio, true},
                 JackSpec{"out3", "Out 3", Signal::Audio, true}.when("channels", 3, 4),
                 JackSpec{"out4", "Out 4", Signal::Audio, true}.when("channels", 4, 4),
                 {"amp", "Amplitude", Signal::Control, false},
                 {"freq", "Frequency", Signal::Pitch, true},
                 {"valid", "Valid", Signal::Gate, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ScopeModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerScopeModule);

}  // namespace bleep::engine
