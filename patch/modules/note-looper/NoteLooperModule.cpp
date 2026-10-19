// SPDX-License-Identifier: GPL-3.0-or-later
// Note Looper node (doc/specs/modules/note-looper.md): records the notes of a
// `notes` stream with their timing for 1-16 bars and loops them. The loop is
// the node's data (saved with the board); the view draws it as a piano roll.
#include "NoteLooperDsp.h"
#include "Handoff.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <array>
#include <atomic>
#include <memory>
#include <string>
#include <vector>

namespace bleep::engine {
namespace {

using patch::LoopNote;
using patch::NoteLooperDsp;

constexpr int kFields = 5;  // start, length, note, velocity, layer

double round4(double x) { return std::round(x * 10000.0) / 10000.0; }

std::vector<LoopNote> parseNotes(const juce::var& data) {
    std::vector<LoopNote> v;
    const auto* a = data["notes"].getArray();
    if (!a) return v;
    for (const auto& item : *a) {
        const auto* f = item.getArray();
        if (!f || f->size() < 3 || (int)v.size() >= patch::kLoopMaxNotes) continue;
        LoopNote n;
        n.start = juce::jmax(0.0, (double)(*f)[0]);
        n.length = juce::jlimit(1.0 / patch::kTicksPerBeat, (double)patch::kLoopMaxBars * 8.0, (double)(*f)[1]);
        n.note = juce::jlimit(0, 127, (int)(*f)[2]);
        n.velocity = f->size() > 3 ? juce::jlimit(0.01f, 1.0f, (float)(double)(*f)[3]) : 0.8f;
        n.layer = f->size() > 4 ? (uint16_t)juce::jlimit(0, 65535, (int)(*f)[4]) : 0;
        n.pitch = dsp::notePitch(n.note);
        if (n.start < (double)patch::kLoopMaxBars * 8.0) v.push_back(n);
    }
    return v;
}

std::string toJson(const std::vector<LoopNote>& v) {
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> notes;
    for (const auto& n : v) {
        juce::Array<juce::var> f;
        f.add(round4(n.start));
        f.add(round4(n.length));
        f.add(n.note);
        f.add(round4(n.velocity));
        f.add((int)n.layer);
        notes.add(juce::var(f));
    }
    out->setProperty("notes", notes);
    return juce::JSON::toString(result, true).toStdString();
}

std::string sanitiseData(const std::string& json) {
    return toJson(parseNotes(json.empty() ? juce::var() : juce::JSON::parse(juce::String(json))));
}

/// The loop as the audio thread last saw it, readable from the message thread
/// without locks (a sequence counter: odd while it is being written).
struct Snapshot {
    std::atomic<uint32_t> seq{0};
    std::atomic<int> count{0};
    std::array<std::atomic<float>, patch::kLoopMaxNotes * kFields> v{};

