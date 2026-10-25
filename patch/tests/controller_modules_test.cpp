// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Node-level tests for the controller modules (doc/specs/modules/dial.md,
// button.md, keyboard.md): their specs, performance gestures from the view
// (Module::perform) and the node data, run through the Module API.
#include "Board.h"
#include "Program.h"
#include "Engine.h"
#include "Registry.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <set>
#include <string>
#include <vector>

namespace bleep::engine {
std::unique_ptr<BoardUi> createBoardUi(Engine&) { return nullptr; }  // no window in tests
}  // namespace bleep::engine

using namespace bleep::engine;

static int g_failures = 0;
static const char* g_test = "";
#define EXPECT(cond)                                                                       \
    do {                                                                                   \
        if (!(cond)) {                                                                     \
            std::printf("  %s: %s:%d: EXPECT(%s)\n", g_test, __FILE__, __LINE__, #cond); \
            ++g_failures;                                                                  \
        }                                                                                  \
    } while (0)
#define EXPECT_NEAR(a, b, tol) EXPECT(std::fabs((double)(a) - (double)(b)) <= (tol))

namespace {

constexpr double kRate = 48000.0;

/// One module with buffers for every param and output, and note outputs.
struct Rig {
    std::unique_ptr<Module> m;
    std::vector<std::vector<float>> params, outputs;
    std::vector<const float*> pp;
    std::vector<float*> op;
    std::vector<NoteBuffer> notes;
    std::vector<NoteBuffer*> np;
    Transport transport;

    explicit Rig(const std::string& type) : m(Registry::get().create(type)) {
        const auto& s = m->spec();
        params.assign(s.params.size(), std::vector<float>(kChunk));
        outputs.assign(s.outputs.size(), std::vector<float>(kChunk, 0.0f));
        notes.resize(s.outputs.size());
        for (size_t i = 0; i < s.params.size(); ++i) set(s.params[i].id, s.params[i].def);
        for (auto& v : params) pp.push_back(v.data());
        for (auto& v : outputs) op.push_back(v.data());
        for (auto& b : notes) np.push_back(&b);
        transport.sampleRate = kRate;
        m->prepare(kRate);
        if (s.sanitiseData) m->setData(s.sanitiseData(""));
        m->reset();
    }
    void set(const std::string& id, float value) {
        const int i = m->spec().paramIndex(id);
        const float n = m->spec().params[(size_t)i].toNormalised(value);
        m->setKnob(i, n);
        std::fill(params[(size_t)i].begin(), params[(size_t)i].end(), n);
    }
    void perform(const std::string& action, std::vector<double> args = {}) { m->perform(action, args); }
    void run(int chunks = 1) {
        ProcessContext c;
        c.numSamples = kChunk;
        c.transport = &transport;
        c.params = pp.data();
        c.outputs = op.data();
        c.notesOut = np.data();
        for (int k = 0; k < chunks; ++k) m->process(c);
    }
    const std::vector<float>& buffer(const std::string& id) const {
        return outputs[(size_t)m->spec().outputIndex(id)];
    }
    float out(const std::string& id, int sample = kChunk - 1) const { return buffer(id)[(size_t)sample]; }
    const NoteBuffer& notesOut(const std::string& id) const { return notes[(size_t)m->spec().outputIndex(id)]; }
};

int count(const std::vector<float>& b) {
    int n = 0;
    for (float v : b) n += v >= 0.5f;
    return n;
}

void specs() {
    for (const char* t : {"dial", "button", "keyboard", "wheel", "xy-pad"}) {
        g_test = t;
        const ModuleSpec* s = Registry::get().find(t);
        EXPECT(s != nullptr);
        if (!s) continue;
        EXPECT(s->category.rfind("Controllers/", 0) == 0);
        std::set<std::string> ids;
        for (const auto& p : s->params) EXPECT(ids.insert(p.id).second);
        for (const auto& j : s->inputs) EXPECT(ids.insert(j.id).second);
        std::set<std::string> outs;
        for (const auto& j : s->outputs) EXPECT(outs.insert(j.id).second);
    }
}

void dial() {
    g_test = "dial";
    Rig r("dial");
    r.set("smooth", 0.0f);
    r.set("value", 0.25f);
    r.run();
    EXPECT_NEAR(r.out("out"), 0.25, 1e-5);
    r.set("min", -1.0f);
    r.set("max", 1.0f);
    r.run();
    EXPECT_NEAR(r.out("out"), -0.5, 1e-5);
    r.set("max", -1.0f);  // reversed range
    r.set("min", 1.0f);
    r.run();
    EXPECT_NEAR(r.out("out"), 0.5, 1e-5);
    // Steps: 5 detents over 0..1 → 0, .25, .5, .75, 1.
    r.set("min", 0.0f);
    r.set("max", 1.0f);
    r.set("steps", 5.0f);
    r.set("value", 0.6f);
    r.run();
    EXPECT_NEAR(r.out("out"), 0.5, 1e-5);
    // Smooth: no jump from the start value, a glide after a change.
    Rig s("dial");
    s.set("value", 1.0f);
    s.run();
    EXPECT_NEAR(s.out("out", 0), 1.0, 1e-5);
    s.set("smooth", 0.1f);
    s.set("value", 0.0f);
    s.run();
    EXPECT(s.out("out") > 0.9f && s.out("out") < 1.0f);
    s.run(1500);  // 1 s
    EXPECT_NEAR(s.out("out"), 0.0, 1e-3);
}

void wheel() {
    g_test = "wheel";
    Rig r("wheel");
    r.set("smooth", 0.0f);
    r.run();  // centred by default: a bipolar wheel at rest outputs 0
    EXPECT_NEAR(r.out("out"), 0.0, 1e-5);
    r.set("value", 1.0f);
    r.run();
    EXPECT_NEAR(r.out("out"), 1.0, 1e-5);
    r.set("value", 0.0f);
    r.run();
    EXPECT_NEAR(r.out("out"), -1.0, 1e-5);
    r.set("min", 0.0f);  // a mod wheel: 0..1
    r.set("value", 0.25f);
    r.run();
    EXPECT_NEAR(r.out("out"), 0.25, 1e-5);
    r.set("max", 0.0f);  // reversed
    r.set("min", 1.0f);
    r.run();
    EXPECT_NEAR(r.out("out"), 0.75, 1e-5);
    Rig s("wheel");  // smoothing: no glide at the start, a glide after a change
    s.set("value", 1.0f);
    s.run();
    EXPECT_NEAR(s.out("out", 0), 1.0, 1e-5);
    s.set("smooth", 0.1f);
    s.set("value", 0.5f);
    s.run();
    EXPECT(s.out("out") > 0.0f && s.out("out") < 1.0f);
    s.run(1500);
    EXPECT_NEAR(s.out("out"), 0.0, 1e-3);
}

void xyPad() {
    g_test = "xy-pad";
    Rig r("xy-pad");
    r.set("smooth", 0.0f);
    r.set("x", 0.25f);
    r.set("y", 0.75f);
    r.run();
    EXPECT_NEAR(r.out("x"), 0.25, 1e-5);
    EXPECT_NEAR(r.out("y"), 0.75, 1e-5);
    r.set("min", -1.0f);  // both axes share the range
    r.run();
    EXPECT_NEAR(r.out("x"), -0.5, 1e-5);
    EXPECT_NEAR(r.out("y"), 0.5, 1e-5);
    Rig s("xy-pad");
    s.set("x", 1.0f);
    s.run();
    EXPECT_NEAR(s.out("x", 0), 1.0, 1e-5);  // no glide at the start
    s.set("smooth", 0.1f);
    s.set("x", 0.0f);
    s.run();
    EXPECT(s.out("x") > 0.9f && s.out("x") < 1.0f);
    s.run(1500);
    EXPECT_NEAR(s.out("x"), 0.0, 1e-3);
}


// Patch bays (doc/specs/modules/patchbay.md): the compiler runs plain cables.
void patchbays() {
    g_test = "patchbays";
    auto node = [](const std::string& id, const char* type, const std::string& parent = "") {
        NodeModel n;
        n.id = id;
        n.type = type;
        n.parent = parent;
        n.spec = Registry::get().find(type);
        return n;
    };
    auto cable = [](const std::string& id, const char* fn, const char* fj, const char* tn, const char* tj, float amount = 1.0f) {
        CableModel c;
        c.id = id;
        c.from = {fn, fj};
        c.to = {tn, tj};
        c.amount = amount;
        return c;
    };
    {  // dial → bay in c1 → bundle → bay out c1 → filter cutoff
        BoardModel m;
        m.nodes = {node("d", "dial"), node("a", kPatchbayIn), node("b", kPatchbayOut), node("f", "filter")};
        m.cables = {cable("k1", "d", "out", "a", "c1", 0.5f), cable("k2", "a", "bundle", "b", "bundle"),
                    cable("k3", "b", "c1", "f", "cutoff", 0.5f)};
        EXPECT(hasPatchbays(m));
        const BoardModel flat = flattenPatchbays(m);
        EXPECT(flat.nodes.size() == 2 && flat.cables.size() == 1);
        if (flat.cables.size() == 1) {
            EXPECT(flat.cables[0].from.node == "d" && flat.cables[0].from.jack == "out");
            EXPECT(flat.cables[0].to.node == "f" && flat.cables[0].to.jack == "cutoff");
            EXPECT_NEAR(flat.cables[0].amount, 0.25, 1e-6);
        }
    }
    {  // two channels, the bundle goes through a cell: in a "panel" cell, out of its Cell Out, into a bay out beside the filter
        BoardModel m;
        NodeModel panel = node("p", kCell);
        panel.cellOutputs = {{"saw", "Saw", Signal::Patchbay}};
        m.nodes = {node("d1", "dial", "p"), node("d2", "dial", "p"), node("a", kPatchbayIn, "p"), node("co", kCellOut, "p"),
                   panel, node("b", kPatchbayOut), node("f", "filter")};
        m.cables = {cable("k1", "d1", "out", "a", "c1"), cable("k2", "d2", "out", "a", "c2"), cable("k3", "a", "bundle", "co", "saw"),
                    cable("k4", "p", "saw", "b", "bundle"), cable("k5", "b", "c1", "f", "cutoff"), cable("k6", "b", "c2", "f", "resonance")};
        const BoardModel flat = flattenPatchbays(m);
        EXPECT(flat.cables.size() == 2);
        for (const auto& c : flat.cables) {
            EXPECT(c.to.node == "f");
            EXPECT((c.to.jack == "cutoff" && c.from.node == "d1") || (c.to.jack == "resonance" && c.from.node == "d2"));
        }
        // bundles are a cable type of their own
        EXPECT(!compatible(Signal::Patchbay, Signal::Control) && compatible(Signal::Patchbay, Signal::Patchbay));
    }
    {  // sanitise keeps the cables of a real board document: channels, a bundle through a cell's Cell Out, a bundle in
        const char* json = R"({"format":1,"id":"t","nodes":[
          {"id":"p","type":"cell","name":"Panel","x":0,"y":0,"parent":"","params":{},"inputs":[],"outputs":[{"id":"saw","name":"Saw","type":"patchbay"}]},
          {"id":"pci","type":"cell-in","name":"Cell In","x":0,"y":0,"parent":"p","params":{}},
          {"id":"pco","type":"cell-out","name":"Cell Out","x":0,"y":0,"parent":"p","params":{}},
          {"id":"d","type":"dial","name":"Dial","x":0,"y":0,"parent":"p","params":{}},
          {"id":"a","type":"patchbay-in","name":"Saw bay","x":0,"y":0,"parent":"p","params":{}},
          {"id":"b","type":"patchbay-out","name":"Saw bay","x":0,"y":0,"parent":"","params":{}},
          {"id":"f","type":"filter","name":"Filter","x":0,"y":0,"parent":"","params":{}}],
          "cables":[
          {"id":"k1","from":{"node":"d","jack":"out"},"to":{"node":"a","jack":"c1"},"amount":1},
          {"id":"k2","from":{"node":"a","jack":"bundle"},"to":{"node":"pco","jack":"saw"},"amount":1},
          {"id":"k3","from":{"node":"p","jack":"saw"},"to":{"node":"b","jack":"bundle"},"amount":1},
          {"id":"k4","from":{"node":"b","jack":"c1"},"to":{"node":"f","jack":"cutoff"},"amount":1},
          {"id":"k5","from":{"node":"d","jack":"out"},"to":{"node":"b","jack":"bundle"},"amount":1},
          {"id":"k6","from":{"node":"b","jack":"c1"},"to":{"node":"f","jack":"in"},"amount":1}]})";
        juce::StringArray warnings;
        const auto clean = board::sanitise(board::fromJson(json), &warnings);
        // k5 (a control into a bundle input) and k6 (not a jack of the filter) are dropped; the rest stays
        EXPECT(clean["cables"].size() == 4);
        const BoardModel model = board::parse(clean);
        const BoardModel flat = flattenPatchbays(model);
        bool direct = false;
        for (const auto& c : flat.cables) direct |= c.from.node == "d" && c.to.node == "f" && c.to.jack == "cutoff";
        EXPECT(direct);
        EXPECT(flat.nodes.size() == model.nodes.size() - 2);
    }
    {  // into a Voice Cell: the bundle enters its shared input; the channel becomes a shared input of its own
        BoardModel m;
        NodeModel voiceCell = node("v", kVoiceCell);
        voiceCell.cellInputs = {{"saw", "Saw", Signal::Patchbay}};
        m.nodes = {node("d", "dial"), node("a", kPatchbayIn), voiceCell, node("vci", kCellIn, "v"), node("b", kPatchbayOut, "v"),
                   node("o", "oscillator", "v")};
        m.cables = {cable("k1", "d", "out", "a", "c1", 0.5f), cable("k2", "a", "bundle", "v", "saw"),
                    cable("k3", "vci", "saw", "b", "bundle"), cable("k4", "b", "c1", "o", "fine", 0.5f)};
        const BoardModel flat = flattenPatchbays(m);
        const NodeModel* v = flat.node("v");
        EXPECT(v && v->cellInputs.size() == 1 && v->cellInputs[0].type == Signal::Control);
        EXPECT(flat.cables.size() == 2);
        if (v && v->cellInputs.size() == 1 && flat.cables.size() == 2) {
            const std::string jack = v->cellInputs[0].id;
            for (const auto& c : flat.cables) {
                if (c.to.node == "v") EXPECT(c.from.node == "d" && c.to.jack == jack && std::fabs(c.amount - 0.5f) < 1e-6);
                else EXPECT(c.from.node == "vci" && c.from.jack == jack && c.to.node == "o" && c.to.jack == "fine" && std::fabs(c.amount - 0.5f) < 1e-6);
            }
        }
    }
    if (const char* path = std::getenv("BLEEP_SANITISE_DOC")) {  // a debugging aid: what sanitise keeps of a board file
        juce::StringArray warnings;
        const auto doc = board::fromJson(juce::File(path).loadFileAsString());
        const auto clean = board::sanitise(doc, &warnings);
        std::printf("sanitise: nodes %d -> %d, cables %d -> %d, panels %d -> %d\n", doc["nodes"].size(), clean["nodes"].size(),
                    doc["cables"].size(), clean["cables"].size(), doc["panels"].size(), clean["panels"].size());
        for (const auto& w : warnings) std::printf("  warning: %s\n", w.toRawUTF8());
        // What the compiler runs: no bays, one plain cable per channel, and a Voice Cell's shared inputs for what enters it.
        const BoardModel flat = flattenPatchbays(board::parse(clean));
        int bays = 0, voiceInputs = 0;
        for (const auto& n : flat.nodes) {
            bays += n.type == kPatchbayIn || n.type == kPatchbayOut;
            if (n.type == kVoiceCell) voiceInputs += (int)n.cellInputs.size();
        }
        std::printf("flattened: nodes %zu, cables %zu, bays left %d, voice cell inputs %d\n", flat.nodes.size(), flat.cables.size(), bays, voiceInputs);
        for (const auto& n : flat.nodes)
            if (n.type == "filter" || n.type == "reverb") {
                std::printf("  into %s (%s):", n.id.c_str(), n.type.c_str());
                for (const auto& c : flat.cables) if (c.to.node == n.id || (n.parent != "" && c.to.jack.rfind("bay~", 0) == 0 && false)) std::printf(" %s.%s->%s", c.from.node.c_str(), c.from.jack.c_str(), c.to.jack.c_str());
                std::printf("\n");
            }
        // The same through a real engine, as the app does it: commit the edit into the board, which compiles it.
        auto* e = new Engine();
        e->registerInstance(PortKind::Patch);
        e->reconcileNow();
        juce::var edited = board::fromJson(board::toJson(e->board()));
        const int before = edited["nodes"].size();
        for (const auto& n : *doc["nodes"].getArray()) edited["nodes"].getArray()->add(n);
        for (const auto& c : *doc["cables"].getArray()) edited["cables"].getArray()->add(c);
        if (!edited["panels"].isArray()) edited.getDynamicObject()->setProperty("panels", juce::Array<juce::var>());
        for (const auto& q : *doc["panels"].getArray()) edited["panels"].getArray()->add(q);
        const auto result = e->commit(edited, "add");
        std::printf("engine commit: nodes %d -> %d (added %d)\n", before, result["nodes"].size(), doc["nodes"].size());
        e->release();
    }
    {  // a cable into a setting (ParamSpec::cableable): a Dial picks the filter's Type, and it is back on the knob without the cable
        const ModuleSpec* filter = Registry::get().find("filter");
        const int typeIndex = filter ? filter->paramIndex("type") : -1;
        EXPECT(typeIndex >= 0 && filter->params[(size_t)typeIndex].cableable && filter->params[(size_t)typeIndex].drivable());
        auto build = [&](bool cabled) {
            BoardModel m;
            NodeModel d = node("d", "dial"), f = node("f", "filter");
            for (const auto& p : d.spec->params) d.params[p.id] = p.defaultNormalised();
            d.params["value"] = 0.5f;   // halfway through the list of types
            d.params["smooth"] = 0.0f;
            for (const auto& p : f.spec->params) f.params[p.id] = p.defaultNormalised();
            f.params["type"] = 0.0f;
            m.nodes = {d, f};
            if (cabled) m.cables = {cable("k1", "d", "out", "f", "type")};
            return m;
        };
        for (bool cabled : {true, false}) {
            std::map<std::string, std::shared_ptr<Module>> modules;
            auto program = Program::compile(build(cabled), modules, {}, 48000.0);
            Transport tr;
            tr.sampleRate = 48000.0;
            program->run(tr, kChunk, true);
            program->run(tr, kChunk, false);
            const float want = cabled ? std::round(filter->params[(size_t)typeIndex].fromNormalised(0.5f)) : 0.0f;
            EXPECT(modules.count("f") && typeIndex >= 0 && std::fabs(modules["f"]->setting(typeIndex) - want) < 0.5f);
        }
    }
    {  // phase 2 of doc/specs/modules/index.md: every choice, toggle and integer takes a cable as its value (absolute)
        auto driven = [&](const std::string& type, const std::string& id, float knob, float level, int& index, bool cabled = true) {
            BoardModel m;
            NodeModel d = node("d", "dial"), t = node("t", type.c_str());
            for (const auto& p : d.spec->params) d.params[p.id] = p.defaultNormalised();
            d.params["value"] = level;
            d.params["smooth"] = 0.0f;
            for (const auto& p : t.spec->params) t.params[p.id] = p.defaultNormalised();
            index = t.spec->paramIndex(id);
            t.params[id] = knob;
            m.nodes = {d, t};
            if (cabled) m.cables = {cable("k1", "d", "out", "t", id.c_str())};
            std::map<std::string, std::shared_ptr<Module>> modules;
            auto program = Program::compile(m, modules, {}, 48000.0);
            Transport tr;
            tr.sampleRate = 48000.0;
            program->run(tr, kChunk, true);
            program->run(tr, kChunk, false);
            return modules.count("t") ? modules["t"]->setting(index) : -1.0f;
        };
        int index = -1;
        // The knob does not matter while the cable is there: the knob is on the last item, the cable asks for the first.
        EXPECT(std::fabs(driven("filter", "type", 1.0f, 0.0f, index)) < 0.5f);
        // A Dial's value i / (n - 1) lands on item i, for every choice, toggle and integer of every module that accepts a cable.
        int checked = 0, wrong = 0;
        for (const ModuleSpec* spec : Registry::get().all()) {
            if (!spec->userCreatable) continue;
            for (const auto& p : spec->params) {
                if (!p.cableable || p.kind == ParamSpec::Kind::Float) continue;
                const int n = p.numSteps() > 0 ? p.numSteps() + 1 : 0;
                if (n < 2) continue;
                for (int i = 0; i < n; i += std::max(1, n - 1)) {  // first and last item: without the cable the knob is back
                    const float knob = (float)i / (float)(n - 1);
                    const float back = driven(spec->type, p.id, knob, 0.5f, index, false);
                    ++checked;
                    if (std::fabs(back - p.fromNormalised(knob)) > 0.01f && ++wrong <= 5)
                        std::printf("  %s.%s without a cable, item %d: got %g\n", spec->type.c_str(), p.id.c_str(), i, back);
                }
                for (int i = 0; i < n; ++i) {
                    const float got = driven(spec->type, p.id, 0.0f, (float)i / (float)(n - 1), index);
                    ++checked;
                    if (std::fabs(got - p.fromNormalised((float)i / (float)(n - 1))) > 0.01f) {
                        if (++wrong <= 5) std::printf("  %s.%s item %d of %d: got %g\n", spec->type.c_str(), p.id.c_str(), i, n, got);
                    }
                }
            }
        }
        std::printf("cabled discrete settings: %d checked, %d wrong\n", checked, wrong);
        EXPECT(checked > 500 && wrong == 0);
    }
    {  // bays in a row: the channel follows through both
        BoardModel m;
        m.nodes = {node("d", "dial"), node("a1", kPatchbayIn), node("b1", kPatchbayOut), node("a2", kPatchbayIn),
                   node("b2", kPatchbayOut), node("f", "filter")};
        m.cables = {cable("k1", "d", "out", "a1", "c1"), cable("k2", "a1", "bundle", "b1", "bundle"),
                    cable("k3", "b1", "c1", "a2", "c1"), cable("k4", "a2", "bundle", "b2", "bundle"),
                    cable("k5", "b2", "c1", "f", "cutoff")};
        const BoardModel flat = flattenPatchbays(m);
        EXPECT(flat.cables.size() == 1 && flat.cables[0].from.node == "d" && flat.cables[0].to.node == "f");
    }
}

