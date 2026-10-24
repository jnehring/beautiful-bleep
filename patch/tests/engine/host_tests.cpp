// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// host_tests.cpp — plugins simulated through IEngine: block claiming, port latency, threads, MIDI and the standalone driver.

#include "engine_test.h"

namespace {

/// Bleep Board + Audio In + Audio Out: an impulse arrives exactly two blocks later.
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

/// Live announces a maximum block of 512 whatever its buffer is. The reported latency follows the blocks that really
/// come (128), and matches the delay a signal really has.
void latencyFollowsRealBlocks() {
    g_test = "latency-real-blocks";
    auto* e = new Engine();
    const int main = e->registerInstance(PortKind::Patch);
    const int ain = e->registerInstance(PortKind::AudioIn);
    const int aout = e->registerInstance(PortKind::AudioOut);
    e->reconcileNow();
    auto edited = copyOf(e->board());
    edited["cables"].getArray()->add(cable(portNode(*e, ain), "l", portNode(*e, aout), "l"));
    e->commit(edited, "patch");

    FakePort pMain(*e, main), pIn(*e, ain), pOut(*e, aout);
    for (int h : {main, ain, aout}) e->prepare(h, kRate, 512);  // what Live announces
    EXPECT(e->latencySamples() == 1024);                         // nothing has run yet: the announced maximum
    int arrivedAt = -1, arrivedSample = -1;
    for (int b = 0; b < 8; ++b) {
        for (auto& ch : pIn.in) std::fill(ch.begin(), ch.end(), 0.0f);
        if (b == 1) pIn.in[0][5] = 1.0f;
        for (auto* p : {&pMain, &pIn, &pOut}) p->run((int64_t)b * kBlock);
        EXPECT(e->latencySamples() == 2 * kBlock);
        for (int i = 0; i < kBlock; ++i)
            if (pOut.out[0][(size_t)i] > 0.5f && arrivedAt < 0) {
                arrivedAt = b;
                arrivedSample = i;
            }
    }
    // Sent in block 1 at sample 5, heard 2 * kBlock samples later: exactly what is reported.
    EXPECT(arrivedAt * kBlock + arrivedSample == 1 * kBlock + 5 + e->latencySamples());
    e->unregisterInstance(main);
    e->unregisterInstance(ain);
    e->unregisterInstance(aout);
    e->collectGarbage();
    e->release();
}

/// Bleep FX alone on the board runs its cell in its own block: no latency, and the signal comes out in the block it went in.
/// Cabled to another plugin it is on the tick again, two blocks.
void cellPluginRunsInItsOwnBlock() {
    g_test = "local cell plugin";
    auto* e = new Engine();
    const int main = e->registerInstance(PortKind::Patch);
    const int fx = e->registerInstance(PortKind::AudioInsert);
    const int ain = e->registerInstance(PortKind::AudioIn);
    e->reconcileNow();
    FakePort pMain(*e, main), pFx(*e, fx), pIn(*e, ain);
    EXPECT(e->portLatencySamples(fx) == 0);
    EXPECT(e->portLatencySamples(ain) == e->latencySamples());  // a port to the tick keeps the two blocks
    EXPECT(e->portLatencySamples(main) == e->latencySamples());

    std::mt19937 rng(5);
    int wrong = 0;
    for (int b = 0; b < 12; ++b) {
        for (int i = 0; i < kBlock; ++i) pFx.in[0][(size_t)i] = pFx.in[1][(size_t)i] = (float)(b * kBlock + i + 1);
        std::vector<FakePort*> order{&pMain, &pFx, &pIn};
        std::shuffle(order.begin(), order.end(), rng);
        for (auto* p : order) p->run((int64_t)b * kBlock);
        for (int i = 0; i < kBlock; ++i)
            if (pFx.out[0][(size_t)i] != (float)(b * kBlock + i + 1) || pFx.out[1][(size_t)i] != (float)(b * kBlock + i + 1)) ++wrong;
    }
    EXPECT(wrong == 0);

    // A cable from another plugin into the insert's return joins them: both go through the tick.
    auto edited = copyOf(e->board());
    edited["cables"].getArray()->add(cable(portNode(*e, ain), "l", portNode(*e, fx), "l"));
    e->commit(edited, "patch");
    EXPECT(e->portLatencySamples(fx) == e->latencySamples() && e->latencySamples() == 2 * kBlock);
    // ... and removing it sets it free again.
    auto doc = copyOf(e->board());
    doc["cables"].getArray()->clear();
    e->commit(doc, "unpatch");
    EXPECT(e->portLatencySamples(fx) == 0);
    for (int h : {main, fx, ain}) e->unregisterInstance(h);
    e->collectGarbage();
    e->release();
}

/// The same with every plugin on its own thread, next to a patch through the tick, and while the board is edited under them.
void cellPluginThreads() {
    g_test = "local cell plugin threads";
    auto* e = new Engine();
    const int main = e->registerInstance(PortKind::Patch);
    const int fx = e->registerInstance(PortKind::AudioInsert);
    const int ain = e->registerInstance(PortKind::AudioIn);
    const int aout = e->registerInstance(PortKind::AudioOut);
    e->reconcileNow();
    auto edited = copyOf(e->board());
    edited["cables"].getArray()->add(cable(portNode(*e, ain), "l", portNode(*e, aout), "l"));
    e->commit(edited, "patch");
    FakePort ports[] = {{*e, main}, {*e, fx}, {*e, ain}, {*e, aout}};
    EXPECT(e->portLatencySamples(fx) == 0);

    constexpr int kBlocks = 400;
    for (const bool editing : {false, true}) {
        Barrier sync(4);
        std::atomic<bool> done{false};
        std::vector<float> received(kBlocks * kBlock, 0.0f), local(kBlocks * kBlock, 0.0f);
        std::vector<std::thread> threads;
        for (int t = 0; t < 4; ++t)
            threads.emplace_back([&, t] {
                std::mt19937 rng((unsigned)t);
                for (int b = 0; b < kBlocks; ++b) {
                    FakePort& p = ports[t];
                    if (t == 1 || t == 2)
                        for (int i = 0; i < kBlock; ++i) p.in[0][(size_t)i] = p.in[1][(size_t)i] = (float)(b * kBlock + i);
                    std::this_thread::sleep_for(std::chrono::microseconds(rng() % 50));
                    p.run((int64_t)b * kBlock);
                    if (t == 1) std::copy(p.out[0].begin(), p.out[0].end(), local.begin() + b * kBlock);
                    if (t == 3) std::copy(p.out[0].begin(), p.out[0].end(), received.begin() + b * kBlock);
                    sync.arrive_and_wait();
                }
            });
        // The board changes meanwhile (the message thread): the FX joins the patch and leaves it again.
        std::thread editor([&] {
            for (int k = 0; editing && !done; ++k) {
                auto doc = copyOf(e->board());
                auto* cables = doc["cables"].getArray();
                if (k % 2 == 0) cables->add(cable(portNode(*e, ain), "l", portNode(*e, fx), "l"));
                else cables->remove(cables->size() - 1);
                e->commit(doc, "edit");
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
                e->collectGarbage();
            }
        });
        for (auto& th : threads) th.join();
        done = true;
        editor.join();
        e->collectGarbage();
        if (!editing) {
            int wrong = 0;
            for (int i = 2 * kBlock; i < kBlocks * kBlock; ++i) {
                if (std::abs(received[(size_t)i] - (float)(i - 2 * kBlock)) > 0.0f) ++wrong;
                if (std::abs(local[(size_t)i] - (float)i) > 0.0f) ++wrong;  // the FX: this very block
            }
            EXPECT(wrong == 0);
        }
    }
    for (int h : {main, fx, ain, aout}) e->unregisterInstance(h);
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


/// the engine, no Macros node, and the Link node follows the transport.
void standaloneDriver() {
    g_test = "standalone";
    auto* e = new Engine();
    e->setStandalone(true);
    const int main = e->registerInstance(PortKind::Patch);
    const int ain = e->registerRemoteInstance(PortKind::AudioIn);
    const int aout = e->registerRemoteInstance(PortKind::AudioOut);
    const int link = e->registerRemoteInstance(PortKind::Link);
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

/// A new Bleep Board comes with a MIDI In and an Audio Out of its own; the Audio Out plays through the Board plugin.
void boardIsMidiInAndAudioOut() {
    g_test = "board io";
    auto* e = new Engine();
    const int main = e->registerInstance(PortKind::Patch);
    const int ain = e->registerInstance(PortKind::AudioIn);
    e->reconcileNow();
    char id[40];
    e->instanceId(main, id, sizeof id);
    const auto* midi = board::findNodeByPort(e->board(), juce::String(id) + ":midi");
    const auto* audio = board::findNodeByPort(e->board(), juce::String(id) + ":audio");
    EXPECT(midi != nullptr && midi->getProperty("type").toString() == "midi-in");
    EXPECT(audio != nullptr && audio->getProperty("type").toString() == "audio-out");
    if (midi == nullptr || audio == nullptr) {
        e->release();
        return;
    }
    const auto outNode = audio->getProperty("id").toString();
    auto edited = copyOf(e->board());
    edited["cables"].getArray()->add(cable(portNode(*e, ain), "l", outNode, "l"));
    e->commit(edited, "patch");
    e->reconcileNow();
    EXPECT(e->board()["nodes"].getArray()->size() == 4);  // MIDI In, Audio Out, Macros, Audio In: nothing added twice

    FakePort pMain(*e, main), pIn(*e, ain);
    int arrivedAt = -1;
    for (int b = 0; b < 8; ++b) {
        for (auto& ch : pIn.in) std::fill(ch.begin(), ch.end(), 0.0f);
        if (b == 1) pIn.in[0][5] = 1.0f;
        pMain.run((int64_t)b * kBlock);
        pIn.run((int64_t)b * kBlock);
        for (int i = 0; i < kBlock; ++i)
            if (pMain.out[0][(size_t)i] > 0.5f && arrivedAt < 0) arrivedAt = b;
    }
    EXPECT(arrivedAt >= 0);  // the Board plugin's own output carries the board's audio
    e->unregisterInstance(main);
    e->unregisterInstance(ain);
    e->collectGarbage();
    e->release();
}

/// A project loaded into Bleep Board carries an Audio Out with only the bare port suffix: the board makes it its own.
void boardClaimsLoadedPorts() {
    g_test = "board claims";
    auto* e = new Engine();
    const int main = e->registerInstance(PortKind::Patch);
    e->reconcileNow();
    char id[40];
    e->instanceId(main, id, sizeof id);
    auto loaded = doc({node("out", "audio-out"), node("mid", "midi-in")}, {});
    loaded["nodes"][0].getDynamicObject()->setProperty("port", ":audio");
    loaded["nodes"][1].getDynamicObject()->setProperty("port", ":midi");
    e->commit(loaded, "load");
    EXPECT(board::findNodeByPort(e->board(), juce::String(id) + ":audio") != nullptr);
    EXPECT(board::findNodeByPort(e->board(), juce::String(id) + ":midi") != nullptr);
    e->unregisterInstance(main);
    e->collectGarbage();
    e->release();
}

/// A sequencer in Bleep Board steps at the host's tempo, whatever the board was saved with.
void boardFollowsHostTempo() {
    g_test = "board tempo";
    auto stepsAt = [](double bpm) {
        auto* e = new Engine();
        const int main = e->registerInstance(PortKind::Patch);
        e->reconcileNow();
        char id[40];
        e->instanceId(main, id, sizeof id);
        const auto* audio = board::findNodeByPort(e->board(), juce::String(id) + ":audio");
        int edges = 0;
        if (audio != nullptr) {
            juce::Array<juce::var> steps;
            for (int i = 0; i < 32; ++i) steps.add(obj({{"g", 1}, {"p", 0}, {"v", 100}}));
            auto seq = node("seq", "step-sequencer");
            seq.getDynamicObject()->setProperty("data", obj({{"steps", steps}}));
            auto edited = copyOf(e->board());
            edited["nodes"].getArray()->add(seq);
            edited["cables"].getArray()->add(cable("seq", "gate", audio->getProperty("id").toString(), "l"));
            e->commit(edited, "seq");
            FakePort p(*e, main);
            p.playing = true;
            p.bpm = bpm;
            float last = 0.0f;
            for (int b = 0; b < 1500; ++b) {
                p.run((int64_t)b * kBlock);
                for (int i = 0; i < kBlock; ++i) {
                    const float v = p.out[0][(size_t)i];
                    if (v > 0.5f && last <= 0.5f) ++edges;
                    last = v;
                }
            }
        }
        e->unregisterInstance(main);
        e->collectGarbage();
        e->release();
        return edges;
    };
    const int slow = stepsAt(60.0), fast = stepsAt(180.0);
    EXPECT(slow > 2);
    EXPECT(fast >= slow * 2.5 && fast <= slow * 3.5);  // three times the tempo, three times the steps
}

/// Voice Cells (spec §8.3): MIDI notes into a Voice Cell whose voice outputs

}  // namespace

void runHostTests() {
    latencyAndClaiming();
    latencyFollowsRealBlocks();
    cellPluginRunsInItsOwnBlock();
    cellPluginThreads();
    parallelThreads();
    midiThrough();
    standaloneDriver();
    boardIsMidiInAndAudioOut();
    boardFollowsHostTempo();
    boardClaimsLoadedPorts();
}
