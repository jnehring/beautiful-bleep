// SPDX-License-Identifier: MIT
// Neuron node (specs/modules/neuron.md): two integrate-and-fire neurons with
// cross-feedback normals and logic outputs.
#include "NeuronDsp.h"
#include "Registry.h"

#include <algorithm>
#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::NeuronDsp;

/// The last 2 seconds of a signal in kPoints points, for the view: written by
/// the audio thread, read by liveArrays (relaxed atomics, a torn frame is harmless).
class Trace {
public:
    static constexpr int kPoints = 128;
    void prepare(double sampleRate, double seconds) noexcept {
        every_ = std::max(1, (int)(sampleRate * seconds / kPoints));
        count_ = 0;
        peak_ = 0.0f;
    }
    /// `peak`: keep the largest value of each point (so 1-sample spikes show).
    void push(float x, bool peak = false) noexcept {
        peak_ = count_ == 0 || !peak ? x : std::max(peak_, x);
        if (++count_ < every_) return;
        count_ = 0;
        const int w = write_.load(std::memory_order_relaxed);
        v_[(size_t)w].store(peak_, std::memory_order_relaxed);
        write_.store((w + 1) % kPoints, std::memory_order_relaxed);
    }
    std::vector<float> ordered() const {
        std::vector<float> out((size_t)kPoints);
        const int w = write_.load(std::memory_order_relaxed);
        for (int i = 0; i < kPoints; ++i) out[(size_t)i] = v_[(size_t)((w + i) % kPoints)].load(std::memory_order_relaxed);
        return out;
    }

private:
    std::array<std::atomic<float>, kPoints> v_{};
    std::atomic<int> write_{0};
    int every_ = 750, count_ = 0;
    float peak_ = 0.0f;
};

class NeuronModule final : public Module {
public:
    // Per neuron: W1, W2, W3, Threshold, Hysteresis, Leak, Sharp, Pulse (A first, then B).
    enum { W1, W2, W3, Threshold, Hysteresis, Leak, Sharp, Pulse, kPerUnit };
    enum { ModeA = 2 * kPerUnit, ModeB, Cross, ResetOnStart };
    enum { A1, A2, A3, B1, B2, B3, Reset };
    enum { AGate, BGate, AOut, BOut, ASpike, BSpike, And, Or, Xor, Diff };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        for (auto& t : membrane_) t.prepare(sampleRate, 2.0);
        for (auto& t : gate_) t.prepare(sampleRate, 2.0);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"membraneA", (double)mem_[0].load()});
        out.push_back({"membraneB", (double)mem_[1].load()});
        out.push_back({"spikesA", (double)spikes_[0].load()});
        out.push_back({"spikesB", (double)spikes_[1].load()});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        out.push_back({"membraneA", membrane_[0].ordered()});
        out.push_back({"membraneB", membrane_[1].ordered()});
        out.push_back({"gateA", gate_[0].ordered()});
        out.push_back({"gateB", gate_[1].ordered()});
    }

    void process(const ProcessContext& c) override {
        if (c.transportStarted && setting(ResetOnStart) >= 0.5f) dsp_.reset();
        patch::NeuronParams p;
        p.cross = (patch::NeuronCross)std::clamp((int)setting(Cross), 0, 2);
        p.unit[0].cell.spike = setting(ModeA) >= 0.5f;
        p.unit[1].cell.spike = setting(ModeB) >= 0.5f;
        patch::NeuronInputs in;
        for (int u = 0; u < 2; ++u)
            for (int j = 0; j < 3; ++j) in.patched[(size_t)u][(size_t)j] = c.inputConnected[u * 3 + j];
        patch::NeuronFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            for (int u = 0; u < 2; ++u) {
                const int o = u * kPerUnit;
                auto& up = p.unit[(size_t)u];
                up.weight = {cachedValue(c, o + W1, i), cachedValue(c, o + W2, i), cachedValue(c, o + W3, i)};
                up.cell.threshold = cachedValue(c, o + Threshold, i);
                up.cell.hysteresis = cachedValue(c, o + Hysteresis, i);
                up.cell.leak = cachedValue(c, o + Leak, i);
                up.cell.pulse = cachedValue(c, o + Pulse, i);
                up.sharp = cachedValue(c, o + Sharp, i);
                for (int j = 0; j < 3; ++j) in.in[(size_t)u][(size_t)j] = c.inputs[u * 3 + j][i];
            }
            in.reset = c.inputs[Reset][i];
            dsp_.tick(p, in, f);
            c.outputs[AGate][i] = f.gate[0];
            c.outputs[BGate][i] = f.gate[1];
            c.outputs[AOut][i] = f.out[0];
            c.outputs[BOut][i] = f.out[1];
            c.outputs[ASpike][i] = f.spike[0];
            c.outputs[BSpike][i] = f.spike[1];
            c.outputs[And][i] = f.logicAnd;
            c.outputs[Or][i] = f.logicOr;
            c.outputs[Xor][i] = f.logicXor;
            c.outputs[Diff][i] = f.diff;
            for (int u = 0; u < 2; ++u) {
                membrane_[(size_t)u].push(f.membrane[(size_t)u]);
                gate_[(size_t)u].push(f.gate[(size_t)u], true);
                if (f.spike[(size_t)u] > 0.5f) spikes_[(size_t)u].fetch_add(1, std::memory_order_relaxed);
            }
        }
        for (int u = 0; u < 2; ++u) mem_[(size_t)u].store(dsp_.membrane(u), std::memory_order_relaxed);
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

    NeuronDsp dsp_;
    std::array<Trace, 2> membrane_, gate_;
    std::array<std::atomic<uint32_t>, 2> spikes_{};
    std::array<std::atomic<float>, 2> mem_{};
    std::array<float, 32> knobNorm_ = [] {
        std::array<float, 32> a;
        a.fill(-1.0f);
        return a;
    }();
    std::array<float, 32> knobUnits_{};
};

}  // namespace

