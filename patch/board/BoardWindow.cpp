// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// The board window (spec §9): one top-level window per process, owned by
// the engine, showing board/ui/index.html in a WebView.
//
// Bridge (JUCE native functions / events):
//   JS → C++   init() commit(board, label) undo() redo() beginGesture()
//              setParam(node, param, v) setAmount(cable, v) setData(node, data) watch([nodeIds])
//              perform(node, action, [args])   (Button presses, Keyboard keys: not saved)
//              presets(kind?) savePreset(name, preset, kind?) deletePreset(name, kind?)
//              (kind: "cell", the default, "drums" for Drum Grid patterns, or "projects" for whole projects: the
//              board with its panels, as {name, preset: {nodes, cables, panels, description, tags, tempo, needs}})
//              loadPatch(board, tempo, name)   the preset browser: replace the project with a patch
//              registerCode(nodeId, code, base64)   a Code node's compiled module (engine/wasm/CodeNodes.h)
//              importMedia(name, base64) readMedia(id) revealMedia(id)   audio files for modules; a preset takes the files it uses along (common/ui/bleep-media.js)
//              copyText(text) pasteText()   the system clipboard (board copy & paste)
//   C++ → JS   "board"  {board, ports, canUndo, canRedo}   board changed elsewhere
//              "state"  {nodes: {id: {outputs, activity, params?}}, ports}   30 times per second
//              "focus"  {node}   a plugin window asked for its node
//              "openPresets"     show the preset browser
#include "BoardWindow.h"
#include "BoardFiles.h"
#include "BoardResources.h"
#include "Engine.h"
#include <cstdlib>
#if defined(BLEEP_WASM_MODULES)
#include "wasm/ModuleLibrary.h"
#include "library/Account.h"
#endif

#include "BoardWeb.h"

#include <atomic>
#include <memory>
#include <random>
#include <string>
#include <thread>

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_gui_extra/juce_gui_extra.h>

