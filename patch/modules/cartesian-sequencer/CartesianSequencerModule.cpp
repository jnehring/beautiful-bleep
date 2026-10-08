// SPDX-License-Identifier: MIT
// Cartesian Seq node (specs/modules/cartesian-sequencer.md): an 8 × 8 grid
// from the node's data, two playheads (or the X/Y knobs) walking it, notes
// and CV out.
#include "CartesianSequencerDsp.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <atomic>

namespace bleep::engine {
namespace {

using patch::CartCell;
using patch::CartesianSequencerDsp;
using patch::CartGrid;

/// A new module: the 4 × 4 corner plays rising broken chords (I, ii, iii, IV
/// read row-major), the first cell of each row a little louder, Mod rising
/// through the grid.
CartGrid defaultGrid() {
    static const int pitches[16] = {0, 4, 7, 12, 2, 5, 9, 14, 4, 7, 11, 16, 5, 9, 12, 17};
    CartGrid g{};
    for (int r = 0; r < 4; ++r)
        for (int c = 0; c < 4; ++c) {
            CartCell& cell = g[(size_t)(r * patch::kCartSize + c)];
            cell.gate = patch::CartOn;
            cell.pitch = (int8_t)pitches[r * 4 + c];
            cell.velocity = c == 0 ? 112 : 88;
            cell.mod = (int8_t)(-100 + (r * 4 + c) * 200 / 15);
        }
    return g;
}

/// The node's data, parsed and clamped.
CartGrid parseCells(const juce::var& data) {
    const auto* cells = data["cells"].getArray();
    if (cells == nullptr) return defaultGrid();
    CartGrid g{};
    for (int i = 0; i < patch::kCartCells && i < cells->size(); ++i) {
        const juce::var c = (*cells)[i];
        auto& cell = g[(size_t)i];
        cell.gate = (uint8_t)juce::jlimit(0, 2, (int)c.getProperty("g", 0));
        cell.pitch = (int8_t)juce::jlimit(patch::kCartMinPitch, patch::kCartMaxPitch, (int)c.getProperty("p", 0));
        cell.velocity = (uint8_t)juce::jlimit(1, 127, (int)c.getProperty("v", 100));
        cell.mod = (int8_t)juce::jlimit(-100, 100, (int)c.getProperty("m", 0));
        cell.play = (int)c.getProperty("a", 1) != 0;
    }
    return g;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const CartGrid g = parseCells(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> cells;
    for (const auto& c : g) {
        auto* o = new juce::DynamicObject();
        o->setProperty("g", (int)c.gate);
        o->setProperty("p", (int)c.pitch);
        o->setProperty("v", (int)c.velocity);
        o->setProperty("m", (int)c.mod);
        o->setProperty("a", c.play ? 1 : 0);
        cells.add(juce::var(o));
    }
    out->setProperty("cells", cells);
    // Randomize options (spec §5), kept for the view.
    const juce::var r = in["randomize"];
    auto* ro = new juce::DynamicObject();
    auto number = [&](const char* key, double def, double lo, double hi) {
        const auto v = r.getProperty(key, def);
        return juce::jlimit(lo, hi, v.isDouble() || v.isInt() || v.isInt64() ? (double)v : def);
    };
    ro->setProperty("density", number("density", 0.6, 0.0, 1.0));
    ro->setProperty("octaves", (int)number("octaves", 1, 1, 3));
    ro->setProperty("skip", number("skip", 0.0, 0.0, 0.5));
    double lo = 0.6, hi = 1.0;
    if (const auto* a = r["velocity"].getArray(); a && a->size() == 2) {
        lo = juce::jlimit(0.01, 1.0, (double)(*a)[0]);
        hi = juce::jlimit(0.01, 1.0, (double)(*a)[1]);
        if (lo > hi) std::swap(lo, hi);
    }
    ro->setProperty("velocity", juce::Array<juce::var>{lo, hi});
    out->setProperty("randomize", juce::var(ro));
    return juce::JSON::toString(result, true).toStdString();
}

class CartesianSequencerModule final : public Module {
public:
    enum { GateLength, Swing, X, Y, ModSlew, Columns, Rows, Mode, XRate, YRate, XDirection, YDirection, Sample,
           Root, Scale, Octave, Seed };
    enum { XClock, YClock, Reset, Transpose };
    enum { Notes, Pitch, Gate, Velocity, Mod, Trigger, XPos, YPos, RowEnd, GridEnd };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        const CartGrid g = parseCells(juce::JSON::parse(juce::String(json)));
        const juce::SpinLock::ScopedLockType lock(lock_);
        pending_ = g;
        hasPending_ = true;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        const int cell = cell_.load();
        out.push_back({"cell", (double)cell});
        out.push_back({"x", (double)(cell % patch::kCartSize)});
        out.push_back({"y", (double)(cell / patch::kCartSize)});
        out.push_back({"sounding", sounding_.load() ? 1.0 : 0.0});
        out.push_back({"px", (double)px_.load()});
        out.push_back({"py", (double)py_.load()});
    }

    void process(const ProcessContext& c) override {
        {
            const juce::SpinLock::ScopedTryLockType lock(lock_);
            if (lock.isLocked() && hasPending_) {
                dsp_.setGrid(pending_);
                hasPending_ = false;
            }
        }
        patch::CartParams p;
        p.columns = (int)setting(Columns);
        p.rows = (int)setting(Rows);
        p.mode = (int)setting(Mode);
        p.xRate = (int)setting(XRate);
        p.yRate = (int)setting(YRate);
        p.xDirection = (int)setting(XDirection);
        p.yDirection = (int)setting(YDirection);
        p.sample = (int)setting(Sample);
        p.root = (int)setting(Root);
        p.scale = (int)setting(Scale);
        p.octave = (int)setting(Octave);
        p.seed = (uint32_t)setting(Seed);
        const Transport& tr = *c.transport;
        patch::CartTime t;
        t.running = tr.playing && tr.ppqValid;
        t.bpm = tr.bpm;
        patch::CartInputs in;
        in.xPatched = c.inputConnected[XClock];
        in.yPatched = c.inputConnected[YClock];
        NoteBuffer& notes = *c.notesOut[Notes];
        notes.clear();
        patch::CartOutputs o;
        for (int i = 0; i < c.numSamples; ++i) {
            p.gateLength = value(c, GateLength, i);
            p.swing = value(c, Swing, i);
            p.x = value(c, X, i);
            p.y = value(c, Y, i);
            p.modSlew = value(c, ModSlew, i);
            t.started = c.transportStarted && i == 0;
            t.ppq = c.ppqAt(i);
            in.xClock = c.inputs[XClock][i];
            in.yClock = c.inputs[YClock][i];
            in.reset = c.inputs[Reset][i];
            in.transpose = c.inputs[Transpose][i];
            dsp_.tick(p, in, t, o, dsp::noteEmitter(notes, i));
            c.outputs[Pitch][i] = o.pitch;
            c.outputs[Gate][i] = o.gate;
            c.outputs[Velocity][i] = o.velocity;
            c.outputs[Mod][i] = o.mod;
            c.outputs[Trigger][i] = o.trigger;
            c.outputs[XPos][i] = o.xPos;
            c.outputs[YPos][i] = o.yPos;
            c.outputs[RowEnd][i] = o.rowEnd;
            c.outputs[GridEnd][i] = o.gridEnd;
        }
        cell_.store(dsp_.playingCell());
        sounding_.store(dsp_.sounding());
        px_.store(p.x);
        py_.store(p.y);
    }

private:
    CartesianSequencerDsp dsp_;
    std::string data_;  // message thread
    juce::SpinLock lock_;
    CartGrid pending_{};
    bool hasPending_ = false;
    std::atomic<int> cell_{0};
    std::atomic<bool> sounding_{false};
    std::atomic<float> px_{0.0f}, py_{0.0f};
};

}  // namespace

void registerCartesianSequencerModule(Registry& r) {
    ModuleSpec s;
    s.type = "cartesian-sequencer";
    s.name = "Cartesian Seq";
    s.category = "Sequencing";
    s.colour = "#e8c547";
    s.description = "An 8 × 8 grid of notes walked by two playheads, or picked by X and Y. Notes out plays a Voice Cell.";
    std::vector<std::string> rates, yRates{"Wrap", "Off"}, roots, scales;
    for (int i = 0; i < dsp::kNumSequencerRates; ++i) {
        rates.emplace_back(dsp::sequencerRate(i).name);
        yRates.emplace_back(dsp::sequencerRate(i).name);
    }
    for (const char* n : {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}) roots.emplace_back(n);
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    const std::vector<std::string> directions{"Forward", "Backward", "Ping-Pong", "Random"};
    s.params = {ParamSpec::percent("gatelength", "Gate Length", 0.01f, 1.0f, 0.5f),
                ParamSpec::percent("swing", "Swing", 0.5f, 0.75f, 0.5f),
                ParamSpec::percent("x", "X", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("y", "Y", 0.0f, 1.0f, 0.0f),
                ParamSpec::seconds("modslew", "Mod Slew", 0.0f, 1.0f, 0.1f, 0.0f),
                ParamSpec::integer("columns", "Columns", 1, patch::kCartSize, 4),
                ParamSpec::integer("rows", "Rows", 1, patch::kCartSize, 4),
                ParamSpec::choice("mode", "Mode", {"Clocks", "Cartesian"}, 0),
                ParamSpec::choice("xrate", "X Rate", rates, 9),
                ParamSpec::choice("yrate", "Y Rate", yRates, 0).when("mode", 0, 0),
                ParamSpec::choice("xdirection", "X Direction", directions, 0).when("mode", 0, 0),
                ParamSpec::choice("ydirection", "Y Direction", directions, 0).when("mode", 0, 0),
                ParamSpec::choice("sample", "Sample", {"Clock", "Change"}, 0).when("mode", 1, 1),
                ParamSpec::choice("root", "Root", roots, 0),
                ParamSpec::choice("scale", "Scale", scales, 1),
                ParamSpec::integer("octave", "Octave", -3, 3, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"xclock", "X Clock", Signal::Trigger},
                JackSpec{"yclock", "Y Clock", Signal::Trigger}.when("mode", 0, 0),
                {"reset", "Reset", Signal::Trigger},
                {"transpose", "Transpose", Signal::Pitch}};
    s.outputs = {{"notes", "Notes", Signal::Notes, false},     {"pitch", "Pitch", Signal::Pitch, true},
                 {"gate", "Gate", Signal::Gate, false},        {"velocity", "Velocity", Signal::Control, false},
                 {"mod", "Mod", Signal::Control, true},        {"trigger", "Trigger", Signal::Trigger, false},
                 {"xpos", "X Pos", Signal::Control, false},    {"ypos", "Y Pos", Signal::Control, false},
                 {"rowend", "Row End", Signal::Trigger, false}, {"gridend", "Grid End", Signal::Trigger, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<CartesianSequencerModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerCartesianSequencerModule);

}  // namespace bleep::engine
