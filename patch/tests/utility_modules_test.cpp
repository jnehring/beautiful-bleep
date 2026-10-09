// SPDX-License-Identifier: MIT
//
// Node-level tests for the utility modules (doc/specs/modules/attenuverter.md,
// cv-mixer.md, audio-mixer.md, multiplier.md, crossfader.md, logic.md,
// quantizer.md, switch.md, notes-to-cv.md): their specs, normalling of
// unpatched jacks, node data and note input, run through the Module API.
#include "Engine.h"
#include "Registry.h"

#include <cmath>
#include <cstdio>
#include <map>
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

/// One module with buffers for every param, jack and output.
struct Rig {
    std::unique_ptr<Module> m;
    std::vector<std::vector<float>> params, inputs, outputs;
    std::vector<const float*> pp, ip;
    std::vector<float*> op;
    std::unique_ptr<bool[]> connected;
    std::vector<NoteBuffer> notes;
    std::vector<const NoteBuffer*> np;
    Transport transport;

    explicit Rig(const std::string& type) : m(Registry::get().create(type)) {
        const auto& s = m->spec();
        params.assign(s.params.size(), std::vector<float>(kChunk));
        inputs.assign(s.inputs.size(), std::vector<float>(kChunk, 0.0f));
        outputs.assign(s.outputs.size(), std::vector<float>(kChunk, 0.0f));
        notes.resize(s.inputs.size());
        connected.reset(new bool[s.inputs.size() + 1]());
        for (size_t i = 0; i < s.params.size(); ++i) set(s.params[i].id, s.params[i].def);
        for (auto& v : params) pp.push_back(v.data());
        for (auto& v : inputs) ip.push_back(v.data());
        for (auto& v : outputs) op.push_back(v.data());
        for (auto& b : notes) np.push_back(&b);
        transport.sampleRate = kRate;
        m->prepare(kRate);
        if (s.sanitiseData) m->setData(s.sanitiseData(""));
        m->reset();
    }
    /// A param in its own units.
    void set(const std::string& id, float value) {
        const int i = m->spec().paramIndex(id);
        const float n = m->spec().params[(size_t)i].toNormalised(value);
        m->setKnob(i, n);
        std::fill(params[(size_t)i].begin(), params[(size_t)i].end(), n);
    }
    /// Patches an input with a constant.
    void patch(const std::string& id, float value) {
        const int i = m->spec().inputIndex(id);
        connected[(size_t)i] = true;
        std::fill(inputs[(size_t)i].begin(), inputs[(size_t)i].end(), value);
    }
    void unpatch(const std::string& id) {
        const int i = m->spec().inputIndex(id);
        connected[(size_t)i] = false;
        std::fill(inputs[(size_t)i].begin(), inputs[(size_t)i].end(), 0.0f);
    }
    void run(int chunks = 1) {
        ProcessContext c;
        c.numSamples = kChunk;
        c.transport = &transport;
        c.params = pp.data();
        c.inputs = ip.data();
        c.inputConnected = connected.get();
        c.notesIn = np.data();
        c.outputs = op.data();
        c.ppqPerSample = transport.bpm / 60.0 / kRate;
        for (int k = 0; k < chunks; ++k) {
            c.ppqStart = transport.ppq;
            m->process(c);
            if (transport.playing) transport.ppq += c.ppqPerSample * kChunk;
            for (auto& b : notes) b.clear();  // events play once
        }
    }
    float out(const std::string& id, int sample = kChunk - 1) const {
        return outputs[(size_t)m->spec().outputIndex(id)][(size_t)sample];
    }
};

void specs() {
    const char* types[] = {"attenuverter", "cv-mixer", "audio-mixer", "multiplier", "crossfader",
                           "logic",        "quantizer", "switch",     "notes-to-cv", "level-meter"};
    for (const char* t : types) {
        g_test = t;
        const ModuleSpec* s = Registry::get().find(t);
        EXPECT(s != nullptr);
        if (!s) continue;
        EXPECT(s->category == "Utility" || s->category == "Audio");
        // Knobs are inputs too (spec §7.3): ids must not clash with jacks.
        std::set<std::string> ids;
        for (const auto& p : s->params) EXPECT(ids.insert(p.id).second);
        for (const auto& j : s->inputs) EXPECT(ids.insert(j.id).second);
        std::set<std::string> outs;
        for (const auto& j : s->outputs) EXPECT(outs.insert(j.id).second);
        EXPECT(Registry::get().create(t) != nullptr);
    }
}

