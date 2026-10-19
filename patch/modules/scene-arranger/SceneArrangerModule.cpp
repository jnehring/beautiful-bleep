// SPDX-License-Identifier: GPL-3.0-or-later
// Scene Arranger node (doc/specs/modules/scene-arranger.md): scenes in a play
// order with repeats and follow actions, launched on the beat or bar.
#include "Registry.h"
#include "SceneArrangerDsp.h"
#include "dsp/SeqClock.h"

#include <atomic>

namespace bleep::engine {
namespace {

using namespace patch;

class SceneArrangerModule final : public Module {
public:
    // Settings first, then the order list, the follow actions and the lanes.
    enum { Scenes = 0, Steps, Length, Quantize, Beats, Launch, CvMode, LaneOut, Seed, SyncTo, Slot1 };
    static constexpr int Rep1 = Slot1 + kSaSlots, Follow1 = Rep1 + kSaSlots, Jump1 = Follow1 + kSaScenes, Chance1 = Jump1 + kSaScenes,
                         From1 = Chance1 + kSaScenes, To1 = From1 + kSaLanes;
    enum { Clock, Reset, Next, Prev, LaunchIn };
    enum { NextButton, PrevButton, RestartButton };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"scene", (double)scene_.load()});
        out.push_back({"slot", (double)slot_.load()});
        out.push_back({"queued", (double)queued_.load()});
    }

    void process(const ProcessContext& c) override {
        bool next = false, prev = false, restart = false;
        pollCommands([&](const Command& cmd) {
            if (cmd.value <= 0.5f) return;
            if (cmd.index == NextButton) next = true;
            else if (cmd.index == PrevButton) prev = true;
            else if (cmd.index == RestartButton) restart = true;
        });
        SaParams p;
        p.scenes = (int)value(c, Scenes, 0);
        p.steps = (int)value(c, Steps, 0);
        const int bpb = (int)setting(Beats);
        p.beatsPerBar = bpb;
        static constexpr int lenMul[7] = {0, 0, 1, 2, 4, 8, 16};  // 1 beat, 2 beats, then bars
        const int len = (int)setting(Length);
        p.lenBeats = len == 0 ? 1 : len == 1 ? 2 : bpb * lenMul[len];
        p.quantize = (int)setting(Quantize);
        p.cvLinear = setting(CvMode) >= 0.5f;
        p.laneTrigger = setting(LaneOut) >= 0.5f;
        p.seed = (uint64_t)setting(Seed);
        for (int i = 0; i < kSaSlots; ++i) {
            p.slotScene[i] = (int)value(c, Slot1 + i, 0);
            p.slotRepeat[i] = (int)value(c, Rep1 + i, 0);
        }
        for (int i = 0; i < kSaScenes; ++i) {
            p.follow[i] = (int)value(c, Follow1 + i, 0);
            p.target[i] = (int)value(c, Jump1 + i, 0);
            p.chance[i] = value(c, Chance1 + i, 0);
        }
        for (int k = 0; k < kSaLanes; ++k) {
            p.laneFrom[k] = (int)value(c, From1 + k, 0);
            p.laneTo[k] = (int)value(c, To1 + k, 0);
        }
        const Transport& tr = *c.transport;
        SaInput in;
        in.clocked = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        in.running = tr.playing && tr.ppqValid;
        in.ppqPerSample = c.ppqPerSample;
        in.launchPatched = c.inputConnected[LaunchIn];
        SaOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            p.launch = (int)value(c, Launch, i);
            in.clock = c.inputs[Clock][i];
            in.reset = std::max(c.inputs[Reset][i], i == 0 && restart ? 1.0f : 0.0f);
            in.next = std::max(c.inputs[Next][i], i == 0 && next ? 1.0f : 0.0f);
            in.prev = std::max(c.inputs[Prev][i], i == 0 && prev ? 1.0f : 0.0f);
            in.launchCv = c.inputs[LaunchIn][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, o);
            c.outputs[0][i] = o.scene;
            c.outputs[1][i] = o.change;
            c.outputs[2][i] = o.cycle;
            c.outputs[3][i] = o.queued;
            for (int k = 0; k < kSaLanes; ++k) c.outputs[4 + k][i] = o.lane[k];
        }
        scene_.store(dsp_.scene());
        slot_.store(dsp_.slot());
        queued_.store(dsp_.pending());
    }

private:
    SceneArrangerDsp dsp_;
    std::atomic<int> scene_{0}, slot_{0}, queued_{-1};
};

}  // namespace

