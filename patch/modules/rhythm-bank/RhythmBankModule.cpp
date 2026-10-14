// SPDX-License-Identifier: MIT
// Rhythm Bank node (doc/specs/modules/rhythm-bank.md): four related rhythms
// from a Family and a Pattern number, stepped by the transport or a clock.
#include "RhythmBankDsp.h"
#include "Registry.h"
#include "dsp/SeqClock.h"

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::kRbOutputs;
using patch::RhythmBankDsp;

class RhythmBankModule final : public Module {
public:
    enum { Pattern, Rotate1, Rotate2, Rotate3, Rotate4, Width, Family, Length, Rate, Complement, Change, Grid, Mute1,
           Mute2, Mute3, Mute4, Output, SyncTo };
    enum { Clock, Reset };
    enum { Out1, Out2, Out3, Out4, Any, Accent, Cycle };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"step", (double)step_.load()});
        out.push_back({"family", (double)family_.load()});
        out.push_back({"pattern", (double)pattern_.load()});
        out.push_back({"length", (double)length_.load()});
        out.push_back({"next", (double)next_.load()});
        out.push_back({"pending", pending_.load() ? 1.0 : 0.0});
    }
    /// The playing rows as the view draws them: 4 × L hits (rotated, muted,
    /// complemented), the Accent row, Poly Free positions, and the gates.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        const int family = family_.load(), P = pattern_.load(), len = length_.load();
        const int L = len > 0 ? len : patch::kRbOpenCycle;
        const auto pt = patch::rbPattern(family, P, L, setting(Grid) >= 0.5f && family == patch::RbPoly);
        int rotate[kRbOutputs];
        bool mute[kRbOutputs];
        for (int j = 0; j < kRbOutputs; ++j) {
            rotate[j] = (int)setting(Rotate1 + j);
            mute[j] = setting(Mute1 + j) >= 0.5f;
        }
        std::vector<float> rows((size_t)(kRbOutputs * L)), accent((size_t)L), gates;
        for (int i = 0; i < L; ++i) {
            const auto h = patch::rbStep(pt, family, P, len == 0, i, rotate, mute, (int)setting(Complement));
            for (int j = 0; j < kRbOutputs; ++j)
                rows[(size_t)(j * L + i)] = ((h.bits >> j) & 1) ? 1.0f + h.frac[j] : 0.0f;
            accent[(size_t)i] = h.accent ? 1.0f : 0.0f;
        }
        for (int j = 0; j < kRbOutputs; ++j) gates.push_back(gates_[(size_t)j].load() ? 1.0f : 0.0f);
        out.push_back({"rows", std::move(rows)});
        out.push_back({"accent", std::move(accent)});
        out.push_back({"gates", std::move(gates)});
    }

    void process(const ProcessContext& c) override {
        patch::RbParams p;
        p.family = (int)setting(Family);
        p.length = patch::rbLength((int)setting(Length));
        p.rate = (int)setting(Rate);
        p.complement = (int)setting(Complement);
        p.changeOnStep = setting(Change) < 0.5f;
        p.freeGrid = setting(Grid) >= 0.5f;
        p.trigger = setting(Output) >= 0.5f;
        for (int j = 0; j < kRbOutputs; ++j) p.mute[j] = setting(Mute1 + j) >= 0.5f;
        const Transport& tr = *c.transport;
        patch::RbInput in;
        in.clocked = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        in.running = tr.playing && tr.ppqValid;
        in.bpm = tr.bpm;
        patch::RbOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            p.pattern = (int)value(c, Pattern, i);
            for (int j = 0; j < kRbOutputs; ++j) p.rotate[j] = (int)value(c, Rotate1 + j, i);
            p.width = value(c, Width, i);
            in.clock = c.inputs[Clock][i];
            in.reset = c.inputs[Reset][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, o);
            for (int j = 0; j < kRbOutputs; ++j) c.outputs[Out1 + j][i] = o.out[j];
            c.outputs[Any][i] = o.any;
            c.outputs[Accent][i] = o.accent;
            c.outputs[Cycle][i] = o.cycle;
        }
        step_.store((int)dsp_.step());
        family_.store(dsp_.activeFamily());
        pattern_.store(dsp_.activePattern());
        length_.store(dsp_.activeLength());
        next_.store(p.pattern);
        pending_.store(p.pattern != dsp_.activePattern() || p.family != dsp_.activeFamily() ||
                       p.length != dsp_.activeLength() || p.complement != dsp_.activeComplement());
        for (int j = 0; j < kRbOutputs; ++j) gates_[(size_t)j].store(dsp_.high(j));
    }

