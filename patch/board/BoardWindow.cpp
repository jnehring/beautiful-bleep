// SPDX-License-Identifier: MIT
//
// The board window (spec §9): one top-level window per process, owned by
// the engine, showing board/ui/index.html in a WebView.
//
// Bridge (JUCE native functions / events):
//   JS → C++   init() commit(board, label) undo() redo() beginGesture()
//              setParam(node, param, v) setAmount(cable, v) setData(node, data) watch([nodeIds])
//              perform(node, action, [args])   (Button presses, Keyboard keys: not saved)
//              presets(kind?) savePreset(name, preset, kind?) deletePreset(name, kind?)
//              (kind: "cell", the default, "drums" for Drum Grid patterns, or "patches" for whole boards)
//              loadPatch(board, tempo, name)   the preset browser: replace the project with a patch
//              copyText(text) pasteText()   the system clipboard (board copy & paste)
//   C++ → JS   "board"  {board, ports, canUndo, canRedo}   board changed elsewhere
//              "state"  {nodes: {id: {outputs, activity, params?}}, ports}   30 times per second
//              "focus"  {node}   a plugin window asked for its node
//              "openPresets"     show the preset browser
#include "BoardWindow.h"
#include "Engine.h"
#if defined(BLEEP_WASM_MODULES)
#include "wasm/ModuleStore.h"
#endif

#include "BoardWeb.h"

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_gui_extra/juce_gui_extra.h>

