// SPDX-License-Identifier: GPL-3.0-or-later
// Stretch node (doc/specs/modules/stretch.md): records a stereo input and plays it back
// slower or faster without changing its pitch, frozen, scrubbed, looped over a window,
// with the speed of time itself modulated.
#include "Registry.h"
#include "StretchDsp.h"

#include <algorithm>
#include <cmath>

namespace bleep::engine {
namespace {

class StretchModule final : public Module {
public:
    enum { StretchK, Freeze, Reverse, Pitch, Engine, Grain, Overlap, Scatter, Window, Hold, Start, Range, Mode, Position,
           Wobble, WobbleRate, WobbleShape, Record, Length, Mix };
    enum { InL, InR, PositionCv, FreezeGate, NewTake };
    enum { OutL, OutR, Head };
    enum { RecButton };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void process(const ProcessContext& c) override {
        bool take = false;
        pollCommands([&](const Command& cmd) {
            if (cmd.index == RecButton && cmd.value > 0.5f) take = true;
        });
        patch::StretchParams p;
        p.stretch = value(c, StretchK, 0);
        p.pitchSemis = value(c, Pitch, 0);
        p.scatter = value(c, Scatter, 0);
        p.grainMs = value(c, Grain, 0);
        p.rangeStart = value(c, Start, 0);
        p.rangeSize = value(c, Range, 0);
        const float knobPos = value(c, Position, 0);
        p.wobble = value(c, Wobble, 0);
        p.wobbleRate = value(c, WobbleRate, 0);
        p.lengthSeconds = value(c, Length, 0);
        p.mix = value(c, Mix, 0);
        p.engine = (int)setting(Engine);
        p.overlap = 2 + (int)setting(Overlap);
        p.sizeIndex = (int)setting(Window);
        p.mode = (int)setting(Mode);
        p.wobbleShape = (int)setting(WobbleShape);
        p.record = (int)setting(Record);
        p.holdRange = setting(Hold) > 0.5f;
        p.reverse = setting(Reverse) > 0.5f;
        const bool frozenKnob = setting(Freeze) > 0.5f;
        const bool cvPos = c.inputConnected[PositionCv];
        const bool cvTake = c.inputConnected[NewTake];
        for (int i = 0; i < c.numSamples; ++i) {
            p.freeze = frozenKnob || c.inputs[FreezeGate][i] > 0.5f;
            p.position = std::clamp(knobPos + (cvPos ? c.inputs[PositionCv][i] : 0.0f), 0.0f, 1.0f);
            const bool edge = cvTake && c.inputs[NewTake][i] > 0.5f && !takeHigh_;
            if (cvTake) takeHigh_ = c.inputs[NewTake][i] > 0.5f;
            p.newTake = edge || (take && i == 0);
            const patch::StretchFrame f = dsp_.tick(c.inputs[InL][i], c.inputs[InR][i], p);
            c.outputs[OutL][i] = f.l;
            c.outputs[OutR][i] = f.r;
            c.outputs[Head][i] = f.head;
        }
    }

private:
    patch::StretchDsp dsp_;
    bool takeHigh_ = false;
};

}  // namespace

static void registerStretchModule(Registry& r) {
    ModuleSpec s;
    s.type = "stretch";
    s.name = "Stretch";
    s.category = "Effects/Textures";
    s.colour = "#fb923c";
    s.description = "Records its input and plays it back slower or faster without changing the pitch: freeze a moment, "
                    "scrub through it, loop a held range, or let time itself wobble.";
    s.params = {ParamSpec::exponential("stretch", "Stretch", 0.1f, 8.0f, 1.0f, "×").inGroup("Time"),
                ParamSpec::toggle("freeze", "Freeze", false).inGroup("Time"),
                ParamSpec::toggle("reverse", "Reverse", false).inGroup("Time"),
                ParamSpec::number("pitch", "Pitch", -24.0f, 24.0f, 0.0f, "st", 2).inGroup("Time"),
                ParamSpec::choice("engine", "Engine", {"Grains", "Smear"}, 1).inGroup("Engine"),
                ParamSpec::exponential("grain", "Grain", 20.0f, 400.0f, 120.0f, "ms").inGroup("Engine").when("engine", 0, 0),
                ParamSpec::choice("overlap", "Overlap", {"2×", "3×", "4×"}, 1).inGroup("Engine").when("engine", 0, 0),
                ParamSpec::percent("scatter", "Scatter", 0.0f, 1.0f, 0.1f).inGroup("Engine").when("engine", 0, 0),
                ParamSpec::choice("window", "Window", {"1024", "2048", "4096"}, 1).inGroup("Engine").when("engine", 1, 1),
                ParamSpec::toggle("hold", "Hold Range", false).inGroup("Range"),
                ParamSpec::percent("start", "Start", 0.0f, 1.0f, 0.0f).inGroup("Range").when("hold", 1, 1),
                ParamSpec::percent("range", "Range", 0.01f, 1.0f, 0.25f).inGroup("Range").when("hold", 1, 1),
                ParamSpec::choice("mode", "Position Mode", {"Offset", "Scrub"}, 0).inGroup("Range"),
                ParamSpec::percent("position", "Position", 0.0f, 1.0f, 0.0f).inGroup("Range"),
                ParamSpec::percent("wobble", "Wobble", 0.0f, 1.0f, 0.0f).inGroup("Wobble"),
                ParamSpec::exponential("wobblerate", "Wobble Rate", 0.05f, 20.0f, 0.7f, "Hz").inGroup("Wobble"),
                ParamSpec::choice("wobbleshape", "Wobble Shape", {"Sine", "Random", "Saw"}, 0).inGroup("Wobble"),
                ParamSpec::choice("record", "Record", {"Once", "Rolling", "Off"}, 0).inGroup("Tape"),
                ParamSpec::number("length", "Length", 1.0f, 30.0f, 8.0f, "s", 1).inGroup("Tape"),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f).inGroup("Tape")};
    s.inputs = {{"l", "In L", Signal::Audio},
                {"r", "In R", Signal::Audio},
                {"positioncv", "Position", Signal::Control},
                {"freezegate", "Freeze", Signal::Gate},
                {"newtake", "New Take", Signal::Trigger}};
    s.inputs[1] = s.inputs[1].normalledTo("l");
    s.outputs = {{"l", "Out L", Signal::Audio, true},
                 {"r", "Out R", Signal::Audio, true},
                 {"head", "Head", Signal::Control, false}};
    s.buttons = {{"rec", "New Take"}};
    s.memoryHeavy = true;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<StretchModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerStretchModule);

}  // namespace bleep::engine
