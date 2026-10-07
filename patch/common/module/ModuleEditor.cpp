// SPDX-License-Identifier: MIT
#include "ModuleEditor.h"

#include "ModuleWeb.h" // this module's ui/ + common/ui, generated per plugin

namespace bleep::patch {

namespace {

juce::String uidHex(uint64_t uid) { return juce::String::toHexString((juce::int64)uid).paddedLeft('0', 16); }
uint64_t hexUid(const juce::var& v) { return (uint64_t)v.toString().getHexValue64(); }

const char* typeName(bb_signal_type t) {
    switch (t) {
        case BB_SIGNAL_GATE: return "gate";
        case BB_SIGNAL_TRIGGER: return "trigger";
        case BB_SIGNAL_PITCH: return "pitch";
        case BB_SIGNAL_AUDIO: return "audio";
        case BB_SIGNAL_CONTROL: break;
    }
    return "control";
}

const char* mimeFor(const juce::String& path) {
    if (path.endsWith(".html")) return "text/html";
    if (path.endsWith(".css")) return "text/css";
    if (path.endsWith(".js")) return "text/javascript";
    if (path.endsWith(".svg")) return "image/svg+xml";
    if (path.endsWith(".png")) return "image/png";
    return "application/octet-stream";
}

#if defined(BLEEP_UI_DEV_MODULE_DIR)
constexpr bool kUiFromDisk = true;
#else
constexpr bool kUiFromDisk = false;
#endif

/// Serves the UI files. UI dev builds read them from the source tree on every
/// request (module ui/ first, then common/ui/), so an edited page shows up
/// when the plugin window is reopened or reloaded with Cmd-R; everything else
/// comes from the embedded copy (BinaryData target <Module>Web).
std::optional<juce::WebBrowserComponent::Resource> embeddedResource(const juce::String& url) {
    auto path = url.upToFirstOccurrenceOf("?", false, false).trimCharactersAtStart("/");
    if (path.isEmpty()) path = "index.html";
#if defined(BLEEP_UI_DEV_MODULE_DIR)
    if (!path.contains("..")) {
        for (const char* dir : {BLEEP_UI_DEV_MODULE_DIR, BLEEP_UI_DEV_COMMON_DIR}) {
            const auto file = juce::File(dir).getChildFile(path);
            juce::MemoryBlock data;
            if (file.existsAsFile() && file.loadFileAsData(data)) {
                std::vector<std::byte> bytes(data.getSize());
                std::memcpy(bytes.data(), data.getData(), data.getSize());
                return juce::WebBrowserComponent::Resource{std::move(bytes), mimeFor(path)};
            }
        }
    }
#endif
    for (int i = 0; i < ModuleWeb::namedResourceListSize; ++i) {
        if (path != ModuleWeb::originalFilenames[i]) continue;
        int size = 0;
        const char* data = ModuleWeb::getNamedResource(ModuleWeb::namedResourceList[i], size);
        if (data == nullptr) break;
        std::vector<std::byte> bytes((size_t)size);
        std::memcpy(bytes.data(), data, (size_t)size);
        return juce::WebBrowserComponent::Resource{std::move(bytes), mimeFor(path)};
    }
    return std::nullopt;
}

using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;

}  // namespace

/// WebBrowserComponent that navigates only once it is on screen: some hosts
/// show a blank page when the WebView loads while still detached.
class ModuleEditor::WebView : public juce::WebBrowserComponent {
public:
    using juce::WebBrowserComponent::WebBrowserComponent;

