// SPDX-License-Identifier: MIT
#include "PanelView.h"

#include "BoardResources.h"

namespace bleep::patch {

using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;

/// Navigates only once it is on screen (a web view built off screen does not load in some hosts).
class PanelView::Web : public juce::WebBrowserComponent {
public:
    using juce::WebBrowserComponent::WebBrowserComponent;
    void visibilityChanged() override {
        juce::WebBrowserComponent::visibilityChanged();
        go();
    }
    void parentHierarchyChanged() override {
        juce::WebBrowserComponent::parentHierarchyChanged();
        go();
    }

private:
    void go() {
        if (navigated_ || !isShowing()) return;
        navigated_ = true;
        goToURL(getResourceProviderRoot());
    }
    bool navigated_ = false;
};

PanelView::PanelView(engine::IEngine& engine, int handle, Presets presets, std::function<void(int, int)> onSize)
    : engine_(engine), handle_(handle), presets_(std::move(presets)), onSize_(std::move(onSize)) {
    auto options = juce::WebBrowserComponent::Options{}
                       .withNativeIntegrationEnabled()
                       .withKeepPageLoadedWhenBrowserIsHidden()
                       .withResourceProvider([](const juce::String& url) { return engine::boardResource(url); });
    // What the board page asks of the engine: the same names the board window serves.
    for (const char* name : {"init", "commit", "undo", "redo", "beginGesture", "setParam", "setAmount", "setData",
                             "command", "perform", "importMedia", "exportMedia", "types", "pluginCell"}) {
        const juce::String method(name);
        options = options.withNativeFunction(name, [this, method](const juce::Array<juce::var>& a, Completion done) {
            if (method == "init") pageReady_ = true;
            done(call(method, a));
        });
    }
    // Things a panel never needs: answered empty, so the page does not wait for them.
    for (const char* name : {"presets", "midiDevices"})
        options = options.withNativeFunction(name, [](const juce::Array<juce::var>&, Completion done) { done(juce::Array<juce::var>()); });
    for (const char* name : {"savePreset", "deletePreset", "copyText", "pasteText", "loadPatch"})
        options = options.withNativeFunction(name, [](const juce::Array<juce::var>&, Completion done) { done({}); });
    options = options
                  .withNativeFunction("cellPresets", [this](const juce::Array<juce::var>&, Completion done) {
                      done(presets_.list ? presets_.list() : juce::var(juce::Array<juce::var>()));
                  })
                  .withNativeFunction("loadCellPreset", [this](const juce::Array<juce::var>& a, Completion done) {
                      if (presets_.load) presets_.load(a[0].toString());
                      done({});
                  })
                  .withNativeFunction("watch", [this](const juce::Array<juce::var>& a, Completion done) {
                      watched_.clear();
                      if (const auto* ids = a[0].getArray())
                          for (const auto& id : *ids) watched_.insert(id.toString());
                      done({});
                  })
                  .withNativeFunction("panelSize", [this](const juce::Array<juce::var>& a, Completion done) {
                      if (onSize_) onSize_((int)a[0], (int)a[1]);
                      done({});
                  });
#if JUCE_WINDOWS
    options = options.withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
                  .withWinWebView2Options(juce::WebBrowserComponent::Options::WinWebView2{}.withUserDataFolder(
                      juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("BleepPatchWebView")));
#endif
    web_ = std::make_unique<Web>(options);
    addAndMakeVisible(*web_);
    startTimerHz(30);
}

PanelView::~PanelView() { stopTimer(); }

void PanelView::showPresets() {
    if (pageReady_) web_->emitEventIfBrowserIsVisible("openPresets", juce::var());
}

void PanelView::resized() { web_->setBounds(getLocalBounds()); }

juce::var PanelView::call(const juce::String& method, const juce::Array<juce::var>& args) {
    const juce::String json = juce::JSON::toString(juce::var(args), true);
    size_t len = engine_.uiCall(handle_, method.toRawUTF8(), json.toRawUTF8(), nullptr, 0);
    std::string out(len, '\0');
    if (len > 0) engine_.uiCall(handle_, "__last", "[]", out.data(), len);
    return juce::JSON::parse(juce::String::fromUTF8(out.data(), (int)out.size()));
}

void PanelView::timerCallback() {
    if (!pageReady_ || !isShowing()) return;
    // The board changed (another preset, an edit on the board): the page redraws what it holds.
    const uint64_t g = engine_.boardGeneration();
    if (g != seenGeneration_) {
        seenGeneration_ = g;
        web_->emitEventIfBrowserIsVisible("board", call("board", {}));
    }
    juce::Array<juce::var> ids;
    for (const auto& id : watched_) ids.add(id);
    web_->emitEventIfBrowserIsVisible("state", call("liveState", {juce::var(ids)}));
}

}  // namespace bleep::patch
