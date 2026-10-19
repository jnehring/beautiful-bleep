// SPDX-License-Identifier: GPL-3.0-or-later
// Shape Table node (doc/specs/modules/shape-table.md): a waveshaper with a drawn
// transfer curve, kept as node data ({"curve": [65 numbers]}). The curve is
// turned into a table on the message thread (setData) and handed to the audio
// thread with RtHandoff.
#include "Handoff.h"
#include "Registry.h"
#include "ShapeTableDsp.h"

#include <juce_core/juce_core.h>

#include <atomic>

namespace bleep::engine {
namespace {

namespace st = patch::shapetable;

st::Points pointsOf(const juce::var& in) {
    st::Points p = st::presetPoints(1);  // soft saturation unless the data says otherwise
    if (const auto* a = in["curve"].getArray())
        if ((int)a->size() == st::kPoints) {
            bool ok = true;
            st::Points q{};
            for (int i = 0; i < st::kPoints; ++i) {
                const juce::var& v = (*a)[i];
                if (!(v.isInt() || v.isInt64() || v.isDouble())) { ok = false; break; }
                const double d = (double)v;
                if (!std::isfinite(d)) { ok = false; break; }
                q[(size_t)i] = (float)std::clamp(d, -1.0, 1.0);
            }
            if (ok) p = q;
        }
    return p;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const st::Points p = pointsOf(in);
    juce::Array<juce::var> a;
    for (float v : p) a.add(juce::var(std::round((double)v * 1000.0) / 1000.0));
    auto* o = new juce::DynamicObject();
    o->setProperty("curve", a);
    return juce::JSON::toString(juce::var(o), true).toStdString();
}

class ShapeTableModule final : public Module {
public:
    enum { Drive, Bias, Mix, Out, Edge, Quality, DcBlock };
    enum { InL, InR, FuncIn };
    enum { OutL, OutR, FuncOut };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        for (auto& c : ch_) c.prepare(sampleRate);
        reset();
    }
    void reset() override {
        for (auto& c : ch_) c.reset();
    }

    void setData(const std::string& json) override {
        const st::Points p = pointsOf(juce::JSON::parse(juce::String(json)));
        auto t = st::Table::build(p);
        message_ = t;  // kept for the harmonic read-out (message thread only)
        handoff_.publish(std::move(t));
    }
    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"x", x_.load(std::memory_order_relaxed)});
        out.push_back({"y", y_.load(std::memory_order_relaxed)});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        if (!message_) return;
        const float drive = std::pow(10.0f, units(Drive) / 20.0f), bias = units(Bias);
        std::vector<float> h(16);
        st::harmonics(*message_, drive, bias, (int)std::lround(units(Edge)), h.data(), 16);
        out.push_back({"harmonics", std::move(h)});
    }

    void process(const ProcessContext& c) override {
        const st::Table* table = handoff_.get();
        st::Params p;
        p.edge = (int)setting(Edge);
        p.quality = (int)setting(Quality);
        p.dcBlock = setting(DcBlock) > 0.5f;
        const bool right = c.inputConnected[InR];
        for (int i = 0; i < c.numSamples; ++i) {
            p.drive = std::pow(10.0f, value(c, Drive, i) / 20.0f);
            p.bias = value(c, Bias, i);
            p.mix = value(c, Mix, i);
            p.out = std::pow(10.0f, value(c, Out, i) / 20.0f);
            const float l = ch_[0].process(table, p, c.inputs[InL][i]);
            c.outputs[OutL][i] = l;
            c.outputs[OutR][i] = right ? ch_[1].process(table, p, c.inputs[InR][i]) : l;
            c.outputs[FuncOut][i] = table ? table->eval((double)c.inputs[FuncIn][i], p.edge) : 0.0f;
        }
        x_.store(ch_[0].lastX(), std::memory_order_relaxed);
        y_.store(ch_[0].lastY(), std::memory_order_relaxed);
    }

private:
    float units(int i) const { return spec().params[(size_t)i].fromNormalised(knob(i)); }

    std::array<st::Channel, 2> ch_;
    RtHandoff<st::Table> handoff_;
    std::shared_ptr<const st::Table> message_;
    std::atomic<float> x_{0.0f}, y_{0.0f};
};

}  // namespace

static void registerShapeTableModule(Registry& r) {
    ModuleSpec s;
    s.type = "shape-table";
    s.name = "Shape Table";
    s.category = "Effects/Distortion";
    s.colour = "#f59e0b";
    s.description = "A waveshaper whose transfer curve you draw: curve presets, drive, bias, edge behaviour (clip, fold, wrap), "
                    "oversampling with antiderivative anti-aliasing and a harmonic read-out.";
    s.params = {ParamSpec::number("drive", "Drive", -12.0f, 36.0f, 6.0f, "dB", 1),
                ParamSpec::percent("bias", "Bias", -1.0f, 1.0f, 0.0f),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
                ParamSpec::number("out", "Out", -24.0f, 12.0f, 0.0f, "dB", 1),
                ParamSpec::choice("edge", "Edge", {"Clip", "Fold", "Wrap"}, 0),
                ParamSpec::choice("quality", "Quality", {"Off", "2x", "4x"}, 1),
                ParamSpec::toggle("dcblock", "DC Block", true)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}, {"func", "Func In", Signal::Control}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}, {"func", "Func Out", Signal::Control, true}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ShapeTableModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerShapeTableModule);

}  // namespace bleep::engine
