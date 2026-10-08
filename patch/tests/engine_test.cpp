// SPDX-License-Identifier: MIT
//
// Engine tests: board documents, the compiler (cells, feedback), block
// claiming and port latency, persistence and undo. Plugins are simulated by
// calling IEngine directly, including from several threads per host block.
#include "Board.h"
#include "Engine.h"
#include "Registry.h"

#include <array>
#include <cmath>
#include <functional>
#include <condition_variable>
#include <cstdio>
#include <random>
#include <set>
#include <mutex>
#include <thread>

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

constexpr int kBlock = 128;
constexpr double kRate = 48000.0;

juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> props) {
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}

juce::var cable(const juce::String& fn, const juce::String& fj, const juce::String& tn, const juce::String& tj,
                double amount = 1.0) {
    return obj({{"from", obj({{"node", fn}, {"jack", fj}})}, {"to", obj({{"node", tn}, {"jack", tj}})},
                {"amount", amount}});
}

juce::var node(const juce::String& id, const juce::String& type, const juce::String& parent = {}) {
    return obj({{"id", id}, {"type", type}, {"parent", parent}});
}

juce::var doc(juce::Array<juce::var> nodes, juce::Array<juce::var> cables) {
    return obj({{"format", 1}, {"id", "test"}, {"nodes", nodes}, {"cables", cables}});
}

/// juce::var shares objects on copy; the engine's board must not be edited in place.
juce::var copyOf(const juce::var& v) { return board::fromJson(board::toJson(v)); }

juce::String portNode(Engine& e, int handle) {
    char id[40];
    e.instanceId(handle, id, sizeof id);
    auto* n = board::findNodeByPort(e.board(), id);
    return n ? n->getProperty("id").toString() : juce::String();
}

/// std::barrier needs macOS 11; the plugins target 10.15.
class Barrier {
public:
    explicit Barrier(int n) : n_(n) {}
    void arrive_and_wait() {
        std::unique_lock<std::mutex> lock(m_);
        const int gen = gen_;
        if (++count_ == n_) {
            count_ = 0;
            ++gen_;
            cv_.notify_all();
        } else {
            cv_.wait(lock, [&] { return gen != gen_; });
        }
    }

private:
    std::mutex m_;
    std::condition_variable cv_;
    int n_, count_ = 0, gen_ = 0;
};

/// A simulated plugin: owns its buffers and calls Engine::process.
struct FakePort {
    Engine& engine;
    int handle;
    std::vector<float> in[2], out[2];
    std::vector<MidiEvent> midiIn, midiOut;
    FakePort(Engine& e, int h) : engine(e), handle(h) {
        for (auto& b : in) b.assign(kBlock, 0.0f);
        for (auto& b : out) b.assign(kBlock, 0.0f);
        midiOut.resize(kMaxMidiEvents);
        engine.prepare(handle, kRate, kBlock);
    }
    BlockIO run(int64_t samplePos) {
        const float* ins[2] = {in[0].data(), in[1].data()};
        float* outs[2] = {out[0].data(), out[1].data()};
        BlockIO io;
        io.numSamples = kBlock;
        io.transport.sampleRate = kRate;
        io.transport.samplePos = samplePos;
        io.audioIn = ins;
        io.numAudioIn = 2;
        io.audioOut = outs;
        io.numAudioOut = 2;
        io.midiIn = midiIn.data();
        io.numMidiIn = (int)midiIn.size();
        io.midiOut = midiOut.data();
        io.midiOutCapacity = (int)midiOut.size();
        engine.process(handle, io);
        midiIn.clear();
        return io;
    }
};

// ---------------------------------------------------------------------------------

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
    EXPECT(model.node("x") == nullptr);
    EXPECT(model.node("p") != nullptr && model.node("p")->parent.empty());  // ports live on the top level
    int cellIns = 0, cellOuts = 0;
    for (const auto& n : model.nodes) {
        cellIns += n.type == kCellIn && n.parent == "c";
        cellOuts += n.type == kCellOut && n.parent == "c";
    }
    EXPECT(cellIns == 1 && cellOuts == 1);
    EXPECT(model.cables.size() == 1);  // unknown jack, unknown node, cell border and duplicate dropped
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

    // Running it: the modulated cutoff goes down by half the range.
    Transport t;
    t.sampleRate = kRate;
    program->run(t, 256, false);
    auto& fm = *modules["f"];
    const float knob = fm.knob(0), eff = fm.paramDisplay(0).value.load();
    EXPECT(fm.paramDisplay(0).active.load());
    EXPECT_NEAR(eff, std::max(0.0f, knob - 0.5f), 1e-4);
}

