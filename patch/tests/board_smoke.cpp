// SPDX-License-Identifier: MIT
//
// Smoke test for the board window: a real engine with three ports opens the
// real board page in a WebView; the page commits an edit through the bridge
// and reports what it shows (see BoardView::smokeTest). Opens a window for a
// few seconds, so it is not part of ctest:
//
//   cmake --build build/patch --target bleep_board_smoke && <artefact>/bleep_board_smoke
#include "Engine.h"

#include <juce_gui_extra/juce_gui_extra.h>

class SmokeApp : public juce::JUCEApplication {
public:
    const juce::String getApplicationName() override { return "Bleep Board Smoke"; }
    const juce::String getApplicationVersion() override { return "1"; }
    void initialise(const juce::String&) override {
        using namespace bleep::engine;
        engine_ = acquireEngine();
        const int main = engine_->registerInstance(PortKind::Patch);
        engine_->registerInstance(PortKind::MidiIn);
        engine_->registerInstance(PortKind::AudioOut);
        static_cast<Engine*>(engine_)->reconcileNow();
        engine_->openBoard(main);
    }
    void shutdown() override {}

private:
    bleep::engine::IEngine* engine_ = nullptr;  // leaked on purpose: the process ends
};

START_JUCE_APPLICATION(SmokeApp)
