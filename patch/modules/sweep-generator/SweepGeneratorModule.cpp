// SPDX-License-Identifier: MIT
// Sweep Generator node (doc/specs/modules/sweep-generator.md): a function
// generator with a built-in frequency sweep, sweep ramp, pitch, marker, End
// and Sync outputs.
#include "Registry.h"
#include "SweepGeneratorDsp.h"

#include <algorithm>
#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::SweepGeneratorDsp;

class SweepGeneratorModule final : public Module {
public:
    enum {
        Start, Stop, Time, Symmetry, Marker1, Marker2, Marker3, Fm, Drift, Level,
        Waveform, Mode, SweepSync, Law, Direction, Retrace, BurstCount, Markers, MarkerWidth, PhaseReset, Warmup, Seed
    };
    enum { Trigger, Gate, Hold, Pitch, FmIn, AmIn };
    enum { Out, Sweep, Freq, Marker, MarkerGate, End, Sync };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    /// The dot and the readout: progress, position, frequency, cycle length.
    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"p", (double)p_.load(std::memory_order_relaxed)});
        out.push_back({"s", (double)s_.load(std::memory_order_relaxed)});
        out.push_back({"hz", (double)hz_.load(std::memory_order_relaxed)});
        out.push_back({"length", (double)length_.load(std::memory_order_relaxed)});
        out.push_back({"waiting", waiting_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
    }

    void process(const ProcessContext& c) override {
        patch::SweepParams p;
        p.wave = (int)setting(Waveform);
        p.mode = (int)setting(Mode);
        p.sync = (int)setting(SweepSync);
        p.lin = setting(Law) >= 0.5f;
        p.direction = (int)setting(Direction);
        p.glide = setting(Retrace) >= 0.5f;
        p.burstCount = (int)setting(BurstCount);
        p.markers = (int)setting(Markers);
        p.markerWidthMs = patch::kSweepMarkerWidthsMs[(size_t)std::clamp((int)setting(MarkerWidth), 0, 5)];
        p.phaseReset = setting(PhaseReset) >= 0.5f;
        p.warmupSeconds = patch::kSweepWarmupSeconds[(size_t)std::clamp((int)setting(Warmup), 0, 3)];
        p.seed = (uint32_t)setting(Seed);
        patch::SweepInput in;
        in.running = c.transport->playing && c.transport->ppqValid;
        in.bpm = c.transport->bpm;
        patch::SweepFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.startHz = cachedValue(c, Start, i);
            p.stopHz = cachedValue(c, Stop, i);
            p.sweepSeconds = cachedValue(c, Time, i);
            p.symmetry = cachedValue(c, Symmetry, i);
            p.markerHz = {cachedValue(c, Marker1, i), cachedValue(c, Marker2, i), cachedValue(c, Marker3, i)};
            p.fm = cachedValue(c, Fm, i);
            p.drift = cachedValue(c, Drift, i);
            p.level = cachedValue(c, Level, i);
            in.trigger = c.inputs[Trigger][i];
            in.gate = c.inputs[Gate][i];
            in.hold = c.inputs[Hold][i];
            in.pitch = c.inputs[Pitch][i];
            in.fm = c.inputs[FmIn][i];
            in.am = c.inputs[AmIn][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, f);
            c.outputs[Out][i] = f.out;
            c.outputs[Sweep][i] = f.sweep;
            c.outputs[Freq][i] = f.freq;
            c.outputs[Marker][i] = f.marker;
            c.outputs[MarkerGate][i] = f.markerGate;
            c.outputs[End][i] = f.end;
            c.outputs[Sync][i] = f.sync;
        }
        p_.store((float)dsp_.progress(), std::memory_order_relaxed);
        s_.store((float)dsp_.sweepPosition(), std::memory_order_relaxed);
        hz_.store((float)dsp_.frequency(), std::memory_order_relaxed);
        length_.store((float)dsp_.cycleSeconds(), std::memory_order_relaxed);
        waiting_.store(p.mode == 1 && dsp_.waiting(), std::memory_order_relaxed);
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

    SweepGeneratorDsp dsp_;
    std::atomic<float> p_{0.0f}, s_{0.0f}, hz_{100.0f}, length_{4.0f};
    std::atomic<bool> waiting_{false};
    std::array<float, 16> knobNorm_ = [] {
        std::array<float, 16> a;
        a.fill(-1.0f);
        return a;
    }();
    std::array<float, 16> knobUnits_{};
};

