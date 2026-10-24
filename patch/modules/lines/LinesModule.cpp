// SPDX-License-Identifier: GPL-3.0-only
// Lines node (doc/specs/modules/lines.md): patterns of rows and an order list
// from the node's data, four tracks each with its own speed and length, timing
// from the transport or a clock; notes, gate, pitch and velocity per track.
#include "LinesDsp.h"
#include "Handoff.h"
#include "Registry.h"
#include "dsp/Harmony.h"
#include "dsp/SeqClock.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <memory>

namespace bleep::engine {
namespace {

using patch::LinesCell;
using patch::LinesDsp;
using patch::LinesPattern;
using patch::LinesSong;

int number(const juce::var& v, int def) {
    return v.isDouble() || v.isInt() || v.isInt64() || v.isBool() ? (int)(double)v : def;
}

/// A new module plays this: a bass line, a chord pulse and a high line of different lengths.
void defaultSong(LinesSong& s) {
    LinesPattern& p = s.patterns[0];
    p.rows = 16;
    const int bass[4] = {36, 36, 43, 39};
    for (int i = 0; i < 4; ++i) {
        LinesCell c;
        c.note = (uint8_t)bass[i];
        c.vel = i == 0 ? 112 : 0;
        c.gate = 6;
        p.cells[0][(size_t)(i * 4)] = c;
    }
    const int lead[3] = {72, 75, 79};
    for (int i = 0; i < 3; ++i) {
        LinesCell c;
        c.note = (uint8_t)lead[i];
        p.cells[1][(size_t)(i * 2)] = c;
    }
}

void parsePattern(const juce::var& v, LinesPattern& p) {
    p.rows = juce::jlimit(patch::kLinesMinRows, patch::kLinesMaxRows, number(v["rows"], 16));
    const auto* tracks = v["tracks"].getArray();
    if (tracks == nullptr) return;
    for (int k = 0; k < patch::kLinesTracks && k < tracks->size(); ++k) {
        const auto* cells = (*tracks)[k].getArray();
        if (cells == nullptr) continue;
        for (const auto& item : *cells) {
            const auto* f = item.getArray();
            if (f == nullptr || f->size() < 2) continue;
            const int row = number((*f)[0], -1);
            if (row < 0 || row >= p.rows) continue;
            LinesCell c;
            c.note = (uint8_t)juce::jlimit(0, 128, number((*f)[1], 0));
            c.vel = (uint8_t)juce::jlimit(0, 127, f->size() > 2 ? number((*f)[2], 0) : 0);
            c.gate = (uint8_t)juce::jlimit(0, 15, f->size() > 3 ? number((*f)[3], 0) : 0);
            c.fx = (uint8_t)juce::jlimit(0, (int)patch::kFxCount - 1, f->size() > 4 ? number((*f)[4], 0) : 0);
            c.fxp = (uint8_t)juce::jlimit(0, 255, f->size() > 5 ? number((*f)[5], 0) : 0);
            p.cells[(size_t)k][(size_t)row] = c;
        }
    }
}

LinesSong parseSong(const juce::var& data) {
    LinesSong s;
    const auto* pats = data["patterns"].getArray();
    if (pats == nullptr) {
        defaultSong(s);
        s.order[0] = 0;
        s.orderLen = 1;
        return s;
    }
    for (int i = 0; i < patch::kLinesPatterns && i < pats->size(); ++i) parsePattern((*pats)[i], s.patterns[(size_t)i]);
    s.orderLen = 0;
    if (const auto* o = data["order"].getArray())
        for (const auto& e : *o)
            if (s.orderLen < patch::kLinesOrder) s.order[(size_t)s.orderLen++] = (uint8_t)juce::jlimit(0, patch::kLinesPatterns - 1, number(e, 0));
    if (s.orderLen == 0) {
        s.order[0] = 0;
        s.orderLen = 1;
    }
    return s;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const LinesSong s = parseSong(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    out->setProperty("pattern", juce::jlimit(0, patch::kLinesPatterns - 1, number(in["pattern"], 0)));
    out->setProperty("octave", juce::jlimit(0, 8, number(in["octave"], 4)));
    out->setProperty("edit", juce::jlimit(0, 8, number(in["edit"], 1)));
    juce::Array<juce::var> order;
    for (int i = 0; i < s.orderLen; ++i) order.add((int)s.order[(size_t)i]);
    out->setProperty("order", order);
    juce::Array<juce::var> pats;
    for (const auto& pat : s.patterns) {
        auto* po = new juce::DynamicObject();
        po->setProperty("rows", pat.rows);
        juce::Array<juce::var> tracks;
        for (int k = 0; k < patch::kLinesTracks; ++k) {
            juce::Array<juce::var> cells;
            for (int r = 0; r < pat.rows; ++r) {
                const LinesCell& c = pat.cells[(size_t)k][(size_t)r];
                if (c.note == 0 && c.fx == 0) continue;
                cells.add(juce::Array<juce::var>{r, (int)c.note, (int)c.vel, (int)c.gate, (int)c.fx, (int)c.fxp});
            }
            tracks.add(cells);
        }
        po->setProperty("tracks", tracks);
        pats.add(juce::var(po));
    }
    out->setProperty("patterns", pats);
    return juce::JSON::toString(result, true).toStdString();
}

class LinesModule final : public Module {
public:
    enum { Gate, Velocity, Rate, Drift, Root, Scale, Harmony, Quantize, Seed, SyncTo, TrackBase };
    enum { TSpeed, TLength, TOctave, TMute, kPerTrack };
    enum { Clock, Reset, Transpose };
    enum { OPattern = 16, OEnd, ORow };  // per track: notes, pitch, gate, velocity

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        dsp_.reset();
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        handoff_.publish(std::make_shared<LinesSong>(parseSong(juce::JSON::parse(juce::String(json)))));
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"order", (double)order_.load()});
        out.push_back({"pattern", (double)pattern_.load()});
        out.push_back({"row", (double)row_.load()});
        for (int k = 0; k < patch::kLinesTracks; ++k) {
            out.push_back({"row" + std::to_string(k), (double)trackRow_[(size_t)k].load()});
            out.push_back({"on" + std::to_string(k), sounding_[(size_t)k].load() ? 1.0 : 0.0});
        }
    }

