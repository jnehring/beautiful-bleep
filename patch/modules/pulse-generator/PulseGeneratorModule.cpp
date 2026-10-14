// SPDX-License-Identifier: MIT
// Pulse Generator node (doc/specs/modules/pulse-generator.md): timed pulses with
// delay, width, slewed edges, bursts and double pulses, band-limited, with a
// ringing resonance on every edge.
#include "PulseGeneratorDsp.h"
#include "Registry.h"

#include <algorithm>
#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::PulseGeneratorDsp;

class PulseGeneratorModule final : public Module {
public:
    enum {
        Period, Width, WidthPct, Delay, DelayPct, Rise, Fall, Amplitude, Offset, Jitter, Ring, RingFreq, Damping,
        Mode, Sync, Units, Double, Burst, Polarity, Warmup, Seed, NumParams
    };
    enum { Trigger, Gate, Reset, Pitch };
    enum { Out, GateOut, SyncOut, RingOut };
    enum { SingleButton };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    /// The lamps (Duty latched until the view reads it) and the effective
    /// timing in seconds, for the diagram.
    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"duty", duty_.exchange(false) ? 1.0 : 0.0});
        out.push_back({"warming", warming_.load() ? 1.0 : 0.0});
        out.push_back({"period", (double)period_.load()});
        out.push_back({"width", (double)width_.load()});
        out.push_back({"delay", (double)delay_.load()});
        out.push_back({"pos", (double)pos_.load()});
    }

    void process(const ProcessContext& c) override {
        bool single = false;
        pollCommands([&](const Command& cmd) { single = single || (cmd.index == SingleButton && cmd.value > 0.5f); });
        patch::PulseGeneratorParams p;
        p.mode = (int)setting(Mode);
        p.sync = (int)setting(Sync);
        p.percent = setting(Units) >= 0.5f;
        p.doublePulse = setting(Double) >= 0.5f;
        p.burst = (int)setting(Burst);
        p.complement = setting(Polarity) >= 0.5f;
        p.warmup = setting(Warmup) >= 0.5f;
        p.seed = (uint32_t)setting(Seed);
        patch::PulseGeneratorInput in;
        in.gatePatched = c.inputConnected[Gate];
        in.running = c.transport->playing && c.transport->ppqValid;
        in.bpm = c.transport->bpm;
        in.ppqPerSample = c.ppqPerSample;
        in.voice = c.voice;
        patch::PulseGeneratorFrame f;
        bool duty = false;
        for (int i = 0; i < c.numSamples; ++i) {
            p.periodSec = cachedValue(c, Period, i);
            p.widthSec = cachedValue(c, Width, i);
            p.widthPct = cachedValue(c, WidthPct, i);
            p.delaySec = cachedValue(c, Delay, i);
            p.delayPct = cachedValue(c, DelayPct, i);
            p.rise = cachedValue(c, Rise, i);
            p.fall = cachedValue(c, Fall, i);
            p.amplitude = cachedValue(c, Amplitude, i);
            p.offset = cachedValue(c, Offset, i);
            p.jitter = cachedValue(c, Jitter, i);
            p.ring = cachedValue(c, Ring, i);
            p.ringHz = cachedValue(c, RingFreq, i);
            p.damping = cachedValue(c, Damping, i);
            in.trigger = c.inputs[Trigger][i];
            in.gate = c.inputs[Gate][i];
            in.reset = c.inputs[Reset][i];
            in.pitch = c.inputs[Pitch][i];
            in.single = single && i == 0;
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, f);
            c.outputs[Out][i] = f.out;
            c.outputs[GateOut][i] = f.gate;
            c.outputs[SyncOut][i] = f.sync;
            c.outputs[RingOut][i] = f.ring;
            duty = duty || f.duty;
        }
        if (duty) duty_.store(true);
        warming_.store(f.warming);
        const double sr = sampleRate_ > 0.0 ? sampleRate_ : 48000.0;
        period_.store((float)(dsp_.periodSamples() / sr));
        width_.store((float)(dsp_.widthSamples() / sr));
        delay_.store((float)(dsp_.delaySamples() / sr));
        pos_.store((float)dsp_.position());
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

    PulseGeneratorDsp dsp_;
    mutable std::atomic<bool> duty_{false};
    std::atomic<bool> warming_{false};
    std::atomic<float> period_{0.1f}, width_{0.01f}, delay_{0.0f}, pos_{0.0f};
    std::array<float, NumParams> knobNorm_ = [] {
        std::array<float, NumParams> a;
        a.fill(-1.0f);
        return a;
    }();
    std::array<float, NumParams> knobUnits_{};
};

