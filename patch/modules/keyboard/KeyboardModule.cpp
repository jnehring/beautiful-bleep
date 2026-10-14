// SPDX-License-Identifier: MIT
// Keyboard node (doc/specs/modules/keyboard.md): a playable keyboard in the
// module view (mouse, touch or the computer keyboard). Notes out for Voice
// Cells, plus a mono pitch/gate/velocity/trigger.
#include "ControlQueue.h"
#include "NotesToCvDsp.h"
#include "Registry.h"

#include <algorithm>
#include <atomic>

namespace bleep::engine {
namespace {

enum { On, Off, AllOff };

class KeyboardModule final : public Module {
public:
    enum { Velocity, Glide, Octave, Priority, Hold };
    enum { Notes, Pitch, Gate, VelocityOut, Trigger };
    static constexpr int kKeys = 128;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        mono_.prepare(sampleRate);
    }
    void reset() override {
        mono_.reset();
        allOff_ = false;
        std::fill(std::begin(down_), std::end(down_), false);
    }

    /// "on" note [velocity 0..1, < 0: the Velocity knob], "off" note, "allOff".
    void perform(const std::string& action, const std::vector<double>& args) override {
        const int note = args.empty() ? -1 : (int)args[0];
        if (action == "allOff") queue_.push({AllOff, 0, 0.0f});
        if (note < 0 || note >= kKeys) return;
        if (action == "on") queue_.push({On, note, args.size() > 1 ? (float)args[1] : -1.0f});
        else if (action == "off") queue_.push({Off, note, 0.0f});
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"active", (double)active_.load()});
        out.push_back({"held", (double)held_.load()});
    }

    void process(const ProcessContext& c) override {
        patch::NotesToCvParams p;
        p.priority = (int)setting(Priority);
        NoteBuffer& notes = *c.notesOut[Notes];
        notes.clear();
        // An all-off may need more events than a chunk holds: it finishes
        // first, over several chunks if needed, before anything newer plays.
        if (allOff_) allOff_ = !releaseAll(notes, p);
        ControlEvent e;
        while (!allOff_ && notes.count < kMaxNotesPerChunk - 1 && queue_.pop(e)) {
            if (e.type == AllOff) {
                allOff_ = !releaseAll(notes, p);
            } else if (e.type == On) {
                if (down_[e.value]) release(e.value, notes, p);  // retrigger
                const float v = e.amount < 0.0f ? value(c, Velocity, 0) : std::clamp(e.amount, 0.01f, 1.0f);
                const float pitch = (float)(e.value - 60) / 12.0f;
                NoteEvent ev;
                ev.type = NoteEvent::On;
                ev.note = e.value;
                ev.pitch = pitch;
                ev.value = v;
                notes.push(ev);
                mono_.noteOn(0, e.value, pitch, v, p);
                down_[e.value] = true;
            } else if (down_[e.value]) {
                release(e.value, notes, p);
            }
        }
        patch::NotesToCvFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.glide = value(c, Glide, i);
            mono_.tick(p, f);
            c.outputs[Pitch][i] = f.pitch;
            c.outputs[Gate][i] = f.gate;
            c.outputs[VelocityOut][i] = f.velocity;
            c.outputs[Trigger][i] = f.trigger;
        }
        active_.store(mono_.activeNote());
        held_.store(mono_.heldCount());
    }

private:
    /// True when every key is up.
    bool releaseAll(NoteBuffer& notes, const patch::NotesToCvParams& p) {
        for (int n = 0; n < kKeys; ++n)
            if (down_[n]) {
                if (notes.count == kMaxNotesPerChunk) return false;
                release(n, notes, p);
            }
        return true;
    }
    void release(int note, NoteBuffer& notes, const patch::NotesToCvParams& p) {
        NoteEvent ev;
        ev.type = NoteEvent::Off;
        ev.note = note;
        ev.pitch = (float)(note - 60) / 12.0f;
        notes.push(ev);
        mono_.noteOff(0, note, 0.0f, p);
        down_[note] = false;
    }

    patch::NotesToCvDsp mono_;
    ControlQueue<512> queue_;
    bool down_[kKeys] = {};
    bool allOff_ = false;
    std::atomic<int> active_{-1}, held_{0};
};

}  // namespace

void registerKeyboardModule(Registry& r) {
    ModuleSpec s;
    s.type = "keyboard";
    s.name = "Keyboard";
    s.category = "Controllers/Performance";
    s.colour = "#fda4af";
    s.description = "Play notes with the mouse or the computer keyboard. Notes out plays a Voice Cell.";
    s.params = {ParamSpec::percent("velocity", "Velocity", 0.01f, 1.0f, 0.8f),
                ParamSpec::seconds("glide", "Glide", 0.0f, 2.0f, 0.2f, 0.0f),
                ParamSpec::integer("octave", "Octave", -3, 3, 0),
                ParamSpec::choice("priority", "Priority", {"Last", "Lowest", "Highest", "First"}, 0),
                ParamSpec::toggle("hold", "Hold", false)};
    s.outputs = {{"notes", "Notes", Signal::Notes, false},
                 {"pitch", "Pitch", Signal::Pitch, true},
                 {"gate", "Gate", Signal::Gate, false},
                 {"vel", "Velocity", Signal::Control, false},
                 {"trigger", "Trigger", Signal::Trigger, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<KeyboardModule>(spec); });
}

}  // namespace bleep::engine
