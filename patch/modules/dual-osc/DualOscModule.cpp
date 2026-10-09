// SPDX-License-Identifier: MIT
// Dual Osc node (doc/specs/modules/dual-oscillator.md): two cores with B → A FM,
// A → B sync and a stereo wavefolder; a scope of A, B and Out for the view.
#include "DualOscDsp.h"
#include "Registry.h"

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::DualOscDsp;
using patch::DualOscParams;

class DualOscModule final : public Module {
public:
    enum {
        OctaveA, TuneA, FineA, ShapeA, WidthA,
        OctaveB, TuneB, FineB, ShapeB,
        FmDepth, SyncAmt, Balance, Fold, Symmetry, Drift, Width,
        FmMode, BTrack, BRange, Quality, Seed
    };
    enum { Pitch, PitchB, Fm, Sync, FoldCv };
    enum { A, B, Mix, OutL, OutR, Ring, Sub };

    static constexpr int kScope = 128;  ///< points per trace

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        holdoff_ = idle_ = 0;
        capturing_ = false;
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"foldIn", (double)foldIn_.load(std::memory_order_relaxed)});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        const int b = shown_.load(std::memory_order_acquire);
        if (b < 0) return;
        static const char* names[3] = {"scopeA", "scopeB", "scopeOut"};
        for (int t = 0; t < 3; ++t) {
            std::vector<float> v(kScope);
            for (int i = 0; i < kScope; ++i) v[(size_t)i] = scope_[(size_t)b][(size_t)t][(size_t)i].load(std::memory_order_relaxed);
            out.push_back({names[t], std::move(v)});
        }
    }

    void process(const ProcessContext& c) override {
        dsp_.setOversampling(setting(Quality) >= 0.5f ? 4 : 2);
        const auto seed = (uint32_t)setting(Seed);
        if (c.transportStarted || seed != dsp_.seed()) dsp_.resetDrift(seed);

        DualOscParams p;
        p.expFm = setting(FmMode) >= 0.5f;
        p.lowRange = setting(BRange) >= 0.5f;
        const bool track = setting(BTrack) >= 0.5f;
        bool want[DualOscDsp::kOutputs];
        for (int k = 0; k < DualOscDsp::kOutputs; ++k) want[k] = c.isOutputConnected(k);
        const float* sync = c.inputs[Sync];
        for (int i = 0; i < c.numSamples; ++i) {
            const float pitch = c.inputs[Pitch][i];
            p.pitchA = value(c, OctaveA, i) + value(c, TuneA, i) / 12.0f + value(c, FineA, i) / 1200.0f + pitch;
            p.pitchB = value(c, OctaveB, i) + value(c, TuneB, i) / 12.0f + value(c, FineB, i) / 1200.0f +
                       c.inputs[PitchB][i] + (track ? pitch : 0.0f);
            p.shapeA = value(c, ShapeA, i);
            p.widthA = value(c, WidthA, i);
            p.shapeB = value(c, ShapeB, i);
            p.fmDepth = value(c, FmDepth, i);
            p.sync = value(c, SyncAmt, i);
            p.balance = value(c, Balance, i);
            p.fold = value(c, Fold, i);
            p.symmetry = value(c, Symmetry, i);
            p.drift = value(c, Drift, i);
            p.width = value(c, Width, i);
            const bool edge = sync[i] >= 0.5f && lastSync_ < 0.5f;
            lastSync_ = sync[i];
            const auto f = dsp_.process(p, c.inputs[Fm][i], c.inputs[FoldCv][i], edge, want);
            c.outputs[A][i] = f.a;
            c.outputs[B][i] = f.b;
            c.outputs[Mix][i] = f.mix;
            c.outputs[OutL][i] = f.outL;
            c.outputs[OutR][i] = f.outR;
            c.outputs[Ring][i] = f.ring;
            c.outputs[Sub][i] = f.sub;
            scope(p, f.a, f.b, f.outL);
        }
        foldIn_.store(dsp_.foldInput(), std::memory_order_relaxed);
    }