    void process(const ProcessContext& c) override {
        dsp_.setSong(handoff_.get());
        patch::LinesParams p;
        p.rate = (int)setting(Rate);
        p.freeRun = (int)setting(Drift) == 0;
        p.gate = value(c, Gate, 0);
        p.velocity = value(c, Velocity, 0);
        p.root = (int)setting(Root);
        p.scale = (int)setting(Scale);
        if (const int bus = (int)setting(Harmony); bus > 0 && c.harmony != nullptr) {
            const dsp::HarmonyState& h = c.harmony[bus - 1];
            if (h.valid) {
                p.root = h.key;
                p.scaleMask = h.scale;
            }
        }
        p.snap = (int)setting(Quantize) == 1;
        p.seed = (uint32_t)setting(Seed);
        for (int k = 0; k < patch::kLinesTracks; ++k) {
            const int base = TrackBase + k * kPerTrack;
            p.speed[(size_t)k] = (int)std::lround(value(c, base + TSpeed, 0));
            p.length[(size_t)k] = (int)std::lround(value(c, base + TLength, 0));
            p.octave[(size_t)k] = (int)setting(base + TOctave);
            p.mute[(size_t)k] = setting(base + TMute) >= 0.5f;
        }
        const Transport& tr = *c.transport;
        patch::LinesTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        patch::LinesInputs in;
        in.clockPatched = dsp::clockSynced((int)setting(SyncTo), c.inputConnected[Clock]);
        NoteBuffer* notes[patch::kLinesTracks];
        for (int k = 0; k < patch::kLinesTracks; ++k) {
            notes[k] = c.notesOut[k * 4];
            notes[k]->clear();
        }
        patch::LinesOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            in.clock = c.inputs[Clock][i];
            in.reset = c.inputs[Reset][i];
            in.transpose = c.inputs[Transpose][i];
            dsp_.tick(p, in, t, o, [&](int track, bool on, int note, float pitch, float velocity) {
                NoteEvent e;
                e.type = on ? NoteEvent::On : NoteEvent::Off;
                e.offset = (int16_t)i;
                e.note = note;
                e.pitch = pitch;
                e.value = velocity;
                notes[track]->push(e);
            });
            for (int k = 0; k < patch::kLinesTracks; ++k) {
                c.outputs[k * 4 + 1][i] = o.pitch[(size_t)k];
                c.outputs[k * 4 + 2][i] = o.gate[(size_t)k];
                c.outputs[k * 4 + 3][i] = o.velocity[(size_t)k];
            }
            c.outputs[OPattern][i] = o.pattern;
            c.outputs[OEnd][i] = o.end;
            c.outputs[ORow][i] = o.row;
        }
        order_.store(dsp_.orderIndex());
        pattern_.store(dsp_.patternIndex());
        row_.store(dsp_.localRow());
        for (int k = 0; k < patch::kLinesTracks; ++k) {
            trackRow_[(size_t)k].store(dsp_.trackRow(k));
            sounding_[(size_t)k].store(dsp_.sounding(k));
        }
    }

