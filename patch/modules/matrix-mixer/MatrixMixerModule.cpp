// SPDX-License-Identifier: MIT
// Matrix Mixer node (doc/specs/modules/matrix-mixer.md): up to 8 × 8
// crosspoints as modulatable knobs, output levels, mutes, an output stage,
// and snapshots (node data) to morph between.
#include "MatrixMixerDsp.h"
#include "Handoff.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::kMmCross;
using patch::kMmSize;
using patch::kMmSnapshots;
using patch::MatrixMixerDsp;
using patch::MmSnapshots;

double number(const juce::var& v, double def) { return v.isInt() || v.isInt64() || v.isDouble() ? (double)v : def; }

/// The snapshots and morph ends from the node's data.
MmSnapshots parseSnapshots(const juce::var& data) {
    MmSnapshots out;
    const auto* list = data.isObject() ? data["snapshots"].getArray() : nullptr;
    for (int k = 0; list && k < kMmSnapshots && k < list->size(); ++k) {
        const juce::var s = (*list)[k];
        if (!s.isObject()) continue;
        auto& snap = out.s[k];
        snap.valid = true;
        if (const auto* rows = s["g"].getArray())
            for (int i = 0; i < kMmSize && i < rows->size(); ++i)
                if (const auto* row = (*rows)[i].getArray())
                    for (int j = 0; j < kMmSize && j < row->size(); ++j)
                        snap.g[i * kMmSize + j] = (float)juce::jlimit(-1.0, 1.0, number((*row)[j], 0.0));
        if (const auto* l = s["level"].getArray())
            for (int j = 0; j < kMmSize && j < l->size(); ++j) snap.level[j] = (float)juce::jlimit(0.0, 2.0, number((*l)[j], 1.0));
        if (const auto* m = s["mute"].getArray())
            for (int i = 0; i < kMmSize && i < m->size(); ++i) snap.mute[i] = number((*m)[i], 0.0) >= 0.5;
    }
    if (data.isObject()) {
        out.a = juce::jlimit(0, kMmSnapshots - 1, (int)number(data["morphA"], 0.0));
        out.b = juce::jlimit(0, kMmSnapshots - 1, (int)number(data["morphB"], 1.0));
    }
    return out;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const MmSnapshots snaps = parseSnapshots(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    // Labels: eight strings each, at most 24 characters.
    auto* labels = new juce::DynamicObject();
    for (const char* side : {"in", "out"}) {
        juce::Array<juce::var> list;
        const auto* src = in.isObject() && in["labels"].isObject() ? in["labels"][side].getArray() : nullptr;
        for (int i = 0; i < kMmSize; ++i) {
            juce::String s = src && i < src->size() && (*src)[i].isString() ? (*src)[i].toString() : juce::String();
            list.add(s.substring(0, 24));
        }
        labels->setProperty(side, list);
    }
    out->setProperty("labels", juce::var(labels));
    const auto* srcSnaps = in.isObject() ? in["snapshots"].getArray() : nullptr;
    juce::Array<juce::var> list;
    for (int k = 0; k < kMmSnapshots; ++k) {
        const auto& s = snaps.s[k];
        if (!s.valid) {
            list.add(juce::var());
            continue;
        }
        auto* o = new juce::DynamicObject();
        const juce::var src = (*srcSnaps)[k];
        o->setProperty("name", src["name"].isString() ? src["name"].toString().substring(0, 24) : juce::String());
        juce::Array<juce::var> rows;
        for (int i = 0; i < kMmSize; ++i) {
            juce::Array<juce::var> row;
            for (int j = 0; j < kMmSize; ++j) row.add(std::round((double)s.g[i * kMmSize + j] * 1000.0) / 1000.0);
            rows.add(row);
        }
        o->setProperty("g", rows);
        juce::Array<juce::var> level, mute;
        for (int j = 0; j < kMmSize; ++j) level.add(std::round((double)s.level[j] * 1000.0) / 1000.0);
        for (int i = 0; i < kMmSize; ++i) mute.add(s.mute[i] ? 1 : 0);
        o->setProperty("level", level);
        o->setProperty("mute", mute);
        list.add(juce::var(o));
    }
    out->setProperty("snapshots", list);
    out->setProperty("morphA", snaps.a);
    out->setProperty("morphB", snaps.b);
    return juce::JSON::toString(result, true).toStdString();
}

class MatrixMixerModule final : public Module {
public:
    static constexpr int Gain = 0, Level = kMmCross, Morph = Level + kMmSize, Inputs = Morph + 1, Outputs = Inputs + 1,
                         Mute = Outputs + 1, Stage = Mute + kMmSize, Unpatched = Stage + 1, MorphOn = Unpatched + 1,
                         Curve = MorphOn + 1;

    explicit MatrixMixerModule(const ModuleSpec& spec) : Module(spec) {
        snapshots_.publish(std::make_shared<const MmSnapshots>());
    }

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        snapshots_.publish(std::make_shared<const MmSnapshots>(parseSnapshots(juce::JSON::parse(juce::String(json)))));
    }

    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> gains, meters;
        for (int k = 0; k < kMmCross; ++k) gains.push_back(gains_[(size_t)k].load());
        for (int j = 0; j < kMmSize; ++j) meters.push_back(meters_[(size_t)j].load());
        out.push_back({"gains", std::move(gains)});
        out.push_back({"meters", std::move(meters)});
    }

    void process(const ProcessContext& c) override {
        const MmSnapshots* snaps = snapshots_.get();
        patch::MmBlock b;
        const int n = std::min(c.numSamples, patch::kMmMaxBlock);
        b.numSamples = n;
        b.inputs = (int)setting(Inputs);
        b.outputs = (int)setting(Outputs);
        b.unpatched = setting(Unpatched) >= 0.5f ? 1.0f : 0.0f;
        b.stage = (int)setting(Stage);
        b.morph = setting(MorphOn) >= 0.5f;
        b.curve = (int)setting(Curve);
        b.snapshots = snaps;
        for (int i = 0; i < kMmSize; ++i) {
            b.in[i] = c.inputConnected[i] ? c.inputs[i] : nullptr;
            b.mute[i] = setting(Mute + i) >= 0.5f;
        }
        // Knob values in units; the per-sample buffers only where something modulates.
        const int ni = std::clamp(b.inputs, 1, kMmSize), no = std::clamp(b.outputs, 1, kMmSize);
        for (int k = 0; k < kMmCross; ++k) {
            const float kn = knob(Gain + k);
            b.gainKnob[k] = 2.0f * kn - 1.0f;
            const bool used = k / kMmSize < ni && k % kMmSize < no;  // hidden crosspoints only follow their knob
            b.gainEff[k] = used ? unitsIfModulated(c.params[Gain + k], kn, n, 2.0f, -1.0f, eff_[k]) : nullptr;
        }
        for (int j = 0; j < kMmSize; ++j) {
            const float kn = knob(Level + j);
            b.levelKnob[j] = 2.0f * kn;
            b.levelEff[j] = unitsIfModulated(c.params[Level + j], kn, n, 2.0f, 0.0f, levelEff_[j]);
        }
        b.morphAmount = c.params[Morph];
        float* outs[kMmSize];
        for (int j = 0; j < kMmSize; ++j) outs[j] = c.outputs[j];
        dsp_.process(b, outs);
        for (int j = std::clamp(b.outputs, 1, kMmSize); j < kMmSize; ++j) std::fill(c.outputs[j], c.outputs[j] + n, 0.0f);
        for (int k = 0; k < kMmCross; ++k)
            gains_[(size_t)k].store(dsp_.baseGain(k) + (b.gainEff[k] ? b.gainEff[k][n - 1] - b.gainKnob[k] : 0.0f));
        for (int j = 0; j < kMmSize; ++j) meters_[(size_t)j].store(std::max(dsp_.peak(j), 0.995f * meters_[(size_t)j].load()));
    }