private:
    RhythmBankDsp dsp_;
    std::atomic<int> step_{0}, family_{0}, pattern_{0}, length_{16}, next_{0};
    std::atomic<bool> pending_{false};
    std::array<std::atomic<bool>, kRbOutputs> gates_{};
};

}  // namespace

static void registerRhythmBankModule(Registry& r) {
    (void)patch::rbPrimeSets();  // build the tables here, not on the audio thread
    (void)patch::rbPolySets();
    ModuleSpec s;
    s.type = "rhythm-bank";
    s.name = "Rhythm Bank";
    s.category = "Sequencing/Drum";
    s.colour = "#f08a5d";
    s.description = "Four related rhythms from a pattern number. Turn Pattern to browse grooves; modulate it to develop a part.";
    std::vector<std::string> lengths, rates;
    for (int l = 2; l <= patch::kRbMaxLength; ++l) lengths.push_back(std::to_string(l));
    lengths.emplace_back("Open");
    for (int i = 0; i < dsp::kNumSequencerRates; ++i) rates.emplace_back(dsp::sequencerRate(i).name);
    s.params.push_back(ParamSpec::steppedInt("pattern", "Pattern", 0, patch::kRbPatterns - 1, 0));
    for (int j = 1; j <= kRbOutputs; ++j)
        s.params.push_back(
            ParamSpec::steppedInt("rotate" + std::to_string(j), "Rotate " + std::to_string(j), -16, 16, 0).inGroup("Rotate"));
    s.params.push_back(ParamSpec::percent("width", "Width", 0.01f, 1.0f, 0.5f).when("output", 0, 0));
    s.params.push_back(ParamSpec::choice("family", "Family", {"Even", "Prime", "Metric", "Poly", "Interlock", "Seeded"}, 0));
    s.params.push_back(ParamSpec::choice("length", "Length", lengths, 14));
    s.params.push_back(ParamSpec::choice("rate", "Rate", rates, 9));
    s.params.push_back(ParamSpec::choice("complement", "Complement", {"Off", "Avoid", "Fill", "Pairs"}, 0));
    s.params.push_back(ParamSpec::choice("change", "Change", {"Step", "Cycle"}, 1));
    s.params.push_back(ParamSpec::choice("grid", "Grid", {"Snap", "Free"}, 0).when("family", 3, 3));
    for (int j = 1; j <= kRbOutputs; ++j)
        s.params.push_back(ParamSpec::toggle("mute" + std::to_string(j), "Mute " + std::to_string(j), false));
    s.params.push_back(ParamSpec::choice("output", "Output", {"Gate", "Trigger"}, 0));
    s.params.push_back(ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto));
    s.inputs = {{"clock", "Clock", Signal::Trigger}, {"reset", "Reset", Signal::Trigger}};
    for (int j = 1; j <= kRbOutputs; ++j)
        s.outputs.push_back({"out" + std::to_string(j), "Out " + std::to_string(j), Signal::Gate, false});
    s.outputs.push_back({"any", "Any", Signal::Gate, false});
    s.outputs.push_back({"accent", "Accent", Signal::Gate, false});
    s.outputs.push_back({"cycle", "Cycle", Signal::Trigger, false});
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<RhythmBankModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerRhythmBankModule);

}  // namespace bleep::engine
