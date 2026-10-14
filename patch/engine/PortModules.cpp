// SPDX-License-Identifier: MIT
//
// Port nodes (spec §6): the board side of the plugins users add in Live.
// A port node reads its plugin's host block from ctx.port->in and writes to
// ctx.port->out. Without a plugin (a ghost) its outputs are silent.
#include "PortSlot.h"
#include "Registry.h"

#include <algorithm>
#include <cmath>

namespace bleep::engine {
namespace {

constexpr int kNumCcs = 8;
const int kDefaultCcs[kNumCcs] = {2, 4, 7, 10, 11, 71, 74, 64};

float pitchOf(int note) noexcept { return (float)(note - 60) / 12.0f; }

void zeroOutputs(const ProcessContext& c, const ModuleSpec& s) noexcept {
    for (size_t k = 0; k < s.outputs.size(); ++k) {
        if (c.outputs[k]) std::fill(c.outputs[k], c.outputs[k] + c.numSamples, 0.0f);
        if (c.notesOut[k]) c.notesOut[k]->clear();
    }
}

// ---- MIDI In / Instrument ----------------------------------------------------

/// Turns the track's MIDI into a `notes` stream plus mono signals.
class MidiInModule final : public Module {
public:
    enum { Channel, Cc1 };
    enum { Notes, Pitch, Gate, Velocity, Trigger, Pressure, Bend, Mod, CcOut1 };
    enum { InL, InR };  // Instrument only
    /// Instrument only: the host's time as a clock and a run gate, for cells that play by themselves.
    static constexpr int ClockOut = CcOut1 + kNumCcs, PlayingOut = ClockOut + 1;

    MidiInModule(const ModuleSpec& s, bool audioOut) : Module(s), audioOut_(audioOut) {}

    void reset() override {
        held_ = 0;
        gate_ = velocity_ = pressure_ = bend_ = mod_ = 0.0f;
        std::fill(std::begin(cc_), std::end(cc_), 0.0f);
    }

