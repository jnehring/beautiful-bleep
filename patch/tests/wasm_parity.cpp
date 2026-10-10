// SPDX-License-Identifier: MIT
//
// Wasm parity: the gate for moving the apps to store modules (doc/specs/store.md section 13, M1).
//
// Every module type runs twice on the same input: compiled into this program, and as its module .wasm through the
// WasmModule host. The same knobs and modulation, node data, signals on every jack, notes, transport and harmony
// buses go in; the outputs, the notes coming out and the harmony buses are compared, and the CPU time of both is measured.
//
//   bleep_wasm_parity [--wasm DIR] [--seconds S] [--strict] [type ...]
//
// DIR is the output of scripts/build/build-web.sh --modules-only (default build/web/modules): modules/<slug>.wasm and
// manifest.json. A third run of the native module checks that it is deterministic at all.
#include "Board.h"
#include "Media.h"
#include "Registry.h"
#include "store/Client.h"
#include "wasm/InstalledModules.h"
#include "wasm/SpecJson.h"
#include "wasm/WasmModule.h"

#include "dsp/Harmony.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <random>
#include <set>

using namespace bleep::engine;
using Clock = std::chrono::steady_clock;

namespace {

constexpr int kChunk = 32, kRate = 48000;

std::vector<uint8_t> readFile(const juce::File& f) {
    juce::MemoryBlock block;
    f.loadFileAsData(block);
    return std::vector<uint8_t>((const uint8_t*)block.getData(), (const uint8_t*)block.getData() + block.getSize());
}

/// Everything one module instance sees, kept apart per instance (a module may write into its inputs' neighbours: it must not matter).
struct Rig {
    const ModuleSpec& spec;
    std::vector<std::vector<float>> params, inputs, outputs;
    std::vector<const float*> paramPtrs, inputPtrs;
    std::vector<float*> outputPtrs;
    std::vector<NoteBuffer> notesIn, notesOut;
    std::vector<const NoteBuffer*> notesInPtrs;
    std::vector<NoteBuffer*> notesOutPtrs;
    std::unique_ptr<bool[]> inConnected, outConnected;
    bleep::dsp::HarmonyState harmony[bleep::dsp::kHarmonyBuses];

    explicit Rig(const ModuleSpec& s) : spec(s) {
        const size_t np = s.params.size(), ni = s.inputs.size(), no = s.outputs.size();
        params.assign(np, std::vector<float>(kChunk));
        inputs.assign(ni, std::vector<float>(kChunk));
        outputs.assign(no, std::vector<float>(kChunk));
        notesIn.resize(ni);
        notesOut.resize(no);
        inConnected.reset(new bool[ni + 1]);
        outConnected.reset(new bool[no + 1]);
        for (size_t i = 0; i < np; ++i) paramPtrs.push_back(params[i].data());
        for (size_t i = 0; i < ni; ++i) {
            const bool notes = s.inputs[i].type == Signal::Notes;
            inputPtrs.push_back(notes ? nullptr : inputs[i].data());
            notesInPtrs.push_back(notes ? &notesIn[i] : nullptr);
            inConnected[i] = true;
        }
        for (size_t j = 0; j < no; ++j) {
            const bool notes = s.outputs[j].type == Signal::Notes;
            outputPtrs.push_back(notes ? nullptr : outputs[j].data());
            notesOutPtrs.push_back(notes ? &notesOut[j] : nullptr);
            outConnected[j] = true;
        }
        harmony[0] = bleep::dsp::makeHarmony(2, 0xab5, 7, 0);  // D major, G chord: what readers follow when nobody publishes
    }