void button() {
    g_test = "button";
    Rig r("button");
    r.run();
    EXPECT(count(r.buffer("gate")) == 0);
    r.perform("press");
    r.run();
    EXPECT(r.out("gate", 0) == 1.0f && r.out("gate") == 1.0f);
    EXPECT(count(r.buffer("trigger")) == 1 && r.out("trigger", 0) == 1.0f);
    EXPECT(r.out("toggle") == 1.0f);
    r.run();
    EXPECT(r.out("gate") == 1.0f && count(r.buffer("trigger")) == 0);
    r.perform("release");
    r.run();
    EXPECT(r.out("gate", 0) == 0.0f);
    EXPECT(count(r.buffer("release")) == 1);
    EXPECT(r.out("toggle") == 1.0f);  // flips on the next press
    // A tap inside one chunk still gives a gate and both triggers.
    r.perform("press");
    r.perform("release");
    r.run();
    EXPECT(count(r.buffer("gate")) == 1 && count(r.buffer("trigger")) == 1 && count(r.buffer("release")) == 1);
    EXPECT(r.out("toggle") == 0.0f);
    // Toggle mode: the gate is the toggle.
    r.set("mode", 1.0f);
    r.perform("press", {1.0});
    r.perform("release");
    r.run(2);
    EXPECT(r.out("gate") == 1.0f && r.out("toggle") == 1.0f);
    r.perform("press", {0.0});
    r.perform("release");
    r.run(2);
    EXPECT(r.out("gate") == 0.0f);
    // The saved state comes back with the node's data.
    const ModuleSpec& spec = r.m->spec();
    EXPECT(spec.sanitiseData("") == spec.sanitiseData("{\"on\": false}"));
    r.m->setData(spec.sanitiseData("{\"on\": true}"));
    r.run();
    EXPECT(r.out("gate") == 1.0f && r.out("toggle") == 1.0f);
    EXPECT(count(r.buffer("trigger")) == 0);
}

