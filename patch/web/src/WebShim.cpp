// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// WebShim.cpp — turns ONE module into a standalone WebAssembly file.
//
// The browser build links each module's .cpp (plus its header-only DSP) with
// this file into its own .wasm: no JUCE, no Emscripten JS glue, no shared
// memory with other modules. A JS host (web/js/) instantiates the file with
// plain WebAssembly.instantiate(), asks it for its spec (the same JSON the
// board UI gets from describeTypes()) and runs it chunk by chunk through the
// small C ABI at the bottom. The graph runner (Program.cpp's job in the
// plugins) is web/js/graph.js.
//
// Build: scripts/build/build-web.sh, which passes -DBLEEP_WEB_REGISTER=<fn> for
// modules that register by hand and relies on BLEEP_REGISTER_MODULE otherwise.
#include "HostControl.h"
#include "Registry.h"
#include "dsp/Harmony.h"

#include <algorithm>
#include <array>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define BLEEP_EXPORT extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define BLEEP_EXPORT extern "C"
#endif

// The build writes web_register.h for modules that register by hand (the
// register functions Registry.cpp calls in the plugins):
//   BLEEP_WEB_DECLARE     void registerFooModule(Registry&);
//   BLEEP_WEB_REGISTER    registerFooModule(*this);
// Modules using BLEEP_REGISTER_MODULE need nothing.
#if __has_include("web_register.h")
#include "web_register.h"
#endif
#ifdef BLEEP_WEB_DECLARE
namespace bleep::engine {
BLEEP_WEB_DECLARE
}
#endif

namespace bleep::engine {

// ---- a registry with just this module ---------------------------------------

namespace {
std::vector<std::pair<std::string, RegisterFn>>& autoRegistered() {
    static std::vector<std::pair<std::string, RegisterFn>> list;
    return list;
}
}  // namespace

AutoRegister::AutoRegister(const char* name, RegisterFn fn) { autoRegistered().emplace_back(name, fn); }

const Registry& Registry::get() {
    static const Registry registry;
    return registry;
}

Registry::Registry() {
#ifdef BLEEP_WEB_REGISTER
    BLEEP_WEB_REGISTER
#endif
    for (const auto& [name, fn] : autoRegistered()) fn(*this);
}

void Registry::add(ModuleSpec spec, Factory factory) {
    Entry e{std::make_unique<ModuleSpec>(std::move(spec)), std::move(factory)};
    order_.push_back(e.spec.get());
    entries_.push_back(std::move(e));
}

const ModuleSpec* Registry::find(const std::string& type) const noexcept {
    for (const auto& e : entries_)
        if (e.spec->type == type) return e.spec.get();
    return nullptr;
}

const ModuleSpec* Registry::forPort(PortKind) const noexcept { return nullptr; }

std::unique_ptr<Module> Registry::create(const std::string& type) const {
    for (const auto& e : entries_)
        if (e.spec->type == type) return e.factory ? e.factory(*e.spec) : nullptr;
    return nullptr;
}

}  // namespace bleep::engine

namespace {

using namespace bleep::engine;

// ---- the spec as JSON (mirrors board::describeTypes in Board.cpp) ----------

void quote(std::string& out, const std::string& s) {
    out += '"';
    for (const unsigned char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof buf, "\\u%04x", c);
                    out += buf;
                } else {
                    out += (char)c;
                }
        }
    }
    out += '"';
}

std::string num(double v) {
    char buf[40];
    std::snprintf(buf, sizeof buf, "%.9g", v);
    return buf;
}

void stringList(std::string& out, const std::vector<std::string>& list) {
    out += '[';
    for (size_t i = 0; i < list.size(); ++i) {
        if (i) out += ',';
        quote(out, list[i]);
    }
    out += ']';
}