static void registerSceneArrangerModule(Registry& r) {
    ModuleSpec s;
    s.type = "scene-arranger";
    s.name = "Scene Arranger";
    s.category = "Sequencing/Clock";
    s.colour = "#e9b44c";
    s.description = "Up to 16 scenes in a play order with repeats and follow actions, launched on the beat or bar; scene CV, change trigger and eight lane gates.";
    const auto num = [](const char* base, int i) { return std::string(base) + std::to_string(i); };
    s.params.push_back(ParamSpec::steppedInt("scenes", "Scenes", 1, kSaScenes, 8));
    s.params.push_back(ParamSpec::steppedInt("steps", "Order Steps", 1, kSaSlots, 8));
    s.params.push_back(ParamSpec::choice("length", "Scene Length", {"1 beat", "2 beats", "1 bar", "2 bars", "4 bars", "8 bars", "16 bars"}, 3));
    s.params.push_back(ParamSpec::choice("quantize", "Launch Quantize", {"Immediate", "Beat", "Bar"}, 2));
    s.params.push_back(ParamSpec::integer("beats", "Beats per Bar", 1, 16, 4));
    s.params.push_back(ParamSpec::steppedInt("launch", "Launch", 0, kSaScenes, 0));
    s.params.push_back(ParamSpec::choice("cvmode", "Scene CV", {"Slot of 16", "Linear 0-1"}, 0));
    s.params.push_back(ParamSpec::choice("laneout", "Lane Output", {"Gate", "Trigger"}, 0));
    s.params.push_back(ParamSpec::integer("seed", "Seed", 0, 999, 1));
    s.params.push_back(ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto));
    for (int i = 1; i <= kSaSlots; ++i)
        s.params.push_back(ParamSpec::steppedInt(num("slot", i), "Slot " + std::to_string(i), 1, kSaScenes, i).inGroup("Play Order").when("steps", i, kSaSlots));
    for (int i = 1; i <= kSaSlots; ++i)
        s.params.push_back(ParamSpec::steppedInt(num("rep", i), "Repeat " + std::to_string(i), 1, 16, 1).inGroup("Play Order").when("steps", i, kSaSlots));
    std::vector<std::string> follows{"Order", "Next", "Previous", "Random", "Hold", "Jump", "Chance"};
    for (int i = 1; i <= kSaScenes; ++i)
        s.params.push_back(ParamSpec::stepped(num("follow", i), "Follow " + std::to_string(i), follows, 0).inGroup("Follow Actions").when("scenes", i, kSaScenes));
    for (int i = 1; i <= kSaScenes; ++i)
        s.params.push_back(ParamSpec::steppedInt(num("jump", i), "Jump " + std::to_string(i), 1, kSaScenes, 1).inGroup("Follow Actions").when(num("follow", i), FollowJump, FollowChance));
    for (int i = 1; i <= kSaScenes; ++i)
        s.params.push_back(ParamSpec::percent(num("chance", i), "Chance " + std::to_string(i), 0.0f, 1.0f, 0.5f).inGroup("Follow Actions").when(num("follow", i), FollowChance, FollowChance));
    for (int k = 1; k <= kSaLanes; ++k)
        s.params.push_back(ParamSpec::steppedInt(num("from", k), "Lane " + std::to_string(k) + " From", 0, kSaScenes, k).inGroup("Lanes"));
    for (int k = 1; k <= kSaLanes; ++k)
        s.params.push_back(ParamSpec::steppedInt(num("to", k), "Lane " + std::to_string(k) + " To", 1, kSaScenes, k).inGroup("Lanes"));
    s.inputs = {{"clock", "Clock", Signal::Trigger},
                {"reset", "Reset", Signal::Trigger},
                {"next", "Next", Signal::Trigger},
                {"prev", "Previous", Signal::Trigger},
                {"launch", "Launch", Signal::Control}};
    s.outputs = {{"scene", "Scene", Signal::Control, false},
                 {"change", "Change", Signal::Trigger, false},
                 {"cycle", "Cycle", Signal::Trigger, false},
                 {"queued", "Queued", Signal::Gate, false}};
    for (int k = 1; k <= kSaLanes; ++k) s.outputs.push_back({num("lane", k), "Lane " + std::to_string(k), Signal::Gate, false});
    s.buttons = {{"next", "Next"}, {"prev", "Previous"}, {"restart", "Restart"}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SceneArrangerModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerSceneArrangerModule);

}  // namespace bleep::engine
