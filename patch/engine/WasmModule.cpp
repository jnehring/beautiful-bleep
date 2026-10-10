// SPDX-License-Identifier: MIT
//
// WasmModule.cpp — SPIKE (BLEEP_PATCH_WASM_VERB, off by default): runs a module from its standalone
// .wasm (the files web/build_modules.py builds, ABI in web/src/WebShim.cpp) inside the plugin.
//
// Two node types share the Verb spec and the embedded reverb.wasm and differ only in the runtime:
//   reverb-wasmtime   Wasmtime (Cranelift JIT; needs executable memory: Live 12 allows it)
//   reverb-wasm3      wasm3 (interpreter; runs anywhere, much slower)
// Next to the native Verb ("reverb") they show whether a host accepts the runtime and what it costs.
// Load results and CPU per sample are logged to <app data>/Bleep Patch/wasm-test.log and shown as live values.
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <wasmtime.h>
extern "C" {
#include "wasm3.h"
}

#include "WasmAssets.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <iterator>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace bleep::engine {
namespace {

constexpr int kChunk = 32;  // the ABI's chunk (bleep_chunk())

// ---- log -----------------------------------------------------------------------------

void logLine(const juce::String& text) {
    static std::mutex m;
    std::lock_guard<std::mutex> lock(m);
    auto file = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                    .getChildFile("Bleep Patch").getChildFile("wasm-test.log");
    file.getParentDirectory().createDirectory();
    file.appendText(juce::Time::getCurrentTime().toString(true, true, true, true) + "  " + text + "\n");
}

// ---- runtimes: the few calls the ABI needs -------------------------------------------

struct Arg {
    enum Kind { I32, I64, F32, F64 } kind;
    union {
        int32_t i32;
        int64_t i64;
        float f32;
        double f64;
    };
    Arg(int32_t v) : kind(I32), i32(v) {}
    Arg(int64_t v) : kind(I64), i64(v) {}
    Arg(float v) : kind(F32), f32(v) {}
    Arg(double v) : kind(F64), f64(v) {}
};

class Runtime {
public:
    virtual ~Runtime() = default;
    /// Instantiates the module bytes; false (with `error`) if the runtime refuses.
    virtual bool load(const uint8_t* wasm, size_t size, std::string& error) = 0;
    virtual uint8_t* memory() noexcept = 0;
    /// Resolves an export once; calls then go through the returned handle.
    virtual int find(const char* name) = 0;
    /// Calls an export; returns its i32 result (0 for void).
    virtual int32_t call(int fn, std::initializer_list<Arg> args) noexcept = 0;
    virtual const char* name() const noexcept = 0;
};

// -- Wasmtime. One engine and one compiled module per process; a store and instance per node.
class WasmtimeRuntime final : public Runtime {
public:
    ~WasmtimeRuntime() override {
        if (store_) wasmtime_store_delete(store_);
    }
    const char* name() const noexcept override { return "Wasmtime"; }

