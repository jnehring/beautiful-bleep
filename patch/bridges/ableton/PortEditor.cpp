// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "PortEditor.h"
#include "Board.h"
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
    preset_.onClick = [this] {
        if (panel_) panel_->showPresets();
        else showPresets();
    };
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

    if (auto* board = p.boardParameter()) {
        boardLabel_.setText("Board", juce::dontSendNotification);
        boardLabel_.setColour(juce::Label::textColourId, kText);
        addAndMakeVisible(boardLabel_);
        board_.addItemList({"This set", "Bleep App", "Bleep Play"}, 1);
        boardAttachment_ = std::make_unique<juce::ComboBoxParameterAttachment>(*board, board_);
        addAndMakeVisible(board_);
    }

    if (plugin()) {
        // Bleep Instrument and Bleep FX (cell-plugins.md §11): a bar and the cell's panel; the board opens on request.
        for (auto* b : {&prev_, &next_}) addAndMakeVisible(*b);
        prev_.onClick = [this] { step(-1); };
        next_.onClick = [this] { step(1); };
        title_.setVisible(false);
        status_.setVisible(false);
        name_.setVisible(false);
        preset_.setVisible(true);
        PanelView::Presets presets;
        presets.list = [this] {
            juce::Array<juce::var> out;
            const auto current = processor_.presetName();
            for (const auto& e : PresetLibrary::forKind(processor_.kind())) {
                auto* o = new juce::DynamicObject();
                o->setProperty("name", e.name);
                o->setProperty("category", e.category);
                o->setProperty("description", e.description);
                const auto doc = engine::board::fromJson(e.json);
                o->setProperty("tags", doc["tags"]);
                o->setProperty("needs", doc["needs"]);   // modules the preset requires (developers/modules/library.md section 6)
                juce::Array<juce::var> nodes;            // just the node types: the page works out which modules provide them
                if (const auto* all = doc["nodes"].getArray())
                    for (const auto& n : *all) {
                        auto* t = new juce::DynamicObject();
                        t->setProperty("type", n["type"]);
                        nodes.add(juce::var(t));
                    }
                o->setProperty("nodes", nodes);
                o->setProperty("current", e.name == current);
                out.add(juce::var(o));
            }
            return juce::var(out);
        };
        presets.load = [this](const juce::String& name) {
            processor_.loadPreset(name);
            preset_.setButtonText(name);
        };
        panel_ = std::make_unique<PanelView>(processor_.engine(), processor_.handle(), std::move(presets), [this](int w, int h) {
            juce::MessageManager::callAsync([safe = juce::Component::SafePointer<PortEditor>(this), w, h] {
                if (safe == nullptr) return;
                safe->panelW_ = w;
                safe->panelH_ = h;
                const auto area = juce::Desktop::getInstance().getDisplays().getPrimaryDisplay()->userArea;
                safe->setSize(juce::jlimit(380, juce::jmax(380, area.getWidth() - 80), w),
                              juce::jlimit(280, juce::jmax(280, area.getHeight() - 120), h + kBar));
            });
        });
        addAndMakeVisible(*panel_);
        setResizeLimits(380, 280, 3000, 2000);
        setResizable(true, true);
        setSize(560, 500);
    } else {
        setSize(400, (p.mixParameter() ? 188 : 156) + (p.boardParameter() ? 34 : 0));
        // Spec §9.1: opening a plugin window opens the board, or brings it forward. A bridged plugin has its
        // board somewhere else.
        if (!p.bridged()) processor_.engine().editorOpened(processor_.handle());
    }
    timerCallback();
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
    if (plugin()) {
        auto all = getLocalBounds();
        auto bar = all.removeFromTop(kBar).reduced(6, 4);
        prev_.setBounds(bar.removeFromLeft(26));
        bar.removeFromLeft(2);
        next_.setBounds(bar.removeFromLeft(26));
        bar.removeFromLeft(6);
        openBoard_.setBounds(bar.removeFromRight(100));
        if (mix_.isVisible()) {
            bar.removeFromRight(6);
            mix_.setBounds(bar.removeFromRight(160));
        }
        bar.removeFromRight(6);
        preset_.setBounds(bar);
        if (panel_) panel_->setBounds(all);
        return;
    }
    auto r = getLocalBounds().reduced(14, 10);
    auto top = r.removeFromTop(26);
    openBoard_.setBounds(top.removeFromRight(110));
    title_.setBounds(top);
    r.removeFromTop(8);
    if (board_.isVisible()) {
        auto row = r.removeFromTop(26);
        boardLabel_.setBounds(row.removeFromLeft(56));
        board_.setBounds(row);
        r.removeFromTop(8);
    }
    if (name_.isVisible()) {
        name_.setBounds(r.removeFromTop(26));
        r.removeFromTop(8);
    }
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

/// Steps to the previous or next preset of this plugin's list.
void PortEditor::step(int by) {
    const auto& list = PresetLibrary::forKind(processor_.kind());
    if (list.isEmpty()) return;
    const auto current = processor_.presetName();
    int at = 0;
    for (int i = 0; i < list.size(); ++i)
        if (list[i].name == current) at = i;
    const auto& next = list[(at + by + list.size()) % list.size()];
    processor_.loadPreset(next.name);
    preset_.setButtonText(next.name);
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

namespace {
juce::String bridgeStatus(PortProcessor& p) {
    using Status = bridge::BridgeClient::Status;
    const bool web = p.board() == bridge::Board::Web;
    const char* other = web ? "Bleep Play" : "the Bleep App";
    switch (p.bridgeClient().status()) {
        case Status::Connected: {
            juce::String s = juce::String("Talks to ") + other + (web ? " through the app" : "") + ".";
            if (p.reportsLatency())
                s << "\nLatency " << p.bridgeClient().latencySamples() << " samples"
                  << (p.bridgeClient().extraLatency() > 0 ? " (including the web round trip)" : "");
            if (p.bridgeClient().drops() > 0) s << " - late blocks " << (int)p.bridgeClient().drops();
            return s;
        }
        case Status::AppNotRunning: return "The Bleep App is not running. Nothing is sent.";
        case Status::OtherHost: return "The Bleep App is connected to another host.";
        case Status::NoFreeSlot: return "The Bleep App has no free bridge slot.";
        case Status::VersionMismatch: return "The Bleep App is another version. Update both and restart Live.";
    }
    return {};
}
}  // namespace

void PortEditor::timerCallback() {
    auto& e = processor_.engine();
    char text[256];
    e.statusText(processor_.handle(), text, sizeof text);
    const bool bridged = processor_.bridged();
    status_.setText(bridged ? bridgeStatus(processor_) : juce::String::fromUTF8(text), juce::dontSendNotification);
    if (!plugin() && openBoard_.isVisible() == bridged) {
        openBoard_.setVisible(!bridged);
        resized();
    }
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
    // Bleep Board has no node of its own, apart from its macros.
    name_.setVisible(!plugin() && processor_.kind() != PortKind::Patch && !bridged);
    const bool inactiveMain = state == PortState::InactiveMain;
    if (replace_.isVisible() != inactiveMain) {
        replace_.setVisible(inactiveMain);
        resized();
    }
    repaint();
}

}  // namespace bleep::patch
