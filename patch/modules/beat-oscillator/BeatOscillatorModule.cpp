// SPDX-License-Identifier: GPL-3.0-only
// Beat Oscillator node (doc/specs/modules/beat-oscillator.md): two high carriers
// mixed down to their difference tone, with injection locking (Pull), seeded
// drift and a warm-up glide.
#include "BeatOscillatorDsp.h"
#include "Registry.h"

#include <algorithm>
#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::BeatOscillatorDsp;

class BeatOscillatorModule final : public Module {
public:
    enum { Carrier, Beat, Fine, Pull, Detector, Drift, DetuneRange, Range, Mixer, Coupling, Warmup, Seed };
    enum { Pitch, Detune, Fm };
    enum { Out, A, B, BeatOut, Lock };
    enum { Cold };  // buttons

    static constexpr float kRanges[3] = {20.0f, 200.0f, 2000.0f};
    static constexpr float kWarmups[4] = {0.0f, 10.0f, 30.0f, 120.0f};

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"fA", (double)fA_.load(std::memory_order_relaxed)});
        out.push_back({"fB", (double)fB_.load(std::memory_order_relaxed)});
        out.push_back({"nomA", (double)nomA_.load(std::memory_order_relaxed)});
        out.push_back({"nomB", (double)nomB_.load(std::memory_order_relaxed)});
        out.push_back({"df", (double)df_.load(std::memory_order_relaxed)});
        out.push_back({"detune", (double)detune_.load(std::memory_order_relaxed)});
        out.push_back({"lockHz", (double)lockHz_.load(std::memory_order_relaxed)});
        out.push_back({"psi", (double)psi_.load(std::memory_order_relaxed)});
        out.push_back({"lock", lock_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
        out.push_back({"slips", (double)(slips_.load(std::memory_order_relaxed) % 1000000u)});
        out.push_back({"playing", playing_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
    }

    void process(const ProcessContext& c) override {
        bool cold = false;
        pollCommands([&](const Command& cmd) {
            if (cmd.index == Cold && cmd.value > 0.5f) cold = true;
        });
        patch::BeatOscillatorParams p;
        const float range = kRanges[std::clamp((int)setting(Range), 0, 2)];
        p.mixer = std::clamp((int)setting(Mixer), 0, 2);
        p.dcCoupled = setting(Coupling) >= 0.5f;
        p.warmupSeconds = kWarmups[std::clamp((int)setting(Warmup), 0, 3)];
        p.seed = (uint32_t)setting(Seed);
        p.voice = c.voice;
        patch::BeatOscillatorInput in;
        in.running = c.transport->playing && c.transport->ppqValid;
        in.fmPatched = c.inputConnected[Fm];
        patch::BeatOscillatorFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            const float x = cachedValue(c, Beat, i);
            p.carrierHz = cachedValue(c, Carrier, i);
            p.offsetHz = range * x * x * x + cachedValue(c, Fine, i);
            p.pull = cachedValue(c, Pull, i);
            p.detector = cachedValue(c, Detector, i);
            p.drift = cachedValue(c, Drift, i);
            p.detuneRangeHz = cachedValue(c, DetuneRange, i);
            in.pitch = c.inputs[Pitch][i];
            in.detune = c.inputs[Detune][i];
            in.fm = c.inputs[Fm][i];
            in.started = c.transportStarted && i == 0;
            in.cold = cold && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, f);
            c.outputs[Out][i] = f.out;
            c.outputs[A][i] = f.a;
            c.outputs[B][i] = f.b;
            c.outputs[BeatOut][i] = f.beat;
            c.outputs[Lock][i] = f.lock;
        }
        fA_.store((float)dsp_.actualA(), std::memory_order_relaxed);
        fB_.store((float)dsp_.actualB(), std::memory_order_relaxed);
        nomA_.store((float)dsp_.nominalA(), std::memory_order_relaxed);
        nomB_.store((float)dsp_.nominalB(), std::memory_order_relaxed);
        const double detune = dsp_.detuneHz();
        detune_.store((float)detune, std::memory_order_relaxed);
        df_.store((float)(detune < 0.0 ? -dsp_.measuredBeatHz() : dsp_.measuredBeatHz()), std::memory_order_relaxed);
        lockHz_.store((float)BeatOscillatorDsp::lockRangeHz(p.pull), std::memory_order_relaxed);
        psi_.store((float)dsp_.psi(), std::memory_order_relaxed);
        lock_.store(dsp_.locked(), std::memory_order_relaxed);
        slips_.store(dsp_.slips(), std::memory_order_relaxed);
        playing_.store(in.running, std::memory_order_relaxed);
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

    BeatOscillatorDsp dsp_;
    std::atomic<float> fA_{0.0f}, fB_{0.0f}, nomA_{0.0f}, nomB_{0.0f}, df_{0.0f}, detune_{0.0f}, lockHz_{0.0f}, psi_{0.0f};
    std::atomic<bool> lock_{false}, playing_{false};
    std::atomic<uint32_t> slips_{0};
    std::array<float, 16> knobNorm_ = [] {
        std::array<float, 16> a;
        a.fill(-1.0f);
        return a;
    }();
    std::array<float, 16> knobUnits_{};
};

}  // namespace

