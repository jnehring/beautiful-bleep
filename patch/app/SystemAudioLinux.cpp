// SPDX-License-Identifier: MIT
//
// System Audio on Linux: the monitor of an output, through PulseAudio's API (doc/specs/system-audio.md §6.3).
//
// Every output ("sink") has a monitor source that carries what the sink plays. PipeWire serves the same API
// (pipewire-pulse), so this covers nearly every desktop. The server resamples to 48 kHz stereo for us. There is no way
// to leave one program's sound out of a monitor: the app's own output is part of it when the app plays to the same sink.
#include "SystemAudio.h"

#include <pulse/pulseaudio.h>

#include <chrono>
#include <mutex>
#include <thread>

namespace bleep::app {
namespace {

constexpr int kRate = 48000;

class PulseSystemAudio final : public SystemAudio {
public:
    ~PulseSystemAudio() override { stop(); }

    std::string start(const SystemAudioOptions& options) override {
        stop();
        {
            std::lock_guard<std::mutex> lock(mutex_);
            problem_.clear();
        }
        loop_ = pa_threaded_mainloop_new();
        if (!loop_) return "The sound server could not be reached.";
        context_ = pa_context_new(pa_threaded_mainloop_get_api(loop_), "Bleep App");
        if (!context_) return fail("The sound server could not be reached.");
        pa_context_set_state_callback(context_, [](pa_context*, void* self) {
            pa_threaded_mainloop_signal(static_cast<PulseSystemAudio*>(self)->loop_, 0);
        }, this);

        pa_threaded_mainloop_lock(loop_);
        if (pa_threaded_mainloop_start(loop_) < 0) {
            pa_threaded_mainloop_unlock(loop_);
            return fail("The sound server could not be reached.");
        }
        if (pa_context_connect(context_, nullptr, PA_CONTEXT_NOFLAGS, nullptr) < 0) {
            pa_threaded_mainloop_unlock(loop_);
            return fail("No PulseAudio or PipeWire sound server was found.");
        }
        for (;;) {
            const auto state = pa_context_get_state(context_);
            if (state == PA_CONTEXT_READY) break;
            if (!PA_CONTEXT_IS_GOOD(state)) {
                pa_threaded_mainloop_unlock(loop_);
                return fail("No PulseAudio or PipeWire sound server was found.");
            }
            pa_threaded_mainloop_wait(loop_);
        }

        const pa_sample_spec spec{PA_SAMPLE_FLOAT32LE, (uint32_t)kRate, 2};
        stream_ = pa_stream_new(context_, "System audio", &spec, nullptr);
        if (!stream_) {
            pa_threaded_mainloop_unlock(loop_);
            return fail("The sound server refused the capture stream.");
        }
        pa_stream_set_state_callback(stream_, [](pa_stream* s, void* self) {
            auto* me = static_cast<PulseSystemAudio*>(self);
            const auto state = pa_stream_get_state(s);
            if (state == PA_STREAM_FAILED || state == PA_STREAM_TERMINATED) {
                std::lock_guard<std::mutex> lock(me->mutex_);
                if (!me->stopping_) me->problem_ = "The sound server closed the capture stream.";
            }
            pa_threaded_mainloop_signal(me->loop_, 0);
        }, this);
        pa_stream_set_read_callback(stream_, [](pa_stream* s, size_t, void* self) {
            static_cast<PulseSystemAudio*>(self)->onRead(s);
        }, this);

        pa_buffer_attr attr{};
        attr.maxlength = (uint32_t)-1;
        attr.tlength = (uint32_t)-1;
        attr.prebuf = (uint32_t)-1;
        attr.minreq = (uint32_t)-1;
        attr.fragsize = (uint32_t)(kRate / 100 * 2 * sizeof(float));  // 10 ms
        const char* device = options.source.empty() ? "@DEFAULT_MONITOR@" : options.source.c_str();
        if (pa_stream_connect_record(stream_, device, &attr, PA_STREAM_ADJUST_LATENCY) < 0) {
            const std::string text = pa_strerror(pa_context_errno(context_));
            pa_threaded_mainloop_unlock(loop_);
            return fail("The sound server cannot capture that output (" + text + ").");
        }
        for (;;) {
            const auto state = pa_stream_get_state(stream_);
            if (state == PA_STREAM_READY) break;
            if (!PA_STREAM_IS_GOOD(state)) {
                const std::string text = pa_strerror(pa_context_errno(context_));
                pa_threaded_mainloop_unlock(loop_);
                return fail("The sound server cannot capture that output (" + text + ").");
            }
            pa_threaded_mainloop_wait(loop_);
        }
        pa_threaded_mainloop_unlock(loop_);
        return {};
    }