    void process(const ProcessContext& c) override {
        NoteBuffer& notes = *c.notesOut[Notes];
        notes.clear();
        if (audioOut_) writeAudio(c);
        if (c.port == nullptr || c.port->in == nullptr) {
            zeroOutputs(c, spec());  // outputs deactivated (spec §6)
            releaseAll(notes);
            return;
        }
        const PortFrame& in = *c.port->in;
        if (c.offset == 0) cursor_ = 0;
        const int channel = (int)setting(Channel);  // 0 = all
        int ccNumbers[kNumCcs];
        for (int k = 0; k < kNumCcs; ++k) ccNumbers[k] = (int)setting(Cc1 + k);

        for (int i = 0; i < c.numSamples; ++i) {
            c.outputs[Trigger][i] = 0.0f;
            while (cursor_ < in.numMidi && in.midi[cursor_].offset <= c.offset + i) {
                const MidiEvent& e = in.midi[cursor_++];
                if (e.size == 1 && e.bytes[0] >= 0xf8) {  // realtime: clock, start, continue, stop; no channel
                    NoteEvent n;
                    n.type = NoteEvent::System;
                    n.offset = (int16_t)i;
                    n.note = e.bytes[0];
                    notes.pushController(n);
                    continue;
                }
                if (e.size < 2) continue;
                const int status = e.bytes[0] & 0xf0, ch = e.bytes[0] & 0x0f;
                if (channel != 0 && ch != channel - 1) continue;
                handle(status, ch, e.bytes[1], e.size > 2 ? e.bytes[2] : 0, ccNumbers, notes, i, c);
            }
            c.outputs[Pitch][i] = pitch_;
            c.outputs[Gate][i] = gate_;
            c.outputs[Velocity][i] = velocity_;
            c.outputs[Pressure][i] = pressure_;
            c.outputs[Bend][i] = bend_;
            c.outputs[Mod][i] = mod_;
            for (int k = 0; k < kNumCcs; ++k) c.outputs[CcOut1 + k][i] = cc_[k];
            if (audioOut_) {
                const bool playing = c.transport->playing;
                c.outputs[ClockOut][i] = playing && std::fmod(c.ppqAt(i) * 24.0, 1.0) < 0.5 ? 1.0f : 0.0f;
                c.outputs[PlayingOut][i] = playing ? 1.0f : 0.0f;
            }
        }
    }

private:
    void handle(int status, int ch, int d1, int d2, const int* ccNumbers, NoteBuffer& notes, int i,
                const ProcessContext& c) noexcept {
        NoteEvent n;
        n.channel = (uint8_t)ch;
        n.offset = (int16_t)i;
        n.note = d1;
        n.pitch = pitchOf(d1);
        if (status == 0x90 && d2 > 0) {
            n.type = NoteEvent::On;
            n.value = (float)d2 / 127.0f;
            notes.push(n);
            push(d1);
            pitch_ = n.pitch;
            gate_ = 1.0f;
            velocity_ = n.value;
            c.outputs[Trigger][i] = 1.0f;
        } else if (status == 0x80 || status == 0x90) {
            n.type = NoteEvent::Off;
            n.value = status == 0x80 ? (float)d2 / 127.0f : 0.0f;
            notes.push(n);
            remove(d1);
            if (held_ == 0) gate_ = 0.0f;
            else pitch_ = pitchOf(stack_[held_ - 1]);
        } else if (status == 0xa0) {
            n.type = NoteEvent::Pressure;
            n.value = (float)d2 / 127.0f;
            notes.push(n);
            if (held_ > 0 && stack_[held_ - 1] == d1) pressure_ = n.value;
        } else if (status == 0xd0) {
            pressure_ = (float)d1 / 127.0f;
            n.type = NoteEvent::ChannelPressure;
            n.note = 0;
            n.value = pressure_;
            notes.pushController(n);
        } else if (status == 0xe0) {
            bend_ = ((float)((d2 << 7) | d1) - 8192.0f) / 8192.0f;
            n.type = NoteEvent::Bend;
            n.note = 0;
            n.value = bend_;
            notes.pushController(n);
        } else if (status == 0xc0) {
            n.type = NoteEvent::Program;
            n.pitch = 0.0f;
            notes.pushController(n);
        } else if (status == 0xb0) {
            n.type = NoteEvent::Cc;
            n.pitch = 0.0f;
            n.value = (float)d2 / 127.0f;
            notes.pushController(n);
            if (d1 == 1) mod_ = (float)d2 / 127.0f;
            for (int k = 0; k < kNumCcs; ++k)
                if (ccNumbers[k] == d1) cc_[k] = (float)d2 / 127.0f;
            if (d1 == 123 || d1 == 120) releaseAll(notes);  // all notes / sound off
        }
    }

    void push(int note) noexcept {
        remove(note);
        if (held_ < (int)std::size(stack_)) stack_[held_++] = note;
    }
    void remove(int note) noexcept {
        int w = 0;
        for (int r = 0; r < held_; ++r)
            if (stack_[r] != note) stack_[w++] = stack_[r];
        held_ = w;
    }
    void releaseAll(NoteBuffer& notes) noexcept {
        for (int k = 0; k < held_; ++k) {
            NoteEvent n;
            n.type = NoteEvent::Off;
            n.note = stack_[k];
            n.pitch = pitchOf(stack_[k]);
            notes.push(n);
        }
        held_ = 0;
        gate_ = 0.0f;
    }

    void writeAudio(const ProcessContext& c) noexcept {
        if (c.port == nullptr || c.port->out == nullptr) return;
        const float* l = c.inputs[InL];
        const float* r = c.inputConnected[InR] ? c.inputs[InR] : l;
        std::copy(l, l + c.numSamples, c.port->out->audio[0] + c.offset);
        std::copy(r, r + c.numSamples, c.port->out->audio[1] + c.offset);
    }

