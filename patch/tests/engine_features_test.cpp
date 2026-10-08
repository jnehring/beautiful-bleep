// SPDX-License-Identifier: MIT
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

#include <cmath>
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
        pollCommands([&](const Command& cmd) {
            lastCommand = cmd.index;
            lastValue = cmd.value;
            ++commands;
        });
    }
    float in[4] = {}, stepped = 0.0f, lastValue = 0.0f;
    bool connected[4] = {}, outConnected[4] = {};
    int ranAt = 0, lastCommand = -1, commands = 0;
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
juce::var node(const juce::String& id, const juce::String& type, juce::var params = {}) {
    return obj({{"id", id}, {"type", type}, {"params", params.isObject() ? params : juce::var(new juce::DynamicObject())}});
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
    const auto dir = std::filesystem::temp_directory_path() / "bleep-media-test";
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

int main() {
    normalledInputs();
    outputFlags();
    harmonyOrder();
    steppedKnobs();
    describedMetadata();
    commands();
    mediaStore();
    handoff();
    std::printf("engine features: %d failures\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