namespace bleep::engine {

namespace {

const char* mimeFor(const juce::String& path) {
    if (path.endsWith(".html")) return "text/html";
    if (path.endsWith(".css")) return "text/css";
    if (path.endsWith(".js")) return "text/javascript";
    if (path.endsWith(".json")) return "application/json";
    if (path.endsWith(".md")) return "text/markdown; charset=utf-8";
    if (path.endsWith(".svg")) return "image/svg+xml";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
    if (path.endsWith(".gif")) return "image/gif";
    if (path.endsWith(".webp")) return "image/webp";
    return "application/octet-stream";
}

std::optional<juce::WebBrowserComponent::Resource> resource(const juce::String& url) {
    auto path = url.upToFirstOccurrenceOf("?", false, false).trimCharactersAtStart("/");
    if (path.isEmpty()) path = "index.html";
    if (path.contains("..") || path.contains("/")) return std::nullopt;
    auto bytesOf = [&](const void* data, size_t size) {
        std::vector<std::byte> bytes(size);
        std::memcpy(bytes.data(), data, size);
        return juce::WebBrowserComponent::Resource{std::move(bytes), mimeFor(path)};
    };
#if defined(BLEEP_UI_DEV_ROOT)
    // UI dev builds: read the source tree on every request (reload with Cmd-R).
    const juce::File root(BLEEP_UI_DEV_ROOT);
    if (path == "module-views.json") {  // the module view scripts in the tree right now
        juce::StringArray names;
        for (const auto& d : root.getChildFile("modules").findChildFiles(juce::File::findDirectories, false))
            for (const auto& f : d.getChildFile("ui").findChildFiles(juce::File::findFiles, false, "*.js"))
                names.add("\"" + f.getFileName() + "\"");
        const auto json = ("[" + names.joinIntoString(", ") + "]\n").toStdString();
        return bytesOf(json.data(), json.size());
    }
    juce::Array<juce::File> dirs{root.getChildFile("board/ui"), root.getChildFile("common/ui")};
    for (const auto& d : root.getChildFile("modules").findChildFiles(juce::File::findDirectories, false)) {
        dirs.add(d.getChildFile("ui"));
        dirs.add(d.getChildFile("doc"));
    }
    for (const auto& d : dirs) {
        juce::MemoryBlock data;
        if (d.getChildFile(path).loadFileAsData(data)) return bytesOf(data.getData(), data.getSize());
    }
#endif
#if defined(BLEEP_WASM_MODULES)
    if (path == "module-views.json") {  // the views built into the window, and those of the installed modules
        juce::String embedded = "[]";
        for (int i = 0; i < BoardWeb::namedResourceListSize; ++i)
            if (path == BoardWeb::originalFilenames[i]) {
                int size = 0;
                if (const char* data = BoardWeb::getNamedResource(BoardWeb::namedResourceList[i], size)) embedded = juce::String::fromUTF8(data, size);
            }
        const juce::var a = juce::JSON::parse(embedded), b = juce::JSON::parse(juce::String(bleep::engine::ModuleStore::instance().moduleViewsJson()));
        juce::Array<juce::var> all;
        if (auto* x = a.getArray()) all.addArray(*x);
        if (auto* y = b.getArray()) all.addArray(*y);
        const auto json = juce::JSON::toString(juce::var(all)).toStdString();
        return bytesOf(json.data(), json.size());
    }
    {
        bool embedded = false;
        for (int i = 0; i < BoardWeb::namedResourceListSize; ++i) embedded = embedded || path == BoardWeb::originalFilenames[i];
        std::vector<uint8_t> bytes;
        if (!embedded && bleep::engine::ModuleStore::instance().viewFile(path.toStdString(), bytes)) return bytesOf(bytes.data(), bytes.size());
    }
#endif
    for (int i = 0; i < BoardWeb::namedResourceListSize; ++i) {
        if (path != BoardWeb::originalFilenames[i]) continue;
        int size = 0;
        const char* data = BoardWeb::getNamedResource(BoardWeb::namedResourceList[i], size);
        if (data != nullptr) return bytesOf(data, (size_t)size);
    }
    return std::nullopt;
}

using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;

#if defined(BLEEP_WASM_MODULES)
/// The folder the system's VST3 plugins are installed into by this user.
juce::File userVst3Folder() {
#if JUCE_MAC
    return juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile("Library/Audio/Plug-Ins/VST3");
#elif JUCE_WINDOWS
    return juce::File::getSpecialLocation(juce::File::globalApplicationsDirectory).getParentDirectory().getChildFile("Program Files/Common Files/VST3");
#else
    return juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile(".vst3");
#endif
}

bool abletonLiveRunning() {
    juce::ChildProcess p;
#if JUCE_WINDOWS
    if (!p.start("tasklist /FI \"IMAGENAME eq Ableton Live*\"")) return false;
    return p.readAllProcessOutput().containsIgnoreCase("Ableton Live");
#else
    if (!p.start("pgrep -f \"Ableton Live\"")) return false;
    return p.readAllProcessOutput().trim().isNotEmpty();
#endif
}

/// The default plugin bundle (doc/specs/store.md 5a): the VST3 plugins that came with the app, copied into the user's VST3 folder.
/// Live must be closed: replacing a plugin that Live has loaded can crash it.
juce::var installPluginBundle() {
    auto* r = new juce::DynamicObject();
    juce::var result(r);
    r->setProperty("ok", false);
#if JUCE_MAC
    const auto source = juce::File::getSpecialLocation(juce::File::currentApplicationFile).getChildFile("Contents/Resources/Plugins");
#else
    const auto source = juce::File::getSpecialLocation(juce::File::currentApplicationFile).getParentDirectory().getChildFile("Plugins");
#endif
    const auto bundles = source.findChildFiles(juce::File::findFilesAndDirectories, false, "*.vst3");
    if (bundles.isEmpty()) {
        r->setProperty("message", "This copy of Bleep Patch carries no plugins. Download the full installer from the website.");
        return result;
    }
    if (abletonLiveRunning()) {
        r->setProperty("message", "Ableton Live is running. Close it first: replacing a plugin that Live has loaded can crash it.");
        return result;
    }
    const auto target = userVst3Folder();
    target.createDirectory();
    int n = 0;
    for (const auto& b : bundles) {
        const auto dest = target.getChildFile(b.getFileName());
        if (dest.exists() && !dest.deleteRecursively()) {
            r->setProperty("message", "Cannot replace " + dest.getFullPathName());
            return result;
        }
        if (!b.copyDirectoryTo(dest)) {
            r->setProperty("message", "Cannot copy " + b.getFileName() + " into " + target.getFullPathName());
            return result;
        }
        ++n;
    }
    r->setProperty("ok", true);
    r->setProperty("installed", n);
    r->setProperty("message", juce::String(n) + " plugins installed into " + target.getFullPathName() + ". Rescan plugins in your DAW.");
    return result;
}

/// The Bleep plugins in the system's VST3 folders (the Store section lists them; installing them is the app's job).
juce::var installedPlugins() {
    juce::Array<juce::File> folders;
#if JUCE_MAC
    folders.add(juce::File("/Library/Audio/Plug-Ins/VST3"));
    folders.add(juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile("Library/Audio/Plug-Ins/VST3"));
#elif JUCE_WINDOWS
    folders.add(juce::File::getSpecialLocation(juce::File::commonApplicationDataDirectory).getParentDirectory().getChildFile("Program Files/Common Files/VST3"));
#else
    folders.add(juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile(".vst3"));
    folders.add(juce::File("/usr/lib/vst3"));
#endif
    juce::Array<juce::var> list;
    for (const char* name : {"Bleep Patch", "Bleep MIDI In", "Bleep MIDI Out", "Bleep Audio In", "Bleep Audio Out", "Bleep Instrument", "Bleep Audio Insert"}) {
        auto* o = new juce::DynamicObject();
        o->setProperty("name", name);
        o->setProperty("installed", false);
        for (const auto& f : folders) {
            const auto bundle = f.getChildFile(juce::String(name) + ".vst3");
            if (bundle.exists()) { o->setProperty("installed", true); o->setProperty("path", bundle.getFullPathName()); break; }
        }
        list.add(juce::var(o));
    }
    return list;
}
#endif

// Presets: one JSON file per preset, shared by all sets. Cell presets (spec
// §8.1), Drum Grid patterns (doc/specs/modules/drum-grid.md §4.6) and whole
// patches (the preset browser, spec §11.5), by kind.
struct PresetKind {
    const char* folder;
    const char* extension;
};

PresetKind presetKind(const juce::var& kind) {
    if (kind.toString() == "drums") return {"Drum Patterns", ".bleepdrums"};
    if (kind.toString() == "patches") return {"Patches", ".bleeppatch"};
    return {"Cells", ".bleepcell"};
}

juce::File presetFolder(const PresetKind& k) {
    return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
        .getChildFile("Bleep Patch").getChildFile(k.folder);
}

juce::File presetFile(const juce::String& name, const PresetKind& k) {
    const auto safe = juce::File::createLegalFileName(name.trim()).substring(0, 80);
    return safe.isEmpty() ? juce::File() : presetFolder(k).getChildFile(safe + k.extension);
}

juce::var presetList(const PresetKind& k) {
    juce::Array<juce::var> list;
    auto files = presetFolder(k).findChildFiles(juce::File::findFiles, false, juce::String("*") + k.extension);
    files.sort();
    for (const auto& f : files) {
        const auto v = juce::JSON::parse(f.loadFileAsString());
        if (v["name"].isString() && v["preset"].isObject()) list.add(v);
    }
    return list;
}

/// WebBrowserComponent that navigates only once it is on screen.
class WebView : public juce::WebBrowserComponent {
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
    bool pageAboutToLoad(const juce::String& url) override {
        return url.isEmpty() || url.startsWith("about:") || url.startsWith(getResourceProviderRoot());
    }

private:
    void navigateOnce() {
        if (navigated_ || !isShowing()) return;
        navigated_ = true;
        goToURL(getResourceProviderRoot());
    }
    bool navigated_ = false;
};

BoardWindowStyle& style();

class BoardView : public juce::Component, private juce::Timer {
public:
    explicit BoardView(Engine& engine) : engine_(engine) {
        auto options =
            juce::WebBrowserComponent::Options{}
                .withNativeIntegrationEnabled()
                .withKeepPageLoadedWhenBrowserIsHidden()
                .withResourceProvider([](const juce::String& url) { return resource(url); })
                .withNativeFunction("init", [this](const juce::Array<juce::var>&, Completion done) {
                    pageReady_ = true;
                    auto r = boardMessage();
                    r.getDynamicObject()->setProperty("types", board::describeTypes());
                    r.getDynamicObject()->setProperty("status", engine_.statusLine());
                    r.getDynamicObject()->setProperty("standalone", engine_.standalone());
#if defined(BLEEP_WASM_MODULES)
                    r.getDynamicObject()->setProperty("store", true);  // the Store section is offered
#endif
#if defined(BLEEP_UI_DEV_ROOT)
                    r.getDynamicObject()->setProperty("dev", true);
#endif
                    done(r);
                    if (focus_.isNotEmpty()) sendFocus();
                })
                .withNativeFunction("commit", [this](const juce::Array<juce::var>& a, Completion done) {
                    engine_.commit(a[0], a[1].toString());
                    done(boardMessage());
                })
                .withNativeFunction("loadPatch", [this](const juce::Array<juce::var>& a, Completion done) {
                    if (style().onLoadPatch) style().onLoadPatch(a[0], (double)a[1], a[2].toString());
                    else engine_.commit(a[0], "Load " + a[2].toString());
                    done(boardMessage());
                })
                .withNativeFunction("undo", [this](const juce::Array<juce::var>&, Completion done) {
                    engine_.undo();
                    done(boardMessage());
                })
                .withNativeFunction("redo", [this](const juce::Array<juce::var>&, Completion done) {
                    engine_.redo();
                    done(boardMessage());
                })
                .withNativeFunction("beginGesture", [this](const juce::Array<juce::var>&, Completion done) {
                    engine_.beginGesture();
                    done(boardMessage());
                })
                .withNativeFunction("setParam", [this](const juce::Array<juce::var>& a, Completion done) {
                    engine_.setParam(a[0].toString(), a[1].toString(), (float)a[2]);
                    done({});
                })
                .withNativeFunction("setAmount", [this](const juce::Array<juce::var>& a, Completion done) {
                    engine_.setAmount(a[0].toString(), (float)a[1]);
                    done({});
                })
                .withNativeFunction("setData", [this](const juce::Array<juce::var>& a, Completion done) {
                    engine_.setData(a[0].toString(), a[1]);
                    done({});
                })
                .withNativeFunction("command", [this](const juce::Array<juce::var>& a, Completion done) {
                    engine_.command(a[0].toString(), a[1].toString(), (float)a[2]);
                    done({});
                })
                .withNativeFunction("importMedia", [this](const juce::Array<juce::var>& a, Completion done) {
                    // a[0]: file name, a[1]: the file's bytes as base64 (the page reads dropped files).
                    juce::MemoryOutputStream decoded;
                    if (!juce::Base64::convertFromBase64(decoded, a[1].toString())) {
                        auto* o = new juce::DynamicObject();
                        o->setProperty("error", "could not read the file");
                        done(juce::var(o));
                        return;
                    }
                    done(engine_.importMedia(a[0].toString(), decoded.getMemoryBlock()));
                })
                .withNativeFunction("exportMedia", [this](const juce::Array<juce::var>& a, Completion done) {
                    done(engine_.exportMedia(a[0].toString(), a[1].toString()));
                })
                .withNativeFunction("perform", [this](const juce::Array<juce::var>& a, Completion done) {
                    engine_.perform(a[0].toString(), a[1].toString(), a[2]);
                    done({});
                })
                .withNativeFunction("midiDevices", [](const juce::Array<juce::var>&, Completion done) {
                    // Connected controllers for the MIDI Device module (standalone, spec §12).
                    juce::Array<juce::var> names;
                    for (const auto& d : juce::MidiInput::getAvailableDevices())
                        if (!d.name.startsWith("Bleep Patch ")) names.add(d.name);
                    done(names);
                })
                .withNativeFunction("presets", [](const juce::Array<juce::var>& a, Completion done) {
                    done(presetList(presetKind(a[0])));
                })
                .withNativeFunction("savePreset", [](const juce::Array<juce::var>& a, Completion done) {
                    const auto kind = presetKind(a[2]);
                    const auto file = presetFile(a[0].toString(), kind);
                    auto* o = new juce::DynamicObject();
                    o->setProperty("name", a[0].toString());
                    o->setProperty("preset", a[1]);
                    if (file != juce::File()) {
                        file.getParentDirectory().createDirectory();
                        file.replaceWithText(juce::JSON::toString(juce::var(o)));
                    }
                    done(presetList(kind));
                })
                .withNativeFunction("deletePreset", [](const juce::Array<juce::var>& a, Completion done) {
                    const auto kind = presetKind(a[1]);
                    presetFile(a[0].toString(), kind).deleteFile();
                    done(presetList(kind));
                })
                .withNativeFunction("copyText", [](const juce::Array<juce::var>& a, Completion done) {
                    juce::SystemClipboard::copyTextToClipboard(a[0].toString());
                    done({});
                })
                .withNativeFunction("pasteText", [](const juce::Array<juce::var>&, Completion done) {
                    done(juce::SystemClipboard::getTextFromClipboard());
                })
                .withNativeFunction("watch", [this](const juce::Array<juce::var>& a, Completion done) {
                    watched_.clear();
                    if (auto* ids = a[0].getArray())
                        for (const auto& id : *ids) watched_.insert(id.toString());
                    done({});
                });
#if defined(BLEEP_WASM_MODULES)
        using bleep::engine::ModuleStore;
        options = options
            .withNativeFunction("types", [](const juce::Array<juce::var>&, Completion done) { done(board::describeTypes()); })
            .withNativeFunction("storeStatus", [](const juce::Array<juce::var>&, Completion done) { done(ModuleStore::instance().status()); })
            .withNativeFunction("storeRefresh", [](const juce::Array<juce::var>&, Completion done) {
                ModuleStore::instance().refreshIndexAsync();
                done({});
            })
            .withNativeFunction("storeInstall", [](const juce::Array<juce::var>& a, Completion done) {
                ModuleStore::instance().installAsync(a[0].toString().toStdString());
                done({});
            })
            .withNativeFunction("storeInstallAll", [](const juce::Array<juce::var>&, Completion done) {
                ModuleStore::instance().installAllAsync();
                done({});
            })
            .withNativeFunction("storeRemove", [](const juce::Array<juce::var>& a, Completion done) {
                ModuleStore::instance().removeAsync(a[0].toString().toStdString());
                done({});
            })
            .withNativeFunction("storeSettings", [](const juce::Array<juce::var>& a, Completion done) {
                auto s = ModuleStore::instance().settings();
                if (a[0]["firstRunDone"].isBool()) s.firstRunDone = (bool)a[0]["firstRunDone"];
                const juce::var allow = a[0]["allowUnsigned"];
                if (allow.isObject()) {
                    s.allowUnsigned.module = (bool)allow["module"];
                    s.allowUnsigned.plugin = (bool)allow["plugin"];
                }
                ModuleStore::instance().setSettings(s);
                done({});
            })
            .withNativeFunction("storePlugins", [](const juce::Array<juce::var>&, Completion done) { done(installedPlugins()); })
            .withNativeFunction("storeInstallPlugins", [](const juce::Array<juce::var>&, Completion done) { done(installPluginBundle()); });
#endif
#if JUCE_WINDOWS
        options = options.withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
                      .withWinWebView2Options(juce::WebBrowserComponent::Options::WinWebView2{}.withUserDataFolder(
                          juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("BleepPatchWebView")));
#endif
        web_ = std::make_unique<WebView>(options);
        addAndMakeVisible(*web_);
        startTimerHz(30);
#if defined(BLEEP_BOARD_SMOKE_TEST)
        smokeTest();
#endif
    }

#if defined(BLEEP_BOARD_SMOKE_TEST)
    /// tests/board_smoke.cpp: drives the real page through the real bridge.
    void smokeTest() {
        auto later = [this](int ms, juce::String js, std::function<void(const juce::var&)> then) {
            juce::Timer::callAfterDelay(ms, [this, js, then] {
                web_->evaluateJavascript(js, [then](juce::WebBrowserComponent::EvaluationResult r) {
                    then(r.getResult() ? *r.getResult() : juce::var("evaluation failed: " + r.getError()->message));
                });
            });
        };
        // Add a Function node through the bridge's commit, then read the page back.
        later(2500,
              "(function(){ const b = JSON.parse(JSON.stringify(window.__board())); b.nodes.push({id:'smoke', "
              "type:'function', name:'Smoke', x:300, y:300, parent:'', params:{}}); "
              "const p = JSON.parse(JSON.stringify(window.BleepFactoryPresets[0].preset)); "
              "for (const n of p.nodes) b.nodes.push(n); for (const c of p.cables) b.cables.push(c); "
              "native('commit', b, 'smoke').then(m => { window.__smoke = m.board.nodes.length; "
              "window.__voiceCells = m.board.nodes.filter(n => n.type === 'voice-cell').length; "
              "window.__voiceCables = m.board.cables.length; }); "
              "fetch('adsr.md').then(r => r.text()).then(t => window.__doc = t.length); "
              "fetch('no-such-module.md').then(r => window.__noDoc = r.status, () => window.__noDoc = 'rejected'); "
              "return 1; })()",
              [](const juce::var&) {});
        later(4000,
              "JSON.stringify({nodes: document.querySelectorAll('.node').length, "
              "committed: window.__smoke || 0, voiceCells: window.__voiceCells || 0, "
              "cables: window.__voiceCables || 0, errors: window.__errors || [], "
              "doc: window.__doc || 0, noDoc: window.__noDoc || 0, "
              "types: document.querySelectorAll('#browser .b-item').length})",
              [](const juce::var& v) {
                  std::printf("board smoke: %s\n", v.toString().toRawUTF8());
                  std::fflush(stdout);
                  juce::JUCEApplicationBase::quit();
              });
    }
#endif

