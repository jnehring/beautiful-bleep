// SPDX-License-Identifier: MIT
// Folder node (specs/modules/wavefolder.md): stereo six-stage wavefolder with
// tap crossfade, symmetry, anti-aliasing (oversampling + ADAA) and an
// internal sine/triangle oscillator.
#include "Registry.h"
#include "WavefolderDsp.h"

#include <atomic>

namespace bleep::engine {
namespace {

using patch::WavefolderDsp;
using patch::WavefolderParams;

/// A triggered two-trace scope for the view: 128 points over about 20 ms,
/// started at a rising zero crossing of the reference trace (free-running when
/// none comes). The audio thread writes, the message thread reads (atomics).
class Scope {
public:
    static constexpr int kPoints = 128;
    void prepare(double sampleRate) noexcept { decimate_ = std::max(1, (int)std::lround(0.02 * sampleRate / kPoints)); }
    void push(float ref, float trace) noexcept {
        if (n_ < 0) {  // armed: wait for a rising zero crossing (or give up after one window)
            if ((lastRef_ < 0.0f && ref >= 0.0f) || ++wait_ > kPoints * decimate_) n_ = 0, count_ = 0, wait_ = 0;
            lastRef_ = ref;
            if (n_ < 0) return;
        }
        lastRef_ = ref;
        if (count_++ % decimate_) return;
        a_[n_] = ref, b_[n_] = trace;
        if (++n_ == kPoints) {
            for (int i = 0; i < kPoints; ++i) {
                ref_[i].store(a_[i], std::memory_order_relaxed);
                trace_[i].store(b_[i], std::memory_order_relaxed);
            }
            n_ = -1;
        }
    }
    std::vector<float> ref() const { return read(ref_); }
    std::vector<float> trace() const { return read(trace_); }

private:
    static std::vector<float> read(const std::atomic<float>* a) {
        std::vector<float> v(kPoints);
        for (int i = 0; i < kPoints; ++i) v[(size_t)i] = a[i].load(std::memory_order_relaxed);
        return v;
    }
    int decimate_ = 8, n_ = -1, count_ = 0, wait_ = 0;
    float lastRef_ = 0.0f;
    float a_[kPoints] = {}, b_[kPoints] = {};
    std::atomic<float> ref_[kPoints] = {}, trace_[kPoints] = {};
};

class WavefolderModule final : public Module {
public:
    enum { Fold, Symmetry, Tap, Shape, Spread, Level, Mix, Wave, Coarse, Fine, FmDepth, Source, Octave, Quality };
    enum { InL, InR, Pitch };
    enum { OutL, OutR, Osc };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        scope_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        // The transfer curve of the chain up to Tap, for x = −2 … +2 after Level.
        dsp::Folder::Params p;
        p.gain = std::exp2(2.0f * view_[0].load(std::memory_order_relaxed));
        p.symmetry = view_[1].load(std::memory_order_relaxed);
        p.shape = view_[2].load(std::memory_order_relaxed);
        p.tap = view_[3].load(std::memory_order_relaxed);
        std::vector<float> curve(kCurve);
        for (int i = 0; i < kCurve; ++i)
            curve[(size_t)i] = dsp::Folder::transfer(-2.0f + 4.0f * (float)i / (float)(kCurve - 1), p);
        out.push_back({"transfer", std::move(curve)});
        out.push_back({"range", {view_[4].load(std::memory_order_relaxed), view_[5].load(std::memory_order_relaxed)}});
        out.push_back({"dry", scope_.ref()});
        out.push_back({"wet", scope_.trace()});
    }

    void process(const ProcessContext& c) override {
        WavefolderParams p;
        p.source = (int)setting(Source);
        p.octave = (int)setting(Octave) - 3;  // choice index 0..6 → −3..+3
        p.quality = (int)setting(Quality);
        patch::WavefolderInput in;
        in.lConnected = c.inputConnected[InL];
        in.rConnected = c.inputConnected[InR];
        in.pitchConnected = c.inputConnected[Pitch];
        dsp_.clearInputRange();
        for (int i = 0; i < c.numSamples; ++i) {
            p.fold = value(c, Fold, i);
            p.symmetry = value(c, Symmetry, i);
            p.tap = value(c, Tap, i);
            p.shape = value(c, Shape, i);
            p.spread = value(c, Spread, i);
            p.level = value(c, Level, i);
            p.mix = value(c, Mix, i);
            p.wave = value(c, Wave, i);
            p.coarse = value(c, Coarse, i);
            p.fine = value(c, Fine, i);
            p.fmDepth = value(c, FmDepth, i);
            in.l = c.inputs[InL][i];
            in.r = c.inputs[InR][i];
            in.pitch = c.inputs[Pitch][i];
            const auto f = dsp_.tick(p, in);
            c.outputs[OutL][i] = f.l;
            c.outputs[OutR][i] = f.r;
            c.outputs[Osc][i] = f.osc;
            scope_.push(dsp_.dryL(), f.l);
        }
        // For the view: the last effective settings and a slowly released input range.
        lo_ = std::min(dsp_.inputMin(), lo_ * kRelease);
        hi_ = std::max(dsp_.inputMax(), hi_ * kRelease);
        const float vals[6] = {p.fold, dsp_.symmetryNow(), p.shape, p.tap, lo_, hi_};
        for (int k = 0; k < 6; ++k) view_[k].store(vals[k], std::memory_order_relaxed);
    }

private:
    static constexpr int kCurve = 129;
    static constexpr float kRelease = 0.995f;
    WavefolderDsp dsp_;
    Scope scope_;
    float lo_ = 0.0f, hi_ = 0.0f;
    std::atomic<float> view_[6] = {};
};

}  // namespace

static void registerWavefolderModule(Registry& r) {
    ModuleSpec s;
    s.type = "wavefolder";
    s.name = "Folder";
    s.category = "Audio";
    s.colour = "#10b981";
    s.description = "Stereo six-stage wavefolder with tap crossfade, symmetry and an internal oscillator, "
                    "anti-aliased for audio.";
    s.params = {ParamSpec::percent("fold", "Fold", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("symmetry", "Symmetry", -1.0f, 1.0f, 0.0f),
                ParamSpec::number("tap", "Tap", 1.0f, 6.0f, 6.0f, "", 2),
                ParamSpec::percent("shape", "Shape", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("spread", "Spread", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("wave", "Wave", 0.0f, 1.0f, 0.0f).inGroup("Oscillator"),
                ParamSpec::number("coarse", "Coarse", -24.0f, 24.0f, 0.0f, "st", 1).inGroup("Oscillator"),
                ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0).inGroup("Oscillator"),
                ParamSpec::percent("fm", "FM Depth", 0.0f, 1.0f, 0.0f).inGroup("Oscillator"),
                ParamSpec::choice("source", "Source", {"Auto", "Input", "Internal"}, 0),
                ParamSpec::choice("octave", "Octave", {"-3", "-2", "-1", "0", "+1", "+2", "+3"}, 3),
                ParamSpec::choice("quality", "Quality", {"Eco (2×)", "Normal (4×)"}, 1)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}, {"pitch", "Pitch", Signal::Pitch}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true},
                 {"osc", "Osc", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<WavefolderModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerWavefolderModule);

}  // namespace bleep::engine