private:
    /// Converts a param buffer to units when it differs from the knob (modulated); else null.
    static const float* unitsIfModulated(const float* src, float knob, int n, float scale, float offset, float* dst) {
        bool modulated = false;
        for (int s = 0; s < n && !modulated; ++s) modulated = src[s] < knob || src[s] > knob;
        if (!modulated) return nullptr;
        for (int s = 0; s < n; ++s) dst[s] = scale * src[s] + offset;
        return dst;
    }

    MatrixMixerDsp dsp_;
    RtHandoff<MmSnapshots> snapshots_;
    std::string data_;  // message thread
    float eff_[kMmCross][patch::kMmMaxBlock]{};
    float levelEff_[kMmSize][patch::kMmMaxBlock]{};
    std::array<std::atomic<float>, kMmCross> gains_{};
    std::array<std::atomic<float>, kMmSize> meters_{};
};

}  // namespace

static void registerMatrixMixerModule(Registry& r) {
    ModuleSpec s;
    s.type = "matrix-mixer";
    s.name = "Matrix Mixer";
    s.category = "Utility/Signal";
    s.colour = "#4f46e5";
    s.description = "Up to 8 inputs × 8 outputs, a bipolar gain at every crosspoint. Snapshots store whole matrices; Morph blends two.";
    for (int i = 1; i <= kMmSize; ++i)
        for (int j = 1; j <= kMmSize; ++j) {
            const std::string id = "g_" + std::to_string(i) + "_" + std::to_string(j);
            auto g = ParamSpec::number(id, std::to_string(i) + " \xe2\x86\x92 " + std::to_string(j), -1.0f, 1.0f,
                                       i == j ? 1.0f : 0.0f);
            s.params.push_back(g.inGroup("In " + std::to_string(i)).when("outputs", j, kMmSize));
        }
    for (int j = 1; j <= kMmSize; ++j)
        s.params.push_back(ParamSpec::percent("level_" + std::to_string(j), "Level " + std::to_string(j), 0.0f, 2.0f, 1.0f)
                               .inGroup("Levels")
                               .when("outputs", j, kMmSize));
    s.params.push_back(ParamSpec::percent("morph", "Morph", 0.0f, 1.0f, 0.0f).when("morphon", 1, 1));
    s.params.push_back(ParamSpec::integer("inputs", "Inputs", 1, kMmSize, 4));
    s.params.push_back(ParamSpec::integer("outputs", "Outputs", 1, kMmSize, 4));
    for (int i = 1; i <= kMmSize; ++i)
        s.params.push_back(ParamSpec::toggle("mute_" + std::to_string(i), "Mute " + std::to_string(i), false).when("inputs", i, kMmSize));
    s.params.push_back(ParamSpec::choice("stage", "Output Stage", {"Clean", "Soft clip", "Normalize"}, 0));
    s.params.push_back(ParamSpec::choice("unpatched", "Unpatched", {"0", "1"}, 0));
    s.params.push_back(ParamSpec::choice("morphon", "Morph", {"Off", "On"}, 0));
    s.params.push_back(ParamSpec::choice("curve", "Morph Curve", {"Linear", "Smooth", "Equal power"}, 0).when("morphon", 1, 1));
    for (int i = 1; i <= kMmSize; ++i)
        s.inputs.push_back(JackSpec{"in" + std::to_string(i), "In " + std::to_string(i), Signal::Audio}.when("inputs", i, kMmSize));
    for (int j = 1; j <= kMmSize; ++j)
        s.outputs.push_back(
            JackSpec{"out" + std::to_string(j), "Out " + std::to_string(j), Signal::Audio, true}.when("outputs", j, kMmSize));
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<MatrixMixerModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerMatrixMixerModule);

}  // namespace bleep::engine