    ~BoardView() override { stopTimer(); }

    void resized() override { web_->setBounds(getLocalBounds()); }
    void paint(juce::Graphics& g) override { g.fillAll(juce::Colour(0xff15171c)); }

    void boardChanged() {
        if (pageReady_) web_->emitEventIfBrowserIsVisible("board", boardMessage());
    }

    void showPresets() {
        if (pageReady_) web_->emitEventIfBrowserIsVisible("openPresets", juce::var());
    }

    void focus(const juce::String& nodeId) {
        focus_ = nodeId;
        sendFocus();
    }

private:
    juce::var boardMessage() const {
        auto* o = new juce::DynamicObject();
        o->setProperty("board", engine_.hasBoard() ? engine_.board() : juce::var());
        o->setProperty("ports", engine_.ports());
        o->setProperty("canUndo", engine_.canUndo());
        o->setProperty("canRedo", engine_.canRedo());
        o->setProperty("status", engine_.statusLine());
        return juce::var(o);
    }

    void sendFocus() {
        auto* o = new juce::DynamicObject();
        o->setProperty("node", focus_);
        if (pageReady_) web_->emitEventIfBrowserIsVisible("focus", juce::var(o));
    }

    void timerCallback() override {
        if (pageReady_ && isShowing()) web_->emitEventIfBrowserIsVisible("state", engine_.liveState(watched_));
    }

