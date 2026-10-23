// SPDX-License-Identifier: GPL-3.0-or-later
// The Live Params module's logic without the engine: the mailbox through which the audio thread hands the
// values of the module's inputs to the bridge, which sends them on to the Bleep Live Link device in Live
// (Max for Live, live.remote~). One mailbox per process, like HostControl. Each node owns the four rows of its channel;
// two nodes on one channel: the last one to run wins.
#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kRowsPerChannel = 4;   ///< a Bleep Live Link device has 4 rows, and a Live Params node 4 inputs
constexpr int kNumChannels = 8;      ///< one device and one node per channel; input k is row k % 4 of channel k / 4 + 1
constexpr int kNumLiveParams = kRowsPerChannel * kNumChannels;
static_assert(kNumLiveParams <= 32, "the cabled mask is 32 bits");

/// Audio thread writes, bridge thread reads. Values are offsets: the device adds them to the parameter's own
/// value, so the parameter keeps the knob position the user set (spec §5.6).
struct LiveParamsMailbox {
    std::atomic<float> offset[kNumLiveParams] = {};
    std::atomic<uint32_t> cabled{0};   ///< bit k: input k has a cable

    /// [RT] One block of input k: its last sample, or nothing if no cable.
    void publish(int k, bool connected, float lastSample) noexcept {
        const uint32_t bit = 1u << k;
        if (!connected) {
            cabled.fetch_and(~bit, std::memory_order_relaxed);
            return;
        }
        offset[k].store(std::isfinite(lastSample) ? lastSample : 0.0f, std::memory_order_relaxed);
        cabled.fetch_or(bit, std::memory_order_relaxed);
    }
    /// A node left its channel (deleted, or its Channel setting changed): the channel's four rows are no longer cabled.
    void clearChannel(int channel) noexcept {
        if (channel < 1 || channel > kNumChannels) return;
        const uint32_t rows = ((1u << kRowsPerChannel) - 1u) << ((channel - 1) * kRowsPerChannel);
        cabled.fetch_and(~rows, std::memory_order_relaxed);
    }
};

inline LiveParamsMailbox& liveParams() noexcept {
    static LiveParamsMailbox mailbox;
    return mailbox;
}

/// Bridge thread: works out which values are worth sending. An input that changed by less than `deadband`
/// is not sent again; one that was uncabled is sent once more as 0, so the device releases the parameter.
class LiveParamsSender {
public:
    explicit LiveParamsSender(float deadband = 0.0005f) : deadband_(deadband) {}

    /// Calls send(k, value) for each input that needs a message.
    template <class F>
    void poll(const LiveParamsMailbox& box, F&& send) {
        const uint32_t cabled = box.cabled.load(std::memory_order_relaxed);
        for (int k = 0; k < kNumLiveParams; ++k) {
            const bool on = (cabled >> k) & 1u;
            if (!on) {
                if (sentOn_[k]) {
                    sentOn_[k] = false;
                    sent_[k] = 0.0f;
                    send(k, 0.0f);
                }
                continue;
            }
            const float v = box.offset[k].load(std::memory_order_relaxed);
            if (!sentOn_[k] || std::fabs(v - sent_[k]) >= deadband_) {
                sentOn_[k] = true;
                sent_[k] = v;
                send(k, v);
            }
        }
    }
    /// A device (re)connected: everything is sent again.
    void resendAll() noexcept { std::fill(std::begin(sentOn_), std::end(sentOn_), false); }
    /// The device of channel `channel` (1-based) (re)connected: its rows are sent again.
    void resendChannel(int channel) noexcept {
        for (int k = (channel - 1) * kRowsPerChannel; k < channel * kRowsPerChannel; ++k)
            if (k >= 0 && k < kNumLiveParams) sentOn_[k] = false;
    }

private:
    float deadband_;
    float sent_[kNumLiveParams] = {};
    bool sentOn_[kNumLiveParams] = {};
};

}  // namespace bleep::patch