    bool load(const uint8_t* wasm, size_t size, std::string& error) override {
        wasmtime_module_t* module = sharedModule(wasm, size, error);
        if (!module) return false;
        store_ = wasmtime_store_new(sharedEngine(), nullptr, nullptr);
        cx_ = wasmtime_store_context(store_);
        wasmtime_linker_t* linker = wasmtime_linker_new(sharedEngine());
        wasm_functype_t* ty = wasm_functype_new_1_0(wasm_valtype_new_i32());  // env.emscripten_notify_memory_growth(i32)
        auto nop = [](void*, wasmtime_caller_t*, const wasmtime_val_t*, size_t, wasmtime_val_t*, size_t) -> wasm_trap_t* {
            return nullptr;
        };
        bool ok = fail(wasmtime_linker_define_func(linker, "env", 3, "emscripten_notify_memory_growth", 31, ty, nop, nullptr, nullptr),
                       nullptr, "link", error);
        wasm_functype_delete(ty);
        wasm_trap_t* trap = nullptr;
        if (ok) ok = fail(wasmtime_linker_instantiate(linker, cx_, module, &instance_, &trap), trap, "instantiate", error);
        wasmtime_linker_delete(linker);
        if (!ok) return false;
        wasmtime_extern_t m;
        if (!wasmtime_instance_export_get(cx_, &instance_, "memory", 6, &m) || m.kind != WASMTIME_EXTERN_MEMORY) {
            error = "no exported memory";
            return false;
        }
        memory_ = m.of.memory;
        const int init = find("_initialize");
        if (init >= 0) call(init, {});
        return true;
    }
    uint8_t* memory() noexcept override { return wasmtime_memory_data(cx_, &memory_); }
    int find(const char* name) override {
        wasmtime_extern_t e;
        if (!wasmtime_instance_export_get(cx_, &instance_, name, std::strlen(name), &e) || e.kind != WASMTIME_EXTERN_FUNC)
            return -1;
        wasm_functype_t* type = wasmtime_func_type(cx_, &e.of.func);
        results_.push_back(wasm_functype_results(type)->size);  // a void export must be called with no result slot
        wasm_functype_delete(type);
        funcs_.push_back(e.of.func);
        return (int)funcs_.size() - 1;
    }
    int32_t call(int fn, std::initializer_list<Arg> args) noexcept override {
        wasmtime_val_t in[8];
        size_t n = 0;
        for (const Arg& a : args) {
            wasmtime_val_t& v = in[n++];
            switch (a.kind) {
                case Arg::I32: v.kind = WASMTIME_I32; v.of.i32 = a.i32; break;
                case Arg::I64: v.kind = WASMTIME_I64; v.of.i64 = a.i64; break;
                case Arg::F32: v.kind = WASMTIME_F32; v.of.f32 = a.f32; break;
                case Arg::F64: v.kind = WASMTIME_F64; v.of.f64 = a.f64; break;
            }
        }
        wasmtime_val_t out[1];
        wasm_trap_t* trap = nullptr;
        wasmtime_error_t* e = wasmtime_func_call(cx_, &funcs_[(size_t)fn], in, n, out, results_[(size_t)fn], &trap);
        if (e || trap) {
            if (e) wasmtime_error_delete(e);
            if (trap) wasm_trap_delete(trap);
            return -1;
        }
        return results_[(size_t)fn] ? out[0].of.i32 : 0;
    }

private:
    static wasm_engine_t* sharedEngine() {
        static wasm_engine_t* engine = wasm_engine_new();
        return engine;
    }
    static wasmtime_module_t* sharedModule(const uint8_t* wasm, size_t size, std::string& error) {
        static std::mutex m;
        static wasmtime_module_t* module = nullptr;
        std::lock_guard<std::mutex> lock(m);
        if (!module) {
            wasmtime_error_t* e = wasmtime_module_new(sharedEngine(), wasm, size, &module);
            if (e) {
                fail(e, nullptr, "compile", error);
                module = nullptr;
            }
        }
        return module;
    }
    static bool fail(wasmtime_error_t* e, wasm_trap_t* t, const char* what, std::string& error) {
        if (!e && !t) return true;
        wasm_byte_vec_t msg;
        if (e) wasmtime_error_message(e, &msg); else wasm_trap_message(t, &msg);
        error = std::string(what) + ": " + std::string(msg.data, msg.size);
        wasm_byte_vec_delete(&msg);
        if (e) wasmtime_error_delete(e);
        if (t) wasm_trap_delete(t);
        return false;
    }

    wasmtime_store_t* store_ = nullptr;
    wasmtime_context_t* cx_ = nullptr;
    wasmtime_instance_t instance_{};
    wasmtime_memory_t memory_{};
    std::vector<wasmtime_func_t> funcs_;
    std::vector<size_t> results_;
};

// -- wasm3: an interpreter, no executable memory.
class Wasm3Runtime final : public Runtime {
public:
    ~Wasm3Runtime() override {
        if (rt_) m3_FreeRuntime(rt_);
        if (env_) m3_FreeEnvironment(env_);
    }
    const char* name() const noexcept override { return "wasm3"; }