void showAndNames(std::string& out, const ShowIf& show, const std::string& namesBy,
                  const std::vector<std::string>& names) {
    // the same shape as board::describeTypes(): "show" {param, min, max} and "names" {by, list}
    if (show.active()) {
        out += ",\"show\":{\"param\":";
        quote(out, show.param);
        out += ",\"min\":" + std::to_string(show.min) + ",\"max\":" + std::to_string(show.max);
        if (!show.param2.empty()) {
            out += ",\"param2\":";
            quote(out, show.param2);
            out += ",\"min2\":" + std::to_string(show.min2) + ",\"max2\":" + std::to_string(show.max2);
        }
        out += "}";
    }
    if (!namesBy.empty() && !names.empty()) {
        out += ",\"names\":{\"by\":";
        quote(out, namesBy);
        out += ",\"list\":";
        stringList(out, names);
        out += "}";
    }
}

void jackList(std::string& out, const std::vector<JackSpec>& list) {
    out += '[';
    for (size_t i = 0; i < list.size(); ++i) {
        const JackSpec& j = list[i];
        if (i) out += ',';
        out += "{\"id\":";
        quote(out, j.id);
        out += ",\"name\":";
        quote(out, j.name);
        out += ",\"type\":";
        quote(out, signalName(j.type));
        out += std::string(",\"bipolar\":") + (j.bipolar ? "true" : "false");
        showAndNames(out, j.show, j.namesBy, j.names);
        if (!j.normal.empty()) {
            out += ",\"normal\":";
            quote(out, j.normal);
        }
        out += '}';
    }
    out += ']';
}

std::string describe(const ModuleSpec& s) {
    std::string out = "{\"type\":";
    quote(out, s.type);
    out += ",\"name\":";
    quote(out, s.name);
    out += ",\"category\":";
    quote(out, s.category);
    out += ",\"colour\":";
    quote(out, s.colour);
    out += ",\"description\":";
    quote(out, s.description);
    out += ",\"port\":";
    quote(out, portKindName(s.port));
    out += std::string(",\"creatable\":") + (s.userCreatable ? "true" : "false");
    out += std::string(",\"standaloneOnly\":") + (s.standaloneOnly ? "true" : "false");
    out += ",\"params\":[";
    for (size_t i = 0; i < s.params.size(); ++i) {
        const ParamSpec& p = s.params[i];
        if (i) out += ',';
        out += "{\"id\":";
        quote(out, p.id);
        out += ",\"name\":";
        quote(out, p.name);
        const char* kind = p.kind == ParamSpec::Kind::Choice ? "choice"
                           : p.kind == ParamSpec::Kind::Bool ? "bool"
                           : p.kind == ParamSpec::Kind::Int  ? "int"
                                                             : "float";
        out += std::string(",\"kind\":\"") + kind + "\"";
        out += ",\"default\":" + num(p.defaultNormalised());
        out += ",\"steps\":" + std::to_string(p.numSteps());
        out += std::string(",\"modulatable\":") + (p.modulatable ? "true" : "false");
        if (!p.choices.empty()) {
            out += ",\"choices\":";
            stringList(out, p.choices);
        }
        if (!p.choiceGroups.empty()) {
            out += ",\"groups\":";
            stringList(out, p.choiceGroups);
        }
        out += ",\"min\":" + num(p.min) + ",\"max\":" + num(p.max);
        out += ",\"def\":" + num(p.def);
        if (p.map == ParamSpec::Map::Exponential) out += ",\"map\":\"exp\"";
        if (p.map == ParamSpec::Map::Skew) out += ",\"map\":\"skew\",\"centre\":" + num(p.centre);
        out += std::string(",\"format\":\"") + formatName(p.format) + "\",\"decimals\":" + std::to_string(p.decimals);
        if (!p.label.empty()) {
            out += ",\"label\":";
            quote(out, p.label);
        }
        if (!p.group.empty()) {
            out += ",\"group\":";
            quote(out, p.group);
        }
        showAndNames(out, p.show, p.namesBy, p.names);
        out += '}';
    }
    out += "],\"inputs\":";
    jackList(out, s.inputs);
    out += ",\"outputs\":";
    jackList(out, s.outputs);
    if (!s.buttons.empty()) {
        out += ",\"buttons\":[";
        for (size_t i = 0; i < s.buttons.size(); ++i) {
            if (i) out += ',';
            out += "{\"id\":";
            quote(out, s.buttons[i].id);
            out += ",\"name\":";
            quote(out, s.buttons[i].name);
            out += std::string(",\"momentary\":") + (s.buttons[i].momentary ? "true" : "false") + "}";
        }
        out += ']';
    }
    if (s.memoryHeavy) out += ",\"memoryHeavy\":true";
    if (s.groupColumns) out += ",\"groupColumns\":true";
    if (s.harmony != HarmonyRole::None) out += std::string(",\"harmony\":\"") + (s.harmony == HarmonyRole::Writer ? "writer" : "reader") + "\"";
    out += '}';
    return out;
}

