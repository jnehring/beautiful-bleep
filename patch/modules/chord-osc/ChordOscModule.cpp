// SPDX-License-Identifier: GPL-3.0-only
// Chord Osc node (doc/specs/modules/chord-oscillator.md): up to six oscillator
// cores playing a chord built on one pitch, chromatic or diatonic, with
// inversion, voicing, latch, detune and stereo spread.
#include "ChordOscDsp.h"
#include "Registry.h"

#include <atomic>

namespace bleep::engine {
namespace {

using patch::ChordOscDsp;
using patch::ChordOscParams;

class ChordOscModule final : public Module {
public:
    enum { Tune, Chord, Stack, Inversion, Voicing, Voices, Shape, PulseWidth, Detune, Glide, RootLevel, Stereo, FmDepth,
           Mode, Octave, Key, Scale, Seed };
    enum { Pitch, Latch, Fm };
    enum { OutL, OutR, Root, Pitch1, Pitch2, Pitch3, Pitch4 };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        static const char* const keys[kLive] = {"rootPc", "quality", "bassPc", "degree", "count", "latched",
                                                "voicePitch1", "voicePitch2", "voicePitch3", "voicePitch4",
                                                "voicePitch5", "voicePitch6"};
        for (int i = 0; i < kLive; ++i) out.push_back({keys[i], (double)live_[i].load(std::memory_order_relaxed)});
    }

    void process(const ProcessContext& c) override {
        ChordOscParams p;
        p.octave = (int)setting(Octave) - 3;  // choice index 0..6 → −3..+3
        p.scaleMode = setting(Mode) >= 0.5f;
        p.key = (int)setting(Key);
        p.scale = dsp::scales()[(size_t)std::clamp((int)setting(Scale), 0, (int)dsp::scales().size() - 1)].mask;
        p.seed = (uint32_t)setting(Seed);
        const bool latch = c.inputConnected[Latch];
        dsp_.setOutputsUsed(c.isOutputConnected(Root), c.isOutputConnected(Pitch1) || c.isOutputConnected(Pitch2) ||
                                                           c.isOutputConnected(Pitch3) || c.isOutputConnected(Pitch4));
        for (int i = 0; i < c.numSamples; ++i) {
            p.pitch = c.inputs[Pitch][i];
            p.tune = value(c, Tune, i);
            p.chord = (int)setting(Chord);
            p.stack = (int)setting(Stack);
            p.inversion = (int)value(c, Inversion, i);
            p.voicing = (int)setting(Voicing);
            p.voices = (int)value(c, Voices, i);
            p.shape = value(c, Shape, i);
            p.pulseWidth = value(c, PulseWidth, i);
            p.detune = value(c, Detune, i);
            p.glide = value(c, Glide, i);
            p.rootLevel = value(c, RootLevel, i);
            p.stereo = value(c, Stereo, i);
            p.fmDepth = value(c, FmDepth, i);
            const auto f = dsp_.tick(p, c.inputs[Fm][i], latch, c.inputs[Latch][i]);
            c.outputs[OutL][i] = f.l;
            c.outputs[OutR][i] = f.r;
            c.outputs[Root][i] = f.root;
            for (int j = 0; j < 4; ++j) c.outputs[Pitch1 + j][i] = f.pitch[j];
        }
        const auto info = dsp_.info();
        const float vals[kLive] = {(float)info.rootPc, (float)info.quality, (float)info.bassPc, (float)info.degree,
                                   (float)info.count, info.latched ? 1.0f : 0.0f, info.pitch[0], info.pitch[1],
                                   info.pitch[2], info.pitch[3], info.pitch[4], info.pitch[5]};
        for (int i = 0; i < kLive; ++i) live_[i].store(vals[i], std::memory_order_relaxed);
    }

private:
    static constexpr int kLive = 12;
    ChordOscDsp dsp_;
    std::atomic<float> live_[kLive] = {};
};

}  // namespace

static void registerChordOscModule(Registry& r) {
    ModuleSpec s;
    s.type = "chord-osc";
    s.name = "Chord Osc";
    s.category = "Sources/Chords";
    s.colour = "#22d3ee";
    s.description = "One pitch in, a whole chord out: up to six oscillators on a chromatic or diatonic chord, "
                    "with inversion, voicing, latch, detune and stereo spread.";
    std::vector<std::string> chords, stacks, scales, keys;
    for (int i = 0; i < dsp::kNumChordOscQualities; ++i) chords.emplace_back(dsp::chordQualities()[(size_t)i].label);
    for (const auto& st : dsp::scaleStacks()) stacks.emplace_back(st.name);
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    for (int pc = 0; pc < 12; ++pc) keys.emplace_back(dsp::pitchClassName(pc));
    std::vector<std::string> voicings;
    for (int v = 0; v <= dsp::VoicingWide; ++v) voicings.emplace_back(dsp::voicingName(v));
    ParamSpec inversion = ParamSpec::steppedInt("inversion", "Inversion", -4, 4, 0);
    s.params = {ParamSpec::number("tune", "Tune", -100.0f, 100.0f, 0.0f, "ct", 0),
                ParamSpec::choice("chord", "Chord", chords, dsp::ChordMajor).when("mode", 0, 0),
                ParamSpec::choice("stack", "Chord", stacks, dsp::StackTriad).when("mode", 1, 1),
                inversion,
                ParamSpec::choice("voicing", "Voicing", voicings, 0),
                ParamSpec::steppedInt("voices", "Voices", 1, 6, 4),
                ParamSpec::percent("shape", "Shape", 0.0f, 1.0f, 2.0f / 3.0f),
                ParamSpec::percent("pw", "Pulse Width", 0.05f, 0.95f, 0.5f),
                ParamSpec::number("detune", "Detune", 0.0f, 50.0f, 0.0f, "ct", 1),
                ParamSpec::seconds("glide", "Glide", 0.0f, 1.0f, 0.2f, 0.0f),
                ParamSpec::percent("rootLevel", "Root Level", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("stereo", "Stereo", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("fm", "FM Depth", 0.0f, 1.0f, 0.0f),
                ParamSpec::choice("mode", "Mode", {"Chromatic", "Scale"}, 0),
                ParamSpec::choice("octave", "Octave", {"-3", "-2", "-1", "0", "+1", "+2", "+3"}, 3),
                ParamSpec::choice("key", "Root", keys, 0).when("mode", 1, 1),
                ParamSpec::choice("scale", "Scale", scales, 1).when("mode", 1, 1),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch}, {"latch", "Latch", Signal::Trigger}, {"fm", "FM", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},       {"r", "Out R", Signal::Audio, true},
                 {"root", "Root", Signal::Audio, true},     {"p1", "Pitch 1", Signal::Pitch, true},
                 {"p2", "Pitch 2", Signal::Pitch, true},    {"p3", "Pitch 3", Signal::Pitch, true},
                 {"p4", "Pitch 4", Signal::Pitch, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ChordOscModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerChordOscModule);

}  // namespace bleep::engine