    bool load(const uint8_t* wasm, size_t size, std::string& error) override {
        env_ = m3_NewEnvironment();
        rt_ = m3_NewRuntime(env_, 64 * 1024, nullptr);
        if (auto* e = m3_ParseModule(env_, &module_, wasm, (uint32_t)size)) { error = std::string("parse: ") + e; return false; }
        if (auto* e = m3_LoadModule(rt_, module_)) { error = std::string("load: ") + e; return false; }
        m3_LinkRawFunction(module_, "env", "emscripten_notify_memory_growth", "v(i)",
                           [](IM3Runtime, IM3ImportContext, uint64_t*, void*) -> const void* { return m3Err_none; });
        const int init = find("_initialize");
        if (init >= 0) call(init, {});
        return true;
    }
    uint8_t* memory() noexcept override {
        size_t size = 0;
        return m3_GetMemory(module_, &size, 0);
    }
    int find(const char* name) override {
        IM3Function f = nullptr;
        if (m3_FindFunction(&f, rt_, name)) return -1;
        funcs_.push_back(f);
        return (int)funcs_.size() - 1;
    }
    int32_t call(int fn, std::initializer_list<Arg> args) noexcept override {
        const void* ptrs[8];
        size_t n = 0;
        for (const Arg& a : args) {
            switch (a.kind) {
                case Arg::I32: ptrs[n++] = &a.i32; break;
                case Arg::I64: ptrs[n++] = &a.i64; break;
                case Arg::F32: ptrs[n++] = &a.f32; break;
                case Arg::F64: ptrs[n++] = &a.f64; break;
            }
        }
        IM3Function f = funcs_[(size_t)fn];
        if (m3_Call(f, (uint32_t)n, ptrs)) return -1;
        int32_t r = 0;
        const void* out[] = {&r};
        m3_GetResults(f, 1, out);
        return r;
    }

private:
    IM3Environment env_ = nullptr;
    IM3Runtime rt_ = nullptr;
    IM3Module module_ = nullptr;
    std::vector<IM3Function> funcs_;
};

// ---- the module ----------------------------------------------------------------------

enum class Kind { Wasmtime, Wasm3 };

class WasmVerb final : public Module {
public:
    WasmVerb(const ModuleSpec& spec, Kind kind) : Module(spec), kind_(kind) {}

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        load();
    }
    void reset() override {
        if (ready_) rt_->call(fnReset_, {handle_});
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        const double samples = (double)samples_.load(std::memory_order_relaxed);
        const double ns = samples > 0 ? (double)nanos_.load(std::memory_order_relaxed) / samples : 0.0;
        out.push_back({"wasmReady", ready_ ? 1.0 : 0.0});
        out.push_back({"wasmNsPerSample", ns});
        out.push_back({"wasmCpuPercent", ns * sampleRate_ / 1e9 * 100.0});
        // One log line per ~5 s while a view polls this.
        const auto now = std::chrono::steady_clock::now();
        if (ready_ && samples > 0 && now - lastLog_ > std::chrono::seconds(5)) {
            lastLog_ = now;
            logLine(juce::String(runtimeName()) + ": " + juce::String(ns, 1) + " ns/sample = "
                    + juce::String(ns * sampleRate_ / 1e9 * 100.0, 2) + " % of one core at "
                    + juce::String(sampleRate_, 0) + " Hz (" + juce::String((int64_t)samples) + " samples)");
        }
    }

    void process(const ProcessContext& c) override {
        const size_t ni = spec().inputs.size(), no = spec().outputs.size(), np = spec().params.size();
        if (!ready_) {  // the runtime refused: silence (the reason is in the log)
            for (size_t j = 0; j < no; ++j)
                if (c.outputs[j]) std::fill_n(c.outputs[j], c.numSamples, 0.0f);
            return;
        }
        const auto t0 = std::chrono::steady_clock::now();
        pollCommands([&](const Command& cmd) {
            if (cmd.index < 0 || cmd.index >= (int)spec().buttons.size()) return;
            const std::string& id = spec().buttons[(size_t)cmd.index].id;
            const int32_t at = rt_->call(fnScratch_, {handle_, (int32_t)id.size() + 1});
            std::memcpy(rt_->memory() + at, id.c_str(), id.size() + 1);
            rt_->call(fnCommand_, {handle_, cmd.value});
        });
        for (size_t i = 0; i < np; ++i) {  // non-modulated settings
            const float k = knob((int)i);
            if (k != lastKnob_[i]) {
                lastKnob_[i] = k;
                rt_->call(fnSetKnob_, {handle_, (int32_t)i, k});
            }
        }
        const Transport& t = *c.transport;
        for (int off = 0; off < c.numSamples; off += kChunk) {
            const int n = std::min(kChunk, c.numSamples - off);
            uint8_t* mem = rt_->memory();
            auto* params = reinterpret_cast<float*>(mem + paramsPtr_);
            auto* inputs = reinterpret_cast<float*>(mem + inputsPtr_);
            for (size_t i = 0; i < np; ++i) std::memcpy(params + i * kChunk, c.params[i] + off, (size_t)n * sizeof(float));
            for (size_t i = 0; i < ni; ++i) {
                if (c.inputs[i]) std::memcpy(inputs + i * kChunk, c.inputs[i] + off, (size_t)n * sizeof(float));
                else std::fill_n(inputs + i * kChunk, kChunk, 0.0f);
                mem[inConnectedPtr_ + i] = c.inputConnected[i] ? 1 : 0;
            }
            rt_->call(fnTransport_, {handle_, t.bpm, c.ppqAt(off), (int32_t)(t.playing ? 1 : 0), (int64_t)(t.samplePos + off)});
            rt_->call(fnProcess_, {handle_, (int32_t)n});
            mem = rt_->memory();
            auto* outputs = reinterpret_cast<const float*>(mem + outputsPtr_);
            for (size_t j = 0; j < no; ++j)
                if (c.outputs[j]) std::memcpy(c.outputs[j] + off, outputs + j * kChunk, (size_t)n * sizeof(float));
        }
        nanos_.fetch_add((uint64_t)std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - t0).count(),
                         std::memory_order_relaxed);
        samples_.fetch_add((uint64_t)c.numSamples, std::memory_order_relaxed);
    }

