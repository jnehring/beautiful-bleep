// SPDX-License-Identifier: MIT
// Coin Toss node (specs/modules/coin-toss.md): two seeded probability routers.
#include "CoinTossDsp.h"
#include "Registry.h"

#include <algorithm>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::CoinTossDsp;

class CoinTossModule final : public Module {
public:
    enum { Prob1, Prob2, Memory1, Memory2, Mode1, Mode2, Link, Loop, Seed };
    enum { In1, In2, Reset };
    enum { A1, B1, A2, B2, Coin1, Coin2 };

    using Module::Module;

    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"coin1", coin_[0].load() ? 1.0 : 0.0});
        out.push_back({"coin2", coin_[1].load() ? 1.0 : 0.0});
        out.push_back({"history1", (double)history_[0].load()});
        out.push_back({"history2", (double)history_[1].load()});
        out.push_back({"count1", (double)count_[0].load()});
        out.push_back({"count2", (double)count_[1].load()});
    }

    void process(const ProcessContext& c) override {
        if (c.transportStarted) dsp_.restart();
        patch::CoinTossParams p;
        p.mode[0] = (patch::CoinMode)std::clamp((int)setting(Mode1), 0, 2);
        p.mode[1] = (patch::CoinMode)std::clamp((int)setting(Mode2), 0, 2);
        p.link = (patch::CoinLink)std::clamp((int)setting(Link), 0, 2);
        p.loop = CoinTossDsp::kLoops[(size_t)std::clamp((int)setting(Loop), 0, (int)CoinTossDsp::kLoops.size() - 1)];
        p.seed = (uint32_t)setting(Seed);
        // In 2 unpatched listens to In 1 (spec 2): a second decision on the same edges.
        const float* in2 = c.inputConnected[In2] ? c.inputs[In2] : c.inputs[In1];
        patch::CoinTossFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.probability[0] = value(c, Prob1, i);
            p.probability[1] = value(c, Prob2, i);
            p.memory[0] = value(c, Memory1, i);
            p.memory[1] = value(c, Memory2, i);
            dsp_.tick(p, c.inputs[In1][i], in2[i], c.inputs[Reset][i], f);
            c.outputs[A1][i] = f.a[0];
            c.outputs[B1][i] = f.b[0];
            c.outputs[A2][i] = f.a[1];
            c.outputs[B2][i] = f.b[1];
            c.outputs[Coin1][i] = f.coin[0];
            c.outputs[Coin2][i] = f.coin[1];
        }
        for (int k = 0; k < 2; ++k) {
            coin_[(size_t)k].store(!dsp_.lastB(k));
            history_[(size_t)k].store(dsp_.history(k));
            count_[(size_t)k].store(dsp_.count(k));
        }
    }

private:
    CoinTossDsp dsp_;
    std::array<std::atomic<bool>, 2> coin_{};
    std::array<std::atomic<uint32_t>, 2> history_{};
    std::array<std::atomic<int64_t>, 2> count_{};
};

}  // namespace

static void registerCoinTossModule(Registry& r) {
    ModuleSpec s;
    s.type = "coin-toss";
    s.name = "Coin Toss";
    s.category = "Utility";
    s.colour = "#7c3aed";
    s.description = "Sends each gate to A or B by a weighted, seeded coin. Two channels: independent, nested or opposed.";
    std::vector<std::string> loops;
    for (int n : CoinTossDsp::kLoops) loops.push_back(n == 0 ? std::string("Off") : std::to_string(n) + " tosses");
    const std::vector<std::string> modes{"Trigger", "Latch", "Toggle"};
    s.params = {ParamSpec::percent("prob1", "Probability 1", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("prob2", "Probability 2", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("memory1", "Memory 1", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("memory2", "Memory 2", 0.0f, 1.0f, 0.0f),
                ParamSpec::choice("mode1", "Mode 1", modes, 0),
                ParamSpec::choice("mode2", "Mode 2", modes, 0),
                ParamSpec::choice("link", "Link", {"Independent", "Shared", "Opposed"}, 0),
                ParamSpec::choice("loop", "Loop", loops, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"in1", "In 1", Signal::Gate}, {"in2", "In 2", Signal::Gate}, {"reset", "Reset", Signal::Trigger}};
    s.outputs = {{"a1", "A 1", Signal::Gate, false},          {"b1", "B 1", Signal::Gate, false},
                 {"a2", "A 2", Signal::Gate, false},          {"b2", "B 2", Signal::Gate, false},
                 {"coin1", "Coin 1", Signal::Control, false}, {"coin2", "Coin 2", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<CoinTossModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerCoinTossModule);

}  // namespace bleep::engine
