// SPDX-License-Identifier: MIT
// Drum Grid node (doc/specs/modules/drum-grid.md): patterns from the node's
// data, timing from the transport, its own tempo or a clock; gate, accent
// and velocity out per track.
#include "DrumGridDsp.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <atomic>

namespace bleep::engine {
namespace {

using patch::DrumGridDsp;
using patch::GridBank;
using patch::kGridSlots;
using patch::kGridSteps;
using patch::kGridTracks;

const char* const kTrackNames[kGridTracks] = {"Kick", "Snare", "Closed Hat", "Open Hat", "Clap", "Low Tom", "High Tom", "Perc"};

/// A new module: slot 1 plays four on the floor with off-beat hats.
juce::var freshPattern() {
    auto* o = new juce::DynamicObject();
    o->setProperty("name", "Four on the Floor");
    o->setProperty("length", 16);
    juce::Array<juce::var> steps{"x...x...x...x...", "", "..x...x...x...x.", "", "", "", "", ""};
    o->setProperty("steps", steps);
    return juce::var(o);
}

int intOr(const juce::var& v, int def) { return v.isInt() || v.isInt64() || v.isDouble() ? (int)v : def; }

/// One pattern's steps, `.` Off, `x` On, `X` Accent, padded to 32.
juce::String rowOf(const juce::var& v) {
    const auto s = v.toString().substring(0, kGridSteps);
    juce::String out;
    for (int i = 0; i < kGridSteps; ++i) {
        const auto c = i < s.length() ? s[i] : '.';
        out << (c == 'x' || c == 'X' ? juce::String::charToString(c) : juce::String("."));
    }
    return out;
}

/// The sanitised data as a var (spec §6).
juce::var sanitised(const juce::var& in) {
    const bool fresh = in["patterns"].getArray() == nullptr;
    auto* out = new juce::DynamicObject();
    juce::var result(out);

    juce::Array<juce::var> tracks;
    const auto* tin = in["tracks"].getArray();
    for (int k = 0; k < kGridTracks; ++k) {
        const juce::var t = tin && k < tin->size() ? (*tin)[k] : juce::var();
        auto* o = new juce::DynamicObject();
        const auto name = t["name"].toString().trim().substring(0, 24);
        o->setProperty("name", name.isEmpty() ? juce::String(kTrackNames[k]) : name);
        o->setProperty("mute", (bool)t.getProperty("mute", false));
        o->setProperty("solo", (bool)t.getProperty("solo", false));
        tracks.add(juce::var(o));
    }
    out->setProperty("tracks", tracks);
    out->setProperty("current", juce::jlimit(0, kGridSlots - 1, intOr(in["current"], 0)));

    juce::Array<juce::var> patterns;
    const auto* pin = in["patterns"].getArray();
    for (int s = 0; s < kGridSlots; ++s) {
        juce::var p = pin && s < pin->size() ? (*pin)[s] : juce::var();
        if (fresh && s == 0) p = freshPattern();
        if (!p.isObject()) {
            patterns.add(juce::var());
            continue;
        }
        auto* o = new juce::DynamicObject();
        o->setProperty("name", p["name"].toString().trim().substring(0, 40));
        o->setProperty("length", juce::jlimit(1, kGridSteps, intOr(p["length"], 16)));
        juce::Array<juce::var> rows;
        const auto* rin = p["steps"].getArray();
        for (int k = 0; k < kGridTracks; ++k) rows.add(rowOf(rin && k < rin->size() ? (*rin)[k] : juce::var()));
        o->setProperty("steps", rows);
        patterns.add(juce::var(o));
    }
    out->setProperty("patterns", patterns);
    return result;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    return juce::JSON::toString(sanitised(in), true).toStdString();
}

GridBank parseBank(const juce::var& data) {
    const juce::var d = sanitised(data);
    GridBank b;
    b.current = (int)d["current"];
    for (int k = 0; k < kGridTracks; ++k) {
        if ((bool)d["tracks"][k]["mute"]) b.mute |= (uint8_t)(1u << k);
        if ((bool)d["tracks"][k]["solo"]) b.solo |= (uint8_t)(1u << k);
    }
    for (int s = 0; s < kGridSlots; ++s) {
        const juce::var p = d["patterns"][s];
        auto& pat = b.patterns[(size_t)s];
        if (!p.isObject()) continue;  // empty: silence
        pat.length = (int)p["length"];
        for (int k = 0; k < kGridTracks; ++k) {
            const auto row = p["steps"][k].toString();
            for (int i = 0; i < kGridSteps && i < row.length(); ++i)
                pat.cells[(size_t)k][(size_t)i] = row[i] == 'X' ? patch::GridAccent : row[i] == 'x' ? patch::GridOn : patch::GridOff;
        }
    }
    return b;
}

class DrumGridModule final : public Module {
public:
    enum { Tempo, GateLength, Swing, Velocity, Source, Rate, Ppqn, Switch };
    enum { Clock, Run, Reset, Pattern };
    static constexpr int kAccent = kGridTracks * 3, kStepClock = kAccent + 1, kEnd = kAccent + 2, kRunning = kAccent + 3;

