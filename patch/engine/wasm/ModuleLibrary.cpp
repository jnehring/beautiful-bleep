// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "ModuleLibrary.h"

#include "WasmRegistry.h"

#include <cstdio>
#include <thread>

#ifndef BLEEP_LIBRARY_ROOTS
#define BLEEP_LIBRARY_ROOTS ""   // the root public keys, hex, comma separated: patch/library/root-keys.txt, put in at build time
#endif

namespace bleep::engine {
namespace {

std::vector<std::vector<uint8_t>> bakedRoots() {
    std::vector<std::vector<uint8_t>> roots;
    for (const auto& h : juce::StringArray::fromTokens(juce::String(BLEEP_LIBRARY_ROOTS), ",", ""))
        if (auto k = library::fromHex(h.trim().toStdString()); k.size() == 32) roots.push_back(std::move(k));
    return roots;
}

juce::var module(const library::InstalledModule& m, const LoadReport* r) {
    auto* o = new juce::DynamicObject();
    o->setProperty("slug", juce::String(m.slug));
    o->setProperty("version", juce::String(m.version));
    o->setProperty("source", juce::String(m.source));
    o->setProperty("status", juce::String(m.result.status));
    o->setProperty("publisher", juce::String(m.result.publisher));
    o->setProperty("allowed", m.allowed);
    o->setProperty("why", juce::String(r && !r->why.empty() ? r->why : m.why));
    o->setProperty("loaded", r && r->loaded);
    juce::Array<juce::var> types;
    for (const auto& t : m.types) types.add(juce::String(t));
    o->setProperty("types", types);
    return juce::var(o);
}

}  // namespace

ModuleLibrary& ModuleLibrary::instance() {
    static ModuleLibrary library;
    return library;
}

void ModuleLibrary::configure(juce::File dataDir, std::vector<std::vector<uint8_t>> extraRoots) {
    std::lock_guard<std::mutex> l(mutex_);
    dataDir_ = std::move(dataDir);
    roots_ = std::move(extraRoots);
}

library::Settings ModuleLibrary::settings() const {
    std::lock_guard<std::mutex> l(mutex_);
    return settings_;
}

bool ModuleLibrary::setSettings(const library::Settings& s, std::string& error) {
    if (!library::libraryUrlAllowed(s.libraryUrl, error)) return false;   // not saved
    std::lock_guard<std::mutex> l(mutex_);
    settings_ = s;
    settings_.save(dataDir_);
    return true;
}

std::unique_ptr<library::Client> ModuleLibrary::client() const {
    std::lock_guard<std::mutex> l(mutex_);
    return std::make_unique<library::Client>(settings_, dataDir_, roots_);
}

void ModuleLibrary::start() {
    if (started_.exchange(true)) return;
    {
        std::lock_guard<std::mutex> l(mutex_);
        if (dataDir_ == juce::File()) dataDir_ = library::defaultDataDir();
        settings_ = library::Settings::load(dataDir_);
        if (std::string why; !library::libraryUrlAllowed(settings_.libraryUrl, why)) {
            std::fprintf(stderr, "[library] %s: %s; using the default library\n", settings_.libraryUrl.c_str(), why.c_str());
            settings_.libraryUrl = library::Settings().libraryUrl;
        }
        for (auto& r : bakedRoots()) roots_.push_back(std::move(r));
        // a developer's own root (signing.md section 11: "Trusted developers"): added in the data folder, never in the code
        const juce::var extra = juce::JSON::parse(dataDir_.getChildFile("settings.json"));
        if (auto* a = extra["extraRoots"].getArray())
            for (const auto& h : *a)
                if (auto k = library::fromHex(h.toString().toStdString()); k.size() == 32) roots_.push_back(std::move(k));
    }
    const auto started = juce::Time::getMillisecondCounter();
    const auto c = client();
    const auto reports = loadInstalledModules(Registry::instance(), *c);
    std::fprintf(stderr, "[library] %zu installed modules checked and registered in %u ms\n", reports.size(), juce::Time::getMillisecondCounter() - started);
    std::thread([this] { fetchRevocations(*client()); }).detach();  // the list kept from the last time was applied above; this looks for a newer one
    std::lock_guard<std::mutex> l(mutex_);
    reports_ = reports;
}

void ModuleLibrary::fetchRevocations(const library::Client& c) {
    bool changed = false;
    std::string error;
    if (!c.fetchRevocations(changed, error)) {
        std::fprintf(stderr, "[library] no revocation list: %s\n", error.c_str());  // offline, or the library has none yet: what was kept stays in force
        return;
    }
    if (changed) {
        std::fprintf(stderr, "[library] revocation list %lld: installed modules are checked again\n", (long long)c.revocationSerial());
        recheckInstalledAsync();  // already registered node types stay until the next start; nothing revoked loads or installs from now on
    }
}

void ModuleLibrary::registerInstalled(const std::string& slug, const std::string& version) {
    const auto c = client();
    const auto all = c->installed(false, true);
    std::string newest;   // the highest version of this module on this machine
    for (const auto& m : all)
        if (m.slug == slug && (newest.empty() || library::versionNewer(m.version, newest))) newest = m.version;
    for (const auto& m : all) {
        if (m.slug != slug || (!version.empty() ? m.version != version : m.version != newest)) continue;
        const bool older = m.version != newest;   // a version a board pins: found by its number, next to the newest
        if (older && !registered_.insert(slug + " " + m.version).second) return;
        LoadReport r;
        r.slug = m.slug; r.version = m.version; r.source = m.source; r.status = m.result.status; r.why = m.why;
        std::vector<uint8_t> wasm;
        std::string spec, error;
        if (m.allowed && c->contentOf(m, wasm, spec, error)) {
            auto package = spec.empty() ? WasmPackage::load(wasm.data(), wasm.size(), error) : WasmPackage::lazy(std::move(wasm), spec, error);
            if (package && registerPackage(Registry::instance(), package, error, m.version, older)) { r.loaded = true; r.types = package->types; }
            else r.why = error;
        } else if (m.allowed) {
            r.why = error;
        }
        dropViewCache();  // rebuilt on the next request (never while holding mutex_: viewFile takes the two in the other order)
        std::lock_guard<std::mutex> l(mutex_);
        reports_.erase(std::remove_if(reports_.begin(), reports_.end(), [&](const LoadReport& x) { return x.slug == slug && x.version == m.version; }), reports_.end());
        reports_.push_back(std::move(r));
    }
}

void ModuleLibrary::dropViewCache() {
    std::lock_guard<std::mutex> l(viewMutex_);
    viewFiles_.clear();
    viewScripts_.clear();
    viewCacheBuilt_ = false;
}

void ModuleLibrary::post(std::function<void()> f) {
    if (postToMessageThread) postToMessageThread(std::move(f));
    else f();  // tools without a message loop
}

void ModuleLibrary::setBusy(const std::string& slug, const std::string& what) {
    std::lock_guard<std::mutex> l(mutex_);
    if (what.empty()) busy_.erase(slug); else busy_[slug] = what;
}

void ModuleLibrary::refreshIndexAsync(std::function<void()> done) {
    std::thread([this, done = std::move(done)] {
        const auto c = client();
        library::Index index;
        std::string error;
        const bool ok = c->fetchIndex(index, error);
        if (ok) fetchRevocations(*c);
        library::Index saved;
        int64_t savedAt = 0;
        std::string savedError;
        // The library was not reached: the copy of its index from the last time that worked is better than nothing.
        const bool useSaved = !ok && c->loadCachedIndex(saved, savedAt, savedError);
        {
            std::lock_guard<std::mutex> l(mutex_);
            cacheTried_ = true;
            haveIndex_ = ok || useSaved;
            indexFromCache_ = useSaved;
            indexAt_ = useSaved ? savedAt : 0;
            indexError_ = ok ? "" : error;
            if (ok) index_ = std::move(index);
            else if (useSaved) index_ = std::move(saved);
        }
        if (done) post(done);
    }).detach();
}

void ModuleLibrary::recheckInstalledAsync() {
    if (rechecking_.exchange(true)) return;
    std::thread([this] {
        client()->installed(true);
        rechecking_ = false;
    }).detach();
}

void ModuleLibrary::installAsync(const std::string& slug, std::function<void(bool, std::string)> done) {
    setBusy(slug, "installing");
    std::thread([this, slug, done = std::move(done)] {
        const auto c = client();
        library::InstalledModule m;
        std::string error;
        const bool ok = c->install(slug, m, error);
        post([this, slug, ok, error, done] {
            if (ok) {
                registerInstalled(slug);
                if (onTypesChanged) onTypesChanged();
            }
            setBusy(slug, "");
            if (done) done(ok, error);
        });
    }).detach();
}

void ModuleLibrary::installVersionAsync(const std::string& slug, const std::string& version, std::function<void(bool, std::string)> done) {
    setBusy(slug, "installing");
    std::thread([this, slug, version, done = std::move(done)] {
        const auto c = client();
        library::InstalledModule m;
        std::string error;
        bool ok = true;
        bool have = false;   // already here: nothing to fetch
        for (const auto& x : c->installed(false, true)) have = have || (x.slug == slug && x.version == version && x.allowed);
        if (!have) ok = c->installVersion(slug, version, m, error);
        post([this, slug, version, ok, error, done] {
            if (ok) {
                registerInstalled(slug, version);
                if (onTypesChanged) onTypesChanged();
            }
            setBusy(slug, "");
            if (done) done(ok, error);
        });
    }).detach();
}

void ModuleLibrary::removeAsync(const std::string& slug, std::function<void(bool, std::string)> done) {
    setBusy(slug, "removing");
    std::thread([this, slug, done = std::move(done)] {
        std::string error;
        const bool ok = client()->remove(slug, error);
        post([this, slug, ok, error, done] {
            dropViewCache();
            std::lock_guard<std::mutex> l(mutex_);
            reports_.erase(std::remove_if(reports_.begin(), reports_.end(), [&](const LoadReport& x) { return x.slug == slug; }), reports_.end());
            busy_.erase(slug);
            if (done) done(ok, error);
            // the node types stay registered until the next start: nodes that use them keep working (library.md section 9)
        });
    }).detach();
}

void ModuleLibrary::installPluginsAsync() {
    {
        std::lock_guard<std::mutex> l(mutex_);
        if (pluginJob_.state == "running") return;
        pluginJob_ = {"running", "Reading the Bleep Library…", false};
    }
    auto finish = [this](bool ok, std::string message) {
        std::lock_guard<std::mutex> l(mutex_);
        pluginJob_ = {"done", std::move(message), ok};
    };
    std::thread([this, finish] {
        if (library::abletonLiveRunning()) { finish(false, "Ableton Live is running. Close it first: replacing a plugin that Live has loaded can crash it."); return; }
        const auto c = client();
        library::Index index;
        std::string error;
        if (!c->fetchIndex(index, error)) { finish(false, error); return; }
        const juce::File folder = library::userPluginFolder();
        int installed = 0;
        std::string problems;
        for (const auto& p : index.plugins) {
            if (p.slug == "bleep-app") continue;  // the app is not a plugin
            { std::lock_guard<std::mutex> l(mutex_); pluginJob_.message = "Installing " + p.slug + "…"; }
            std::vector<std::string> names;
            std::string e;
            if (c->installPlugin(p.slug, folder, names, e)) installed += (int)names.size();
            else problems += (problems.empty() ? "" : "; ") + e;
        }
        if (installed == 0 && problems.empty()) problems = "the library has no plugins";
        finish(problems.empty(), std::to_string(installed) + " plugins installed into " + folder.getFullPathName().toStdString() + (problems.empty() ? ". Rescan plugins in your DAW." : "; not installed: " + problems));
    }).detach();
}

void ModuleLibrary::installAllAsync(std::function<void(bool, std::string)> done) {
    // "*" keeps the Library view polling for the whole run (not only while a module is being fetched), so it redraws and asks for the
    // node types again when the last one is in. Set here, before the thread starts: the view looks right after this call returns.
    setBusy("*", "installing");
    std::thread([this, done = std::move(done)] {
        const auto c = client();
        library::Index index;
        std::string error;
        if (!c->fetchIndex(index, error)) { post([this, done, error] { setBusy("*", ""); if (done) done(false, error); }); return; }
        std::set<std::string> have;
        for (const auto& m : c->installed()) have.insert(m.slug);
        int ok = 0, failed = 0;
        std::string lastError;
        for (const auto& m : index.modules) {
            if (have.count(m.slug)) continue;
            setBusy(m.slug, "installing");
            library::InstalledModule installed;
            std::string e;
            if (c->install(m.slug, installed, e)) {
                ++ok;
                post([this, slug = m.slug] { registerInstalled(slug); });
            } else { ++failed; lastError = e; }
            setBusy(m.slug, "");
        }
        post([this, done, ok, failed, lastError] {
            if (onTypesChanged) onTypesChanged();
            setBusy("*", "");
            if (done) done(failed == 0, std::to_string(ok) + " installed" + (failed ? ", " + std::to_string(failed) + " failed: " + lastError : std::string()));
        });
    }).detach();
}

void ModuleLibrary::updateAllAsync(std::function<void(bool, std::string)> done) {
    setBusy("*", "updating");   // as in installAllAsync: keeps the Library view polling for the whole run
    std::thread([this, done = std::move(done)] {
        const auto c = client();
        library::Index index;
        std::string error;
        if (!c->fetchIndex(index, error)) { post([this, done, error] { setBusy("*", ""); if (done) done(false, error); }); return; }
        std::map<std::string, std::string> have;   // slug → version, of the modules that came from the library
        for (const auto& m : c->installed())
            if (m.source == "registry") have[m.slug] = m.version;
        int ok = 0, failed = 0;
        std::string lastError;
        for (const auto& m : index.modules) {
            const auto it = have.find(m.slug);
            if (it == have.end() || !library::versionNewer(m.version, it->second)) continue;
            setBusy(m.slug, "updating");
            library::InstalledModule installed;
            std::string e;
            if (c->install(m.slug, installed, e)) {
                ++ok;
                post([this, slug = m.slug] { registerInstalled(slug); });
            } else { ++failed; lastError = e; }
            setBusy(m.slug, "");
        }
        post([this, done, ok, failed, lastError] {
            if (onTypesChanged) onTypesChanged();
            setBusy("*", "");
            if (done) done(failed == 0, std::to_string(ok) + " updated" + (failed ? ", " + std::to_string(failed) + " failed: " + lastError : std::string()));
        });
    }).detach();
}

juce::var ModuleLibrary::status() {
    const auto c = client();
    if (library::Client::cacheStale()) recheckInstalledAsync();
    std::lock_guard<std::mutex> l(mutex_);
    if (!cacheTried_) {   // the first look: the index saved the last time the library answered, until it is fetched again
        cacheTried_ = true;
        library::Index saved;
        int64_t savedAt = 0;
        std::string savedError;
        if (c->loadCachedIndex(saved, savedAt, savedError)) {
            index_ = std::move(saved);
            haveIndex_ = indexFromCache_ = true;
            indexAt_ = savedAt;
        }
    }
    auto* o = new juce::DynamicObject();
    auto* s = new juce::DynamicObject();
    s->setProperty("libraryUrl", juce::String(settings_.libraryUrl));
    s->setProperty("channel", juce::String(settings_.channel));
    auto* allow = new juce::DynamicObject();
    allow->setProperty("module", settings_.allowUnsigned.module);
    allow->setProperty("plugin", settings_.allowUnsigned.plugin);
    s->setProperty("allowUnsigned", juce::var(allow));
    s->setProperty("firstRunDone", settings_.firstRunDone);
    s->setProperty("updateCheck", settings_.updateCheck);
    o->setProperty("settings", juce::var(s));
    o->setProperty("dataDir", dataDir_.getFullPathName());
    o->setProperty("hasRoots", !roots_.empty());
    juce::Array<juce::var> installed;
    for (const auto& m : c->installed()) {
        const LoadReport* r = nullptr;
        for (const auto& x : reports_) if (x.slug == m.slug && x.version == m.version) r = &x;
        installed.add(module(m, r));
    }
    o->setProperty("installed", installed);
    // Older versions kept next to the newest, because a board pins them; `pinning`: this app can run a version a board names.
    juce::Array<juce::var> versions;
    const auto every = c->installed(false, true);
    std::map<std::string, std::string> newestOf;
    for (const auto& m : every)
        if (!newestOf.count(m.slug) || library::versionNewer(m.version, newestOf[m.slug])) newestOf[m.slug] = m.version;
    for (const auto& m : every) {
        if (newestOf[m.slug] == m.version) continue;
        const LoadReport* r = nullptr;
        for (const auto& x : reports_) if (x.slug == m.slug && x.version == m.version) r = &x;
        versions.add(module(m, r));
    }
    o->setProperty("versions", versions);
    o->setProperty("pinning", true);
    auto* idx = new juce::DynamicObject();
    idx->setProperty("ok", haveIndex_);
    idx->setProperty("cached", indexFromCache_);   // true: the copy saved on disk, the library has not answered since
    idx->setProperty("cachedAt", (juce::int64)indexAt_);
    idx->setProperty("error", juce::String(indexError_));
    // The tile of an entry: what the library says about it, and where its screenshot is (an absolute address, or empty).
    auto tile = [&c](auto* x, const auto& e) {
        x->setProperty("title", juce::String(e.title.empty() ? e.slug : e.title));
        x->setProperty("summary", juce::String(e.summary));
        x->setProperty("category", juce::String(e.category));
        x->setProperty("imageUrl", e.image.empty() ? juce::String() : c->url(e.image));
    };
    juce::Array<juce::var> offered;
    for (const auto& m : index_.modules) {
        auto* x = new juce::DynamicObject();
        x->setProperty("slug", juce::String(m.slug));
        x->setProperty("version", juce::String(m.version));
        tile(x, m);
        juce::Array<juce::var> types;
        for (const auto& t : m.types) types.add(juce::String(t));
        x->setProperty("types", types);
        offered.add(juce::var(x));
    }
    idx->setProperty("modules", offered);
    juce::Array<juce::var> plugins;
    for (const auto& p : index_.plugins) {
        auto* x = new juce::DynamicObject();
        x->setProperty("slug", juce::String(p.slug));
        x->setProperty("version", juce::String(p.version));
        tile(x, p);
        plugins.add(juce::var(x));
    }
    idx->setProperty("plugins", plugins);
    o->setProperty("index", juce::var(idx));
    auto* busy = new juce::DynamicObject();
    for (const auto& [slug, what] : busy_) busy->setProperty(juce::Identifier(juce::String(slug)), juce::String(what));
    o->setProperty("busy", juce::var(busy));
    auto* job = new juce::DynamicObject();
    job->setProperty("state", juce::String(pluginJob_.state));
    job->setProperty("message", juce::String(pluginJob_.message));
    job->setProperty("ok", pluginJob_.ok);
    o->setProperty("pluginJob", juce::var(job));
    return juce::var(o);
}

// ---- what the board window serves from the installed packages -------------------------------------------------------

void ModuleLibrary::buildViewCache() const {
    if (viewCacheBuilt_) return;
    const auto started = juce::Time::getMillisecondCounter();
    juce::StringArray names;
    const auto c = const_cast<ModuleLibrary*>(this)->client();
    for (const auto& m : c->installed()) {
        if (!m.allowed) continue;
        library::Package pkg;
        std::string error;
        // installed() may answer from its cache (keyed on size and time of the file): the files served to the board's web view
        // come from bytes checked against the signature now, like the wasm does.
        if (!c->filesOf(m, pkg, error)) continue;
        for (const auto& [path, data] : pkg.files) {
            const bool ui = path.rfind("ui/", 0) == 0, doc = path.rfind("doc/", 0) == 0;
            if (!ui && !doc) continue;
            const std::string name = path.substr(ui ? 3 : 4);
            if (name.empty() || name.find('/') != std::string::npos) continue;
            // The page loads these by their bare names, so a name is one file for the whole app: a module cannot take over a name
            // another module already provides, and a name outside [A-Za-z0-9._-] never reaches the page.
            const bool plain = name.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-") == std::string::npos;
            if (!plain || name.find("..") != std::string::npos) {
                std::fprintf(stderr, "[library] %s: %s skipped (unsafe file name)\n", m.slug.c_str(), path.c_str());
                continue;
            }
            if (!viewFiles_.emplace(name, data).second) {
                std::fprintf(stderr, "[library] %s: %s skipped (the name is already provided by another file)\n", m.slug.c_str(), path.c_str());
                continue;
            }
            if (ui && name.size() > 3 && name.substr(name.size() - 3) == ".js") names.add(juce::String(name));
        }
    }
    juce::Array<juce::var> list;
    for (const auto& n : names) list.add(n);
    viewScripts_ = (juce::JSON::toString(juce::var(list), true) + "\n").toStdString();
    viewCacheBuilt_ = true;
    std::fprintf(stderr, "[library] %zu view and doc files of the installed modules read in %u ms\n", viewFiles_.size(), juce::Time::getMillisecondCounter() - started);
}

bool ModuleLibrary::viewFile(const std::string& name, std::vector<uint8_t>& bytes) const {
    if (name.empty() || name.find('/') != std::string::npos || name.find("..") != std::string::npos) return false;
    std::lock_guard<std::mutex> l(viewMutex_);
    buildViewCache();
    const auto it = viewFiles_.find(name);
    if (it == viewFiles_.end()) return false;
    bytes = it->second;
    return true;
}

std::string ModuleLibrary::moduleViewsJson() const {
    std::lock_guard<std::mutex> l(viewMutex_);
    buildViewCache();
    return viewScripts_;
}

}  // namespace bleep::engine
