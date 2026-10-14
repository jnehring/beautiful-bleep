// SPDX-License-Identifier: MIT
// Filter Bank node (doc/specs/modules/filter-bank.md): ten band-pass filters with
// levels, tilt, odd/even, a scan window, per-band outputs and envelopes, and
// a built-in vocoder through the sidechain. Unread band outputs and
// envelopes are skipped (ctx.isOutputConnected).
#include "FilterBankDsp.h"
#include "Registry.h"

#include <atomic>
#include <cmath>
#include <string>

namespace bleep::engine {
namespace {

using patch::FilterBankDsp;
using patch::FilterBankParams;

constexpr int kBands = FilterBankParams::kBands;

class FilterBankModule final : public Module {
public:
    // Params: level1 … level10 come first.
    enum { Q = kBands, Tilt, OddEven, Scan, Width, Shift, Spacing, Attack, Release, Vocode, Mix,
           Tuning, Root, ScaleParam, Slope, EdgeBands, EnvFrom, StereoMode, Jacks };
    enum { InL, InR, Sidechain, Pitch };
    // Outputs: Sum L/R, Odd, Even, then Band 1 … 10, then Env 1 … 10.
    enum { SumL, SumR, Odd, Even, FirstBand, FirstEnv = FirstBand + kBands };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> env(kBands), gain(kBands), freq(kBands);
        for (int k = 0; k < kBands; ++k) {
            env[(size_t)k] = env_[(size_t)k].load(std::memory_order_relaxed);
            gain[(size_t)k] = gain_[(size_t)k].load(std::memory_order_relaxed);
            freq[(size_t)k] = freq_[(size_t)k].load(std::memory_order_relaxed);
        }
        out.emplace_back("env", std::move(env));
        out.emplace_back("gain", std::move(gain));
        out.emplace_back("freq", std::move(freq));
    }

    void process(const ProcessContext& c) override {
        const bool stereo = c.inputConnected[InR];
        const float* inR = stereo ? c.inputs[InR] : c.inputs[InL];
        FilterBankParams p;
        p.tuning = (int)setting(Tuning);
        p.root = (int)setting(Root);
        p.scale = (int)setting(ScaleParam);
        p.steep = setting(Slope) >= 0.5f;
        p.edges = setting(EdgeBands) >= 0.5f;
        p.sidechain = setting(EnvFrom) >= 0.5f;
        p.split = setting(StereoMode) >= 0.5f;
        patch::FilterBankOutputs o;
        for (int k = 0; k < kBands; ++k) {
            o.band[(size_t)k] = c.isOutputConnected(FirstBand + k);
            o.env[(size_t)k] = c.isOutputConnected(FirstEnv + k);
        }
        patch::FilterBankFrame f;
        float peak[kBands] = {};
        for (int i = 0; i < c.numSamples; ++i) {
            if (dsp_.controlDue()) {  // read at the DSP's control rate (every 8 samples)
                for (int k = 0; k < kBands; ++k) p.levelDb[(size_t)k] = value(c, k, i);
                p.q = value(c, Q, i);
                p.tilt = value(c, Tilt, i);
                p.oddEven = value(c, OddEven, i);
                p.scan = value(c, Scan, i);
                p.width = value(c, Width, i);
                p.shift = value(c, Shift, i);
                p.spacing = value(c, Spacing, i);
                p.attack = value(c, Attack, i);
                p.release = value(c, Release, i);
                p.pitch = c.inputs[Pitch][i];
            }
            p.vocode = value(c, Vocode, i);
            p.mix = value(c, Mix, i);
            f.in[0] = c.inputs[InL][i];
            f.in[1] = inR[i];
            f.sidechain = c.inputs[Sidechain][i];
            dsp_.tick(p, o, f, stereo);
            c.outputs[SumL][i] = f.sum[0];
            c.outputs[SumR][i] = f.sum[1];
            c.outputs[Odd][i] = f.odd;
            c.outputs[Even][i] = f.even;
            for (int k = 0; k < kBands; ++k) {
                c.outputs[FirstBand + k][i] = f.band[(size_t)k];
                c.outputs[FirstEnv + k][i] = f.env[(size_t)k];
                peak[k] = std::max(peak[k], f.env[(size_t)k]);
            }
        }
        for (int k = 0; k < kBands; ++k) {
            env_[(size_t)k].store(peak[k], std::memory_order_relaxed);
            gain_[(size_t)k].store(dsp_.effectiveGain(k), std::memory_order_relaxed);
            freq_[(size_t)k].store((float)dsp_.frequency(k), std::memory_order_relaxed);
        }
    }

private:
    FilterBankDsp dsp_;
    std::array<std::atomic<float>, kBands> env_{}, gain_{}, freq_{};
};

/// A band level: −60 dB (silent) … +12 dB, 0 dB at 75 % of the knob.
ParamSpec levelParam(int k) {
    const std::string n = std::to_string(k);
    ParamSpec p = ParamSpec::number("level" + n, "Level " + n, -60.0f, 12.0f, 0.0f, "dB", 1);
    p.map = ParamSpec::Map::Skew;
    // Skew: x = ((v − min)/(max − min))^skew; pick the centre so that 0 dB sits at x = 0.75.
    const double e = std::log(60.0 / 72.0) / std::log(0.75);  // = 1 / skew
    p.centre = (float)(-60.0 + 72.0 * std::pow(0.5, e));
    return p.inGroup("Levels");
}

}  // namespace

