// SPDX-License-Identifier: MIT
// Shift Register node (specs/modules/shift-register.md): a looping register of
// bits. The start pattern and the Combo mask live in the node's data; the view
// loads the pattern or toggles live bits through Module::command.
#include "Registry.h"
#include "ShiftRegisterDsp.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::ShiftRegisterDsp;

constexpr int kDefaultCombo = 9;  // Bits 1 and 4

/// A new module's start pattern: hash3(1, 0, 7) masked to 16 bits, never 0
/// (the default Seed; sanitiseData can't see the knobs).
int defaultStart() {
    const int v = (int)(dsp::hash3(1, 0, 7) & 0xffffu);
    return v == 0 ? 1 : v;
}

void parseData(const juce::var& in, int& start, int& combo) {
    auto number = [](const juce::var& v, int def) {
        return v.isInt() || v.isInt64() || v.isDouble() ? (int)(int64_t)(double)v : def;
    };
    start = number(in.getProperty("start", juce::var()), defaultStart()) & 0xffff;
    combo = number(in.getProperty("combo", juce::var()), kDefaultCombo) & 0xff;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    int start = 0, combo = 0;
    parseData(in, start, combo);
    auto* o = new juce::DynamicObject();
    juce::var out(o);
    o->setProperty("start", start);
    o->setProperty("combo", combo);
    return juce::JSON::toString(out, true).toStdString();
}

class ShiftRegisterModule final : public Module {
public:
    enum { Lock, Rate, Level, GateLength, W1, W2, W3, W4, W5, W6, Length, Sync, Source, Combine, Octaves, Root, Scale, Seed };
    enum { Clock, Reset, Data, Transpose };
    enum { Voltage, Pitch, Bit1, Combo = Bit1 + 8, Mix, Step, Loop };
    enum CommandIndex { LoadCommand, ToggleCommand };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        int start = 0, combo = 0;
        parseData(juce::JSON::parse(juce::String(json)), start, combo);
        start_.store(start);
        combo_.store(combo);
    }

    /// From the view: "load" (start pattern into the running register) and
    /// "toggle" (value = live bit index, 0 = Bit 1). Neither is an undo step.
    void command(const std::string& id, float value) override {
        if (id == "load") postCommand(LoadCommand, 0.0f);
        else if (id == "toggle") postCommand(ToggleCommand, value);
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"bits", (double)bits_.load()});
        out.push_back({"k", (double)k_.load()});
        out.push_back({"flips", (double)(flipTrail_.load() & 0xffffu)});
    }
    /// The last 32 values of Voltage (0..1, newest last) and whether the bit
    /// entering at each of those steps was flipped.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        const uint64_t trail = trail_.load(), flips = flipTrail_.load();
        std::vector<float> history(32), flipped(32);
        for (int j = 0; j < 32; ++j) {
            int n = 0;
            for (int i = 0; i < 8; ++i) n |= (int)((trail >> (i + j)) & 1u) << (7 - i);
            history[(size_t)(31 - j)] = (float)n / 255.0f;
            flipped[(size_t)(31 - j)] = (float)((flips >> j) & 1u);
        }
        out.push_back({"history", std::move(history)});
        out.push_back({"flipped", std::move(flipped)});
    }

    void process(const ProcessContext& c) override {
        patch::ShiftRegisterParams p;
        p.sync = (int)setting(Sync);
        p.source = (patch::SrSource)std::clamp((int)setting(Source), 0, 2);
        p.combine = (patch::SrCombine)std::clamp((int)setting(Combine), 0, 2);
        p.octaves = (int)setting(Octaves);
        p.root = (int)setting(Root);
        p.scale = dsp::scales()[(size_t)std::clamp((int)setting(Scale), 0, (int)dsp::scales().size() - 1)].mask;
        p.seed = (uint32_t)setting(Seed);
        p.start = (uint16_t)start_.load(std::memory_order_relaxed);
        p.combo = (uint8_t)combo_.load(std::memory_order_relaxed);
        pollCommands([&](const Command& cmd) {
            if (cmd.index == LoadCommand) dsp_.load(p.start);
            else if (cmd.index == ToggleCommand) dsp_.toggle((int)std::lround(cmd.value));
        });
        patch::ShiftRegisterInput in;
        in.clockPatched = c.inputConnected[Clock];
        in.running = c.transport->playing && c.transport->ppqValid;
        in.bpm = c.transport->bpm;
        patch::ShiftRegisterFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.lock = cachedValue(c, Lock, i);
            p.rateHz = cachedValue(c, Rate, i);
            p.level = cachedValue(c, Level, i);
            p.gateLength = cachedValue(c, GateLength, i);
            for (int w = 0; w < 6; ++w) p.weight[(size_t)w] = cachedValue(c, W1 + w, i);
            p.length = (int)cachedValue(c, Length, i);
            in.clock = c.inputs[Clock][i];
            in.reset = c.inputs[Reset][i];
            in.data = c.inputs[Data][i];
            in.transpose = c.inputs[Transpose][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, f);
            c.outputs[Voltage][i] = f.voltage;
            c.outputs[Pitch][i] = f.pitch;
            for (int b = 0; b < 8; ++b) c.outputs[Bit1 + b][i] = f.bit[(size_t)b];
            c.outputs[Combo][i] = f.combo;
            c.outputs[Mix][i] = f.mix;
            c.outputs[Step][i] = f.step;
            c.outputs[Loop][i] = f.loop;
        }
        bits_.store(dsp_.reg());
        k_.store(dsp_.stepIndex());
        trail_.store(dsp_.trail());
        flipTrail_.store(dsp_.flipTrail());
    }

