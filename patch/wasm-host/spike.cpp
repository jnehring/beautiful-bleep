// SPDX-License-Identifier: MIT
//
// Spike: can a plugin run Bleep modules from their standalone .wasm (patch/web), and how fast?
//
// Runs the Verb module (stereo reverb) for N seconds of audio through the same C ABI
// (web/src/WebShim.cpp) three ways and compares output and CPU time:
//   native    the module compiled for this machine and linked into this program (the baseline)
//   wasmtime  build/web/modules/modules/reverb.wasm in Wasmtime (Cranelift JIT)
//   wasm3     the same file in the wasm3 interpreter (no executable memory needed)
//
//   spike <reverb.wasm> [seconds] [native|wasmtime|wasm3|all] [--serialized]
// Build and run: scripts/experiments/wasm-spike.sh
#include <wasmtime.h>
extern "C" {
#include "wasm3.h"
}

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

// The ABI, as exported by WebShim.cpp (linked in for the native run).
extern "C" {
void* bleep_create(int typeIndex, double sampleRate);
float* bleep_inputs_ptr(void*);
float* bleep_outputs_ptr(void*);
uint8_t* bleep_in_connected_ptr(void*);
int bleep_process(void*, int);
int bleep_chunk();
}

namespace {
constexpr int kChunk = 32, kSampleRate = 48000, kIns = 4, kOuts = 5;  // Verb: InL InR Freeze Clear / OutL OutR WetL WetR Env

using Clock = std::chrono::steady_clock;
double ms(Clock::time_point a, Clock::time_point b) { return std::chrono::duration<double, std::milli>(b - a).count(); }

struct Backend {
    virtual ~Backend() = default;
    virtual const char* name() const = 0;
    virtual bool load(const std::vector<uint8_t>& wasm, bool serialized) = 0;
    virtual void process(const float* inL, const float* inR, float* out /* kOuts × kChunk */) = 0;
};

// ---- native baseline ------------------------------------------------------------
struct Native final : Backend {
    void* h = nullptr;
    const char* name() const override { return "native"; }
    bool load(const std::vector<uint8_t>&, bool) override {
        h = bleep_create(0, kSampleRate);
        if (!h) return false;
        bleep_in_connected_ptr(h)[0] = 1;
        bleep_in_connected_ptr(h)[1] = 1;
        return true;
    }
    void process(const float* inL, const float* inR, float* out) override {
        float* in = bleep_inputs_ptr(h);
        std::memcpy(in, inL, kChunk * 4);
        std::memcpy(in + kChunk, inR, kChunk * 4);
        bleep_process(h, kChunk);
        std::memcpy(out, bleep_outputs_ptr(h), kOuts * kChunk * 4);
    }
};

// ---- Wasmtime -------------------------------------------------------------------
[[noreturn]] void die(const char* what, wasmtime_error_t* e, wasm_trap_t* t = nullptr) {
    wasm_byte_vec_t msg;
    if (e) wasmtime_error_message(e, &msg); else wasm_trap_message(t, &msg);
    std::fprintf(stderr, "%s: %.*s\n", what, (int)msg.size, msg.data);
    std::exit(2);
}

struct Wasmtime final : Backend {
    wasm_engine_t* engine = nullptr;
    wasmtime_store_t* store = nullptr;
    wasmtime_context_t* cx = nullptr;
    wasmtime_memory_t memory{};
    wasmtime_func_t process_{};
    int32_t h = 0, inPtr = 0, outPtr = 0;
    const char* name() const override { return "wasmtime"; }

    wasmtime_func_t fn(const char* n) {
        wasmtime_extern_t e;
        if (!wasmtime_instance_export_get(cx, &instance, n, std::strlen(n), &e) || e.kind != WASMTIME_EXTERN_FUNC) die(n, nullptr, nullptr);
        return e.of.func;
    }
    int32_t call(const char* n, std::vector<wasmtime_val_t> args = {}) {
        wasmtime_func_t f = fn(n);
        wasmtime_val_t res[1];
        wasm_trap_t* trap = nullptr;
        if (auto* e = wasmtime_func_call(cx, &f, args.data(), args.size(), res, 1, &trap)) die(n, e);
        if (trap) die(n, nullptr, trap);
        return res[0].of.i32;
    }
    wasmtime_instance_t instance{};

