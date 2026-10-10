// SPDX-License-Identifier: MIT
#include "PortEditor.h"
#include "PresetLibrary.h"

namespace bleep::patch {

using engine::PortKind;
using engine::PortState;

namespace {
const juce::Colour kBackground(0xff15171c), kPanel(0xff1d2027), kText(0xffe7e9ee), kMuted(0xff8b92a3),
    kAccent(0xff4fd1c5), kWarn(0xffff7a6b);
}

PortEditor::PortEditor(PortProcessor& p) : juce::AudioProcessorEditor(p), processor_(p) {
    title_.setText(p.getName(), juce::dontSendNotification);
    title_.setFont(juce::FontOptions(15.0f, juce::Font::bold));
    title_.setColour(juce::Label::textColourId, kAccent);
    addAndMakeVisible(title_);

    status_.setColour(juce::Label::textColourId, kMuted);
    status_.setFont(juce::FontOptions(12.0f));
    status_.setJustificationType(juce::Justification::topLeft);
    addAndMakeVisible(status_);

    name_.setTextToShowWhenEmpty("Name on the board", kMuted);
    name_.setColour(juce::TextEditor::backgroundColourId, kPanel);
    name_.setColour(juce::TextEditor::textColourId, kText);
    name_.setColour(juce::TextEditor::outlineColourId, juce::Colours::transparentBlack);
    name_.onReturnKey = [this] { processor_.engine().setNodeName(processor_.handle(), name_.getText().toRawUTF8()); };
    name_.onFocusLost = name_.onReturnKey;
    addAndMakeVisible(name_);

    openBoard_.onClick = [this] { processor_.engine().openBoard(processor_.handle()); };
    addAndMakeVisible(openBoard_);
    preset_.onClick = [this] { showPresets(); };
    addChildComponent(preset_);
    preset_.setVisible(p.loadsPresets());
    replace_.onClick = [this] { processor_.engine().replaceBoardWith(processor_.handle()); };
    addChildComponent(replace_);

    if (auto* mix = p.mixParameter()) {
        mix_.setSliderStyle(juce::Slider::LinearHorizontal);
        mix_.setTextBoxStyle(juce::Slider::TextBoxRight, false, 56, 20);
        mix_.setColour(juce::Slider::trackColourId, kAccent);
        mixAttachment_ = std::make_unique<juce::SliderParameterAttachment>(*mix, mix_);
        addAndMakeVisible(mix_);
    }

    setSize(400, (p.mixParameter() ? 188 : 156) + (p.loadsPresets() ? 34 : 0));
    timerCallback();
    // Spec §9.1: opening a plugin window opens the board, or brings it forward.
    processor_.engine().editorOpened(processor_.handle());
    startTimerHz(4);
}

PortEditor::~PortEditor() { stopTimer(); }

void PortEditor::paint(juce::Graphics& g) {
    g.fillAll(kBackground);
    if (processor_.engine().state(processor_.handle()) != PortState::Ok) {
        g.setColour(kWarn);
        g.fillRect(0, 0, 4, getHeight());
    }
}

void PortEditor::resized() {
    auto r = getLocalBounds().reduced(14, 10);
    auto top = r.removeFromTop(26);
    openBoard_.setBounds(top.removeFromRight(110));
    title_.setBounds(top);
    r.removeFromTop(8);
    name_.setBounds(r.removeFromTop(26));
    r.removeFromTop(8);
    if (preset_.isVisible()) {
        preset_.setBounds(r.removeFromTop(26));
        r.removeFromTop(8);
    }
    if (mix_.isVisible()) {
        mix_.setBounds(r.removeFromTop(26));
        r.removeFromTop(6);
    }
    if (replace_.isVisible()) replace_.setBounds(r.removeFromBottom(26).removeFromLeft(190));
    status_.setBounds(r);
}

/// A menu of the presets this plugin can play, by category (the real browser comes later).
void PortEditor::showPresets() {
    juce::PopupMenu menu;
    std::map<juce::String, juce::PopupMenu> byCategory;
    std::vector<juce::String> order;
    const auto& list = PresetLibrary::forKind(processor_.kind());
    for (int i = 0; i < list.size(); ++i) {
        if (byCategory.find(list[i].category) == byCategory.end()) order.push_back(list[i].category);
        byCategory[list[i].category].addItem(i + 1, list[i].name, true, list[i].name == processor_.presetName());
    }
    for (const auto& c : order) menu.addSubMenu(c, byCategory[c]);
    menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&preset_), [this, &list](int result) {
        if (result <= 0) return;
        processor_.loadPreset(list[result - 1].name);
        preset_.setButtonText(list[result - 1].name);
    });
}

void PortEditor::timerCallback() {
    auto& e = processor_.engine();
    char text[256];
    e.statusText(processor_.handle(), text, sizeof text);
    status_.setText(juce::String::fromUTF8(text), juce::dontSendNotification);
    if (!name_.hasKeyboardFocus(true)) {
        e.nodeName(processor_.handle(), text, sizeof text);
        name_.setText(juce::String::fromUTF8(text), false);
    }
    // The preset's name is read when a window opens and after a pick; reading it extracts the whole cell.
    if (preset_.isVisible() && preset_.getButtonText() == "Preset") {
        const auto name = processor_.presetName();
        if (name.isNotEmpty()) preset_.setButtonText(name);
    }
    const auto state = e.state(processor_.handle());
    // Bleep Patch has no node of its own, apart from its macros.
    name_.setVisible(processor_.kind() != PortKind::Patch);
    const bool inactiveMain = state == PortState::InactiveMain;
    if (replace_.isVisible() != inactiveMain) {
        replace_.setVisible(inactiveMain);
        resized();
    }
    repaint();
}

}  // namespace bleep::patch
