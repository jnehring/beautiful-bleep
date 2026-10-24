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

juce::String ownNode(Engine& e, int handle, const char* suffix) {
    char id[40];
    e.instanceId(handle, id, sizeof id);
    auto* n = board::findNodeByPort(e.board(), juce::String(id) + suffix);
    return n ? n->getProperty("id").toString() : juce::String();
}

/// Bleep Board runs the board in its own block. A signal from the board's own track to the board's own track takes no
/// block; from or to a plugin on another track one block; from one to another two. The plugins run in any order.
void boardRunsInItsOwnBlock() {
    g_test = "board in its own block";
    struct Result { int block = -1, sample = -1; };
    // `from` is "macro" (the board's own: Macro 1 jumps to 1 in block 2) or "audio" (an impulse from an Audio In in block 2
    // at sample 5); `to` is "own" (the board's own Audio Out) or "port" (an Audio Out plugin on another track).
    auto run = [&](bool fromPort, bool toPort, bool reportInputs, int& boardLatency, int& outLatency) {
        auto* e = new Engine();
        const int main = e->registerInstance(PortKind::Patch);
        const int ain = e->registerInstance(PortKind::AudioIn);
        const int aout = e->registerInstance(PortKind::AudioOut);
        e->reconcileNow();
        auto edited = copyOf(e->board());
        const juce::String src = fromPort ? portNode(*e, ain) : portNode(*e, main);  // the Macros node
        const juce::String dst = toPort ? portNode(*e, aout) : ownNode(*e, main, ":audio");
        EXPECT(src.isNotEmpty() && dst.isNotEmpty());
        edited["cables"].getArray()->add(cable(src, fromPort ? "l" : "m1", dst, "l"));
        e->commit(edited, "patch");
        if (reportInputs) e->setBoardSetting("zeroHostLatencyInputs", false);
        FakePort pMain(*e, main), pIn(*e, ain), pOut(*e, aout);
        float macro[kNumMacros] = {};
        pMain.macros = macro;
        std::mt19937 rng(11);
        Result r;
        for (int b = 0; b < 10; ++b) {
            for (auto& ch : pIn.in) std::fill(ch.begin(), ch.end(), 0.0f);
            if (b == 2 && fromPort) pIn.in[0][5] = 1.0f;
            macro[0] = !fromPort && b >= 2 ? 1.0f : 0.0f;
            std::vector<FakePort*> order{&pMain, &pIn, &pOut};
            std::shuffle(order.begin(), order.end(), rng);
            for (auto* p : order) p->run((int64_t)b * kBlock);
            const auto& heard = toPort ? pOut.out[0] : pMain.out[0];
            for (int i = 0; i < kBlock; ++i)
                if (heard[(size_t)i] > 0.5f && r.block < 0) r = {b, i};
        }
        boardLatency = e->portLatencySamples(main);
        outLatency = e->portLatencySamples(aout);
        for (int h : {main, ain, aout}) e->unregisterInstance(h);
        e->collectGarbage();
        e->release();
        return r;
    };
    int lb = 0, lo = 0;
    auto own = run(false, false, false, lb, lo);   // own → own
    EXPECT(own.block == 2 && own.sample == 0);
    EXPECT(lb == 0);                               // 0 host latency for inputs is the default: the Audio In's block is kept inside
    auto toOut = run(false, true, false, lb, lo);  // own → a plugin on another track
    EXPECT(toOut.block == 3 && toOut.sample == 0);
    EXPECT(lo == kBlock);                          // one block: only what is patched into it crosses (the Audio In is not)
    auto fromIn = run(true, false, false, lb, lo); // another track → own
    EXPECT(fromIn.block == 3 && fromIn.sample == 5);
    EXPECT(lb == 0);
    auto through = run(true, true, false, lb, lo); // another track → another track
    EXPECT(through.block == 4 && through.sample == 5);
    EXPECT(lb == 0 && lo == 2 * kBlock);           // the board's own track gets nothing from the Audio In; the Audio Out reports both blocks

    // With the setting off the block of the input is reported to Live (and the signal arrives at the same time).
    fromIn = run(true, false, true, lb, lo);
    EXPECT(fromIn.block == 3 && fromIn.sample == 5);
    EXPECT(lb == kBlock);
    through = run(true, true, true, lb, lo);
    EXPECT(through.block == 4 && through.sample == 5);
    EXPECT(lb == 0 && lo == 2 * kBlock);
    // With it on (the default) the block stays inside the board ... unless audio goes back to Live on another track: then the
    // host must be told, or that track would be a block late. That is the `through` run above.
}

