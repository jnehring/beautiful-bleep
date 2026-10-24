// SPDX-License-Identifier: GPL-3.0-only
// Note Echo node (doc/specs/modules/note-echo.md): notes in, the notes and a
// train of repeats out. Repeats fade, walk through the board's scale, fan into
// chord tones, may drop, and are pulled to or pushed off a grid.
#include "NoteEchoDsp.h"
#include "Registry.h"
#include "dsp/Harmony.h"
#include "dsp/Tempo.h"

#include <atomic>
#include <string>

namespace bleep::engine {
namespace {

using patch::NoteEchoDsp;

class NoteEchoModule final : public Module {
public:
    enum { Repeats, Rate, Time, Decay, Steps, Drop, Length, Spread, Fan, Gravity, Grid, Original, Seed, Root, Scale, Harmony };
    enum { Notes };
    enum { NotesOut, Tap };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        tapSamples_ = std::max(1, (int)(sampleRate * 0.002));
    }
    void reset() override {
        dsp_.reset();
        tapLeft_ = 0;
        wasConnected_ = false;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"pending", (double)pending_.load()});
        out.push_back({"sounding", (double)sounding_.load()});
        out.push_back({"hits", (double)hits_.load()});
    }

    void process(const ProcessContext& c) override {
        patch::EchoParams p;
        p.repeats = (int)value(c, Repeats, 0);
        const int rate = (int)setting(Rate);
        p.free = rate == 0;
        if (!p.free) p.spacingBeats = dsp::sequencerRateBeats(rate - 1);
        p.fan = (int)setting(Fan);
        p.muteOriginal = setting(Original) >= 0.5f;
        p.seed = (uint32_t)setting(Seed);
        static constexpr double kGrid[4] = {1.0, 0.5, 0.25, 0.125};
        p.gridBeats = kGrid[std::clamp((int)setting(Grid), 0, 3)];
        const int bus = (int)setting(Harmony) - 1;
        if (bus >= 0 && bus < dsp::kHarmonyBuses && c.harmony && c.harmony[bus].valid) {
            p.scale.key = c.harmony[bus].key;
            p.scale.mask = c.harmony[bus].scale;
        } else {
            p.scale.key = (int)setting(Root);
            p.scale.mask = dsp::scales()[(size_t)std::clamp((int)setting(Scale), 0, 16)].mask;
        }
        const Transport& tr = *c.transport;
        p.bpm = tr.bpm;

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
            for (; in && e < in->count && in->events[e].offset <= i; ++e) {
                const NoteEvent& ev = in->events[e];
                if (ev.type == NoteEvent::On) {
                    p.repeats = (int)value(c, Repeats, i);
                    p.spacingSeconds = value(c, Time, i);
                    p.decay = value(c, Decay, i);
                    p.steps = (int)value(c, Steps, i);
                    p.drop = value(c, Drop, i);
                    p.length = value(c, Length, i);
                    p.spread = value(c, Spread, i);
                    p.gravity = value(c, Gravity, i);
                    p.ppq = c.ppqAt(i);
                    p.ppqValid = tr.ppqValid;
                    dsp_.noteOn(ev.note, ev.pitch, ev.value, p, emit(i));
                } else if (ev.type == NoteEvent::Off) {
                    dsp_.noteOff(ev.note, emit(i));
                } else {
                    out.pushController(ev);
                }
            }
            const bool started = dsp_.tick(out.count < kMaxNotesPerChunk - 4, emit(i));
            if (started) {
                tapLeft_ = tapSamples_;
                hits_.fetch_add(1, std::memory_order_relaxed);
            }
            c.outputs[Tap][i] = tapLeft_ > 0 ? 1.0f : 0.0f;
            if (tapLeft_ > 0) --tapLeft_;
        }
        pending_.store(dsp_.pending());
        sounding_.store(dsp_.sounding());
    }

private:
    NoteEchoDsp dsp_;
    int tapSamples_ = 96, tapLeft_ = 0;
    bool wasConnected_ = false;
    std::atomic<int> pending_{0}, sounding_{0};
    std::atomic<uint32_t> hits_{0};
};

}  // namespace

static void registerNoteEchoModule(Registry& r) {
    ModuleSpec s;
    s.type = "note-echo";
    s.name = "Note Echo";
    s.category = "Sequencing/Melodic";
    s.colour = "#7dd3c0";
    s.description = "Every note comes back as repeats that fade, climb the scale, fan into chord tones and lean on or away from the grid.";
    std::vector<std::string> rates{"Free"}, scales, roots, fans;
    for (int i = 0; i < dsp::kNumSequencerRates; ++i) rates.emplace_back(dsp::sequencerRate(i).name);
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    for (int k = 0; k < 12; ++k) roots.emplace_back(dsp::pitchClassName(k));
    for (const char* n : NoteEchoDsp::fanNames()) fans.emplace_back(n);
    s.params = {ParamSpec::steppedInt("repeats", "Repeats", 1, patch::kEchoMaxRepeats, 4).inGroup("Time"),
                ParamSpec::choice("rate", "Rate", rates, 7).inGroup("Time"),
                ParamSpec::seconds("time", "Time", 0.01f, 2.0f, 0.25f, 0.25f).inGroup("Time").when("rate", 0, 0),
                ParamSpec::percent("decay", "Decay", 0.0f, 0.9f, 0.3f).inGroup("Repeats"),
                ParamSpec::steppedInt("steps", "Scale Steps", -7, 7, 0).inGroup("Repeats"),
                ParamSpec::percent("drop", "Drop", 0.0f, 1.0f, 0.0f).inGroup("Repeats"),
                ParamSpec::percent("length", "Length", 0.05f, 0.98f, 0.5f).inGroup("Repeats"),
                ParamSpec::percent("spread", "Spread", 0.0f, 1.0f, 0.0f).inGroup("Twist"),
                ParamSpec::choice("fan", "Fan", fans, 0).inGroup("Twist"),
                ParamSpec::percent("gravity", "Gravity", -1.0f, 1.0f, 0.0f).inGroup("Twist"),
                ParamSpec::choice("grid", "Grid", {"1/4", "1/8", "1/16", "1/32"}, 2).inGroup("Twist"),
                ParamSpec::choice("original", "Original", {"Pass", "Mute"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1),
                ParamSpec::choice("root", "Root", roots, 0),
                ParamSpec::choice("scale", "Scale", scales, 1),
                ParamSpec::choice("harmony", "Harmony", {"Off", "Bus A", "Bus B", "Bus C", "Bus D"}, 0)};
    s.inputs = {{"notes", "Notes", Signal::Notes}};
    s.outputs = {{"notes", "Notes", Signal::Notes, false}, {"tap", "Tap", Signal::Trigger, false}};
    s.harmony = HarmonyRole::Reader;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<NoteEchoModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerNoteEchoModule);

}  // namespace bleep::engine