    bool load(const std::vector<uint8_t>& wasm, bool serialized) override {
        engine = wasm_engine_new();
        store = wasmtime_store_new(engine, nullptr, nullptr);
        cx = wasmtime_store_context(store);
        wasmtime_module_t* module = nullptr;
        if (serialized) {  // ahead-of-time: compile, serialise, load back (what an install step would store)
            wasm_byte_vec_t bytes;
            if (auto* e = wasmtime_module_new(engine, wasm.data(), wasm.size(), &module)) die("compile", e);
            if (auto* e = wasmtime_module_serialize(module, &bytes)) die("serialize", e);
            wasmtime_module_delete(module);
            if (auto* e = wasmtime_module_deserialize(engine, (const uint8_t*)bytes.data, bytes.size, &module)) die("deserialize", e);
            wasm_byte_vec_delete(&bytes);
        } else if (auto* e = wasmtime_module_new(engine, wasm.data(), wasm.size(), &module)) {
            die("compile", e);
        }
        wasmtime_linker_t* linker = wasmtime_linker_new(engine);
        wasm_functype_t* ty = wasm_functype_new_1_0(wasm_valtype_new_i32());  // env.emscripten_notify_memory_growth(i32)
        auto nop = [](void*, wasmtime_caller_t*, const wasmtime_val_t*, size_t, wasmtime_val_t*, size_t) -> wasm_trap_t* { return nullptr; };
        if (auto* e = wasmtime_linker_define_func(linker, "env", 3, "emscripten_notify_memory_growth", 31, ty, nop, nullptr, nullptr)) die("link", e);
        wasm_functype_delete(ty);
        wasm_trap_t* trap = nullptr;
        if (auto* e = wasmtime_linker_instantiate(linker, cx, module, &instance, &trap)) die("instantiate", e);
        if (trap) die("instantiate", nullptr, trap);
        wasmtime_linker_delete(linker);
        wasmtime_module_delete(module);
        wasmtime_extern_t m;
        wasmtime_instance_export_get(cx, &instance, "memory", 6, &m);
        memory = m.of.memory;
        wasmtime_extern_t init;
        if (wasmtime_instance_export_get(cx, &instance, "_initialize", 11, &init)) {
            wasm_trap_t* t = nullptr;
            if (auto* e = wasmtime_func_call(cx, &init.of.func, nullptr, 0, nullptr, 0, &t)) die("_initialize", e);
        }
        process_ = fn("bleep_process");
        wasmtime_val_t a[2];
        a[0].kind = WASMTIME_I32; a[0].of.i32 = 0;
        a[1].kind = WASMTIME_F64; a[1].of.f64 = kSampleRate;
        h = call("bleep_create", {a[0], a[1]});
        if (!h || call("bleep_chunk") != kChunk) return false;
        wasmtime_val_t hv; hv.kind = WASMTIME_I32; hv.of.i32 = h;
        inPtr = call("bleep_inputs_ptr", {hv});
        outPtr = call("bleep_outputs_ptr", {hv});
        int32_t conn = call("bleep_in_connected_ptr", {hv});
        uint8_t* mem = wasmtime_memory_data(cx, &memory);
        mem[conn] = mem[conn + 1] = 1;
        return true;
    }
    void process(const float* inL, const float* inR, float* out) override {
        uint8_t* mem = wasmtime_memory_data(cx, &memory);  // may move when the module grows its memory
        std::memcpy(mem + inPtr, inL, kChunk * 4);
        std::memcpy(mem + inPtr + kChunk * 4, inR, kChunk * 4);
        wasmtime_val_t a[2];
        a[0].kind = WASMTIME_I32; a[0].of.i32 = h;
        a[1].kind = WASMTIME_I32; a[1].of.i32 = kChunk;
        wasmtime_val_t res[1];
        wasm_trap_t* trap = nullptr;
        if (auto* e = wasmtime_func_call(cx, &process_, a, 2, res, 1, &trap)) die("process", e);
        if (trap) die("process", nullptr, trap);
        mem = wasmtime_memory_data(cx, &memory);
        std::memcpy(out, mem + outPtr, kOuts * kChunk * 4);
    }
};

// ---- wasm3 ----------------------------------------------------------------------
struct Wasm3 final : Backend {
    IM3Environment env = nullptr;
    IM3Runtime rt = nullptr;
    IM3Module mod = nullptr;
    IM3Function process_ = nullptr;
    uint32_t h = 0, inPtr = 0, outPtr = 0;
    const char* name() const override { return "wasm3"; }

