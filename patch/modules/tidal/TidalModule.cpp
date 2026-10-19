// SPDX-License-Identifier: GPL-3.0-or-later
// Tidal node (doc/specs/modules/tidal.md): slope oscillator / envelope with four
// related outputs, smoothing or folding, 1 V/oct, sync and clock following.
#include "TidalDsp.h"
#include "Registry.h"
#include "dsp/SeqClock.h"

#include <atomic>

namespace bleep::engine {
namespace {

using patch::TidalDsp;

class TidalModule final : public Module {
public:
    enum { Frequency, Skew, Curve, Smooth, Spread, Mode, Range, Relation, Sync, Ratio, Polarity, SyncTo };
    enum { Trig, Clock, Pitch };
    enum { A, B, C, D, Rise, End };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"phase", (double)phase_.load()});
        out.push_back({"hz", (double)hz_.load()});
        out.push_back({"clocked", clocked_.load() ? 1.0 : 0.0});
        out.push_back({"bpm", (double)bpm_.load()});
    }

    void process(const ProcessContext& c) override {
        patch::TidalParams p;
        p.mode = (int)setting(Mode);
        p.range = (int)setting(Range);
        p.relation = (int)setting(Relation);
        p.sync = (int)setting(Sync);
        p.ratio = (int)setting(Ratio);
        p.unipolar = setting(Polarity) >= 0.5f;
        const Transport& tr = *c.transport;
        patch::TidalTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        const bool clockPatched = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        patch::TidalFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.freq = c.params[Frequency][i];  // normalised: the Range maps it
            p.pitch = c.inputs[Pitch][i];
            p.skew = value(c, Skew, i);
            p.curve = value(c, Curve, i);
            p.smooth = value(c, Smooth, i);
            p.spread = value(c, Spread, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            dsp_.tick(p, c.inputs[Trig][i], c.inputs[Clock][i], clockPatched, t, f);
            for (int k = 0; k < TidalDsp::kOutputs; ++k) c.outputs[A + k][i] = f.out[k];
            c.outputs[Rise][i] = f.rise;
            c.outputs[End][i] = f.end;
        }
        phase_.store((float)dsp_.phase());
        hz_.store((float)dsp_.hz());
        clocked_.store(dsp_.clocked());
        bpm_.store((float)dsp_.clockBpm());
    }

private:
    TidalDsp dsp_;
    std::atomic<float> phase_{0.0f}, hz_{1.0f}, bpm_{120.0f};
    std::atomic<bool> clocked_{false};
};

}  // namespace

static void registerTidalModule(Registry& r) {
    ModuleSpec s;
    s.type = "tidal";
    s.name = "Tidal";
    s.category = "Modulation/Slopes";
    s.colour = "#60a5fa";
    s.description = "Slope oscillator from minute-long swells to audio rate: loop, AD or AR, with four related outputs.";
    std::vector<std::string> sync, ratios;
    for (int i = 0; i < TidalDsp::kSyncChoices; ++i) sync.emplace_back(TidalDsp::syncName(i));
    for (int i = 0; i < TidalDsp::kRatios; ++i) ratios.emplace_back(TidalDsp::ratioName(i));
    // Frequency is shown in the Medium range; the view relabels it for the others.
    s.params = {ParamSpec::hertz("freq", "Frequency", 0.02f, 50.0f, 1.0f),
                ParamSpec::percent("skew", "Skew", 0.0f, 1.0f, 0.5f),
                ParamSpec::number("curve", "Curve", -1.0f, 1.0f, 0.0f),
                ParamSpec::number("smooth", "Smooth", -1.0f, 1.0f, 0.0f),
                ParamSpec::number("spread", "Spread", -1.0f, 1.0f, 0.0f),
                ParamSpec::choice("mode", "Mode", {"AD", "Loop", "AR"}, 1),
                ParamSpec::choice("range", "Range", {"Slow", "Medium", "Audio"}, 1),
                ParamSpec::choice("relation", "Relation", {"Ratio", "Phase", "Level", "Harmonic"}, 1),
                ParamSpec::choice("sync", "Sync", sync, 0),
                ParamSpec::choice("ratio", "Ratio", ratios, 6),
                ParamSpec::choice("polarity", "Polarity", {"Bipolar", "Unipolar"}, 0).when("mode", 1, 1),
                ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto)};
    s.inputs = {{"trig", "Trig", Signal::Gate}, {"clock", "Clock", Signal::Trigger}, {"pitch", "Pitch", Signal::Pitch}};
    s.outputs = {{"a", "A", Signal::Control, true},     {"b", "B", Signal::Control, true},
                 {"c", "C", Signal::Control, true},     {"d", "D", Signal::Control, true},
                 {"rise", "Rise", Signal::Gate, false}, {"end", "End", Signal::Trigger, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<TidalModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerTidalModule);

}  // namespace bleep::engine
