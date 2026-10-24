// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// WasmRecorder.h — the host's answer to a module's bleep_record_* imports (module-abi.md, section 5b): they become calls on the
// native recorder service (Recording.h), which writes the files. One per module instance; its sessions belong to that instance.
//
// Every call comes from the thread that is inside the module: the audio thread. So none of it waits: open() only builds the
// session (buffers and a writer thread; the files are made later, on the writer's thread), write() is a copy, and close()
// hands the session to a background thread to finish.
#pragma once

#include "Recording.h"
#include "WasmRuntime.h"

#include <memory>
#include <string>

namespace bleep::engine::wasm {

class DiskRecorder final : public RecordHandler {
public:
    ~DiskRecorder() override = default;  // the module is gone and nobody is writing: the sessions finish here

    int32_t open(const std::string& specJson, double sampleRate, int32_t format) override;
    bool take(int32_t handle, bool begin) override;
    bool write(int32_t handle, int32_t track, const float* left, const float* right, int32_t frames) override;
    int32_t status(int32_t handle, int64_t& frames, int32_t& take) override;
    std::string text(int32_t handle, int32_t what) override;
    double freeBytes() override;
    void close(int32_t handle) override;

private:
    static constexpr int kSessions = 4;
    recording::Session* at(int32_t handle) { return handle >= 1 && handle <= kSessions ? sessions_[handle - 1].get() : nullptr; }
    std::unique_ptr<recording::Session> sessions_[kSessions];
    std::string message_;
};

}  // namespace bleep::engine::wasm