/// Latency is for what really crosses between plugins: a plugin that exists, or an Audio Out nothing is patched into, adds none.
void latencyOnlyForWhatCrosses() {
    g_test = "latency only for what crosses";
    auto* e = new Engine();
    const int main = e->registerInstance(PortKind::Patch);
    const int ain = e->registerInstance(PortKind::AudioIn);
    const int aout = e->registerInstance(PortKind::AudioOut);
    const int aout2 = e->registerInstance(PortKind::AudioOut);
    e->reconcileNow();
    FakePort pMain(*e, main), pIn(*e, ain), pOut(*e, aout), pOut2(*e, aout2);
    e->setBoardSetting("zeroHostLatencyInputs", false);
    EXPECT(e->portLatencySamples(main) == 0 && e->portLatencySamples(aout) == 0 && e->portLatencySamples(aout2) == 0);
    // The Audio In patched to one Audio Out: that one reports the way in and the way out, the other plugins nothing.
    auto edited = copyOf(e->board());
    edited["cables"].getArray()->add(cable(portNode(*e, ain), "l", portNode(*e, aout), "l"));
    e->commit(edited, "patch");
    EXPECT(e->portLatencySamples(aout) == 2 * kBlock);
    EXPECT(e->portLatencySamples(aout2) == 0);
    EXPECT(e->portLatencySamples(main) == 0);
    // A signal made on the board alone (the Macros node) into the other Audio Out: one block, the input is not part of it.
    edited = copyOf(e->board());
    edited["cables"].getArray()->add(cable(portNode(*e, main), "m1", portNode(*e, aout2), "l"));
    e->commit(edited, "patch");
    EXPECT(e->portLatencySamples(aout2) == kBlock);
    EXPECT(e->portLatencySamples(aout) == 2 * kBlock);
    for (int h : {main, ain, aout, aout2}) e->unregisterInstance(h);
    e->collectGarbage();
    e->release();
}

/// The setting is saved with the board, and a board without it reports the delay.
void zeroLatencySettingIsSaved() {
    g_test = "0 host latency setting";
    auto* e = new Engine();
    const int main = e->registerInstance(PortKind::Patch);
    const int ain = e->registerInstance(PortKind::AudioIn);
    e->reconcileNow();
    auto edited = copyOf(e->board());
    edited["cables"].getArray()->add(cable(portNode(*e, ain), "l", ownNode(*e, main, ":audio"), "l"));
    e->commit(edited, "patch");
    FakePort pMain(*e, main), pIn(*e, ain);
    EXPECT(e->portLatencySamples(main) == 0);   // on by default: a board that never heard of the setting
    e->setBoardSetting("zeroHostLatencyInputs", false);
    EXPECT(e->portLatencySamples(main) == kBlock);
    EXPECT(!(bool)e->board()["settings"]["zeroHostLatencyInputs"]);
    // A committed edit (the board page sends the whole board back) keeps it, and a saved board comes back with it.
    e->commit(copyOf(e->board()), "edit");
    EXPECT(e->portLatencySamples(main) == kBlock);
    e->setBoardSetting("zeroHostLatencyInputs", true);
    EXPECT(e->portLatencySamples(main) == 0);
    for (int h : {main, ain}) e->unregisterInstance(h);
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
    EXPECT(e->portLatencySamples(main) == 0);  // Bleep Board runs in its own block; the Audio In's block stays inside (the default setting)

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
    boardRunsInItsOwnBlock();
    latencyOnlyForWhatCrosses();
    zeroLatencySettingIsSaved();
    cellPluginRunsInItsOwnBlock();
    cellPluginThreads();
    parallelThreads();
    midiThrough();
    standaloneDriver();
    boardIsMidiInAndAudioOut();
    boardFollowsHostTempo();
    boardClaimsLoadedPorts();
}