    IM3Function find(const char* n) {
        IM3Function f;
        if (m3_FindFunction(&f, rt, n)) { std::fprintf(stderr, "wasm3: no export %s\n", n); std::exit(2); }
        return f;
    }
    uint32_t callU32(const char* n, std::initializer_list<const void*> args = {}) {
        IM3Function f = find(n);
        std::vector<const void*> a(args);
        if (auto* e = m3_Call(f, (uint32_t)a.size(), a.data())) { std::fprintf(stderr, "wasm3 %s: %s\n", n, e); std::exit(2); }
        uint32_t r = 0;
        const void* rp[] = {&r};
        m3_GetResults(f, 1, rp);
        return r;
    }
    bool load(const std::vector<uint8_t>& wasm, bool) override {
        env = m3_NewEnvironment();
        rt = m3_NewRuntime(env, 64 * 1024, nullptr);
        if (auto* e = m3_ParseModule(env, &mod, wasm.data(), (uint32_t)wasm.size())) { std::fprintf(stderr, "wasm3 parse: %s\n", e); return false; }
        if (auto* e = m3_LoadModule(rt, mod)) { std::fprintf(stderr, "wasm3 load: %s\n", e); return false; }
        m3_LinkRawFunction(mod, "env", "emscripten_notify_memory_growth", "v(i)",
                           [](IM3Runtime, IM3ImportContext, uint64_t*, void*) -> const void* { return m3Err_none; });
        if (IM3Function init; !m3_FindFunction(&init, rt, "_initialize")) m3_CallV(init);
        process_ = find("bleep_process");
        double sr = kSampleRate; int32_t type = 0;
        h = callU32("bleep_create", {&type, &sr});
        if (!h || callU32("bleep_chunk") != kChunk) return false;
        inPtr = callU32("bleep_inputs_ptr", {&h});
        outPtr = callU32("bleep_outputs_ptr", {&h});
        uint32_t conn = callU32("bleep_in_connected_ptr", {&h});
        size_t size;
        uint8_t* mem = m3_GetMemory(mod, &size, 0);
        mem[conn] = mem[conn + 1] = 1;
        return true;
    }
    void process(const float* inL, const float* inR, float* out) override {
        size_t size;
        uint8_t* mem = m3_GetMemory(mod, &size, 0);
        std::memcpy(mem + inPtr, inL, kChunk * 4);
        std::memcpy(mem + inPtr + kChunk * 4, inR, kChunk * 4);
        int32_t n = kChunk;
        const void* args[] = {&h, &n};
        if (auto* e = m3_Call(process_, 2, args)) { std::fprintf(stderr, "wasm3 process: %s\n", e); std::exit(2); }
        mem = m3_GetMemory(mod, &size, 0);
        std::memcpy(out, mem + outPtr, kOuts * kChunk * 4);
    }
};
}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: spike <reverb.wasm> [seconds] [native|wasmtime|wasm3|all] [--serialized]\n"); return 1; }
    std::ifstream f(argv[1], std::ios::binary);
    std::vector<uint8_t> wasm((std::istreambuf_iterator<char>(f)), {});
    const double seconds = argc > 2 ? std::atof(argv[2]) : 10;
    const std::string which = argc > 3 ? argv[3] : "all";
    bool serialized = false;
    for (int i = 1; i < argc; ++i) serialized |= std::string(argv[i]) == "--serialized";

    std::vector<Backend*> backends;
    if (which == "all" || which == "native") backends.push_back(new Native);
    if (which == "all" || which == "wasmtime") backends.push_back(new Wasmtime);
    if (which == "all" || which == "wasm3") backends.push_back(new Wasm3);

    const int chunks = (int)(seconds * kSampleRate / kChunk);
    // Input: deterministic noise bursts (a drum-like hit every half second).
    std::vector<float> inL((size_t)chunks * kChunk), inR(inL.size());
    uint32_t rng = 12345;
    for (size_t i = 0; i < inL.size(); ++i) {
        rng = rng * 1664525u + 1013904223u;
        const float noise = ((rng >> 8) / 8388608.0f - 1.0f);
        const float env = std::exp(-(float)(i % (kSampleRate / 2)) / 2000.0f);
        inL[i] = noise * env * 0.5f;
        inR[i] = -noise * env * 0.5f;
    }

    std::vector<float> reference;
    std::printf("%.0f s of audio at %d Hz, %d-sample chunks%s\n", seconds, kSampleRate, kChunk, serialized ? ", wasmtime ahead-of-time" : "");
    std::printf("%-9s %9s %12s %10s %10s %s\n", "runtime", "load ms", "ns / sample", "CPU %", "x native", "max diff vs native");
    double nativeNs = 0;
    for (Backend* b : backends) {
        const auto t0 = Clock::now();
        if (!b->load(wasm, serialized)) { std::printf("%-9s failed to load\n", b->name()); continue; }
        const auto t1 = Clock::now();
        std::vector<float> out((size_t)chunks * kOuts * kChunk > 0 ? (size_t)chunks * 2 * kChunk : 0);
        float block[kOuts * kChunk];
        const auto t2 = Clock::now();
        for (int c = 0; c < chunks; ++c) {
            b->process(&inL[(size_t)c * kChunk], &inR[(size_t)c * kChunk], block);
            std::memcpy(&out[(size_t)c * 2 * kChunk], block, 2 * kChunk * 4);  // OutL, OutR
        }
        const auto t3 = Clock::now();
        const double ns = ms(t2, t3) * 1e6 / ((double)chunks * kChunk);
        if (std::string(b->name()) == "native") { reference = out; nativeNs = ns; }
        double diff = 0;
        if (!reference.empty()) for (size_t i = 0; i < out.size(); ++i) diff = std::max(diff, (double)std::fabs(out[i] - reference[i]));
        double peak = 0;
        for (float v : out) peak = std::max(peak, (double)std::fabs(v));
        std::printf("%-9s %9.1f %12.1f %9.2f%% %10.2f %.3g%s\n", b->name(), ms(t0, t1), ns, ns * kSampleRate / 1e9 * 100,
                    nativeNs > 0 ? ns / nativeNs : 0.0, diff, peak < 1e-6 ? "  (SILENT OUTPUT)" : "");
    }
    return 0;
}