namespace bleep::engine {

namespace {

using namespace boardfiles;

using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;

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

#if defined(BLEEP_WASM_MODULES)
/// The library login of this process (the app, or the plugin instance; they share the token in the keychain).
library::Account& libraryAccount() {
    static library::Account account(bleep::engine::ModuleLibrary::instance().dataDir());
    return account;
}

/// The page's `account` calls (board/ui/account.js): what the user may do with their login. Blocks on the network: worker thread only.
juce::var runAccount(const juce::String& op, const juce::var& x, const juce::var& y, const juce::var& z) {
    auto& account = libraryAccount();
    if (op == "status") return account.status((bool)x);
    if (op == "start") return account.startSignIn(x.toString().toStdString());
    if (op == "poll") return account.pollSignIn();
    if (op == "cancel") { account.cancelSignIn(); return account.status(false); }
    if (op == "signOut") return account.signOut();
    if (op == "call") return account.call(x.toString().toStdString(), y.toString().toStdString(), z);
    // The patch assistant's answer is a stream: start it, then pull it piece by piece (agent-chat.js).
    if (op == "streamStart") return account.streamStart(x.toString().toStdString(), y);
    if (op == "streamRead") return account.streamRead(x.toString().toStdString(), juce::jlimit(100, 5000, (int)y));
    if (op == "streamCancel") { account.streamCancel(x.toString().toStdString()); return {}; }
    return {};
}
#endif

class BoardView : public juce::Component, private juce::Timer {
public:
    explicit BoardView(Engine& engine) : engine_(engine) {
        // The page's scripts are not all the app's own: installed modules ship views (modules/<name>/ui/*.js) that run in the same page.
        // So that they cannot call the native functions below, a secret that only the page's first script learns (the user script hands
        // it over once, to the top frame, and board/ui/bleep-bridge.js keeps it in a closure) must come with every call; `gated` drops
        // the others. The raw JUCE message channel is reachable from any script in the page, the secret is what it is not.
        secret_ = makeSecret();
        auto gated = [this](auto fn) {
            return [this, fn = std::move(fn)](const juce::Array<juce::var>& a, Completion done) {
                if (a.isEmpty() || !a.getReference(0).isString() || !secretMatches(a.getReference(0).toString().toStdString())) {
                    done({});
                    return;
                }
                juce::Array<juce::var> rest;
                for (int i = 1; i < a.size(); ++i) rest.add(a.getReference(i));
                fn(rest, std::move(done));
            };
        };
        auto options =
            juce::WebBrowserComponent::Options{}
                .withNativeIntegrationEnabled()
                .withUserScript(bootScript())
                .withKeepPageLoadedWhenBrowserIsHidden()
                .withResourceProvider([](const juce::String& url) { return resource(url); })
                .withNativeFunction("init", gated([this](const juce::Array<juce::var>&, Completion done) {
                    pageReady_ = true;
                    auto r = boardMessage();
                    r.getDynamicObject()->setProperty("types", board::describeTypes());
                    r.getDynamicObject()->setProperty("status", engine_.statusLine());
                    r.getDynamicObject()->setProperty("standalone", engine_.standalone());
                    // The standalone app has the full Settings section; a plugin has the library's two tabs (doc/specs/settings.md §5).
                    bool settings = style().onSettings != nullptr;
#if defined(BLEEP_WASM_MODULES)
                    settings = true;
#endif
                    r.getDynamicObject()->setProperty("settings", settings);
                    r.getDynamicObject()->setProperty("nativeMenu", style().menu != nullptr);  // the File and Help menus are the app's own
                    r.getDynamicObject()->setProperty("version", BLEEP_VERSION);
#if defined(BLEEP_WASM_MODULES)
                    r.getDynamicObject()->setProperty("library", true);  // the Library section is offered
                    r.getDynamicObject()->setProperty("account", true);  // and the login to it (sharing presets)
#endif
#if defined(BLEEP_UI_DEV_ROOT)
                    r.getDynamicObject()->setProperty("dev", true);
#endif
                    done(r);
                    if (focus_.isNotEmpty()) sendFocus();
                }))
                .withNativeFunction("commit", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    engine_.commit(a[0], a[1].toString());
                    done(boardMessage());
                }))
                .withNativeFunction("loadPatch", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    if (style().onLoadPatch) style().onLoadPatch(a[0], (double)a[1], a[2].toString());
                    else engine_.commit(a[0], "Load " + a[2].toString());
                    done(boardMessage());
                }))
                .withNativeFunction("undo", gated([this](const juce::Array<juce::var>&, Completion done) {
                    engine_.undo();
                    done(boardMessage());
                }))
                .withNativeFunction("redo", gated([this](const juce::Array<juce::var>&, Completion done) {
                    engine_.redo();
                    done(boardMessage());
                }))
                .withNativeFunction("beginGesture", gated([this](const juce::Array<juce::var>&, Completion done) {
                    engine_.beginGesture();
                    done(boardMessage());
                }))
                .withNativeFunction("setParam", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    engine_.setParam(a[0].toString(), a[1].toString(), (float)a[2]);
                    done({});
                }))
                .withNativeFunction("setAmount", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    engine_.setAmount(a[0].toString(), (float)a[1]);
                    done({});
                }))
                .withNativeFunction("setData", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    engine_.setData(a[0].toString(), a[1]);
                    done({});
                }))
                .withNativeFunction("command", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    engine_.command(a[0].toString(), a[1].toString(), (float)a[2]);
                    done({});
                }))
                .withNativeFunction("importMedia", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    // a[0]: file name, a[1]: the file's bytes as base64 (the page reads dropped files).
                    juce::MemoryOutputStream decoded;
                    if (!juce::Base64::convertFromBase64(decoded, a[1].toString())) {
                        auto* o = new juce::DynamicObject();
                        o->setProperty("error", "could not read the file");
                        done(juce::var(o));
                        return;
                    }
                    done(engine_.importMedia(a[0].toString(), decoded.getMemoryBlock()));
                }))
                .withNativeFunction("registerCode", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    // a[0]: the Code node's id, a[1]: its `code` ({source, interface, settings}), a[2]: the module compiled from it, as base64.
                    juce::MemoryOutputStream decoded;
                    if (!juce::Base64::convertFromBase64(decoded, a[2].toString())) {
                        auto* o = new juce::DynamicObject();
                        o->setProperty("error", "could not read the module");
                        done(juce::var(o));
                        return;
                    }
                    done(engine_.registerCode(a[0].toString(), a[1], decoded.getMemoryBlock()));
                }))
                .withNativeFunction("readMedia", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    done(engine_.readMedia(a[0].toString()));
                }))
                .withNativeFunction("exportMedia", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    done(engine_.exportMedia(a[0].toString(), a[1].toString()));
                }))
                .withNativeFunction("revealMedia", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    done(engine_.revealMedia(a[0].toString()));
                }))
                .withNativeFunction("perform", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    engine_.perform(a[0].toString(), a[1].toString(), a[2]);
                    done({});
                }))
                .withNativeFunction("midiDevices", gated([](const juce::Array<juce::var>&, Completion done) {
                    // Connected controllers for the MIDI Device module (standalone, spec §12).
                    juce::Array<juce::var> names;
                    for (const auto& d : juce::MidiInput::getAvailableDevices())
                        if (!d.name.startsWith("Bleep App ")) names.add(d.name);
                    done(names);
                }))
                .withNativeFunction("presets", gated([](const juce::Array<juce::var>& a, Completion done) {
                    if (isProjectKind(a[0])) migrateBoardPresets();
                    done(presetList(presetKind(a[0])));
                }))
                .withNativeFunction("savePreset", gated([](const juce::Array<juce::var>& a, Completion done) {
                    const auto kind = presetKind(a[2]);
                    const auto file = presetFile(a[0].toString(), kind);
                    juce::var doc;
                    if (isProjectKind(a[2])) {
                        migrateBoardPresets();
                        doc = flatToProject(a[0].toString(), a[1]);
                    } else {
                        auto* o = new juce::DynamicObject();
                        o->setProperty("name", a[0].toString());
                        o->setProperty("preset", a[1]);
                        doc = juce::var(o);
                    }
                    if (file != juce::File()) {
                        file.getParentDirectory().createDirectory();
                        file.replaceWithText(juce::JSON::toString(doc));
                    }
                    done(presetList(kind));
                }))
                .withNativeFunction("deletePreset", gated([](const juce::Array<juce::var>& a, Completion done) {
                    const auto kind = presetKind(a[1]);
                    presetFile(a[0].toString(), kind).deleteFile();
                    done(presetList(kind));
                }))
                .withNativeFunction("copyText", gated([](const juce::Array<juce::var>& a, Completion done) {
                    juce::SystemClipboard::copyTextToClipboard(a[0].toString());
                    done({});
                }))
                .withNativeFunction("pasteText", gated([](const juce::Array<juce::var>&, Completion done) {
                    done(juce::SystemClipboard::getTextFromClipboard());
                }))
                .withNativeFunction("openUrl", gated([](const juce::Array<juce::var>& a, Completion done) {  // the Help section's tiles
                    const auto address = a[0].toString();
                    done((address.startsWithIgnoreCase("http://") || address.startsWithIgnoreCase("https://"))
                         && juce::URL(address).launchInDefaultBrowser());
                }))
                .withNativeFunction("setMenu", gated([](const juce::Array<juce::var>& a, Completion done) {
                    if (style().onMenu) style().onMenu(a[0]);
                    done({});
                }))
                .withNativeFunction("settings", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    if (style().onSettings) { done(style().onSettings(a[0].toString(), a[1])); return; }
                    // A plugin: Live owns audio, MIDI and sync. The board has the library and what it does with latency.
                    if (a[0].toString() == "latency") engine_.setBoardSetting("zeroHostLatencyInputs", a[1]["zeroHostLatencyInputs"]);
                    auto* o = new juce::DynamicObject();
                    o->setProperty("host", "plugin");
                    o->setProperty("latency", engine_.latencyInfo());
                    done(juce::var(o));
                }))
                .withNativeFunction("watch", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    watched_.clear();
                    if (auto* ids = a[0].getArray())
                        for (const auto& id : *ids) watched_.insert(id.toString());
                    done({});
                }));
