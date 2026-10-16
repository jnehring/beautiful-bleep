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
//              (kind: "cell", the default, "drums" for Drum Grid patterns, or "projects" for whole projects: the
//              board with its panels, as {name, preset: {nodes, cables, panels, description, tags, tempo, needs}})
//              loadPatch(board, tempo, name)   the preset browser: replace the project with a patch
//              copyText(text) pasteText()   the system clipboard (board copy & paste)
//   C++ → JS   "board"  {board, ports, canUndo, canRedo}   board changed elsewhere
//              "state"  {nodes: {id: {outputs, activity, params?}}, ports}   30 times per second
//              "focus"  {node}   a plugin window asked for its node
//              "openPresets"     show the preset browser
#include "BoardWindow.h"
#include "BoardResources.h"
#include "Engine.h"
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
        const juce::var a = juce::JSON::parse(embedded), b = juce::JSON::parse(juce::String(bleep::engine::ModuleLibrary::instance().moduleViewsJson()));
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
        if (!embedded && bleep::engine::ModuleLibrary::instance().viewFile(path.toStdString(), bytes)) return bytesOf(bytes.data(), bytes.size());
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
/// The default plugin bundle (developers/modules/library.md 5a). An offline installer carries the plugins in the app (Contents/Resources/Plugins
/// on macOS, Plugins next to the app elsewhere): those are copied into the user's VST3 folder. Otherwise they are downloaded from the
/// library, which checks their signatures. Live must be closed: replacing a plugin that Live has loaded can crash it.
juce::var installPluginBundle() {
    auto* r = new juce::DynamicObject();
    juce::var result(r);
    r->setProperty("ok", false);
    r->setProperty("started", false);
#if JUCE_MAC
    const auto source = juce::File::getSpecialLocation(juce::File::currentApplicationFile).getChildFile("Contents/Resources/Plugins");
#else
    const auto source = juce::File::getSpecialLocation(juce::File::currentApplicationFile).getParentDirectory().getChildFile("Plugins");
#endif
    const auto bundles = source.findChildFiles(juce::File::findFilesAndDirectories, false, "*.vst3");
    if (bundles.isEmpty()) {  // online: the library does it, on another thread; the window polls status().pluginJob
        bleep::engine::ModuleLibrary::instance().installPluginsAsync();
        r->setProperty("started", true);
        return result;
    }
    if (bleep::library::abletonLiveRunning()) {
        r->setProperty("message", "Ableton Live is running. Close it first: replacing a plugin that Live has loaded can crash it.");
        return result;
    }
    const auto target = bleep::library::userPluginFolder();
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
    r->setProperty("message", juce::String(n) + " plugins installed into " + target.getFullPathName() + ". Rescan plugins in your DAW.");
    return result;
}