void keyboard() {
    g_test = "keyboard";
    Rig r("keyboard");
    r.perform("on", {64, 0.5});
    r.run();
    const NoteBuffer& n = r.notesOut("notes");
    EXPECT(n.count == 1);
    EXPECT(n.events[0].type == NoteEvent::On && n.events[0].note == 64);
    EXPECT_NEAR(n.events[0].pitch, 4.0 / 12.0, 1e-6);
    EXPECT_NEAR(n.events[0].value, 0.5, 1e-6);
    EXPECT_NEAR(r.out("pitch"), 4.0 / 12.0, 1e-5);
    EXPECT(r.out("gate") == 1.0f && r.out("trigger", 0) == 1.0f);
    EXPECT_NEAR(r.out("vel"), 0.5, 1e-6);
    // No velocity given: the Velocity knob.
    r.perform("on", {67});
    r.run();
    EXPECT(n.count == 1 && n.events[0].note == 67);
    EXPECT_NEAR(n.events[0].value, 0.8, 1e-6);
    EXPECT_NEAR(r.out("pitch"), 7.0 / 12.0, 1e-5);  // last note
    r.perform("off", {67});
    r.run();
    EXPECT(n.count == 1 && n.events[0].type == NoteEvent::Off && n.events[0].note == 67);
    EXPECT_NEAR(r.out("pitch"), 4.0 / 12.0, 1e-5);  // back to the held note
    r.perform("off", {67});  // already up: nothing
    r.run();
    EXPECT(n.count == 0);
    r.perform("off", {64});
    r.run();
    EXPECT(r.out("gate") == 0.0f);
    // All off: every held key ends, even more than one chunk holds.
    for (int k = 0; k < 100; ++k) r.perform("on", {(double)k});
    r.run(2);
    r.perform("allOff");
    r.perform("on", {60});
    int offs = 0, ons = 0;
    for (int k = 0; k < 4; ++k) {
        r.run();
        for (int e = 0; e < n.count; ++e) (n.events[e].type == NoteEvent::Off ? offs : ons)++;
    }
    EXPECT(offs == 100 && ons == 1);
    EXPECT(r.out("gate") == 1.0f);
    EXPECT_NEAR(r.out("pitch"), 0.0, 1e-5);
    // Out-of-range notes are ignored.
    r.perform("on", {200});
    r.perform("on", {-3});
    r.run();
    EXPECT(n.count == 0);
}

}  // namespace