static void registerBeatOscillatorModule(Registry& r) {
    ModuleSpec s;
    s.type = "beat-oscillator";
    s.name = "Beat Oscillator";
    s.category = "Sources/Oscillators";
    s.colour = "#e879f9";
    s.description = "Two high carriers mixed down to their difference: a heterodyne tone that sweeps from kilohertz to a slow "
                    "pulse. Pull makes them lock and stutter, Drift makes them wander.";
    // Beat: b = Range · x³ with x in −1…+1 (the knob shows x; the view shows hertz).
    // Detune Range: a Skew map with centre 25 Hz is exactly 200 · x³.
    auto detuneRange = ParamSpec::number("detuneRange", "Detune Range", 0.0f, 200.0f, 20.0f, "Hz", 1);
    detuneRange.map = ParamSpec::Map::Skew;
    detuneRange.centre = 25.0f;
    detuneRange.format = ParamSpec::Format::Hertz;
    s.params = {ParamSpec::hertz("carrier", "Carrier", 500.0f, 18000.0f, 10000.0f),
                ParamSpec::percent("beat", "Beat", -1.0f, 1.0f, 0.50764f),  // +261.6 Hz on ±2 kHz
                ParamSpec::number("fine", "Fine", -2.0f, 2.0f, 0.0f, "Hz", 2),
                ParamSpec::percent("pull", "Pull", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("detector", "Detector", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("drift", "Drift", 0.0f, 1.0f, 0.15f),
                detuneRange,
                ParamSpec::choice("range", "Range", {"\xc2\xb1" "20 Hz", "\xc2\xb1" "200 Hz", "\xc2\xb1" "2 kHz"}, 2),
                ParamSpec::choice("mixer", "Mixer", {"Ideal", "Diode", "Overdriven"}, 0),
                ParamSpec::choice("coupling", "Coupling", {"AC", "DC"}, 0),
                ParamSpec::choice("warmup", "Warm-up", {"Off", "10 s", "30 s", "2 min"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch}, {"detune", "Detune", Signal::Control}, {"fm", "FM", Signal::Audio}};
    s.outputs = {{"out", "Out", Signal::Audio, true},
                 {"a", "A", Signal::Audio, true},
                 {"b", "B", Signal::Audio, true},
                 {"beat", "Beat", Signal::Pitch, true},
                 {"lock", "Lock", Signal::Gate, false}};
    s.buttons = {{"cold", "Cold"}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<BeatOscillatorModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerBeatOscillatorModule);

}  // namespace bleep::engine