void attenuverter() {
    g_test = "attenuverter node";
    Rig r("attenuverter");
    r.set("scale1", 0.5f);
    r.set("offset1", 0.25f);
    r.run();
    EXPECT_NEAR(r.out("out1"), 0.75, 1e-5);  // unpatched: Scale + Offset
    r.patch("in1", -1.0f);
    r.run();
    EXPECT_NEAR(r.out("out1"), -0.25, 1e-5);
    EXPECT_NEAR(r.out("out2"), 1.0, 1e-5);   // defaults: Scale 1, In = +1
    EXPECT_NEAR(r.out("sum"), -0.25 + 3.0, 1e-5);
    r.set("clip", 2.0f);  // Hard
    r.run();
    EXPECT_NEAR(r.out("sum"), 1.0, 1e-6);
}

void cvMixer() {
    g_test = "cv mixer node";
    Rig r("cv-mixer");
    r.set("clip", 0.0f);
    r.set("level1", 0.4f);
    r.run();
    EXPECT_NEAR(r.out("out"), 0.4, 1e-5);  // In 1 unpatched: Level 1 is an offset
    r.patch("in2", 0.5f);
    r.set("level2", 1.0f);
    r.set("mode", 1.0f);  // Average over In 1 (active by its level) and In 2
    r.run();
    EXPECT_NEAR(r.out("out"), 0.45, 1e-5);
    r.set("level1", 0.0f);
    r.run();
    EXPECT_NEAR(r.out("out"), 0.5, 1e-5);  // In 1 no longer counts
    EXPECT_NEAR(r.out("inv"), -0.5, 1e-5);
}

void multiplier() {
    g_test = "multiplier node";
    Rig r("multiplier");
    r.patch("x1", 0.5f);
    r.run();
    EXPECT_NEAR(r.out("out1"), 0.5, 1e-6);  // Y1 unpatched reads +1
    EXPECT_NEAR(r.out("out2"), 0.5, 1e-6);  // X2 ← Out 1, Y2 = +1
    r.patch("y1", -0.5f);
    r.patch("y2", 0.5f);
    r.run();
    EXPECT_NEAR(r.out("out1"), -0.25, 1e-6);
    EXPECT_NEAR(r.out("out2"), -0.125, 1e-6);
    r.set("oversampling", 2.0f);
    r.run(20);  // past the filter latency, a constant passes unchanged
    EXPECT_NEAR(r.out("out1"), -0.25, 1e-3);
}

void crossfader() {
    g_test = "crossfader node";
    Rig r("crossfader");
    r.patch("al", 1.0f);
    r.patch("bl", 0.5f);
    r.set("fade", 0.0f);
    r.run();
    EXPECT_NEAR(r.out("outl"), 1.0, 1e-6);
    EXPECT_NEAR(r.out("outr"), 1.0, 1e-6);  // A R unpatched copies A L
    r.set("fade", 1.0f);
    r.set("curve", 1.0f);
    r.run();
    EXPECT_NEAR(r.out("outr"), 0.5, 1e-6);
}

void logic() {
    g_test = "logic node";
    Rig r("logic");
    r.patch("a", 1.0f);
    r.patch("b", 1.0f);
    r.run();
    EXPECT(r.out("and") == 1.0f);  // C unpatched is ignored
    r.patch("c", 0.0f);
    r.run();
    EXPECT(r.out("and") == 0.0f);  // C patched and low
    EXPECT(r.out("xor") == 0.0f);
    r.unpatch("c");
    r.set("threshold", 0.9f);
    r.patch("a", 0.8f);
    r.run();
    EXPECT(r.out("and") == 0.0f);  // 0.8 is below the threshold (after hysteresis)
}