    explicit DrumGridModule(const ModuleSpec& spec) : Module(spec) { setData(sanitiseData({})); }

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        const GridBank b = parseBank(juce::JSON::parse(juce::String(json)));
        const juce::SpinLock::ScopedLockType lock(lock_);
        pending_ = b;
        hasPending_ = true;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"step", (double)step_.load()});
        out.push_back({"playing", (double)playing_.load()});
        out.push_back({"queued", (double)queued_.load()});
        out.push_back({"hits", (double)hits_.load()});
        out.push_back({"running", running_.load() ? 1.0 : 0.0});
    }

    void process(const ProcessContext& c) override {
        {
            const juce::SpinLock::ScopedTryLockType lock(lock_);
            if (lock.isLocked() && hasPending_) {
                dsp_.setBank(pending_);
                hasPending_ = false;
            }
        }
        patch::GridParams p;
        p.source = (int)setting(Source);
        p.rate = (int)setting(Rate);
        p.ppqn = (int)setting(Ppqn);
        p.switchMode = (int)setting(Switch);
        const Transport& tr = *c.transport;
        patch::GridTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        patch::GridInputs in;
        in.clockPatched = c.inputConnected[Clock];
        in.runPatched = c.inputConnected[Run];
        in.patternPatched = c.inputConnected[Pattern];
        patch::GridOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            p.tempo = value(c, Tempo, i);
            p.gateLength = value(c, GateLength, i);
            p.swing = value(c, Swing, i);
            p.velocity = value(c, Velocity, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            in.clock = c.inputs[Clock][i];
            in.run = c.inputs[Run][i];
            in.reset = c.inputs[Reset][i];
            in.pattern = c.inputs[Pattern][i];
            dsp_.tick(p, in, t, o);
            for (int k = 0; k < kGridTracks; ++k) {
                c.outputs[k * 3][i] = o.gate[(size_t)k];
                c.outputs[k * 3 + 1][i] = o.accent[(size_t)k];
                c.outputs[k * 3 + 2][i] = o.velocity[(size_t)k];
            }
            c.outputs[kAccent][i] = o.accentAny;
            c.outputs[kStepClock][i] = o.stepClock;
            c.outputs[kEnd][i] = o.end;
            c.outputs[kRunning][i] = o.running;
        }
        step_.store(dsp_.playingStep());
        playing_.store(dsp_.playingSlot());
        queued_.store(dsp_.queuedSlot());
        hits_.store(dsp_.hits());
        running_.store(dsp_.running());
    }

private:
    DrumGridDsp dsp_;
    std::string data_;  // message thread
    juce::SpinLock lock_;
    GridBank pending_{};
    bool hasPending_ = false;
    std::atomic<int> step_{0}, playing_{0}, queued_{-1}, hits_{0};
    std::atomic<bool> running_{false};
};

}  // namespace

void registerDrumGridModule(Registry& r) {
    ModuleSpec s;
    s.type = "drum-grid";
    s.name = "Drum Grid";
    s.category = "Sequencing";
    s.colour = "#fb923c";
    s.description = "8 drum tracks × up to 32 steps (off, on, accent), 16 pattern slots, gate, accent and velocity out per track.";
    std::vector<std::string> rates, ppqn;
    for (const char* n : DrumGridDsp::rateNames()) rates.emplace_back(n);
    for (const char* n : DrumGridDsp::ppqnNames()) ppqn.emplace_back(n);
    s.params = {ParamSpec::number("tempo", "Tempo", 20.0f, 300.0f, 120.0f, "BPM", 1),
                ParamSpec::percent("gatelength", "Gate Length", 0.01f, 1.0f, 0.25f),
                ParamSpec::percent("swing", "Swing", 0.5f, 0.75f, 0.5f),
                ParamSpec::percent("velocity", "Velocity", 0.0f, 1.0f, 0.7f),
                ParamSpec::choice("source", "Source", {"Transport", "Tempo"}, 0),
                ParamSpec::choice("rate", "Rate", rates, 7),
                ParamSpec::choice("ppqn", "Clock PPQN", ppqn, 0),
                ParamSpec::choice("switch", "Switch", {"At End", "Immediate"}, 0)};
    s.inputs = {{"clock", "Clock", Signal::Trigger},
                {"run", "Run", Signal::Gate},
                {"reset", "Reset", Signal::Trigger},
                {"pattern", "Pattern", Signal::Control}};
    for (int k = 1; k <= kGridTracks; ++k) {
        const auto n = std::to_string(k);
        s.outputs.push_back({"gate" + n, "Gate " + n, Signal::Gate, false});
        s.outputs.push_back({"accent" + n, "Accent " + n, Signal::Gate, false});
        s.outputs.push_back({"velocity" + n, "Velocity " + n, Signal::Control, false});
    }
    s.outputs.push_back({"accent", "Accent", Signal::Gate, false});
    s.outputs.push_back({"stepclock", "Step Clock", Signal::Trigger, false});
    s.outputs.push_back({"end", "End", Signal::Trigger, false});
    s.outputs.push_back({"running", "Running", Signal::Gate, false});
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<DrumGridModule>(spec); });
}

}  // namespace bleep::engine