/// A modulatable time knob on an exponential map, shown in seconds.
ParamSpec expSeconds(std::string id, std::string name, float min, float max, float def) {
    ParamSpec p = ParamSpec::exponential(std::move(id), std::move(name), min, max, def);
    p.format = ParamSpec::Format::Seconds;
    return p;
}

}  // namespace

static void registerPulseGeneratorModule(Registry& r) {
    ModuleSpec s;
    s.type = "pulse-generator";
    s.name = "Pulse Generator";
    s.category = "Sources/Generators";
    s.colour = "#facc15";
    s.description = "A lab pulse generator: exactly timed pulses with delay, width, slewed edges, bursts and double "
                    "pulses. Its edges ring like a badly terminated cable: clicks, pings and small drums.";
    std::vector<std::string> sync;
    for (const char* n : dsp::syncNames()) sync.emplace_back(n);
    s.params = {
        expSeconds("period", "Period", 20e-6f, 10.0f, 0.1f).inGroup("Timing").when("mode", 0, 2),
        expSeconds("width", "Width", 1e-6f, 5.0f, 0.01f).inGroup("Timing").when("units", 0, 0),
        ParamSpec::percent("widthpct", "Width", 0.0f, 1.0f, 0.1f).inGroup("Timing").when("units", 1, 1),
        ParamSpec::seconds("delay", "Delay", 0.0f, 10.0f, 0.01f, 0.0f).inGroup("Timing").when("units", 0, 0),
        ParamSpec::percent("delaypct", "Delay", 0.0f, 1.0f, 0.0f).inGroup("Timing").when("units", 1, 1),
        ParamSpec::percent("rise", "Rise", 0.0f, 1.0f, 0.0f).inGroup("Timing"),
        ParamSpec::percent("fall", "Fall", 0.0f, 1.0f, 0.0f).inGroup("Timing"),
        ParamSpec::percent("amplitude", "Amplitude", 0.0f, 1.0f, 1.0f).inGroup("Level"),
        ParamSpec::number("offset", "Offset", -1.0f, 1.0f, 0.0f).inGroup("Level"),
        ParamSpec::percent("jitter", "Jitter", 0.0f, 1.0f, 0.0f).inGroup("Level").when("mode", 0, 2),
        ParamSpec::percent("ring", "Ring", 0.0f, 1.0f, 0.0f).inGroup("Ring"),
        ParamSpec::hertz("ringfreq", "Ring Freq", 20.0f, 20000.0f, 2000.0f).inGroup("Ring"),
        ParamSpec::percent("damping", "Damping", 0.0f, 1.0f, 0.5f).inGroup("Ring"),
        ParamSpec::choice("mode", "Mode", {"Free Run", "Triggered", "Gated", "External Width"}, 0),
        ParamSpec::choice("sync", "Sync", sync, 0).when("mode", 0, 0),
        ParamSpec::choice("units", "Time Units", {"Time", "% of Period"}, 0),
        ParamSpec::toggle("double", "Double", false).when("mode", 0, 2),
        ParamSpec::integer("burst", "Burst", 1, 64, 1).when("mode", 1, 1),
        ParamSpec::choice("polarity", "Polarity", {"Normal", "Complement"}, 0),
        ParamSpec::toggle("warmup", "Warm-up", false).when("mode", 0, 0),
        ParamSpec::integer("seed", "Seed", 0, 999, 1),
    };
    s.inputs = {{"trigger", "Trigger", Signal::Trigger},
                {"gate", "Gate", Signal::Gate},
                {"reset", "Reset", Signal::Trigger},
                {"pitch", "Pitch", Signal::Pitch}};
    s.outputs = {{"out", "Out", Signal::Audio, true},
                 {"gate", "Gate", Signal::Gate, false},
                 {"sync", "Sync", Signal::Trigger, false},
                 {"ring", "Ring", Signal::Audio, true}};
    s.buttons = {{"single", "Single"}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<PulseGeneratorModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerPulseGeneratorModule);

}  // namespace bleep::engine
