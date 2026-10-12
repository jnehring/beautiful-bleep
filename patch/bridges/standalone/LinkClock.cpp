// SPDX-License-Identifier: MIT
#include "LinkClock.h"

#include <atomic>
#include <chrono>
#include <cmath>

#if BLEEP_LINK
#include <ableton/Link.hpp>
#endif

namespace bleep::app {

struct LinkClock::Impl {
#if BLEEP_LINK
    ableton::Link link{120.0};
#endif
    std::atomic<bool> enabled{false};
    std::atomic<bool> startStopSync{true};
    // The internal clock, used without Link (or when Link is off).
    std::atomic<double> tempo{120.0};
    std::atomic<bool> playing{false};
    std::atomic<bool> restart{false};
    double ppq = 0.0;  // audio thread
};

LinkClock::LinkClock() : impl_(std::make_unique<Impl>()) {}
LinkClock::~LinkClock() = default;

bool LinkClock::available() noexcept {
#if BLEEP_LINK
    return true;
#else
    return false;
#endif
}

void LinkClock::enable(bool on) {
    impl_->enabled = on && available();
#if BLEEP_LINK
    impl_->link.enable(impl_->enabled);
#endif
}

bool LinkClock::enabled() const noexcept { return impl_->enabled; }

void LinkClock::setStartStopSync(bool on) {
    impl_->startStopSync = on;
#if BLEEP_LINK
    impl_->link.enableStartStopSync(on);
#endif
}

int LinkClock::peers() const noexcept {
#if BLEEP_LINK
    return impl_->enabled ? (int)impl_->link.numPeers() : 0;
#else
    return 0;
#endif
}

double LinkClock::tempo() const noexcept {
#if BLEEP_LINK
    if (impl_->enabled) return impl_->link.captureAppSessionState().tempo();
#endif
    return impl_->tempo;
}

void LinkClock::setTempo(double bpm) {
    impl_->tempo = bpm;
#if BLEEP_LINK
    if (impl_->enabled) {
        auto state = impl_->link.captureAppSessionState();
        state.setTempo(bpm, impl_->link.clock().micros());
        impl_->link.commitAppSessionState(state);
    }
#endif
}

bool LinkClock::playing() const noexcept {
#if BLEEP_LINK
    if (impl_->enabled && impl_->startStopSync) return impl_->link.captureAppSessionState().isPlaying();
#endif
    return impl_->playing;
}

void LinkClock::setPlaying(bool on) {
    if (on && !impl_->playing) impl_->restart = true;
    impl_->playing = on;
#if BLEEP_LINK
    if (impl_->enabled && impl_->startStopSync) {
        auto state = impl_->link.captureAppSessionState();
        state.setIsPlayingAndRequestBeatAtTime(on, impl_->link.clock().micros(), 0.0, 4.0);
        impl_->link.commitAppSessionState(state);
    }
#endif
}

LinkClock::Time LinkClock::atBlock(int numSamples, double sampleRate, double quantum, int64_t latencyMicros) noexcept {
    Time t;
#if BLEEP_LINK
    if (impl_->enabled) {
        const auto state = impl_->link.captureAudioSessionState();
        const auto at = impl_->link.clock().micros() + std::chrono::microseconds(latencyMicros);
        t.bpm = state.tempo();
        t.ppq = state.beatAtTime(at, quantum);
        t.playing = impl_->startStopSync ? state.isPlaying() : impl_->playing.load();
        return t;
    }
#else
    (void)quantum;
    (void)latencyMicros;
#endif
    if (impl_->restart.exchange(false)) impl_->ppq = 0.0;
    t.bpm = impl_->tempo;
    t.ppq = impl_->ppq;
    t.playing = impl_->playing;
    if (t.playing) impl_->ppq += numSamples * t.bpm / 60.0 / sampleRate;
    return t;
}

}  // namespace bleep::app
