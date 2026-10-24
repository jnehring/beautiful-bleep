// SPDX-License-Identifier: GPL-3.0-only
// Meta Mod node (doc/specs/modules/meta-modulator.md): carrier and modulator
// combined by one of eight morphing algorithms, with an internal oscillator
// standing in for an unpatched input.
#include "MetaModDsp.h"
#include "Registry.h"

#include <atomic>

namespace bleep::engine {
namespace {

using patch::MetaModDsp;
using patch::MetaModParams;

/// A triggered three-trace scope for the view: 128 points over about 20 ms,
/// started at a rising zero crossing of the carrier (free-running when none
/// comes). The audio thread writes, the message thread reads (atomics).
class Scope3 {
public:
    static constexpr int kPoints = 128, kTraces = 3;
    void prepare(double sampleRate) noexcept { decimate_ = std::max(1, (int)std::lround(0.02 * sampleRate / kPoints)); }
    void push(const float (&v)[kTraces]) noexcept {
        const float ref = v[0];
        if (n_ < 0) {
            if ((last_ < 0.0f && ref >= 0.0f) || ++wait_ > kPoints * decimate_) n_ = 0, count_ = 0, wait_ = 0;
            last_ = ref;
            if (n_ < 0) return;
        }
        last_ = ref;
        if (count_++ % decimate_) return;
        for (int t = 0; t < kTraces; ++t) buf_[t][n_] = v[t];
        if (++n_ == kPoints) {
            for (int t = 0; t < kTraces; ++t)
                for (int i = 0; i < kPoints; ++i) shown_[t][i].store(buf_[t][i], std::memory_order_relaxed);
            n_ = -1;
        }
    }
    std::vector<float> trace(int t) const {
        std::vector<float> v(kPoints);
        for (int i = 0; i < kPoints; ++i) v[(size_t)i] = shown_[t][i].load(std::memory_order_relaxed);
        return v;
    }

private:
    int decimate_ = 8, n_ = -1, count_ = 0, wait_ = 0;
    float last_ = 0.0f;
    float buf_[kTraces][kPoints] = {};
    std::atomic<float> shown_[kTraces][kPoints] = {};
};

class MetaModModule final : public Module {
public:
    enum { Algorithm, Timbre, CarrierLevel, ModLevel, OscTune, OscShape, Mix, OscOctave, Quality, BitwiseOp };
    enum { CarrierL, CarrierR, Modulator, Pitch, Sync };
    enum { OutL, OutR, Osc, Env };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        scope_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"carrierIsOsc", carrierOsc_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
        out.push_back({"modulatorSource", (double)modSource_.load(std::memory_order_relaxed)});  // 0 input, 1 Osc, 2 silent
        out.push_back({"vocoder", vocoder_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        out.push_back({"carrier", scope_.trace(0)});
        out.push_back({"modulator", scope_.trace(1)});
        out.push_back({"out", scope_.trace(2)});
        std::vector<float> bands(MetaModDsp::kBands);
        for (int k = 0; k < MetaModDsp::kBands; ++k) bands[(size_t)k] = bands_[k].load(std::memory_order_relaxed);
        out.push_back({"bands", std::move(bands)});
    }

    void process(const ProcessContext& c) override {
        MetaModParams p;
        p.oscOctave = (int)setting(OscOctave) - 3;  // choice index 0..6 → −3..+3
        p.quality = (int)setting(Quality);
        p.bitwiseOp = (int)setting(BitwiseOp);
        patch::MetaModInput in;
        in.carrierLConnected = c.inputConnected[CarrierL];
        in.carrierRConnected = c.inputConnected[CarrierR];
        in.modConnected = c.inputConnected[Modulator];
        for (int i = 0; i < c.numSamples; ++i) {
            p.algorithm = value(c, Algorithm, i);
            p.timbre = value(c, Timbre, i);
            p.carrierLevel = value(c, CarrierLevel, i);
            p.modLevel = value(c, ModLevel, i);
            p.oscTune = value(c, OscTune, i);
            p.oscShape = value(c, OscShape, i);
            p.mix = value(c, Mix, i);
            in.carrierL = c.inputs[CarrierL][i];
            in.carrierR = c.inputs[CarrierR][i];
            in.modulator = c.inputs[Modulator][i];
            in.pitch = c.inputs[Pitch][i];
            in.sync = c.inputs[Sync][i];
            const auto f = dsp_.tick(p, in);
            c.outputs[OutL][i] = f.l;
            c.outputs[OutR][i] = f.r;
            c.outputs[Osc][i] = f.osc;
            c.outputs[Env][i] = f.env;
            const float carrier = in.carrierLConnected ? in.carrierL : f.osc;
            const float mod = in.modConnected ? in.modulator : in.carrierLConnected ? f.osc : 0.0f;
            const float traces[3] = {carrier, mod, f.l};
            scope_.push(traces);
        }
        carrierOsc_.store(!in.carrierLConnected, std::memory_order_relaxed);
        modSource_.store(in.modConnected ? 0 : in.carrierLConnected ? 1 : 2, std::memory_order_relaxed);
        vocoder_.store(dsp_.vocoderActive(), std::memory_order_relaxed);
        for (int k = 0; k < MetaModDsp::kBands; ++k) bands_[k].store(dsp_.bandLevel(k), std::memory_order_relaxed);
    }

private:
    MetaModDsp dsp_;
    Scope3 scope_;
    std::atomic<bool> carrierOsc_{true}, vocoder_{false};
    std::atomic<int> modSource_{2};
    std::atomic<float> bands_[MetaModDsp::kBands] = {};
};

}  // namespace

static void registerMetaModModule(Registry& r) {
    ModuleSpec s;
    s.type = "meta-mod";
    s.name = "Meta Mod";
    s.category = "Audio/Mangling";
    s.colour = "#84cc16";
    s.description = "Carrier meets modulator: one knob morphs through crossfade, fold, analog and digital ring, bitwise, "
                    "comparator, vocoder and Chebyshev; an internal oscillator fills in for a missing input.";
    s.params = {ParamSpec::number("algorithm", "Algorithm", 0.0f, 7.0f, 2.0f, "", 2),
                ParamSpec::percent("timbre", "Timbre", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("carrierLevel", "Carrier Level", 0.0f, 2.0f, 1.0f),
                ParamSpec::percent("modLevel", "Mod Level", 0.0f, 2.0f, 1.0f),
                ParamSpec::number("oscTune", "Osc Tune", -24.0f, 24.0f, 0.0f, "st", 1).inGroup("Oscillator"),
                ParamSpec::percent("oscShape", "Osc Shape", 0.0f, 1.0f, 0.0f).inGroup("Oscillator"),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
                ParamSpec::choice("oscOctave", "Osc Octave", {"-3", "-2", "-1", "0", "+1", "+2", "+3"}, 3),
                ParamSpec::choice("quality", "Quality", {"Eco (1×)", "Standard (2×)", "High (4×)"}, 1),
                ParamSpec::choice("bitwiseOp", "Bitwise Op", {"XOR", "AND", "OR", "Sum mod"}, 0)};
    s.inputs = {{"carrierL", "Carrier L", Signal::Audio}, {"carrierR", "Carrier R", Signal::Audio},
                {"modulator", "Modulator", Signal::Audio}, {"pitch", "Pitch", Signal::Pitch},
                {"sync", "Sync", Signal::Trigger}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true},
                 {"osc", "Osc", Signal::Audio, true}, {"env", "Env", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<MetaModModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerMetaModModule);

}  // namespace bleep::engine
