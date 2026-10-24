// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Sampler node: recording its audio inputs (Record button, Rec gate, fixed length in beats, overdub) and the saved result,
// run through the Module API.
#include "Board.h"
#include "Engine.h"
#include "Media.h"
#include "Program.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace bleep::engine {
std::unique_ptr<BoardUi> createBoardUi(Engine&) { return nullptr; }  // no window in tests
}  // namespace bleep::engine

using namespace bleep::engine;

static int g_failures = 0;
#define EXPECT(cond)                                                              \
    do {                                                                          \
        if (!(cond)) {                                                            \
            std::printf("  %s:%d: EXPECT(%s)\n", __FILE__, __LINE__, #cond);    \
            ++g_failures;                                                         \
        }                                                                         \
    } while (0)

namespace {
constexpr double kRate = 48000.0;
constexpr double kPi = 3.14159265358979323846;

struct Rig {
    std::unique_ptr<Module> m;
    std::vector<std::vector<float>> params, inputs, outputs;
    std::vector<const float*> pp, ip;
    std::vector<float*> op;
    std::vector<NoteBuffer> notesIn, notesOut;
    std::vector<const NoteBuffer*> nip;
    std::vector<NoteBuffer*> nop;
    std::unique_ptr<bool[]> connected;
    Transport transport;
    double phase = 0.0;

    Rig() : m(Registry::get().create("sampler")) {
        const auto& s = m->spec();
        params.assign(s.params.size(), std::vector<float>(kChunk));
        inputs.assign(s.inputs.size(), std::vector<float>(kChunk, 0.0f));
        outputs.assign(s.outputs.size(), std::vector<float>(kChunk, 0.0f));
        notesIn.resize(s.inputs.size());
        notesOut.resize(s.outputs.size());
        connected.reset(new bool[s.inputs.size() + 1]());
        for (size_t i = 0; i < s.params.size(); ++i) set(s.params[i].id, s.params[i].def);
        for (auto& v : params) pp.push_back(v.data());
        for (size_t i = 0; i < s.inputs.size(); ++i) {
            const bool notes = s.inputs[i].type == Signal::Notes;
            ip.push_back(notes ? nullptr : inputs[i].data());
            nip.push_back(notes ? &notesIn[i] : nullptr);
        }
        for (size_t i = 0; i < s.outputs.size(); ++i) {
            op.push_back(outputs[i].data());
            nop.push_back(&notesOut[i]);
        }
        transport.sampleRate = kRate;
        transport.bpm = 120.0;
        m->prepare(kRate);
        m->setData(s.sanitiseData(""));
        m->reset();
    }
    void set(const std::string& id, float value) {
        const int i = m->spec().paramIndex(id);
        const float n = m->spec().params[(size_t)i].toNormalised(value);
        m->setKnob(i, n);
        std::fill(params[(size_t)i].begin(), params[(size_t)i].end(), n);
    }
    void noteOn() {
        const size_t i = (size_t)m->spec().inputIndex("notes");
        connected[i] = true;
        NoteEvent e;
        e.type = NoteEvent::On;
        e.note = 60;
        e.pitch = 0.0f;
        e.value = 1.0f;
        e.offset = 0;
        notesIn[i].count = 1;
        notesIn[i].events[0] = e;
        pendingNote = true;
    }
    bool pendingNote = false;
    void patch(const std::string& id) { connected[(size_t)m->spec().inputIndex(id)] = true; }
    /// Runs `samples` samples with a 440 Hz sine on In L (when patched), collecting Out L.
    std::vector<float> run(int samples, float gate = 0.0f) {
        std::vector<float> out;
        const int in = m->spec().inputIndex("inl"), rec = m->spec().inputIndex("rec");
        for (int done = 0; done < samples; done += kChunk) {
            for (int i = 0; i < kChunk; ++i) {
                inputs[(size_t)in][(size_t)i] = 0.5f * (float)std::sin(phase);
                phase += 2.0 * kPi * 440.0 / kRate;
                inputs[(size_t)rec][(size_t)i] = gate;
            }
            ProcessContext c;
            c.numSamples = kChunk;
            c.transport = &transport;
            c.params = pp.data();
            c.inputs = ip.data();
            c.inputConnected = connected.get();
            c.notesIn = nip.data();
            c.outputs = op.data();
            c.notesOut = nop.data();
            m->process(c);
            if (pendingNote) {
                pendingNote = false;
                notesIn[(size_t)m->spec().inputIndex("notes")].count = 0;
            }
            const auto& l = outputs[(size_t)m->spec().outputIndex("l")];
            out.insert(out.end(), l.begin(), l.end());
        }
        return out;
    }
};

float peak(const std::vector<float>& x, size_t from, size_t to) {
    float p = 0.0f;
    for (size_t i = from; i < to && i < x.size(); ++i) p = std::max(p, std::fabs(x[i]));
    return p;
}

void recordAndLoop() {
    Rig r;
    r.patch("inl");
    r.run(2000);
    r.m->command("record", 1);
    const auto rec = r.run(24000);  // half a second of sine, nothing out while recording
    EXPECT(peak(rec, 0, rec.size()) < 0.01f);
    r.m->command("record", 1);      // stop: the take loops at once
    const auto loop = r.run(48000);
    EXPECT(peak(loop, 4000, 48000) > 0.3f);
    std::vector<std::pair<std::string, double>> v;
    r.m->liveValues(v);
    double len = 0.0, state = -1.0;
    for (auto& [k, x] : v) {
        if (k == "length") len = x;
        if (k == "recState") state = x;
    }
    EXPECT(std::fabs(len - 24000.0) < 300.0);
    EXPECT(state == 0.0);
    std::string json;
    EXPECT(r.m->takeData(json));  // the take went to the media folder and the node data
    EXPECT(json.find(".wav") != std::string::npos);
    r.m->setData(r.m->spec().sanitiseData(json));
    const auto after = r.run(24000);
    EXPECT(peak(after, 2000, 24000) > 0.3f);  // still playing after the data came back
}

void beatsAndOverdub() {
    Rig r;
    r.patch("inl");
    r.set("reclen", 1.0f);
    r.set("beats", 2.0f);  // 2 beats at 120 BPM: one second
    r.m->command("record", 1);
    r.run(60000);
    std::vector<std::pair<std::string, double>> v;
    r.m->liveValues(v);
    double len = 0.0;
    for (auto& [k, x] : v)
        if (k == "length") len = x;
    EXPECT(std::fabs(len - 48000.0) < 50.0);
    r.set("recmode", 1.0f);
    r.set("recfeedback", 0.5f);
    r.m->command("record", 1);  // overdub
    const auto od = r.run(96000);
    r.m->command("record", 1);  // stop
    r.run(2000);
    EXPECT(peak(od, 50000, 96000) > 0.4f);
    std::string json;
    EXPECT(r.m->takeData(json));
}

/// Loads two clips one after the other through the node data: the second one plays.
void loadAnother() {
    auto make = [](double hz) {
        MediaClip c;
        c.sampleRate = kRate;
        std::vector<float> x(24000);
        for (size_t i = 0; i < x.size(); ++i) x[i] = 0.5f * (float)std::sin(2.0 * kPi * hz * (double)i / kRate);
        c.channels.push_back(x);
        return media::save(c);
    };
    const std::string a = make(440.0), b = make(880.0);
    EXPECT(!a.empty() && !b.empty() && a != b);
    Rig r;
    r.set("mode", 3.0f);  // loop
    auto data = [&](const std::string& id) { return r.m->spec().sanitiseData("{\"clip\":\"" + id + "\",\"length\":0,\"markers\":[],\"current\":0}"); };
    r.m->setData(data(a));
    r.noteOn();
    r.run(4000);
    const auto first = r.run(9600);
    r.m->setData(data(b));
    r.run(1000);
    r.noteOn();
    r.run(4000);
    const auto second = r.run(9600);
    auto zc = [](const std::vector<float>& x) { int n = 0; for (size_t i = 1; i < x.size(); ++i) n += x[i - 1] <= 0.0f && x[i] > 0.0f; return n; };
    std::printf("zc %d %d\n", zc(first), zc(second));
    EXPECT(zc(first) > 0 && zc(second) > zc(first) * 3 / 2);
    // Clear: nothing plays any more
    r.m->setData(data(""));
    r.run(1000);
    r.noteOn();
    const auto none = r.run(9600);
    EXPECT(peak(none, 0, none.size()) < 1e-4f);
    // A sample loaded while a recording is going on ends the recording and plays
    Rig q;
    q.patch("inl");
    q.set("mode", 3.0f);
    q.m->command("record", 1);
    q.run(5000);
    q.m->setData(data(a));
    q.run(1000);
    q.noteOn();
    const auto played = q.run(9600);
    EXPECT(zc(played) > 0);
    std::vector<std::pair<std::string, double>> v;
    q.m->liveValues(v);
    for (auto& [k, x] : v)
        if (k == "recState") EXPECT(x == 0.0);
}

void gateRecords() {
    Rig r;
    r.patch("inl");
    r.patch("rec");
    r.run(1000, 0.0f);
    r.run(12000, 1.0f);
    const auto loop = r.run(30000, 0.0f);
    EXPECT(peak(loop, 4000, 30000) > 0.3f);
}
}  // namespace

int main() {
    juce::File tmp = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("bleep-sampler-test");
    tmp.createDirectory();
    media::setFolder(tmp.getFullPathName().toStdString());
    recordAndLoop();
    beatsAndOverdub();
    gateRecords();
    loadAnother();
    tmp.deleteRecursively();
    std::printf("sampler module: %d failures\n", g_failures);
    return g_failures ? 1 : 0;
}