private:
    /// value(), recomputed only when the knob moves (fromNormalised may cost a pow).
    float cachedValue(const ProcessContext& c, int k, int s) noexcept {
        const float n = c.params[k][s];
        if (n != knobNorm_[(size_t)k]) {
            knobNorm_[(size_t)k] = n;
            knobUnits_[(size_t)k] = value(c, k, s);
        }
        return knobUnits_[(size_t)k];
    }

    ShiftRegisterDsp dsp_;
    std::atomic<int> start_{defaultStart()}, combo_{kDefaultCombo};
    std::atomic<uint32_t> bits_{0};
    std::atomic<int64_t> k_{0};
    std::atomic<uint64_t> trail_{0}, flipTrail_{0};
    std::array<float, 32> knobNorm_ = [] {
        std::array<float, 32> a;
        a.fill(-1.0f);
        return a;
    }();
    std::array<float, 32> knobUnits_{};
};

}  // namespace

void registerShiftRegisterModule(Registry& r) {
    ModuleSpec s;
    s.type = "shift-register";
    s.name = "Shift Register";
    s.category = "Sequencing";
    s.colour = "#dc2626";
    s.description = "A looping register of bits. Lock moves from frozen through mutating to random; "
                    "the outputs echo the pattern canon-like.";
    std::vector<std::string> sync, roots, scales;
    for (const char* n : dsp::syncNames()) sync.emplace_back(n);
    for (const char* n : {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}) roots.emplace_back(n);
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    s.params = {ParamSpec::percent("lock", "Lock", -1.0f, 1.0f, 0.8f),
                ParamSpec::hertz("rate", "Rate", 0.05f, 50.0f, 4.0f).when("sync", 0, 0),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("gatelength", "Gate Length", 0.01f, 1.0f, 0.5f)};
    const float weights[6] = {1.0f, 0.5f, 0.25f, 0.125f, 0.0f, 0.0f};
    for (int w = 0; w < 6; ++w)
        s.params.push_back(ParamSpec::number("w" + std::to_string(w + 1), "Weight " + std::to_string(w + 1), -1.0f, 1.0f,
                                             weights[w]).inGroup("Mixer"));
    s.params.push_back(ParamSpec::steppedInt("length", "Length", 2, 16, 8));
    s.params.push_back(ParamSpec::choice("sync", "Sync", sync, 2));
    s.params.push_back(ParamSpec::choice("source", "Source", {"Loop", "Data", "Data \xe2\x8a\x95 Loop"}, 0));
    s.params.push_back(ParamSpec::choice("combine", "Combine", {"Any", "All", "Odd"}, 0));
    s.params.push_back(ParamSpec::integer("octaves", "Octaves", 1, 4, 2));
    s.params.push_back(ParamSpec::choice("root", "Root", roots, 0));
    s.params.push_back(ParamSpec::choice("scale", "Scale", scales, 12));
    s.params.push_back(ParamSpec::integer("seed", "Seed", 0, 999, 1));
    s.inputs = {{"clock", "Clock", Signal::Trigger}, {"reset", "Reset", Signal::Trigger}, {"data", "Data", Signal::Gate},
                {"transpose", "Transpose", Signal::Pitch}};
    s.outputs = {{"voltage", "Voltage", Signal::Control, false}, {"pitch", "Pitch", Signal::Pitch, true}};
    for (int b = 1; b <= 8; ++b) s.outputs.push_back({"bit" + std::to_string(b), "Bit " + std::to_string(b), Signal::Gate, false});
    s.outputs.push_back({"combo", "Combo", Signal::Gate, false});
    s.outputs.push_back({"mix", "Mix", Signal::Control, true});
    s.outputs.push_back({"step", "Step", Signal::Trigger, false});
    s.outputs.push_back({"loop", "Loop", Signal::Trigger, false});
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ShiftRegisterModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerShiftRegisterModule);

}  // namespace bleep::engine