    bool audioOut_;
    int cursor_ = 0;
    int stack_[32] = {};
    int held_ = 0;
    float pitch_ = 0.0f, gate_ = 0.0f, velocity_ = 0.0f, pressure_ = 0.0f, bend_ = 0.0f, mod_ = 0.0f;
    float cc_[kNumCcs] = {};
};

// ---- MIDI Out ------------------------------------------------------------------

class MidiOutModule final : public Module {
public:
    enum { Velocity, Channel, Transpose, Cc1 };
    enum { Notes, Gate, Pitch, CcIn1, Bend = CcIn1 + kNumCcs };

    using Module::Module;

    void reset() override {
        gateHigh_ = false;
        monoNote_ = -1;
        std::fill(std::begin(lastCc_), std::end(lastCc_), -1);
        lastBend_ = -1;
    }

    void process(const ProcessContext& c) override {
        PortFrame* out = c.port ? c.port->out : nullptr;
        const int ch = (int)setting(Channel) - 1;
        const int transpose = (int)setting(Transpose);
        auto send = [&](int offset, uint8_t b0, int b1, int b2) {
            if (out == nullptr || out->numMidi >= kMaxMidiEvents) return;
            MidiEvent& e = out->midi[out->numMidi++];
            e.offset = c.offset + offset;
            e.bytes[0] = (uint8_t)(b0 | ch);
            e.bytes[1] = (uint8_t)std::clamp(b1, 0, 127);
            e.bytes[2] = (uint8_t)std::clamp(b2, 0, 127);
            e.size = 3;
        };

        auto sendRealtime = [&](int offset, int status) {
            if (out == nullptr || out->numMidi >= kMaxMidiEvents || status < 0xf8) return;
            MidiEvent& e = out->midi[out->numMidi++];
            e.offset = c.offset + offset;
            e.bytes[0] = (uint8_t)status;
            e.size = 1;
        };

        // Polyphonic notes pass straight through.
        if (const NoteBuffer* notes = c.notesIn[Notes]) {
            for (int k = 0; k < notes->count; ++k) {
                const NoteEvent& n = notes->events[k];
                if (n.type == NoteEvent::System) {  // clock, start, continue, stop: one byte, no channel
                    sendRealtime(n.offset, n.note);
                    continue;
                }
                const int note = n.note + transpose;
                const int v = (int)std::lround(n.value * 127.0f);
                if (n.type == NoteEvent::On) send(n.offset, 0x90, note, std::max(1, v));
                else if (n.type == NoteEvent::Off) send(n.offset, 0x80, note, v);
                else if (n.type == NoteEvent::Pressure) send(n.offset, 0xa0, note, v);
            }
        }

        // Mono: Gate + Pitch become notes, legato on pitch changes.
        if (c.inputConnected[Gate]) {
            for (int i = 0; i < c.numSamples; ++i) {
                const bool high = c.inputs[Gate][i] >= 0.5f;
                const int note = std::clamp(60 + transpose + (int)std::lround(c.inputs[Pitch][i] * 12.0f), 0, 127);
                const int vel = std::clamp((int)std::lround(value(c, Velocity, i) * 127.0f), 1, 127);
                if (high && !gateHigh_) {
                    send(i, 0x90, note, vel);
                    monoNote_ = note;
                } else if (!high && gateHigh_ && monoNote_ >= 0) {
                    send(i, 0x80, monoNote_, 0);
                    monoNote_ = -1;
                } else if (high && monoNote_ >= 0 && note != monoNote_) {
                    send(i, 0x90, note, vel);
                    send(i, 0x80, monoNote_, 0);
                    monoNote_ = note;
                }
                gateHigh_ = high;
            }
        } else if (monoNote_ >= 0) {
            send(0, 0x80, monoNote_, 0);
            monoNote_ = -1;
            gateHigh_ = false;
        }

        // CCs and bend: once per chunk, only when patched and changed.
        const int last = c.numSamples - 1;
        for (int k = 0; k < kNumCcs; ++k) {
            if (!c.inputConnected[CcIn1 + k]) continue;
            const int v = std::clamp((int)std::lround(c.inputs[CcIn1 + k][last] * 127.0f), 0, 127);
            if (v != lastCc_[k]) send(last, 0xb0, (int)setting(Cc1 + k), v);
            lastCc_[k] = v;
        }
        if (c.inputConnected[Bend]) {
            const int b = std::clamp((int)std::lround((c.inputs[Bend][last] * 0.5f + 0.5f) * 16383.0f), 0, 16383);
            if (b != lastBend_) send(last, 0xe0, b & 0x7f, b >> 7);
            lastBend_ = b;
        }
    }

private:
    bool gateHigh_ = false;
    int monoNote_ = -1;
    int lastCc_[kNumCcs] = {-1, -1, -1, -1, -1, -1, -1, -1};
    int lastBend_ = -1;
};

// ---- audio ports -----------------------------------------------------------------

class AudioPortModule final : public Module {
public:
    /// Audio In: outputs only. Audio Out: inputs only. Insert: both.
    AudioPortModule(const ModuleSpec& s, bool fromTrack, bool toTrack) : Module(s), from_(fromTrack), to_(toTrack) {}