    void visibilityChanged() override {
        juce::WebBrowserComponent::visibilityChanged();
        navigateOnce();
    }
    void parentHierarchyChanged() override {
        juce::WebBrowserComponent::parentHierarchyChanged();
        navigateOnce();
    }
    void navigateOnce() {
        if (navigated_ || !isShowing()) return;
        navigated_ = true;
        goToURL(getResourceProviderRoot());
    }
    bool pageAboutToLoad(const juce::String& url) override {
        return url.isEmpty() || url.startsWith("about:") || url.startsWith(getResourceProviderRoot());
    }

private:
    bool navigated_ = false;
};

ModuleEditor::ModuleEditor(ModuleProcessor& p) : juce::AudioProcessorEditor(p), processor_(p) {
    auto& proc = processor_;
    auto options =
        juce::WebBrowserComponent::Options{}
            .withNativeIntegrationEnabled()
            .withKeepPageLoadedWhenBrowserIsHidden()
            .withResourceProvider([](const juce::String& url) { return embeddedResource(url); })
            .withNativeFunction("describe",
                                [this](const juce::Array<juce::var>&, Completion done) { done(describe()); })
            .withNativeFunction("sources",
                                [this](const juce::Array<juce::var>&, Completion done) { done(sources()); })
            .withNativeFunction("connections", [this](const juce::Array<juce::var>&,
                                                      Completion done) { done(connections()); })
            .withNativeFunction("setParam",
                                [this](const juce::Array<juce::var>& a, Completion done) {
                                    if (auto* prm = parameter(a[0].toString()))
                                        prm->setValueNotifyingHost(juce::jlimit(0.0f, 1.0f, (float)a[1]));
                                    done({});
                                })
            .withNativeFunction("beginGesture",
                                [this](const juce::Array<juce::var>& a, Completion done) {
                                    if (auto* prm = parameter(a[0].toString())) prm->beginChangeGesture();
                                    done({});
                                })
            .withNativeFunction("endGesture",
                                [this](const juce::Array<juce::var>& a, Completion done) {
                                    if (auto* prm = parameter(a[0].toString())) prm->endChangeGesture();
                                    done({});
                                })
            .withNativeFunction("setName",
                                [&proc](const juce::Array<juce::var>& a, Completion done) {
                                    proc.setInstanceName(a[0].toString());
                                    done(proc.instanceName());
                                })
            .withNativeFunction("connect",
                                [&proc](const juce::Array<juce::var>& a, Completion done) {
                                    // One source per input from the UI; more via the patchbay later.
                                    bb_error e = BB_ERR_NOT_FOUND;
                                    if (auto* bus = proc.bus()) {
                                        const auto input = a[0].toString();
                                        bus->disconnectAll(proc.uid(), input.toRawUTF8());
                                        e = bus->connect(proc.uid(), input.toRawUTF8(), hexUid(a[1]),
                                                         a[2].toString().toRawUTF8(), (float)a[3]);
                                    }
                                    done(juce::String(bb_error_string(e)));
                                })
            .withNativeFunction("setAmount",
                                [&proc](const juce::Array<juce::var>& a, Completion done) {
                                    if (auto* bus = proc.bus())
                                        bus->connect(proc.uid(), a[0].toString().toRawUTF8(), hexUid(a[1]),
                                                     a[2].toString().toRawUTF8(), (float)a[3]);
                                    done({});
                                })
            .withNativeFunction("disconnect", [&proc](const juce::Array<juce::var>& a, Completion done) {
                if (auto* bus = proc.bus()) bus->disconnectAll(proc.uid(), a[0].toString().toRawUTF8());
                done({});
            });
#if JUCE_WINDOWS
    options = options.withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
                  .withWinWebView2Options(juce::WebBrowserComponent::Options::WinWebView2{}.withUserDataFolder(
                      juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("BleepPatchWebView")));
#endif

    web_ = std::make_unique<WebView>(options);
    addAndMakeVisible(*web_);
    setResizable(true, true);
    setResizeLimits(360, 300, 1600, 1400);
    setSize(560, 520);
    startTimerHz(30);
}

ModuleEditor::~ModuleEditor() { stopTimer(); }

void ModuleEditor::paint(juce::Graphics& g) { g.fillAll(juce::Colour(0xff15171c)); }

void ModuleEditor::resized() { web_->setBounds(getLocalBounds()); }

juce::RangedAudioParameter* ModuleEditor::parameter(const juce::String& id) const {
    return processor_.parameters().getParameter(id);
}

juce::var ModuleEditor::describe() const {
    auto* root = new juce::DynamicObject();
    const auto& d = processor_.description();
    root->setProperty("product", d.product);
    root->setProperty("vendor", d.vendor);
    root->setProperty("colour", "#" + d.colour.toDisplayString(false));
    root->setProperty("name", processor_.instanceName());
    root->setProperty("uid", uidHex(processor_.uid()));
    root->setProperty("status", processor_.busStatus() + (kUiFromDisk ? " · UI from source (dev)" : ""));

    juce::Array<juce::var> params;
    for (auto* base : processor_.getParameters()) {
        auto* p = dynamic_cast<juce::RangedAudioParameter*>(base);
        if (p == nullptr) continue;
        auto* o = new juce::DynamicObject();
        o->setProperty("id", p->getParameterID());
        o->setProperty("name", p->getName(32));
        o->setProperty("default", p->getDefaultValue());
        o->setProperty("steps", p->getNumSteps());
        juce::String kind = "float";
        if (auto* c = dynamic_cast<juce::AudioParameterChoice*>(p)) {
            kind = "choice";
            juce::Array<juce::var> choices;
            for (auto& s : c->choices) choices.add(s);
            o->setProperty("choices", choices);
        } else if (dynamic_cast<juce::AudioParameterBool*>(p) != nullptr) {
            kind = "bool";
        } else if (dynamic_cast<juce::AudioParameterInt*>(p) != nullptr) {
            kind = "int";
        }
        o->setProperty("kind", kind);
        // A modulated parameter's bus input carries the parameter's name.
        o->setProperty("input", processor_.isModulated(p->getParameterID()) ? juce::var(p->getName(31)) : juce::var());
        params.add(juce::var(o));
    }
    root->setProperty("params", params);

    juce::Array<juce::var> inputs, outputs;
    for (auto& in : processor_.signalInputs()) {
        auto* o = new juce::DynamicObject();
        o->setProperty("name", in->name);
        o->setProperty("type", typeName(in->type));
        inputs.add(juce::var(o));
    }
    for (auto& out : processor_.outputs()) {
        auto* o = new juce::DynamicObject();
        o->setProperty("name", out->name);
        o->setProperty("type", typeName(out->type));
        o->setProperty("bipolar", out->polarity == BB_POLARITY_BIPOLAR);
        outputs.add(juce::var(o));
    }
    root->setProperty("inputs", inputs);
    root->setProperty("outputs", outputs);
    return juce::var(root);
}

juce::var ModuleEditor::sources() const {
    juce::Array<juce::var> list;
    if (auto* bus = processor_.bus()) {
        const uint64_t self = processor_.uid();
        for (const auto& o : bus->outputs()) {
            auto* s = new juce::DynamicObject();
            const juce::String track = juce::String::fromUTF8(o.track_name);
            const juce::String owner = juce::String::fromUTF8(o.endpoint_name);
            s->setProperty("uid", uidHex(o.endpoint_uid));
            s->setProperty("output", juce::String::fromUTF8(o.name));
            s->setProperty("owner", owner);
            s->setProperty("track", track);
            s->setProperty("type", typeName(o.type));
            s->setProperty("self", o.endpoint_uid == self);
            list.add(juce::var(s));
        }
    }
    return list;
}

juce::var ModuleEditor::connections() const {
    auto* byInput = new juce::DynamicObject();
    auto* bus = processor_.bus();
    if (bus == nullptr) return juce::var(byInput);
    for (const auto& in : bus->inputs(processor_.uid())) {
        juce::Array<juce::var> cables;
        for (const auto& c : bus->connections(processor_.uid(), in.name)) {
            auto* o = new juce::DynamicObject();
            o->setProperty("uid", uidHex(c.source_uid));
            o->setProperty("output", juce::String::fromUTF8(c.output_name));
            o->setProperty("amount", c.amount);
            o->setProperty("present", c.source_present != 0);
            cables.add(juce::var(o));
        }
        byInput->setProperty(juce::String::fromUTF8(in.name), cables);
    }
    return juce::var(byInput);
}

void ModuleEditor::timerCallback() {
    // Live values, every frame.
    auto* state = new juce::DynamicObject();
    auto* params = new juce::DynamicObject();
    for (auto* base : processor_.getParameters()) {
        auto* p = dynamic_cast<juce::RangedAudioParameter*>(base);
        if (p == nullptr) continue;
        auto* o = new juce::DynamicObject();
        const float v = p->getValue();
        o->setProperty("v", v);
        o->setProperty("text", p->getText(v, 16) + (p->getLabel().isNotEmpty() ? " " + p->getLabel() : ""));
        params->setProperty(p->getParameterID(), juce::var(o));
    }
    auto* mods = new juce::DynamicObject();
    for (auto& m : processor_.modulations()) {
        auto* o = new juce::DynamicObject();
        o->setProperty("v", m->display.load());
        o->setProperty("active", m->active.load());
        mods->setProperty(m->param->getParameterID(), juce::var(o));
    }
    auto* outs = new juce::DynamicObject();
    for (auto& out : processor_.outputs()) outs->setProperty(out->name, out->display.load());
    auto* ins = new juce::DynamicObject();
    for (auto& in : processor_.signalInputs()) ins->setProperty(in->name, in->patched.load());
    state->setProperty("params", juce::var(params));
    state->setProperty("mods", juce::var(mods));
    state->setProperty("outputs", juce::var(outs));
    state->setProperty("inputs", juce::var(ins));
    web_->emitEventIfBrowserIsVisible("state", juce::var(state));

    // Cables and source lists, when the bus changed (checked ~4x per second).
    if (++frame_ % 8 != 0) return;
    auto* bus = processor_.bus();
    if (bus == nullptr) return;
    const uint32_t reg = bus->registryGeneration(), con = bus->connectionGeneration();
    if (reg == seenRegistry_ && con == seenConnections_) return;
    auto* patch = new juce::DynamicObject();
    patch->setProperty("connections", connections());
    if (reg != seenRegistry_) patch->setProperty("sources", sources());
    patch->setProperty("name", processor_.instanceName());
    patch->setProperty("status", processor_.busStatus());
    seenRegistry_ = reg;
    seenConnections_ = con;
    web_->emitEventIfBrowserIsVisible("patch", juce::var(patch));
}

}  // namespace bleep::patch
