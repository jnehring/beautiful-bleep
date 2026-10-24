// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "WasmRuntime.h"

#include <wasmtime.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <set>
#include <thread>
#include <utility>

namespace bleep::engine::wasm {
namespace {

// Epoch interruption: one thread adds a tick to the engine every kTickMs; a call into a module gets a deadline of some ticks
// (Instance::setBudgetMs) and traps when it runs past it. That is what stops a module that loops forever.
constexpr int kTickMs = 1;

wasm_engine_t* makeEngine() {
    wasm_config_t* config = wasm_config_new();
    wasmtime_config_epoch_interruption_set(config, true);
    return wasm_engine_new_with_config(config);  // takes the config
}

/// Ticks the engine until the process ends; stopped and joined by its destructor (static destruction at exit).
struct Ticker {
    explicit Ticker(wasm_engine_t* e) : thread_([this, e] {
        std::unique_lock<std::mutex> lock(m_);
        auto next = std::chrono::steady_clock::now();
        for (;;) {  // against the clock, not by sleeping a fixed time: a late wake-up does not make the ticks slower
            next += std::chrono::milliseconds(kTickMs);
            if (cv_.wait_until(lock, next, [this] { return stop_; })) return;
            wasmtime_engine_increment_epoch(e);
        }
    }) {}
    ~Ticker() {
        { std::lock_guard<std::mutex> l(m_); stop_ = true; }
        cv_.notify_one();
        thread_.join();
    }
    std::mutex m_;
    std::condition_variable cv_;
    bool stop_ = false;
    std::thread thread_;
};

wasm_engine_t* engine() {
    static wasm_engine_t* e = makeEngine();  // one per process
    static Ticker ticker(e);                 // after the engine: stopped before the process lets go of it (the engine itself is never freed)
    (void)ticker;
    return e;
}

std::string message(wasmtime_error_t* e, wasm_trap_t* t) {
    wasm_byte_vec_t msg;
    if (e) wasmtime_error_message(e, &msg); else wasm_trap_message(t, &msg);
    std::string text(msg.data, msg.size);
    wasm_byte_vec_delete(&msg);
    if (e) wasmtime_error_delete(e);
    if (t) wasm_trap_delete(t);
    return text;
}

/// The text of a trap; a call that ran out of its time budget says so.
std::string trapText(wasm_trap_t* trap) {
    wasmtime_trap_code_t code;
    const bool interrupted = wasmtime_trap_code(trap, &code) && code == WASMTIME_TRAP_CODE_INTERRUPT;
    std::string text = message(nullptr, trap);
    return interrupted ? "stopped: the call ran longer than its time limit" : text;
}

// ---- the imports a module may have (module-abi.md section 2), as stubs (section 8) ---------------------

enum class Stub { Nop, FdWrite, FdClose, FdSeek, FdRead, FdFdstatGet, SizesGet, Zero, ClockTimeGet, ProcExit, MediaInfo, MediaRead };

const std::pair<const char*, const char*> kNames[] = {
    {"env", "emscripten_notify_memory_growth"}, {"wasi_snapshot_preview1", "fd_close"}, {"wasi_snapshot_preview1", "fd_read"},
    {"wasi_snapshot_preview1", "fd_seek"}, {"wasi_snapshot_preview1", "fd_write"}, {"wasi_snapshot_preview1", "fd_fdstat_get"},
    {"wasi_snapshot_preview1", "environ_get"}, {"wasi_snapshot_preview1", "environ_sizes_get"}, {"wasi_snapshot_preview1", "args_get"},
    {"wasi_snapshot_preview1", "args_sizes_get"}, {"wasi_snapshot_preview1", "clock_time_get"}, {"wasi_snapshot_preview1", "proc_exit"},
    {"env", "bleep_media_info"}, {"env", "bleep_media_read"}};
const Stub kStubs[] = {Stub::Nop, Stub::FdClose, Stub::FdRead, Stub::FdSeek, Stub::FdWrite, Stub::FdFdstatGet,
                       Stub::Zero, Stub::SizesGet, Stub::Zero, Stub::SizesGet, Stub::ClockTimeGet, Stub::ProcExit,
                       Stub::MediaInfo, Stub::MediaRead};

bool stubFor(const std::string& mod, const std::string& name, Stub& out) {
    for (size_t i = 0; i < std::size(kNames); ++i)
        if (mod == kNames[i].first && name == kNames[i].second) { out = kStubs[i]; return true; }
    return false;
}

uint8_t* callerMemory(wasmtime_caller_t* caller, size_t* size) {
    wasmtime_extern_t item;
    if (!wasmtime_caller_export_get(caller, "memory", 6, &item) || item.kind != WASMTIME_EXTERN_MEMORY) return nullptr;
    wasmtime_context_t* cx = wasmtime_caller_context(caller);
    *size = wasmtime_memory_data_size(cx, &item.of.memory);
    return wasmtime_memory_data(cx, &item.of.memory);
}

template <class T>
void put(uint8_t* mem, size_t size, uint32_t at, T value) {
    if ((size_t)at + sizeof(T) <= size) std::memcpy(mem + at, &value, sizeof(T));
}

MediaHandler* mediaOf(wasmtime_caller_t* caller);

wasm_trap_t* stubCall(void* env, wasmtime_caller_t* caller, const wasmtime_val_t* args, size_t nargs, wasmtime_val_t* results, size_t nresults) {
    const Stub stub = (Stub)(intptr_t)env;
    int32_t result = 0;
    size_t size = 0;
    uint8_t* mem = nullptr;
    switch (stub) {
        case Stub::Nop: break;
        case Stub::FdClose: break;
        case Stub::FdSeek: result = 70; break;       // ESPIPE
        case Stub::FdRead: result = 8; break;        // EBADF
        case Stub::FdFdstatGet: result = 8; break;
        case Stub::Zero: break;
        case Stub::FdWrite:                          // accepts and drops its bytes
            if (nargs == 4 && (mem = callerMemory(caller, &size))) {
                uint32_t total = 0;
                // a host call cannot be interrupted: bound its work (a module has no business writing more than a few vectors)
                const int32_t count = std::min<int32_t>(std::max<int32_t>(args[2].of.i32, 0), 1024);
                for (int32_t i = 0; i < count; ++i) {
                    uint32_t len = 0;
                    const uint32_t at = (uint32_t)args[1].of.i32 + (uint32_t)i * 8 + 4;
                    if ((size_t)at + 4 <= size) std::memcpy(&len, mem + at, 4);
                    total += len;
                }
                put<uint32_t>(mem, size, (uint32_t)args[3].of.i32, total);
            }
            break;
        case Stub::SizesGet:                         // no environment, no arguments
            if (nargs == 2 && (mem = callerMemory(caller, &size))) {
                put<uint32_t>(mem, size, (uint32_t)args[0].of.i32, 0);
                put<uint32_t>(mem, size, (uint32_t)args[1].of.i32, 0);
            }
            break;
        case Stub::ClockTimeGet:                     // no clock: always 0
            if (nargs == 3 && (mem = callerMemory(caller, &size))) put<uint64_t>(mem, size, (uint32_t)args[2].of.i32, 0);
            break;
        case Stub::MediaInfo:  // (id ptr, id length, → f64 sample rate, → i32 channels) → i64 frames
            if (nargs == 4 && nresults == 1 && (mem = callerMemory(caller, &size))) {
                const uint32_t idPtr = (uint32_t)args[0].of.i32, idLen = (uint32_t)args[1].of.i32;
                int64_t frames = 0;
                if (MediaHandler* media = mediaOf(caller); media && idLen <= 64 && (size_t)idPtr + idLen <= size) {
                    double rate = 0;
                    int32_t channels = 0;
                    frames = media->info(std::string(reinterpret_cast<const char*>(mem + idPtr), idLen), rate, channels);
                    if (frames > 0) {
                        put<double>(mem, size, (uint32_t)args[2].of.i32, rate);
                        put<int32_t>(mem, size, (uint32_t)args[3].of.i32, channels);
                    }
                }
                results[0].kind = WASMTIME_I64;
                results[0].of.i64 = frames;
                return nullptr;
            }
            break;
        case Stub::MediaRead:  // (id ptr, id length, channel, dst ptr, frames i64) → i32 ok
            if (nargs == 5 && nresults == 1 && (mem = callerMemory(caller, &size))) {
                const uint32_t idPtr = (uint32_t)args[0].of.i32, idLen = (uint32_t)args[1].of.i32, dst = (uint32_t)args[3].of.i32;
                const int64_t frames = args[4].of.i64;
                int32_t ok = 0;
                if (MediaHandler* media = mediaOf(caller); media && idLen <= 64 && frames > 0 && (size_t)idPtr + idLen <= size &&
                                                          (size_t)dst + (size_t)frames * 4 <= size)
                    ok = media->read(std::string(reinterpret_cast<const char*>(mem + idPtr), idLen), args[2].of.i32, reinterpret_cast<float*>(mem + dst), frames) ? 1 : 0;
                result = ok;
            }
            break;
        case Stub::ProcExit: {
            static const char text[] = "the module called proc_exit";
            return wasmtime_trap_new(text, sizeof(text) - 1);
        }
    }
    if (nresults == 1) { results[0].kind = WASMTIME_I32; results[0].of.i32 = result; }
    return nullptr;
}

}  // namespace

// ---- Compiled -----------------------------------------------------------------------------------------

struct Compiled::Impl {
    wasmtime_module_t* module = nullptr;
    ~Impl() { if (module) wasmtime_module_delete(module); }
};

Compiled::Compiled() : impl(new Impl) {}
Compiled::~Compiled() = default;

std::shared_ptr<Compiled> Compiled::compile(const uint8_t* bytes, size_t size, std::string& error) {
    if (size > kMaxModuleBytes) {
        error = "the module is too large (" + std::to_string(size >> 20) + " MiB; the limit is " + std::to_string(kMaxModuleBytes >> 20) + " MiB)";
        return nullptr;
    }
    std::shared_ptr<Compiled> c(new Compiled);
    if (auto* e = wasmtime_module_new(engine(), bytes, size, &c->impl->module)) {
        error = "cannot compile: " + message(e, nullptr);
        return nullptr;
    }
    wasm_importtype_vec_t imports;
    wasmtime_module_imports(c->impl->module, &imports);
    std::string bad;
    for (size_t i = 0; i < imports.size; ++i) {
        const wasm_name_t* m = wasm_importtype_module(imports.data[i]);
        const wasm_name_t* n = wasm_importtype_name(imports.data[i]);
        Stub s;
        if (!stubFor(std::string(m->data, m->size), std::string(n->data, n->size), s))
            bad += (bad.empty() ? "" : ", ") + std::string(m->data, m->size) + "." + std::string(n->data, n->size);
    }
    wasm_importtype_vec_delete(&imports);
    if (!bad.empty()) {
        error = "imports " + bad + ", which the module ABI does not allow";
        return nullptr;
    }
    return c;
}

// ---- Instance -----------------------------------------------------------------------------------------

struct Instance::Impl {
    std::shared_ptr<const Compiled> module;
    wasmtime_store_t* store = nullptr;
    wasmtime_context_t* cx = nullptr;
    wasmtime_instance_t instance{};
    wasmtime_memory_t memory{};
    MediaHandler* media = nullptr;
    std::vector<wasmtime_func_t> funcs;
    std::vector<size_t> results;
    uint64_t budgetTicks = kDefaultBudgetMs / kTickMs;
    ~Impl() { if (store) wasmtime_store_delete(store); }
};

Instance::Instance() : impl(new Impl) {}
Instance::~Instance() = default;

std::unique_ptr<Instance> Instance::create(std::shared_ptr<const Compiled> module, std::string& error, size_t maxMemory) {
    std::unique_ptr<Instance> inst(new Instance);
    Impl& m = *inst->impl;
    m.module = module;
    m.store = wasmtime_store_new(engine(), &m, nullptr);  // the callbacks find the instance (its media handler) through the store
    m.cx = wasmtime_store_context(m.store);
    // memory, table elements (one table can hold at most this many), instances, tables, memories
    wasmtime_store_limiter(m.store, (int64_t)maxMemory, kMaxTableElements, 1, kMaxTables, 1);

    wasmtime_linker_t* linker = wasmtime_linker_new(engine());
    wasm_importtype_vec_t imports;
    wasmtime_module_imports(module->impl->module, &imports);
    bool ok = true;
    for (size_t i = 0; i < imports.size && ok; ++i) {
        const wasm_name_t* mod = wasm_importtype_module(imports.data[i]);
        const wasm_name_t* name = wasm_importtype_name(imports.data[i]);
        const wasm_externtype_t* type = wasm_importtype_type(imports.data[i]);
        Stub stub;
        if (wasm_externtype_kind(type) != WASM_EXTERN_FUNC || !stubFor(std::string(mod->data, mod->size), std::string(name->data, name->size), stub)) {
            error = "an import that is not allowed";
            ok = false;
            break;
        }
        wasm_functype_t* ty = wasm_functype_copy(wasm_externtype_as_functype_const(type));
        if (auto* e = wasmtime_linker_define_func(linker, mod->data, mod->size, name->data, name->size, ty, stubCall, (void*)(intptr_t)stub, nullptr)) {
            error = "link: " + message(e, nullptr);
            ok = false;
        }
        wasm_functype_delete(ty);
    }
    wasm_importtype_vec_delete(&imports);
    wasm_trap_t* trap = nullptr;
    if (ok) {
        wasmtime_context_set_epoch_deadline(m.cx, kInitBudgetMs / kTickMs + 1);  // the start function runs here
        if (auto* e = wasmtime_linker_instantiate(linker, m.cx, module->impl->module, &m.instance, &trap)) {
            error = "instantiate: " + message(e, nullptr);
            ok = false;
        } else if (trap) {
            error = "instantiate: " + message(nullptr, trap);
            ok = false;
        }
    }
    wasmtime_linker_delete(linker);
    if (!ok) return nullptr;
    wasmtime_extern_t mem;
    if (!wasmtime_instance_export_get(m.cx, &m.instance, "memory", 6, &mem) || mem.kind != WASMTIME_EXTERN_MEMORY) {
        error = "the module exports no memory";
        return nullptr;
    }
    m.memory = mem.of.memory;
    const int init = inst->find("_initialize");
    if (init >= 0) {
        inst->setBudgetMs(kInitBudgetMs);
        inst->call(init);
        inst->setBudgetMs(kDefaultBudgetMs);
        if (inst->failed()) {
            error = "_initialize: " + inst->lastError();
            return nullptr;
        }
    }
    return inst;
}

namespace {
MediaHandler* mediaOf(wasmtime_caller_t* caller) {
    return static_cast<Instance::Impl*>(wasmtime_context_get_data(wasmtime_caller_context(caller)))->media;
}
}  // namespace

void Instance::setBudgetMs(int ms) noexcept { impl->budgetTicks = (uint64_t)std::max(ms, kTickMs) / kTickMs + 1; }  // +1: the first tick comes at any moment

void Instance::setMedia(MediaHandler* handler) noexcept { impl->media = handler; }

uint8_t* Instance::memory() noexcept { return wasmtime_memory_data(impl->cx, &impl->memory); }
size_t Instance::memorySize() noexcept { return wasmtime_memory_data_size(impl->cx, &impl->memory); }

int Instance::find(const char* name) {
    wasmtime_extern_t e;
    if (!wasmtime_instance_export_get(impl->cx, &impl->instance, name, std::strlen(name), &e) || e.kind != WASMTIME_EXTERN_FUNC) return -1;
    wasm_functype_t* type = wasmtime_func_type(impl->cx, &e.of.func);
    impl->results.push_back(wasm_functype_results(type)->size);  // a void export is called with no result slot
    wasm_functype_delete(type);
    impl->funcs.push_back(e.of.func);
    return (int)impl->funcs.size() - 1;
}

namespace {
size_t fill(wasmtime_val_t* in, std::initializer_list<Arg> args) {
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
    return n;
}
}  // namespace

int32_t Instance::call(int fn, std::initializer_list<Arg> args) noexcept {
    if (failed_) return 0;  // a stopped or trapped instance runs no more code
    wasmtime_val_t in[8], out[1];
    const size_t n = fill(in, args);
    wasm_trap_t* trap = nullptr;
    wasmtime_context_set_epoch_deadline(impl->cx, impl->budgetTicks);
    if (auto* e = wasmtime_func_call(impl->cx, &impl->funcs[(size_t)fn], in, n, out, impl->results[(size_t)fn], &trap)) {
        failed_ = true;
        error_ = message(e, trap);
        return 0;
    }
    if (trap) {
        failed_ = true;
        error_ = trapText(trap);
        return 0;
    }
    return impl->results[(size_t)fn] ? out[0].of.i32 : 0;
}

float Instance::callF32(int fn, std::initializer_list<Arg> args) noexcept {
    if (failed_) return 0.0f;
    wasmtime_val_t in[8], out[1];
    const size_t n = fill(in, args);
    wasm_trap_t* trap = nullptr;
    wasmtime_context_set_epoch_deadline(impl->cx, impl->budgetTicks);
    if (auto* e = wasmtime_func_call(impl->cx, &impl->funcs[(size_t)fn], in, n, out, 1, &trap)) {
        failed_ = true;
        error_ = message(e, trap);
        return 0.0f;
    }
    if (trap) {
        failed_ = true;
        error_ = trapText(trap);
        return 0.0f;
    }
    return out[0].of.f32;
}

}  // namespace bleep::engine::wasm
