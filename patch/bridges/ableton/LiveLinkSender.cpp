// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
#include "LiveLinkSender.h"

#include "LiveLinkOsc.h"

namespace bleep::patch {

LiveLinkSender::LiveLinkSender(engine::IEngine& engine, int handle) : engine_(engine), handle_(handle) {
    startTimerHz(100);
}

LiveLinkSender::~LiveLinkSender() {
    stopTimer();
}

/// Binds the port the device says hello to. Another Live (or another Bleep Board) may hold it: then there is no
/// hello, and the device only gets values when it is already listening; we try again every few seconds.
void LiveLinkSender::listen() {
    listening_ = in_.bindToPort(osc::kBoardPort, "127.0.0.1");
}

void LiveLinkSender::timerCallback() {
    if (!engine_.supports(3) || engine_.state(handle_) != engine::PortState::Ok) return;

    if (!listening_ && retry_-- <= 0) {
        listen();
        retry_ = 500;   // 5 s
    }
    if (listening_) {
        uint8_t packet[64];
        while (in_.waitUntilReady(true, 0) == 1) {
            const int n = in_.read(packet, (int)sizeof(packet), false);
            if (n <= 0) break;
            int channel = 0;
            if (osc::parseHello(packet, (size_t)n, channel)) sender_.resendChannel(channel);
        }
    }

    float offsets[kNumLiveParams];
    LiveParamsMailbox snapshot;
    const uint32_t cabled = engine_.liveParams(offsets);
    snapshot.cabled.store(cabled, std::memory_order_relaxed);
    for (int k = 0; k < kNumLiveParams; ++k) snapshot.offset[k].store(offsets[k], std::memory_order_relaxed);

    sender_.poll(snapshot, [&](int input, float value) {
        uint8_t packet[64];
        if (const size_t n = osc::encodeParam(osc::rowOf(input), value, packet, sizeof(packet)))
            out_.write("127.0.0.1", osc::devicePort(input), packet, (int)n);
    });
}

}  // namespace bleep::patch