    ProcessContext context(const Transport& t, int voice, bool started, double ppq) {
        ProcessContext c;
        c.numSamples = kChunk;
        c.transport = &t;
        c.transportStarted = started;
        c.ppqStart = ppq;
        c.ppqPerSample = t.bpm / 60.0 / kRate;
        c.params = paramPtrs.data();
        c.inputs = inputPtrs.data();
        c.inputConnected = inConnected.get();
        c.notesIn = notesInPtrs.data();
        c.outputs = outputPtrs.data();
        c.notesOut = notesOutPtrs.data();
        c.outputConnected = outConnected.get();
        c.harmony = harmony;
        c.voice = voice;
        return c;
    }
};

/// The same random input for every instance: a stream seeded per module type.
/// A sample for the modules that play one (set up in main): its media id and length.
std::string g_clipId;
int64_t g_clipFrames = 0;

/// What a player does to modules that only play when touched (their views' buttons and keys), by chunk.
struct Gesture {
    int chunk;
    std::string action;
    std::vector<double> args;
};
std::vector<Gesture> gesturesFor(const std::string& type) {
    if (type == "button") return {{5, "press", {}}, {40, "release", {}}, {80, "press", {1}}, {160, "press", {}}, {200, "press", {}}};
    if (type == "keyboard")
        return {{5, "on", {60, 0.8}}, {50, "off", {60}}, {70, "on", {64}}, {72, "on", {67, 0.4}}, {140, "off", {64}}, {260, "allOff", {}}, {300, "on", {50}}};
    return {};
}

struct Stimulus {
    std::mt19937 rng;
    std::vector<float> walk;      // per input jack: the value of a slow signal
    std::vector<int> gateLeft;    // per input jack: samples until a gate flips
    std::vector<bool> gateHigh;
    explicit Stimulus(const ModuleSpec& s, uint32_t seed) : rng(seed), walk(s.inputs.size(), 0.0f), gateLeft(s.inputs.size(), 0), gateHigh(s.inputs.size(), false) {}

    float uni() { return std::uniform_real_distribution<float>(0.0f, 1.0f)(rng); }
    int range(int a, int b) { return std::uniform_int_distribution<int>(a, b)(rng); }