ParamSpec hertzKnob(const char* id, const char* name, float def) {
    return ParamSpec::hertz(id, name, 0.01f, 20000.0f, def);
}

}  // namespace

static void registerSweepGeneratorModule(Registry& r) {
    ModuleSpec s;
    s.type = "sweep-generator";
    s.name = "Sweep Generator";
    s.category = "Sources";
    s.colour = "#fb923c";
    s.description = "A function generator that glides from Start to Stop: risers, sirens, tone bursts, and a sweep "
                    "ramp, pitch and marker triggers for gear that follows it.";
    std::vector<std::string> sync;
    for (const char* n : patch::sweepSyncNames()) sync.emplace_back(n);
    ParamSpec time = ParamSpec::exponential("time", "Sweep Time", 0.01f, 100.0f, 4.0f);
    time.format = ParamSpec::Format::Seconds;
    ParamSpec symmetry = ParamSpec::percent("symmetry", "Symmetry", -1.0f, 1.0f, 0.0f);
    s.params = {hertzKnob("start", "Start", 100.0f),
                hertzKnob("stop", "Stop", 5000.0f),
                time.when("sweepsync", 0, 0),
                symmetry,
                hertzKnob("marker1", "Marker 1", 250.0f).when("markers", 1, 3),
                hertzKnob("marker2", "Marker 2", 1000.0f).when("markers", 2, 3),
                hertzKnob("marker3", "Marker 3", 4000.0f).when("markers", 3, 3),
                ParamSpec::percent("fm", "FM", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("drift", "Drift", 0.0f, 1.0f, 0.15f),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 0.8f),
                ParamSpec::choice("waveform", "Waveform", {"Sine", "Triangle", "Square", "Ramp Up", "Ramp Down", "Pulse"}, 0),
                ParamSpec::choice("mode", "Mode", {"Continuous", "Triggered", "Gated", "Burst"}, 0),
                ParamSpec::choice("sweepsync", "Sweep Sync", sync, 0),
                ParamSpec::choice("law", "Law", {"Log", "Lin"}, 0),
                ParamSpec::choice("direction", "Direction", {"Up", "Down", "Up-Down"}, 0),
                ParamSpec::choice("retrace", "Retrace", {"Instant", "Glide"}, 0).when("direction", 0, 1),
                ParamSpec::integer("burstcount", "Burst Count", 1, 64, 4).when("mode", 3, 3),
                ParamSpec::integer("markers", "Markers", 0, 3, 0),
                ParamSpec::choice("markerwidth", "Marker Width", {"1 ms", "5 ms", "10 ms", "25 ms", "50 ms", "100 ms"}, 2)
                    .when("markers", 1, 3),
                ParamSpec::toggle("phasereset", "Phase Reset", false),
                ParamSpec::choice("warmup", "Warm-up", {"Off", "10 s", "30 s", "2 min"}, 2),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"trigger", "Trigger", Signal::Trigger}, {"gate", "Gate", Signal::Gate},
                {"hold", "Hold", Signal::Gate},          {"pitch", "Pitch", Signal::Pitch},
                {"fm", "FM", Signal::Audio},             {"am", "AM", Signal::Audio}};
    s.outputs = {{"out", "Out", Signal::Audio, true},
                 {"sweep", "Sweep", Signal::Control, false},
                 {"freq", "Freq", Signal::Pitch, true},
                 {"marker", "Marker", Signal::Trigger, false},
                 {"markergate", "Marker Gate", Signal::Gate, false},
                 {"end", "End", Signal::Trigger, false},
                 {"sync", "Sync", Signal::Trigger, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SweepGeneratorModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerSweepGeneratorModule);

}  // namespace bleep::engine
