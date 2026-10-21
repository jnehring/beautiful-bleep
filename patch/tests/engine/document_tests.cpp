// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// document_tests.cpp — board documents: spec mapping, sanitising, the compiler (cells, feedback), persistence, undo and panels.

#include "engine_test.h"

#include <limits>

namespace {

void specMapping() {
    g_test = "spec";
    const auto cutoff = ParamSpec::hertz("c", "Cutoff", 20.0f, 20000.0f, 2000.0f);
    EXPECT_NEAR(cutoff.fromNormalised(0.0f), 20.0, 1e-3);
    EXPECT_NEAR(cutoff.fromNormalised(1.0f), 20000.0, 0.5);
    EXPECT_NEAR(cutoff.fromNormalised(cutoff.toNormalised(2000.0f)), 2000.0, 0.5);
    const auto rise = ParamSpec::seconds("r", "Rise", 0.001f, 10.0f, 0.25f, 0.25f);
    EXPECT_NEAR(rise.toNormalised(0.25f), 0.5, 1e-4);  // centre in the middle of the knob
    EXPECT_NEAR(rise.fromNormalised(0.5f), 0.25, 1e-4);
    const auto sync = ParamSpec::choice("s", "Sync", {"Free", "1/4", "1 bar"}, 1);
    EXPECT(sync.numSteps() == 3);
    EXPECT(sync.text(sync.fromNormalised(sync.defaultNormalised())) == "1/4");
    EXPECT(compatible(Signal::Audio, Signal::Control));
    EXPECT(!compatible(Signal::Notes, Signal::Control));
}

void sanitising() {
    g_test = "sanitise";
    juce::StringArray warnings;
    auto d = board::sanitise(
        doc({node("u", "utility"), node("f", "filter"), node("x", "no-such-module"), node("c", "cell"),
             node("inner", "utility", "c"), obj({{"id", "p"}, {"type", "audio-in"}, {"parent", "c"}, {"port", "P1"}})},
            {cable("u", "out", "f", "cutoff", -0.5), cable("u", "out", "f", "nope"), cable("x", "out", "f", "pitch"),
             cable("u", "out", "inner", "x"), cable("u", "out", "f", "cutoff", 0.2)}),
        &warnings);
    const auto model = board::parse(d);
    EXPECT(model.node("x") != nullptr && model.node("x")->spec == nullptr);  // a module that is not installed: the node waits as a placeholder
    EXPECT(model.node("p") != nullptr && model.node("p")->parent.empty());  // ports live on the top level
    int cellIns = 0, cellOuts = 0;
    for (const auto& n : model.nodes) {
        cellIns += n.type == kCellIn && n.parent == "c";
        cellOuts += n.type == kCellOut && n.parent == "c";
    }
    EXPECT(cellIns == 1 && cellOuts == 1);
    EXPECT(model.cables.size() == 2);  // unknown jack, cell border and duplicate dropped; the placeholder's cable kept as it was
    if (!model.cables.empty()) EXPECT_NEAR(model.cables[0].amount, -0.5, 1e-6);
    EXPECT(!warnings.isEmpty());
    // Params are filled with defaults.
    EXPECT(model.node("f")->params.count("cutoff") == 1);
}

void compileCellsAndFeedback() {
    g_test = "compile";
    // Utility (offset +1) → cell jack → inside: Cell In → Filter.cutoff (-1). Amounts multiply: -0.5.
    juce::Array<juce::var> nodes{node("u", "utility"), node("c", "cell"), node("f", "filter", "c"),
                                 obj({{"id", "ci"}, {"type", kCellIn}, {"parent", "c"}}),
                                 obj({{"id", "co"}, {"type", kCellOut}, {"parent", "c"}})};
    nodes.getReference(1).getDynamicObject()->setProperty(
        "inputs", juce::Array<juce::var>{obj({{"id", "in1"}, {"name", "Mod"}, {"type", "control"}})});
    nodes.getReference(0).getDynamicObject()->setProperty("params", obj({{"offset", 1.0}}));
    // Feedback: two utilities in a loop.
    nodes.add(node("a", "utility"));
    nodes.add(node("b", "utility"));
    auto d = board::sanitise(doc(nodes, {cable("u", "out", "c", "in1", 0.5), cable("ci", "in1", "f", "cutoff", -1.0),
                                         cable("a", "out", "b", "x"), cable("b", "out", "a", "x")}));
    std::map<std::string, std::shared_ptr<Module>> modules;
    auto program = Program::compile(board::parse(d), modules, {}, kRate);
    EXPECT(program->steps().size() == 4);  // u, f, a, b — cells are flattened away
    const Program::Step* filter = nullptr;
    for (const auto& st : program->steps())
        if (st.nodeId == "f") filter = &st;
    EXPECT(filter != nullptr);
    if (filter) {
        const int cutoff = filter->module->spec().paramIndex("cutoff");
        EXPECT(filter->paramSources[(size_t)cutoff].size() == 1);
        if (!filter->paramSources[(size_t)cutoff].empty())
            EXPECT_NEAR(filter->paramSources[(size_t)cutoff][0].amount, -0.5, 1e-6);
    }
    EXPECT(program->feedback().size() == 1);

    // Several Cell Ins and Cell Outs per cell: all kept, and cables resolve through whichever one they use.
    {
        juce::Array<juce::var> ns{node("u", "utility"), node("c", "cell"), node("f", "filter", "c"),
                                  node("g", "utility"),
                                  obj({{"id", "ci"}, {"type", kCellIn}, {"parent", "c"}}),
                                  obj({{"id", "ci2"}, {"type", kCellIn}, {"parent", "c"}}),
                                  obj({{"id", "co"}, {"type", kCellOut}, {"parent", "c"}}),
                                  obj({{"id", "co2"}, {"type", kCellOut}, {"parent", "c"}})};
        ns.getReference(1).getDynamicObject()->setProperty(
            "inputs", juce::Array<juce::var>{obj({{"id", "in1"}, {"name", "Mod"}, {"type", "control"}})});
        ns.getReference(1).getDynamicObject()->setProperty(
            "outputs", juce::Array<juce::var>{obj({{"id", "o1"}, {"name", "Out"}, {"type", "audio"}})});
        auto d2 = board::sanitise(doc(ns, {cable("u", "out", "c", "in1"), cable("ci2", "in1", "f", "cutoff"),
                                           cable("f", "l", "co2", "o1"), cable("c", "o1", "g", "x")}));
        const auto m2 = board::parse(d2);
        int ins = 0, outs = 0;
        for (const auto& n : m2.nodes) {
            ins += n.type == kCellIn && n.parent == "c";
            outs += n.type == kCellOut && n.parent == "c";
        }
        EXPECT(ins == 2 && outs == 2);
        EXPECT(m2.cables.size() == 4);
        std::map<std::string, std::shared_ptr<Module>> modules2;
        auto p2 = Program::compile(m2, modules2, {}, kRate);
        EXPECT(p2->steps().size() == 3);  // u, f, g
        for (const auto& st : p2->steps())
            if (st.nodeId == "g") {
                const int x = st.module->spec().inputIndex("x");
                EXPECT(x >= 0 && st.inputSources[(size_t)x].size() == 1);
            }
    }

    // Running it: the modulated cutoff goes down by half the range.
    Transport t;
    t.sampleRate = kRate;
    program->run(t, 256, false);
    auto& fm = *modules["f"];
    const float knob = fm.knob(0), eff = fm.paramDisplay(0).value.load();
    EXPECT(fm.paramDisplay(0).active.load());
    EXPECT_NEAR(eff, std::max(0.0f, knob - 0.5f), 1e-4);
}


void persistenceAndDuplicates() {
    g_test = "persistence";
    std::string saved, inId;
    {
        auto* e = new Engine();
        const int main = e->registerInstance(PortKind::Patch);
        const int ain = e->registerInstance(PortKind::AudioIn);
        e->reconcileNow();
        auto edited = copyOf(e->board());
        board::addNode(edited, *Registry::get().find("function"), 300, 100);
        e->commit(edited, "add");
        char id[40];
        e->instanceId(ain, id, sizeof id);
        inId = id;
        const size_t len = e->saveBoard(main, nullptr, 0);
        saved.resize(len);
        e->saveBoard(main, saved.data(), len);
        e->unregisterInstance(ain);
        e->unregisterInstance(main);
        e->release();
    }
    auto* e = new Engine();
    const int main = e->registerInstance(PortKind::Patch);
    const int ain = e->registerInstance(PortKind::AudioIn);
    const int dup = e->registerInstance(PortKind::AudioIn);
    e->loadBoard(main, saved.data(), saved.size());
    e->restoreInstanceId(ain, inId.c_str());
    e->restoreInstanceId(dup, inId.c_str());  // a duplicated device: keeps a fresh ID
    char a[40], b[40];
    e->instanceId(ain, a, sizeof a);
    e->instanceId(dup, b, sizeof b);
    EXPECT(std::string(a) == inId);
    EXPECT(std::string(b) != inId);
    e->reconcileNow();
    int functions = 0, audioIns = 0;
    for (const auto& n : *e->board()["nodes"].getArray()) {
        functions += n["type"].toString() == "function";
        audioIns += n["type"].toString() == "audio-in";
    }
    EXPECT(functions == 1);
    EXPECT(audioIns == 2);  // the original, plus a new node for the duplicate

    // A second Bleep Board is inactive and keeps its own copy.
    const int second = e->registerInstance(PortKind::Patch);
    EXPECT(e->state(second) == PortState::InactiveMain);
    EXPECT(e->state(main) == PortState::Ok);
    // Deleting the main removes the board; the other Bleep Board takes over.
    e->unregisterInstance(main);
    EXPECT(e->state(second) == PortState::Ok);
    for (int h : {ain, dup, second}) e->unregisterInstance(h);
    EXPECT(e->state(ain) == PortState::NoBoard);
    e->release();
}

void undoRedo() {
    g_test = "undo";
    auto* e = new Engine();
    const int main = e->registerInstance(PortKind::Patch);
    e->reconcileNow();
    const int before = e->board()["nodes"].getArray()->size();
    auto edited = copyOf(e->board());
    board::addNode(edited, *Registry::get().find("random"), 100, 100);
    e->commit(edited, "add");
    EXPECT(e->board()["nodes"].getArray()->size() == before + 1);
    EXPECT(e->undo());
    EXPECT(e->board()["nodes"].getArray()->size() == before);
    EXPECT(e->redo());
    EXPECT(e->board()["nodes"].getArray()->size() == before + 1);
    // Ports can't be deleted from the board.
    auto noPorts = copyOf(e->board());
    auto* nodes = noPorts["nodes"].getArray();
    for (int i = nodes->size(); --i >= 0;)
        if ((*nodes)[i]["port"].toString().isNotEmpty()) nodes->remove(i);
    e->commit(noPorts, "delete");
    EXPECT(portNode(*e, main).isNotEmpty());
    e->unregisterInstance(main);
    e->release();
}

/// The standalone app drives every port from one thread: no latency inside

/// Front panels are kept with the board (doc/specs/panels.md): objects with an id survive, the rest is dropped.
void panelsAreKept() {
    g_test = "panels";
    auto d = board::sanitise(doc({node("u", "utility")}, {}));
    juce::Array<juce::var> panels;
    panels.add(obj({{"id", "p1"}, {"name", "Mixer"}, {"open", "window"}}));
    panels.add(obj({{"name", "no id"}}));
    panels.add(juce::var("not an object"));
    d.getDynamicObject()->setProperty("panels", panels);
    auto kept = board::sanitise(d);
    auto* list = kept["panels"].getArray();
    EXPECT(list != nullptr && list->size() == 1);
    if (list && list->size() == 1) EXPECT((*list)[0]["open"].toString() == "window");
    // And through JSON, as saved.
    auto again = board::fromJson(board::toJson(kept));
    EXPECT(board::sanitise(again)["panels"].getArray() != nullptr);
    EXPECT(board::sanitise(doc({node("u", "utility")}, {})).hasProperty("panels") == false);
}

/// Panel controls wired to a cell jack or notes become hidden source nodes cabled into the cell.
void panelSources() {
    g_test = "panel sources";
    auto d = board::sanitise(doc({node("vc", "voice-cell"), node("f", "filter")}, {}));
    juce::Array<juce::var> controls;
    controls.add(obj({{"id", "c1"}, {"type", "keys"}, {"wire", juce::Array<juce::var>{obj({{"notes", "cell"}})}}}));
    controls.add(obj({{"id", "c2"}, {"type", "dial"}, {"value", 0.5},
                      {"wire", juce::Array<juce::var>{obj({{"cell", "nope"}})}}}));  // no such jack: nothing added
    juce::Array<juce::var> panels;
    panels.add(obj({{"id", "p1"}, {"cell", "vc"}, {"controls", controls}}));
    d.getDynamicObject()->setProperty("panels", panels);
    auto model = board::parse(d);
    const size_t nodes = model.nodes.size();
    board::addPanelSources(model, board::sanitise(d));
    EXPECT(model.nodes.size() == nodes + 1);
    EXPECT(model.node("~p1:c1:0") != nullptr && model.node("~p1:c1:0")->type == "keyboard");
    bool cabled = false;
    for (const auto& c : model.cables) cabled |= c.from.node == "~p1:c1:0" && c.to.node == "vc" && c.to.jack == "notes";
    EXPECT(cabled);

    // A dial on a plain cell's control jack: a Dial at (signal + 1) / 2, cabled into the jack.
    auto cell = obj({{"id", "pc"}, {"type", "cell"}, {"parent", ""},
                     {"inputs", juce::Array<juce::var>{obj({{"id", "cut"}, {"name", "Cutoff"}, {"type", "control"}})}}});
    auto d2 = board::sanitise(doc({cell}, {}));
    juce::Array<juce::var> c2;
    c2.add(obj({{"id", "c1"}, {"type", "dial"}, {"value", 1.0},
                {"wire", juce::Array<juce::var>{obj({{"cell", "cut"}, {"range", juce::Array<juce::var>{juce::var(-1.0), juce::var(1.0)}}})}}}));
    juce::Array<juce::var> p2;
    p2.add(obj({{"id", "q"}, {"cell", "pc"}, {"controls", c2}}));
    d2.getDynamicObject()->setProperty("panels", p2);
    auto m2 = board::parse(d2);
    board::addPanelSources(m2, board::sanitise(d2));
    const auto* dial = m2.node("~q:c1:0");
    EXPECT(dial != nullptr && dial->type == "dial");
    if (dial) EXPECT_NEAR(dial->params.at("value"), 1.0, 1e-6);

    // Board panel: a modulation wire into a module's knob and a wire into a module's jack, on an XY pad.
    auto d3 = board::sanitise(doc({node("flt", "filter"), node("vca", "vca")}, {}));
    juce::Array<juce::var> c3;
    c3.add(obj({{"id", "xy"}, {"type", "xy"}, {"value", juce::Array<juce::var>{juce::var(0.25), juce::var(1.0)}},
                {"wire", juce::Array<juce::var>{
                    obj({{"param", "flt.cutoff"}, {"mode", "mod"}, {"axis", "x"}, {"amount", 0.5}}),
                    obj({{"jack", "vca.gain"}, {"axis", "y"}})}}}));
    juce::Array<juce::var> p3;
    p3.add(obj({{"id", "b"}, {"controls", c3}}));  // no cell: a board panel
    d3.getDynamicObject()->setProperty("panels", p3);
    auto m3 = board::parse(d3);
    board::addPanelSources(m3, board::sanitise(d3));
    const auto* mx = m3.node("~b:xy:0");
    const auto* my = m3.node("~b:xy:1");
    EXPECT(mx != nullptr && my != nullptr);
    if (mx) EXPECT_NEAR(mx->params.at("value"), (0.25 + 1.0) * 0.5, 1e-6);
    if (my) EXPECT_NEAR(my->params.at("value"), 1.0, 1e-6);
    bool modCable = false;
    for (const auto& c : m3.cables) modCable |= c.from.node == "~b:xy:0" && c.to.node == "flt" && c.to.jack == "cutoff" && std::abs(c.amount - 0.5f) < 1e-6f;
    EXPECT(modCable);
}

/// A one-pole with a poisoned state: the engine must silence it, reset it and tell the message thread.
class PoisonModule final : public Module {
public:
    using Module::Module;
    void reset() override {
        acc_ = 0.0f;
        ++resets;
    }
    void process(const ProcessContext& c) override {
        for (int s = 0; s < c.numSamples; ++s, ++t_) {
            acc_ = 0.5f * acc_ + c.inputs[0][s];
            if (t_ == 300 || t_ == 301) acc_ = std::numeric_limits<float>::quiet_NaN();
            if (t_ == 2000) acc_ = std::numeric_limits<float>::infinity();
            c.outputs[0][s] = acc_;
        }
    }
    int resets = 0;

private:
    float acc_ = 0.0f;
    int t_ = 0;
};

void registerPoison(Registry& r) {
    ModuleSpec s;
    s.type = "poison-test";
    s.name = "Poison Test";
    s.category = "Test";
    s.inputs = {{"x", "X", Signal::Audio, true}};
    s.outputs = {{"y", "Y", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<PoisonModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerPoison);

void runawayIsSilencedAndReset() {
    g_test = "runaway";
    // utility (constant 1) -> poison -> utility.
    auto utility = node("u", "utility");
    utility.getDynamicObject()->setProperty("params", obj({{"offset", 1.0}}));
    auto d = board::sanitise(doc({utility, node("p", "poison-test"), node("o", "utility")},
                                 {cable("u", "out", "p", "x"), cable("p", "y", "o", "x")}));
    std::map<std::string, std::shared_ptr<Module>> modules;
    auto program = Program::compile(board::parse(d), modules, {}, kRate);
    const Program::Step* out = nullptr;
    for (const auto& st : program->steps())
        if (st.nodeId == "o") out = &st;
    EXPECT(out != nullptr);
    Transport t;
    t.sampleRate = kRate;
    bool finite = true;
    for (int block = 0; block < 160 && out; ++block) {  // a chunk at a time: the buffers hold only the last one
        program->run(t, kChunk, false);
        const float* b = out->outputBuffers[0].get();
        for (int s = 0; s < kChunk; ++s) finite = finite && std::fabs(b[s]) < 1.0e6f;
    }
    EXPECT(finite);  // the loop did not keep the NaN
    auto* poison = dynamic_cast<PoisonModule*>(modules["p"].get());
    EXPECT(poison != nullptr);
    if (poison) {
        EXPECT(poison->resets >= 2);                  // the NaN at 300 and the inf at 2000
        EXPECT(poison->takeRunaways() >= 2);
        EXPECT(poison->takeRunaways() == 0);          // the count clears when read
    }
}

/// A sine with a burst of NaN and inf in it.
class BurstSource final : public Module {
public:
    using Module::Module;
    void process(const ProcessContext& c) override {
        for (int s = 0; s < c.numSamples; ++s, ++t_) {
            float v = 0.3f * (float)std::sin(0.05 * t_);
            if (t_ >= 4000 && t_ < 4100) v = std::numeric_limits<float>::quiet_NaN();
            if (t_ >= 4100 && t_ < 4200) v = std::numeric_limits<float>::infinity();
            c.outputs[0][s] = v;
        }
    }

private:
    int t_ = 0;
};

void registerBurst(Registry& r) {
    ModuleSpec s;
    s.type = "burst-source-test";
    s.name = "Burst Source Test";
    s.category = "Test";
    s.outputs = {{"audio", "Audio", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<BurstSource>(spec); });
}
BLEEP_REGISTER_MODULE(registerBurst);

/// The modules that keep a filter, an envelope or a delay line on the audio: a NaN burst in must not leave them dead.
void audioModulesRecoverFromNaN() {
    g_test = "nan-recovery";
    for (const char* type : {"filter", "dual-filter", "filter-bank", "eq", "phaser", "freq-shifter", "spectral-blend",
                             "delay", "delay-network", "zone-delay", "reverb", "room-print", "chorus", "pitch-shifter", "grains",
                             "limiter", "compressor", "envelope-follower", "saturator"}) {
        const auto* spec = Registry::get().find(type);
        if (spec == nullptr) {
            std::printf("  nan-recovery: unknown module type %s\n", type);
            ++g_failures;
            continue;
        }
        std::string in, out;
        for (const auto& j : spec->inputs)
            if (in.empty() && j.type == Signal::Audio) in = j.id;
        for (const auto& j : spec->outputs)
            if (out.empty() && (j.type == Signal::Audio || std::string(type) == "envelope-follower")) out = j.id;  // its env is a control
        if (in.empty() || out.empty()) {
            std::printf("  nan-recovery: %s has no audio jack\n", type);
            ++g_failures;
            continue;
        }
        auto d = board::sanitise(doc({node("s", "burst-source-test"), node("m", type)}, {cable("s", "audio", "m", in.c_str())}));
        std::map<std::string, std::shared_ptr<Module>> modules;
        auto program = Program::compile(board::parse(d), modules, {}, kRate);
        const Program::Step* st = nullptr;
        for (const auto& step : program->steps())
            if (step.nodeId == "m") st = &step;
        EXPECT(st != nullptr);
        if (!st) continue;
        const int jack = spec->outputIndex(out);
        Transport t;
        t.sampleRate = kRate;
        bool finite = true;
        float peak = 0.0f;
        for (int block = 0; block < 1600; ++block) {  // 1.07 s: the burst is at 4000 samples
            program->run(t, kChunk, false);
            const float* b = st->outputBuffers[(size_t)jack].get();
            for (int i = 0; i < kChunk; ++i) {
                finite = finite && std::isfinite(b[i]);
                if (block > 1200) peak = std::max(peak, std::fabs(b[i]));  // well after the burst and any tail
            }
        }
        if (!finite || peak <= 1.0e-4f)
            std::printf("  nan-recovery: %s finite=%d late peak=%g runaways=%u\n", type, (int)finite, (double)peak,
                        modules["m"]->takeRunaways());
        EXPECT(finite);
        EXPECT(peak > 1.0e-4f);  // alive again: the sine gets through
    }
}

}  // namespace

void runDocumentTests() {
    specMapping();
    sanitising();
    panelsAreKept();
    panelSources();
    compileCellsAndFeedback();
    runawayIsSilencedAndReset();
    audioModulesRecoverFromNaN();
    persistenceAndDuplicates();
    undoRedo();
}
