// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "WasmRecorder.h"

#include <juce_core/juce_core.h>

#include <thread>
#include <vector>

namespace bleep::engine::wasm {

int32_t DiskRecorder::open(const std::string& specJson, double sampleRate, int32_t format) {
    message_.clear();
    recording::ensureDiskService();
    recording::Service* svc = recording::service();
    if (!svc) return 0;
    const juce::var v = juce::JSON::parse(juce::String(specJson));
    std::vector<recording::TrackSpec> tracks;
    if (const auto* list = v.isObject() ? v["tracks"].getArray() : nullptr)
        for (const auto& t : *list) {
            recording::TrackSpec s;
            s.name = t["name"].toString().toStdString();
            s.channels = (int)t["channels"];
            tracks.push_back(std::move(s));
        }
    int slot = -1;
    for (int i = 0; i < kSessions && slot < 0; ++i)
        if (!sessions_[i]) slot = i;
    if (slot < 0) {
        message_ = "Too many recordings are open.";
        return -1;
    }
    if (format < 0 || format > 4) {
        message_ = "Unknown file format.";
        return -1;
    }
    const recording::Format formats[] = {recording::Format::Pcm16, recording::Format::Pcm24, recording::Format::Float32, recording::Format::Mp3_192,
                                         recording::Format::Mp3_320};
    const auto fmt = formats[format];
    std::string error;
    auto session = svc->open(v["name"].toString().toStdString(), tracks, sampleRate, fmt, &error);
    if (!session) {
        message_ = error.empty() ? "Recording could not start." : error;
        return -1;
    }
    sessions_[slot] = std::move(session);
    return slot + 1;
}

bool DiskRecorder::take(int32_t handle, bool begin) {
    recording::Session* s = at(handle);
    return s && (begin ? s->beginTake() : s->endTake());
}

bool DiskRecorder::write(int32_t handle, int32_t track, const float* left, const float* right, int32_t frames) {
    recording::Session* s = at(handle);
    const float* ch[2] = {left, right ? right : left};
    return s && s->write(track, ch, frames);
}

int32_t DiskRecorder::status(int32_t handle, int64_t& frames, int32_t& take) {
    recording::Session* s = at(handle);
    if (!s) return 0;
    const recording::Status st = s->status();
    frames = (int64_t)st.frames;
    take = st.take;
    return (st.takeOpen ? 1 : 0) | (st.failed ? 2 : 0);
}

std::string DiskRecorder::text(int32_t handle, int32_t what) {
    if (what == 0) return recording::service() ? recording::service()->where() : std::string();
    recording::Session* s = at(handle);
    if (what == 1) return s ? s->status().message : message_;
    return s ? s->status().folder : std::string();
}

double DiskRecorder::freeBytes() {
    recording::ensureDiskService();
    return recording::service() ? recording::service()->freeBytes() : 0.0;
}

void DiskRecorder::close(int32_t handle) {
    if (handle < 1 || handle > kSessions || !sessions_[handle - 1]) return;
    // Finishing the files takes a moment (the writer drains its buffers): not on the audio thread.
    std::thread([s = std::move(sessions_[handle - 1])]() mutable { s.reset(); }).detach();
}

}  // namespace bleep::engine::wasm