    void stop() override {
        stopping_ = true;
        if (loop_) {
            pa_threaded_mainloop_lock(loop_);
            if (stream_) {
                pa_stream_set_read_callback(stream_, nullptr, nullptr);
                pa_stream_set_state_callback(stream_, nullptr, nullptr);
                pa_stream_disconnect(stream_);
                pa_stream_unref(stream_);
                stream_ = nullptr;
            }
            if (context_) {
                pa_context_set_state_callback(context_, nullptr, nullptr);
                pa_context_disconnect(context_);
                pa_context_unref(context_);
                context_ = nullptr;
            }
            pa_threaded_mainloop_unlock(loop_);
            pa_threaded_mainloop_stop(loop_);
            pa_threaded_mainloop_free(loop_);
            loop_ = nullptr;
        }
        stopping_ = false;
    }

    double sampleRate() const override { return kRate; }
    bool excluding() const override { return false; }
    std::string problem() const override {
        std::lock_guard<std::mutex> lock(mutex_);
        return problem_;
    }

private:
    std::string fail(const std::string& text) {
        stop();
        return text;
    }

    /// The mainloop thread: whatever the server has captured, into the ring.
    void onRead(pa_stream* s) {
        while (pa_stream_readable_size(s) > 0) {
            const void* data = nullptr;
            size_t bytes = 0;
            if (pa_stream_peek(s, &data, &bytes) < 0 || bytes == 0) break;
            const int frames = (int)(bytes / (2 * sizeof(float)));
            if (data) ring_.writeInterleaved(static_cast<const float*>(data), frames, 2);
            else ring_.writeSilence(frames);  // a hole in the stream
            pa_stream_drop(s);
        }
    }

    pa_threaded_mainloop* loop_ = nullptr;
    pa_context* context_ = nullptr;
    pa_stream* stream_ = nullptr;
    mutable std::mutex mutex_;
    std::atomic<bool> stopping_{false};
    std::string problem_;
};

struct SourceQuery {
    std::vector<std::pair<std::string, std::string>> found;
    bool done = false;
};

}  // namespace

std::string SystemAudio::unsupportedReason() { return {}; }
bool SystemAudio::canExclude() { return false; }

std::vector<std::pair<std::string, std::string>> SystemAudio::sources() {
    SourceQuery query;
    pa_mainloop* loop = pa_mainloop_new();
    if (!loop) return {};
    pa_context* context = pa_context_new(pa_mainloop_get_api(loop), "Bleep App");
    if (context && pa_context_connect(context, nullptr, PA_CONTEXT_NOFLAGS, nullptr) >= 0) {
        bool asked = false;
        const auto until = std::chrono::steady_clock::now() + std::chrono::seconds(2);
        while (!query.done && std::chrono::steady_clock::now() < until) {
            pa_mainloop_iterate(loop, 0, nullptr);
            const auto state = pa_context_get_state(context);
            if (!PA_CONTEXT_IS_GOOD(state)) break;
            if (state == PA_CONTEXT_READY && !asked) {
                asked = true;
                pa_operation* operation = pa_context_get_source_info_list(
                    context,
                    [](pa_context*, const pa_source_info* info, int last, void* user) {
                        auto* q = static_cast<SourceQuery*>(user);
                        if (last > 0) q->done = true;
                        else if (info && info->monitor_of_sink != PA_INVALID_INDEX)
                            q->found.emplace_back(info->name, info->description ? info->description : info->name);
                    },
                    &query);
                if (operation) pa_operation_unref(operation);
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        pa_context_disconnect(context);
    }
    if (context) pa_context_unref(context);
    pa_mainloop_free(loop);
    return query.found;
}

std::unique_ptr<SystemAudio> SystemAudio::create() { return std::unique_ptr<SystemAudio>(new PulseSystemAudio()); }

}  // namespace bleep::app
