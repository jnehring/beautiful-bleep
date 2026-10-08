// SPDX-License-Identifier: MIT
//
// Engine tests: board documents, the compiler (cells, feedback), block
// claiming and port latency, persistence and undo. Plugins are simulated by
// calling IEngine directly, including from several threads per host block.
#include "Board.h"
#include "Engine.h"

#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <random>
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
    std::printf(g_failures ? "%d failure(s)\n" : "engine tests passed\n", g_failures);
    return g_failures ? 1 : 0;
}