/// Filter Type was stored against the 25-algorithm list (index / 24); the list now has 32 and boards
/// saved before still mean the same algorithm.
namespace {
void filterTypeMigration() {
    g_test = "filter type migration";
    const auto* spec = Registry::get().find("filter");
    EXPECT(spec != nullptr);
    if (!spec) return;
    const ParamSpec& type = spec->params[(size_t)spec->paramIndex("type")];
    auto indexOf = [&](const char* name) {
        return (int)(std::find(type.choices.begin(), type.choices.end(), name) - type.choices.begin());
    };
    auto load = [&](float stored) {
        const juce::String json = R"({"format":1,"id":"t","nodes":[{"id":"f","type":"filter","name":"F","x":0,"y":0,"parent":"","params":{"type":)" +
                                  juce::String(stored, 9) + R"(}}],"cables":[]})";
        const BoardModel m = board::parse(board::fromJson(json));
        return m.nodes.empty() ? -1.0f : m.nodes[0].params.at("type");
    };
    const int n = (int)type.choices.size();
    const auto& legacy = type.legacyChoices;
    EXPECT(n == 32 && legacy.size() == 25);
    for (size_t k = 0; k < legacy.size(); ++k)  // old: k / 24 → the same name in the new list
        EXPECT_NEAR(load((float)k / 24.0f), (float)indexOf(legacy[k].c_str()) / (float)(n - 1), 1e-5);
    for (int j = 0; j < n; ++j)  // new: j / 31 stays
        EXPECT_NEAR(load((float)j / (float)(n - 1)), (float)j / (float)(n - 1), 1e-6);
    EXPECT_NEAR(load(1.0f), 1.0f, 1e-6);  // the former Rough is still the last
}

/// A Multi Filter copied from the web board and pasted keeps its settings through sanitise.
void pastedFilterKeepsParams() {
    g_test = "pasted filter";
    const juce::String json = R"({"format":1,"id":"t","nodes":[{"id":"n1","type":"filter","name":"Multi Filter","x":3,"y":4,"parent":"","params":{"cutoff":0.46598,"resonance":0.8,"type":0.5161290322580645,"drive":0.4,"mode":0,"mix":1,"keytrack":0.5,"gain":0.5,"vowel":0,"damping":0.300000011920929,"slope":0.42857142857142855}}],"cables":[]})";
    const auto doc = board::sanitise(board::fromJson(json));
    const BoardModel m = board::parse(doc);
    EXPECT(m.nodes.size() == 1);
    if (m.nodes.empty()) return;
    EXPECT_NEAR(m.nodes[0].params.at("cutoff"), 0.46598, 1e-5);
    EXPECT_NEAR(m.nodes[0].params.at("resonance"), 0.8, 1e-5);
    EXPECT_NEAR(m.nodes[0].params.at("drive"), 0.4, 1e-5);
}
}  // namespace

int main() {
    pastedFilterKeepsParams();
    filterTypeMigration();
    specs();
    dial();
    wheel();
    xyPad();
    patchbays();
    button();
    keyboard();
    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all controller module tests passed\n");
    return 0;
}
