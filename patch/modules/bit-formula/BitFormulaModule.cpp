// SPDX-License-Identifier: GPL-3.0-or-later
// Bit Formula node (doc/specs/modules/bit-formula.md): an integer expression
// evaluated once per clock tick. The expression is compiled on the message
// thread (setData) and handed to the audio thread with RtHandoff.
#include "BitFormulaDsp.h"
#include "Handoff.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <atomic>

namespace bleep::engine {
namespace {

using patch::BitFormulaDsp;
using patch::BitParams;
using patch::BitProgram;

std::string formulaOf(const juce::var& in) {
    const std::string s = in.getProperty("formula", juce::String()).toString().toStdString();
    std::string clean;
    for (char ch : s)
        if (ch == '\t' || ch == '\n' || ch == '\r') clean += ' ';
        else if ((unsigned char)ch >= 32 && (unsigned char)ch < 127) clean += ch;
    if ((int)clean.size() > BitProgram::kMaxSource) clean.resize(BitProgram::kMaxSource);
    return clean;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const std::string f = formulaOf(in);
    auto* o = new juce::DynamicObject();
    o->setProperty("formula", juce::String(f.empty() ? std::string("t*(a>>4) & 255") : f));
    return juce::JSON::toString(juce::var(o), true).toStdString();
}

class BitFormulaModule final : public Module {
public:
    enum { Formula, A, B, C, Rate, Smooth, Bits, Level };
    enum { Pitch, ResetIn, In };
    enum { Out, Value, Msb };
    static constexpr int kCustom = 16;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        dsp_.reset();
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        const auto compiled = patch::BitCompiler::compile(formulaOf(juce::JSON::parse(juce::String(json))));
        ok_.store(compiled.ok);
        errorAt_.store(compiled.errorAt);
        handoff_.publish(std::make_shared<const BitProgram>(compiled));
    }
    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"customOk", ok_.load() ? 1.0 : 0.0});
        out.push_back({"errorAt", (double)errorAt_.load()});
        out.push_back({"byte", (double)byte_.load(std::memory_order_relaxed)});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> w(kScope);
        const int p = scopePos_.load(std::memory_order_relaxed);
        for (int i = 0; i < kScope; ++i) w[(size_t)i] = scope_[(p + i) % kScope].load(std::memory_order_relaxed);
        out.push_back({"wave", std::move(w)});
    }

    void process(const ProcessContext& c) override {
        const int which = std::clamp((int)std::lround(value(c, Formula, 0)), 0, kCustom);
        const BitProgram* custom = handoff_.get();
        const BitProgram* prog = which < kCustom ? &patch::compiledPresets()[(size_t)which] : custom;
        BitParams p;
        p.bits = (int)std::lround(value(c, Bits, 0));
        const int every = std::max(1, (int)(sampleRate_ / 8000.0));
        for (int i = 0; i < c.numSamples; ++i) {
            const bool r = c.inputs[ResetIn][i] > 0.5f;
            if (r && !resetPrev_) dsp_.reset();
            resetPrev_ = r;
            p.a = value(c, A, i), p.b = value(c, B, i), p.c = value(c, C, i);
            p.rateHz = value(c, Rate, i) * std::exp2(std::clamp(c.inputs[Pitch][i], -8.0f, 6.0f));
            p.smooth = value(c, Smooth, i);
            const auto f = dsp_.tick(prog, p, c.inputs[In][i]);
            c.outputs[Out][i] = f.out * value(c, Level, i);
            c.outputs[Value][i] = f.value;
            c.outputs[Msb][i] = f.msb ? 1.0f : 0.0f;
            if (++scopeAcc_ >= every) {
                scopeAcc_ = 0;
                const int w = scopePos_.load(std::memory_order_relaxed);
                scope_[w].store(f.out, std::memory_order_relaxed);
                scopePos_.store((w + 1) % kScope, std::memory_order_relaxed);
            }
            lastValue_ = f.value;
        }
        byte_.store((int)std::lround(lastValue_ * 255.0f), std::memory_order_relaxed);
    }

private:
    static constexpr int kScope = 192;
    BitFormulaDsp dsp_;
    RtHandoff<BitProgram> handoff_;
    std::atomic<bool> ok_{true};
    std::atomic<int> errorAt_{-1};
    std::atomic<int> byte_{0};
    bool resetPrev_ = false;
    int scopeAcc_ = 0;
    float lastValue_ = 0.0f;
    std::atomic<float> scope_[kScope] = {};
    std::atomic<int> scopePos_{0};
};

}  // namespace

static void registerBitFormulaModule(Registry& r) {
    ModuleSpec s;
    s.type = "bit-formula";
    s.name = "Bit Formula";
    s.category = "Sources/Generators";
    s.colour = "#a3e635";
    s.description = "Integer-expression sound generator: sixteen formulas plus your own, three modulatable knobs, "
                    "a clock rate with pitch and an audio input in the maths.";
    std::vector<std::string> names;
    for (const auto& p : patch::bitPresets()) names.push_back(p.name);
    names.push_back("Custom");
    s.params = {ParamSpec::stepped("formula", "Formula", names, 0),
                ParamSpec::number("a", "A", 0.0f, 255.0f, 96.0f, "", 0),
                ParamSpec::number("b", "B", 0.0f, 255.0f, 128.0f, "", 0),
                ParamSpec::number("c", "C", 0.0f, 255.0f, 200.0f, "", 0),
                ParamSpec::hertz("rate", "Rate", 250.0f, 48000.0f, 8000.0f),
                ParamSpec::percent("smooth", "Smooth", 0.0f, 1.0f, 0.0f),
                ParamSpec::steppedInt("bits", "Bits", 1, 8, 8),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 0.6f)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch}, {"reset", "Reset", Signal::Trigger}, {"in", "In", Signal::Audio}};
    s.outputs = {{"out", "Out", Signal::Audio, true}, {"value", "Value", Signal::Control, false}, {"msb", "MSB", Signal::Gate, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<BitFormulaModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerBitFormulaModule);

}  // namespace bleep::engine
