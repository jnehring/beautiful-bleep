// SPDX-License-Identifier: GPL-3.0-or-later
// Rate Counter node (doc/specs/modules/rate-counter.md): measures how often an input
// repeats, either as a wave (frequency) or as a pulse train (tempo). The Tap button counts
// as an extra edge, so the module can also average a hand-tapped tempo.
#include "RateCounterDsp.h"
#include "Registry.h"

#include <algorithm>
#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using namespace patch;

constexpr int kPerBeat[9] = {1, 2, 3, 4, 6, 8, 12, 16, 24};

class RateCounterModule final : public Module {
public:
    enum { Mode, PerBeat, Average, Tolerance, Timeout };
    enum { In };
    enum { Hz, Bpm, AverageOut, Stable, Pulse };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"hz", hz_.load(std::memory_order_relaxed)});
        out.push_back({"bpm", bpm_.load(std::memory_order_relaxed)});
        out.push_back({"avg", avg_.load(std::memory_order_relaxed)});
        out.push_back({"stable", stable_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
        out.push_back({"active", active_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
        out.push_back({"count", (double)count_.load(std::memory_order_relaxed)});
    }

    /// "intervals": the last sixteen intervals in seconds, newest first (0 = none yet).
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> v(kRateHistory);
        for (size_t i = 0; i < v.size(); ++i) v[i] = hist_[i].load(std::memory_order_relaxed);
        out.push_back({"intervals", std::move(v)});
    }

    void process(const ProcessContext& c) override {
        pollCommands([&](const Command& cmd) {
            if (cmd.index == 0 && cmd.value > 0.5f) dsp_.tap();
            else if (cmd.index == 1 && cmd.value > 0.5f) dsp_.reset();
        });
        RateParams p;
        p.mode = (int)setting(Mode);
        p.perBeat = kPerBeat[std::clamp((int)setting(PerBeat), 0, 8)];
        p.average = (int)setting(Average);
        p.tolerance = value(c, Tolerance, 0);
        p.timeout = value(c, Timeout, 0);
        RateFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            f = dsp_.tick(p, c.inputs[In][i]);
            c.outputs[Hz][i] = f.hz;
            c.outputs[Bpm][i] = f.bpm;
            c.outputs[AverageOut][i] = f.average;
            c.outputs[Stable][i] = f.stable;
            c.outputs[Pulse][i] = f.pulse;
        }
        hz_.store(dsp_.hz(), std::memory_order_relaxed);
        bpm_.store(dsp_.bpm(p), std::memory_order_relaxed);
        avg_.store(dsp_.averageBpm(), std::memory_order_relaxed);
        stable_.store(f.stable > 0.5f, std::memory_order_relaxed);
        active_.store(dsp_.active(), std::memory_order_relaxed);
        count_.store(dsp_.intervals(), std::memory_order_relaxed);
        if (dsp_.edges() != edges_) {
            edges_ = dsp_.edges();
            for (int i = 0; i < kRateHistory; ++i)
                hist_[(size_t)i].store(i < dsp_.intervals() ? dsp_.interval(i) : 0.0f, std::memory_order_relaxed);
        }
    }

private:
    RateCounterDsp dsp_;
    uint32_t edges_ = 0;
    std::atomic<double> hz_{0.0}, bpm_{0.0}, avg_{0.0};
    std::atomic<bool> stable_{false}, active_{false};
    std::atomic<int> count_{0};
    std::array<std::atomic<float>, kRateHistory> hist_{};
};

}  // namespace

static void registerRateCounterModule(Registry& r) {
    ModuleSpec s;
    s.type = "rate-counter";
    s.name = "Rate Counter";
    s.category = "Utility/Metering";
    s.colour = "#fdba74";
    s.description = "Measures how often something repeats: the frequency of a wave or the tempo of a pulse train. Outputs the "
                    "rate as pitch and as BPM, a tap-averaged BPM and a gate that goes high while the rate holds steady.";
    auto tol = ParamSpec::percent("tolerance", "Steady Within", 0.005f, 0.25f, 0.05f);
    auto timeout = ParamSpec::exponential("timeout", "Start Over After", 1.0f, 20.0f, 4.0f, "s");
    s.params = {ParamSpec::choice("mode", "Input Is", {"Wave", "Pulse Train"}, 0),
                ParamSpec::choice("perbeat", "Per Beat", {"1", "2", "3", "4", "6", "8", "12", "16", "24"}, 0),
                ParamSpec::steppedInt("average", "Average Of", 2, 16, 4),
                tol,
                timeout};
    s.buttons = {{"tap", "Tap", true}, {"clear", "Clear"}};
    s.inputs = {{"in", "In", Signal::Audio}};
    s.outputs = {{"hz", "Rate", Signal::Pitch, true},
                 {"bpm", "BPM", Signal::Control, false},
                 {"average", "Average BPM", Signal::Control, false},
                 {"stable", "Steady", Signal::Gate, false},
                 {"pulse", "Edge", Signal::Trigger, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<RateCounterModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerRateCounterModule);

}  // namespace bleep::engine