private:
    const char* runtimeName() const { return kind_ == Kind::Wasmtime ? "Wasmtime" : "wasm3"; }

    void load() {
        ready_ = false;
        rt_.reset();
        if (kind_ == Kind::Wasmtime) rt_ = std::make_unique<WasmtimeRuntime>();
        else rt_ = std::make_unique<Wasm3Runtime>();
        const auto t0 = std::chrono::steady_clock::now();
        std::string error;
        if (!rt_->load(reinterpret_cast<const uint8_t*>(WasmAssets::reverb_wasm), (size_t)WasmAssets::reverb_wasmSize, error)) {
            logLine(juce::String(runtimeName()) + ": FAILED to load: " + error);
            return;
        }
        const char* names[] = {"bleep_chunk", "bleep_create", "bleep_params_ptr", "bleep_inputs_ptr", "bleep_outputs_ptr",
                               "bleep_in_connected_ptr", "bleep_process", "bleep_set_knob", "bleep_set_transport",
                               "bleep_reset", "bleep_scratch", "bleep_command"};
        int* slots[] = {&fnChunk_, &fnCreate_, &fnParams_, &fnInputs_, &fnOutputs_, &fnInConnected_, &fnProcess_, &fnSetKnob_,
                        &fnTransport_, &fnReset_, &fnScratch_, &fnCommand_};
        for (size_t i = 0; i < std::size(names); ++i) {
            *slots[i] = rt_->find(names[i]);
            if (*slots[i] < 0) {
                logLine(juce::String(runtimeName()) + ": FAILED: the module does not export " + names[i]);
                return;
            }
        }
        if (rt_->call(fnChunk_, {}) != kChunk) {
            logLine(juce::String(runtimeName()) + ": FAILED: built for another chunk size");
            return;
        }
        handle_ = rt_->call(fnCreate_, {(int32_t)0, sampleRate_});
        if (handle_ == 0) {
            logLine(juce::String(runtimeName()) + ": FAILED: bleep_create returned null");
            return;
        }
        paramsPtr_ = (uint32_t)rt_->call(fnParams_, {handle_});
        inputsPtr_ = (uint32_t)rt_->call(fnInputs_, {handle_});
        outputsPtr_ = (uint32_t)rt_->call(fnOutputs_, {handle_});
        inConnectedPtr_ = (uint32_t)rt_->call(fnInConnected_, {handle_});
        lastKnob_.assign(spec().params.size(), -1.0f);  // forces the first sync
        ready_ = true;
        logLine(juce::String(runtimeName()) + ": loaded reverb.wasm (" + juce::String((int)WasmAssets::reverb_wasmSize / 1024)
                + " KB) in " + juce::String(std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count(), 1)
                + " ms");
    }

    Kind kind_;
    std::unique_ptr<Runtime> rt_;
    bool ready_ = false;
    int32_t handle_ = 0;
    uint32_t paramsPtr_ = 0, inputsPtr_ = 0, outputsPtr_ = 0, inConnectedPtr_ = 0;
    int fnChunk_ = -1, fnCreate_ = -1, fnParams_ = -1, fnInputs_ = -1, fnOutputs_ = -1, fnInConnected_ = -1, fnProcess_ = -1,
        fnSetKnob_ = -1, fnTransport_ = -1, fnReset_ = -1, fnScratch_ = -1, fnCommand_ = -1;
    std::vector<float> lastKnob_;
    std::atomic<uint64_t> nanos_{0}, samples_{0};
    mutable std::chrono::steady_clock::time_point lastLog_{};
};

void addVerb(Registry& r, const char* type, const char* name, Kind kind) {
    const ModuleSpec* native = r.find("reverb");  // registerReverbModule sorts before these
    if (!native) return;
    ModuleSpec s = *native;
    s.type = type;
    s.name = name;
    s.description = "Test: the Verb module as a WebAssembly file (reverb.wasm) run inside the plugin. "
                    "Same sound as Verb; see wasm-test.log in the Bleep Patch app data folder for load result and CPU.";
    r.add(std::move(s), [kind](const ModuleSpec& spec) { return std::make_unique<WasmVerb>(spec, kind); });
}

void registerWasmtimeVerbModule(Registry& r) { addVerb(r, "reverb-wasmtime", "Verb (wasm, Wasmtime)", Kind::Wasmtime); }
void registerWasm3VerbModule(Registry& r) { addVerb(r, "reverb-wasm3", "Verb (wasm, wasm3)", Kind::Wasm3); }

BLEEP_REGISTER_MODULE(registerWasmtimeVerbModule);
BLEEP_REGISTER_MODULE(registerWasm3VerbModule);

}  // namespace
}  // namespace bleep::engine