// ---- one running module -----------------------------------------------------

/// A module with its fixed-size buffers: the host writes inputs / params into
/// them (it learns where from the bleep_*_ptr calls), runs process, reads outputs.
struct Instance {
    std::unique_ptr<Module> module;
    const ModuleSpec* spec = nullptr;
    Transport transport;
    ProcessContext ctx;

    std::vector<float> paramData, inputData, outputData;  // [jack × kChunk]
    std::vector<const float*> paramPtrs, inputPtrs;
    std::vector<float*> outputPtrs;
    std::vector<NoteBuffer> notesIn, notesOut;
    std::vector<const NoteBuffer*> notesInPtrs;
    std::vector<NoteBuffer*> notesOutPtrs;
    std::vector<uint8_t> inConnected, outConnected;
    std::unique_ptr<bool[]> inFlags, outFlags;
    std::array<bleep::dsp::HarmonyState, bleep::dsp::kHarmonyBuses> harmony{};  // the board-wide buses, copied in and out by the host
    int voice = -1;              // the voice this instance plays inside a Voice Cell (-1: not in one)
    bool wasPlaying = false, startedPending = false;  // the transport started since the last chunk
    std::vector<char> scratch;   // strings and numbers crossing the boundary
    std::string text;            // the last string handed to JS
};


}  // namespace

// ---- the C ABI ---------------------------------------------------------------

namespace {
std::string& lastError() {
    static std::string e;
    return e;
}
/// C++ exceptions must not reach the audio thread: calls run through this; a
/// failure is kept for bleep_error() and the call returns `fallback`.
template <class R, class F>
R guarded(R fallback, F&& f) {
#if defined(__cpp_exceptions)   // modules built with juce_core need exceptions; the others are built without
    try {
        return f();
    } catch (const std::exception& e) {
        lastError() = e.what();
    } catch (...) {
        lastError() = "unknown exception";
    }
    return fallback;
#else
    (void)fallback;
    return f();
#endif
}
}  // namespace

/// The message of the last call that threw (empty: none).
BLEEP_EXPORT const char* bleep_error() { return lastError().c_str(); }

/// A file holds the module types of one folder (usually one). Their specs as
/// a JSON array, the same objects the board UI gets from describeTypes().
BLEEP_EXPORT const char* bleep_spec_json() {
    static const std::string json = [] {
        std::string out = "[";
        const auto& all = Registry::get().all();
        for (size_t i = 0; i < all.size(); ++i) out += (i ? "," : "") + describe(*all[i]);
        return out + "]";
    }();
    return json.c_str();
}
BLEEP_EXPORT int bleep_spec_json_length() { return (int)std::strlen(bleep_spec_json()); }
BLEEP_EXPORT int bleep_type_count() { return (int)Registry::get().all().size(); }
BLEEP_EXPORT int bleep_chunk() { return kChunk; }

/// A node type's data, made valid (ModuleSpec::sanitiseData): the input JSON is in the
/// scratch buffer of `h` (any instance), the result in bleep_text. -1: this type has no node data.
BLEEP_EXPORT int bleep_sanitise_data(void* h, int typeIndex, int length) { return guarded<int>(-1, [&]() -> int {
    auto* i = static_cast<Instance*>(h);
    const auto& all = Registry::get().all();
    if (typeIndex < 0 || typeIndex >= (int)all.size() || !all[(size_t)typeIndex]->sanitiseData) return -1;
    i->scratch[(size_t)length] = 0;
    i->text = all[(size_t)typeIndex]->sanitiseData(std::string(i->scratch.data(), (size_t)length));
    return (int)i->text.size();
}); }

