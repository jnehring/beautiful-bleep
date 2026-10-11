// SPDX-License-Identifier: MIT
#include "ModuleStore.h"

#include "WasmRegistry.h"

#include <cstdio>
#include <thread>

#ifndef BLEEP_STORE_ROOTS
#define BLEEP_STORE_ROOTS ""   // the root public keys, hex, comma separated: patch/store/root-keys.txt, put in at build time
#endif

namespace bleep::engine {
namespace {

std::vector<std::vector<uint8_t>> bakedRoots() {
    std::vector<std::vector<uint8_t>> roots;
    for (const auto& h : juce::StringArray::fromTokens(juce::String(BLEEP_STORE_ROOTS), ",", ""))
        if (auto k = store::fromHex(h.trim().toStdString()); k.size() == 32) roots.push_back(std::move(k));
    return roots;
}

juce::var module(const store::InstalledModule& m, const LoadReport* r) {
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

ModuleStore& ModuleStore::instance() {
    static ModuleStore store;
    return store;
}

void ModuleStore::configure(juce::File dataDir, std::vector<std::vector<uint8_t>> extraRoots) {
    std::lock_guard<std::mutex> l(mutex_);
    dataDir_ = std::move(dataDir);
    roots_ = std::move(extraRoots);
}

store::Settings ModuleStore::settings() const {
    std::lock_guard<std::mutex> l(mutex_);
    return settings_;
}

void ModuleStore::setSettings(const store::Settings& s) {
    std::lock_guard<std::mutex> l(mutex_);
    settings_ = s;
    settings_.save(dataDir_);
}

std::unique_ptr<store::Client> ModuleStore::client() const {
    std::lock_guard<std::mutex> l(mutex_);
    return std::make_unique<store::Client>(settings_, dataDir_, roots_);
}

void ModuleStore::start() {
    if (started_.exchange(true)) return;
    {
        std::lock_guard<std::mutex> l(mutex_);
        if (dataDir_ == juce::File()) dataDir_ = store::defaultDataDir();
        settings_ = store::Settings::load(dataDir_);
        for (auto& r : bakedRoots()) roots_.push_back(std::move(r));
        // a developer's own root (signing.md section 11: "Trusted developers"): added in the data folder, never in the code
        const juce::var extra = juce::JSON::parse(dataDir_.getChildFile("settings.json"));
        if (auto* a = extra["extraRoots"].getArray())
            for (const auto& h : *a)
                if (auto k = store::fromHex(h.toString().toStdString()); k.size() == 32) roots_.push_back(std::move(k));
    }
    const auto started = juce::Time::getMillisecondCounter();
    const auto c = client();
    const auto reports = loadInstalledModules(Registry::instance(), *c);
    std::fprintf(stderr, "[store] %zu installed modules checked and registered in %u ms\n", reports.size(), juce::Time::getMillisecondCounter() - started);
    std::lock_guard<std::mutex> l(mutex_);
    reports_ = reports;
}

void ModuleStore::registerInstalled(const std::string& slug) {
    const auto c = client();
    for (const auto& m : c->installed()) {
        if (m.slug != slug) continue;
        LoadReport r;
        r.slug = m.slug; r.version = m.version; r.source = m.source; r.status = m.result.status; r.why = m.why;
        std::vector<uint8_t> wasm;
        std::string spec, error;
        if (m.allowed && c->contentOf(m, wasm, spec, error)) {
            auto package = spec.empty() ? WasmPackage::load(wasm.data(), wasm.size(), error) : WasmPackage::lazy(std::move(wasm), spec, error);
            if (package && registerPackage(Registry::instance(), package, error)) { r.loaded = true; r.types = package->types; }
            else r.why = error;
        } else if (m.allowed) {
            r.why = error;
        }
        dropViewCache();  // rebuilt on the next request (never while holding mutex_: viewFile takes the two in the other order)
        std::lock_guard<std::mutex> l(mutex_);
        reports_.erase(std::remove_if(reports_.begin(), reports_.end(), [&](const LoadReport& x) { return x.slug == slug; }), reports_.end());
        reports_.push_back(std::move(r));
    }
}

void ModuleStore::dropViewCache() {
    std::lock_guard<std::mutex> l(viewMutex_);
    viewFiles_.clear();
    viewScripts_.clear();
    viewCacheBuilt_ = false;
}

void ModuleStore::post(std::function<void()> f) {
    if (postToMessageThread) postToMessageThread(std::move(f));
    else f();  // tools without a message loop
}

void ModuleStore::setBusy(const std::string& slug, const std::string& what) {
    std::lock_guard<std::mutex> l(mutex_);
    if (what.empty()) busy_.erase(slug); else busy_[slug] = what;
}

void ModuleStore::refreshIndexAsync(std::function<void()> done) {
    std::thread([this, done = std::move(done)] {
        const auto c = client();
        store::Index index;
        std::string error;
        const bool ok = c->fetchIndex(index, error);
        {
            std::lock_guard<std::mutex> l(mutex_);
            haveIndex_ = ok;
            indexError_ = ok ? "" : error;
            if (ok) index_ = std::move(index);
        }
        if (done) post(done);
    }).detach();
}

void ModuleStore::recheckInstalledAsync() {
    if (rechecking_.exchange(true)) return;
    std::thread([this] {
        client()->installed(true);
        rechecking_ = false;
    }).detach();
}

void ModuleStore::installAsync(const std::string& slug, std::function<void(bool, std::string)> done) {
    setBusy(slug, "installing");
    std::thread([this, slug, done = std::move(done)] {
        const auto c = client();
        store::InstalledModule m;
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

void ModuleStore::removeAsync(const std::string& slug, std::function<void(bool, std::string)> done) {
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
            // the node types stay registered until the next start: nodes that use them keep working (store.md section 9)
        });
    }).detach();
}

void ModuleStore::installPluginsAsync() {
    {
        std::lock_guard<std::mutex> l(mutex_);
        if (pluginJob_.state == "running") return;
        pluginJob_ = {"running", "Reading the Bleep Store…", false};
    }
    auto finish = [this](bool ok, std::string message) {
        std::lock_guard<std::mutex> l(mutex_);
        pluginJob_ = {"done", std::move(message), ok};
    };
    std::thread([this, finish] {
        if (store::abletonLiveRunning()) { finish(false, "Ableton Live is running. Close it first: replacing a plugin that Live has loaded can crash it."); return; }
        const auto c = client();
        store::Index index;
        std::string error;
        if (!c->fetchIndex(index, error)) { finish(false, error); return; }
        const juce::File folder = store::userPluginFolder();
        int installed = 0;
        std::string problems;
        for (const auto& p : index.plugins) {
            if (p.slug == "bleep-patch-app") continue;  // the app is not a plugin
            { std::lock_guard<std::mutex> l(mutex_); pluginJob_.message = "Installing " + p.slug + "…"; }
            std::vector<std::string> names;
            std::string e;
            if (c->installPlugin(p.slug, folder, names, e)) installed += (int)names.size();
            else problems += (problems.empty() ? "" : "; ") + e;
        }
        if (installed == 0 && problems.empty()) problems = "the store has no plugins";
        finish(problems.empty(), std::to_string(installed) + " plugins installed into " + folder.getFullPathName().toStdString() + (problems.empty() ? ". Rescan plugins in your DAW." : "; not installed: " + problems));
    }).detach();
}

void ModuleStore::installAllAsync(std::function<void(bool, std::string)> done) {
    std::thread([this, done = std::move(done)] {
        const auto c = client();
        store::Index index;
        std::string error;
        if (!c->fetchIndex(index, error)) { if (done) post([done, error] { done(false, error); }); return; }
        std::set<std::string> have;
        for (const auto& m : c->installed()) have.insert(m.slug);
        int ok = 0, failed = 0;
        std::string lastError;
        for (const auto& m : index.modules) {
            if (have.count(m.slug)) continue;
            setBusy(m.slug, "installing");
            store::InstalledModule installed;
            std::string e;
            if (c->install(m.slug, installed, e)) {
                ++ok;
                post([this, slug = m.slug] { registerInstalled(slug); });
            } else { ++failed; lastError = e; }
            setBusy(m.slug, "");
        }
        post([this, done, ok, failed, lastError] {
            if (onTypesChanged) onTypesChanged();
            if (done) done(failed == 0, std::to_string(ok) + " installed" + (failed ? ", " + std::to_string(failed) + " failed: " + lastError : std::string()));
        });
    }).detach();
}

juce::var ModuleStore::status() {
    const auto c = client();
    if (store::Client::cacheStale()) recheckInstalledAsync();
    std::lock_guard<std::mutex> l(mutex_);
    auto* o = new juce::DynamicObject();
    auto* s = new juce::DynamicObject();
    s->setProperty("storeUrl", juce::String(settings_.storeUrl));
    s->setProperty("channel", juce::String(settings_.channel));
    auto* allow = new juce::DynamicObject();
    allow->setProperty("module", settings_.allowUnsigned.module);
    allow->setProperty("plugin", settings_.allowUnsigned.plugin);
    s->setProperty("allowUnsigned", juce::var(allow));
    s->setProperty("firstRunDone", settings_.firstRunDone);
    o->setProperty("settings", juce::var(s));
    o->setProperty("dataDir", dataDir_.getFullPathName());
    o->setProperty("hasRoots", !roots_.empty());
    juce::Array<juce::var> installed;
    for (const auto& m : c->installed()) {
        const LoadReport* r = nullptr;
        for (const auto& x : reports_) if (x.slug == m.slug) r = &x;
        installed.add(module(m, r));
    }
    o->setProperty("installed", installed);
    auto* idx = new juce::DynamicObject();
    idx->setProperty("ok", haveIndex_);
    idx->setProperty("error", juce::String(indexError_));
    // The tile of an entry: what the store says about it, and where its screenshot is (an absolute address, or empty).
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

void ModuleStore::buildViewCache() const {
    if (viewCacheBuilt_) return;
    const auto started = juce::Time::getMillisecondCounter();
    juce::StringArray names;
    const auto c = const_cast<ModuleStore*>(this)->client();
    for (const auto& m : c->installed()) {
        if (!m.allowed) continue;
        juce::MemoryBlock block;
        store::Package pkg;
        std::string error;
        if (!m.file.loadFileAsData(block) || !store::readPackage((const uint8_t*)block.getData(), block.getSize(), pkg, error)) continue;
        for (const auto& [path, data] : pkg.files) {
            const bool ui = path.rfind("ui/", 0) == 0, doc = path.rfind("doc/", 0) == 0;
            if (!ui && !doc) continue;
            const std::string name = path.substr(ui ? 3 : 4);
            if (name.empty() || name.find('/') != std::string::npos) continue;
            viewFiles_.emplace(name, data);
            if (ui && name.size() > 3 && name.substr(name.size() - 3) == ".js") names.add("\"" + juce::String(name) + "\"");
        }
    }
    viewScripts_ = ("[" + names.joinIntoString(", ") + "]\n").toStdString();
    viewCacheBuilt_ = true;
    std::fprintf(stderr, "[store] %zu view and doc files of the installed modules read in %u ms\n", viewFiles_.size(), juce::Time::getMillisecondCounter() - started);
}

bool ModuleStore::viewFile(const std::string& name, std::vector<uint8_t>& bytes) const {
    if (name.empty() || name.find('/') != std::string::npos || name.find("..") != std::string::npos) return false;
    std::lock_guard<std::mutex> l(viewMutex_);
    buildViewCache();
    const auto it = viewFiles_.find(name);
    if (it == viewFiles_.end()) return false;
    bytes = it->second;
    return true;
}

std::string ModuleStore::moduleViewsJson() const {
    std::lock_guard<std::mutex> l(viewMutex_);
    buildViewCache();
    return viewScripts_;
}

}  // namespace bleep::engine
