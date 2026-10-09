// SPDX-License-Identifier: MIT
// Uncertainty node (doc/specs/modules/uncertainty.md): six kinds of randomness.
#include "Registry.h"
#include "UncertaintyDsp.h"

#include <algorithm>
#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::UncertaintyDsp;

class UncertaintyModule final : public Module {
public:
    enum { F1Rate, F2Rate, F1Spread, F2Spread, QRate, StoreRate, Distribution, Correlation, Integrate,
           FSync, QSync, StoreSync, Q1Bits, Q2Bits, Q1Interval, Q2Interval, Q2Divide, Shape, Seed };
    enum { ClockQ1, ClockQ2, Store };
    enum { Fluct1, Fluct2, Quant1, Quant2, Stored, Integrated, StoreTrig };

    /// Scopes: the last 4 seconds of each value output in kPoints points.
    static constexpr int kPoints = 128;
    static constexpr int kTraces = 6;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        every_ = std::max(1, (int)(sampleRate * 4.0 / kPoints));
    }
    void reset() override { dsp_.reset(); }

    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        static const char* names[kTraces] = {"fluct1", "fluct2", "quant1", "quant2", "stored", "integrated"};
        const int w = write_.load(std::memory_order_acquire);
        for (int t = 0; t < kTraces; ++t) {
            std::vector<float> v((size_t)kPoints);
            for (int i = 0; i < kPoints; ++i) v[(size_t)i] = scope_[(size_t)t][(size_t)((w + i) % kPoints)].load(std::memory_order_relaxed);
            out.push_back({names[t], std::move(v)});
        }
        std::vector<float> s(64);
        const int sw = scatterWrite_.load(std::memory_order_acquire);
        for (int i = 0; i < 64; ++i) s[(size_t)i] = scatter_[(size_t)((sw + i) % 64)].load(std::memory_order_relaxed);
        out.push_back({"scatter", std::move(s)});
    }

    void process(const ProcessContext& c) override {
        patch::UncertaintyParams p;
        p.fSync = (int)setting(FSync);
        p.qSync = (int)setting(QSync);
        p.storeSync = (int)setting(StoreSync);
        p.bits = {(int)setting(Q1Bits), (int)setting(Q2Bits)};
        auto pick = [](const auto& list, float v) { return list[(size_t)std::clamp((int)v, 0, (int)list.size() - 1)]; };
        p.interval = {pick(UncertaintyDsp::kIntervals, setting(Q1Interval)), pick(UncertaintyDsp::kIntervals, setting(Q2Interval))};
        p.q2Divide = pick(UncertaintyDsp::kDivides, setting(Q2Divide));
        p.shape = (patch::UShape)std::clamp((int)setting(Shape), 0, 2);
        p.seed = (uint32_t)setting(Seed);
        patch::UncertaintyInput in;
        in.q1Patched = c.inputConnected[ClockQ1];
        in.q2Patched = c.inputConnected[ClockQ2];
        in.storePatched = c.inputConnected[Store];
        in.running = c.transport->playing && c.transport->ppqValid;
        in.bpm = c.transport->bpm;
        patch::UncertaintyFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.fRate = {cachedValue(c, F1Rate, i), cachedValue(c, F2Rate, i)};
            p.fSpread = {cachedValue(c, F1Spread, i), cachedValue(c, F2Spread, i)};
            p.qRate = cachedValue(c, QRate, i);
            p.storeRate = cachedValue(c, StoreRate, i);
            p.distribution = cachedValue(c, Distribution, i);
            p.correlation = cachedValue(c, Correlation, i);
            p.integrate = cachedValue(c, Integrate, i);
            in.clockQ1 = c.inputs[ClockQ1][i];
            in.clockQ2 = c.inputs[ClockQ2][i];
            in.store = c.inputs[Store][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, f);
            const float v[kTraces] = {f.fluct[0], f.fluct[1], f.quant[0], f.quant[1], f.stored, f.integrated};
            c.outputs[Fluct1][i] = v[0];
            c.outputs[Fluct2][i] = v[1];
            c.outputs[Quant1][i] = v[2];
            c.outputs[Quant2][i] = v[3];
            c.outputs[Stored][i] = v[4];
            c.outputs[Integrated][i] = v[5];
            c.outputs[StoreTrig][i] = f.storeTrig;
            if (f.storeTrig > 0.5f) {
                const int sw = scatterWrite_.load(std::memory_order_relaxed);
                scatter_[(size_t)sw].store(f.stored, std::memory_order_relaxed);
                scatterWrite_.store((sw + 1) % 64, std::memory_order_release);
            }
            if (++count_ >= every_) {
                count_ = 0;
                const int w = write_.load(std::memory_order_relaxed);
                for (int t = 0; t < kTraces; ++t) scope_[(size_t)t][(size_t)w].store(v[t], std::memory_order_relaxed);
                write_.store((w + 1) % kPoints, std::memory_order_release);
            }
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

    UncertaintyDsp dsp_;
    std::array<std::array<std::atomic<float>, kPoints>, kTraces> scope_{};
    std::atomic<int> write_{0};
    std::array<std::atomic<float>, 64> scatter_{};
    std::atomic<int> scatterWrite_{0};
    int every_ = 1500, count_ = 0;
    std::array<float, 32> knobNorm_ = [] {
        std::array<float, 32> a;
        a.fill(-1.0f);
        return a;
    }();
    std::array<float, 32> knobUnits_{};
};

}  // namespace

