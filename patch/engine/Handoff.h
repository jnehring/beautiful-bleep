// SPDX-License-Identifier: MIT
//
// Handoff.h — hands an object built on the message thread (a decoded clip, a
// wavetable set, a parsed pattern) to the audio thread without locks on the
// audio side and without freeing memory there.
//
//   message thread   handoff.publish(std::make_shared<const Table>(...));
//   audio thread     if (const Table* t = handoff.get()) ... use *t ...
//
// The audio thread picks up a new object at its next get() (a try-lock; if
// the message thread is publishing at that moment it keeps the current one
// for this chunk). Replaced objects are released on the message thread at the
// next publish(), never on the audio thread.
#pragma once

#include <atomic>
#include <memory>
#include <mutex>
#include <vector>

namespace bleep::engine {

template <class T>
class RtHandoff {
public:
    /// [message thread] Makes `next` the current object (null clears it).
    void publish(std::shared_ptr<const T> next) {
        std::lock_guard<std::mutex> l(lock_);
        trash_.clear();  // what the audio thread swapped out earlier
        pending_ = std::move(next);
        hasPending_.store(true, std::memory_order_release);
    }

    /// [audio thread] The current object, or null.
    const T* get() noexcept {
        if (hasPending_.load(std::memory_order_acquire) && lock_.try_lock()) {
            trash_.push_back(std::move(current_));  // capacity reserved: no allocation here
            current_ = std::move(pending_);
            hasPending_.store(false, std::memory_order_relaxed);
            lock_.unlock();
        }
        return current_.get();
    }

    RtHandoff() { trash_.reserve(8); }

private:
    std::mutex lock_;
    std::atomic<bool> hasPending_{false};
    std::shared_ptr<const T> pending_, current_;
    std::vector<std::shared_ptr<const T>> trash_;
};

}  // namespace bleep::engine