/// A new instance of type `typeIndex` (the order of bleep_spec_json()).
BLEEP_EXPORT void* bleep_create(int typeIndex, double sampleRate) { return guarded<void*>(nullptr, [&]() -> void* {
    const auto& all = Registry::get().all();
    if (typeIndex < 0 || typeIndex >= (int)all.size()) return nullptr;
    const ModuleSpec& spec = *all[(size_t)typeIndex];
    auto inst = std::make_unique<Instance>();
    inst->module = Registry::get().create(spec.type);
    if (!inst->module) return nullptr;
    inst->spec = &spec;
    const size_t np = spec.params.size(), ni = spec.inputs.size(), no = spec.outputs.size();
    inst->paramData.assign(std::max<size_t>(np, 1) * kChunk, 0.0f);
    inst->inputData.assign(std::max<size_t>(ni, 1) * kChunk, 0.0f);
    inst->outputData.assign(std::max<size_t>(no, 1) * kChunk, 0.0f);
    inst->notesIn.resize(ni);
    inst->notesOut.resize(no);
    inst->inConnected.assign(ni + 1, 0);
    inst->outConnected.assign(no + 1, 1);
    inst->inFlags.reset(new bool[ni + 1]());
    inst->outFlags.reset(new bool[no + 1]());
    for (size_t i = 0; i < np; ++i) inst->paramPtrs.push_back(&inst->paramData[i * kChunk]);
    for (size_t i = 0; i < ni; ++i) {
        inst->inputPtrs.push_back(spec.inputs[i].type == Signal::Notes ? nullptr : &inst->inputData[i * kChunk]);
        inst->notesInPtrs.push_back(spec.inputs[i].type == Signal::Notes ? &inst->notesIn[i] : nullptr);
    }
    for (size_t i = 0; i < no; ++i) {
        inst->outputPtrs.push_back(spec.outputs[i].type == Signal::Notes ? nullptr : &inst->outputData[i * kChunk]);
        inst->notesOutPtrs.push_back(spec.outputs[i].type == Signal::Notes ? &inst->notesOut[i] : nullptr);
    }
    for (size_t i = 0; i < np; ++i)
        std::fill_n(&inst->paramData[i * kChunk], kChunk, spec.params[i].defaultNormalised());
    inst->transport.sampleRate = sampleRate;
    inst->module->prepare(sampleRate);
    inst->module->reset();
    return inst.release();
}); }

BLEEP_EXPORT void bleep_destroy(void* h) { delete static_cast<Instance*>(h); }
BLEEP_EXPORT void bleep_reset(void* h) { static_cast<Instance*>(h)->module->reset(); }

/// Where the host writes the per-sample effective parameter values (0..1), the
/// summed input signals, and reads the outputs: `count × kChunk` floats each.
BLEEP_EXPORT float* bleep_params_ptr(void* h) { return static_cast<Instance*>(h)->paramData.data(); }
BLEEP_EXPORT float* bleep_inputs_ptr(void* h) { return static_cast<Instance*>(h)->inputData.data(); }
BLEEP_EXPORT float* bleep_outputs_ptr(void* h) { return static_cast<Instance*>(h)->outputData.data(); }
/// One byte per input / output jack: 1 = patched / read by something.
BLEEP_EXPORT uint8_t* bleep_in_connected_ptr(void* h) { return static_cast<Instance*>(h)->inConnected.data(); }
BLEEP_EXPORT uint8_t* bleep_out_connected_ptr(void* h) { return static_cast<Instance*>(h)->outConnected.data(); }