/// The Bleep plugins in the system's VST3 folders (the Library section lists them; installing them is the app's job).
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
    for (const char* name : {"Bleep Board", "Bleep MIDI In", "Bleep MIDI Out", "Bleep Audio In", "Bleep Audio Out", "Bleep Instrument", "Bleep FX"}) {
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
// §8.1), Drum Grid patterns (doc/specs/modules/drum-grid.md §4.6), whole
// patches (the preset browser, spec §11.5) and the user presets of each module
// (kind "module:<type>", Module Presets/<type>/), by kind.
struct PresetKind {
    juce::String folder;
    juce::String extension;
};

PresetKind presetKind(const juce::var& kind) {
    const auto k = kind.toString();
    if (k == "drums") return {"Drum Patterns", ".bleepdrums"};
    if (k == "projects") return {"Projects", ".bleepboard"};
    if (k.startsWith("module:")) {
        // The module's type is a folder name: keep it to a slug, so a kind can never leave Module Presets/.
        const auto type = k.fromFirstOccurrenceOf("module:", false, false).retainCharacters("abcdefghijklmnopqrstuvwxyz0123456789-");
        if (type.isNotEmpty()) return {"Module Presets/" + type, ".bleepmodule"};
    }
    return {"Cells", ".bleepcell"};
}

juce::File presetFolder(const PresetKind& k) {
    return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
        .getChildFile("Beautiful Bleep").getChildFile(k.folder);
}

// Projects (spec §11.5) are the standalone app's project files: {format, app, name, description, tags, tempo, needs, credits, board}.
// The page sees one flat object, the board with description, tags, tempo, needs and credits next to its nodes, cables and panels.
bool isProjectKind(const juce::var& kind) { return kind.toString() == "projects"; }

const char* const kProjectMeta[] = {"description", "tags", "tempo", "needs", "credits"};

juce::var projectToFlat(const juce::var& doc) {
    auto* flat = new juce::DynamicObject();
    if (auto* board = doc["board"].getDynamicObject())
        for (const auto& p : board->getProperties()) flat->setProperty(p.name, p.value);
    for (const auto* key : kProjectMeta)
        if (doc.hasProperty(key)) flat->setProperty(key, doc[key]);
    return juce::var(flat);
}

juce::var flatToProject(const juce::String& name, const juce::var& flat) {
    auto* board = new juce::DynamicObject();
    if (auto* f = flat.getDynamicObject())
        for (const auto& p : f->getProperties()) {
            bool meta = false;
            for (const auto* key : kProjectMeta) meta = meta || p.name.toString() == key;
            if (!meta) board->setProperty(p.name, p.value);
        }
    auto* doc = new juce::DynamicObject();
    doc->setProperty("format", 2);
    doc->setProperty("app", "Bleep");
    doc->setProperty("name", name);
    for (const auto* key : kProjectMeta)
        if (flat.hasProperty(key)) doc->setProperty(key, flat[key]);
    doc->setProperty("board", juce::var(board));
    return juce::var(doc);
}

/// Board presets of older versions (Boards/*.bleeppreset, {name, preset}) become projects; the old files stay where they are.
void migrateBoardPresets() {
    static bool done = false;
    if (done) return;
    done = true;
    const auto data = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("Beautiful Bleep");
    const auto projects = data.getChildFile("Projects");
    for (const auto& f : data.getChildFile("Boards").findChildFiles(juce::File::findFiles, false, "*.bleeppreset")) {
        const auto v = juce::JSON::parse(f.loadFileAsString());
        if (!v["name"].isString() || !v["preset"].isObject()) continue;
        const auto to = projects.getChildFile(f.getFileNameWithoutExtension() + ".bleepboard");
        if (to.existsAsFile()) continue;
        projects.createDirectory();
        to.replaceWithText(juce::JSON::toString(flatToProject(v["name"].toString(), v["preset"])));
    }
}

juce::File presetFile(const juce::String& name, const PresetKind& k) {
    const auto safe = juce::File::createLegalFileName(name.trim()).substring(0, 80);
    return safe.isEmpty() ? juce::File() : presetFolder(k).getChildFile(safe + k.extension);
}

juce::var presetList(const PresetKind& k) {
    juce::Array<juce::var> list;
    auto files = presetFolder(k).findChildFiles(juce::File::findFiles, false, "*" + k.extension);
    files.sort();
    for (const auto& f : files) {
        auto v = juce::JSON::parse(f.loadFileAsString());
        if (k.extension == ".bleepboard") {   // a project file: show it as {name, preset}
            if (!v["board"].isObject()) continue;
            auto* o = new juce::DynamicObject();
            o->setProperty("name", v["name"].isString() ? v["name"] : juce::var(f.getFileNameWithoutExtension()));
            o->setProperty("preset", projectToFlat(v));
            list.add(juce::var(o));
            continue;
        }
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
                    r.getDynamicObject()->setProperty("settings", style().onSettings != nullptr);
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
                .withNativeFunction("exportMedia", gated([this](const juce::Array<juce::var>& a, Completion done) {
                    done(engine_.exportMedia(a[0].toString(), a[1].toString()));
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
                .withNativeFunction("settings", gated([](const juce::Array<juce::var>& a, Completion done) {
                    done(style().onSettings ? style().onSettings(a[0].toString(), a[1]) : juce::var());
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
            .withNativeFunction("libraryRefresh", gated([](const juce::Array<juce::var>&, Completion done) {
                ModuleLibrary::instance().refreshIndexAsync();
                done({});
            }))
            .withNativeFunction("libraryInstall", gated([](const juce::Array<juce::var>& a, Completion done) {
                ModuleLibrary::instance().installAsync(a[0].toString().toStdString());
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
              "const p = JSON.parse(JSON.stringify(window.BleepFactoryPresets[0].preset)); "
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
              "(function(){ const q = window.__findPreset('Combo Organ'); window.__t0 = Date.now(); "
              "window.__ens = 'pending'; "
              "native('libraryStatus').then(s => { window.__st = JSON.stringify({keys: Object.keys(s), installed: (s.installed||[]).length, "
              "index: s.index && {ok: s.index.ok, error: s.index.error, modules: (s.index.modules||[]).length}}); }, e => window.__st = 'rejected ' + e); "
              "BleepLibraryView.ensureNeeds(q.preset, q.name).then(v => window.__ens = 'resolved ' + v + ' after ' + (Date.now() - window.__t0) + ' ms', "
              "e => window.__ens = 'rejected ' + (e && e.message || e)); "
              "return JSON.stringify(['Warm Saws', 'Combo Organ', 'Brass Section'].map(window.__addPreset)); })()",
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