    void write(const NoteLooperDsp& d) noexcept {
        seq.fetch_add(1);
        const int n = d.count();
        count.store(n);
        for (int i = 0; i < n; ++i) {
            const LoopNote& x = d.note(i);
            v[(size_t)i * kFields].store((float)x.start, std::memory_order_relaxed);
            v[(size_t)i * kFields + 1].store((float)x.length, std::memory_order_relaxed);
            v[(size_t)i * kFields + 2].store((float)x.note, std::memory_order_relaxed);
            v[(size_t)i * kFields + 3].store(x.velocity, std::memory_order_relaxed);
            v[(size_t)i * kFields + 4].store((float)x.layer, std::memory_order_relaxed);
        }
        seq.fetch_add(1);
    }
    std::vector<float> read() const {
        std::vector<float> out;
        for (int attempt = 0; attempt < 8; ++attempt) {
            const uint32_t s = seq.load();
            if (s & 1u) continue;
            const int n = std::min(count.load(), patch::kLoopMaxNotes);
            out.assign((size_t)n * kFields, 0.0f);
            for (int i = 0; i < n * kFields; ++i) out[(size_t)i] = v[(size_t)i].load(std::memory_order_relaxed);
            if (seq.load() == s) return out;
        }
        return {};
    }
};

class NoteLooperModule final : public Module {
public:
    enum { Mode, Bars, BeatsPerBar, Speed, Probability, Quantize, Strength, Thru, Seed };
    enum { Notes, Rec };
    enum { NotesOut, PassOut, Recording, Phase };
    enum { Clear, Undo };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        pulse_ = std::max(1, (int)(sampleRate * 0.002));
    }
    void reset() override {
        dsp_.reset();
        passLeft_ = 0;
        wasConnected_ = false;
        applied_ = nullptr;
    }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        handoff_.publish(std::make_shared<const std::vector<LoopNote>>(parseNotes(juce::JSON::parse(juce::String(json)))));
    }
    bool takeData(std::string& json) override {
        const std::string now = toJson(read());
        if (now == data_) return false;
        data_ = json = now;
        return true;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"pos", (double)pos_.load()});
        out.push_back({"loop", (double)loop_.load()});
        out.push_back({"mode", (double)mode_.load()});
        out.push_back({"count", (double)snap_.count.load()});
        out.push_back({"running", running_.load() ? 1.0 : 0.0});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        out.push_back({"notes", snap_.read()});
    }

    static auto emit(const ProcessContext& c, int offset) {
        NoteBuffer* out = c.notesOut[NotesOut];
        return [out, offset](bool on, int note, float pitch, float velocity) {
            NoteEvent ev;
            ev.type = on ? NoteEvent::On : NoteEvent::Off;
            ev.offset = (int16_t)offset;
            ev.note = note;
            ev.pitch = pitch;
            ev.value = velocity;
            out->push(ev);
        };
    }
    void process(const ProcessContext& c) override {
        if (const auto* loaded = handoff_.get(); loaded && loaded != applied_) {
            applied_ = loaded;
            dsp_.setNotes(loaded->data(), (int)loaded->size(), emit(c, 0));
        }
        static constexpr double kGrid[7] = {0.0, 1.0, 0.5, 0.25, 0.125, 1.0 / 3.0, 1.0 / 6.0};
        patch::LooperParams p;
        p.bars = (int)value(c, Bars, 0);
        p.beatsPerBar = (double)setting(BeatsPerBar);
        p.speed = (int)setting(Speed);
        p.gridBeats = kGrid[std::clamp((int)setting(Quantize), 0, 6)];
        p.muteThru = setting(Thru) >= 0.5f;
        p.seed = (uint32_t)setting(Seed);
        const Transport& tr = *c.transport;
        p.running = tr.playing && tr.ppqValid;
        p.bpm = tr.bpm;
        const bool recPatched = c.inputConnected[Rec];
        const int baseMode = (int)setting(Mode);

        pollCommands([&](const Command& cmd) {
            if (cmd.value < 0.5f) return;
            if (cmd.index == Clear) dsp_.clear(emit(c, 0));
            else if (cmd.index == Undo) dsp_.undo(emit(c, 0));
        });

        const bool connected = c.inputConnected[Notes];
        NoteBuffer& out = *c.notesOut[NotesOut];
        out.clear();
        if (!connected && wasConnected_) dsp_.flush(emit(c, 0));
        wasConnected_ = connected;

        const NoteBuffer* in = connected ? c.notesIn[Notes] : nullptr;
        int e = 0;
        bool rec = false;
        for (int i = 0; i < c.numSamples; ++i) {
            p.mode = recPatched ? (c.inputs[Rec][i] >= 0.5f ? patch::LoopOverdub : patch::LoopPlay) : baseMode;
            p.probability = value(c, Probability, i);
            p.strength = value(c, Strength, i);
            p.ppq = c.ppqAt(i);
            for (; in && e < in->count && in->events[e].offset <= i; ++e) {
                const NoteEvent& ev = in->events[e];
                if (ev.type == NoteEvent::On) dsp_.noteOn(ev.note, ev.pitch, ev.value, p, emit(c, i));
                else if (ev.type == NoteEvent::Off) dsp_.noteOff(ev.note, p, emit(c, i));
                else if (ev.type != NoteEvent::Pressure) out.pushController(ev);
            }
            if (dsp_.tick(p, out.count < kMaxNotesPerChunk - 4, emit(c, i))) passLeft_ = pulse_;
            rec = p.mode != patch::LoopPlay;
            c.outputs[PassOut][i] = passLeft_ > 0 ? 1.0f : 0.0f;
            c.outputs[Recording][i] = rec ? 1.0f : 0.0f;
            const double loop = NoteLooperDsp::loopBeats(p);
            c.outputs[Phase][i] = (float)(dsp_.position() / loop);
            if (passLeft_ > 0) --passLeft_;
        }
        const double loop = NoteLooperDsp::loopBeats(p);
        pos_.store((float)(dsp_.position() / loop));
        loop_.store((float)loop);
        mode_.store(rec ? (p.mode == patch::LoopRecord ? 1 : 2) : 0);
        running_.store(p.running);
        if (dsp_.takeChanged()) snap_.write(dsp_);
    }

