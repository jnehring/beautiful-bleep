// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// The Transport module as a .wasm file asks the host through its mailbox (engine/HostControl.h, module-abi.md "Host mailbox"):
// WasmModule copies the host's status in before a block and moves the requests out after it.
//
//   bleep_wasm_host_control_test [path to transport.wasm]     (default build/web/modules/modules/transport.wasm)
#include "HostControl.h"
#include "wasm/SpecJson.h"
#include "wasm/WasmModule.h"
#include "wasm/WasmRuntime.h"

#include <juce_core/juce_core.h>

#include <chrono>
#include <cmath>
#include <cstdio>

using namespace bleep::engine;

static int g_failures = 0;
#define EXPECT(cond)                                                                     \
    do {                                                                                 \
        if (!(cond)) {                                                                   \
            std::printf("  %s:%d: EXPECT(%s)\n", __FILE__, __LINE__, #cond);            \
            ++g_failures;                                                                \
        }                                                                                \
    } while (0)

namespace {

/// One module with buffers for its jacks; each run() is one chunk.
struct Rig {
    const ModuleSpec& spec;
    std::unique_ptr<WasmModule> module;
    std::vector<std::vector<float>> params, inputs, outputs;
    std::vector<const float*> paramPtrs, inputPtrs;
    std::vector<float*> outputPtrs;
    std::vector<NoteBuffer> notesIn, notesOut;
    std::vector<const NoteBuffer*> notesInPtrs;
    std::vector<NoteBuffer*> notesOutPtrs;
    std::unique_ptr<bool[]> inConnected, outConnected;
    Transport transport;

    Rig(const ModuleSpec& s, std::shared_ptr<WasmPackage> package) : spec(s), module(std::make_unique<WasmModule>(s, std::move(package))) {
        const size_t np = s.params.size(), ni = s.inputs.size(), no = s.outputs.size();
        params.assign(np, std::vector<float>(kChunk));
        inputs.assign(ni, std::vector<float>(kChunk, 0.0f));
        outputs.assign(no, std::vector<float>(kChunk, 0.0f));
        notesIn.resize(ni);
        notesOut.resize(no);
        inConnected.reset(new bool[ni + 1]());
        outConnected.reset(new bool[no + 1]());
        for (size_t i = 0; i < np; ++i) {
            paramPtrs.push_back(params[i].data());
            set(s.params[i].id, s.params[i].def);
        }
        for (size_t i = 0; i < ni; ++i) {
            const bool notes = s.inputs[i].type == Signal::Notes;
            inputPtrs.push_back(notes ? nullptr : inputs[i].data());
            notesInPtrs.push_back(notes ? &notesIn[i] : nullptr);
        }
        for (size_t j = 0; j < no; ++j) {
            const bool notes = s.outputs[j].type == Signal::Notes;
            outputPtrs.push_back(notes ? nullptr : outputs[j].data());
            notesOutPtrs.push_back(notes ? &notesOut[j] : nullptr);
            outConnected[j] = true;
        }
        transport.sampleRate = 48000.0;
        transport.ppqValid = true;
        module->prepare(48000.0);
        module->reset();
    }
    void set(const std::string& id, float value) {
        const int i = spec.paramIndex(id);
        const float n = spec.params[(size_t)i].toNormalised(value);
        module->setKnob(i, n);
        std::fill(params[(size_t)i].begin(), params[(size_t)i].end(), n);
    }
    void patch(const std::string& id, float value) {
        const int i = spec.inputIndex(id);
        inConnected[(size_t)i] = true;
        std::fill(inputs[(size_t)i].begin(), inputs[(size_t)i].end(), value);
    }
    void run(int chunks = 1) {
        for (int k = 0; k < chunks; ++k) {
            ProcessContext c;
            c.numSamples = kChunk;
            c.transport = &transport;
            c.ppqStart = transport.ppq;
            c.ppqPerSample = transport.bpm / 60.0 / transport.sampleRate;
            c.params = paramPtrs.data();
            c.inputs = inputPtrs.data();
            c.inputConnected = inConnected.get();
            c.notesIn = notesInPtrs.data();
            c.outputs = outputPtrs.data();
            c.notesOut = notesOutPtrs.data();
            c.outputConnected = outConnected.get();
            module->process(c);
        }
    }
};

// ---- the runtime's limits on untrusted code (WasmRuntime.h), with tiny hand-written modules ----------------------

/// Exports `memory` and two functions, () -> (): 0 `spin` loops forever, 1 `ok` returns. `tableMin` > 0 adds a table of that many elements.
std::vector<uint8_t> tinyModule(uint32_t tableMin = 0) {
    std::vector<uint8_t> m = {0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
                              0x01, 0x04, 0x01, 0x60, 0x00, 0x00,        // type () -> ()
                              0x03, 0x03, 0x02, 0x00, 0x00};              // two functions of that type
    if (tableMin) {
        std::vector<uint8_t> t = {0x01, 0x70, 0x00};                      // one funcref table, no maximum, min as LEB128
        for (uint32_t v = tableMin;;) {
            uint8_t b = v & 0x7f;
            v >>= 7;
            t.push_back(v ? (b | 0x80) : b);
            if (!v) break;
        }
        m.push_back(0x04);
        m.push_back((uint8_t)t.size());
        m.insert(m.end(), t.begin(), t.end());
    }
    const uint8_t rest[] = {0x05, 0x03, 0x01, 0x00, 0x01,                                              // one memory, a page
                            0x07, 0x16, 0x03, 0x06, 'm', 'e', 'm', 'o', 'r', 'y', 0x02, 0x00,         // exports
                            0x04, 's', 'p', 'i', 'n', 0x00, 0x00, 0x02, 'o', 'k', 0x00, 0x01,
                            0x0a, 0x0c, 0x02, 0x07, 0x00, 0x03, 0x40, 0x0c, 0x00, 0x0b, 0x0b,        // spin: loop { br 0 }
                            0x02, 0x00, 0x0b};                                                         // ok: nothing
    m.insert(m.end(), std::begin(rest), std::end(rest));
    return m;
}

void runtimeLimits() {
    namespace w = bleep::engine::wasm;
    std::string error;
    const auto bytes = tinyModule();
    auto compiled = w::Compiled::compile(bytes.data(), bytes.size(), error);
    EXPECT(compiled != nullptr);
    if (!compiled) { std::printf("  %s\n", error.c_str()); return; }
    auto inst = w::Instance::create(compiled, error);
    EXPECT(inst != nullptr);
    if (!inst) return;
    const int spin = inst->find("spin"), ok = inst->find("ok");

    // A call that returns is untouched.
    inst->call(ok);
    EXPECT(!inst->failed());

    // A loop that never ends is stopped within its budget, and the instance is marked failed (and runs nothing more).
    inst->setBudgetMs(30);
    const auto t0 = std::chrono::steady_clock::now();
    inst->call(spin);
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    EXPECT(inst->failed());
    EXPECT(ms >= 20 && ms < 500);
    EXPECT(inst->lastError().find("time limit") != std::string::npos);
    const auto t1 = std::chrono::steady_clock::now();
    inst->call(spin);  // already failed: returns at once
    const double again = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t1).count();
    EXPECT(again < 5);
    std::printf("  endless loop stopped after %.1f ms (budget 30)\n", ms);

    // Another instance of the same module is not affected.
    auto other = w::Instance::create(compiled, error);
    EXPECT(other && !other->failed());

    // Overhead of the epoch checks on ordinary calls.
    if (other) {
        const int f = other->find("ok");
        const auto t2 = std::chrono::steady_clock::now();
        for (int i = 0; i < 100000; ++i) other->call(f);
        std::printf("  100000 trivial calls: %.1f ms\n", std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t2).count());
        EXPECT(!other->failed());
    }

    // Too many table elements: the module does not instantiate.
    const auto big = tinyModule(1000000);
    auto bigCompiled = w::Compiled::compile(big.data(), big.size(), error);
    EXPECT(bigCompiled != nullptr);
    if (bigCompiled) EXPECT(w::Instance::create(bigCompiled, error) == nullptr);
    const auto small = tinyModule(1000);
    auto smallCompiled = w::Compiled::compile(small.data(), small.size(), error);
    EXPECT(smallCompiled && w::Instance::create(smallCompiled, error) != nullptr);

    // A module file over the size limit is refused before compiling.
    const std::vector<uint8_t> huge(w::kMaxModuleBytes + 1, 0);
    error.clear();
    EXPECT(w::Compiled::compile(huge.data(), huge.size(), error) == nullptr && error.find("too large") != std::string::npos);
}

}  // namespace