/// Bleep Patch + Audio In + Audio Out: an impulse arrives exactly two blocks later.
void latencyAndClaiming() {
    g_test = "latency";
    auto* e = new Engine();
    const int main = e->registerInstance(PortKind::Patch);
    const int ain = e->registerInstance(PortKind::AudioIn);
    const int aout = e->registerInstance(PortKind::AudioOut);
    e->reconcileNow();
    const auto inNode = portNode(*e, ain), outNode = portNode(*e, aout);
    EXPECT(inNode.isNotEmpty() && outNode.isNotEmpty());
    EXPECT(portNode(*e, main).isNotEmpty());  // the Macros node
    auto edited = copyOf(e->board());
    edited["cables"].getArray()->add(cable(inNode, "l", outNode, "l"));
    edited["cables"].getArray()->add(cable(inNode, "r", outNode, "r"));
    e->commit(edited, "patch");
    EXPECT(e->board()["cables"].getArray()->size() == 2);

    FakePort pMain(*e, main), pIn(*e, ain), pOut(*e, aout);
    EXPECT(e->latencySamples() == 2 * kBlock);
    std::mt19937 rng(3);
    int arrivedAt = -1, arrivedSample = -1;
    for (int b = 0; b < 12; ++b) {
        for (auto& ch : pIn.in) std::fill(ch.begin(), ch.end(), 0.0f);
        if (b == 1) pIn.in[0][5] = pIn.in[1][5] = 1.0f;
        std::vector<FakePort*> order{&pMain, &pIn, &pOut};
        std::shuffle(order.begin(), order.end(), rng);  // Live's order is not guaranteed
        for (auto* p : order) p->run((int64_t)b * kBlock);
        for (int i = 0; i < kBlock; ++i)
            if (pOut.out[0][(size_t)i] > 0.5f && arrivedAt < 0) {
                arrivedAt = b;
                arrivedSample = i;
            }
    }
    EXPECT(arrivedAt == 3 && arrivedSample == 5);
    EXPECT(e->ticks() == 11);  // one tick per host block after the first
    e->unregisterInstance(main);
    e->unregisterInstance(ain);
    e->unregisterInstance(aout);
    e->collectGarbage();
    e->release();
}

/// The same with every plugin on its own thread, like Live's parallel tracks.
void parallelThreads() {
    g_test = "threads";
    auto* e = new Engine();
    const int main = e->registerInstance(PortKind::Patch);
    const int ain = e->registerInstance(PortKind::AudioIn);
    const int aout = e->registerInstance(PortKind::AudioOut);
    const int mout = e->registerInstance(PortKind::MidiOut);
    e->reconcileNow();
    auto edited = copyOf(e->board());
    edited["cables"].getArray()->add(cable(portNode(*e, ain), "l", portNode(*e, aout), "l"));
    e->commit(edited, "patch");
    FakePort ports[] = {{*e, main}, {*e, ain}, {*e, aout}, {*e, mout}};

    constexpr int kBlocks = 400;
    Barrier sync(4);
    std::vector<float> received(kBlocks * kBlock, 0.0f);
    std::vector<std::thread> threads;
    for (int t = 0; t < 4; ++t)
        threads.emplace_back([&, t] {
            std::mt19937 rng((unsigned)t);
            for (int b = 0; b < kBlocks; ++b) {
                FakePort& p = ports[t];
                if (t == 1)
                    for (int i = 0; i < kBlock; ++i) p.in[0][(size_t)i] = (float)(b * kBlock + i);  // a ramp: sample index
                std::this_thread::sleep_for(std::chrono::microseconds(rng() % 50));
                p.run((int64_t)b * kBlock);
                if (t == 2) std::copy(p.out[0].begin(), p.out[0].end(), received.begin() + b * kBlock);
                sync.arrive_and_wait();
            }
        });
    for (auto& th : threads) th.join();
    int wrong = 0;
    for (int i = 2 * kBlock; i < kBlocks * kBlock; ++i)
        if (std::abs(received[(size_t)i] - (float)(i - 2 * kBlock)) > 0.0f) ++wrong;
    EXPECT(wrong == 0);
    EXPECT(e->ticks() == kBlocks - 1);
    for (int h : {main, ain, aout, mout}) e->unregisterInstance(h);
    e->collectGarbage();
    e->release();
}

