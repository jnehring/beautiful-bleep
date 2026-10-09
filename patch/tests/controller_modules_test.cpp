// SPDX-License-Identifier: MIT
//
// Node-level tests for the controller modules (specs/modules/dial.md,
// button.md, keyboard.md): their specs, performance gestures from the view
// (Module::perform) and the node data, run through the Module API.
#include "Engine.h"
#include "Registry.h"

#include <cmath>
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
    for (const char* t : {"dial", "button", "keyboard"}) {
        g_test = t;
        const ModuleSpec* s = Registry::get().find(t);
        EXPECT(s != nullptr);
        if (!s) continue;
        EXPECT(s->category == "Controllers");
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

int main() {
    specs();
    dial();
    button();
    keyboard();
    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all controller module tests passed\n");
    return 0;
}
