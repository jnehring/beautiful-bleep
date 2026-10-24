// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// The Gains module (AssemblyScript) in the engine's real wasm host: Wasmtime through engine/wasm/WasmRuntime.
// Same behaviour checks as test/spike.mjs, plus the time per sample under Wasmtime.
//   test/wasmtime-check.sh [path/to/gains.wasm]
#include "wasm/WasmRuntime.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <vector>

namespace w = bleep::engine::wasm;
constexpr int kChunk = 32;
static int g_failures = 0;
static void check(bool ok, const char* what, double value = 0) {
    std::printf("%s %s", ok ? "ok  " : "FAIL", what);
    if (value != 0) std::printf("  (%g)", value);
    std::printf("\n");
    if (!ok) ++g_failures;
}

struct Gains {
    w::Instance& in;
    int fProcess, fCreate, fParams, fInputs, fOutputs, fLive, fText;
    int32_t h = 0, params = 0, inputs = 0, outputs = 0;
    explicit Gains(w::Instance& i) : in(i) {
        fProcess = in.find("bleep_process"); fCreate = in.find("bleep_create");
        fParams = in.find("bleep_params_ptr"); fInputs = in.find("bleep_inputs_ptr"); fOutputs = in.find("bleep_outputs_ptr");
        fLive = in.find("bleep_live"); fText = in.find("bleep_text");
        h = in.call(fCreate, {int32_t(0), 48000.0});
        params = in.call(fParams, {h}); inputs = in.call(fInputs, {h}); outputs = in.call(fOutputs, {h});
    }
    float* f(int32_t ptr) { return reinterpret_cast<float*>(in.memory() + ptr); }  // re-fetch after every call: the base may move
    void set(float vol, float mute, float solo, float others, float x) {
        for (int i = 0; i < kChunk; ++i) {
            f(params)[i] = vol; f(params)[kChunk + i] = mute; f(params)[2 * kChunk + i] = solo;
            f(inputs)[i] = x; f(inputs)[kChunk + i] = others;
        }
    }
    int process() { return in.call(fProcess, {h, int32_t(kChunk)}); }
    float last() { return f(outputs)[kChunk - 1]; }
    float run(int chunks, float vol = 0.9090909f, float mute = 0, float solo = 0, float others = 0) {
        for (int c = 0; c < chunks; ++c) { set(vol, mute, solo, others, 1.0f); process(); }
        return last();
    }
};

int main(int argc, char** argv) {
    setvbuf(stdout, nullptr, _IONBF, 0);
    const char* path = argc > 1 ? argv[1] : "build/gains.wasm";
    std::ifstream file(path, std::ios::binary);
    std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
    check(!bytes.empty(), "file read", double(bytes.size()));

    std::string error;
    auto compiled = w::Compiled::compile(bytes.data(), bytes.size(), error);   // refuses imports the ABI does not allow
    check(compiled != nullptr, "compiled by Wasmtime, imports accepted");
    if (!compiled) { std::printf("%s\n", error.c_str()); return 1; }

    auto make = [&] { auto i = w::Instance::create(compiled, error); if (!i) std::printf("%s\n", error.c_str()); return i; };
    auto inst = make();
    if (!inst) return 1;
    check(inst->call(inst->find("bleep_chunk")) == 32 && inst->call(inst->find("bleep_note_event_size")) == 16, "chunk 32, note event 16 bytes");
    Gains g(*inst);
    check(g.h != 0, "bleep_create");

    check(std::fabs(g.run(4) - 1.0f) < 1e-4f, "unity at 0 dB");
    { auto i = make(); Gains a(*i); check(std::fabs(a.run(4, 0.0f)) < 1e-9f, "fader at the bottom is silent"); }
    { auto i = make(); Gains a(*i); check(std::fabs(a.run(200, 0.9090909f, 1)) < 1e-6f, "mute silences"); }
    { auto i = make(); Gains a(*i); check(std::fabs(a.run(200, 0.9090909f, 0, 0, 1)) < 1e-6f, "another channel soloed silences this one"); }
    { auto i = make(); Gains a(*i); check(std::fabs(a.run(200, 0.9090909f, 0, 1, 1) - 1.0f) < 1e-4f, "a soloed channel stays audible"); }
    {   // the probe: bleep_live -> JSON text with the level
        auto i = make(); Gains a(*i); a.run(100);
        int32_t n = i->call(a.fLive, {a.h});
        int32_t p = i->call(a.fText, {a.h});
        std::string text(reinterpret_cast<char*>(i->memory() + p), size_t(n));
        check(text.find("\"level\":") != std::string::npos, "probe (bleep_live) reports the level");
        std::printf("     %s\n", text.c_str());
    }
    {   // speed
        auto i = make(); Gains a(*i);
        a.set(0.9f, 0, 0, 0, 0.5f);
        const int chunks = 200000;
        for (int c = 0; c < 2000; ++c) a.process();
        auto t0 = std::chrono::steady_clock::now();
        for (int c = 0; c < chunks; ++c) a.process();
        double ns = std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - t0).count() / (double(chunks) * kChunk);
        std::printf("     Wasmtime: %.1f ns / sample, %.3f %% of a core at 48 kHz\n", ns, ns * 48000 / 1e9 * 100);
        check(!i->failed() && ns < 200, "speed, instance did not trap");
    }
    std::printf(g_failures ? "%d check(s) failed\n" : "all checks passed\n", g_failures);
    return g_failures ? 1 : 0;
}