private:
    LinesDsp dsp_;
    std::string data_;  // message thread
    RtHandoff<LinesSong> handoff_;
    std::atomic<int> order_{0}, pattern_{0}, row_{0};
    std::array<std::atomic<int>, patch::kLinesTracks> trackRow_{};
    std::array<std::atomic<bool>, patch::kLinesTracks> sounding_{};
};

}  // namespace

static void registerLinesModule(Registry& r) {
    ModuleSpec s;
    s.type = "lines";
    s.name = "Lines";
    s.category = "Sequencing/Melodic";
    s.colour = "#e0856a";
    s.description = "A four-track text tracker: note, velocity, gate and an effect per row, a pattern order, and a speed and length per track so the lines drift.";
    std::vector<std::string> rates, roots, scales, speeds;
    for (int i = 0; i < dsp::kNumSequencerRates; ++i) rates.emplace_back(dsp::sequencerRate(i).name);
    for (const char* n : {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}) roots.emplace_back(n);
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    for (const char* n : LinesDsp::speedNames()) speeds.emplace_back(n);
    s.params = {ParamSpec::percent("gate", "Gate", 0.05f, 1.0f, 0.5f),
                ParamSpec::percent("velocity", "Velocity", 0.05f, 1.0f, 0.8f),
                ParamSpec::choice("rate", "Row Rate", rates, 9),
                ParamSpec::choice("drift", "Tracks", {"Free-run", "Per pattern"}, 0),
                ParamSpec::choice("root", "Root", roots, 0),
                ParamSpec::choice("scale", "Scale", scales, 2),
                ParamSpec::choice("harmony", "Harmony", {"Off", "Bus A", "Bus B", "Bus C", "Bus D"}, 0),
                ParamSpec::choice("quantize", "Quantize", {"Off", "To scale"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1),
                ParamSpec::choice("syncto", "Sync To", dsp::seqSyncNames(), dsp::SyncAuto)};
    for (int k = 0; k < patch::kLinesTracks; ++k) {
        const std::string n = std::to_string(k + 1), g = "Track " + n;
        s.params.push_back(ParamSpec::stepped("speed" + n, "Speed " + n, speeds, 5).inGroup(g));
        s.params.push_back(ParamSpec::steppedInt("length" + n, "Length " + n, 1, patch::kLinesMaxRows, 16).inGroup(g));
        s.params.push_back(ParamSpec::integer("octave" + n, "Octave " + n, -3, 3, 0).inGroup(g));
        s.params.push_back(ParamSpec::toggle("mute" + n, "Mute " + n, false).inGroup(g));
    }
    s.harmony = HarmonyRole::Reader;  // follows a Harmony Master when Harmony is set
    s.inputs = {{"clock", "Clock", Signal::Trigger}, {"reset", "Reset", Signal::Trigger}, {"transpose", "Transpose", Signal::Pitch}};
    for (int k = 0; k < patch::kLinesTracks; ++k) {
        const std::string n = std::to_string(k + 1);
        s.outputs.push_back({"notes" + n, "Notes " + n, Signal::Notes, false});
        s.outputs.push_back({"pitch" + n, "Pitch " + n, Signal::Pitch, true});
        s.outputs.push_back({"gate" + n, "Gate " + n, Signal::Gate, false});
        s.outputs.push_back({"velocity" + n, "Velocity " + n, Signal::Control, false});
    }
    s.outputs.push_back({"pattern", "Pattern", Signal::Trigger, false});
    s.outputs.push_back({"end", "End", Signal::Trigger, false});
    s.outputs.push_back({"row", "Row", Signal::Control, false});
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<LinesModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerLinesModule);

}  // namespace bleep::engine
