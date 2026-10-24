// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Code nodes in the engine (engine/wasm/CodeNodes.h, doc/specs/bleep-script.md): a board with a Code node keeps its cables, knob values and
// `code` when it is loaded, before anything is compiled; the module the UI compiled is registered for the node and runs; a new source is a new
// type. The module is the Gains module of patch/script (npm run build there).
//
//   bleep_code_node_test <gains.wasm> <gains.spec.json>      (default patch/script/build/gains.wasm and gains.spec.json)
#include "Board.h"
#include "Registry.h"
#include "wasm/CodeNodes.h"
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
    std::unique_ptr<Module> module;
    std::vector<std::vector<float>> params, inputs, outputs;
    std::vector<const float*> paramPtrs, inputPtrs;
    std::vector<float*> outputPtrs;
    std::vector<NoteBuffer> notesIn, notesOut;
    std::vector<const NoteBuffer*> notesInPtrs;
    std::vector<NoteBuffer*> notesOutPtrs;
    std::unique_ptr<bool[]> inConnected, outConnected;
    Transport transport;

    Rig(const ModuleSpec& s, std::unique_ptr<Module> m) : spec(s), module(std::move(m)) {
        const size_t np = s.params.size(), ni = s.inputs.size(), no = s.outputs.size();
        params.assign(np, std::vector<float>(kChunk));
        inputs.assign(ni, std::vector<float>(kChunk, 0.0f));
        outputs.assign(no, std::vector<float>(kChunk, 0.0f));
        notesIn.resize(ni);
        notesOut.resize(no);
        inConnected.reset(new bool[ni + 1]());
        outConnected.reset(new bool[no + 1]());
        for (size_t i = 0; i < np; ++i) { paramPtrs.push_back(params[i].data()); set(s.params[i].id, s.params[i].def); }
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

juce::var parseJson(const juce::String& text) {
    juce::var v;
    juce::JSON::parse(text, v);
    return v;
}

const juce::var* findNode(const juce::var& doc, const juce::String& id) {
    if (auto* a = doc["nodes"].getArray())
        for (const auto& n : *a)
            if (n["id"].toString() == id) return &n;
    return nullptr;
}

}  // namespace