static void registerNeuronModule(Registry& r) {
    ModuleSpec s;
    s.type = "neuron";
    s.name = "Neuron";
    s.category = "Modulation";
    s.colour = "#c026d3";
    s.description = "Two leaky integrate-and-fire neurons. In 1 is a bias, In 3 hears the other neuron: a rhythm out of the box.";
    struct Defaults {
        float w1, w2, w3, leak;
    };
    const Defaults defs[2] = {{0.6f, 1.0f, 0.5f, 0.25f}, {0.9f, 1.0f, -1.0f, 0.4f}};
    for (int u = 0; u < 2; ++u) {
        const std::string k = u == 0 ? "a" : "b", g = u == 0 ? "Neuron A" : "Neuron B";
        const Defaults& d = defs[u];
        s.params.push_back(ParamSpec::number(k + "w1", "W1", -2.0f, 2.0f, d.w1).inGroup(g));
        s.params.push_back(ParamSpec::number(k + "w2", "W2", -2.0f, 2.0f, d.w2).inGroup(g));
        s.params.push_back(ParamSpec::number(k + "w3", "W3", -2.0f, 2.0f, d.w3).inGroup(g));
        s.params.push_back(ParamSpec::number(k + "threshold", "Threshold", -1.0f, 1.0f, 0.5f).inGroup(g));
        s.params.push_back(ParamSpec::percent(k + "hysteresis", "Hysteresis", 0.0f, 1.0f, 0.1f).inGroup(g));
        s.params.push_back(ParamSpec::seconds(k + "leak", "Leak", 0.0f, 5.0f, 0.3f, d.leak).inGroup(g));
        s.params.push_back(ParamSpec::exponential(k + "sharp", "Sharp", 1.0f, 100.0f, 4.0f).inGroup(g));
        s.params.push_back(ParamSpec::seconds(k + "pulse", "Pulse", 0.001f, 1.0f, 0.05f, 0.03f)
                               .inGroup(g)
                               .when(k + "mode", 1, 1));
    }
    s.params.push_back(ParamSpec::choice("amode", "A Mode", {"Compare", "Spike"}, 1));
    s.params.push_back(ParamSpec::choice("bmode", "B Mode", {"Compare", "Spike"}, 1));
    s.params.push_back(ParamSpec::choice("cross", "Cross", {"Out", "Gate", "Off"}, 0));
    s.params.push_back(ParamSpec::toggle("resetstart", "Reset on Start", true));
    s.inputs = {{"a1", "A In 1", Signal::Control}, {"a2", "A In 2", Signal::Control}, {"a3", "A In 3", Signal::Control},
                {"b1", "B In 1", Signal::Control}, {"b2", "B In 2", Signal::Control}, {"b3", "B In 3", Signal::Control},
                {"reset", "Reset", Signal::Trigger}};
    s.outputs = {{"agate", "A Gate", Signal::Gate, false},     {"bgate", "B Gate", Signal::Gate, false},
                 {"aout", "A Out", Signal::Control, false},    {"bout", "B Out", Signal::Control, false},
                 {"aspike", "A Spike", Signal::Trigger, false}, {"bspike", "B Spike", Signal::Trigger, false},
                 {"and", "AND", Signal::Gate, false},          {"or", "OR", Signal::Gate, false},
                 {"xor", "XOR", Signal::Gate, false},          {"diff", "Diff", Signal::Control, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<NeuronModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerNeuronModule);

}  // namespace bleep::engine