int main(int argc, char** argv) {
    runtimeLimits();
    const juce::File file = argc > 1 ? juce::File::getCurrentWorkingDirectory().getChildFile(argv[1])
                                     : juce::File::getCurrentWorkingDirectory().getChildFile("build/web/modules/modules/transport.wasm");
    juce::MemoryBlock block;
    if (!file.loadFileAsData(block)) {
        std::fprintf(stderr, "cannot read %s (scripts/build/build-web.sh --modules-only)\n", file.getFullPathName().toRawUTF8());
        return 2;
    }
    std::string error;
    auto package = WasmPackage::load((const uint8_t*)block.getData(), block.getSize(), error);
    if (!package) {
        std::fprintf(stderr, "cannot load: %s\n", error.c_str());
        return 2;
    }
    ModuleSpec spec;
    const juce::var all = juce::JSON::parse(juce::String(package->specJson));
    if (!specFromJson(all[0], spec, error)) {
        std::fprintf(stderr, "cannot read the spec: %s\n", error.c_str());
        return 2;
    }

    HostControl& hc = hostControl();
    auto drain = [&] { hc.takeTempo(); hc.takePlay(); hc.takeLink(); hc.takeStartStopSync(); };
    drain();
    Rig r(spec, package);
    EXPECT(r.module->ok());
    if (!r.module->ok()) std::printf("  %s\n", r.module->error().c_str());

    // Loading: Link and its start/stop come out, the tempo does not.
    r.run();
    EXPECT(hc.takeLink() == 1 && hc.takeStartStopSync() == 1);
    EXPECT(hc.takeTempo() == 0.0);
    r.run();
    EXPECT(hc.takeLink() == HostControl::kNone);  // taken: not asked again
    // A tempo change, a Link switch.
    r.set("tempo", 95.0f);
    r.set("link", 0.0f);
    r.run();
    EXPECT(std::fabs(hc.takeTempo() - 95.0) < 0.01);
    EXPECT(hc.takeLink() == 0);
    // Play from a trigger, Stop from the button.
    r.patch("play", 1.0f);
    r.run(2);
    EXPECT(hc.takePlay() == HostControl::Start);
    r.transport.playing = true;
    r.module->command("stop", 1.0f);
    r.run();
    EXPECT(hc.takePlay() == HostControl::Stop);
    // The host's status reaches the module (a second module of the same file keeps its own mailbox).
    hc.hosted = 1;
    hc.linkAvailable = 1;
    hc.linkPeers = 3;
    r.run();
    std::vector<std::pair<std::string, double>> live;
    for (int i = 0; i < 400 && live.empty(); ++i) {  // the view's values are a snapshot the audio thread makes now and then
        r.module->liveValues(live);
        r.run(20);
    }
    double peers = -1.0, hosted = -1.0;
    for (const auto& [k, v] : live) {
        if (k == "peers") peers = v;
        if (k == "hosted") hosted = v;
    }
    EXPECT(peers == 3.0 && hosted == 1.0);
    hc.hosted = 0;
    hc.linkAvailable = 0;
    hc.linkPeers = 0;

    std::printf(g_failures ? "%d failure(s)\n" : "wasm host control: all passed\n", g_failures);
    return g_failures ? 1 : 0;
}
