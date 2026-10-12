// SPDX-License-Identifier: MIT
// Notes to CV node (doc/specs/modules/notes-to-cv.md): a `notes` stream → mono
// pitch, gate, trigger, velocity and pressure.
#include "NotesToCvDsp.h"
#include "Registry.h"

#include <atomic>
#include <string>

namespace bleep::engine {
namespace {

class NotesToCvModule final : public Module {
public:
    enum { Glide, Priority, Retrigger, GlideMode, Channel };
    enum { Notes };
    enum { Pitch, Gate, Trigger, Velocity, Release, Pressure, Count };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override {
        dsp_.reset();
        wasPlaying_ = false;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"active", (double)active_.load()});
    }

    void process(const ProcessContext& c) override {
        patch::NotesToCvParams p;
        p.priority = (int)setting(Priority);
        p.retrigger = setting(Retrigger) >= 0.5f;
        p.glideLegatoOnly = setting(GlideMode) >= 0.5f;
        p.channel = (int)setting(Channel) - 1;

        // Never leave a gate hanging (spec §4.3).
        const bool playing = c.transport && c.transport->playing;
        if ((wasPlaying_ && !playing) || !c.inputConnected[Notes]) dsp_.releaseAll(p);
        wasPlaying_ = playing;

        const NoteBuffer* notes = c.inputConnected[Notes] ? c.notesIn[Notes] : nullptr;
        int e = 0;
        patch::NotesToCvFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            for (; notes && e < notes->count && notes->events[e].offset <= i; ++e) {
                const NoteEvent& ev = notes->events[e];
                if (ev.type == NoteEvent::On) dsp_.noteOn(ev.channel, ev.note, ev.pitch, ev.value, p);
                else if (ev.type == NoteEvent::Off) dsp_.noteOff(ev.channel, ev.note, ev.value, p);
                else if (ev.type == NoteEvent::Pressure) dsp_.pressure(ev.channel, ev.note, ev.value, p);
            }
            p.glide = value(c, Glide, i);
            dsp_.tick(p, f);
            c.outputs[Pitch][i] = f.pitch;
            c.outputs[Gate][i] = f.gate;
            c.outputs[Trigger][i] = f.trigger;
            c.outputs[Velocity][i] = f.velocity;
            c.outputs[Release][i] = f.release;
            c.outputs[Pressure][i] = f.pressure;
            c.outputs[Count][i] = f.count;
        }
        active_.store(dsp_.activeNote());
    }

private:
    patch::NotesToCvDsp dsp_;
    bool wasPlaying_ = false;
    std::atomic<int> active_{-1};
};

}  // namespace

void registerNotesToCvModule(Registry& r) {
    ModuleSpec s;
    s.type = "notes-to-cv";
    s.name = "Notes to CV";
    s.category = "Utility";
    s.colour = "#c084fc";
    s.description = "Notes in; pitch, gate, trigger, velocity and pressure out, with note priority and glide.";
    std::vector<std::string> channels{"All"};
    for (int k = 1; k <= 16; ++k) channels.push_back(std::to_string(k));
    s.params = {ParamSpec::seconds("glide", "Glide", 0.0f, 2.0f, 0.2f, 0.0f),
                ParamSpec::choice("priority", "Priority", {"Last", "Lowest", "Highest", "First"}, 0),
                ParamSpec::choice("retrigger", "Retrigger", {"Off (Legato)", "On"}, 1),
                ParamSpec::choice("glidemode", "Glide Mode", {"Always", "Legato Only"}, 0),
                ParamSpec::choice("channel", "Channel", channels, 0)};
    s.inputs = {{"notes", "Notes", Signal::Notes}};
    s.outputs = {{"pitch", "Pitch", Signal::Pitch, true},
                 {"gate", "Gate", Signal::Gate, false},
                 {"trigger", "Trigger", Signal::Trigger, false},
                 {"velocity", "Velocity", Signal::Control, false},
                 {"release", "Release", Signal::Control, false},
                 {"pressure", "Pressure", Signal::Control, false},
                 {"count", "Count", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<NotesToCvModule>(spec); });
}

}  // namespace bleep::engine
