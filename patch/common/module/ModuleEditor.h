// SPDX-License-Identifier: MIT
//
// ModuleEditor — every Bleep Patch module shows the same HTML/CSS/JS UI
// (patch/common/web/) in a WebView. The page builds itself from the
// processor's description, so a new module needs no UI code at all.
//
// Bridge (all names are JUCE native functions / events):
//   JS → C++   describe() setParam(id, v) beginGesture(id) endGesture(id)
//              setName(name) sources() connect(input, uid, output, amount)
//              setAmount(input, uid, output, amount) disconnect(input)
//   C++ → JS   event "state" (30 Hz): knob values, live modulation, outputs
//              event "patch" (when cables or the bus registry change)
// UIDs cross the bridge as 16-digit hex strings (JS numbers are 53-bit).
#pragma once

#include "ModuleProcessor.h"

#include <juce_gui_extra/juce_gui_extra.h>

namespace bleep::patch {

class ModuleEditor : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit ModuleEditor(ModuleProcessor&);
    ~ModuleEditor() override;
    void resized() override;
    void paint(juce::Graphics&) override;

private:
    class WebView;

    void timerCallback() override;
    juce::var describe() const;
    juce::var sources() const;
    juce::var connections() const;
    juce::RangedAudioParameter* parameter(const juce::String& id) const;

    ModuleProcessor& processor_;
    std::unique_ptr<WebView> web_;
    uint32_t seenRegistry_ = ~0u, seenConnections_ = ~0u;
    int frame_ = 0;
};

}  // namespace bleep::patch