    /// One chunk of every input jack, written to every rig given (all see the same numbers).
    void inputs(const ModuleSpec& s, int chunk, std::vector<Rig*>& rigs) {
        for (size_t i = 0; i < s.inputs.size(); ++i) {
            std::vector<float> v(kChunk);
            NoteBuffer notes;
            switch (s.inputs[i].type) {
                case Signal::Audio:
                    for (int k = 0; k < kChunk; ++k) {
                        const float env = std::exp(-(float)((chunk * kChunk + k) % 12000) / 3000.0f);
                        v[(size_t)k] = (uni() * 2.0f - 1.0f) * 0.4f * env + 0.2f * std::sin(0.05f * (float)(chunk * kChunk + k));
                    }
                    break;
                case Signal::Control:
                case Signal::Pitch:
                    if (chunk % 40 == 0) walk[i] = s.inputs[i].type == Signal::Pitch ? (float)range(-12, 12) / 12.0f : uni() * 2.0f - 1.0f;
                    std::fill(v.begin(), v.end(), walk[i]);
                    break;
                case Signal::Gate:
                    for (int k = 0; k < kChunk; ++k) {
                        if (--gateLeft[i] <= 0) { gateHigh[i] = !gateHigh[i]; gateLeft[i] = range(200, 6000); }
                        v[(size_t)k] = gateHigh[i] ? 1.0f : 0.0f;
                    }
                    break;
                case Signal::Trigger:
                    if (uni() < 0.01f) v[(size_t)range(0, kChunk - 1)] = 1.0f;
                    break;
                case Signal::Notes:
                    if (uni() < 0.04f) {
                        NoteEvent e;
                        e.type = uni() < 0.6f ? NoteEvent::On : NoteEvent::Off;
                        e.note = range(48, 72);
                        e.pitch = (float)(e.note - 60) / 12.0f;
                        e.value = 0.3f + 0.6f * uni();
                        e.offset = (int16_t)range(0, kChunk - 1);
                        notes.push(e);
                    }
                    break;
            }
            for (Rig* r : rigs) {
                if (s.inputs[i].type == Signal::Notes) r->notesIn[i] = notes;
                else r->inputs[i] = v;
            }
        }
    }
};

// ---- the description of a node type: the module's own against the native one -----------------------------------------

bool varEqual(const juce::var& a, const juce::var& b, std::string& where, const std::string& path = "") {
    auto numeric = [](const juce::var& v) { return v.isInt() || v.isInt64() || v.isDouble(); };
    if (numeric(a) && numeric(b)) {
        const double x = (double)a, y = (double)b;
        if (std::fabs(x - y) <= 1e-5 * std::max(1.0, std::fabs(x))) return true;
        where = path + ": " + std::to_string(x) + " vs " + std::to_string(y);
        return false;
    }
    if (a.isString() || b.isString()) {
        if (a.isString() && b.isString() && a.toString() == b.toString()) return true;
        where = path + ": \"" + a.toString().toStdString() + "\" vs \"" + b.toString().toStdString() + "\"";
        return false;
    }
    if (a.isBool() || b.isBool()) {
        if (a.isBool() && b.isBool() && (bool)a == (bool)b) return true;
        where = path + ": a flag differs";
        return false;
    }
    if (auto* x = a.getArray()) {
        auto* y = b.getArray();
        if (!y || x->size() != y->size()) { where = path + ": lists of different length"; return false; }
        for (int i = 0; i < x->size(); ++i)
            if (!varEqual((*x)[i], (*y)[i], where, path + "[" + std::to_string(i) + "]")) return false;
        return true;
    }
    if (auto* x = a.getDynamicObject()) {
        auto* y = b.getDynamicObject();
        if (!y) { where = path + ": not an object"; return false; }
        for (const auto& p : x->getProperties()) {
            if (!y->hasProperty(p.name)) { where = path + "/" + p.name.toString().toStdString() + ": only in the first"; return false; }
            if (!varEqual(p.value, y->getProperty(p.name), where, path + "/" + p.name.toString().toStdString())) return false;
        }
        for (const auto& p : y->getProperties())
            if (!x->hasProperty(p.name)) { where = path + "/" + p.name.toString().toStdString() + ": only in the second"; return false; }
        return true;
    }
    if (a.isVoid() && b.isVoid()) return true;
    where = path + ": different kinds of value";
    return false;
}

/// "" if `rebuilt` (made from a module's own description) is the native spec; otherwise what differs.
std::string structDiff(const ModuleSpec& native, const ModuleSpec& rebuilt);

/// "" if the module's own description of the type is the native one and rebuilds the native spec; otherwise what differs.
std::string specDiff(const ModuleSpec& native, const std::shared_ptr<WasmPackage>& package) {
    juce::var nativeJson;
    const juce::var nativeAll = board::describeTypes();  // kept alive while its list is read
    for (const auto& t : *nativeAll.getArray())
        if (t["type"].toString().toStdString() == native.type) nativeJson = t;
    juce::var wasmJson;
    const juce::var all = juce::JSON::parse(juce::String(package->specJson));
    for (int i = 0; i < all.size(); ++i)
        if (all[i]["type"].toString().toStdString() == native.type) wasmJson = all[i];
    std::string where;
    if (!varEqual(nativeJson, wasmJson, where, "description")) return where;
    ModuleSpec rebuilt;
    std::string error;
    if (!specFromJson(wasmJson, rebuilt, error)) return "cannot rebuild the spec: " + error;
    const int index = package->indexOf(native.type);
    rebuilt.sanitiseData = [package, index](const std::string& json) { return package->sanitiseData(index, json); };
    return structDiff(native, rebuilt);
}

std::string structDiff(const ModuleSpec& native, const ModuleSpec& rebuilt) {
    std::string where;
    auto same = [&](const char* what, bool ok) { if (!ok && where.empty()) where = std::string("rebuilt spec: ") + what; };
    same("type/name/category/colour/description", rebuilt.type == native.type && rebuilt.name == native.name && rebuilt.category == native.category &&
                                                      rebuilt.colour == native.colour && rebuilt.description == native.description);
    same("flags", rebuilt.userCreatable == native.userCreatable && rebuilt.standaloneOnly == native.standaloneOnly && rebuilt.memoryHeavy == native.memoryHeavy &&
                      rebuilt.groupColumns == native.groupColumns && rebuilt.harmony == native.harmony && rebuilt.port == native.port);
    same("number of params/inputs/outputs/buttons", rebuilt.params.size() == native.params.size() && rebuilt.inputs.size() == native.inputs.size() &&
                                                         rebuilt.outputs.size() == native.outputs.size() && rebuilt.buttons.size() == native.buttons.size());
    if (!where.empty()) return where;
    for (size_t i = 0; i < native.params.size(); ++i) {
        const ParamSpec &a = native.params[i], &b = rebuilt.params[i];
        const std::string at = "param " + a.id;
        same((at + " fields").c_str(), a.id == b.id && a.name == b.name && a.kind == b.kind && a.map == b.map && a.format == b.format && a.decimals == b.decimals &&
                                           a.label == b.label && a.choices == b.choices && a.choiceGroups == b.choiceGroups && a.modulatable == b.modulatable &&
                                           a.group == b.group && a.names == b.names && a.namesBy == b.namesBy && a.show.param == b.show.param &&
                                           a.show.min == b.show.min && a.show.max == b.show.max);
        for (float x : {0.0f, 0.1f, 0.25f, 0.5f, 0.75f, 1.0f}) {
            const float u = a.fromNormalised(x), v = b.fromNormalised(x);
            same((at + " maps differently").c_str(), std::fabs(u - v) <= 1e-4f * std::max(1.0f, std::fabs(u)));
            same((at + " shows differently").c_str(), a.text(u) == b.text(v));
        }
        same((at + " default").c_str(), std::fabs(a.defaultNormalised() - b.defaultNormalised()) < 1e-5f);
    }
    for (size_t i = 0; i < native.inputs.size(); ++i) {
        const JackSpec &a = native.inputs[i], &b = rebuilt.inputs[i];
        same(("input " + a.id).c_str(), a.id == b.id && a.name == b.name && a.type == b.type && a.bipolar == b.bipolar && a.normal == b.normal);
    }
    for (size_t i = 0; i < native.outputs.size(); ++i) {
        const JackSpec &a = native.outputs[i], &b = rebuilt.outputs[i];
        same(("output " + a.id).c_str(), a.id == b.id && a.name == b.name && a.type == b.type && a.bipolar == b.bipolar && a.normal == b.normal);
    }
    for (size_t i = 0; i < native.buttons.size(); ++i)
        same("button", native.buttons[i].id == rebuilt.buttons[i].id && native.buttons[i].name == rebuilt.buttons[i].name &&
                           native.buttons[i].momentary == rebuilt.buttons[i].momentary);
    // the node data a new node starts with
    if (native.sanitiseData) {
        same("node data: the rebuilt spec has no sanitiser", (bool)rebuilt.sanitiseData);
        if (rebuilt.sanitiseData) {
            same("node data defaults", rebuilt.sanitiseData("") == native.sanitiseData(""));
            same("node data of broken JSON", rebuilt.sanitiseData("{not json") == native.sanitiseData("{not json"));
        }
    }
    return where;
}

struct Outcome {
    std::string status = "ok";
    double diff = 0, peak = 0, selfDiff = 0;
    double nativeNs = 0, wasmNs = 0;
    std::string note;
};

bool notesEqual(const NoteBuffer& a, const NoteBuffer& b) {
    if (a.count != b.count) return false;
    for (int k = 0; k < a.count; ++k) {
        const NoteEvent &x = a.events[k], &y = b.events[k];
        if (x.type != y.type || x.channel != y.channel || x.offset != y.offset || x.note != y.note || std::fabs(x.pitch - y.pitch) > 1e-4f ||
            std::fabs(x.value - y.value) > 1e-4f)
            return false;
    }
    return true;
}

using Factory = std::function<std::unique_ptr<Module>()>;

Outcome compare(const ModuleSpec& spec, const Factory& makeNative, const Factory& makeTwin, const Factory& makeWasm, const std::string& specProblem, double seconds) {
    Outcome out;
    if (!specProblem.empty()) {
        out.status = "SPEC DIFFERS";
        out.note = specProblem;
        return out;
    }
    auto native = makeNative();
    auto twin = makeTwin();
    auto wasmMod = makeWasm();
    auto* wm = dynamic_cast<WasmModule*>(wasmMod.get());
    if (!wm) {
        out.status = "NOT WASM";
        out.note = "the registry made a module that is not a WasmModule";
        return out;
    }
    native->prepare(kRate);
    twin->prepare(kRate);
    wasmMod->prepare(kRate);
    if (!wm->ok()) {
        out.status = "LOAD FAILED";
        out.note = wm->error();
        return out;
    }
    std::string initial;
    if (spec.type == "sampler" && !g_clipId.empty())
        initial = "{\"clip\":\"" + g_clipId + "\",\"length\":" + std::to_string(g_clipFrames) + ",\"markers\":[0,24000,48000,72000]}";
    const std::string data = spec.sanitiseData ? spec.sanitiseData(initial) : std::string();
    if (!data.empty()) {
        native->setData(data);
        twin->setData(data);
        wasmMod->setData(data);
    }
    // wavetable-osc builds its factory banks on background threads when the native module starts (the wasm build has none and builds
    // a bank when it is first used), so a bank picked in the first moments is there at once in one and later in the other.
    if (spec.type == "wavetable-osc") juce::Thread::sleep(4000);
    // and a sample is read by the wasm module on a worker thread, answered when it is there (module-abi.md, "Media"): wait for it
    if (!initial.empty()) {  // the wasm module asks for the sample while it takes its data, in process; give it the chunks and the time to get it
        Rig warm(spec);
        Transport wt;
        wt.sampleRate = kRate;
        for (int round = 0; round < 4; ++round) {
            auto c = warm.context(wt, 0, false, 0.0);
            wasmMod->process(c);
            juce::Thread::sleep(250);
        }
    }
    native->reset();
    twin->reset();
    wasmMod->reset();

    Rig rn(spec), rt(spec), rw(spec);
    std::vector<Rig*> rigs{&rn, &rt, &rw};
    Stimulus stim(spec, std::hash<std::string>{}(spec.type));
    const int voice = 3;  // inside a Voice Cell: the modules that use it must see the same number
    const int chunks = (int)(seconds * kRate / kChunk);
    Transport t;
    t.sampleRate = kRate;
    t.playing = true;
    t.ppqValid = true;  // the shim says so too: modules with a Sync setting then follow the beat
    t.bpm = 117.0;
    double nativeTime = 0, wasmTime = 0;
    double peak = 0, diff = 0, selfDiff = 0, sumN = 0, sumW = 0;
    bool firstDiff = false, notesSeen = false;
    const std::vector<Gesture> gestures = gesturesFor(spec.type);
    std::vector<float> base(spec.params.size());
    for (size_t i = 0; i < base.size(); ++i) base[i] = spec.params[i].defaultNormalised();

    {  // ask for the view's numbers from the start: the module then publishes them as it runs
        std::vector<std::pair<std::string, double>> ignore;
        wasmMod->liveValues(ignore);
    }
    for (int chunk = 0; chunk < chunks && out.status == "ok"; ++chunk) {
        // knobs: a few change now and then, the others are modulated by a slow wave
        if (chunk % 150 == 75)
            for (size_t i = 0; i < base.size(); ++i)
                if (stim.uni() < 0.3f) {
                    base[i] = stim.uni();
                    native->setKnob((int)i, base[i]);
                    twin->setKnob((int)i, base[i]);
                    wasmMod->setKnob((int)i, base[i]);
                }
        for (size_t i = 0; i < base.size(); ++i) {
            const float m = spec.params[i].modulatable && (i % 3 == 0) ? 0.25f * std::sin(0.002f * (float)chunk * (1.0f + (float)i)) : 0.0f;
            for (int k = 0; k < kChunk; ++k) {
                const float v = std::clamp(base[i] + m * (1.0f + 0.01f * (float)k), 0.0f, 1.0f);
                // swarm's ring of phase modulation amplifies the last bit of sin/exp (which the host's libm and the wasm build's
                // round differently) into a different waveform of the same level. To tell that from a bug, its second native
                // run has every knob moved by 1e-6: if that alone makes the runs differ, the module is chaotic, and only its
                // level is compared (like the random modules).
                for (Rig* r : rigs) r->params[i][(size_t)k] = (r == &rt && spec.type == "swarm") ? std::min(1.0f, v + 1e-6f) : v;
            }
        }
        for (const auto& g : gestures)
            if (g.chunk == chunk) {
                native->perform(g.action, g.args);
                twin->perform(g.action, g.args);
                wasmMod->perform(g.action, g.args);
            }
        stim.inputs(spec, chunk, rigs);
        t.samplePos = (int64_t)chunk * kChunk;
        const double ppq = (double)t.samplePos * t.bpm / 60.0 / kRate;
        t.ppq = ppq;
        const bool started = chunk == 0;
        for (Rig* r : rigs) {
            for (auto& nb : r->notesOut) nb.clear();
            std::fill(r->outputs.begin(), r->outputs.end(), std::vector<float>(kChunk, 0.0f));
        }
        auto c1 = rn.context(t, voice, started, ppq), c2 = rt.context(t, voice, started, ppq), c3 = rw.context(t, voice, started, ppq);
        auto a = Clock::now();
        native->process(c1);
        auto b = Clock::now();
        twin->process(c2);
        auto d = Clock::now();
        wasmMod->process(c3);
        auto e = Clock::now();
        nativeTime += std::chrono::duration<double>(b - a).count();
        wasmTime += std::chrono::duration<double>(e - d).count();
        if (!wm->ok()) {
            out.status = "TRAPPED";
            out.note = wm->error();
            break;
        }
        for (size_t j = 0; j < spec.outputs.size(); ++j) {
            if (spec.outputs[j].type == Signal::Notes) {
                if (!notesEqual(rn.notesOut[j], rw.notesOut[j])) { out.status = "NOTES DIFFER"; out.note = spec.outputs[j].id + " at chunk " + std::to_string(chunk); }
                if (!notesEqual(rn.notesOut[j], rt.notesOut[j])) selfDiff = 1.0;
                notesSeen = notesSeen || rn.notesOut[j].count > 0;
                continue;
            }
            for (int k = 0; k < kChunk; ++k) {
                const float n = rn.outputs[j][(size_t)k], w = rw.outputs[j][(size_t)k], s = rt.outputs[j][(size_t)k];
                if (!std::isfinite(w) && std::isfinite(n)) { out.status = "NOT FINITE"; out.note = spec.outputs[j].id; }
                peak = std::max(peak, (double)std::fabs(n));
                sumN += (double)n * n;
                sumW += (double)w * w;
                diff = std::max(diff, (double)std::fabs(n - w));
                if (std::fabs(n - w) > (std::getenv("BLEEP_PARITY_EPS") ? std::atof(std::getenv("BLEEP_PARITY_EPS")) : 1e-3) && !firstDiff && std::getenv("BLEEP_PARITY_DEBUG")) {
                    firstDiff = true;
                    std::printf("  [%s] first difference: output %s, chunk %d, sample %d: native %g wasm %g\n", spec.type.c_str(), spec.outputs[j].id.c_str(), chunk, k, (double)n, (double)w);
                }
                selfDiff = std::max(selfDiff, (double)std::fabs(n - s));
            }
        }
        for (int b = 0; b < bleep::dsp::kHarmonyBuses; ++b)
            if (!bleep::dsp::sameHarmony(rn.harmony[b], rw.harmony[b])) { out.status = "HARMONY DIFFERS"; out.note = "bus " + std::to_string(b) + " at chunk " + std::to_string(chunk); }
    }
    const double samples = (double)chunks * kChunk;
    out.diff = diff;
    out.peak = peak;
    out.selfDiff = selfDiff;
    out.nativeNs = nativeTime * 1e9 / samples;
    out.wasmNs = wasmTime * 1e9 / samples;
    if (out.status == "ok") {
        if (selfDiff > 1e-6) {  // random by design (noise, random sources): the two native runs differ too, so compare what they have in common
            const double rn = std::sqrt(sumN / samples), rw = std::sqrt(sumW / samples);
            const bool close = std::fabs(rn - rw) <= 0.1 * rn + 1e-4;
            out.status = close ? (spec.type == "swarm" ? "ok (chaotic: same level)" : "ok (random: same level)") : "DIFFERS (random: other level)";
            out.note = "native twice: " + std::to_string(selfDiff) + " apart; rms " + std::to_string(rn) + " native, " + std::to_string(rw) + " wasm";
        }
        else if (peak < 1e-6 && !notesSeen) out.status = "SILENT";
        else if (diff > 1e-3 * std::max(peak, 1.0)) out.status = "DIFFERS";
    }
    // the view's calls must not break anything either
    std::vector<std::pair<std::string, double>> live;
    std::vector<std::pair<std::string, std::vector<float>>> arrays;
    wasmMod->liveValues(live);
    if (std::getenv("BLEEP_PARITY_DEBUG")) {
        std::vector<std::pair<std::string, double>> nl;
        native->liveValues(nl);
        for (const auto& [k, v] : live) std::printf("  [%s] live %s: wasm %g\n", spec.type.c_str(), k.c_str(), v);
        for (const auto& [k, v] : nl) std::printf("  [%s] live %s: native %g\n", spec.type.c_str(), k.c_str(), v);
    }
    wasmMod->liveArrays(arrays);
    return out;
}

}  // namespace

