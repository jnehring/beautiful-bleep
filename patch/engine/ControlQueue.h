// SPDX-License-Identifier: MIT
//
// ControlQueue.h — performance gestures from the message thread to the audio
// thread (Module::perform): a single-producer, single-consumer ring. A full
// queue drops the newest event; the consumer drains it at the chunk start.
#pragma once

#include <atomic>
#include <cstdint>

namespace bleep::engine {

struct ControlEvent {
    int type = 0;
    int value = 0;
    float amount = 0.0f;
};

template <int Capacity = 256>
class ControlQueue {
    static_assert((Capacity & (Capacity - 1)) == 0, "Capacity must be a power of two");

public:
    /// [message thread]
    bool push(const ControlEvent& e) noexcept {
        const uint32_t w = write_.load(std::memory_order_relaxed);
        if (w - read_.load(std::memory_order_acquire) >= (uint32_t)Capacity) return false;
        events_[w & (Capacity - 1)] = e;
        write_.store(w + 1, std::memory_order_release);
        return true;
    }
    /// [audio thread]
    bool pop(ControlEvent& e) noexcept {
        const uint32_t r = read_.load(std::memory_order_relaxed);
        if (r == write_.load(std::memory_order_acquire)) return false;
        e = events_[r & (Capacity - 1)];
        read_.store(r + 1, std::memory_order_release);
        return true;
    }

private:
    ControlEvent events_[Capacity];
    std::atomic<uint32_t> write_{0}, read_{0};
};

}  // namespace bleep::engine