    Engine& engine_;
    std::unique_ptr<WebView> web_;
    std::set<juce::String> watched_;
    juce::String focus_;
    bool pageReady_ = false;  ///< the page called init(): events can be delivered
};

BoardWindowStyle& style() {
    static BoardWindowStyle s;
    return s;
}
juce::DocumentWindow* g_window = nullptr;

class BoardWindow : public juce::DocumentWindow {
public:
    explicit BoardWindow(Engine& engine)
        : juce::DocumentWindow(style().title, juce::Colour(0xff15171c), juce::DocumentWindow::allButtons) {
        setUsingNativeTitleBar(true);
        view_ = new BoardView(engine);
        setContentOwned(view_, false);
        setResizable(true, false);
        setResizeLimits(640, 420, 10000, 10000);
        if (style().bounds.isEmpty()) centreWithSize(1180, 760);
        else setBounds(style().bounds);
        // Plugins: floats above Live's main window, like Live's own plugin windows. (Phase 0: verify.)
        setAlwaysOnTop(style().alwaysOnTop);
#if !JUCE_MAC
        if (style().menu) setMenuBar(style().menu);
#endif
        g_window = this;
    }
    ~BoardWindow() override {
        if (g_window == this) g_window = nullptr;
    }
    void closeButtonPressed() override {
        if (style().onClose) style().onClose();
        else setVisible(false);  // keeps the page and its state
    }
    BoardView& view() { return *view_; }

private:
    BoardView* view_ = nullptr;
};

class BoardWindowUi final : public BoardUi {
public:
    explicit BoardWindowUi(Engine& engine) : engine_(engine) {}

    void show(const juce::String& focusNodeId) override {
        if (!window_) window_ = std::make_unique<BoardWindow>(engine_);
        window_->setVisible(true);
        window_->toFront(true);
        if (focusNodeId.isNotEmpty()) window_->view().focus(focusNodeId);
    }
    bool isShowing() const override { return window_ && window_->isVisible(); }
    void boardChanged() override {
        if (window_) window_->view().boardChanged();
    }

private:
    Engine& engine_;
    std::unique_ptr<BoardWindow> window_;
};

}  // namespace

std::unique_ptr<BoardUi> createBoardUi(Engine& engine) { return std::make_unique<BoardWindowUi>(engine); }

void setBoardWindowStyle(const BoardWindowStyle& s) { style() = s; }

void openPresetBrowser() {
    if (g_window) static_cast<BoardWindow*>(g_window)->view().showPresets();
}

void setBoardWindowTitle(const juce::String& title) {
    style().title = title;
    if (g_window) g_window->setName(title);
}

juce::DocumentWindow* boardWindow() { return g_window; }

}  // namespace bleep::engine
