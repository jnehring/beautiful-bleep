// SPDX-License-Identifier: GPL-3.0-or-later
// Melody Mirror node (doc/specs/modules/melody-mirror.md): the last notes of a
// `notes` stream, remembered with their timing and played back reversed,
// inverted, rotated, mirrored, or as an answer after a pause.
#include "MelodyMirrorDsp.h"
#include "Registry.h"
#include "dsp/Harmony.h"

#include <array>
#include <atomic>
#include <string>

namespace bleep::engine {
namespace {

using patch::MelodyMirrorDsp;
using patch::PhraseNote;

constexpr int kViewFloats = patch::kMirrorMax * 4;

class MelodyMirrorModule final : public Module {
public:
    enum { Mode, Reply, Length, AxisMode, Axis, Rotate, Start, Gap, Speed, Transpose, Velocity, GateLength, Thru, Snap, Root, Scale,
           Harmony };
    enum { Notes, Trig };
    enum { NotesOut, Playing, Phrase };
    enum { Replay, Clear };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        pulse_ = std::max(1, (int)(sampleRate * 0.002));
    }
    void reset() override {
        dsp_.reset();
        trigWas_ = false;
        wasConnected_ = false;
        phraseLeft_ = 0;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"count", (double)count_.load()});
        out.push_back({"playing", playing_.load() ? 1.0 : 0.0});
        out.push_back({"pos", (double)pos_.load()});
        out.push_back({"mode", (double)mode_.load()});
        out.push_back({"fresh", (double)fresh_.load()});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        const int ns = srcCount_.load(), no = outCount_.load();
        std::vector<float> a((size_t)ns * 4), b((size_t)no * 4);
        for (int i = 0; i < ns * 4; ++i) a[(size_t)i] = src_[(size_t)i].load(std::memory_order_relaxed);
        for (int i = 0; i < no * 4; ++i) b[(size_t)i] = out_[(size_t)i].load(std::memory_order_relaxed);
        out.push_back({"src", std::move(a)});
        out.push_back({"out", std::move(b)});
    }

    void process(const ProcessContext& c) override {
        patch::MirrorParams p;
        p.mode = (int)value(c, Mode, 0);
        p.reply = (int)setting(Reply);
        p.length = (int)value(c, Length, 0);
        p.axisMode = (int)setting(AxisMode);
        p.axis = (int)value(c, Axis, 0);
        p.rotate = (int)value(c, Rotate, 0);
        p.startOnGap = setting(Start) >= 0.5f;
        static constexpr double kGap[5] = {0.5, 1.0, 2.0, 4.0, 8.0};
        p.gapSamples = dsp::beatsToSamples(kGap[std::clamp((int)setting(Gap), 0, 4)], c.transport->bpm, sampleRate_);
        p.muteThru = setting(Thru) >= 0.5f;
        p.snap = setting(Snap) >= 0.5f;
        const int bus = (int)setting(Harmony) - 1;
        if (bus >= 0 && bus < dsp::kHarmonyBuses && c.harmony && c.harmony[bus].valid) {
            p.scale.key = c.harmony[bus].key;
            p.scale.mask = c.harmony[bus].scale;
        } else {
            p.scale.key = (int)setting(Root);
            p.scale.mask = dsp::scales()[(size_t)std::clamp((int)setting(Scale), 0, 16)].mask;
        }

        bool replay = false;
        pollCommands([&](const Command& cmd) {
            if (cmd.index == Replay && cmd.value > 0.5f) replay = true;
            else if (cmd.index == Clear && cmd.value > 0.5f) dsp_.clear();
        });

        const bool connected = c.inputConnected[Notes];
        NoteBuffer& out = *c.notesOut[NotesOut];
        out.clear();
        auto emit = [&](int offset) {
            return [&out, offset](bool on, int note, float pitch, float velocity) {
                NoteEvent ev;
                ev.type = on ? NoteEvent::On : NoteEvent::Off;
                ev.offset = (int16_t)offset;
                ev.note = note;
                ev.pitch = pitch;
                ev.value = velocity;
                out.push(ev);
            };
        };
        if (!connected && wasConnected_) dsp_.flush(emit(0));
        wasConnected_ = connected;

        const NoteBuffer* in = connected ? c.notesIn[Notes] : nullptr;
        int e = 0;
        for (int i = 0; i < c.numSamples; ++i) {
            p.mode = (int)value(c, Mode, i);
            p.speed = value(c, Speed, i);
            p.transpose = (int)value(c, Transpose, i);
            p.velocity = value(c, Velocity, i);
            p.gateLength = value(c, GateLength, i);
            for (; in && e < in->count && in->events[e].offset <= i; ++e) {
                const NoteEvent& ev = in->events[e];
                if (ev.type == NoteEvent::On) dsp_.noteOn(ev.note, ev.pitch, ev.value, p, emit(i));
                else if (ev.type == NoteEvent::Off) dsp_.noteOff(ev.note, emit(i));
                else if (ev.type != NoteEvent::Pressure) out.pushController(ev);
            }
            const bool trig = c.inputs[Trig][i] >= 0.5f;
            bool started = false;
            if ((trig && !trigWas_) || (replay && i == 0)) started = dsp_.start(p, false);
            trigWas_ = trig;
            started = dsp_.tick(p, out.count < kMaxNotesPerChunk - 4, emit(i)) || started;
            if (started) phraseLeft_ = pulse_;
            c.outputs[Phrase][i] = phraseLeft_ > 0 ? 1.0f : 0.0f;
            c.outputs[Playing][i] = dsp_.playing() ? 1.0f : 0.0f;
            if (phraseLeft_ > 0) --phraseLeft_;
        }
        publishView(p);
    }