int main(int argc, char** argv) {
    juce::File dir = juce::File::getCurrentWorkingDirectory().getChildFile("build/web/modules");
    double seconds = 4.0;
    bool strict = false;
    std::string installedDir, rootFile;
    std::set<std::string> only;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--wasm" && i + 1 < argc) dir = juce::File::getCurrentWorkingDirectory().getChildFile(argv[++i]);
        else if (a == "--seconds" && i + 1 < argc) seconds = std::atof(argv[++i]);
        else if (a == "--strict") strict = true;
        else if (a == "--installed" && i + 1 < argc) installedDir = argv[++i];
        else if (a == "--root" && i + 1 < argc) rootFile = argv[++i];
        else only.insert(a);
    }
    {  // a sample for the modules that play one: two seconds of a decaying tone with a click at every slice
        const juce::File folder = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("bleep-parity-media");
        folder.createDirectory();
        bleep::engine::media::setFolder(folder.getFullPathName().toStdString());
        bleep::engine::MediaClip clip;
        clip.sampleRate = 48000.0;
        clip.channels.assign(2, std::vector<float>(96000));
        for (size_t i = 0; i < 96000; ++i) {
            const float e = std::exp(-(float)(i % 24000) / 5000.0f);
            clip.channels[0][i] = 0.6f * e * std::sin(0.03f * (float)i * (1.0f + (float)(i / 24000) * 0.25f));
            clip.channels[1][i] = 0.5f * e * std::sin(0.021f * (float)i);
        }
        g_clipId = bleep::engine::media::save(clip);
        g_clipFrames = 96000;
    }
    std::printf("%-22s %-26s %9s %8s %8s %8s %6s  %s\n", "type", "status", "max diff", "peak", "native", "wasm", "x", "note");
    int total = 0, passed = 0;
    std::vector<std::string> bad;
    std::vector<double> ratios;
    auto report = [&](const std::string& type, const Outcome& o) {
        ++total;
        const double ratio = o.nativeNs > 0 ? o.wasmNs / o.nativeNs : 0;
        std::printf("%-22s %-26s %9.2e %8.3f %7.0fn %7.0fn %6.2f  %s\n", type.c_str(), o.status.c_str(), o.diff, o.peak, o.nativeNs, o.wasmNs, ratio,
                    o.note.substr(0, 90).c_str());
        if (o.status.rfind("ok", 0) == 0) { ++passed; if (ratio > 0) ratios.push_back(ratio); }
        else bad.push_back(type + " (" + o.status + ")");
    };

    if (!installedDir.empty()) {
        // The path the apps take: modules installed in a data folder, checked, registered, created through the registry.
        const juce::File data = juce::File::getCurrentWorkingDirectory().getChildFile(installedDir);
        std::vector<std::vector<uint8_t>> roots;
        if (!rootFile.empty()) roots.push_back(bleep::store::fromHex(juce::File::getCurrentWorkingDirectory().getChildFile(rootFile).loadFileAsString().trim().toStdString()));
        const bleep::store::Client client(bleep::store::Settings::load(data), data, roots);
        // native twins first: once the registry has the installed module, create() makes that one
        struct Pair { std::unique_ptr<Module> native, twin; const ModuleSpec* spec; };
        std::map<std::string, Pair> natives;
        for (const ModuleSpec* s : Registry::get().all())
            if (s->port == PortKind::None && s->userCreatable) natives[s->type] = Pair{Registry::get().create(s->type), Registry::get().create(s->type), s};
        const auto reports = loadInstalledModules(Registry::instance(), client);
        for (const auto& r : reports) {
            if (!r.loaded) { std::printf("%-22s %-26s  %s\n", r.slug.c_str(), ("NOT LOADED (" + r.status + ")").c_str(), r.why.c_str()); ++total; bad.push_back(r.slug + " (not loaded)"); continue; }
            for (const auto& type : r.types) {
                if (!only.empty() && !only.count(type) && !only.count(r.slug)) continue;
                auto it = natives.find(type);
                if (it == natives.end()) { std::printf("%-22s %-26s  no native module of this type to compare with\n", type.c_str(), "NEW TYPE"); continue; }
                const ModuleSpec* now = Registry::get().find(type);
                const std::string problem = structDiff(*it->second.spec, *now);
                Pair& p = it->second;
                report(type, compare(*it->second.spec, [&] { return std::move(p.native); }, [&] { return std::move(p.twin); },
                                     [&] { return Registry::get().create(type); }, problem, seconds));
            }
        }
    } else {
        const juce::var manifest = juce::JSON::parse(dir.getChildFile("manifest.json"));
        if (!manifest["modules"].getDynamicObject()) {
            std::fprintf(stderr, "no manifest.json in %s (scripts/build/build-web.sh --modules-only)\n", dir.getFullPathName().toRawUTF8());
            return 2;
        }
        for (const auto& module : manifest["modules"].getDynamicObject()->getProperties()) {
            const std::string slug = module.name.toString().toStdString();
            std::vector<std::string> types;
            for (const auto& t : *module.value["types"].getArray()) types.push_back(t.toString().toStdString());
            if (!only.empty() && std::none_of(types.begin(), types.end(), [&](const std::string& t) { return only.count(t) || only.count(slug); })) continue;
            std::string error;
            const auto bytes = readFile(dir.getChildFile("modules/" + juce::String(slug) + ".wasm"));
            auto package = WasmPackage::load(bytes.data(), bytes.size(), error);
            for (const auto& type : types) {
                const ModuleSpec* spec = Registry::get().find(type);
                if (!spec) continue;
                Outcome o;
                if (!package) { o.status = "LOAD FAILED"; o.note = error; report(type, o); continue; }
                report(type, compare(*spec, [&] { return Registry::get().create(type); }, [&] { return Registry::get().create(type); },
                                     [&] { return std::make_unique<WasmModule>(*spec, package); }, specDiff(*spec, package), seconds));
            }
        }
    }
    std::sort(ratios.begin(), ratios.end());
    std::printf("\n%d of %d module types match their native build", passed, total);
    if (!ratios.empty()) std::printf("; wasm costs %.2fx native in the median, %.2fx at worst", ratios[ratios.size() / 2], ratios.back());
    std::printf("\n");
    for (const auto& b : bad) std::printf("  not ok: %s\n", b.c_str());
    return strict && !bad.empty() ? 1 : 0;
}
