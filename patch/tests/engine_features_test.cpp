// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Tests for the engine features modules build on: normalled inputs, output
// connection flags, the harmony bus order, stepped knobs, show/names metadata
// in the type description, view commands, the media store and RtHandoff.
// juce_core only (no engine instance, no plugins).
#include "Board.h"
#include "Handoff.h"
#include "Media.h"
#include "Program.h"
#include "Registry.h"
#include "dsp/Harmony.h"

#include <chrono>
#include <cmath>
#include <string>
#include <cstdio>
#include <filesystem>

using namespace bleep::engine;

namespace {

int g_failures = 0;
const char* g_test = "";
#define EXPECT(cond)                                                                       \
    do {                                                                                   \
        if (!(cond)) {                                                                     \
            std::printf("  %s: %s:%d: EXPECT(%s)\n", g_test, __FILE__, __LINE__, #cond); \
            ++g_failures;                                                                  \
        }                                                                                  \
    } while (0)

// ---- test node types --------------------------------------------------------

/// Outputs a constant per output: 1, 2, 3 …
class ConstModule final : public Module {
public:
    using Module::Module;
    void process(const ProcessContext& c) override {
        for (size_t o = 0; o < spec().outputs.size(); ++o)
            for (int s = 0; s < c.numSamples; ++s) c.outputs[o][s] = (float)(o + 1);
    }
};

/// Records what it sees: its inputs, which outputs are read, commands, and
/// (as a harmony writer or reader) the order it ran in.
int g_runCounter = 0;
class ProbeModule final : public Module {
public:
    using Module::Module;
    void process(const ProcessContext& c) override {
        ranAt = ++g_runCounter;
        for (size_t j = 0; j < spec().inputs.size() && j < 4; ++j) {
            in[j] = c.inputs[j][c.numSamples - 1];
            connected[j] = c.inputConnected[j];
        }
        for (size_t o = 0; o < spec().outputs.size() && o < 4; ++o) {
            outConnected[o] = c.isOutputConnected((int)o);
            for (int s = 0; s < c.numSamples; ++s) c.outputs[o][s] = 0.5f;
        }
        stepped = value(c, 0, c.numSamples - 1);
        if (spec().harmony == HarmonyRole::Writer) {
            c.harmony[1].valid = true;
            c.harmony[1].key = 7;
        } else if (spec().harmony == HarmonyRole::Reader) {
            heardKey = c.harmony[1].valid ? c.harmony[1].key : -1;
        }
        pollCommands([&](const Command& cmd) {
            lastCommand = cmd.index;
            lastValue = cmd.value;
            ++commands;
        });
    }
    float in[4] = {}, stepped = 0.0f, lastValue = 0.0f;
    bool connected[4] = {}, outConnected[4] = {};
    int ranAt = 0, lastCommand = -1, commands = 0, heardKey = -2;
};

void registerTestModules(Registry& r) {
    ModuleSpec c;
    c.type = "test-const";
    c.name = "Const";
    c.outputs = {{"a", "A", Signal::Control}, {"b", "B", Signal::Control}};
    r.add(c, [](const ModuleSpec& s) { return std::make_unique<ConstModule>(s); });

    ModuleSpec p;
    p.type = "test-probe";
    p.name = "Probe";
    p.params = {ParamSpec::stepped("mode", "Mode", {"One", "Two", "Three", "Four"}, 0),
                ParamSpec::integer("count", "Count", 1, 4, 2),
                ParamSpec::percent("x", "X", 0.0f, 1.0f, 0.5f).inGroup("Group").when("count", 3, 4)};
    p.inputs = {{"a", "Trig A", Signal::Control},
                JackSpec{"b", "Trig B", Signal::Control}.normalledTo("a"),
                JackSpec{"c", "C", Signal::Control}.normalledTo("b"),
                JackSpec{"d", "D", Signal::Control}.when("count", 4, 4).namedBy("mode", {"D1", "D2", "D3", "D4"})};
    p.outputs = {{"o1", "O1", Signal::Control}, {"o2", "O2", Signal::Control}};
    p.buttons = {{"ping", "Ping", true}, {"clear", "Clear", false}};
    r.add(p, [](const ModuleSpec& s) { return std::make_unique<ProbeModule>(s); });

    ModuleSpec w = p;
    w.type = "test-writer";
    w.harmony = HarmonyRole::Writer;
    r.add(w, [](const ModuleSpec& s) { return std::make_unique<ProbeModule>(s); });
    ModuleSpec rd = p;
    rd.type = "test-reader";
    rd.harmony = HarmonyRole::Reader;
    r.add(rd, [](const ModuleSpec& s) { return std::make_unique<ProbeModule>(s); });

    // Audio modules for the bypass tests: a source with two audio outputs (1, 2), an effect with stereo audio in
    // and out (writes 0.5, and a control output), a mono-in effect with two audio outs, and a sink that records.
    ModuleSpec as;
    as.type = "test-audio-src";
    as.name = "Audio Src";
    as.outputs = {{"a", "A", Signal::Audio}, {"b", "B", Signal::Audio}};
    r.add(as, [](const ModuleSpec& s) { return std::make_unique<ConstModule>(s); });

    ModuleSpec fx;
    fx.type = "test-audio-fx";
    fx.name = "Audio Fx";
    fx.params = p.params;  // ProbeModule reads its first setting
    fx.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    fx.outputs = {{"l", "Out L", Signal::Audio}, {"r", "Out R", Signal::Audio}, {"env", "Env", Signal::Control}};
    r.add(fx, [](const ModuleSpec& s) { return std::make_unique<ProbeModule>(s); });

    ModuleSpec mono = fx;
    mono.type = "test-audio-mono";
    mono.inputs = {{"in", "In", Signal::Audio}};
    mono.outputs = {{"l", "Out L", Signal::Audio}, {"r", "Out R", Signal::Audio}};
    r.add(mono, [](const ModuleSpec& s) { return std::make_unique<ProbeModule>(s); });

    ModuleSpec sink;
    sink.type = "test-audio-sink";
    sink.name = "Audio Sink";
    sink.params = p.params;
    sink.inputs = {{"l", "L", Signal::Audio}, {"r", "R", Signal::Audio}};
    r.add(sink, [](const ModuleSpec& s) { return std::make_unique<ProbeModule>(s); });
}
BLEEP_REGISTER_MODULE(registerTestModules);

// ---- helpers ----------------------------------------------------------------

juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> props) {
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}
juce::var cable(const juce::String& id, const juce::String& fn, const juce::String& fj, const juce::String& tn,
                const juce::String& tj) {
    return obj({{"id", id}, {"from", obj({{"node", fn}, {"jack", fj}})}, {"to", obj({{"node", tn}, {"jack", tj}})},
                {"amount", 1.0}});
}
juce::var node(const juce::String& id, const juce::String& type, juce::var params = {}, bool bypassed = false) {
    return obj({{"id", id}, {"type", type}, {"params", params.isObject() ? params : juce::var(new juce::DynamicObject())},
                {"bypassed", bypassed}});
}

struct Compiled {
    std::map<std::string, std::shared_ptr<Module>> modules;
    std::unique_ptr<Program> program;
    ProbeModule* probe(const std::string& id) { return dynamic_cast<ProbeModule*>(modules[id].get()); }
};

Compiled compile(juce::Array<juce::var> nodes, juce::Array<juce::var> cables) {
    Compiled c;
    const juce::var doc = board::sanitise(obj({{"format", 1}, {"id", "t"}, {"nodes", nodes}, {"cables", cables}}));
    c.program = Program::compile(board::parse(doc), c.modules, {}, 48000.0);
    return c;
}

void runOnce(Program& p) {
    Transport t;
    t.playing = true;
    t.ppqValid = true;
    p.run(t, kChunk, true);
}

// ---- tests ------------------------------------------------------------------

void normalledInputs() {
    g_test = "normalled inputs";
    // Only A patched: B follows A, C follows B (and so A); all report unpatched except A.
    auto c = compile({node("k", "test-const"), node("p", "test-probe")}, {cable("1", "k", "b", "p", "a")});
    runOnce(*c.program);
    auto* p = c.probe("p");
    EXPECT(p->in[0] == 2.0f && p->in[1] == 2.0f && p->in[2] == 2.0f);
    EXPECT(p->connected[0] && !p->connected[1] && !p->connected[2]);
    EXPECT(p->in[3] == 0.0f);  // D has no normal
    // B patched: C follows B, not A.
    auto d = compile({node("k", "test-const"), node("p", "test-probe")},
                     {cable("1", "k", "a", "p", "a"), cable("2", "k", "b", "p", "b")});
    runOnce(*d.program);
    p = d.probe("p");
    EXPECT(p->in[0] == 1.0f && p->in[1] == 2.0f && p->in[2] == 2.0f);
    EXPECT(p->connected[1] && !p->connected[2]);
}

void outputFlags() {
    g_test = "output connected";
    auto c = compile({node("p", "test-probe"), node("q", "test-probe")}, {cable("1", "p", "o2", "q", "a")});
    runOnce(*c.program);
    auto* p = c.probe("p");
    EXPECT(!p->outConnected[0] && p->outConnected[1]);
    // Read through a knob counts too.
    auto d = compile({node("p", "test-probe"), node("q", "test-probe")}, {cable("1", "p", "o1", "q", "x")});
    runOnce(*d.program);
    EXPECT(d.probe("p")->outConnected[0]);
}

void harmonyOrder() {
    g_test = "harmony order";
    // No cable between them: the writer still runs first.
    auto c = compile({node("r", "test-reader"), node("w", "test-writer"), node("r2", "test-reader")}, {});
    runOnce(*c.program);
    EXPECT(c.probe("w")->ranAt < c.probe("r")->ranAt);
    EXPECT(c.probe("w")->ranAt < c.probe("r2")->ranAt);
    EXPECT(c.probe("r")->heardKey == 7 && c.probe("r2")->heardKey == 7);  // same chunk, through ctx.harmony
}

void steppedKnobs() {
    g_test = "stepped knobs";
    const ModuleSpec* spec = Registry::get().find("test-probe");
    EXPECT(spec && spec->params[0].modulatable && spec->params[0].kind == ParamSpec::Kind::Choice);
    // A control signal of 1.0 at amount 1 on a stepped knob moves it to its last step.
    auto c = compile({node("k", "test-const"), node("p", "test-probe")}, {cable("1", "k", "a", "p", "mode")});
    runOnce(*c.program);
    EXPECT(c.probe("p")->stepped == 3.0f);
    EXPECT(spec->params[0].text(2.0f) == "Three");
}

void describedMetadata() {
    g_test = "type description";
    const juce::var types = board::describeTypes();
    juce::var probe;
    for (const auto& t : *types.getArray())
        if (t["type"].toString() == "test-probe") probe = t;
    EXPECT(probe.isObject());
    const juce::var x = probe["params"][2];
    EXPECT(x["group"].toString() == "Group");
    EXPECT(x["show"]["param"].toString() == "count" && (int)x["show"]["min"] == 3);
    const juce::var d = probe["inputs"][3];
    EXPECT(d["names"]["by"].toString() == "mode" && d["names"]["list"][1].toString() == "D2");
    EXPECT(probe["inputs"][1]["normal"].toString() == "a");
    EXPECT(probe["buttons"][0]["id"].toString() == "ping" && (bool)probe["buttons"][0]["momentary"]);
    EXPECT((bool)probe["params"][0]["modulatable"] && probe["params"][0]["kind"].toString() == "choice");
}

void commands() {
    g_test = "commands";
    auto c = compile({node("p", "test-probe")}, {});
    auto* p = c.probe("p");
    p->command("clear", 1.0f);
    p->command("nope", 1.0f);  // unknown: ignored
    runOnce(*c.program);
    EXPECT(p->commands == 1 && p->lastCommand == 1 && p->lastValue == 1.0f);
    for (int i = 0; i < 200; ++i) p->command("ping", (float)i);  // overflow: the rest are dropped, no crash
    runOnce(*c.program);
    EXPECT(p->commands == 1 + 64 && p->lastCommand == 0);
}

void mediaStore() {
    g_test = "media";
    const auto dir = std::filesystem::temp_directory_path() /
        ("bleep-media-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    std::filesystem::remove_all(dir);
    media::setFolder(dir.string());
    MediaClip clip;
    clip.sampleRate = 44100.0;
    clip.channels.assign(2, std::vector<float>(1000));
    for (int i = 0; i < 1000; ++i) {
        clip.channels[0][(size_t)i] = std::sin(i * 0.05f);
        clip.channels[1][(size_t)i] = -0.5f;
    }
    const std::string id = media::save(clip);
    EXPECT(media::validId(id));
    EXPECT(media::save(clip) == id);  // content-addressed: stored once
    auto back = media::load(id);
    EXPECT(back && back->numChannels() == 2 && back->numFrames() == 1000 && back->sampleRate == 44100.0);
    if (back) EXPECT(back->channels[0][500] == clip.channels[0][500] && back->channels[1][7] == -0.5f);
    EXPECT(!media::load("../../etc/passwd"));
    EXPECT(!media::load("ffffffffffffffff.wav"));
    // 16-bit PCM import.
    std::vector<uint8_t> wav = {'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ', 16, 0, 0, 0,
                                1, 0, 1, 0, 0x44, 0xac, 0, 0, 0x88, 0x58, 1, 0, 2, 0, 16, 0, 'd', 'a', 't', 'a',
                                4, 0, 0, 0, 0x00, 0x40, 0x00, 0xc0};
    std::string error;
    auto imported = media::import(wav.data(), wav.size(), "tiny.wav", &error);
    EXPECT(imported && imported->numFrames() == 2 && std::fabs(imported->channels[0][0] - 0.5f) < 1e-6f &&
           std::fabs(imported->channels[0][1] + 0.5f) < 1e-6f);
    EXPECT(!media::import((const uint8_t*)"nope", 4, "x.wav", &error) && !error.empty());
    std::filesystem::remove_all(dir);
}

void sequencerFollowsHarmony() {
    g_test = "step sequencer follows harmony";
    // The test writer publishes key G (7) on bus B; the default pattern plays the root.
    auto run = [](double harmonyBus) {
        auto c = compile({node("w", "test-writer"), node("s", "step-sequencer", obj({{"harmony", harmonyBus / 4.0}}))}, {});
        Transport t;
        t.playing = t.ppqValid = true;
        for (int b = 0; b < 40; ++b) {
            c.program->run(t, 256, b == 0);
            t.ppq += 120.0 / 60.0 * 256 / 48000.0;
        }
        for (const auto& st : c.program->steps())
            if (st.nodeId == "s") return st.outputBuffers[1][0];  // Pitch
        return -99.0f;
    };
    EXPECT(std::fabs(run(0.0)) < 1e-6f);               // Off: Root C
    EXPECT(std::fabs(run(2.0) - 7.0f / 12.0f) < 1e-6f);  // Bus B: G
    EXPECT(std::fabs(run(1.0)) < 1e-6f);               // Bus A is silent: Root C
}

void handoff() {
    g_test = "handoff";
    RtHandoff<int> h;
    EXPECT(h.get() == nullptr);
    h.publish(std::make_shared<const int>(7));
    EXPECT(h.get() && *h.get() == 7);
    h.publish(std::make_shared<const int>(8));
    h.publish(std::make_shared<const int>(9));  // the audio thread only sees the latest
    EXPECT(*h.get() == 9);
    h.publish(nullptr);
    EXPECT(h.get() == nullptr);
}

}  // namespace

void missingModules() {
    g_test = "missing module";
    // A board that uses a module this machine does not have: the node stays (with what it was saved with), so does the cable to it,
    // and everything else still runs.
    auto missing = node("m", "no-such-module", obj({{"depth", 0.25}}));
    missing.getDynamicObject()->setProperty("x", 120.0);
    missing.getDynamicObject()->setProperty("data", obj({{"steps", 16}}));
    const juce::var doc = board::sanitise(obj({{"format", 1}, {"id", "t"},
                                               {"nodes", juce::Array<juce::var>{node("k", "test-const"), missing, node("p", "test-probe")}},
                                               {"cables", juce::Array<juce::var>{cable("1", "k", "a", "p", "a"), cable("2", "k", "a", "m", "in"), cable("3", "m", "out", "p", "b")}}}));
    juce::StringArray warnings;
    const juce::var again = board::sanitise(doc, &warnings);  // a second pass changes nothing
    EXPECT(warnings.isEmpty() || warnings[0].contains("placeholder"));
    int nodes = 0, cables = 0;
    bool kept = false;
    for (const auto& n : *again["nodes"].getArray()) {
        ++nodes;
        if (n["id"].toString() == "m") kept = (bool)n["missing"] && n["type"].toString() == "no-such-module" && (double)n["x"] == 120.0 &&
                                              (int)n["data"]["steps"] == 16 && (double)n["params"]["depth"] == 0.25;
    }
    for (const auto& c : *again["cables"].getArray()) { (void)c; ++cables; }
    EXPECT(nodes == 3 && kept);
    EXPECT(cables == 3);
    // the compiled board leaves the placeholder out and runs the rest
    Compiled c;
    c.program = Program::compile(board::parse(doc), c.modules, {}, 48000.0);
    EXPECT(c.program != nullptr && c.modules.count("m") == 0 && c.modules.count("p") == 1);
    runOnce(*c.program);
    EXPECT(c.probe("p") && c.probe("p")->in[0] == 1.0f);
    // an unknown node without an id is still dropped
    const juce::var bad = board::sanitise(obj({{"format", 1}, {"nodes", juce::Array<juce::var>{obj({{"type", "no-such-module"}})}}}));
    EXPECT(bad["nodes"].getArray()->size() == 0);
}

void bypass() {
    g_test = "bypass";
    // src (audio 1, 2) → fx → sink. Running: the effect writes 0.5 to both outputs.
    const juce::Array<juce::var> wires{cable("1", "src", "a", "fx", "l"), cable("2", "src", "b", "fx", "r"),
                                       cable("3", "fx", "l", "sink", "l"), cable("4", "fx", "r", "sink", "r")};
    auto on = compile({node("src", "test-audio-src"), node("fx", "test-audio-fx"), node("sink", "test-audio-sink")}, wires);
    runOnce(*on.program);
    EXPECT(on.probe("fx")->ranAt > 0);
    EXPECT(on.probe("sink")->in[0] == 0.5f && on.probe("sink")->in[1] == 0.5f);

    // Bypassed: the module does not run and its audio inputs reach its audio outputs, in order.
    auto off = compile({node("src", "test-audio-src"), node("fx", "test-audio-fx", {}, true), node("sink", "test-audio-sink")}, wires);
    runOnce(*off.program);
    EXPECT(off.probe("fx")->ranAt == 0);
    EXPECT(off.probe("sink")->in[0] == 1.0f && off.probe("sink")->in[1] == 2.0f);
    runOnce(*off.program);  // and again, with the state kept between chunks
    EXPECT(off.probe("sink")->in[0] == 1.0f && off.probe("sink")->in[1] == 2.0f);

    // A control output of a bypassed module is silent (0), not a stale value.
    auto env = compile({node("src", "test-audio-src"), node("fx", "test-audio-fx", {}, true), node("q", "test-probe")},
                       {cable("1", "src", "a", "fx", "l"), cable("2", "fx", "env", "q", "a")});
    runOnce(*env.program);
    EXPECT(env.probe("q")->in[0] == 0.0f);

    // One audio input and two audio outputs: both outputs follow the input.
    auto mono = compile({node("src", "test-audio-src"), node("m", "test-audio-mono", {}, true), node("sink", "test-audio-sink")},
                        {cable("1", "src", "b", "m", "in"), cable("2", "m", "l", "sink", "l"), cable("3", "m", "r", "sink", "r")});
    runOnce(*mono.program);
    EXPECT(mono.probe("m")->ranAt == 0);
    EXPECT(mono.probe("sink")->in[0] == 2.0f && mono.probe("sink")->in[1] == 2.0f);

    // A module without audio in and out ignores the flag and keeps running.
    auto ctl = compile({node("p", "test-probe", {}, true)}, {});
    runOnce(*ctl.program);
    EXPECT(ctl.probe("p")->ranAt > 0);

    // Switching bypass off again brings the module back.
    auto back = compile({node("src", "test-audio-src"), node("fx", "test-audio-fx", {}, false), node("sink", "test-audio-sink")}, wires);
    runOnce(*back.program);
    EXPECT(back.probe("sink")->in[0] == 0.5f);
}

int main() {
    bypass();
    normalledInputs();
    missingModules();
    outputFlags();
    harmonyOrder();
    steppedKnobs();
    describedMetadata();
    commands();
    mediaStore();
    handoff();
    sequencerFollowsHarmony();
    std::printf("engine features: %d failures\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