private:
    /// The view's scope: A, B and Out over two cycles of B, started on B's
    /// wrap, at most ~30 captures per second; very slow B: a 100 ms window.
    void scope(const DualOscParams& p, float a, float b, float out) noexcept {
        const double ph = dsp_.phaseB();
        const bool wrapped = ph < lastPhaseB_;
        lastPhaseB_ = ph;
        if (!capturing_) {
            if (holdoff_ > 0) {
                --holdoff_;
                return;
            }
            if (!wrapped && ++idle_ < (int)(0.1 * sampleRate_)) return;
            idle_ = 0;
            const double hzB = dsp::osc::pitchToHz(p.pitchB) * (p.lowRange ? 0.01 : 1.0);
            const double window = std::min(2.0 / std::max(hzB, 1e-3), 0.1) * sampleRate_;
            step_ = std::max(window / kScope, 1e-3);
            pos_ = 0.0;
            index_ = 0;
            capturing_ = true;
            writing_ = shown_.load(std::memory_order_relaxed) == 0 ? 1 : 0;
        }
        while (capturing_ && pos_ <= 0.0) {
            scope_[(size_t)writing_][0][(size_t)index_].store(a, std::memory_order_relaxed);
            scope_[(size_t)writing_][1][(size_t)index_].store(b, std::memory_order_relaxed);
            scope_[(size_t)writing_][2][(size_t)index_].store(out, std::memory_order_relaxed);
            pos_ += step_;
            if (++index_ >= kScope) {
                capturing_ = false;
                shown_.store(writing_, std::memory_order_release);
                holdoff_ = (int)(sampleRate_ / 30.0);
            }
        }
        pos_ -= 1.0;
    }

    DualOscDsp dsp_;
    float lastSync_ = 0.0f;
    std::atomic<float> foldIn_{0.0f};
    std::array<std::array<std::array<std::atomic<float>, kScope>, 3>, 2> scope_{};
    std::atomic<int> shown_{-1};
    int writing_ = 0, index_ = 0, holdoff_ = 0, idle_ = 0;
    double lastPhaseB_ = 0.0, pos_ = 0.0, step_ = 1.0;
    bool capturing_ = false;
};

}  // namespace

static void registerDualOscModule(Registry& r) {
    ModuleSpec s;
    s.type = "dual-osc";
    s.name = "Dual Osc";
    s.category = "Sources";
    s.colour = "#2dd4bf";
    s.description = "Two analog cores with B → A FM, sync and a stereo wavefolder: a complete complex-oscillator voice.";
    auto tune = [](const char* id, const char* name) { return ParamSpec::number(id, name, -12.0f, 12.0f, 0.0f, "st", 1); };
    auto fine = [](const char* id, const char* name) { return ParamSpec::number(id, name, -100.0f, 100.0f, 0.0f, "ct", 0); };
    s.params = {ParamSpec::steppedInt("octaveA", "Octave A", -4, 4, 0).inGroup("Osc A"),
                tune("tuneA", "Tune A").inGroup("Osc A"),
                fine("fineA", "Fine A").inGroup("Osc A"),
                ParamSpec::percent("shapeA", "Shape A", 0.0f, 1.0f, 0.67f).inGroup("Osc A"),
                ParamSpec::percent("widthA", "Width A", 0.05f, 0.95f, 0.5f).inGroup("Osc A"),
                ParamSpec::steppedInt("octaveB", "Octave B", -4, 4, -1).inGroup("Osc B"),
                tune("tuneB", "Tune B").inGroup("Osc B"),
                fine("fineB", "Fine B").inGroup("Osc B"),
                ParamSpec::percent("shapeB", "Shape B", 0.0f, 1.0f, 0.0f).inGroup("Osc B"),
                ParamSpec::percent("fmDepth", "FM Depth", 0.0f, 1.0f, 0.0f).inGroup("Cross"),
                ParamSpec::percent("sync", "Sync", 0.0f, 1.0f, 0.0f).inGroup("Cross"),
                ParamSpec::percent("balance", "Balance", 0.0f, 1.0f, 0.5f).inGroup("Cross"),
                ParamSpec::percent("fold", "Fold", 0.0f, 1.0f, 0.0f).inGroup("Folder"),
                ParamSpec::number("symmetry", "Symmetry", -1.0f, 1.0f, 0.0f).inGroup("Folder"),
                ParamSpec::percent("drift", "Drift", 0.0f, 1.0f, 0.1f).inGroup("Folder"),
                ParamSpec::percent("width", "Width", 0.0f, 1.0f, 0.0f).inGroup("Folder"),
                ParamSpec::choice("fmMode", "FM Mode", {"Linear", "Exponential"}, 0),
                ParamSpec::toggle("bTrack", "B Track", true),
                ParamSpec::choice("bRange", "B Range", {"Audio", "Low"}, 0),
                ParamSpec::choice("quality", "Quality", {"Normal (2×)", "High (4×)"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch},
                {"pitchB", "Pitch B", Signal::Pitch},
                {"fm", "FM", Signal::Audio},
                {"sync", "Sync", Signal::Trigger},
                {"foldCv", "Fold CV", Signal::Audio}};
    s.outputs = {{"a", "A", Signal::Audio, true},         {"b", "B", Signal::Audio, true},
                 {"mix", "Mix", Signal::Audio, true},     {"outL", "Out L", Signal::Audio, true},
                 {"outR", "Out R", Signal::Audio, true},  {"ring", "Ring", Signal::Audio, true},
                 {"sub", "Sub", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<DualOscModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerDualOscModule);

}  // namespace bleep::engine
