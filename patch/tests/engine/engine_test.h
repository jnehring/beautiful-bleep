// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// engine/engine_test.h — what the engine test files share: the includes, EXPECT macros, the failure count and the
// helpers that build board documents and simulate a plugin (a FakePort).
#pragma once

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

using namespace bleep::engine;

inline int g_failures = 0;
inline const char* g_test = "";
#define EXPECT(cond)                                                                       \
    do {                                                                                   \
        if (!(cond)) {                                                                     \
            std::printf("  %s: %s:%d: EXPECT(%s)\n", g_test, __FILE__, __LINE__, #cond); \
            ++g_failures;                                                                  \
        }                                                                                  \
    } while (0)
#define EXPECT_NEAR(a, b, tol) EXPECT(std::fabs((double)(a) - (double)(b)) <= (tol))

inline constexpr int kBlock = 128;
inline constexpr double kRate = 48000.0;

inline juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> props) {
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}

inline juce::var cable(const juce::String& fn, const juce::String& fj, const juce::String& tn, const juce::String& tj,
                double amount = 1.0) {
    return obj({{"from", obj({{"node", fn}, {"jack", fj}})}, {"to", obj({{"node", tn}, {"jack", tj}})},
                {"amount", amount}});
}

inline juce::var node(const juce::String& id, const juce::String& type, const juce::String& parent = {}) {
    return obj({{"id", id}, {"type", type}, {"parent", parent}});
}

inline juce::var doc(juce::Array<juce::var> nodes, juce::Array<juce::var> cables) {
    return obj({{"format", 1}, {"id", "test"}, {"nodes", nodes}, {"cables", cables}});
}

/// juce::var shares objects on copy; the engine's board must not be edited in place.
inline juce::var copyOf(const juce::var& v) { return board::fromJson(board::toJson(v)); }

inline juce::String portNode(Engine& e, int handle) {
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
    bool playing = false;  ///< the host's transport
    double bpm = 120.0;
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
        io.transport.playing = playing;
        io.transport.bpm = bpm;
        io.transport.ppq = (double)samplePos / kRate * bpm / 60.0;
        io.transport.ppqValid = true;
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

// One function per file; engine_test.cpp calls them all.
void runDocumentTests();
void runHostTests();
void runVoiceTests();
void runCellPluginTests();
