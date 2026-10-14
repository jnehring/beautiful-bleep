// SPDX-License-Identifier: MIT
// Test Oscillator node (doc/specs/modules/test-oscillator.md): a lamp-stabilised
// bridge oscillator with a calibrated dial, a range switch and a loop that
// bounces, drifts, hums and, below 100 % loop gain, rings when kicked.
#include "Registry.h"
#include "TestOscillatorDsp.h"

#include <algorithm>
#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::TestOscillatorDsp;

class TestOscillatorModule final : public Module {
public:
    enum { Frequency, Fine, Fm, LoopGain, Settle, Drift, Kick, Level, Range, WarmUp, Mains, PowerUp, Seed };
    enum { PitchIn, FmIn, KickIn, AudioIn };
    enum { Sine, Square, Sync, Lamp };
    enum { OnLoad, OnPlay };

    /// The scope (§5): two periods of Sine, triggered on Sync, in kPoints points.
    static constexpr int kPoints = 128;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.setSeed(seed_, voice_);
        dsp_.prepare(sampleRate);
        capturing_ = false;
        sinceScope_ = 0;
    }
    void reset() override { dsp_.powerUp(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"lamp", (double)lamp_.load(std::memory_order_relaxed)});
        out.push_back({"freq", (double)freq_.load(std::memory_order_relaxed)});
        out.push_back({"drift", (double)drift_.load(std::memory_order_relaxed)});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> v((size_t)kPoints);
        for (int i = 0; i < kPoints; ++i) v[(size_t)i] = scope_[(size_t)i].load(std::memory_order_relaxed);
        out.push_back({"scope", std::move(v)});
    }

    void process(const ProcessContext& c) override {
        const uint32_t seed = (uint32_t)setting(Seed);
        const int mode = (int)setting(PowerUp);
        if (seed != seed_ || c.voice != voice_ || !started_) {
            const bool seedChanged = started_ && seed != seed_;
            seed_ = seed;
            voice_ = c.voice;
            dsp_.setSeed(seed_, voice_);
            if (!started_ || (seedChanged && mode == OnLoad)) dsp_.powerUp();
            started_ = true;
        }
        if (mode == OnPlay && c.transportStarted) dsp_.powerUp();

        patch::TestOscillatorParams p;
        p.range = (int)setting(Range);
        p.warmUp = setting(WarmUp) >= 0.5f;
        p.mains = (int)setting(Mains);
        patch::TestOscillatorInput in;
        in.audioPatched = c.inputConnected[AudioIn];
        patch::TestOscillatorFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.frequency = cachedValue(c, Frequency, i);
            p.fineCents = cachedValue(c, Fine, i);
            p.fm = cachedValue(c, Fm, i);
            p.loopGain = cachedValue(c, LoopGain, i);
            p.settle = cachedValue(c, Settle, i);
            p.drift = cachedValue(c, Drift, i);
            p.kick = cachedValue(c, Kick, i);
            p.level = cachedValue(c, Level, i);
            in.pitch = c.inputs[PitchIn][i];
            in.fm = c.inputs[FmIn][i];
            in.kick = c.inputs[KickIn][i];
            in.audio = c.inputs[AudioIn][i];
            dsp_.tick(p, in, f);
            c.outputs[Sine][i] = f.sine;
            c.outputs[Square][i] = f.square;
            c.outputs[Sync][i] = f.sync;
            c.outputs[Lamp][i] = f.lamp;
            scope(f);
        }
        lamp_.store(f.lamp, std::memory_order_relaxed);
        freq_.store((float)dsp_.frequency(), std::memory_order_relaxed);
        drift_.store((float)dsp_.driftCents(), std::memory_order_relaxed);
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

    /// Two periods of Sine from a Sync pulse, linearly interpolated into
    /// kPoints points; at most 30 captures a second. Without Sync (a silent
    /// loop) the last capture stays: the scope freezes.
    void scope(const patch::TestOscillatorFrame& f) noexcept {
        ++sinceScope_;
        if (!capturing_) {
            if (f.sync > 0.5f && sinceScope_ >= (int64_t)(sampleRate_ / 30.0)) {
                capturing_ = true;
                point_ = 0;
                pos_ = 0.0;
                step_ = 2.0 * sampleRate_ / std::max(dsp_.frequency(), 1.0) / (kPoints - 1);
                capture_[0] = f.sine;
                point_ = 1;
            }
            prev_ = f.sine;
            return;
        }
        pos_ += 1.0;
        while (point_ < kPoints && point_ * step_ <= pos_) {
            const double frac = 1.0 - (pos_ - point_ * step_);  // 0 at the previous sample, 1 at this one
            capture_[(size_t)point_++] = prev_ + (float)frac * (f.sine - prev_);
        }
        prev_ = f.sine;
        if (point_ >= kPoints) {
            for (int i = 0; i < kPoints; ++i) scope_[(size_t)i].store(capture_[(size_t)i], std::memory_order_relaxed);
            capturing_ = false;
            sinceScope_ = 0;
        }
    }

    TestOscillatorDsp dsp_;
    uint32_t seed_ = 1;
    int voice_ = -1;
    bool started_ = false;
    bool capturing_ = false;
    int point_ = 0;
    double pos_ = 0.0, step_ = 1.0;
    float prev_ = 0.0f;
    int64_t sinceScope_ = 0;
    std::array<float, kPoints> capture_{};
    std::array<std::atomic<float>, kPoints> scope_{};
    std::atomic<float> lamp_{0.0f}, freq_{0.0f}, drift_{0.0f};
    std::array<float, 16> knobNorm_ = [] {
        std::array<float, 16> a;
        a.fill(-1.0f);
        return a;
    }();
    std::array<float, 16> knobUnits_{};
};

}  // namespace

static void registerTestOscillatorModule(Registry& r) {
    ModuleSpec s;
    s.type = "test-oscillator";
    s.name = "Test Oscillator";
    s.category = "Sources/Oscillators";
    s.colour = "#f59e0b";
    s.description = "A lamp-stabilised sine from a self-oscillating loop: it bounces, warms up and hums; below 100 % it rings when kicked.";
    ParamSpec settle = ParamSpec::exponential("settle", "Settle", 0.005f, 2.0f, 0.25f);
    settle.format = ParamSpec::Format::Seconds;
    s.params = {ParamSpec::exponential("freq", "Frequency", 1.0f, 10.0f, 4.4f),
                ParamSpec::number("fine", "Fine", -50.0f, 50.0f, 0.0f, "ct", 0),
                ParamSpec::percent("fm", "FM", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("loopgain", "Loop Gain", 0.0f, 3.0f, 1.2f),
                settle,
                ParamSpec::percent("drift", "Drift", 0.0f, 1.0f, 0.4f),
                ParamSpec::percent("kick", "Kick", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 1.0f),
                ParamSpec::choice("range", "Range", {"×1", "×10", "×100", "×1k"}, 2),
                ParamSpec::toggle("warmup", "Warm-up", true),
                ParamSpec::choice("mains", "Mains", {"Off", "50 Hz", "60 Hz"}, 1),
                ParamSpec::choice("powerup", "Power-up", {"On load", "On play"}, 1),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch},
                {"fm", "FM", Signal::Audio},
                {"kick", "Kick", Signal::Trigger},
                {"audio", "Audio In", Signal::Audio}};
    s.outputs = {{"sine", "Sine", Signal::Audio, true},
                 {"square", "Square", Signal::Audio, true},
                 {"sync", "Sync", Signal::Trigger, false},
                 {"lamp", "Lamp", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<TestOscillatorModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerTestOscillatorModule);

}  // namespace bleep::engine