static void registerUncertaintyModule(Registry& r) {
    ModuleSpec s;
    s.type = "uncertainty";
    s.name = "Uncertainty";
    s.category = "Modulation";
    s.colour = "#db2777";
    s.description = "Six random generators: two fluctuating curves, two quantized steps, a shaped and correlated "
                    "stored value and its integral.";
    std::vector<std::string> sync;
    for (const char* n : dsp::syncNames()) sync.emplace_back(n);
    std::vector<std::string> intervals, divides;
    for (int n : UncertaintyDsp::kIntervals) intervals.push_back(n == 0 ? std::string("Even") : std::to_string(n) + " st");
    for (int n : UncertaintyDsp::kDivides) divides.push_back("/" + std::to_string(n));
    s.params = {ParamSpec::hertz("f1rate", "F1 Rate", 0.01f, 20.0f, 0.5f).inGroup("Fluctuating"),
                ParamSpec::hertz("f2rate", "F2 Rate", 0.01f, 20.0f, 0.17f).inGroup("Fluctuating"),
                ParamSpec::percent("f1spread", "F1 Spread", 0.0f, 1.0f, 1.0f).inGroup("Fluctuating"),
                ParamSpec::percent("f2spread", "F2 Spread", 0.0f, 1.0f, 1.0f).inGroup("Fluctuating"),
                ParamSpec::hertz("qrate", "Q Rate", 0.05f, 40.0f, 2.0f).inGroup("Quantized"),
                ParamSpec::hertz("storerate", "Store Rate", 0.05f, 40.0f, 1.0f).inGroup("Stored"),
                ParamSpec::percent("distribution", "Distribution", -1.0f, 1.0f, 0.0f).inGroup("Stored"),
                ParamSpec::percent("correlation", "Correlation", -0.95f, 0.95f, 0.0f).inGroup("Stored"),
                ParamSpec::exponential("integrate", "Integrate", 0.01f, 10.0f, 0.5f, "/s").inGroup("Stored"),
                ParamSpec::choice("fsync", "F Sync", sync, 0),
                ParamSpec::choice("qsync", "Q Sync", sync, 3),
                ParamSpec::choice("storesync", "Store Sync", sync, 4),
                ParamSpec::integer("q1bits", "Q1 Bits", 1, 4, 3),
                ParamSpec::integer("q2bits", "Q2 Bits", 1, 4, 2),
                ParamSpec::choice("q1interval", "Q1 Interval", intervals, 0),
                ParamSpec::choice("q2interval", "Q2 Interval", intervals, 0),
                ParamSpec::choice("q2divide", "Q2 Divide", divides, 1),
                ParamSpec::choice("shape", "Shape", {"Uniform", "Bell", "Edges"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.params[(size_t)UncertaintyModule::QRate] = s.params[(size_t)UncertaintyModule::QRate].when("qsync", 0, 0);
    s.params[(size_t)UncertaintyModule::StoreRate] = s.params[(size_t)UncertaintyModule::StoreRate].when("storesync", 0, 0);
    s.inputs = {{"clockq1", "Clock Q1", Signal::Trigger}, {"clockq2", "Clock Q2", Signal::Trigger},
                {"store", "Store", Signal::Trigger}};
    s.outputs = {{"fluct1", "Fluct 1", Signal::Control, true}, {"fluct2", "Fluct 2", Signal::Control, true},
                 {"quant1", "Quant 1", Signal::Control, false}, {"quant2", "Quant 2", Signal::Control, false},
                 {"stored", "Stored", Signal::Control, true},  {"integrated", "Integrated", Signal::Control, true},
                 {"storetrig", "Store Trig", Signal::Trigger, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<UncertaintyModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerUncertaintyModule);

}  // namespace bleep::engine
