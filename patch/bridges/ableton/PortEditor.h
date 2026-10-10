// SPDX-License-Identifier: MIT
//
// PortEditor — the small plugin window of every port (spec §6): the node's
// name, a status line (board, latency, sync) and Open Board. Opening it also
// opens the board, or brings it to the front (spec §9.1).
#pragma once

#include "PanelView.h"
#include "PortProcessor.h"

#include <juce_gui_basics/juce_gui_basics.h>

namespace bleep::patch {

constexpr int kBar = 34;  ///< the bar above the panel of a cell plugin

class PortEditor : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit PortEditor(PortProcessor&);
    ~PortEditor() override;
    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void showPresets();
    void step(int by);
    bool plugin() const { return processor_.loadsPresets(); }

    PortProcessor& processor_;
    juce::Label title_, status_;
    juce::TextEditor name_;
    juce::TextButton prev_{"<"}, next_{">"}, preset_{"Preset"}, openBoard_{"Open Board"}, replace_{"Replace current board"};
    juce::Slider mix_;
    std::unique_ptr<juce::SliderParameterAttachment> mixAttachment_;
    std::unique_ptr<PanelView> panel_;   ///< Bleep Instrument and Bleep FX: the cell's panel
    int panelW_ = 0, panelH_ = 0;
};

}  // namespace bleep::patch
