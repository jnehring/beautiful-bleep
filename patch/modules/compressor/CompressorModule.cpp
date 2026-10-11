// SPDX-License-Identifier: MIT
// Compressor node (doc/compressor.md): a stereo-linked feed-forward compressor/limiter with a sidechain input.
#include "CompressorDsp.h"
#include "Registry.h"

#include <algorithm>
#include <atomic>
#include <cmath>

namespace bleep::engine {
namespace {

using patch::CompressorDsp;
using patch::CompressorParams;

class CompressorModule final : public Module {
public:
    enum { Threshold, Ratio, Attack, Release, Knee, Makeup, Mix, Link, Detector };
    enum { InL, InR, Key };
    enum { OutL, OutR, Reduction };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"reductionDb", (double)reduction_.load()});
    }

    void process(const ProcessContext& c) override {
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        const bool keyed = c.inputConnected[Key];
        CompressorParams p;
        p.rms = setting(Detector) >= 0.5f;
        float worst = 0.0f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.thresholdDb = value(c, Threshold, i);
            p.ratio = value(c, Ratio, i);
            p.attackMs = value(c, Attack, i);
            p.releaseMs = value(c, Release, i);
            p.kneeDb = value(c, Knee, i);
            p.makeupDb = value(c, Makeup, i);
            p.link = value(c, Link, i);
            const float mix = value(c, Mix, i);
            const float x[2] = {c.inputs[InL][i], inR[i]};
            const float key[2] = {keyed ? c.inputs[Key][i] : x[0], keyed ? c.inputs[Key][i] : x[1]};
            float y[2];
            const float gr = dsp_.tick(key, x, y, p);
            c.outputs[OutL][i] = x[0] + mix * (y[0] - x[0]);
            c.outputs[OutR][i] = x[1] + mix * (y[1] - x[1]);
            c.outputs[Reduction][i] = std::min(-gr * (1.0f / 24.0f), 1.0f);  // 0 … 1: 24 dB of reduction is full scale
            worst = std::min(worst, gr);
        }
        reduction_.store(worst);
    }

private:
    CompressorDsp dsp_;
    std::atomic<float> reduction_{0.0f};
};

}  // namespace

static void registerCompressorModule(Registry& r) {
    ModuleSpec s;
    s.type = "compressor";
    s.name = "Compressor";
    s.category = "Effects";
    s.colour = "#64748b";
    s.description = "Stereo compressor and limiter: soft knee, peak or RMS detector, sidechain input, "
                    "parallel mix and a gain reduction output you can patch.";
    s.params = {ParamSpec::number("threshold", "Threshold", -60.0f, 0.0f, -18.0f, "dB", 1),
                ParamSpec::exponential("ratio", "Ratio", 1.0f, 40.0f, 4.0f, ":1"),
                ParamSpec::exponential("attack", "Attack", 0.1f, 100.0f, 10.0f, "ms"),
                ParamSpec::exponential("release", "Release", 10.0f, 2000.0f, 120.0f, "ms"),
                ParamSpec::number("knee", "Knee", 0.0f, 24.0f, 6.0f, "dB", 1),
                ParamSpec::number("makeup", "Makeup", 0.0f, 24.0f, 0.0f, "dB", 1),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("link", "Link", 0.0f, 1.0f, 1.0f),
                ParamSpec::choice("detector", "Detector", {"Peak", "RMS"}, 0)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}, {"key", "Sidechain", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true},
                 {"reduction", "Reduction", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<CompressorModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerCompressorModule);

}  // namespace bleep::engine
