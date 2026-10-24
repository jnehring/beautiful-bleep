// SPDX-License-Identifier: GPL-3.0-only
// Wobble node (doc/specs/modules/wobble.md): stepped, smooth and wobbling random.
#include "Registry.h"
#include "WobbleDsp.h"

#include <algorithm>
#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::WobbleDsp;

class WobbleModule final : public Module {
public:
    enum { Rate, Smooth, Wobble, Chaos, Burst, Level, Sync, BurstSize, Polarity, Seed };
    enum { Clock, Sample, Hold };
    enum { Stepped, SmoothOut, WobbleOut, BurstOut, ClockOut, Compare };

    /// The scope: the last four steps in kPoints points per trace.
    static constexpr int kPoints = 192;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        const int w = write_.load(std::memory_order_acquire);
        const char* names[4] = {"stepped", "smooth", "wobble", "burst"};
        for (int t = 0; t < 4; ++t) {
            std::vector<float> v((size_t)kPoints);
            for (int i = 0; i < kPoints; ++i) v[(size_t)i] = scope_[(size_t)t][(size_t)((w + i) % kPoints)].load(std::memory_order_relaxed);
            out.push_back({names[t], std::move(v)});
        }
    }

    void process(const ProcessContext& c) override {
        patch::WobbleParams p;
        p.sync = (int)setting(Sync);
        p.burstSize = (int)setting(BurstSize);
        p.unipolar = setting(Polarity) >= 0.5f;
        p.seed = (uint32_t)setting(Seed);
        patch::WobbleInput in;
        in.clockPatched = c.inputConnected[Clock];
        in.samplePatched = c.inputConnected[Sample];
        in.running = c.transport->playing && c.transport->ppqValid;
        in.bpm = c.transport->bpm;
        patch::WobbleFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.rateHz = cachedValue(c, Rate, i);
            p.smooth = cachedValue(c, Smooth, i);
            p.wobble = cachedValue(c, Wobble, i);
            p.chaos = cachedValue(c, Chaos, i);
            p.burst = cachedValue(c, Burst, i);
            p.level = cachedValue(c, Level, i);
            in.clock = c.inputs[Clock][i];
            in.sample = c.inputs[Sample][i];
            in.hold = c.inputs[Hold][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, f);
            c.outputs[Stepped][i] = f.stepped;
            c.outputs[SmoothOut][i] = f.smooth;
            c.outputs[WobbleOut][i] = f.wobble;
            c.outputs[BurstOut][i] = f.burst;
            c.outputs[ClockOut][i] = f.clock;
            c.outputs[Compare][i] = f.compare;
            scope(f, dsp_.stepSamples());
        }
    }

private:
    /// value(), recomputed only when the knob moves (fromNormalised may cost a pow).
    float cachedValue(const ProcessContext& c, int k, int s) noexcept {
        const float n = c.params[k][s];
        if (n < knobNorm_[(size_t)k] || n > knobNorm_[(size_t)k]) {
            knobNorm_[(size_t)k] = n;
            knobUnits_[(size_t)k] = value(c, k, s);
        }
        return knobUnits_[(size_t)k];
    }

    /// Decimates the outputs into the scope (four steps wide); bursts keep their peak.
    void scope(const patch::WobbleFrame& f, double stepSamples) noexcept {
        burstPeak_ = std::max(burstPeak_, f.burst);
        if (++count_ < std::max(1, (int)(4.0 * stepSamples / kPoints))) return;
        count_ = 0;
        const int w = write_.load(std::memory_order_relaxed);
        const float v[4] = {(float)dsp_.value(), (float)dsp_.smoothValue(), (float)WobbleDsp::softLimit(dsp_.wobbleValue()), burstPeak_};
        for (int t = 0; t < 4; ++t) scope_[(size_t)t][(size_t)w].store(v[t], std::memory_order_relaxed);
        write_.store((w + 1) % kPoints, std::memory_order_release);
        burstPeak_ = 0.0f;
    }

    WobbleDsp dsp_;
    std::array<std::array<std::atomic<float>, kPoints>, 4> scope_{};
    std::atomic<int> write_{0};
    int count_ = 0;
    float burstPeak_ = 0.0f;
    std::array<float, 32> knobNorm_ = [] {
        std::array<float, 32> a;
        a.fill(-1.0f);
        return a;
    }();
    std::array<float, 32> knobUnits_{};
};

}  // namespace

static void registerWobbleModule(Registry& r) {
    ModuleSpec s;
    s.type = "wobble";
    s.name = "Wobble";
    s.category = "Modulation/Random";
    s.colour = "#34d399";
    s.description = "One random stream in three shapes: Stepped jumps, Smooth glides, Wobble overshoots and rings.";
    std::vector<std::string> sync;
    for (const char* n : dsp::syncNames()) sync.emplace_back(n);
    s.params = {ParamSpec::hertz("rate", "Rate", 0.02f, 40.0f, 1.0f),
                ParamSpec::percent("smooth", "Smooth", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("wobble", "Wobble", 0.0f, 1.0f, 0.6f),
                ParamSpec::percent("chaos", "Chaos", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("burst", "Burst", 0.0f, 1.0f, 0.25f),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 1.0f),
                ParamSpec::choice("sync", "Sync", sync, 0),
                ParamSpec::integer("burstsize", "Burst Size", 2, 8, 4),
                ParamSpec::choice("polarity", "Polarity", {"Bipolar", "Unipolar"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"clock", "Clock", Signal::Trigger}, {"sample", "Sample", Signal::Control}, {"hold", "Hold", Signal::Gate}};
    s.outputs = {{"stepped", "Stepped", Signal::Control, true}, {"smooth", "Smooth", Signal::Control, true},
                 {"wobble", "Wobble", Signal::Control, true},   {"burst", "Burst", Signal::Trigger, false},
                 {"clock", "Clock", Signal::Trigger, false},    {"compare", "Compare", Signal::Gate, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<WobbleModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerWobbleModule);

}  // namespace bleep::engine