/// MIDI In → MIDI Out: notes keep their position, two blocks later.
void midiThrough() {
    g_test = "midi";
    auto* e = new Engine();
    const int main = e->registerInstance(PortKind::Patch);
    const int min = e->registerInstance(PortKind::MidiIn);
    const int mout = e->registerInstance(PortKind::MidiOut);
    e->reconcileNow();
    auto edited = copyOf(e->board());
    edited["cables"].getArray()->add(cable(portNode(*e, min), "notes", portNode(*e, mout), "notes"));
    e->commit(edited, "patch");
    FakePort pMain(*e, main), pIn(*e, min), pOut(*e, mout);
    int found = 0;
    for (int b = 0; b < 6; ++b) {
        if (b == 1) {
            MidiEvent on;
            on.offset = 70;
            on.bytes[0] = 0x90;
            on.bytes[1] = 64;
            on.bytes[2] = 100;
            on.size = 3;
            pIn.midiIn.push_back(on);
        }
        pMain.run(b * kBlock);
        pIn.run(b * kBlock);
        const auto io = pOut.run(b * kBlock);
        for (int i = 0; i < io.numMidiOut; ++i) {
            const auto& m = pOut.midiOut[(size_t)i];
            if ((m.bytes[0] & 0xf0) == 0x90) {
                EXPECT(b == 3);
                EXPECT(m.offset == 70);
                EXPECT(m.bytes[1] == 64 && m.bytes[2] == 100);
                ++found;
            }
        }
    }
    EXPECT(found == 1);
    for (int h : {main, min, mout}) e->unregisterInstance(h);
    e->release();
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

    // A second Bleep Patch is inactive and keeps its own copy.
    const int second = e->registerInstance(PortKind::Patch);
    EXPECT(e->state(second) == PortState::InactiveMain);
    EXPECT(e->state(main) == PortState::Ok);
    // Deleting the main removes the board; the other Bleep Patch takes over.
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
/// the engine, no Macros node, and the Link node follows the transport.
void standaloneDriver() {
    g_test = "standalone";
    auto* e = new Engine();
    e->setStandalone(true);
    const int main = e->registerInstance(PortKind::Patch);
    const int ain = e->registerInstance(PortKind::AudioIn);
    const int aout = e->registerInstance(PortKind::AudioOut);
    const int link = e->registerInstance(PortKind::Link);
    e->reconcileNow();
    int macros = 0;
    for (const auto& n : *e->board()["nodes"].getArray()) macros += n["type"].toString() == "macros";
    EXPECT(macros == 0);
    auto edited = copyOf(e->board());
    edited["cables"].getArray()->add(cable(portNode(*e, ain), "l", portNode(*e, aout), "l"));
    edited["cables"].getArray()->add(cable(portNode(*e, link), "beattrig", portNode(*e, aout), "r"));
    e->commit(edited, "patch");

    FakePort pIn(*e, ain), pOut(*e, aout), pLink(*e, link);
    int sameBlock = 0, beats = 0;
    for (int b = 0; b < 200; ++b) {
        for (int i = 0; i < kBlock; ++i) pIn.in[0][(size_t)i] = (float)(b * kBlock + i + 1);
        BlockIO ios[3];
        FakePort* ports[3] = {&pIn, &pOut, &pLink};
        const float* ins[3][2];
        float* outs[3][2];
        int handles[3] = {ain, aout, link};
        BlockIO* ptrs[3];
        for (int k = 0; k < 3; ++k) {
            ins[k][0] = ports[k]->in[0].data();
            ins[k][1] = ports[k]->in[1].data();
            outs[k][0] = ports[k]->out[0].data();
            outs[k][1] = ports[k]->out[1].data();
            ios[k].numSamples = kBlock;
            ios[k].transport.sampleRate = kRate;
            ios[k].transport.bpm = 120.0;  // one beat = 24000 samples
            ios[k].transport.playing = true;
            ios[k].transport.ppqValid = true;
            ios[k].transport.ppq = (double)(b * kBlock) / 24000.0;
            ios[k].audioIn = ins[k];
            ios[k].numAudioIn = 2;
            ios[k].audioOut = outs[k];
            ios[k].numAudioOut = 2;
            ptrs[k] = &ios[k];
        }
        e->processAll(handles, ptrs, 3);
        if (std::abs(pOut.out[0][5] - (float)(b * kBlock + 6)) < 0.5f) ++sameBlock;
        for (int i = 0; i < kBlock; ++i) beats += pOut.out[1][(size_t)i] > 0.5f ? 1 : 0;
    }
    EXPECT(sameBlock >= 199);  // every block but the very first (program warm-up)
    EXPECT(beats == 1);        // 200 × 128 samples = 1.07 beats at 120 BPM
    for (int h : {main, ain, aout, link}) e->unregisterInstance(h);
    e->release();
}

/// Voice Cells (spec §8.3): MIDI notes into a Voice Cell whose voice outputs
/// its pitch as audio, so the cell's output is the sum of the playing pitches.
struct VoiceRig {
    Engine* e = new Engine();
    int main = 0, midi = 0, out = 0;
    juce::String cellId = "vc", voiceIn = "vi", voiceOut = "vo";
    FakePort *pMidi = nullptr, *pOut = nullptr;

    VoiceRig() {
        e->setStandalone(true);
        main = e->registerInstance(PortKind::Patch);
        midi = e->registerInstance(PortKind::MidiIn);
        out = e->registerInstance(PortKind::AudioOut);
        e->reconcileNow();
        pMidi = new FakePort(*e, midi);
        pOut = new FakePort(*e, out);
    }
    ~VoiceRig() {
        delete pMidi;
        delete pOut;
        e->unregisterInstance(midi);
        e->unregisterInstance(out);
        e->unregisterInstance(main);
        e->release();
    }
    /// A Voice Cell; `inside` adds nodes and cables inside it.
    void build(juce::var params, std::function<void(juce::Array<juce::var>&, juce::Array<juce::var>&)> inside) {
        auto doc = copyOf(e->board());
        auto* nodes = doc["nodes"].getArray();
        auto* cables = doc["cables"].getArray();
        auto cell = node(cellId, "voice-cell");
        cell.getDynamicObject()->setProperty("params", params);
        nodes->add(cell);
        nodes->add(node(voiceIn, "voice-in", cellId));
        nodes->add(node(voiceOut, "voice-out", cellId));
        juce::Array<juce::var> n, c;
        inside(n, c);
        nodes->addArray(n);
        cables->addArray(c);
        cables->add(cable(portNode(*e, midi), "notes", cellId, "notes"));
        cables->add(cable(cellId, "l", portNode(*e, out), "l"));
        e->commit(doc, "voice cell");
    }
    /// One block in standalone mode; returns the last output sample.
    float block(std::vector<std::array<int, 3>> events = {}) {
        std::vector<std::array<int, 4>> at;
        for (const auto& ev : events) at.push_back({ev[0], ev[1], ev[2], 0});
        return blockAt(at);
    }
    /// The same, with each event at its own sample offset {status, d1, d2, offset}.
    float blockAt(const std::vector<std::array<int, 4>>& events) {
        for (const auto& ev : events) {
            MidiEvent m;
            m.offset = ev[3];
            m.bytes[0] = (uint8_t)ev[0];
            m.bytes[1] = (uint8_t)ev[1];
            m.bytes[2] = (uint8_t)ev[2];
            m.size = 3;
            pMidi->midiIn.push_back(m);
        }
        BlockIO a, b;
        const float* ins[2] = {pMidi->in[0].data(), pMidi->in[1].data()};
        float* outs[2] = {pOut->out[0].data(), pOut->out[1].data()};
        for (BlockIO* io : {&a, &b}) {
            io->numSamples = kBlock;
            io->transport.sampleRate = kRate;
        }
        a.audioIn = ins;
        a.midiIn = pMidi->midiIn.data();
        a.numMidiIn = (int)pMidi->midiIn.size();
        b.audioOut = outs;
        b.numAudioOut = 2;
        int handles[2] = {midi, out};
        BlockIO* ios[2] = {&a, &b};
        e->processAll(handles, ios, 2);
        pMidi->midiIn.clear();
        return pOut->out[0][kBlock - 1];
    }
};

juce::var voiceParams(int voices, int stealing, int mode) {
    const auto* spec = Registry::get().find("voice-cell");
    auto norm = [&](const char* id, float v) { return spec->params[(size_t)spec->paramIndex(id)].toNormalised(v); };
    return obj({{"voices", norm("voices", (float)voices)}, {"stealing", norm("stealing", (float)stealing)},
                {"mode", norm("mode", (float)mode)}, {"output", norm("output", 0.0f)}});  // output: plain sum
}

void voiceCells() {
    g_test = "voice cell";
    auto pitchVoice = [](juce::Array<juce::var>&, juce::Array<juce::var>& c) {
        c.add(cable("vi", "pitch", "vo", "l"));  // the voice's audio = its pitch
    };
    {
        VoiceRig rig;
        rig.build(voiceParams(2, 0, 0), pitchVoice);  // 2 voices, steal oldest
        rig.block({{0x90, 64, 100}, {0x90, 67, 100}});
        EXPECT_NEAR(rig.block(), 4.0 / 12 + 7.0 / 12, 1e-5);
        rig.block({{0x90, 72, 100}});  // a third note steals E (the oldest)
        EXPECT_NEAR(rig.block(), 7.0 / 12 + 12.0 / 12, 1e-5);
        // A board edit doesn't cut the notes (voices survive recompiles).
        auto moved = copyOf(rig.e->board());
        for (auto& n : *moved["nodes"].getArray())
            if (n["id"].toString() == "vc") n.getDynamicObject()->setProperty("x", 333);
        rig.e->commit(moved, "move");
        EXPECT_NEAR(rig.block(), 7.0 / 12 + 12.0 / 12, 1e-5);
        // The engine shows which voices play.
        const auto live = rig.e->liveState({});
        EXPECT((int)live["nodes"]["vc"]["voices"] == 3);
    }
    {
        VoiceRig rig;
        rig.build(voiceParams(2, 4, 0), pitchVoice);  // 2 voices, stealing: none
        rig.block({{0x90, 64, 100}, {0x90, 67, 100}, {0x90, 72, 100}});
        EXPECT_NEAR(rig.block(), 4.0 / 12 + 7.0 / 12, 1e-5);  // the third note is dropped
    }
    {
        VoiceRig rig;
        rig.build(voiceParams(8, 0, 1), pitchVoice);  // mono
        rig.block({{0x90, 60, 100}, {0x90, 64, 100}});
        EXPECT_NEAR(rig.block(), 4.0 / 12, 1e-5);
        rig.block({{0x80, 64, 0}});  // back to the held C
        EXPECT_NEAR(rig.block(), 0.0, 1e-5);
    }
    {
        // A real voice: Oscillator → VCA, ADSR on the gain and on Active. It sounds, then sleeps.
        VoiceRig rig;
        rig.build(voiceParams(8, 0, 0), [](juce::Array<juce::var>& n, juce::Array<juce::var>& c) {
            n.add(node("osc", "oscillator", "vc"));
            n.add(node("env", "adsr", "vc"));
            n.add(node("amp", "vca", "vc"));
            c.add(cable("vi", "pitch", "osc", "pitch"));
            c.add(cable("vi", "gate", "env", "gate"));
            c.add(cable("vi", "trigger", "env", "retrig"));
            c.add(cable("osc", "sine", "amp", "l"));
            c.add(cable("env", "env", "amp", "gain"));
            c.add(cable("amp", "l", "vo", "l"));
            c.add(cable("env", "active", "vo", "active"));
        });
        rig.block({{0x90, 69, 127}});
        float peak = 0.0f;
        for (int b = 0; b < 40; ++b) {
            rig.block();
            for (float x : rig.pOut->out[0]) peak = std::max(peak, std::fabs(x));
        }
        EXPECT(peak > 0.1f);
        EXPECT((int)rig.e->liveState({})["nodes"]["vc"]["voices"] == 1);
        rig.block({{0x80, 69, 0}});
        for (int b = 0; b < 2000; ++b) rig.block();  // ≈ 5 s: the release (0.4 s) is long over
        float tail = 0.0f;
        for (float x : rig.pOut->out[0]) tail = std::max(tail, std::fabs(x));
        EXPECT(tail < 1e-4f);
        EXPECT((int)rig.e->liveState({})["nodes"]["vc"]["voices"] == 0);  // asleep
    }
    {
        // Hammering: random chords, quick taps and stealing; when every key is up,
        // every voice must fall silent and sleep. No voice may hang.
        VoiceRig rig;
        rig.build(voiceParams(4, 0, 0), [](juce::Array<juce::var>& n, juce::Array<juce::var>& c) {
            n.add(node("osc", "oscillator", "vc"));
            n.add(node("env", "adsr", "vc"));
            n.add(node("amp", "vca", "vc"));
            c.add(cable("vi", "pitch", "osc", "pitch"));
            c.add(cable("vi", "gate", "env", "gate"));
            c.add(cable("vi", "trigger", "env", "retrig"));
            c.add(cable("osc", "sine", "amp", "l"));
            c.add(cable("env", "env", "amp", "gain"));
            c.add(cable("amp", "l", "vo", "l"));
            c.add(cable("env", "active", "vo", "active"));
        });
        std::mt19937 rng(11);
        std::set<int> held;
        for (int b = 0; b < 3000; ++b) {
            std::vector<std::array<int, 4>> ev;
            const int count = (int)(rng() % 4);
            int offset = 0;
            for (int k = 0; k < count; ++k) {
                offset = std::min(kBlock - 1, offset + (int)(rng() % 40));
                const int note = 48 + (int)(rng() % 24);
                if (held.count(note) || rng() % 3 == 0) {
                    if (held.count(note)) {
                        // Both note-off forms: 0x80 (any velocity) and 0x90 with velocity 0.
                        if (rng() % 2) ev.push_back({0x80, note, (int)(rng() % 128), offset});
                        else ev.push_back({0x90, note, 0, offset});
                        held.erase(note);
                    }
                } else {
                    ev.push_back({0x90, note, 1 + (int)(rng() % 127), offset});
                    held.insert(note);
                    if (rng() % 5 == 0) {  // a quick tap: released in the same block
                        ev.push_back({0x80, note, 0, std::min(kBlock - 1, offset + 1)});
                        held.erase(note);
                    }
                }
            }
            rig.blockAt(ev);
        }
        std::vector<std::array<int, 4>> off;
        for (int note : held) off.push_back({0x80, note, 0, 0});
        rig.blockAt(off);
        for (int b = 0; b < 2000; ++b) rig.block();
        float tail = 0.0f;
        for (float x : rig.pOut->out[0]) tail = std::max(tail, std::fabs(x));
        EXPECT(tail < 1e-4f);
        EXPECT((int)rig.e->liveState({})["nodes"]["vc"]["voices"] == 0);
    }
}

/// Step Sequencer (specs/modules/step-sequencer.md): node data, live step
/// edits, and notes into a Voice Cell.
void stepSequencer() {
    g_test = "step sequencer";
    {  // Data is filled in and clamped.
        auto withData = node("short", "step-sequencer");
        juce::Array<juce::var> steps{obj({{"g", 7}, {"p", 99}, {"v", 0}}), obj({{"g", 2}, {"p", -3}, {"v", 64}})};
        withData.getDynamicObject()->setProperty("data", obj({{"steps", steps}}));
        auto d = board::sanitise(doc({node("fresh", "step-sequencer"), withData, node("u", "utility")}, {}));
        auto fresh = board::findNode(d, "fresh")->getProperty("data");
        auto saved = board::findNode(d, "short")->getProperty("data");
        EXPECT(fresh["steps"].size() == 32 && (int)fresh["steps"][31]["g"] == 1 && (int)fresh["steps"][0]["v"] == 100);
        EXPECT(saved["steps"].size() == 32);
        EXPECT((int)saved["steps"][0]["g"] == 2 && (int)saved["steps"][0]["p"] == 36 && (int)saved["steps"][0]["v"] == 1);
        EXPECT((int)saved["steps"][1]["g"] == 2 && (int)saved["steps"][1]["p"] == -3);
        EXPECT((int)saved["steps"][2]["g"] == 0);  // short arrays are padded with Off
        EXPECT(std::fabs((double)saved["randomize"]["density"] - 0.6) < 1e-9 && !saved["randomize"].hasProperty("lanes"));
        EXPECT(!board::findNode(d, "u")->hasProperty("data"));
        EXPECT(board::parse(d).node("short")->data.find("\"steps\"") != std::string::npos);
    }

    auto* e = new Engine();
    e->setStandalone(true);
    const int main = e->registerInstance(PortKind::Patch);
    const int out = e->registerInstance(PortKind::AudioOut);
    e->reconcileNow();
    FakePort pOut(*e, out);
    juce::Array<juce::var> steps;
    for (int i = 0; i < 32; ++i) steps.add(obj({{"g", 2}, {"p", 7}, {"v", 100}}));  // one long tied G
    auto seq = node("seq", "step-sequencer");
    seq.getDynamicObject()->setProperty("data", obj({{"steps", steps}}));
    auto cell = node("vc", "voice-cell");
    cell.getDynamicObject()->setProperty("params", voiceParams(8, 0, 0));
    auto edited = copyOf(e->board());
    for (auto n : {seq, cell, node("vi", "voice-in", "vc"), node("vo", "voice-out", "vc")})
        edited["nodes"].getArray()->add(n);
    for (auto c : {cable("seq", "notes", "vc", "notes"), cable("vi", "pitch", "vo", "l"), cable("vi", "gate", "vo", "r"),
                   cable("vi", "gate", "vo", "active"), cable("vc", "l", portNode(*e, out), "l"), cable("vc", "r", portNode(*e, out), "r")})
        edited["cables"].getArray()->add(c);
    e->commit(edited, "sequencer");
    int64_t pos = 0;
    auto run = [&](int blocks, bool playing = true) {
        for (int b = 0; b < blocks; ++b, pos += kBlock) {
            BlockIO io;
            float* outs[2] = {pOut.out[0].data(), pOut.out[1].data()};
            io.numSamples = kBlock;
            io.transport.sampleRate = kRate;
            io.transport.bpm = 120.0;
            io.transport.playing = playing;
            io.transport.ppqValid = true;
            io.transport.ppq = (double)pos / 24000.0;
            io.audioOut = outs;
            io.numAudioOut = 2;
            int handles[1] = {out};
            BlockIO* ios[1] = {&io};
            e->processAll(handles, ios, 1);
        }
    };
    run(100);
    EXPECT_NEAR(pOut.out[0][kBlock - 1], 7.0 / 12.0, 1e-4);  // one voice playing G
    EXPECT_NEAR(pOut.out[1][kBlock - 1], 1.0, 1e-6);
    // A step edit takes effect without a commit; the doc follows.
    const auto undoBefore = e->canUndo();
    for (int i = 0; i < 32; ++i) steps.set(i, obj({{"g", 2}, {"p", 4}, {"v", 100}}));
    e->setData("seq", obj({{"steps", steps}}));
    EXPECT((int)board::findNode(e->board(), "seq")->getProperty("data")["steps"][5]["p"] == 4);
    EXPECT(e->canUndo() == undoBefore);
    run(100);
    EXPECT_NEAR(pOut.out[0][kBlock - 1], 4.0 / 12.0, 1e-4);  // legato to E: still one voice
    EXPECT_NEAR(pOut.out[1][kBlock - 1], 1.0, 1e-6);
    auto live = e->liveState({"seq"})["nodes"]["seq"];
    EXPECT(live.hasProperty("step") && (int)live["sounding"] == 1);
    // Deleting the sequencer releases the note it was holding.
    edited = copyOf(e->board());
    auto* nodes = edited["nodes"].getArray();
    for (int i = nodes->size(); --i >= 0;)
        if ((*nodes)[i]["id"].toString() == "seq") nodes->remove(i);
    e->commit(edited, "delete");
    run(20);
    EXPECT_NEAR(pOut.out[1][kBlock - 1], 0.0, 1e-6);
    e->unregisterInstance(out);
    e->unregisterInstance(main);
    e->release();
}

/// Drum nodes (specs/modules/ring-drums.md, punch-drums.md) and Noise, run
/// through their jacks: a trigger plays, Velocity scales, Level is last.
void drumNodes() {
    struct Rig {
        std::unique_ptr<Module> m;
        std::vector<std::vector<float>> params, inputs, outputs;
        std::vector<const float*> pp, ip;
        std::vector<float*> op;
        std::unique_ptr<bool[]> connected;
        Transport transport;

        explicit Rig(const std::string& type) : m(Registry::get().create(type)) {
            const auto& s = m->spec();
            params.assign(s.params.size(), std::vector<float>(kChunk));
            inputs.assign(s.inputs.size(), std::vector<float>(kChunk, 0.0f));
            outputs.assign(s.outputs.size(), std::vector<float>(kChunk, 0.0f));
            connected.reset(new bool[s.inputs.size() + 1]());
            for (size_t i = 0; i < s.params.size(); ++i) setParam((int)i, s.params[i].defaultNormalised());
            for (auto& v : params) pp.push_back(v.data());
            for (auto& v : inputs) ip.push_back(v.data());
            for (auto& v : outputs) op.push_back(v.data());
            m->prepare(kRate);
            m->reset();
        }
        void setParam(int i, float normalised) {
            m->setKnob(i, normalised);
            std::fill(params[(size_t)i].begin(), params[(size_t)i].end(), normalised);
        }
        /// Runs `seconds`; input `trig` gets a one-sample pulse at the start. Returns the peak of output 0.
        float run(double seconds, int trig = -1) {
            ProcessContext c;
            c.numSamples = kChunk;
            c.transport = &transport;
            c.params = pp.data();
            c.inputs = ip.data();
            c.inputConnected = connected.get();
            c.outputs = op.data();
            float peak = 0.0f;
            for (int n = 0; n < (int)(seconds * kRate / kChunk); ++n) {
                if (trig >= 0) inputs[(size_t)trig][3] = n == 0 ? 1.0f : 0.0f;
                m->process(c);
                for (float x : outputs[0]) {
                    EXPECT(std::isfinite(x));
                    peak = std::max(peak, std::fabs(x));
                }
            }
            return peak;
        }
    };

    int drums = 0;
    for (const auto* s : Registry::get().all()) {
        if (s->category != "Drums") continue;
        g_test = s->type.c_str();
        ++drums;
        const int level = (int)s->params.size() - 1;
        const int velocity = s->inputIndex("velocity");
        EXPECT(s->params[(size_t)level].id == "level");
        EXPECT(velocity == (int)s->inputs.size() - 1);
        EXPECT(s->outputs.size() == 1 && s->outputs[0].type == Signal::Audio);
        for (int t = 0; t < velocity; ++t) {
            Rig rig(s->type);
            EXPECT(rig.run(0.1) == 0.0f);           // silent until triggered
            const float loud = rig.run(0.5, t);
            EXPECT(loud > 0.2f && loud < 1.2f);
            rig.run(10.0);
            EXPECT(rig.run(0.1) < 1e-3f * loud);   // dies away
            // Velocity, sampled at the trigger.
            rig.connected[(size_t)velocity] = true;
            std::fill(rig.inputs[(size_t)velocity].begin(), rig.inputs[(size_t)velocity].end(), 0.25f);
            const float soft = rig.run(0.5, t);
            EXPECT(soft < 0.4f * loud && soft > 0.1f * loud);
            rig.run(10.0);
            // Level scales the output.
            rig.connected[(size_t)velocity] = false;
            rig.setParam(level, 0.0f);
            EXPECT(rig.run(0.5, t) == 0.0f);
        }
    }
    EXPECT(drums == 15);

    g_test = "noise node";
    Rig noise("noise");
    EXPECT(noise.run(0.1) > 0.1f);
    for (size_t o = 1; o < noise.outputs.size(); ++o) {
        float peak = 0.0f;
        for (float x : noise.outputs[o]) peak = std::max(peak, std::fabs(x));
        EXPECT(peak > 0.0f && peak < 2.0f);
    }
    noise.setParam(1, 0.0f);  // Level
    EXPECT(noise.run(0.1) == 0.0f);
    EXPECT(noise.outputs[1][0] != 0.0f);  // the fixed colours ignore Level
}

}  // namespace

int main() {
    juce::ScopedJuceInitialiser_GUI juce;
    specMapping();
    sanitising();
    compileCellsAndFeedback();
    latencyAndClaiming();
    parallelThreads();
    midiThrough();
    persistenceAndDuplicates();
    undoRedo();
    standaloneDriver();
    voiceCells();
    stepSequencer();
    drumNodes();
    std::printf(g_failures ? "%d failure(s)\n" : "engine tests passed\n", g_failures);
    return g_failures ? 1 : 0;
}