#if defined(BLEEP_WASM_MODULES)
        using bleep::engine::ModuleLibrary;
        options = options
            .withNativeFunction("types", gated([](const juce::Array<juce::var>&, Completion done) { done(board::describeTypes()); }))
            .withNativeFunction("libraryStatus", gated([](const juce::Array<juce::var>&, Completion done) { done(ModuleLibrary::instance().status()); }))
            .withNativeFunction("libraryClaimUpdateCheck", gated([](const juce::Array<juce::var>&, Completion done) {
                // The start check runs once per process: every plugin of a Live session shares the environment, each plugin binary has its own statics.
                static const char* const flag = "BLEEP_UPDATE_CHECK_DONE";
                const bool first = std::getenv(flag) == nullptr;
#if JUCE_WINDOWS
                if (first) _putenv_s(flag, "1");
#else
                if (first) setenv(flag, "1", 1);
#endif
                done(first);
            }))
            .withNativeFunction("libraryRefresh", gated([](const juce::Array<juce::var>&, Completion done) {
                ModuleLibrary::instance().refreshIndexAsync();
                done({});
            }))
            .withNativeFunction("libraryInstall", gated([](const juce::Array<juce::var>& a, Completion done) {
                ModuleLibrary::instance().installAsync(a[0].toString().toStdString());
                done({});
            }))
            .withNativeFunction("libraryInstallVersion", gated([](const juce::Array<juce::var>& a, Completion done) {
                ModuleLibrary::instance().installVersionAsync(a[0].toString().toStdString(), a[1].toString().toStdString());   // a board pins this version
                done({});
            }))
            .withNativeFunction("libraryInstallAll", gated([](const juce::Array<juce::var>&, Completion done) {
                ModuleLibrary::instance().installAllAsync();
                done({});
            }))
            .withNativeFunction("libraryUpdateAll", gated([](const juce::Array<juce::var>&, Completion done) {
                ModuleLibrary::instance().updateAllAsync();
                done({});
            }))
            .withNativeFunction("libraryRemove", gated([](const juce::Array<juce::var>& a, Completion done) {
                ModuleLibrary::instance().removeAsync(a[0].toString().toStdString());
                done({});
            }))
            .withNativeFunction("librarySettings", gated([](const juce::Array<juce::var>& a, Completion done) {
                // Module UI scripts run in this page and can call this too. What weakens the library's checks (signatures off, a
                // different library, which also receives the account token) is therefore confirmed in a native dialog the page cannot answer.
                const auto before = ModuleLibrary::instance().settings();
                auto s = before;
                if (a[0]["firstRunDone"].isBool()) s.firstRunDone = (bool)a[0]["firstRunDone"];
                if (a[0]["updateCheck"].isBool()) s.updateCheck = (bool)a[0]["updateCheck"];
                if (a[0]["channel"].isString()) s.channel = a[0]["channel"].toString().toStdString();
                if (a[0]["libraryUrl"].isString() && a[0]["libraryUrl"].toString().isNotEmpty())
                    s.libraryUrl = a[0]["libraryUrl"].toString().toStdString();
                const juce::var allow = a[0]["allowUnsigned"];
                if (allow.isObject()) {
                    s.allowUnsigned.module = (bool)allow["module"];
                    s.allowUnsigned.plugin = (bool)allow["plugin"];
                }
                juce::String risk;
                if (s.allowUnsigned.module && !before.allowUnsigned.module) risk << "Allow unsigned modules: code nobody has vouched for will run.\n";
                if (s.allowUnsigned.plugin && !before.allowUnsigned.plugin) risk << "Allow unsigned plugins: unverified native code can be installed.\n";
                if (s.libraryUrl != before.libraryUrl) risk << "Use another library: " << juce::String(s.libraryUrl) << "\n";
                std::string urlProblem;
                if (!library::libraryUrlAllowed(s.libraryUrl, urlProblem)) {
                    auto* e = new juce::DynamicObject();
                    e->setProperty("error", juce::String(urlProblem));
                    done(juce::var(e));
                    return;
                }
                if (risk.isEmpty()) {
                    std::string error;
                    ModuleLibrary::instance().setSettings(s, error);
                    done({});
                    return;
                }
                juce::AlertWindow::showAsync(
                    juce::MessageBoxOptions()
                        .withIconType(juce::MessageBoxIconType::WarningIcon)
                        .withTitle("Change the library's safety settings?")
                        .withMessage(risk + "\nChoose Allow only if you asked for this.")
                        .withButton("Deny")
                        .withButton("Allow"),
                    [s, done = std::move(done)](int result) mutable {
                        std::string error;
                        if (result == 2) ModuleLibrary::instance().setSettings(s, error);  // buttons count from 1 in the order added; Deny is the default
                        done({});
                    });
            }))
            .withNativeFunction("libraryRevealData", gated([](const juce::Array<juce::var>&, Completion done) {
                ModuleLibrary::instance().dataDir().revealToUser();
                done({});
            }))
            .withNativeFunction("account", gated([this](const juce::Array<juce::var>& a, Completion done) {
                // The network runs on a worker thread; the answer goes back to the page from the message thread.
                const juce::var op = a[0], x = a[1], y = a[2], z = a[3];
                auto alive = alive_;
                std::thread([=, done = std::move(done)]() mutable {
                    const juce::var result = runAccount(op.toString(), x, y, z);
                    juce::MessageManager::callAsync([alive, done = std::move(done), result] { if (alive->load()) done(result); });
                }).detach();
            }))
            .withNativeFunction("libraryPlugins", gated([](const juce::Array<juce::var>&, Completion done) { done(installedPlugins()); }))
            .withNativeFunction("libraryInstallPlugins", gated([](const juce::Array<juce::var>&, Completion done) { done(installPluginBundle()); }));