private:
    std::vector<LoopNote> read() const {
        std::vector<LoopNote> v;
        const std::vector<float> f = snap_.read();
        for (size_t i = 0; i + kFields <= f.size(); i += kFields) {
            LoopNote n;
            n.start = f[i];
            n.length = f[i + 1];
            n.note = (int)f[i + 2];
            n.velocity = f[i + 3];
            n.layer = (uint16_t)f[i + 4];
            n.pitch = dsp::notePitch(n.note);
            v.push_back(n);
        }
        return v;
    }

    NoteLooperDsp dsp_;
    Snapshot snap_;
    std::string data_;
    RtHandoff<std::vector<LoopNote>> handoff_;
    const std::vector<LoopNote>* applied_ = nullptr;
    int pulse_ = 96, passLeft_ = 0;
    bool wasConnected_ = false;
    std::atomic<float> pos_{0.0f}, loop_{8.0f};
    std::atomic<int> mode_{0};
    std::atomic<bool> running_{false};
};

}  // namespace

static void registerNoteLooperModule(Registry& r) {
    ModuleSpec s;
    s.type = "note-looper";
    s.name = "Note Looper";
    s.category = "Sequencing/Melodic";
    s.colour = "#f28b82";
    s.description = "Records the notes you play with their timing for 1-16 bars and loops them: overdub, undo, probability, half and double speed, quantize.";
    s.params = {ParamSpec::choice("mode", "Mode", {"Play", "Record", "Overdub"}, 0),
                ParamSpec::steppedInt("bars", "Bars", 1, patch::kLoopMaxBars, 2),
                ParamSpec::integer("beatsperbar", "Beats Per Bar", 1, 8, 4),
                ParamSpec::choice("speed", "Speed", {"Half", "Normal", "Double"}, 1),
                ParamSpec::percent("probability", "Probability", 0.0f, 1.0f, 1.0f),
                ParamSpec::choice("quantize", "Quantize", {"Off", "1/4", "1/8", "1/16", "1/32", "1/8T", "1/16T"}, 0),
                ParamSpec::percent("strength", "Strength", 0.0f, 1.0f, 1.0f),
                ParamSpec::choice("thru", "Thru", {"Pass", "Mute"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"notes", "Notes", Signal::Notes}, {"rec", "Rec", Signal::Gate}};
    s.outputs = {{"notes", "Notes", Signal::Notes, false},
                 {"pass", "Pass", Signal::Trigger, false},
                 {"recording", "Recording", Signal::Gate, false},
                 {"phase", "Phase", Signal::Control, false}};
    s.buttons = {{"clear", "Clear"}, {"undo", "Undo"}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<NoteLooperModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerNoteLooperModule);

}  // namespace bleep::engine
