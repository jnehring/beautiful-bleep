// SPDX-License-Identifier: GPL-3.0-or-later
// Quad LFO node (doc/specs/modules/quad-lfo.md): four LFOs, free, in quadrature,
// spread in phase or divided from one rate; synced or clocked.
#include "QuadLfoDsp.h"
#include "Registry.h"

#include <array>
#include <atomic>
#include <string>

namespace bleep::engine {
namespace {

using patch::QuadLfoDsp;

class QuadLfoModule final : public Module {
public:
    enum {
        Rate1, Rate2, Rate3, Rate4, Level1, Level2, Level3, Level4, Spread, PulseWidth, Mode,
        Wave1, Wave2, Wave3, Wave4, Divide1, Divide2, Divide3, Divide4, Sync, ClockRatio, Polarity, Seed
    };
    enum { Reset, Clock, Hold };
    enum { Out1, Out2, Out3, Out4, Sum, Cycle1, Cycle2, Cycle3, Cycle4 };
    static constexpr int kChannels = QuadLfoDsp::kChannels;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        for (int k = 0; k < kChannels; ++k) out.push_back({"phase" + std::to_string(k + 1), (double)phase_[(size_t)k].load()});
        out.push_back({"clocked", clocked_.load() ? 1.0 : 0.0});
        out.push_back({"bpm", (double)bpm_.load()});
    }

    void process(const ProcessContext& c) override {
        patch::QuadParams p;
        p.mode = (int)setting(Mode);
        for (int k = 0; k < kChannels; ++k) {
            p.wave[k] = (int)setting(Wave1 + k);
            p.divide[k] = (int)setting(Divide1 + k);
        }
        p.sync = setting(Sync) >= 0.5f;
        p.clockRatio = (int)setting(ClockRatio);
        p.unipolar = setting(Polarity) >= 0.5f;
        p.seed = (uint32_t)setting(Seed);
        const Transport& tr = *c.transport;
        patch::QuadTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        const bool clockPatched = c.inputConnected[Clock];
        patch::QuadFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            for (int k = 0; k < kChannels; ++k) {
                p.rate[k] = c.params[Rate1 + k][i];  // normalised: Hz, or a note value with Sync
                p.level[k] = value(c, Level1 + k, i);
            }
            p.spread = value(c, Spread, i) / 360.0f;
            p.pulseWidth = value(c, PulseWidth, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            dsp_.tick(p, c.inputs[Reset][i], c.inputs[Clock][i], clockPatched, c.inputs[Hold][i], t, f);
            for (int k = 0; k < kChannels; ++k) {
                c.outputs[Out1 + k][i] = f.out[k];
                c.outputs[Cycle1 + k][i] = f.cycle[k];
            }
            c.outputs[Sum][i] = f.sum;
        }
        for (int k = 0; k < kChannels; ++k) phase_[(size_t)k].store((float)dsp_.phase(k));
        clocked_.store(dsp_.clocked());
        bpm_.store((float)dsp_.clockBpm());
    }

private:
    QuadLfoDsp dsp_;
    std::array<std::atomic<float>, kChannels> phase_{};
    std::atomic<bool> clocked_{false};
    std::atomic<float> bpm_{120.0f};
};

}  // namespace

static void registerQuadLfoModule(Registry& r) {
    ModuleSpec s;
    s.type = "quad-lfo";
    s.name = "Quad LFO";
    s.category = "Modulation/LFOs";
    s.colour = "#ea580c";
    s.description = "Four LFOs: independent, in quadrature, spread in phase or divided from one rate. Free, synced or clocked.";
    const std::vector<std::string> waves = {"Sine", "Triangle", "Saw Up", "Saw Down", "Square", "Random Step", "Random Smooth"};
    std::vector<std::string> divides, pulses;
    for (int i = 0; i < QuadLfoDsp::kDivides; ++i) divides.emplace_back(QuadLfoDsp::divideName(i));
    for (int i = 0; i < QuadLfoDsp::kClockRatios; ++i) pulses.emplace_back(std::to_string(QuadLfoDsp::clockPulses(i)));
    const float rates[4] = {1.0f, 1.5f, 2.0f, 3.0f};
    const int divideDefaults[4] = {3, 4, 5, 6};  // ÷1, ÷2, ÷3, ÷4
    for (int k = 0; k < 4; ++k) {
        const std::string n = std::to_string(k + 1);
        auto rate = ParamSpec::hertz("rate" + n, "Rate " + n, 0.01f, 50.0f, rates[k]).inGroup("Rates");
        s.params.push_back(k == 0 ? rate : rate.when("mode", 0, 0));
    }
    for (int k = 0; k < 4; ++k) {
        const std::string n = std::to_string(k + 1);
        s.params.push_back(ParamSpec::percent("level" + n, "Level " + n, -1.0f, 1.0f, 1.0f).inGroup("Levels"));
    }
    s.params.push_back(ParamSpec::number("spread", "Spread", 0.0f, 360.0f, 90.0f, "\xc2\xb0", 0).inGroup("Shape").when("mode", 2, 2));
    s.params.push_back(ParamSpec::percent("pw", "Pulse Width", 0.05f, 0.95f, 0.5f).inGroup("Shape"));
    s.params.push_back(ParamSpec::choice("mode", "Mode", {"Free", "Quadrature", "Phase", "Divide"}, 1));
    for (int k = 0; k < 4; ++k) s.params.push_back(ParamSpec::choice("wave" + std::to_string(k + 1), "Wave " + std::to_string(k + 1), waves, 0));
    for (int k = 0; k < 4; ++k)
        s.params.push_back(ParamSpec::choice("divide" + std::to_string(k + 1), "Divide " + std::to_string(k + 1), divides,
                                             divideDefaults[k])
                               .when("mode", 3, 3));
    s.params.push_back(ParamSpec::toggle("sync", "Sync", false));
    s.params.push_back(ParamSpec::choice("clockratio", "Clock Ratio", pulses, 3));
    s.params.push_back(ParamSpec::choice("polarity", "Polarity", {"Bipolar", "Unipolar"}, 0));
    s.params.push_back(ParamSpec::integer("seed", "Seed", 0, 999, 1));
    s.inputs = {{"reset", "Reset", Signal::Trigger}, {"clock", "Clock", Signal::Trigger}, {"hold", "Hold", Signal::Gate}};
    for (int k = 1; k <= 4; ++k) s.outputs.push_back({"out" + std::to_string(k), "Out " + std::to_string(k), Signal::Control, true});
    s.outputs.push_back({"sum", "Sum", Signal::Control, true});
    for (int k = 1; k <= 4; ++k)
        s.outputs.push_back({"cycle" + std::to_string(k), "Cycle " + std::to_string(k), Signal::Trigger, false});
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<QuadLfoModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerQuadLfoModule);

}  // namespace bleep::engine
