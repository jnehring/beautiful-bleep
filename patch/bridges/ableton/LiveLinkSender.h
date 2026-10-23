// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// LiveLinkSender — Bleep Board's side of the Bleep Live Link device (Max for Live). The board's Live Params node
// publishes its inputs (four per channel, eight channels); this sends the ones that changed to the device as OSC over UDP on localhost, about
// 100 times a second, and answers a device's /bleep/hello <channel> by sending that channel's rows again.
// Input k goes to the device of channel k / 4 + 1 (its own UDP port), as its row k % 4.
#pragma once

#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>

#include "EngineApi.h"
#include "LiveParamsDsp.h"

#include <memory>

namespace bleep::patch {

class LiveLinkSender : private juce::Timer {
public:
    /// `engine` must outlive the sender. Only the set's active Bleep Board (`handle`) sends; a second one stays quiet.
    LiveLinkSender(engine::IEngine& engine, int handle);
    ~LiveLinkSender() override;

private:
    void timerCallback() override;
    void listen();

    engine::IEngine& engine_;
    int handle_;
    juce::DatagramSocket out_{false}, in_{false};
    bool listening_ = false;
    int retry_ = 0;
    LiveParamsSender sender_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(LiveLinkSender)
};

}  // namespace bleep::patch
