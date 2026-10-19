// SPDX-License-Identifier: GPL-3.0-or-later
// Delay Net node (doc/specs/modules/delay-network.md): up to eight delay lines
// feeding each other through a routing matrix. Freeze latches in the node's
// data (ORed with the gate), Clear is a view button and a trigger input.
#include "DelayNetworkDsp.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <cmath>

namespace bleep::engine {
namespace {

using patch::DelayNetworkDsp;

constexpr int kFirstSync = 2, kLastSync = 18;  // noteValues(): "4 bars" … "1/16T"

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    const juce::var v = in.getProperty("freezeLatched", false);
    out->setProperty("freezeLatched", v.isBool() || v.isInt() || v.isDouble() ? (bool)v : false);
    return juce::JSON::toString(result, true).toStdString();
}

class DelayNetworkModule final : public Module {
public:
    enum { Time, Taps, Scatter, Jitter, Reverse, Feedback, Character, Tone, Width, Mix, Routing, Sync, TimeChange, ClearOnPlay, Seed };
    enum { InL, InR, Clock, Freeze, Clear };
    enum { OutL, OutR, WetL, WetR, Tap1, Tap2, Tap3, Tap4, Pulse };
    enum { ClearButton };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        freezeLatched_.store((bool)juce::JSON::parse(juce::String(json)).getProperty("freezeLatched", false));
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"taps", (double)active_.load()});
        out.push_back({"freeze", frozen_.load() ? 1.0 : 0.0});
        out.push_back({"time", time_.load()});
    }
    /// "taps": per line [seconds, level, reversed, pan, peak] × 8.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> v;
        v.reserve(patch::dnet::kLines * 5);
        for (int i = 0; i < patch::dnet::kLines; ++i)
            for (int k = 0; k < 5; ++k) v.push_back(view_[i * 5 + k].load(std::memory_order_relaxed));
        out.push_back({"taps", std::move(v)});
    }

    void process(const ProcessContext& c) override {
        bool clear = false;
        pollCommands([&](const Command& cmd) {
            if (cmd.index == ClearButton && cmd.value > 0.5f) clear = true;
        });
        const Transport& tr = *c.transport;
        const uint32_t seed = (uint32_t)setting(Seed);
        if (c.transportStarted) {
            if (setting(ClearOnPlay) >= 0.5f) dsp_.clear();
            dsp_.restart(seed);
        }
        if (clear) dsp_.requestClear();
        patch::DelayNetworkParams p;
        p.routing = (int)setting(Routing);
        p.tape = setting(TimeChange) < 0.5f;
        p.seed = seed;
        p.bpm = tr.bpm;
        p.clockPatched = c.inputConnected[Clock];
        const int sync = (int)setting(Sync);
        p.syncBeats = sync > 0 ? dsp::noteValueBeats(kFirstSync + sync - 1) : 0.0;
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        const bool latched = freezeLatched_.load();
        patch::DelayNetworkFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.timeSeconds = value(c, Time, i);
            p.timeKnob = c.params[Time][i];
            p.taps = value(c, Taps, i);
            p.scatter = value(c, Scatter, i);
            p.jitter = value(c, Jitter, i);
            p.reverse = value(c, Reverse, i);
            p.feedback = value(c, Feedback, i);
            p.character = value(c, Character, i);
            p.tone = value(c, Tone, i);
            p.width = value(c, Width, i);
            p.mix = value(c, Mix, i);
            p.freeze = latched || c.inputs[Freeze][i] >= 0.5f;
            const bool edge = c.inputs[Clear][i] >= 0.5f;
            if (edge && !clearHigh_) dsp_.requestClear();
            clearHigh_ = edge;
            dsp_.tick(p, c.inputs[InL][i], inR[i], c.inputs[Clock][i], f);
            c.outputs[OutL][i] = f.outL;
            c.outputs[OutR][i] = f.outR;
            c.outputs[WetL][i] = f.wetL;
            c.outputs[WetR][i] = f.wetR;
            for (int k = 0; k < 4; ++k) c.outputs[Tap1 + k][i] = f.tap[(size_t)k];
            c.outputs[Pulse][i] = f.pulse;
        }
        active_.store(dsp_.activeTaps());
        frozen_.store(p.freeze);
        time_.store(dsp_.timeSamples(p) / sampleRate_);
        for (int i = 0; i < patch::dnet::kLines; ++i) {
            const float peak = dsp_.tapPeak(i);
            auto& pk = view_[i * 5 + 4];
            pk.store(std::max(peak, pk.load(std::memory_order_relaxed) * 0.97f), std::memory_order_relaxed);
            view_[i * 5 + 0].store((float)dsp_.tapSeconds(i), std::memory_order_relaxed);
            view_[i * 5 + 1].store(dsp_.tapLevel(i), std::memory_order_relaxed);
            view_[i * 5 + 2].store(dsp_.tapReversed(i) ? 1.0f : 0.0f, std::memory_order_relaxed);
            view_[i * 5 + 3].store(patch::dnet::tapPan(i, p.width), std::memory_order_relaxed);
        }
    }

