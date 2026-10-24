// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// WasmRuntime.h — Wasmtime behind a small interface (developers/modules/module-abi.md, section 8): compile a module file once,
// make an instance of it per node, call its exports. The imports the ABI allows are provided as stubs that give a module
// nothing but computation: no files, no environment, no clock.
//
// An Instance is single-threaded: calls into it must not overlap (module-abi.md section 3).
#pragma once

#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <memory>
#include <string>
#include <vector>

namespace bleep::engine::wasm {

/// One argument of a call into a module: i32, i64, f32 or f64.
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

/// Answers a module's request for sample files (module-abi.md, "Media"). Called on the thread that is inside the module,
/// so it must not wait for the disk: a clip that is not at hand is "not available" (0 frames).
class MediaHandler {
public:
    virtual ~MediaHandler() = default;
    /// The clip's length in frames, with its sample rate and channel count; 0 if it is not available (yet).
    virtual int64_t info(const std::string& id, double& sampleRate, int32_t& channels) = 0;
    /// Copies one channel of the clip (`frames` of them) to `dst`.
    virtual bool read(const std::string& id, int32_t channel, float* dst, int64_t frames) = 0;
};

/// Answers a module's recording calls (module-abi.md, section 5b): audio goes out, nothing comes in but the status. Called on
/// the thread that is inside the module, so none of it may block: `open` does only the quick part, `close` hands the session on.
class RecordHandler {
public:
    virtual ~RecordHandler() = default;
    /// A session for `specJson` ({"name", "tracks": [{"name", "channels"}]}); format 0 = 16-bit, 1 = 24-bit, 2 = 32-bit float.
    /// A handle (>= 1), 0 when there is no recorder, -1 when the spec is refused (`text(0, 1)` says why).
    virtual int32_t open(const std::string& specJson, double sampleRate, int32_t format) = 0;
    virtual bool take(int32_t handle, bool begin) = 0;
    /// `right` is null for a track of one channel.
    virtual bool write(int32_t handle, int32_t track, const float* left, const float* right, int32_t frames) = 0;
    /// Bit 0: a take is open; bit 1: the session failed.
    virtual int32_t status(int32_t handle, int64_t& frames, int32_t& take) = 0;
    /// 0 = where the files go, 1 = the last message, 2 = the session's folder.
    virtual std::string text(int32_t handle, int32_t what) = 0;
    virtual double freeBytes() = 0;
    virtual void close(int32_t handle) = 0;
};

/// Limits on what a module (untrusted code) may take from the host.
constexpr size_t kMaxModuleBytes = size_t(32) << 20;   ///< a larger file is not compiled
constexpr int64_t kMaxTableElements = 100000;          ///< per table
constexpr int64_t kMaxTables = 8;
constexpr int kDefaultBudgetMs = 250;                  ///< how long one call into a module may run before it is stopped (a trap)
constexpr int kInitBudgetMs = 5000;                    ///< _initialize

/// A compiled module file. Compile once per file and process; instantiate as often as needed (thread-safe).
class Compiled {
public:
    ~Compiled();
    /// Compiles the bytes. Null (with `error`) if they are not a module Wasmtime accepts, or import something the ABI does not allow.
    static std::shared_ptr<Compiled> compile(const uint8_t* bytes, size_t size, std::string& error);

    struct Impl;
    std::unique_ptr<Impl> impl;

private:
    Compiled();
};

class Instance {
public:
    ~Instance();
    /// An instance with its own memory, at most `maxMemory` bytes of it. Runs `_initialize` when the module has one.
    static std::unique_ptr<Instance> create(std::shared_ptr<const Compiled> module, std::string& error, size_t maxMemory = size_t(64) << 20);

    /// The linear memory. Its base moves when the module grows: fetch it again after every call into the module.
    uint8_t* memory() noexcept;
    size_t memorySize() noexcept;

    /// Resolves an export once; calls go through the handle. -1: no such function.
    int find(const char* name);

    /// Calls an export that returns an i32, or nothing (0). A trap sets failed() and returns 0.
    int32_t call(int fn, std::initializer_list<Arg> args = {}) noexcept;
    float callF32(int fn, std::initializer_list<Arg> args = {}) noexcept;

    /// The time one call into the module may take (to the next millisecond tick, give or take one). A call that takes longer
    /// is stopped with a trap: failed() is set and lastError() says so. Default: kDefaultBudgetMs.
    void setBudgetMs(int ms) noexcept;

    /// Who answers bleep_media_info / bleep_media_read. None: every clip is missing. Must outlive the instance.
    void setMedia(MediaHandler* handler) noexcept;

    /// Who answers the bleep_record_* imports. None: there is no recorder (open returns 0). Must outlive the instance.
    void setRecorder(RecordHandler* handler) noexcept;

    /// True once a call trapped (an exception that escaped, an unreachable, out of memory). The instance should then be bypassed.
    bool failed() const noexcept { return failed_; }
    const std::string& lastError() const noexcept { return error_; }

    struct Impl;
    std::unique_ptr<Impl> impl;

private:
    Instance();
    bool failed_ = false;
    std::string error_;
};

}  // namespace bleep::engine::wasm
