// SPDX-License-Identifier: MIT
//
// PortEditor — the small plugin window of every port (spec §6): the node's
// name, a status line (board, latency, sync) and Open Board. Opening it also
// opens the board, or brings it to the front (spec §9.1).
#pragma once

#include "PortProcessor.h"

#include <juce_gui_basics/juce_gui_basics.h>

namespace bleep::patch {

class PortEditor : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit PortEditor(PortProcessor&);
    ~PortEditor() override;
    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;

    PortProcessor& processor_;
    juce::Label title_, status_;
    juce::TextEditor name_;
    juce::TextButton openBoard_{"Open Board"}, replace_{"Replace current board"};
    juce::Slider mix_;
    std::unique_ptr<juce::SliderParameterAttachment> mixAttachment_;
};

}  // namespace bleep::patch