    void reset() override { gain_ = -1.0f; }

    void process(const ProcessContext& c) override {
        if (from_) {
            const PortFrame* in = c.port ? c.port->in : nullptr;
            for (int ch = 0; ch < 2; ++ch) {
                if (in == nullptr) {
                    std::fill(c.outputs[ch], c.outputs[ch] + c.numSamples, 0.0f);
                    continue;
                }
                const float* src = in->audio[in->numChannels > 1 ? ch : 0] + c.offset;
                const int n = std::clamp(in->numSamples - c.offset, 0, c.numSamples);
                std::copy(src, src + n, c.outputs[ch]);
                std::fill(c.outputs[ch] + n, c.outputs[ch] + c.numSamples, 0.0f);
            }
            if (hasLevel()) applyLevel(c, c.outputs[0], c.outputs[1], c.outputs[0], c.outputs[1]);
        }
        if (to_ && c.port && c.port->out) {
            // An Insert with nothing patched into its return passes the send through.
            const bool through = from_ && !c.inputConnected[0];
            const float* l = through ? c.outputs[0] : c.inputs[0];
            const float* r = through ? c.outputs[1] : (c.inputConnected[1] ? c.inputs[1] : l);  // mono → both
            float* outL = c.port->out->audio[0] + c.offset;
            float* outR = c.port->out->audio[1] + c.offset;
            if (hasLevel()) {
                applyLevel(c, l, r, outL, outR);
            } else {
                std::copy(l, l + c.numSamples, outL);
                std::copy(r, r + c.numSamples, outR);
            }
        }
    }

private:
    /// Audio In (Gain) and Audio Out (Volume) have one level knob in dB; Insert and Bridge have none.
    bool hasLevel() const noexcept { return !spec().params.empty(); }

    /// Scales l/r into outL/outR (which may be the same buffers) by the knob, smoothed so moving it does not click.
    void applyLevel(const ProcessContext& c, const float* l, const float* r, float* outL, float* outR) noexcept {
        constexpr float kFloorDb = -60.0f, kSmooth = 0.002f;  // the bottom of the knob is silence
        for (int i = 0; i < c.numSamples; ++i) {
            float db = value(c, 0, i);
            if (std::fabs(db) < 0.005f) db = 0.0f;  // the default must pass the signal bit for bit
            const float target = db <= kFloorDb + 1e-3f ? 0.0f : std::pow(10.0f, db / 20.0f);
            gain_ = gain_ < 0.0f ? target : gain_ + (target - gain_) * kSmooth;
            if (std::fabs(target - gain_) < 1e-6f) gain_ = target;
            const float a = l[i] * gain_, b = r[i] * gain_;
            outL[i] = a;
            outR[i] = b;
        }
    }