/// The knob value (normalised) the module reads through setting()/knob().
BLEEP_EXPORT void bleep_set_knob(void* h, int index, float normalised) {
    static_cast<Instance*>(h)->module->setKnob(index, normalised);
}
BLEEP_EXPORT float bleep_output_display(void* h, int index) {
    return static_cast<Instance*>(h)->module->outputDisplay(index).value.load(std::memory_order_relaxed);
}
/// A buffer of `size` bytes in the module's memory for strings and numbers
/// going in (valid until the next bleep_scratch call).
BLEEP_EXPORT char* bleep_scratch(void* h, int size) {
    auto* i = static_cast<Instance*>(h);
    if ((int)i->scratch.size() < size + 1) i->scratch.resize((size_t)size + 1);
    return i->scratch.data();
}
/// A string going out: pointer to the bytes (not terminated) and its length.
BLEEP_EXPORT const char* bleep_text(void* h) { return static_cast<Instance*>(h)->text.c_str(); }
BLEEP_EXPORT int bleep_text_length(void* h) { return (int)static_cast<Instance*>(h)->text.size(); }

/// Node data (board document "data") as JSON, in the scratch buffer.
BLEEP_EXPORT void bleep_set_data(void* h, int length) { guarded(0, [&] {
    auto* i = static_cast<Instance*>(h);
    i->scratch[(size_t)length] = 0;
    i->module->setData(std::string(i->scratch.data(), (size_t)length));
return 0; }); }
/// A performance gesture; action in the scratch buffer (NUL-terminated), args as doubles after it.
BLEEP_EXPORT void bleep_perform(void* h, int argOffset, int numArgs) { guarded(0, [&] {
    auto* i = static_cast<Instance*>(h);
    std::vector<double> args((size_t)numArgs);
    std::memcpy(args.data(), i->scratch.data() + argOffset, sizeof(double) * (size_t)numArgs);
    i->module->perform(i->scratch.data(), args);
return 0; }); }
/// A view button by id (NUL-terminated in the scratch buffer).
BLEEP_EXPORT void bleep_command(void* h, float value) { guarded(0, [&] {
    auto* i = static_cast<Instance*>(h);
    i->module->command(i->scratch.data(), value);
return 0; }); }
/// Live values, arrays and texts for the module's view, as {"values":{},"arrays":{},"text":{}}.
BLEEP_EXPORT int bleep_live(void* h) { return guarded<int>(0, [&]() -> int {
    auto* i = static_cast<Instance*>(h);
    std::vector<std::pair<std::string, double>> values;
    std::vector<std::pair<std::string, std::vector<float>>> arrays;
    std::vector<std::pair<std::string, std::string>> texts;
    i->module->liveValues(values);
    i->module->liveArrays(arrays);
    i->module->liveText(texts);
    std::string out = "{\"values\":{";
    for (size_t k = 0; k < values.size(); ++k) {
        if (k) out += ',';
        quote(out, values[k].first);
        out += ':' + num(values[k].second);
    }
    out += "},\"arrays\":{";
    for (size_t k = 0; k < arrays.size(); ++k) {
        if (k) out += ',';
        quote(out, arrays[k].first);
        out += ":[";
        for (size_t m = 0; m < arrays[k].second.size(); ++m) out += (m ? "," : "") + num(arrays[k].second[m]);
        out += ']';
    }
    out += "},\"text\":{";
    for (size_t k = 0; k < texts.size(); ++k) {
        if (k) out += ',';
        quote(out, texts[k].first);
        out += ':';
        quote(out, texts[k].second);
    }
    out += "}}";
    i->text = std::move(out);
    return (int)i->text.size();
}); }
/// How the board shows a knob at `normalised` (ParamSpec::text): length of the string in bleep_text.
BLEEP_EXPORT int bleep_param_text(void* h, int index, float normalised) {
    auto* i = static_cast<Instance*>(h);
    if (index < 0 || index >= (int)i->spec->params.size()) return 0;
    const ParamSpec& p = i->spec->params[(size_t)index];
    i->text = p.text(p.fromNormalised(normalised));
    return (int)i->text.size();
}
/// Data the module changed itself (e.g. a captured loop): length of the JSON in bleep_text, or -1.
BLEEP_EXPORT int bleep_take_data(void* h) { return guarded<int>(-1, [&]() -> int {
    auto* i = static_cast<Instance*>(h);
    std::string json;
    if (!i->module->takeData(json)) return -1;
    i->text = std::move(json);
    return (int)i->text.size();
}); }
/// The `notes` buffers (NoteBuffer: 64 events of 16 bytes, then an int count).
BLEEP_EXPORT void* bleep_notes_in_ptr(void* h, int jack) { return &static_cast<Instance*>(h)->notesIn[(size_t)jack]; }
BLEEP_EXPORT void* bleep_notes_out_ptr(void* h, int jack) { return &static_cast<Instance*>(h)->notesOut[(size_t)jack]; }
BLEEP_EXPORT int bleep_note_event_size() { return (int)sizeof(NoteEvent); }
BLEEP_EXPORT void bleep_set_transport(void* h, double bpm, double ppq, int playing, int64_t samplePos) {
    auto* i = static_cast<Instance*>(h);
    i->transport.bpm = bpm;
    i->transport.ppq = ppq;
    i->transport.ppqValid = true;
    i->transport.playing = playing != 0;
    i->transport.samplePos = samplePos;
    if (playing && !i->wasPlaying) i->startedPending = true;  // the first block after the transport started
    i->wasPlaying = playing != 0;
}

