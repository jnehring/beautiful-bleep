// SPDX-License-Identifier: GPL-3.0-only
// Arpeggiator node (doc/specs/modules/arpeggiator.md): the held notes of a
// `notes` stream played one at a time; timing from the transport or a clock.
#include "ArpeggiatorDsp.h"
#include "Registry.h"
#include "dsp/SeqClock.h"

#include <atomic>
#include <string>

namespace bleep::engine {
namespace {

using patch::ArpeggiatorDsp;

class ArpeggiatorModule final : public Module {
public:
    enum { GateLength, Swing, Rate, Pattern, Octaves, Latch, Seed, SyncTo };
    enum { Notes, Clock, Reset };
    enum { NotesOut, Pitch, Gate, Velocity, Trigger };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override {
        dsp_.reset();
        wasLatch_ = false;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"held", (double)held_.load()});
        out.push_back({"sounding", sounding_.load() ? 1.0 : 0.0});
    }

    void process(const ProcessContext& c) override {
        patch::ArpParams p;
        p.rate = (int)setting(Rate);
        p.pattern = (int)setting(Pattern);
        p.octaves = (int)setting(Octaves);
        p.latch = setting(Latch) >= 0.5f;
        p.seed = (uint32_t)setting(Seed);
        if (wasLatch_ && !p.latch) dsp_.latchOff();
        wasLatch_ = p.latch;

        const Transport& tr = *c.transport;
        patch::ArpTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        // No hanging notes: the held keys are forgotten with the cable. A
        // stopping transport only ends the sounding note (the clock does it).
        if (!c.inputConnected[Notes]) dsp_.clearHeld();

        const NoteBuffer* in = c.inputConnected[Notes] ? c.notesIn[Notes] : nullptr;
        NoteBuffer& notes = *c.notesOut[NotesOut];
        notes.clear();
        patch::ArpOutputs o;
        int e = 0;
        for (int i = 0; i < c.numSamples; ++i) {
            for (; in && e < in->count && in->events[e].offset <= i; ++e) {
                const NoteEvent& ev = in->events[e];
                if (ev.type == NoteEvent::On) dsp_.noteOn(ev.note, ev.pitch, ev.value, p.latch);
                else if (ev.type == NoteEvent::Off) dsp_.noteOff(ev.note, p.latch);
            }
            p.gateLength = value(c, GateLength, i);
            p.swing = value(c, Swing, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            dsp_.tick(p, c.inputs[Clock][i], dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]), c.inputs[Reset][i], t, o,
                      [&](bool on, int note, float pitch, float velocity) {
                          NoteEvent ev;
                          ev.type = on ? NoteEvent::On : NoteEvent::Off;
                          ev.offset = (int16_t)i;
                          ev.note = note;
                          ev.pitch = pitch;
                          ev.value = velocity;
                          notes.push(ev);
                      });
            c.outputs[Pitch][i] = o.pitch;
            c.outputs[Gate][i] = o.gate;
            c.outputs[Velocity][i] = o.velocity;
            c.outputs[Trigger][i] = o.trigger;
        }
        held_.store(dsp_.heldCount());
        sounding_.store(dsp_.sounding());
    }

private:
    patch::ArpeggiatorDsp dsp_;
    bool wasLatch_ = false;
    std::atomic<int> held_{0};
    std::atomic<bool> sounding_{false};
};

}  // namespace

static void registerArpeggiatorModule(Registry& r) {
    ModuleSpec s;
    s.type = "arpeggiator";
    s.name = "Arpeggiator";
    s.category = "Sequencing/Melodic";
    s.colour = "#f6a04d";
    s.description = "Plays the held notes one at a time in a pattern over up to four octaves. Notes out plays a Voice Cell.";
    std::vector<std::string> rates, patterns;
    for (const char* n : ArpeggiatorDsp::rateNames()) rates.emplace_back(n);
    for (const char* n : ArpeggiatorDsp::patternNames()) patterns.emplace_back(n);
    s.params = {ParamSpec::percent("gatelength", "Gate Length", 0.01f, 1.0f, 0.5f),
                ParamSpec::percent("swing", "Swing", 0.5f, 0.75f, 0.5f),
                ParamSpec::choice("rate", "Rate", rates, 9),
                ParamSpec::choice("pattern", "Pattern", patterns, 0),
                ParamSpec::integer("octaves", "Octaves", 1, patch::kArpMaxOctaves, 1),
                ParamSpec::choice("latch", "Latch", {"Off", "On"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1),
                ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto)};
    s.inputs = {{"notes", "Notes", Signal::Notes}, {"clock", "Clock", Signal::Trigger}, {"reset", "Reset", Signal::Trigger}};
    s.outputs = {{"notes", "Notes", Signal::Notes, false},       {"pitch", "Pitch", Signal::Pitch, true},
                 {"gate", "Gate", Signal::Gate, false},          {"velocity", "Velocity", Signal::Control, false},
                 {"trigger", "Trigger", Signal::Trigger, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ArpeggiatorModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerArpeggiatorModule);

}  // namespace bleep::engine