    bool from_, to_;
    float gain_ = -1.0f;  ///< smoothed linear gain; negative until the first block
};

/// The return half of an Audio Insert (or Bridge): board audio to the track. With nothing patched into
/// the return, the track's own audio passes through.
class AudioReturnModule final : public Module {
public:
    using Module::Module;
    void process(const ProcessContext& c) override {
        if (!c.port || !c.port->out) return;
        const bool through = !c.inputConnected[0];
        const PortFrame* in = c.port->in;
        for (int ch = 0; ch < 2; ++ch) {
            float* dst = c.port->out->audio[ch] + c.offset;
            if (through) {
                if (in == nullptr) {
                    std::fill(dst, dst + c.numSamples, 0.0f);
                    continue;
                }
                const float* src = in->audio[in->numChannels > 1 ? ch : 0] + c.offset;
                const int n = std::clamp(in->numSamples - c.offset, 0, c.numSamples);
                std::copy(src, src + n, dst);
                std::fill(dst + n, dst + c.numSamples, 0.0f);
            } else {
                const float* src = ch == 1 && !c.inputConnected[1] ? c.inputs[0] : c.inputs[ch];  // mono → both
                std::copy(src, src + c.numSamples, dst);
            }
        }
    }
};

// ---- Bleep Board: macros -----------------------------------------------------------

class MacrosModule final : public Module {
public:
    using Module::Module;
    void process(const ProcessContext& c) override {
        const PortFrame* in = c.port ? c.port->in : nullptr;
        for (int k = 0; k < kNumMacros; ++k) {
            const float v = in ? in->macros[k] : 0.0f;
            std::fill(c.outputs[k], c.outputs[k] + c.numSamples, v);
        }
    }
};

// ---- the standalone app: Ableton Link (spec §11.4) ---------------------------------

/// Musical time as signals. The app feeds the transport from Link (or from
/// Live through Bleep Audio Bridge); the node only reads ctx.transport.
class LinkModule final : public Module {
public:
    enum { Quantum, StartStop };
    enum { Tempo, Beat, Bar, Clock, Playing, BeatTrig, BarTrig };

    using Module::Module;

    void reset() override { lastBeat_ = lastBar_ = -1.0; }

