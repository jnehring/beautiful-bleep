// SPDX-License-Identifier: GPL-3.0-only
// Limiter node (doc/limiter.md): a stereo-linked brickwall limiter with lookahead.
#include "LimiterDsp.h"
#include "Registry.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <vector>

namespace bleep::engine {
namespace {

using patch::LimiterDsp;
using patch::LimiterParams;

/// Raises a to v if v is larger (audio thread; the UI resets it on read).
void raise(std::atomic<float>& a, float v) noexcept {
    float prev = a.load(std::memory_order_relaxed);
    while (v > prev && !a.compare_exchange_weak(prev, v, std::memory_order_relaxed)) {}
}

constexpr float kLookaheadMs[] = {0.0f, 1.0f, 2.0f, 5.0f};

class LimiterModule final : public Module {
public:
    enum { Ceiling, Release, Input, Lookahead };
    enum { InL, InR };
    enum { OutL, OutR, Reduction };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    /// Peaks since the view last read them (so no short peak is missed) and RMS of the last block, for the
    /// input and output meters.
    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"reductionDb", (double)reduction_.load()});
        out.push_back({"inPeakL", (double)inPeak_[0].exchange(0.0f)});
        out.push_back({"inPeakR", (double)inPeak_[1].exchange(0.0f)});
        out.push_back({"outPeakL", (double)outPeak_[0].exchange(0.0f)});
        out.push_back({"outPeakR", (double)outPeak_[1].exchange(0.0f)});
        out.push_back({"inRmsL", (double)inRms_[0].load()});
        out.push_back({"inRmsR", (double)inRms_[1].load()});
        out.push_back({"outRmsL", (double)outRms_[0].load()});
        out.push_back({"outRmsR", (double)outRms_[1].load()});
        out.push_back({"stereo", stereo_.load() ? 1.0 : 0.0});
    }

    void process(const ProcessContext& c) override {
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        const int mode = std::clamp((int)std::lround(setting(Lookahead)), 0, 3);
        dsp_.setLookahead(std::max(1, (int)std::lround(kLookaheadMs[mode] * 0.001 * sampleRate_)));
        LimiterParams p;
        float worst = 1.0f;
        float inPeak[2] = {}, outPeak[2] = {}, inSq[2] = {}, outSq[2] = {};
        for (int i = 0; i < c.numSamples; ++i) {
            p.ceilingDb = value(c, Ceiling, i);
            p.releaseMs = value(c, Release, i);
            p.inputDb = value(c, Input, i);
            const float x[2] = {c.inputs[InL][i], inR[i]};
            float y[2];
            const float g = dsp_.tick(x, y, p);
            c.outputs[OutL][i] = y[0];
            c.outputs[OutR][i] = y[1];
            c.outputs[Reduction][i] = std::min(-20.0f * std::log10(std::max(g, 1e-6f)) * (1.0f / 12.0f), 1.0f);
            worst = std::min(worst, g);

            for (int ch = 0; ch < 2; ++ch) {
                inPeak[ch] = std::max(inPeak[ch], std::fabs(x[ch]));
                outPeak[ch] = std::max(outPeak[ch], std::fabs(y[ch]));
                inSq[ch] += x[ch] * x[ch];
                outSq[ch] += y[ch] * y[ch];
            }
        }
        reduction_.store(20.0f * std::log10(std::max(worst, 1e-6f)));
        const float inv = c.numSamples > 0 ? 1.0f / (float)c.numSamples : 0.0f;
        for (int ch = 0; ch < 2; ++ch) {
            raise(inPeak_[ch], inPeak[ch]);
            raise(outPeak_[ch], outPeak[ch]);
            inRms_[ch].store(std::sqrt(inSq[ch] * inv));
            outRms_[ch].store(std::sqrt(outSq[ch] * inv));
        }
        stereo_.store(c.inputConnected[InR]);
    }

private:
    LimiterDsp dsp_;
    std::atomic<float> reduction_{0.0f};
    mutable std::atomic<float> inPeak_[2]{}, outPeak_[2]{};
    std::atomic<float> inRms_[2]{}, outRms_[2]{};
    std::atomic<bool> stereo_{false};
};

}  // namespace

static void registerLimiterModule(Registry& r) {
    ModuleSpec s;
    s.type = "limiter";
    s.name = "Limiter";
    s.category = "Effects/Dynamics & EQ";
    s.colour = "#64748b";
    s.description = "Brickwall stereo limiter: nothing passes the ceiling. Lookahead, release, input gain "
                    "and a gain reduction output you can patch.";
    s.params = {ParamSpec::number("ceiling", "Ceiling", -12.0f, 0.0f, -0.3f, "dB", 1),
                ParamSpec::exponential("release", "Release", 10.0f, 1000.0f, 100.0f, "ms"),
                ParamSpec::number("input", "Input", 0.0f, 24.0f, 0.0f, "dB", 1),
                ParamSpec::choice("lookahead", "Lookahead", {"Off", "1 ms", "2 ms", "5 ms"}, 2)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true},
                 {"reduction", "Reduction", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<LimiterModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerLimiterModule);

}  // namespace bleep::engine
