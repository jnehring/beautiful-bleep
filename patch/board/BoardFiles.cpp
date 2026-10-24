// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// BoardFiles.cpp — the page's resources, installing the plugins, and the preset and project files of the board window.
#include "BoardFiles.h"
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

namespace bleep::engine::boardfiles {

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
    juce::Array<juce::File> dirs{root.getChildFile("board/ui"), root.getChildFile("common/ui"), root.getChildFile("script/dist")};   // script/dist: the Bleep Script compiler and editor bundles (npm run bundle)
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

// Projects (spec §11.5) are the standalone app's project files: {format, app, name, description, tags, tempo, needs, credits, media, board}.
// The page sees one flat object, the board with description, tags, tempo, needs, credits and media next to its nodes, cables and panels.
bool isProjectKind(const juce::var& kind) { return kind.toString() == "projects"; }

const char* const kProjectMeta[] = {"description", "tags", "tempo", "needs", "credits", "media"};

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

}  // namespace bleep::engine::boardfiles