#endif
#if JUCE_WINDOWS
        options = options.withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
                      .withWinWebView2Options(juce::WebBrowserComponent::Options::WinWebView2{}.withUserDataFolder(
                          juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("BleepWebView")));
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
              "const p = JSON.parse(JSON.stringify(window.__findPreset('Slate Stabs').preset)); "
              "for (const n of p.nodes) b.nodes.push(n); for (const c of p.cables) b.cables.push(c); "
              "native('commit', b, 'smoke').then(m => { window.__smoke = m.board.nodes.length; "
              "window.__voiceCells = m.board.nodes.filter(n => n.type === 'voice-cell').length; "
              "window.__voiceCables = m.board.cables.length; }); "
              "fetch('adsr.md').then(r => r.text()).then(t => window.__doc = t.length); "
              "fetch('no-such-module.md').then(r => window.__noDoc = r.status, () => window.__noDoc = 'rejected'); "
              "return 1; })()",
              [](const juce::var&) {});
        // Place cell presets the way the Add menu does (the library check first), and see what the board keeps.
        later(5000,
              "(function(){ const q = window.__findPreset('Hollow Reed'); window.__t0 = Date.now(); "
              "window.__ens = 'pending'; "
              "native('libraryStatus').then(s => { window.__st = JSON.stringify({keys: Object.keys(s), installed: (s.installed||[]).length, "
              "index: s.index && {ok: s.index.ok, error: s.index.error, modules: (s.index.modules||[]).length}}); }, e => window.__st = 'rejected ' + e); "
              "BleepLibraryView.ensureNeeds(q.preset, q.name).then(v => window.__ens = 'resolved ' + v + ' after ' + (Date.now() - window.__t0) + ' ms', "
              "e => window.__ens = 'rejected ' + (e && e.message || e)); "
              "return JSON.stringify(['Slate Stabs', 'Hollow Reed', 'Quintal Stack'].map(window.__addPreset)); })()",
              [](const juce::var& v) { std::printf("board smoke: add presets: %s\n", v.toString().toRawUTF8()); });
        later(11000,
              "JSON.stringify({cells: window.__board().nodes.filter(n => n.type === 'cell' || n.type === 'voice-cell').map(n => n.name), "
              "ensure: window.__ens, status: window.__st, errors: window.__errors || [], notice: (document.querySelector('.board-notice') || {}).textContent || null, "
              "modal: !!document.querySelector('.st-modal')})",
              [](const juce::var& v) { std::printf("board smoke: after adding presets: %s\n", v.toString().toRawUTF8()); });
        later(12000,
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

    ~BoardView() override { alive_->store(false); stopTimer(); }

    /// Random 256 bits as hex, from the operating system's generator.
    static std::string makeSecret() {
        std::random_device rd;
        std::string out;
        static const char* hex = "0123456789abcdef";
        for (int i = 0; i < 32; ++i) {
            const auto b = (unsigned char)(rd() & 0xff);
            out += hex[b >> 4];
            out += hex[b & 15];
        }
        return out;
    }
    bool secretMatches(const std::string& given) const {
        unsigned diff = given.size() == secret_.size() ? 0u : 1u;  // no early exit on the first difference
        for (size_t i = 0; i < secret_.size() && i < given.size(); ++i) diff |= (unsigned)(secret_[i] ^ given[i]);
        return diff == 0;
    }
    /// Runs before the page's own scripts, in the top frame only (a frame a script adds must learn nothing): a getter that gives the secret
    /// out once. A reloaded page gets a new getter. In the board smoke test it also asks for an unsealed page.
    juce::String bootScript() const {
        juce::String js = "(function(){if(window.top!==window)return;var s=\"" + juce::String(secret_) +
                          "\";Object.defineProperty(window,\"__bleepBoot\",{configurable:true,value:function(){var r=s;s=null;return r;}});})();";
#if defined(BLEEP_BOARD_SMOKE_TEST)
        js += "window.__BLEEP_NO_SEAL__=true;";
#endif
        return js;
    }

    void resized() override { web_->setBounds(getLocalBounds()); }
    void paint(juce::Graphics& g) override { g.fillAll(juce::Colour(0xff15171c)); }

    void boardChanged() {
        if (pageReady_) web_->emitEventIfBrowserIsVisible("board", boardMessage());
    }

    void showPresets() {
        if (pageReady_) web_->emitEventIfBrowserIsVisible("openPresets", juce::var());
    }

    void showSettings() {
        if (pageReady_) web_->emitEventIfBrowserIsVisible("openSettings", juce::var());
    }

    void showMenu(const juce::String& what) {
        if (pageReady_) web_->emitEventIfBrowserIsVisible("menu", what);
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
    std::string secret_;  // what every native call from the page has to carry (see the constructor)
    std::shared_ptr<std::atomic<bool>> alive_ = std::make_shared<std::atomic<bool>>(true);   // for answers that arrive after the view is gone
    juce::String focus_;
    bool pageReady_ = false;  ///< the page called init(): events can be delivered
};

BoardWindowStyle& style() {
    static BoardWindowStyle s;
    return s;
}
juce::DocumentWindow* g_window = nullptr;

class BoardWindow : public juce::DocumentWindow, private juce::FocusChangeListener {
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
        // Floats above the plugin windows, but only while this process is in front, not above other apps.
        if (style().alwaysOnTop) {
            juce::Desktop::getInstance().addFocusChangeListener(this);
            updateFloating();
        }
#if !JUCE_MAC
        if (style().menu) setMenuBar(style().menu);
#endif
        g_window = this;
    }
    ~BoardWindow() override {
        juce::Desktop::getInstance().removeFocusChangeListener(this);
        if (g_window == this) g_window = nullptr;
    }
    void closeButtonPressed() override {
        if (style().onClose) style().onClose();
        else setVisible(false);  // keeps the page and its state
    }
    BoardView& view() { return *view_; }

private:
    void globalFocusChanged(juce::Component*) override { updateFloating(); }
    void updateFloating() { setAlwaysOnTop(juce::Process::isForegroundProcess()); }

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

void openSettings() {
    if (g_window) static_cast<BoardWindow*>(g_window)->view().showSettings();
}

void openBoardMenu(const juce::String& what) {
    if (g_window) static_cast<BoardWindow*>(g_window)->view().showMenu(what);
}

void setBoardWindowTitle(const juce::String& title) {
    style().title = title;
    if (g_window) g_window->setName(title);
}

juce::DocumentWindow* boardWindow() { return g_window; }

std::optional<juce::WebBrowserComponent::Resource> boardResource(const juce::String& url) { return resource(url); }

}  // namespace bleep::engine