static void registerFilterBankModule(Registry& r) {
    ModuleSpec s;
    s.type = "filter-bank";
    s.name = "Filter Bank";
    s.category = "Audio/Filters";
    s.colour = "#eab308";
    s.description = "Ten fixed band-pass filters: per-band levels, tilt, odd/even, a scanning window, "
                    "band and envelope outputs, and a built-in vocoder via the sidechain.";
    for (int k = 1; k <= kBands; ++k) s.params.push_back(levelParam(k));
    auto q = ParamSpec::exponential("q", "Q", 0.5f, 30.0f, 2.2f);
    q.decimals = 1;
    auto attack = ParamSpec::exponential("attack", "Attack", 0.0005f, 0.1f, 0.003f);
    attack.format = ParamSpec::Format::Seconds;
    auto release = ParamSpec::exponential("release", "Release", 0.005f, 2.0f, 0.08f);
    release.format = ParamSpec::Format::Seconds;
    std::vector<std::string> scales;
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    const std::vector<std::string> notes{"C", "C\xe2\x99\xaf", "D", "D\xe2\x99\xaf", "E", "F", "F\xe2\x99\xaf", "G",
                                         "G\xe2\x99\xaf", "A", "A\xe2\x99\xaf", "B"};
    const std::vector<ParamSpec> rest{
        q.inGroup("Bands"),
        ParamSpec::number("tilt", "Tilt", -6.0f, 6.0f, 0.0f, "dB/oct", 1).inGroup("Shape"),
        ParamSpec::percent("oddEven", "Odd/Even", -1.0f, 1.0f, 0.0f).inGroup("Shape"),
        ParamSpec::percent("scan", "Scan", 0.0f, 1.0f, 0.5f).inGroup("Shape"),
        ParamSpec::number("width", "Width", 1.0f, 10.0f, 10.0f, "bands", 1).inGroup("Shape"),
        ParamSpec::number("shift", "Shift", -2.0f, 2.0f, 0.0f, "oct", 2).inGroup("Bands"),
        ParamSpec::percent("spacing", "Spacing", 0.5f, 2.0f, 1.0f).inGroup("Bands"),
        attack.inGroup("Envelopes"),
        release.inGroup("Envelopes"),
        ParamSpec::percent("vocode", "Vocode", 0.0f, 1.0f, 0.0f).inGroup("Envelopes"),
        ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
        ParamSpec::choice("tuning", "Tuning", {"Spectral", "Harmonic", "Scale"}, 0),
        ParamSpec::choice("root", "Root", notes, 0).when("tuning", 2, 2),
        ParamSpec::choice("scale", "Scale", scales, 12).when("tuning", 2, 2),
        ParamSpec::choice("slope", "Slope", {"12 dB/oct", "24 dB/oct"}, 0),
        ParamSpec::choice("edgeBands", "Edge Bands", {"Band-pass", "Low-pass/High-pass"}, 1),
        ParamSpec::choice("envFrom", "Env From", {"Input", "Sidechain"}, 0),
        ParamSpec::choice("stereo", "Stereo", {"Normal", "Odd/Even split"}, 0),
        ParamSpec::choice("jacks", "Jacks", {"Sums", "Bands", "Bands + Envs", "Envs"}, 0)};
    s.params.insert(s.params.end(), rest.begin(), rest.end());
    s.inputs = {{"l", "In L", Signal::Audio},
                {"r", "In R", Signal::Audio},
                {"sidechain", "Sidechain", Signal::Audio},
                JackSpec{"pitch", "Pitch", Signal::Pitch}.when("tuning", 1, 2)};
    s.outputs = {{"l", "Sum L", Signal::Audio, true},
                 {"r", "Sum R", Signal::Audio, true},
                 {"odd", "Odd", Signal::Audio, true},
                 {"even", "Even", Signal::Audio, true}};
    for (int k = 1; k <= kBands; ++k)
        s.outputs.push_back(JackSpec{"band" + std::to_string(k), "Band " + std::to_string(k), Signal::Audio, true}.when("jacks", 1, 2));
    for (int k = 1; k <= kBands; ++k)
        s.outputs.push_back(JackSpec{"env" + std::to_string(k), "Env " + std::to_string(k), Signal::Control, false}.when("jacks", 2, 3));
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<FilterBankModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerFilterBankModule);

}  // namespace bleep::engine