    void process(const ProcessContext& c) override {
        const double quantum = std::max(1.0, (double)setting(Quantum));
        const bool playing = c.transport->playing;
        const float tempo = (float)(c.transport->bpm / 100.0);
        for (int i = 0; i < c.numSamples; ++i) {
            const double ppq = c.ppqAt(i);
            const double beat = ppq - std::floor(ppq);
            const double bar = ppq / quantum - std::floor(ppq / quantum);
            const double tick = ppq * 24.0;
            c.outputs[Tempo][i] = tempo;
            c.outputs[Beat][i] = (float)beat;
            c.outputs[Bar][i] = (float)bar;
            c.outputs[Clock][i] = playing && tick - std::floor(tick) < 0.5 ? 1.0f : 0.0f;
            c.outputs[Playing][i] = playing ? 1.0f : 0.0f;
            c.outputs[BeatTrig][i] = playing && lastBeat_ >= 0.0 && beat < lastBeat_ ? 1.0f : 0.0f;
            c.outputs[BarTrig][i] = playing && lastBar_ >= 0.0 && bar < lastBar_ ? 1.0f : 0.0f;
            lastBeat_ = beat;
            lastBar_ = bar;
        }
    }

private:
    double lastBeat_ = -1.0, lastBar_ = -1.0;
};

// ---- specs ------------------------------------------------------------------------

std::vector<JackSpec> midiInOutputs() {
    std::vector<JackSpec> o = {{"notes", "Notes", Signal::Notes, false},
                               {"pitch", "Pitch", Signal::Pitch, true},
                               {"gate", "Gate", Signal::Gate, false},
                               {"velocity", "Velocity", Signal::Control, false},
                               {"trigger", "Trigger", Signal::Trigger, false},
                               {"pressure", "Pressure", Signal::Control, false},
                               {"bend", "Bend", Signal::Control, true},
                               {"mod", "Mod Wheel", Signal::Control, false}};
    for (int k = 0; k < kNumCcs; ++k)
        o.push_back({"cc" + std::to_string(k + 1), "CC " + std::to_string(k + 1), Signal::Control, false});
    return o;
}

std::vector<ParamSpec> ccParams() {
    std::vector<ParamSpec> p;
    for (int k = 0; k < kNumCcs; ++k)
        p.push_back(ParamSpec::integer("cc" + std::to_string(k + 1), "CC " + std::to_string(k + 1) + " #", 0, 127,
                                       kDefaultCcs[k]));
    return p;
}

ModuleSpec portSpec(const char* type, const char* name, PortKind kind, const char* description) {
    ModuleSpec s;
    s.type = type;
    s.name = name;
    s.category = "Ports";
    s.colour = "#60a5fa";
    s.description = description;
    s.port = kind;
    s.userCreatable = false;
    return s;
}

}  // namespace

void registerPortModules(Registry& r) {
    std::vector<std::string> channels{"All"};
    for (int k = 1; k <= 16; ++k) channels.push_back(std::to_string(k));

    {
        ModuleSpec s = portSpec("midi-in", "MIDI In", PortKind::MidiIn,
                                "Notes and controllers from a MIDI track (Bleep MIDI In).");
        s.params = {ParamSpec::choice("channel", "Channel", channels, 0)};
        for (auto& p : ccParams()) s.params.push_back(p);
        s.outputs = midiInOutputs();
        r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<MidiInModule>(spec, false); });
    }
    {
        ModuleSpec s = portSpec("instrument", "Instrument", PortKind::Instrument,
                                "MIDI In and Audio Out in one plugin (Bleep Instrument).");
        s.params = {ParamSpec::choice("channel", "Channel", channels, 0)};
        for (auto& p : ccParams()) s.params.push_back(p);
        s.outputs = midiInOutputs();
        s.outputs.push_back({"clock", "Clock", Signal::Gate, false});
        s.outputs.push_back({"playing", "Playing", Signal::Gate, false});
        s.inputs = {{"l", "Audio L", Signal::Audio}, {"r", "Audio R", Signal::Audio}};
        r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<MidiInModule>(spec, true); });
    }
    {
        // Standalone only (spec §12): the user adds it and picks a controller; the app feeds it.
        ModuleSpec s = portSpec("midi-device", "MIDI Device", PortKind::MidiDevice,
                                "A connected MIDI controller: notes for Voice Cells, plus pitch, gate, velocity and CCs.");
        s.category = "Controllers/Performance";
        s.colour = "#38bdf8";
        s.userCreatable = true;
        s.standaloneOnly = true;
        s.params = {ParamSpec::choice("channel", "Channel", channels, 0)};
        for (auto& p : ccParams()) s.params.push_back(p);
        s.outputs = midiInOutputs();
        r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<MidiInModule>(spec, false); });
    }
    {
        ModuleSpec s = portSpec("midi-out", "MIDI Out", PortKind::MidiOut,
                                "Notes, CCs and pitch bend to another track (Bleep MIDI Out).");
        s.params = {ParamSpec::percent("velocity", "Velocity", 0.0f, 1.0f, 0.8f),
                    ParamSpec::integer("channel", "Channel", 1, 16, 1),
                    ParamSpec::integer("transpose", "Transpose", -24, 24, 0)};
        s.params[2].format = ParamSpec::Format::Semitones;
        for (auto& p : ccParams()) s.params.push_back(p);
        s.inputs = {{"notes", "Notes", Signal::Notes}, {"gate", "Gate", Signal::Gate}, {"pitch", "Pitch", Signal::Pitch}};
        for (int k = 0; k < kNumCcs; ++k)
            s.inputs.push_back({"cc" + std::to_string(k + 1) + "in", "CC " + std::to_string(k + 1), Signal::Control});
        s.inputs.push_back({"bend", "Bend", Signal::Control});
        r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<MidiOutModule>(spec); });
    }
    {
        ModuleSpec s = portSpec("audio-in", "Audio In", PortKind::AudioIn, "The track's audio (Bleep Audio In).");
        s.params = {ParamSpec::number("gain", "Gain", -24.0f, 24.0f, 0.0f, "dB", 1)};
        s.outputs = {{"l", "L", Signal::Audio, true}, {"r", "R", Signal::Audio, true}};
        r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<AudioPortModule>(spec, true, false); });
    }
    {
        ModuleSpec s = portSpec("audio-out", "Audio Out", PortKind::AudioOut, "Board audio to a track (Bleep Audio Out).");
        // Like a mixer fader: 0 dB sits at about 80 % of the travel, the bottom is silence.
        s.params = {ParamSpec::number("volume", "Volume", -60.0f, 6.0f, 0.0f, "dB", 1)};
        s.params[0].map = ParamSpec::Map::Skew;
        s.params[0].centre = -12.0f;
        s.inputs = {{"l", "L", Signal::Audio}, {"r", "R", Signal::Audio}};
        r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<AudioPortModule>(spec, false, true); });
    }
    {
        ModuleSpec s = portSpec("audio-insert", "Audio Insert", PortKind::AudioInsert,
                                "A track's audio through the board and back (Bleep FX).");
        s.outputs = {{"l", "Send L", Signal::Audio, true}, {"r", "Send R", Signal::Audio, true}};
        s.inputs = {{"l", "Return L", Signal::Audio}, {"r", "Return R", Signal::Audio}};
        r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<AudioPortModule>(spec, true, false); });
    }
    {
        ModuleSpec s = portSpec("audio-bridge", "Audio Bridge", PortKind::AudioBridge,
                                "A Live track's audio through the standalone app and back (Bleep Audio Bridge).");
        s.outputs = {{"l", "Send L", Signal::Audio, true}, {"r", "Send R", Signal::Audio, true}};
        s.inputs = {{"l", "Return L", Signal::Audio}, {"r", "Return R", Signal::Audio}};
        r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<AudioPortModule>(spec, true, false); });
    }
    {
        // The return half of an Audio Insert or Audio Bridge: the compiler splits the node into send and return
        // (Program::compile), so the path through the board is not a cycle and takes no feedback delay.
        ModuleSpec s = portSpec(kAudioReturn, "Audio Return", PortKind::AudioInsert,
                                "The return of an Audio Insert (made by the compiler).");
        s.userCreatable = false;
        s.inputs = {{"l", "Return L", Signal::Audio}, {"r", "Return R", Signal::Audio}};
        r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<AudioReturnModule>(spec); });
    }
    {
        ModuleSpec s = portSpec("link", "Link", PortKind::Link,
                                "Tempo, beat and bar from Ableton Link (or from Live through Bleep Audio Bridge).");
        s.colour = "#ff9f43";
        s.params = {ParamSpec::integer("quantum", "Quantum", 1, 16, 4), ParamSpec::toggle("startstop", "Start/Stop Sync", true)};
        s.params[0].label = "beats";
        s.outputs = {{"tempo", "Tempo", Signal::Control, false},  {"beat", "Beat", Signal::Control, false},
                     {"bar", "Bar", Signal::Control, false},      {"clock", "Clock", Signal::Gate, false},
                     {"playing", "Playing", Signal::Gate, false}, {"beattrig", "Beat Trig", Signal::Trigger, false},
                     {"bartrig", "Bar Trig", Signal::Trigger, false}};
        r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<LinkModule>(spec); });
    }
    {
        ModuleSpec s = portSpec("macros", "Macros", PortKind::Patch,
                                "The 16 automatable macros of the Bleep Board plugin.");
        s.colour = "#f6c35b";
        for (int k = 1; k <= kNumMacros; ++k)
            s.outputs.push_back({"m" + std::to_string(k), "Macro " + std::to_string(k), Signal::Control, false});
        r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<MacrosModule>(spec); });
    }
}

}  // namespace bleep::engine