void quantizer() {
    g_test = "quantizer node";
    Rig r("quantizer");
    const auto& spec = r.m->spec();
    EXPECT(spec.sanitiseData("") == spec.sanitiseData("{\"customMask\": 2741}"));
    EXPECT(spec.sanitiseData("{\"customMask\": 65535}").find("4095") != std::string::npos);
    r.patch("in", 3.4f / 12.0f);
    r.set("hysteresis", 0.0f);
    r.run();
    EXPECT_NEAR(r.out("out"), 4.0 / 12.0, 1e-6);  // C major: D# + 0.4 → E
    r.set("scale", 17.0f);  // Custom: C and G only
    r.m->setData("{\"customMask\": 129}");
    r.run();
    EXPECT_NEAR(r.out("out"), 0.0, 1e-6);
    r.patch("in", 5.0f / 12.0f);
    r.run();
    EXPECT_NEAR(r.out("out"), 7.0 / 12.0, 1e-6);
    r.patch("rootin", 14.0f / 12.0f);  // D (one octave up): D and A
    r.run();
    EXPECT_NEAR(r.out("out"), 2.0 / 12.0, 1e-6);  // F is 3 above D, 4 below A
}

void switchNode() {
    g_test = "switch node";
    Rig r("switch");
    r.set("fade", 0.0f);
    for (int k = 1; k <= 4; ++k) r.patch("in" + std::to_string(k), (float)k);
    r.run();
    EXPECT(r.out("out") == 1.0f);
    const int step = r.m->spec().inputIndex("step");
    r.connected[(size_t)step] = true;
    r.inputs[(size_t)step][5] = 1.0f;
    r.run();
    r.inputs[(size_t)step][5] = 0.0f;
    EXPECT(r.out("out") == 2.0f);
    EXPECT(r.out("changed", 5) == 1.0f && r.out("gate", 5) == 0.0f);
    EXPECT_NEAR(r.out("position"), 1.0 / 3.0, 1e-6);
    r.unpatch("in2");
    r.set("level2", -0.5f);
    r.run();
    EXPECT_NEAR(r.out("out"), -0.5, 1e-6);  // unpatched: the Level is a constant
    r.patch("in", 0.8f);
    r.run();
    EXPECT_NEAR(r.out("out2"), 0.8, 1e-6);
    EXPECT_NEAR(r.out("out1"), 0.0, 1e-6);  // 1 → 8 follows the same step

    // Transport mode: Step unpatched, Rate 1/4 → one step per beat.
    Rig t("switch");
    t.set("fade", 0.0f);
    t.set("rate", 4.0f);
    for (int k = 1; k <= 4; ++k) t.patch("in" + std::to_string(k), (float)k);
    t.transport.playing = t.transport.ppqValid = true;
    t.run(700);  // 120 BPM: a beat is 750 chunks
    EXPECT(t.out("out") == 1.0f);
    t.run(100);
    EXPECT(t.out("out") == 2.0f);
    t.transport.ppq = 3.0;  // a jump to beat 4
    t.run();
    EXPECT(t.out("out") == 4.0f);
}

void notesToCv() {
    g_test = "notes to cv node";
    Rig r("notes-to-cv");
    const int in = r.m->spec().inputIndex("notes");
    r.connected[(size_t)in] = true;
    NoteEvent on;
    on.type = NoteEvent::On;
    on.offset = 10;
    on.note = 67;
    on.pitch = 7.0f / 12.0f;
    on.value = 0.5f;
    r.notes[(size_t)in].push(on);
    r.run();
    EXPECT(r.out("gate", 9) == 0.0f && r.out("gate", 10) == 1.0f);  // sample-accurate
    EXPECT(r.out("trigger", 10) == 1.0f && r.out("trigger", 11) == 0.0f);
    EXPECT_NEAR(r.out("pitch"), 7.0 / 12.0, 1e-6);
    EXPECT_NEAR(r.out("velocity"), 0.5, 1e-6);
    r.run();
    EXPECT(r.out("gate") == 1.0f);
    // Transport stop releases held notes.
    r.transport.playing = true;
    r.run();
    r.transport.playing = false;
    r.run();
    EXPECT(r.out("gate", 0) == 0.0f);
    // So does removing the cable.
    on.offset = 0;
    r.notes[(size_t)in].push(on);
    r.run();
    EXPECT(r.out("gate") == 1.0f);
    r.connected[(size_t)in] = false;
    r.run();
    EXPECT(r.out("gate", 0) == 0.0f);
}