private:
    DelayNetworkDsp dsp_;
    std::atomic<bool> freezeLatched_{false}, frozen_{false};
    std::atomic<int> active_{4};
    std::atomic<double> time_{0.6};
    std::atomic<float> view_[patch::dnet::kLines * 5] = {};
    bool clearHigh_ = false;
};

}  // namespace

static void registerDelayNetworkModule(Registry& r) {
    ModuleSpec s;
    s.type = "delay-network";
    s.name = "Delay Net";
    s.category = "Effects/Space & Time";
    s.colour = "#0ea5e9";
    s.description = "Up to eight delay lines feeding each other: scattered, jittered and reversed taps, a character in "
                    "every feedback pass, and Parallel, Chain, Ring or Mesh routing.";
    std::vector<std::string> sync{"Free"};
    for (int i = kFirstSync; i <= kLastSync; ++i) sync.emplace_back(dsp::noteValues()[(size_t)i].name);
    s.params = {ParamSpec::seconds("time", "Time", 0.005f, 8.0f, 0.6f, 0.6f),
                ParamSpec::number("taps", "Taps", 1.0f, 8.0f, 4.0f, "", 2),
                ParamSpec::number("scatter", "Scatter", -1.0f, 1.0f, 0.0f, "", 2),
                ParamSpec::percent("jitter", "Jitter", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("reverse", "Reverse", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("feedback", "Feedback", 0.0f, 2.0f, 0.45f),
                ParamSpec::percent("character", "Character", 0.0f, 1.0f, 0.2f).inGroup("Repeats"),
                ParamSpec::number("tone", "Tone", -1.0f, 1.0f, 0.0f, "", 2).inGroup("Repeats"),
                ParamSpec::percent("width", "Width", 0.0f, 1.0f, 0.7f).inGroup("Repeats"),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 0.4f),
                ParamSpec::choice("routing", "Routing", {"Parallel", "Chain", "Ring", "Mesh"}, 2),
                ParamSpec::choice("sync", "Sync", sync, 0),
                ParamSpec::choice("timechange", "Time Change", {"Tape", "Crossfade"}, 1),
                ParamSpec::toggle("clearonplay", "Clear on Play", false),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"l", "In L", Signal::Audio},
                {"r", "In R", Signal::Audio},
                {"clock", "Clock", Signal::Trigger},
                {"freeze", "Freeze", Signal::Gate},
                {"clear", "Clear", Signal::Trigger}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},       {"r", "Out R", Signal::Audio, true},
                 {"wetl", "Wet L", Signal::Audio, true},    {"wetr", "Wet R", Signal::Audio, true},
                 {"tap1", "Tap 1", Signal::Audio, true},    {"tap2", "Tap 2", Signal::Audio, true},
                 {"tap3", "Tap 3", Signal::Audio, true},    {"tap4", "Tap 4", Signal::Audio, true},
                 {"pulse", "Pulse", Signal::Trigger, false}};
    s.buttons = {{"clear", "Clear"}};
    s.memoryHeavy = true;
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<DelayNetworkModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerDelayNetworkModule);

}  // namespace bleep::engine
