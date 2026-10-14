// SPDX-License-Identifier: MIT
// CV to Notes node: pitch + gate → a `notes` stream, so mono sources play
// Voice Cells (spec §8.3.1). A pitch change while the gate is high is legato.
#include "Registry.h"

#include <algorithm>
#include <cmath>

namespace bleep::engine {
namespace {

class CvToNotesModule final : public Module {
public:
    enum { Velocity };
    enum { Pitch, Gate };
    enum { Notes };

    using Module::Module;

    void reset() override {
        high_ = false;
        note_ = -1;
    }

    void process(const ProcessContext& c) override {
        NoteBuffer& out = *c.notesOut[Notes];
        out.clear();
        for (int i = 0; i < c.numSamples; ++i) {
            const bool high = c.inputs[Gate][i] >= 0.5f;
            const float pitch = c.inputs[Pitch][i];
            const int note = std::clamp(60 + (int)std::lround(pitch * 12.0f), 0, 127);
            if (high && !high_) {
                on(out, i, note, pitch, value(c, Velocity, i));
            } else if (!high && high_) {
                off(out, i);
            } else if (high && note != note_) {
                const int old = note_;
                on(out, i, note, pitch, value(c, Velocity, i));  // legato: new note first
                NoteEvent e;
                e.type = NoteEvent::Off;
                e.offset = (int16_t)i;
                e.note = old;
                e.pitch = (float)(old - 60) / 12.0f;
                out.push(e);
            }
            high_ = high;
        }
    }

private:
    void on(NoteBuffer& out, int i, int note, float pitch, float velocity) {
        NoteEvent e;
        e.type = NoteEvent::On;
        e.offset = (int16_t)i;
        e.note = note;
        e.pitch = pitch;
        e.value = std::clamp(velocity, 0.0f, 1.0f);
        out.push(e);
        note_ = note;
    }
    void off(NoteBuffer& out, int i) {
        if (note_ < 0) return;
        NoteEvent e;
        e.type = NoteEvent::Off;
        e.offset = (int16_t)i;
        e.note = note_;
        e.pitch = (float)(note_ - 60) / 12.0f;
        out.push(e);
        note_ = -1;
    }

    bool high_ = false;
    int note_ = -1;
};

}  // namespace

void registerCvToNotesModule(Registry& r) {
    ModuleSpec s;
    s.type = "cv-to-notes";
    s.name = "CV to Notes";
    s.category = "Utility/Converters";
    s.colour = "#a78bfa";
    s.description = "Pitch and gate in, notes out: lets a sequencer or any mono source play a Voice Cell.";
    s.params = {ParamSpec::percent("velocity", "Velocity", 0.0f, 1.0f, 0.8f)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch}, {"gate", "Gate", Signal::Gate}};
    s.outputs = {{"notes", "Notes", Signal::Notes, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<CvToNotesModule>(spec); });
}

}  // namespace bleep::engine