int main(int argc, char** argv) {
    const auto cwd = juce::File::getCurrentWorkingDirectory();
    const juce::File wasmFile = cwd.getChildFile(argc > 1 ? argv[1] : "patch/script/build/gains.wasm");
    const juce::File specFile = cwd.getChildFile(argc > 2 ? argv[2] : "patch/script/build/gains.spec.json");
    juce::MemoryBlock wasm;
    if (!wasmFile.loadFileAsData(wasm) || !specFile.existsAsFile()) {
        std::fprintf(stderr, "cannot read %s or %s (cd patch/script && npm run build)\n", wasmFile.getFullPathName().toRawUTF8(), specFile.getFullPathName().toRawUTF8());
        return 2;
    }
    const juce::var iface = parseJson(specFile.loadFileAsString())[0];
    EXPECT(iface.isObject());

    // The Code node type is in the registry (the Add menu), and has no jacks of its own.
    const auto* placeholder = Registry::get().find(kCode);
    EXPECT(placeholder != nullptr);
    if (placeholder) EXPECT(placeholder->inputs.empty() && placeholder->params.empty() && placeholder->userCreatable);

    // A board with a Code node, a Dial cabled into its In jack, and knob values: nothing is compiled yet.
    auto* code = new juce::DynamicObject();
    code->setProperty("source", "// the source");
    code->setProperty("interface", iface);
    code->setProperty("settings", juce::var(new juce::DynamicObject()));
    auto node = [](const char* id, const char* type, juce::var params, juce::var extra = {}) {
        auto* o = new juce::DynamicObject();
        o->setProperty("id", id); o->setProperty("type", type); o->setProperty("name", id); o->setProperty("x", 0); o->setProperty("y", 0);
        o->setProperty("parent", ""); o->setProperty("params", params);
        if (auto* e = extra.getDynamicObject()) for (const auto& p : e->getProperties()) o->setProperty(p.name, p.value);
        return juce::var(o);
    };
    auto params = [](float vol) { auto* p = new juce::DynamicObject(); p->setProperty("vol", vol); return juce::var(p); };
    auto doc = [&](const juce::var& codeProp) {
        auto* d = new juce::DynamicObject();
        juce::Array<juce::var> nodes;
        auto* extra = new juce::DynamicObject();
        extra->setProperty("code", codeProp);
        nodes.add(node("c1", "code", params(0.5f), juce::var(extra)));
        nodes.add(node("d1", "dial", juce::var(new juce::DynamicObject())));
        d->setProperty("nodes", nodes);
        auto* cable = new juce::DynamicObject();
        auto* from = new juce::DynamicObject(); from->setProperty("node", "d1"); from->setProperty("jack", "out");
        auto* to = new juce::DynamicObject(); to->setProperty("node", "c1"); to->setProperty("jack", "x");
        cable->setProperty("id", "k1"); cable->setProperty("from", juce::var(from)); cable->setProperty("to", juce::var(to)); cable->setProperty("amount", 1.0);
        d->setProperty("cables", juce::Array<juce::var>{juce::var(cable)});
        return juce::var(d);
    };
    const juce::var board = doc(juce::var(code));

    const juce::var clean = board::sanitise(board);
    const auto* c1 = findNode(clean, "c1");
    EXPECT(c1 != nullptr);
    if (c1) {
        EXPECT((*c1)["type"].toString() == "code");
        EXPECT((*c1)["code"]["source"].toString() == "// the source");   // the document keeps the node's code
        EXPECT(std::abs((float)(*c1)["params"]["vol"] - 0.5f) < 1e-6f);  // and the knob value the interface declares
        EXPECT((*c1)["missing"].isVoid());                               // not a placeholder: it has its jacks
    }
    EXPECT(clean["cables"].size() == 1);   // the cable into its In jack survived loading, before any compile

    const BoardModel model = board::parse(clean);
    const NodeModel* m1 = model.node("c1");
    EXPECT(m1 && m1->spec && m1->type.rfind("code:c1:", 0) == 0 && m1->spec->inputs.size() == 2 && m1->spec->params.size() == 3);
    const std::string typeId = m1 ? m1->type : "";
    EXPECT(Registry::get().create(typeId) == nullptr);   // no DSP yet: the node is silent

    // The UI compiles the source and registers the module for the node.
    const juce::String codeJson = juce::JSON::toString(juce::var(code), true);
    std::string error;
    EXPECT(codeTypeId("c1", codeJson.toStdString()) == typeId);
    EXPECT(registerCodeModule("c1", codeJson.toStdString(), static_cast<const uint8_t*>(wasm.getData()), wasm.getSize(), error));
    if (!error.empty()) std::printf("  %s\n", error.c_str());
    auto dsp = Registry::get().create(typeId);
    EXPECT(dsp != nullptr);
    const ModuleSpec* spec = Registry::get().find(typeId);
    EXPECT(spec && spec->type == typeId);
    if (dsp && spec) {
        Rig rig(*spec, std::move(dsp));
        rig.patch("x", 0.5f);
        rig.set("vol", 0.0f);
        rig.run(200);
        const float y = rig.outputs[(size_t)spec->outputIndex("out")][kChunk - 1];
        EXPECT(std::abs(y - 0.5f) < 1e-3f);   // unity gain
        rig.set("vol", -60.0f);
        rig.run(200);
        EXPECT(std::abs(rig.outputs[(size_t)spec->outputIndex("out")][kChunk - 1]) < 1e-6f);   // the knob works
        rig.set("vol", 0.0f); rig.set("mute", 1.0f);
        rig.run(200);
        EXPECT(std::abs(rig.outputs[(size_t)spec->outputIndex("out")][kChunk - 1]) < 1e-3f);
    }

    // A changed source is another type, so a node that runs the old module gets the new one when the board is recompiled.
    auto* edited = new juce::DynamicObject();
    edited->setProperty("source", "// another source");
    edited->setProperty("interface", iface);
    edited->setProperty("settings", juce::var(new juce::DynamicObject()));
    const BoardModel model2 = board::parse(board::sanitise(doc(juce::var(edited))));
    const NodeModel* m2 = model2.node("c1");
    EXPECT(m2 && m2->type != typeId && m2->type.rfind("code:c1:", 0) == 0);
    EXPECT(m2 && Registry::get().create(m2->type) == nullptr);   // not compiled yet: silent, but with its jacks
    EXPECT(codeTypeId("c2", codeJson.toStdString()) != typeId);   // and another node is another type

    // Refused: bytes that are not a Bleep module, and a node without source.
    const uint8_t junk[] = {0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00};
    error.clear();
    EXPECT(!registerCodeModule("c1", codeJson.toStdString(), junk, sizeof junk, error) && !error.empty());
    error.clear();
    EXPECT(!registerCodeModule("c1", "{}", static_cast<const uint8_t*>(wasm.getData()), wasm.getSize(), error));
    EXPECT(!registerCodeModule("c1", codeJson.toStdString(), nullptr, 0, error));

    // A patch script's Code node has no module: it stays a plain Code node and the board keeps its cell.
    auto* patchIface = new juce::DynamicObject();
    patchIface->setProperty("kind", "patch");
    patchIface->setProperty("name", "SuperSaw");
    auto* patchCode = new juce::DynamicObject();
    patchCode->setProperty("source", "export default cell(...)");
    patchCode->setProperty("interface", juce::var(patchIface));
    const juce::var patchBoard = board::sanitise(doc(juce::var(patchCode)));
    const auto* p1 = findNode(patchBoard, "c1");
    EXPECT(p1 && (*p1)["code"]["interface"]["kind"].toString() == "patch" && (*p1)["type"].toString() == "code");
    const BoardModel patchModel = board::parse(patchBoard);
    EXPECT(patchModel.node("c1") && patchModel.node("c1")->spec && patchModel.node("c1")->spec->type == kCode);

    // A Code node with no code yet is the plain type.
    const BoardModel empty = board::parse(board::sanitise(parseJson(R"({"nodes":[{"id":"e","type":"code","name":"Code","x":0,"y":0,"parent":"","params":{}}],"cables":[]})")));
    EXPECT(empty.node("e") && empty.node("e")->spec && empty.node("e")->spec->type == kCode);

    std::printf(g_failures ? "%d failure(s)\n" : "code node: all passed\n", g_failures);
    return g_failures ? 1 : 0;
}
