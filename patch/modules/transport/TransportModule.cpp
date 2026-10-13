// SPDX-License-Identifier: MIT
// Transport node (doc/specs/modules/transport.md): the song's clock in one place. Tempo, Ableton Link,
// MIDI clock in and out, play and stop. Modules cannot change the transport themselves; this one asks the
// host through HostControl.h, and only the standalone app answers.
#include "HostControl.h"
#include "Registry.h"
#include "TransportDsp.h"

#include <atomic>
#include <string>

namespace bleep::engine {
namespace {

class TransportModule final : public Module {
public:
    enum { Tempo, Link, StartStopSync, MidiIn, MidiOut };
    enum { PlayIn, StopIn, NotesIn };
    enum { NotesOut, Playing, TempoOut };
    enum { PlayStopButton, TapButton };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        clockIn_.prepare(sampleRate);
        tap_.prepare(sampleRate);
        reset();
    }
    void reset() override {
        clockOut_.reset();
        clockIn_.reset();
        playHigh_ = stopHigh_ = false;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        const HostControl& hc = hostControl();
        out.push_back({"bpm", bpm_.load()});
        out.push_back({"playing", playing_.load() ? 1.0 : 0.0});
        out.push_back({"hosted", hc.hosted.load() ? 1.0 : 0.0});
        out.push_back({"linkAvailable", hc.linkAvailable.load() ? 1.0 : 0.0});
        out.push_back({"linkEnabled", hc.linkEnabled.load() ? 1.0 : 0.0});
        out.push_back({"peers", (double)hc.linkPeers.load()});
        out.push_back({"clockIn", clockInSeen_.load() ? 1.0 : 0.0});
    }

    void process(const ProcessContext& c) override {
        HostControl& hc = hostControl();
        const Transport& tr = *c.transport;

        // Settings that describe how the board wants the host set up: sent on the first block and when they change.
        sendIfChanged(hc.link, sentLink_, setting(Link) >= 0.5f ? 1 : 0);
        sendIfChanged(hc.startStopSync, sentSync_, setting(StartStopSync) >= 0.5f ? 1 : 0);
        // The tempo knob is a gesture, not a state: loading a board must not override the project's tempo.
        const double knobTempo = value(c, Tempo, c.numSamples - 1);
        if (sentTempo_ < 0.0) sentTempo_ = knobTempo;
        else if (std::fabs(knobTempo - sentTempo_) >= 0.05) {
            sentTempo_ = knobTempo;
            hc.tempo.store(knobTempo);
        }

        pollCommands([&](const Command& cmd) {
            if (cmd.index == PlayStopButton) hc.play.store(tr.playing ? HostControl::Stop : HostControl::Start);
            else if (cmd.index == TapButton) tapTempo(hc, samples_);
        });

        const bool syncIn = setting(MidiIn) >= 0.5f && c.inputConnected[NotesIn];
        const bool syncOut = setting(MidiOut) >= 0.5f;
        const NoteBuffer* in = syncIn ? c.notesIn[NotesIn] : nullptr;
        NoteBuffer& notes = *c.notesOut[NotesOut];
        notes.clear();
        const bool running = tr.playing && tr.ppqValid;
        int e = 0;
        for (int i = 0; i < c.numSamples; ++i) {
            // Play and Stop: rising edges.
            const bool playHigh = c.inputs[PlayIn][i] >= 0.5f, stopHigh = c.inputs[StopIn][i] >= 0.5f;
            if (playHigh && !playHigh_ && c.inputConnected[PlayIn]) hc.play.store(HostControl::Start);
            if (stopHigh && !stopHigh_ && c.inputConnected[StopIn]) hc.play.store(HostControl::Stop);
            playHigh_ = playHigh;
            stopHigh_ = stopHigh;

            // MIDI clock in.
            for (; in && e < in->count && in->events[e].offset <= i; ++e) {
                const NoteEvent& ev = in->events[e];
                if (ev.type != NoteEvent::System) continue;
                switch (ev.note) {
                    case patch::kMidiClock:
                        lastClockAt_ = samples_ + i;
                        if (const double t = clockIn_.clock(samples_ + i); t > 0.0) hc.tempo.store(t);
                        break;
                    case patch::kMidiStart:
                        clockIn_.restart();
                        hc.play.store(HostControl::Start);
                        break;
                    case patch::kMidiContinue: hc.play.store(HostControl::Continue); break;
                    case patch::kMidiStop: hc.play.store(HostControl::Stop); break;
                    default: break;
                }
            }

            // MIDI clock out.
            clockOut_.tick(syncOut, running, c.ppqAt(i), [&](int status) {
                NoteEvent ev;
                ev.type = NoteEvent::System;
                ev.offset = (int16_t)i;
                ev.note = status;
                notes.push(ev);
            });

            c.outputs[Playing][i] = tr.playing ? 1.0f : 0.0f;
            c.outputs[TempoOut][i] = (float)(tr.bpm / 100.0);
        }
        samples_ += c.numSamples;
        bpm_.store(tr.bpm);
        playing_.store(tr.playing);
        clockInSeen_.store(syncIn && samples_ - lastClockAt_ < (int64_t)sampleRate_ / 2);
    }

private:
    static void sendIfChanged(std::atomic<int>& request, int& sent, int now) noexcept {
        if (now == sent) return;
        sent = now;
        request.store(now);
    }
    void tapTempo(HostControl& hc, int64_t at) {
        if (const double bpm = tap_.tap(at); bpm > 0.0) hc.tempo.store(bpm);
    }

    patch::MidiClockOut clockOut_;
    patch::MidiClockIn clockIn_;
    patch::TapTempo tap_;
    int64_t samples_ = 0;          ///< audio-thread clock for the pulse and tap spacing
    int64_t lastClockAt_ = -(int64_t(1) << 40);
    int sentLink_ = -1, sentSync_ = -1;
    double sentTempo_ = -1.0;
    bool playHigh_ = false, stopHigh_ = false;
    std::atomic<double> bpm_{120.0};
    std::atomic<bool> playing_{false}, clockInSeen_{false};
};

}  // namespace

static void registerTransportModule(Registry& r) {
    ModuleSpec s;
    s.type = "transport";
    s.name = "Transport";
    s.category = "Utility";
    s.colour = "#ff9f43";
    s.description = "Sets the tempo, switches Ableton Link on and off, sends and follows MIDI clock, and plays and stops "
                    "the song. In the standalone app; elsewhere it shows the host's tempo.";
    s.params = {ParamSpec::number("tempo", "Tempo", 20.0f, 400.0f, 120.0f, "BPM", 1),
                ParamSpec::toggle("link", "Link", true),
                ParamSpec::toggle("startstop", "Link Start/Stop", true),
                ParamSpec::toggle("midiin", "MIDI Clock In", false),
                ParamSpec::toggle("midiout", "MIDI Clock Out", false)};
    s.inputs = {{"play", "Play", Signal::Trigger}, {"stop", "Stop", Signal::Trigger}, {"notes", "MIDI In", Signal::Notes}};
    s.outputs = {{"notes", "MIDI Out", Signal::Notes, false},
                 {"playing", "Playing", Signal::Gate, false},
                 {"tempo", "Tempo", Signal::Control, false}};
    s.buttons = {{"playstop", "Play / Stop", false}, {"tap", "Tap", false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<TransportModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerTransportModule);

}  // namespace bleep::engine
