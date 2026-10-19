// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// Node-level tests for the utility modules (doc/specs/modules/attenuverter.md,
// cv-mixer.md, audio-mixer.md, multiplier.md, crossfader.md, logic.md,
// quantizer.md, switch.md, notes-to-cv.md, transport.md, delay.md): their specs, normalling of
// unpatched jacks, node data and note input, run through the Module API.
#include "Engine.h"
#include "HostControl.h"
#include "Registry.h"

#include <cmath>
#include <cstdio>
#include <cstring>
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
    std::unique_ptr<bool[]> outConnected;
    std::vector<NoteBuffer> notes, notesOutBuf;
    std::vector<const NoteBuffer*> np;
    std::vector<NoteBuffer*> nop;
    Transport transport;
    PortIO* port = nullptr;  ///< port nodes: the host block for the tick

    explicit Rig(const std::string& type) : m(Registry::get().create(type)) {
        const auto& s = m->spec();
        params.assign(s.params.size(), std::vector<float>(kChunk));
        inputs.assign(s.inputs.size(), std::vector<float>(kChunk, 0.0f));
        outputs.assign(s.outputs.size(), std::vector<float>(kChunk, 0.0f));
        notes.resize(s.inputs.size());
        notesOutBuf.resize(s.outputs.size());
        for (auto& b : notesOutBuf) nop.push_back(&b);
        connected.reset(new bool[s.inputs.size() + 1]());
        outConnected.reset(new bool[s.outputs.size() + 1]());
        std::fill(outConnected.get(), outConnected.get() + s.outputs.size(), true);
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
        c.outputConnected = outConnected.get();
        c.notesIn = np.data();
        c.notesOut = nop.data();
        c.port = port;
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
    const char* types[] = {"attenuverter", "cv-mixer", "audio-mixer", "multiplier", "math", "cv-to-gate", "crossfader",
                           "logic",        "quantizer", "switch",     "notes-to-cv", "level-meter", "monitor"};
    for (const char* t : types) {
        g_test = t;
        const ModuleSpec* s = Registry::get().find(t);
        EXPECT(s != nullptr);
        if (!s) continue;
        EXPECT(s->category.rfind("Utility/", 0) == 0 || s->category.rfind("Audio/", 0) == 0);
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

void mathNode() {
    g_test = "math node";
    Rig r("math");
    r.patch("ina1", 3.0f);
    r.run();
    EXPECT_NEAR(r.out("out1"), 3.0, 1e-6);  // Multiply, B1 reads its knob (1)
    r.set("b1", 4.0f);
    r.run();
    EXPECT_NEAR(r.out("out1"), 12.0, 1e-6);
    r.patch("inb1", -2.0f);
    r.run();
    EXPECT_NEAR(r.out("out1"), -6.0, 1e-6);  // a patched B replaces the knob
    // A = 3, B = -2
    for (int op = 0; op < 7; ++op) {
        r.set("op1", (float)op);
        r.run();
        const float want = op == 0 ? 1.0f : op == 1 ? 5.0f : op == 2 ? -6.0f : op == 3 ? -1.5f : op == 4 ? 1.0f / 9.0f : op == 5 ? -2.0f : 3.0f;
        EXPECT_NEAR(r.out("out1"), want, 1e-5);
    }
    r.set("op1", 3.0f);  // Divide by ~0 stays finite
    r.patch("inb1", 0.0f);
    r.run();
    EXPECT(std::isfinite(r.out("out1")) && std::fabs(r.out("out1")) <= 1000.0f);
    r.set("op1", 4.0f);  // Power: negative base, fractional exponent, no NaN; sign kept
    r.patch("ina1", -4.0f);
    r.patch("inb1", 0.5f);
    r.run();
    EXPECT_NEAR(r.out("out1"), -2.0, 1e-5);
    r.patch("inb1", 100.0f);  // huge result is clamped
    r.patch("ina1", 10.0f);
    r.run();
    EXPECT_NEAR(r.out("out1"), 1000.0, 1e-3);
    r.run();
    EXPECT_NEAR(r.out("out2"), 0.0, 1e-6);  // row 2: Add of two zero constants
}

void cvToGateNode() {
    g_test = "cv-to-gate node";
    Rig r("cv-to-gate");
    r.set("threshold", 0.5f);
    r.patch("in", 0.2f);
    r.run();
    EXPECT(r.out("gate") == 0.0f);
    r.patch("in", 0.8f);
    r.run();
    EXPECT(r.out("gate") == 1.0f);  // length 0: follows
    r.patch("in", 0.2f);
    r.run();
    EXPECT(r.out("gate") == 0.0f);
    r.set("length", 0.001f);  // 48 samples: fires on the rise, outlasts one chunk, then ends
    r.patch("in", 0.0f);
    r.run();
    r.patch("in", 0.8f);
    r.run();
    EXPECT(r.out("gate", 0) == 1.0f && r.out("gate") == 1.0f);
    r.run();
    EXPECT(r.out("gate", 0) == 1.0f && r.out("gate") == 0.0f);  // input still high, pulse over
    r.run(3);
    EXPECT(r.out("gate") == 0.0f);
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

    // Notes in, notes out: C major, nearest. D# (63) is a tie and goes down to D (62); the Off follows the sent note.
    Rig n("quantizer");
    n.set("hysteresis", 0.0f);
    const int ni = n.m->spec().inputIndex("notesin");
    const NoteBuffer& nout = n.notesOutBuf[(size_t)n.m->spec().outputIndex("notes")];
    n.connected[(size_t)ni] = true;
    auto ev = [&](NoteEvent::Type t, int note, int offset) {
        NoteEvent e;
        e.type = t;
        e.note = note;
        e.offset = (int16_t)offset;
        e.value = 0.7f;
        n.notes[(size_t)ni].push(e);
    };
    ev(NoteEvent::On, 63, 2);
    ev(NoteEvent::Cc, 74, 3);
    n.run();
    EXPECT(nout.count == 2 && nout.events[0].type == NoteEvent::On && nout.events[0].note == 62 &&
           nout.events[0].offset == 2 && nout.events[0].value == 0.7f);
    EXPECT(nout.count == 2 && nout.events[1].type == NoteEvent::Cc && nout.events[1].note == 74);
    n.set("scale", 17.0f);  // Custom: C and G only; the Off must still end the D that was sent
    n.m->setData("{\"customMask\": 129}");
    ev(NoteEvent::Off, 63, 0);
    n.run();
    EXPECT(nout.count == 1 && nout.events[0].type == NoteEvent::Off && nout.events[0].note == 62);
    n.patch("shift", 2.0f / 12.0f);  // Shift is chromatic, after quantizing: 67 (G) + 2
    ev(NoteEvent::On, 66, 0);
    n.run();
    EXPECT(nout.count == 1 && nout.events[0].note == 69);
    n.connected[(size_t)ni] = false;  // cable pulled with a note held: it ends
    n.run();
    EXPECT(nout.count == 1 && nout.events[0].type == NoteEvent::Off && nout.events[0].note == 69);
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

    // Events it does not know are ignored: a CC, a program change, a bend, a clock must not
    // move the pressure output or the gate.
    Rig q("notes-to-cv");
    const int qin = q.m->spec().inputIndex("notes");
    q.connected[(size_t)qin] = true;
    for (int type : {(int)NoteEvent::Cc, (int)NoteEvent::Program, (int)NoteEvent::Bend,
                     (int)NoteEvent::ChannelPressure, (int)NoteEvent::System}) {
        NoteEvent e;
        e.type = (uint8_t)type;
        e.note = 60;
        e.value = 0.9f;
        e.offset = 0;
        q.notes[(size_t)qin].push(e);
    }
    q.run();
    EXPECT(q.out("pressure") == 0.0f && q.out("gate") == 0.0f && q.out("trigger", 0) == 0.0f);
}

void midiInEvents() {
    g_test = "midi in events";
    Rig r("midi-in");
    auto frame = std::make_unique<PortFrame>();
    PortIO io;
    io.in = frame.get();
    r.port = &io;
    r.transport.playing = false;
    auto midi = [&](int offset, int status, int d1, int d2, int size = 3) {
        MidiEvent& e = frame->midi[frame->numMidi++];
        e.offset = offset;
        e.bytes[0] = (uint8_t)status;
        e.bytes[1] = (uint8_t)d1;
        e.bytes[2] = (uint8_t)d2;
        e.size = (uint8_t)size;
    };
    midi(0, 0x91, 60, 100);            // note on, channel 2
    midi(1, 0xb3, 74, 64);             // CC 74 = 64 on channel 4
    midi(2, 0xc9, 33, 0, 2);           // program change 33 on channel 10
    midi(3, 0xe0, 0x00, 0x00);         // pitch bend, fully down
    midi(4, 0xd0, 127, 0, 2);          // channel pressure
    midi(5, 0xa1, 60, 51);             // poly pressure
    midi(6, 0xf8, 0, 0, 1);            // clock
    midi(7, 0xfa, 0, 0, 1);            // start
    midi(8, 0x81, 60, 0);              // note off
    r.run();
    const NoteBuffer& n = r.notesOutBuf[(size_t)r.m->spec().outputIndex("notes")];
    EXPECT(n.count == 9);
    if (n.count == 9) {
        EXPECT(n.events[0].type == NoteEvent::On && n.events[0].channel == 1 && n.events[0].note == 60);
        EXPECT(n.events[1].type == NoteEvent::Cc && n.events[1].channel == 3 && n.events[1].note == 74);
        EXPECT_NEAR(n.events[1].value, 64.0 / 127.0, 1e-6);
        EXPECT(n.events[2].type == NoteEvent::Program && n.events[2].channel == 9 && n.events[2].note == 33);
        EXPECT(n.events[3].type == NoteEvent::Bend);
        EXPECT_NEAR(n.events[3].value, -1.0, 1e-6);
        EXPECT(n.events[4].type == NoteEvent::ChannelPressure);
        EXPECT_NEAR(n.events[4].value, 1.0, 1e-6);
        EXPECT(n.events[5].type == NoteEvent::Pressure && n.events[5].note == 60);
        EXPECT(n.events[6].type == NoteEvent::System && n.events[6].note == 0xf8 && n.events[6].offset == 6);
        EXPECT(n.events[7].type == NoteEvent::System && n.events[7].note == 0xfa);
        EXPECT(n.events[8].type == NoteEvent::Off);
    }
    // The mono outputs still follow as before.
    EXPECT_NEAR(r.out("bend"), -1.0, 1e-6);
    EXPECT_NEAR(r.out("cc1"), 0.0, 1e-6);

    // A flood of controllers never crowds out notes: the last kNoteReserve slots are for them.
    std::memset(static_cast<void*>(frame.get()->midi), 0, sizeof(frame->midi));
    frame->numMidi = 0;
    for (int i = 0; i < 60; ++i) midi(0, 0xb0, 1, i & 127);
    midi(1, 0x90, 62, 90);
    r.run();
    int cc = 0, on = 0;
    for (int k = 0; k < n.count; ++k) {
        cc += n.events[k].type == NoteEvent::Cc;
        on += n.events[k].type == NoteEvent::On;
    }
    EXPECT(on == 1 && cc == kMaxNotesPerChunk - kNoteReserve);
}

void compressorView() {
    g_test = "compressor view data";
    Rig r("compressor");
    auto live = [&] {
        std::vector<std::pair<std::string, double>> v;
        r.m->liveValues(v);
        return std::map<std::string, double>(v.begin(), v.end());
    };
    auto array = [&](const std::string& name) {
        std::vector<std::pair<std::string, std::vector<float>>> a;
        r.m->liveArrays(a);
        for (auto& x : a)
            if (x.first == name) return x.second;
        return std::vector<float>();
    };
    // A loud 1 kHz sine on both inputs: -6 dBFS over a -30 dB threshold is compressed.
    r.set("threshold", -30.0f);
    r.set("ratio", 8.0f);
    r.patch("l", 0.0f);
    r.patch("r", 0.0f);
    const int l = r.m->spec().inputIndex("l"), rr = r.m->spec().inputIndex("r");
    for (int k = 0; k < 40; ++k) {
        for (int i = 0; i < kChunk; ++i) {
            const float x = 0.5f * std::sin(6.2831853f * 1000.0f * (float)(k * kChunk + i) / (float)kRate);
            r.inputs[(size_t)l][(size_t)i] = x;
            r.inputs[(size_t)rr][(size_t)i] = x;
        }
        r.run();
    }
    const auto in = array("historyIn"), wet = array("historyOut"), gr = array("historyGr");
    EXPECT(in.size() == 400 && wet.size() == 400 && gr.size() == 400);
    EXPECT(in.back() > 0.45f && in.back() < 0.51f);   // the input peak
    EXPECT(wet.back() > 0.0f && wet.back() < in.back());  // turned down
    EXPECT(gr.back() < -6.0f);                        // and the reduction says so
    const auto v = live();
    EXPECT(v.at("inPeakL") > 0.45f && v.at("outPeakL") > 0.0f && v.at("outPeakL") < v.at("inPeakL"));
    EXPECT(v.at("inRmsL") > 0.3f && v.at("stereo") == 1.0);
    EXPECT(live().at("inPeakL") == 0.0);  // peaks are read once, so none are missed
}

void limiterView() {
    g_test = "limiter view data";
    Rig r("limiter");
    auto live = [&] {
        std::vector<std::pair<std::string, double>> v;
        r.m->liveValues(v);
        return std::map<std::string, double>(v.begin(), v.end());
    };
    auto array = [&](const std::string& name) {
        std::vector<std::pair<std::string, std::vector<float>>> a;
        r.m->liveArrays(a);
        for (auto& x : a)
            if (x.first == name) return x.second;
        return std::vector<float>();
    };
    r.patch("l", 0.0f);
    r.patch("r", 0.0f);
    const int l = r.m->spec().inputIndex("l"), rr = r.m->spec().inputIndex("r");
    for (int k = 0; k < 40; ++k) {
        for (int i = 0; i < kChunk; ++i) {
            const float x = 0.9f * std::sin(6.2831853f * 1000.0f * (float)(k * kChunk + i) / (float)kRate);
            r.inputs[(size_t)l][(size_t)i] = x;
            r.inputs[(size_t)rr][(size_t)i] = x;
        }
        r.run();
    }
    EXPECT(array("historyIn").empty());  // the limiter view is meters only: no history is sent
    const auto v = live();
    EXPECT(v.at("inPeakL") > 0.8f && v.at("outPeakL") > 0.0f && v.at("inRmsL") > 0.4f && v.at("stereo") == 1.0);
}

void monitor() {
    g_test = "monitor node";
    Rig r("monitor");
    auto live = [&] {
        std::vector<std::pair<std::string, double>> v;
        r.m->liveValues(v);
        return std::map<std::string, double>(v.begin(), v.end());
    };
    auto midi = [&] {
        std::vector<std::pair<std::string, std::vector<float>>> a;
        r.m->liveArrays(a);
        for (auto& x : a)
            if (x.first == "midi") return x.second;
        return std::vector<float>();
    };
    const int in = r.m->spec().inputIndex("notes");
    const int out = r.m->spec().outputIndex("notes");
    auto push = [&](uint8_t type, uint8_t ch, int32_t note, float value, int16_t offset = 0) {
        NoteEvent e;
        e.type = type;
        e.channel = ch;
        e.note = note;
        e.value = value;
        e.offset = offset;
        r.notes[(size_t)in].push(e);
    };

    // Unpatched: nothing logged, the view is told.
    r.run();
    EXPECT(live()["notesPatched"] == 0.0 && midi().size() == 1 && midi()[0] == 0.0f);

    // Events are logged in order, with their data in MIDI units, and pass through unchanged.
    r.connected[(size_t)in] = true;
    push(NoteEvent::On, 1, 64, 1.0f, 3);
    push(NoteEvent::On, 1, 67, 0.5f, 4);
    push(NoteEvent::Cc, 2, 74, 0.5f, 5);
    push(NoteEvent::Bend, 0, 0, -1.0f, 6);
    push(NoteEvent::Program, 9, 33, 0.0f, 7);
    push(NoteEvent::System, 0, 0xf8, 0.0f, 8);
    r.run();
    const NoteBuffer& passed = r.notesOutBuf[(size_t)out];
    EXPECT(passed.count == 6 && passed.events[0].note == 64 && passed.events[0].offset == 3 &&
           passed.events[2].type == NoteEvent::Cc && passed.events[5].note == 0xf8);
    auto m = midi();
    EXPECT(m.size() == 1 + 6 * 4 && m[0] == 6.0f);
    EXPECT(m[1] == 0 && m[2] == 1 && m[3] == 64 && m[4] == 127);        // note on, channel 2 (1-based), velocity 127
    EXPECT(m[5] == 0 && m[8] == 64);                                    // 0.5 → 64
    EXPECT(m[9] == 3 && m[10] == 2 && m[11] == 74 && m[12] == 64);      // CC 74 = 64 on channel 3
    EXPECT(m[13] == 5 && m[16] == -8192);                               // bend −1
    EXPECT(m[17] == 4 && m[19] == 33);                                  // program
    EXPECT(m[21] == 7 && m[23] == 0xf8);                                // clock
    auto v = live();
    EXPECT(v["notesPatched"] == 1.0);
    EXPECT(((uint32_t)v["held2"] >> 0 & 1u) == 1u && ((uint32_t)v["held2"] >> 3 & 1u) == 1u);  // notes 64 and 67 held
    EXPECT(r.notesOutBuf[(size_t)out].count == 6);

    // A note off ends the note; All Notes Off ends the rest.
    push(NoteEvent::Off, 1, 64, 0.0f);
    r.run();
    EXPECT(((uint32_t)live()["held2"] >> 0 & 1u) == 0u && ((uint32_t)live()["held2"] >> 3 & 1u) == 1u);
    push(NoteEvent::Cc, 0, 123, 0.0f);
    r.run();
    EXPECT((uint32_t)live()["held2"] == 0u);
    EXPECT(midi()[0] == 8.0f);

    // Unknown event types are passed on but not logged.
    push(200, 0, 1, 1.0f);
    r.run();
    EXPECT(midi()[0] == 8.0f && r.notesOutBuf[(size_t)out].count == 1);

    // Audio: peak, stereo, pass-through.
    r.patch("l", 0.5f);
    r.inputs[(size_t)r.m->spec().inputIndex("l")][3] = -0.8f;
    r.run();
    v = live();
    EXPECT(v["audioPatched"] == 1.0 && v["stereo"] == 0.0);
    EXPECT_NEAR(v["peakL"], 0.8, 1e-6);
    EXPECT(r.out("l") == 0.5f && r.out("l", 3) == -0.8f && r.out("r") == 0.5f);

    // CV: value, and the range since the last read (a short spike is not lost).
    r.patch("cv", 0.25f);
    r.inputs[(size_t)r.m->spec().inputIndex("cv")][5] = 0.9f;
    r.inputs[(size_t)r.m->spec().inputIndex("cv")][6] = -0.4f;
    r.run();
    v = live();
    EXPECT(v["cvPatched"] == 1.0);
    EXPECT_NEAR(v["cv"], 0.25, 1e-6);
    EXPECT_NEAR(v["cvHi"], 0.9, 1e-6);
    EXPECT_NEAR(v["cvLo"], -0.4, 1e-6);
    EXPECT(r.out("cv", 5) == 0.9f);
    r.run();
    v = live();
    EXPECT_NEAR(v["cvHi"], 0.9, 1e-6);  // the second chunk repeats the spike
    r.patch("cv", 0.1f);
    r.run();
    live();
    v = live();
    EXPECT_NEAR(v["cvHi"], 0.1, 1e-6);
    EXPECT_NEAR(v["cvLo"], 0.1, 1e-6);

    // Gate: a one-sample trigger lights the lamp once and counts.
    r.patch("gate", 0.0f);
    r.inputs[(size_t)r.m->spec().inputIndex("gate")][10] = 1.0f;
    r.run();
    v = live();
    EXPECT(v["gatePatched"] == 1.0 && v["gate"] == 0.0 && v["gateAny"] == 1.0 && v["gateCount"] == 1.0);
    EXPECT(r.out("gate", 10) == 1.0f && r.out("gate", 11) == 0.0f);
    r.inputs[(size_t)r.m->spec().inputIndex("gate")][10] = 0.0f;
    r.run();
    EXPECT(live()["gateAny"] == 0.0);
    r.patch("gate", 1.0f);
    r.run();
    v = live();
    EXPECT(v["gate"] == 1.0 && v["gateCount"] == 2.0);
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

NoteEvent systemEvent(int status, int offset = 0) {
    NoteEvent e;
    e.type = NoteEvent::System;
    e.note = status;
    e.offset = (int16_t)offset;
    return e;
}

void midiOutRealtime() {
    g_test = "midi out realtime";
    Rig r("midi-out");
    auto frame = std::make_unique<PortFrame>();
    PortIO io;
    io.out = frame.get();
    r.port = &io;
    NoteBuffer& in = r.notes[(size_t)r.m->spec().inputIndex("notes")];
    in.push(systemEvent(0xf8, 3));
    NoteEvent cc;
    cc.type = NoteEvent::Cc;
    cc.note = 74;
    cc.value = 0.5f;
    cc.offset = 4;
    in.push(cc);  // not expressed: used to go out as key pressure
    NoteEvent on;
    on.type = NoteEvent::On;
    on.note = 60;
    on.value = 1.0f;
    on.offset = 5;
    in.push(on);
    r.run();
    EXPECT(frame->numMidi == 2);
    if (frame->numMidi == 2) {
        EXPECT(frame->midi[0].size == 1 && frame->midi[0].bytes[0] == 0xf8 && frame->midi[0].offset == 3);
        EXPECT(frame->midi[1].size == 3 && (frame->midi[1].bytes[0] & 0xf0) == 0x90 && frame->midi[1].offset == 5);
    }
}

void transportNode() {
    g_test = "transport node";
    HostControl& hc = hostControl();
    auto drain = [&] { hc.takeTempo(); hc.takePlay(); hc.takeLink(); hc.takeStartStopSync(); };
    drain();
    Rig r("transport");
    r.transport.ppqValid = true;
    const int notesIn = r.m->spec().inputIndex("notes");
    NoteBuffer& outNotes = r.notesOutBuf[(size_t)r.m->spec().outputIndex("notes")];

    // Loading: Link and its start/stop are sent, the tempo is not.
    r.run();
    EXPECT(hc.takeLink() == 1 && hc.takeStartStopSync() == 1);
    EXPECT(hc.takeTempo() == 0.0);
    r.run();
    EXPECT(hc.takeLink() == HostControl::kNone);
    // Changing knobs and settings.
    r.set("tempo", 90.0f);
    r.set("link", 0.0f);
    r.run();
    EXPECT_NEAR(hc.takeTempo(), 90.0, 0.01);
    EXPECT(hc.takeLink() == 0);
    // Play and Stop triggers (rising edges), and the buttons.
    r.patch("play", 1.0f);
    r.run(2);
    EXPECT(hc.takePlay() == HostControl::Start);
    r.run();
    EXPECT(hc.takePlay() == HostControl::kNone);  // held high: no new edge
    r.unpatch("play");
    r.patch("stop", 1.0f);
    r.run();
    EXPECT(hc.takePlay() == HostControl::Stop);
    r.unpatch("stop");
    r.transport.playing = false;
    r.m->command("play", 1.0f);
    r.run();
    EXPECT(hc.takePlay() == HostControl::Start);
    r.transport.playing = true;
    r.m->command("play", 1.0f);  // already running: nothing
    r.run();
    EXPECT(hc.takePlay() == HostControl::kNone);
    r.m->command("stop", 1.0f);
    r.run();
    EXPECT(hc.takePlay() == HostControl::Stop);
    // Outputs read the host's transport.
    r.transport.bpm = 130.0;
    r.run();
    EXPECT_NEAR(r.out("tempo"), 1.3, 1e-5);
    EXPECT_NEAR(r.out("playing"), 1.0, 1e-6);

    // MIDI clock out: Start with the first block, then 24 pulses per beat (1000 samples at 120 BPM).
    r.transport.bpm = 120.0;
    r.transport.ppq = 0.0;
    r.set("midiout", 1.0f);
    int starts = 0, clocks = 0;
    const int chunks = 100;  // 3200 samples
    for (int k = 0; k < chunks; ++k) {
        r.run();
        for (int i = 0; i < outNotes.count; ++i) {
            if (outNotes.events[i].type != NoteEvent::System) continue;
            starts += outNotes.events[i].note == 0xfa;
            clocks += outNotes.events[i].note == 0xf8;
            if (k == 0 && i == 0) EXPECT(outNotes.events[i].note == 0xfa);
        }
    }
    EXPECT(starts == 1);
    EXPECT(clocks == 4);  // positions 0, 1000, 2000, 3000
    r.transport.playing = false;
    r.run();
    EXPECT(outNotes.count == 1 && outNotes.events[0].note == 0xfc);
    r.set("midiout", 0.0f);
    r.transport.playing = true;
    r.run(3);
    EXPECT(outNotes.count == 0);
    r.transport.playing = false;

    // MIDI clock in: start, stop and the tempo of a 120 BPM clock.
    drain();
    r.set("midiin", 1.0f);
    r.patch("notes", 0.0f);
    r.notes[(size_t)notesIn].push(systemEvent(0xfa));
    r.run();
    EXPECT(hc.takePlay() == HostControl::Start);
    r.notes[(size_t)notesIn].push(systemEvent(0xfb));
    r.run();
    EXPECT(hc.takePlay() == HostControl::Continue);
    r.notes[(size_t)notesIn].push(systemEvent(0xfc));
    r.run();
    EXPECT(hc.takePlay() == HostControl::Stop);
    drain();
    int pulse = 0;
    for (int k = 0; k < 1500; ++k) {  // 60 pulses
        for (; pulse * 1000 < (k + 1) * kChunk; ++pulse) r.notes[(size_t)notesIn].push(systemEvent(0xf8, pulse * 1000 - k * kChunk));
        r.run();
    }
    EXPECT_NEAR(hc.takeTempo(), 120.0, 0.3);
    // Off: the same events do nothing.
    r.set("midiin", 0.0f);
    r.notes[(size_t)notesIn].push(systemEvent(0xfa));
    r.run();
    EXPECT(hc.takePlay() == HostControl::kNone);
    // Tap.
    drain();
    r.m->command("tap", 1.0f);
    r.run();
    for (int k = 0; k < 24000 / kChunk - 1; ++k) r.run();
    r.m->command("tap", 1.0f);
    r.run();
    const double tapped = hc.takeTempo();
    EXPECT(tapped > 100.0 && tapped < 130.0);  // half a second apart, to within a block
}

void delayNode() {
    g_test = "delay node";
    Rig r("delay");
    r.set("mix", 1.0f);
    r.set("feedback", 0.0f);
    r.set("timel", 10.0f);
    r.set("timer", 10.0f);
    r.patch("l", 0.5f);  // R unpatched: follows L
    r.run(1);
    EXPECT_NEAR(r.out("l"), 0.0, 1e-6);  // nothing back yet
    r.run(60);
    EXPECT_NEAR(r.out("l"), 0.5, 1e-4);
    EXPECT_NEAR(r.out("r"), 0.5, 1e-4);
}

}  // namespace

int main() {
    specs();
    attenuverter();
    cvMixer();
    multiplier();
    mathNode();
    cvToGateNode();
    crossfader();
    logic();
    quantizer();
    switchNode();
    notesToCv();
    midiInEvents();
    monitor();
    compressorView();
    limiterView();
    audioMixer();
    levelMeter();
    midiOutRealtime();
    transportNode();
    delayNode();
    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all utility module tests passed\n");
    return 0;
}