void audioMixer() {
    g_test = "audio mixer node";
    Rig r("audio-mixer");
    r.set("limiter", 0.0f);
    r.patch("in1l", 0.5f);
    r.run(10);
    EXPECT_NEAR(r.out("outl"), 0.5 * 0.70711, 1e-4);  // mono, centred: −3 dB each side
    EXPECT_NEAR(r.out("outr"), 0.5 * 0.70711, 1e-4);
    r.patch("in1r", 0.25f);
    r.run(10);
    EXPECT_NEAR(r.out("outl"), 0.5, 1e-5);  // stereo: balance passes unchanged
    EXPECT_NEAR(r.out("outr"), 0.25, 1e-5);
    r.unpatch("in1l");
    r.unpatch("in1r");
    r.patch("returnl", 0.3f);
    r.run(10);
    EXPECT_NEAR(r.out("outr"), 0.3, 1e-5);  // Return R copies L
    EXPECT(r.out("sendl") == 0.0f);         // the send never carries the return
    r.patch("mute1in", 1.0f);
    r.patch("in1l", 0.5f);
    r.run(10);
    EXPECT_NEAR(r.out("outl"), 0.3, 1e-5);  // channel 1 muted by its gate
    // Fader law: 0 dB is at about 80 % of the travel.
    const auto& level = r.m->spec().params[(size_t)r.m->spec().paramIndex("level1")];
    EXPECT(level.toNormalised(0.0f) > 0.75f && level.toNormalised(0.0f) < 0.85f);
}

void levelMeter() {
    g_test = "level-meter";
    Rig r("level-meter");
    auto live = [&] {
        std::vector<std::pair<std::string, double>> v;
        r.m->liveValues(v);
        std::map<std::string, double> m(v.begin(), v.end());
        return m;
    };
    // Mono: In L feeds both outputs and the view shows one bar.
    r.patch("l", 0.5f);
    r.inputs[0][3] = -0.8f;
    r.run();
    EXPECT(r.out("l") == 0.5f && r.out("r") == 0.5f);
    EXPECT_NEAR(r.out("l", 3), -0.8f, 0.0);
    EXPECT_NEAR(r.out("r", 3), -0.8f, 0.0);
    auto v = live();
    EXPECT(v["stereo"] == 0.0);
    EXPECT_NEAR(v["peakL"], 0.8, 1e-6);
    EXPECT_NEAR(v["peakR"], 0.8, 1e-6);
    EXPECT(v["clipL"] == 0.0);
    EXPECT(r.out("clip") == 0.0f);
    // The peak is reported once, then what came since.
    r.patch("l", 0.25f);
    r.run();
    EXPECT_NEAR(live()["peakL"], 0.25, 1e-6);
    // Stereo, with a clipped right channel.
    r.patch("r", 1.5f);
    r.run();
    EXPECT(r.out("r") == 1.5f);
    EXPECT(r.out("clip") == 1.0f);
    v = live();
    EXPECT(v["stereo"] == 1.0);
    EXPECT(v["clipL"] == 0.0 && v["clipR"] == 1.0);
    EXPECT(live()["clipR"] == 0.0);  // read once
    // Level: a steady 0 dBFS signal settles at 1, silence falls to 0.
    r.patch("l", 1.0f);
    r.patch("r", 1.0f);
    r.set("response", 0.01f);
    r.run(200);
    EXPECT_NEAR(r.out("level"), 1.0, 1e-3);
    r.patch("l", 0.0f);
    r.patch("r", 0.0f);
    r.run(400);  // 25 time constants: far below −60 dB
    EXPECT(r.out("level") == 0.0f);
}

}  // namespace

int main() {
    specs();
    attenuverter();
    cvMixer();
    multiplier();
    crossfader();
    logic();
    quantizer();
    switchNode();
    notesToCv();
    audioMixer();
    levelMeter();
    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all utility module tests passed\n");
    return 0;
}