/// Inside a Voice Cell: the voice this instance plays (ProcessContext::voice). Call once after bleep_create.
BLEEP_EXPORT void bleep_set_voice(void* h, int voice) { static_cast<Instance*>(h)->voice = voice; }

/// The board-wide harmony buses (dsp::kHarmonyBuses states, plain data). The host copies the board's state in before
/// a chunk and, for a module that writes (spec "harmony": "writer"), the result out after it.
BLEEP_EXPORT void* bleep_harmony_ptr(void* h) { return static_cast<Instance*>(h)->harmony.data(); }
BLEEP_EXPORT int bleep_harmony_size() { return (int)sizeof(bleep::dsp::HarmonyState[bleep::dsp::kHarmonyBuses]); }

/// The mailbox of the Transport module (engine/HostControl.h): the requests it makes of the host, and the host's status.
/// The host copies the status in before a block and takes the requests out after it. `size` is the struct's size in bytes.
BLEEP_EXPORT void* bleep_host_ptr(void*) { return &bleep::engine::hostControl(); }
BLEEP_EXPORT int bleep_host_size() { return (int)sizeof(bleep::engine::HostControl); }

/// Runs `numSamples` (≤ kChunk) samples. Returns 0 on success.
BLEEP_EXPORT int bleep_process(void* h, int numSamples) { return guarded<int>(2, [&]() -> int {
    auto* i = static_cast<Instance*>(h);
    if (numSamples < 1 || numSamples > kChunk) return 1;
    // The module reads `bool`s; the host writes bytes.
    for (size_t k = 0; k < i->inConnected.size(); ++k) i->inFlags[k] = i->inConnected[k] != 0;
    for (size_t k = 0; k < i->outConnected.size(); ++k) i->outFlags[k] = i->outConnected[k] != 0;

    ProcessContext& c = i->ctx;
    c.numSamples = numSamples;
    c.offset = 0;
    c.transport = &i->transport;
    c.transportStarted = i->startedPending;
    i->startedPending = false;
    c.ppqStart = i->transport.ppq;
    c.ppqPerSample = i->transport.bpm / 60.0 / i->transport.sampleRate;
    c.params = i->paramPtrs.data();
    c.inputs = i->inputPtrs.data();
    c.inputConnected = i->inFlags.get();
    c.notesIn = i->notesInPtrs.data();
    c.outputs = i->outputPtrs.data();
    c.notesOut = i->notesOutPtrs.data();
    c.outputConnected = i->outFlags.get();
    c.port = nullptr;
    c.harmony = i->harmony.data();
    c.voice = i->voice;
    for (auto& nb : i->notesOut) nb.clear();
    i->module->process(c);
    return 0;
}); }
