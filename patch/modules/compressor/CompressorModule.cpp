// SPDX-License-Identifier: GPL-3.0-or-later
// Compressor node (doc/compressor.md): a stereo-linked feed-forward compressor/limiter with a sidechain input.
#include "CompressorDsp.h"
#include "Registry.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <vector>

namespace bleep::engine {
namespace {

/// Raises a to v if v is larger (audio thread; the UI resets it on read).
void raise(std::atomic<float>& a, float v) noexcept {
    float prev = a.load(std::memory_order_relaxed);
    while (v > prev && !a.compare_exchange_weak(prev, v, std::memory_order_relaxed)) {}
}

constexpr int kHop = 256;      ///< samples per history point (5.3 ms at 48 kHz)
constexpr int kHistory = 400;  ///< points the view draws: about 2 seconds

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
    void reset() override {
        dsp_.reset();
        hop_ = Hop();
    }

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

    /// The last ~2 s, oldest first, one point per kHop samples: the input and output peaks (linear, louder
    /// channel) and the gain reduction (dB, 0 … negative). Stateless, so any number of views can read it.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> in((size_t)kHistory), wet((size_t)kHistory), gr((size_t)kHistory);
        const int head = head_.load(std::memory_order_acquire);  // next slot to be written = the oldest point
        for (int i = 0; i < kHistory; ++i) {
            const size_t k = (size_t)((head + i) % kHistory);
            in[(size_t)i] = histIn_[k].load(std::memory_order_relaxed);
            wet[(size_t)i] = histOut_[k].load(std::memory_order_relaxed);
            gr[(size_t)i] = histGr_[k].load(std::memory_order_relaxed);
        }
        out.emplace_back("historyIn", std::move(in));
        out.emplace_back("historyOut", std::move(wet));
        out.emplace_back("historyGr", std::move(gr));
    }

    void process(const ProcessContext& c) override {
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        const bool keyed = c.inputConnected[Key];
        CompressorParams p;
        p.rms = setting(Detector) >= 0.5f;
        float worst = 0.0f;
        float inPeak[2] = {}, outPeak[2] = {}, inSq[2] = {}, outSq[2] = {};
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

            const float o[2] = {c.outputs[OutL][i], c.outputs[OutR][i]};
            for (int ch = 0; ch < 2; ++ch) {
                inPeak[ch] = std::max(inPeak[ch], std::fabs(x[ch]));
                outPeak[ch] = std::max(outPeak[ch], std::fabs(o[ch]));
                inSq[ch] += x[ch] * x[ch];
                outSq[ch] += o[ch] * o[ch];
            }
            hop_.in = std::max(hop_.in, std::max(std::fabs(x[0]), std::fabs(x[1])));
            hop_.out = std::max(hop_.out, std::max(std::fabs(o[0]), std::fabs(o[1])));
            hop_.gr = std::min(hop_.gr, gr);
            if (++hop_.n == kHop) {
                const int h = head_.load(std::memory_order_relaxed);
                histIn_[(size_t)h].store(hop_.in, std::memory_order_relaxed);
                histOut_[(size_t)h].store(hop_.out, std::memory_order_relaxed);
                histGr_[(size_t)h].store(hop_.gr, std::memory_order_relaxed);
                head_.store((h + 1) % kHistory, std::memory_order_release);
                hop_ = Hop();
            }
        }
        reduction_.store(worst);
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
    /// The history point being filled (audio thread only).
    struct Hop {
        float in = 0.0f, out = 0.0f, gr = 0.0f;
        int n = 0;
    };

    CompressorDsp dsp_;
    std::atomic<float> reduction_{0.0f};
    Hop hop_;
    std::atomic<int> head_{0};
    std::atomic<float> histIn_[kHistory]{}, histOut_[kHistory]{}, histGr_[kHistory]{};
    mutable std::atomic<float> inPeak_[2]{}, outPeak_[2]{};
    std::atomic<float> inRms_[2]{}, outRms_[2]{};
    std::atomic<bool> stereo_{false};
};

}  // namespace

static void registerCompressorModule(Registry& r) {
    ModuleSpec s;
    s.type = "compressor";
    s.name = "Compressor";
    s.category = "Effects/Dynamics & EQ";
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
