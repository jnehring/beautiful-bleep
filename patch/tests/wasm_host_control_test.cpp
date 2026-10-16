// SPDX-License-Identifier: MIT
//
// The Transport module as a .wasm file asks the host through its mailbox (engine/HostControl.h, module-abi.md "Host mailbox"):
// WasmModule copies the host's status in before a block and moves the requests out after it.
//
//   bleep_wasm_host_control_test [path to transport.wasm]     (default build/web/modules/modules/transport.wasm)
#include "HostControl.h"
#include "wasm/SpecJson.h"
#include "wasm/WasmModule.h"

#include <juce_core/juce_core.h>

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

}  // namespace

int main(int argc, char** argv) {
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