private:
    void publishView(const patch::MirrorParams& p) {
        PhraseNote src[patch::kMirrorMax], outp[patch::kMirrorMax];
        const int n = dsp_.phrase(p, false);
        dsp_.copyPhrase(n, src);
        int64_t t = 1, t0 = n ? src[0].onset : 0;
        for (int i = 0; i < n; ++i) t = std::max(t, src[i].onset - t0 + src[i].length);
        for (int i = 0; i < n; ++i) {
            src_[(size_t)i * 4].store((float)(src[i].onset - t0) / (float)t, std::memory_order_relaxed);
            src_[(size_t)i * 4 + 1].store((float)src[i].length / (float)t, std::memory_order_relaxed);
            src_[(size_t)i * 4 + 2].store((float)src[i].note, std::memory_order_relaxed);
            src_[(size_t)i * 4 + 3].store(src[i].velocity, std::memory_order_relaxed);
        }
        srcCount_.store(n);
        patch::MirrorParams q = p;
        q.speed = 1.0f;
        const int m = MelodyMirrorDsp::transform(src, n, q, MelodyMirrorDsp::functionOf(p), outp);
        int64_t u = 1;
        for (int i = 0; i < m; ++i) u = std::max(u, outp[i].onset + outp[i].length);
        for (int i = 0; i < m; ++i) {
            out_[(size_t)i * 4].store((float)outp[i].onset / (float)u, std::memory_order_relaxed);
            out_[(size_t)i * 4 + 1].store((float)outp[i].length / (float)u, std::memory_order_relaxed);
            out_[(size_t)i * 4 + 2].store((float)outp[i].note, std::memory_order_relaxed);
            out_[(size_t)i * 4 + 3].store(outp[i].velocity, std::memory_order_relaxed);
        }
        outCount_.store(m);
        count_.store(n);
        fresh_.store(dsp_.fresh());
        playing_.store(dsp_.playing());
        pos_.store((float)dsp_.playPosition());
        mode_.store(p.mode);
    }

    MelodyMirrorDsp dsp_;
    int pulse_ = 96, phraseLeft_ = 0;
    bool trigWas_ = false, wasConnected_ = false;
    std::array<std::atomic<float>, kViewFloats> src_{}, out_{};
    std::atomic<int> srcCount_{0}, outCount_{0}, count_{0}, fresh_{0}, mode_{0};
    std::atomic<bool> playing_{false};
    std::atomic<float> pos_{-1.0f};
};

}  // namespace

static void registerMelodyMirrorModule(Registry& r) {
    ModuleSpec s;
    s.type = "melody-mirror";
    s.name = "Melody Mirror";
    s.category = "Sequencing/Melodic";
    s.colour = "#b69cf5";
    s.description = "Remembers the last notes and plays them back reversed, inverted, rotated or mirrored, or as an answer after a pause.";
    std::vector<std::string> modes, replies{"Reverse", "Invert", "Rotate", "Mirror"}, scales, roots;
    for (const char* n : MelodyMirrorDsp::modeNames()) modes.emplace_back(n);
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    for (int k = 0; k < 12; ++k) roots.emplace_back(dsp::pitchClassName(k));
    s.params = {ParamSpec::stepped("mode", "Mode", modes, 0).inGroup("Phrase"),
                ParamSpec::choice("reply", "Reply", replies, 3).inGroup("Phrase").when("mode", 4, 4),
                ParamSpec::steppedInt("length", "Length", 2, patch::kMirrorMax, 6).inGroup("Phrase"),
                ParamSpec::choice("axismode", "Axis", {"First Note", "Mean", "Fixed"}, 0).inGroup("Phrase"),
                ParamSpec::steppedInt("axis", "Axis Note", 0, 127, 60).inGroup("Phrase").when("axismode", 2, 2),
                ParamSpec::steppedInt("rotate", "Rotate", -8, 8, 1).inGroup("Phrase"),
                ParamSpec::choice("start", "Start", {"Trigger", "After Gap"}, 1).inGroup("Timing"),
                ParamSpec::choice("gap", "Gap", {"1/2 beat", "1 beat", "2 beats", "1 bar", "2 bars"}, 1).inGroup("Timing"),
                ParamSpec::exponential("speed", "Speed", 0.25f, 4.0f, 1.0f, "x").inGroup("Timing"),
                ParamSpec::steppedInt("transpose", "Transpose", -24, 24, 0).inGroup("Playback"),
                ParamSpec::percent("velocity", "Velocity", 0.0f, 1.0f, 1.0f).inGroup("Playback"),
                ParamSpec::percent("gatelength", "Gate Length", 0.25f, 2.0f, 1.0f).inGroup("Playback"),
                ParamSpec::choice("thru", "Thru", {"Pass", "Mute"}, 0),
                ParamSpec::choice("snap", "Snap To Scale", {"Off", "On"}, 0),
                ParamSpec::choice("root", "Root", roots, 0).when("snap", 1, 1),
                ParamSpec::choice("scale", "Scale", scales, 1).when("snap", 1, 1),
                ParamSpec::choice("harmony", "Harmony", {"Off", "Bus A", "Bus B", "Bus C", "Bus D"}, 0).when("snap", 1, 1)};
    s.inputs = {{"notes", "Notes", Signal::Notes}, {"trig", "Trig", Signal::Trigger}};
    s.outputs = {{"notes", "Notes", Signal::Notes, false}, {"playing", "Playing", Signal::Gate, false}, {"phrase", "Phrase", Signal::Trigger, false}};
    s.buttons = {{"replay", "Replay"}, {"clear", "Clear"}};
    s.harmony = HarmonyRole::Reader;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<MelodyMirrorModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerMelodyMirrorModule);

}  // namespace bleep::engine
