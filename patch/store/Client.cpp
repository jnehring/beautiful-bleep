// SPDX-License-Identifier: MIT
#include <cctype>
#include <cstdlib>
#include "Client.h"

#include <algorithm>
#include <map>
#include <mutex>
#include <set>
#include <ctime>
#include <cstring>

namespace bleep::store {
namespace {

constexpr size_t kMaxJsonBytes = size_t(16) << 20;      // an index, an entry, a list
constexpr size_t kMaxPackageBytes = size_t(1024) << 20;  // a module or a plugin

bool fetchBytes(const juce::String& address, std::vector<uint8_t>& out, std::string& error, size_t maxBytes = kMaxPackageBytes) {
    int status = 0;
    const juce::URL url(address);
    auto stream = url.createInputStream(juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
                                            .withConnectionTimeoutMs(15000).withStatusCode(&status).withNumRedirectsToFollow(5));
    if (!stream) { error = "cannot reach " + address.toStdString(); return false; }
    if (status >= 400) { error = address.toStdString() + ": " + std::to_string(status); return false; }
    const auto announced = stream->getTotalLength();
    if (announced > 0 && (uint64_t)announced > maxBytes) { error = address.toStdString() + " is too large"; return false; }
    juce::MemoryBlock block;
    stream->readIntoMemoryBlock(block, (juce::int64)maxBytes + 1);  // one byte more than allowed shows an endless answer
    if (block.getSize() > maxBytes) { error = address.toStdString() + " is too large"; return false; }
    out.assign((const uint8_t*)block.getData(), (const uint8_t*)block.getData() + block.getSize());
    return true;
}

bool fetchJson(const juce::String& address, juce::var& out, std::string& error) {
    std::vector<uint8_t> bytes;
    if (!fetchBytes(address, bytes, error, kMaxJsonBytes)) return false;
    out = juce::JSON::parse(juce::String::fromUTF8(reinterpret_cast<const char*>(bytes.data()), (int)bytes.size()));
    if (out.isVoid()) { error = address.toStdString() + " is not JSON"; return false; }
    return true;
}

std::string str(const juce::var& v) { return v.isString() ? v.toString().toStdString() : std::string(); }

/// "1.2.3" → a comparable number; -1 for anything else.
long long versionKey(const std::string& v) {
    int a = 0, b = 0, c = 0;
    char extra = 0;
    if (std::sscanf(v.c_str(), "%d.%d.%d%c", &a, &b, &c, &extra) != 3) return -1;
    return ((long long)a << 40) | ((long long)b << 20) | c;
}

/// A slug or version becomes a folder name: no separators, no "..", nothing that could leave the modules folder.
bool safeSlug(const std::string& s) {
    if (s.empty() || s.size() > 100 || !std::isalnum((unsigned char)s[0]) || s.find("..") != std::string::npos) return false;
    for (const char c : s)
        if (!(std::islower((unsigned char)c) || std::isdigit((unsigned char)c) || c == '.' || c == '-')) return false;
    return true;
}

bool safeVersion(const std::string& v) {  // exactly "1.2.3"
    int dots = 0;
    if (v.empty() || v.size() > 32 || v.front() == '.' || v.back() == '.') return false;
    for (const char c : v) {
        if (c == '.') { if (++dots > 2) return false; }
        else if (!std::isdigit((unsigned char)c)) return false;
    }
    return dots == 2 && v.find("..") == std::string::npos;
}

bool isInside(const juce::File& child, const juce::File& root) { return child != root && child.isAChildOf(root); }

std::string signedId(const std::string& slug) {  // "acme.fuzz" in URLs is "acme/fuzz" in signatures
    std::string id = slug;
    const auto dot = id.find('.');
    if (dot != std::string::npos) id[dot] = '/';
    return id;
}

std::vector<std::string> typesOf(const Package& p) {
    std::vector<std::string> out;
    auto it = p.files.find("module.json");
    if (it == p.files.end()) return out;
    const juce::var meta = juce::JSON::parse(juce::String::fromUTF8(reinterpret_cast<const char*>(it->second.data()), (int)it->second.size()));
    if (auto* a = meta["types"].getArray())
        for (const auto& t : *a) out.push_back(str(t));
    return out;
}

/// The signature of an installed package: the file beside it (the store keeps signatures in the entry, not in the package),
/// else what the package carries. Void if there is none.
juce::var sidecarSignature(const juce::File& package) {
    const juce::File f = package.withFileExtension("sig.json");
    return f.existsAsFile() ? juce::JSON::parse(f) : juce::var();
}

bool readFile(const juce::File& f, std::vector<uint8_t>& out) {
    juce::MemoryBlock block;
    if (!f.loadFileAsData(block)) return false;
    out.assign((const uint8_t*)block.getData(), (const uint8_t*)block.getData() + block.getSize());
    return true;
}

}  // namespace

// ---- settings --------------------------------------------------------------------------------------------

std::string platformId() {
#if JUCE_MAC
    const char* os = "macos";
#elif JUCE_WINDOWS
    const char* os = "windows";
#else
    const char* os = "linux";
#endif
#if JUCE_ARM
    return std::string(os) + "-arm64";
#else
    return std::string(os) + "-x86_64";
#endif
}

juce::File userPluginFolder() {
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

juce::File defaultDataDir() {
    if (const char* dir = std::getenv("BLEEP_DATA_DIR"); dir && *dir) return juce::File(dir);  // tests and development: another folder
#if JUCE_MAC
    return juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile("Library/Application Support/Bleep");
#elif JUCE_WINDOWS
    return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("Bleep");
#else
    return juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile(".local/share/Bleep");
#endif
}

Settings Settings::load(const juce::File& dataDir) {
    Settings s;
    const juce::var v = juce::JSON::parse(dataDir.getChildFile("settings.json"));
    if (!v.isObject()) return s;
    if (v["storeUrl"].isString()) s.storeUrl = str(v["storeUrl"]);
    if (v["channel"].isString()) s.channel = str(v["channel"]);
    s.allowUnsigned.module = v["allowUnsigned"]["module"].isBool() && (bool)v["allowUnsigned"]["module"];
    s.allowUnsigned.plugin = v["allowUnsigned"]["plugin"].isBool() && (bool)v["allowUnsigned"]["plugin"];
    s.firstRunDone = v["firstRunDone"].isBool() && (bool)v["firstRunDone"];
    return s;
}

bool Settings::save(const juce::File& dataDir) const {
    auto* allow = new juce::DynamicObject();
    allow->setProperty("module", allowUnsigned.module);
    allow->setProperty("plugin", allowUnsigned.plugin);
    auto* o = new juce::DynamicObject();
    o->setProperty("storeUrl", juce::String(storeUrl));
    o->setProperty("channel", juce::String(channel));
    o->setProperty("allowUnsigned", juce::var(allow));
    o->setProperty("firstRunDone", firstRunDone);
    dataDir.createDirectory();
    return dataDir.getChildFile("settings.json").replaceWithText(juce::JSON::toString(juce::var(o)));
}

// ---- index -------------------------------------------------------------------------------------------------

const IndexModule* Index::find(const std::string& slug) const {
    for (const auto& m : modules)
        if (m.slug == slug) return &m;
    return nullptr;
}

const IndexModule* Index::providing(const std::string& type) const {
    for (const auto& m : modules)
        if (std::find(m.types.begin(), m.types.end(), type) != m.types.end()) return &m;
    return nullptr;
}

// ---- client ------------------------------------------------------------------------------------------------

Client::Client(Settings settings, juce::File dataDir, std::vector<std::vector<uint8_t>> roots, int64_t now)
    : settings_(std::move(settings)), dataDir_(std::move(dataDir)), roots_(std::move(roots)),
      now_(now ? now : (int64_t)std::time(nullptr)) {
    revocations_ = loadRevocations();
}

std::optional<Revocations> Client::loadRevocations() const {
    const auto file = dataDir_.getChildFile("cache").getChildFile("revocations.json");
    if (!file.existsAsFile()) return std::nullopt;
    Revocations list;
    std::string error;
    if (!verifyRevocations(juce::JSON::parse(file), roots_, list, error)) return std::nullopt;  // a saved list that no longer checks (other roots) is no list
    return list;
}

bool Client::fetchRevocations(bool& changed, std::string& error) const {
    changed = false;
    juce::var doc;
    if (!fetchJson(url("revocations.json"), doc, error)) return false;
    Revocations list;
    if (!verifyRevocations(doc, roots_, list, error)) return false;
    if (list.serial <= revocationSerial()) return true;
    const auto file = dataDir_.getChildFile("cache").getChildFile("revocations.json");
    if (!file.getParentDirectory().createDirectory().wasOk() || !file.replaceWithText(juce::JSON::toString(doc))) {
        error = "cannot save the revocation list";
        return false;
    }
    revocations_ = std::move(list);
    changed = true;
    return true;
}

juce::String Client::url(const std::string& path) const {
    juce::String base(settings_.storeUrl);
    if (!base.endsWithChar('/')) base << '/';
    return base + "registry/v1/" + juce::String(path);
}

juce::File Client::modulesFolder(const std::string& source) const { return dataDir_.getChildFile("modules").getChildFile(source); }

namespace {
/// The channel's modules and plugins out of the store's index.json.
bool parseIndex(const juce::var& json, const std::string& channel, Index& out, std::string& error) {
    out = Index{};
    const juce::var modules = json["channels"][juce::Identifier(juce::String(channel))]["modules"];
    if (auto* o = modules.getDynamicObject())
        for (const auto& p : o->getProperties()) {
            IndexModule m;
            m.slug = p.name.toString().toStdString();
            m.version = str(p.value["version"]);
            m.entry = str(p.value["entry"]);
            m.title = str(p.value["title"]); m.summary = str(p.value["summary"]);
            m.category = str(p.value["category"]); m.image = str(p.value["image"]);
            if (auto* t = p.value["types"].getArray())
                for (const auto& x : *t) m.types.push_back(str(x));
            out.modules.push_back(std::move(m));
        }
    else { error = "the store's index has no modules for the channel " + channel; return false; }
    if (auto* o = json["channels"][juce::Identifier(juce::String(channel))]["plugins"].getDynamicObject())
        for (const auto& p : o->getProperties()) {
            IndexPlugin x;
            x.slug = p.name.toString().toStdString();
            x.version = str(p.value["version"]);
            x.entry = str(p.value["entry"]);
            x.title = str(p.value["title"]); x.summary = str(p.value["summary"]);
            x.category = str(p.value["category"]); x.image = str(p.value["image"]);
            out.plugins.push_back(std::move(x));
        }
    return true;
}
}  // namespace

bool versionNewer(const std::string& a, const std::string& b) {
    const long long x = versionKey(a), y = versionKey(b);
    return x >= 0 && y >= 0 && x > y;
}

bool Client::fetchIndex(Index& out, std::string& error) const {
    juce::var json;
    if (!fetchJson(url("index.json"), json, error)) return false;
    if (!parseIndex(json, settings_.channel, out, error)) return false;
    // Keep what was fetched, so the next start (or no network) still knows the store. A failure to write is not the store's fault.
    const auto file = dataDir_.getChildFile("cache").getChildFile("index.json");
    if (file.getParentDirectory().createDirectory().wasOk()) {
        auto* o = new juce::DynamicObject();
        o->setProperty("storeUrl", juce::String(settings_.storeUrl));
        o->setProperty("channel", juce::String(settings_.channel));
        o->setProperty("fetchedAt", (juce::int64)now_);
        o->setProperty("index", json);
        file.replaceWithText(juce::JSON::toString(juce::var(o)));
    }
    return true;
}

bool Client::loadCachedIndex(Index& out, int64_t& fetchedAt, std::string& error) const {
    const auto file = dataDir_.getChildFile("cache").getChildFile("index.json");
    if (!file.existsAsFile()) { error = "no saved copy of the store's index"; return false; }
    const juce::var doc = juce::JSON::parse(file);
    if (!doc.isObject() || str(doc["storeUrl"]) != settings_.storeUrl || str(doc["channel"]) != settings_.channel) {
        error = "the saved index is from another store or channel";   // the address was changed in the settings
        return false;
    }
    fetchedAt = (int64_t)doc["fetchedAt"];
    return parseIndex(doc["index"], settings_.channel, out, error);
}

bool Client::check(const std::vector<uint8_t>& bytes, const std::string& slug, const std::string& version, const juce::var* signatureDoc,
                   InstalledModule& out, std::string& error) const {
    Package pkg;
    if (!readPackage(bytes.data(), bytes.size(), pkg, error)) return false;
    Digest digest;
    if (!contentDigest(pkg.entries, digest, error)) return false;
    Context c;
    c.kind = "module";
    c.id = signedId(slug);
    c.version = version;
    c.roots = roots_;
    c.now = now_;
    c.revocations = revocations_ ? &*revocations_ : nullptr;
    const juce::var* doc = signatureDoc && !signatureDoc->isVoid() ? signatureDoc : (pkg.hasSignature ? &pkg.signature : nullptr);
    out.result = verify(digest, doc, c);
    out.allowed = decide(out.result, "module", settings_.allowUnsigned, out.why);
    out.slug = slug;
    out.version = version;
    out.types = typesOf(pkg);
    return true;
}

bool Client::install(const std::string& slug, InstalledModule& out, std::string& error) const {
    Index index;
    if (!fetchIndex(index, error)) return false;
    const IndexModule* m = index.find(slug);
    if (!m) { error = "the store has no module " + slug; return false; }
    juce::var entry;
    if (!fetchJson(url(m->entry), entry, error)) return false;
    juce::var file;
    if (auto* files = entry["files"].getArray())
        for (const auto& f : *files)
            if (str(f["platform"]) == "any") file = f;
    if (!file.isObject()) { error = "the entry of " + slug + " lists no package"; return false; }
    const std::string version = str(entry["version"]), path = str(file["path"]);
    if (!safeSlug(slug)) { error = "a bad module name: " + slug; return false; }
    if (!safeVersion(version)) { error = "a bad version in the entry of " + slug; return false; }
    if (path.empty() || path.find('/') != std::string::npos || path.find("..") != std::string::npos) { error = "a bad file name in the entry"; return false; }
    const std::string dir = m->entry.substr(0, m->entry.rfind('/') + 1);
    std::vector<uint8_t> bytes;
    if (!fetchBytes(url(dir + path), bytes, error)) return false;
    const Digest sha = sha256(bytes.data(), bytes.size());
    if (toHex(sha.data(), 32) != str(file["sha256"])) { error = "the download is not the file the store lists"; return false; }
    if (!check(bytes, slug, version, &file["signature"], out, error)) return false;
    out.source = "registry";
    if (!out.allowed) { error = slug + " " + version + " is not installed: " + out.why; return false; }

    const juce::File finalDir = modulesFolder("registry").getChildFile(juce::String(slug)).getChildFile(juce::String(version));
    if (!isInside(finalDir, modulesFolder("registry"))) { error = "a bad install path for " + slug; return false; }
    const juce::File temp = dataDir_.getChildFile("tmp").getChildFile(juce::String(slug) + "-" + juce::String(version) + "-" + juce::String::toHexString(juce::Random::getSystemRandom().nextInt()));
    if (!temp.createDirectory().wasOk()) { error = "cannot write to " + temp.getFullPathName().toStdString(); return false; }
    const juce::File tempFile = temp.getChildFile(juce::String(slug) + "-" + juce::String(version) + ".bleepmod");
    if (!tempFile.replaceWithData(bytes.data(), bytes.size())) { temp.deleteRecursively(); error = "cannot write the package"; return false; }
    if (file["signature"].isObject() && !tempFile.withFileExtension("sig.json").replaceWithText(juce::JSON::toString(file["signature"]))) {
        temp.deleteRecursively();
        error = "cannot write the signature";
        return false;
    }
    finalDir.deleteRecursively();  // the same version again (a repair)
    finalDir.getParentDirectory().createDirectory();
    if (!temp.moveFileTo(finalDir)) { temp.deleteRecursively(); error = "cannot move the package into place"; return false; }
    out.file = finalDir.getChildFile(tempFile.getFileName());
    // the newest version is the only one that stays
    for (const auto& old : finalDir.getParentDirectory().findChildFiles(juce::File::findDirectories, false))
        if (old != finalDir && versionKey(old.getFileName().toStdString()) < versionKey(version)) old.deleteRecursively();
    return true;
}

bool Client::installPlugin(const std::string& slug, const juce::File& folder, std::vector<std::string>& names, std::string& error) const {
    Index index;
    if (!fetchIndex(index, error)) return false;
    const IndexPlugin* p = nullptr;
    for (const auto& x : index.plugins) if (x.slug == slug) p = &x;
    if (!p) { error = "the store has no plugin " + slug; return false; }
    juce::var entry;
    if (!fetchJson(url(p->entry), entry, error)) return false;
    const std::string platform = platformId();
    juce::var file;
    if (auto* files = entry["files"].getArray())
        for (const auto& f : *files)
            if (str(f["platform"]) == platform) file = f;
    if (!file.isObject()) { error = slug + " has no build for " + platform; return false; }
    const std::string version = str(entry["version"]), path = str(file["path"]);
    if (!safeSlug(slug)) { error = "a bad module name: " + slug; return false; }
    if (!safeVersion(version)) { error = "a bad version in the entry of " + slug; return false; }
    if (path.empty() || path.find('/') != std::string::npos || path.find("..") != std::string::npos) { error = "a bad file name in the entry"; return false; }
    std::vector<uint8_t> bytes;
    if (!fetchBytes(url(p->entry.substr(0, p->entry.rfind('/') + 1) + path), bytes, error)) return false;
    const Digest sha = sha256(bytes.data(), bytes.size());
    if (toHex(sha.data(), 32) != str(file["sha256"])) { error = "the download is not the file the store lists"; return false; }
    Digest digest;
    if (!contentDigest(singleFile(path, sha), digest, error)) return false;
    Context c;
    c.kind = "plugin";
    c.id = signedId(slug);
    c.version = version;
    c.platform = platform;
    c.roots = roots_;
    c.now = now_;
    c.revocations = revocations_ ? &*revocations_ : nullptr;
    const juce::var signature = file["signature"];
    const Result result = verify(digest, signature.isObject() ? &signature : nullptr, c);
    std::string why;
    if (!decide(result, "plugin", settings_.allowUnsigned, why)) { error = slug + " " + version + " is not installed: " + why; return false; }

    const juce::File temp = dataDir_.getChildFile("tmp").getChildFile(juce::String(slug) + "-" + juce::String::toHexString(juce::Random::getSystemRandom().nextInt()));
    if (!temp.createDirectory().wasOk()) { error = "cannot write to " + temp.getFullPathName().toStdString(); return false; }
    juce::MemoryInputStream in(bytes.data(), bytes.size(), false);
    juce::ZipFile zip(in);
    if (!zip.uncompressTo(temp, true).wasOk()) { temp.deleteRecursively(); error = "cannot unpack " + path; return false; }
    const auto bundles = temp.findChildFiles(juce::File::findFilesAndDirectories, false, "*.vst3");
    if (bundles.isEmpty()) { temp.deleteRecursively(); error = path + " holds no .vst3"; return false; }
#if JUCE_MAC || JUCE_LINUX
    for (const auto& b : bundles)  // a zip may not carry the execute bit
        for (const auto& f : b.getChildFile(JUCE_MAC ? "Contents/MacOS" : "Contents").findChildFiles(juce::File::findFiles, true))
            f.setExecutePermission(true);
#endif
    folder.createDirectory();
    for (const auto& b : bundles) {
        const juce::File dest = folder.getChildFile(b.getFileName());
        if (dest.exists() && !dest.deleteRecursively()) { temp.deleteRecursively(); error = "cannot replace " + dest.getFullPathName().toStdString(); return false; }
        if (!b.moveFileTo(dest)) { temp.deleteRecursively(); error = "cannot move " + b.getFileName().toStdString() + " into " + folder.getFullPathName().toStdString(); return false; }
        names.push_back(dest.getFileName().toStdString());
    }
    temp.deleteRecursively();
    return true;
}

bool Client::remove(const std::string& slug, std::string& error) const {
    const juce::File dir = modulesFolder("registry").getChildFile(juce::String(slug));
    if (!safeSlug(slug) || !isInside(dir, modulesFolder("registry"))) { error = "not a module name: " + slug; return false; }
    if (!dir.isDirectory()) { error = slug + " is not installed"; return false; }
    if (!dir.deleteRecursively()) { error = "cannot remove " + slug; return false; }
    return true;
}

namespace {

/// What installed() worked out about a package, kept so the Store view does not read and verify every module again on each look.
/// Process-wide: a Client is made anew for every request. A hit needs the same file (size, modification times of it and its
/// signature sidecar) and the same trust (roots, Settings → Security). An entry is served at any age; when cacheStale() says one
/// is old, a worker thread repeats the checks with installed(true), so a signature that has expired is noticed without anyone
/// waiting. contentOf() never uses the cache: loading a module is always checked in full.
struct CachedCheck {
    InstalledModule module;
    juce::Time at;
};
std::mutex cacheMutex;
std::map<std::string, CachedCheck> cache;
constexpr int kCacheMillis = 5 * 60 * 1000;

}  // namespace

bool Client::cacheStale() {
    std::lock_guard<std::mutex> l(cacheMutex);
    for (const auto& [key, c] : cache)
        if ((juce::Time::getCurrentTime() - c.at).inMilliseconds() >= kCacheMillis) return true;
    return false;
}

namespace {

std::string fileStamp(const juce::File& f) {
    return std::to_string(f.getSize()) + "@" + std::to_string(f.getLastModificationTime().toMilliseconds());
}

}  // namespace

std::vector<InstalledModule> Client::installed(bool recheck) const {
    std::vector<InstalledModule> out;
    std::string trust = std::string(settings_.allowUnsigned.module ? "m" : "-") + (settings_.allowUnsigned.plugin ? "p" : "-");
    trust += "|crl" + std::to_string(revocationSerial());  // a new revocation list makes every earlier verdict stale
    for (const auto& r : roots_) {
        uint64_t h = 1469598103934665603ull;
        for (uint8_t b : r) h = (h ^ b) * 1099511628211ull;
        trust += "|" + std::to_string(h);
    }
    std::set<std::string> seen;
    auto consider = [&](const juce::File& file, const std::string& slug, const std::string& version, const std::string& source) {
        const std::string key = file.getFullPathName().toStdString() + "|" + slug + "|" + version + "|" + fileStamp(file) + "|" +
                                fileStamp(file.withFileExtension("sig.json")) + "|" + trust;
        seen.insert(key);
        {
            std::lock_guard<std::mutex> l(cacheMutex);
            auto it = cache.find(key);
            if (!recheck && it != cache.end()) {
                InstalledModule hit = it->second.module;
                hit.source = source;
                hit.file = file;
                out.push_back(std::move(hit));
                return;
            }
        }
        std::vector<uint8_t> bytes;
        InstalledModule m;
        std::string error;
        const juce::var sig = sidecarSignature(file);
        if (!readFile(file, bytes) || !check(bytes, slug, version, &sig, m, error)) {
            m.slug = slug;
            m.version = version;
            m.result.status = "invalid";
            m.result.reason = error.empty() ? "unreadable" : error;
            m.allowed = false;
            m.why = "invalid: " + m.result.reason;
        }
        m.source = source;
        m.file = file;
        {
            std::lock_guard<std::mutex> l(cacheMutex);
            cache[key] = {m, juce::Time::getCurrentTime()};
        }
        out.push_back(std::move(m));
    };
    // from the store: <slug>/<version>/<slug>-<version>.bleepmod, the newest version of each
    for (const auto& slugDir : modulesFolder("registry").findChildFiles(juce::File::findDirectories, false)) {
        juce::File best;
        long long bestKey = -1;
        for (const auto& v : slugDir.findChildFiles(juce::File::findDirectories, false))
            if (versionKey(v.getFileName().toStdString()) > bestKey) { bestKey = versionKey(v.getFileName().toStdString()); best = v; }
        if (!best.isDirectory()) continue;
        const std::string slug = slugDir.getFileName().toStdString(), version = best.getFileName().toStdString();
        consider(best.getChildFile(juce::String(slug) + "-" + juce::String(version) + ".bleepmod"), slug, version, "registry");
    }
    // copied by hand: <slug>-<version>.bleepmod (a file that does not say its version cannot be checked against its signature)
    for (const auto& f : modulesFolder("local").findChildFiles(juce::File::findFiles, false, "*.bleepmod")) {
        const std::string name = f.getFileNameWithoutExtension().toStdString();
        const auto dash = name.rfind('-');
        const std::string slug = dash == std::string::npos ? name : name.substr(0, dash), version = dash == std::string::npos ? "" : name.substr(dash + 1);
        consider(f, slug, versionKey(version) >= 0 ? version : "0.0.0", "local");
    }
    {   // forget what is no longer installed
        std::lock_guard<std::mutex> l(cacheMutex);
        for (auto it = cache.begin(); it != cache.end();) it = seen.count(it->first) ? std::next(it) : cache.erase(it);
    }
    return out;
}

bool Client::filesOf(const InstalledModule& module, Package& pkg, std::string& error) const {
    std::vector<uint8_t> bytes;
    if (!readFile(module.file, bytes)) { error = "cannot read " + module.file.getFullPathName().toStdString(); return false; }
    InstalledModule again;
    const juce::var sig = sidecarSignature(module.file);
    if (!check(bytes, module.slug, module.version, &sig, again, error)) return false;
    if (!again.allowed) { error = again.why; return false; }
    return readPackage(bytes.data(), bytes.size(), pkg, error);
}

bool Client::contentOf(const InstalledModule& module, std::vector<uint8_t>& wasm, std::string& spec, std::string& error) const {
    Package pkg;
    if (!filesOf(module, pkg, error)) return false;
    auto it = pkg.files.find("module.wasm");
    if (it == pkg.files.end()) { error = "the package has no module.wasm"; return false; }
    wasm = it->second;
    auto sj = pkg.files.find("spec.json");
    spec = sj == pkg.files.end() ? std::string() : std::string(sj->second.begin(), sj->second.end());
    return true;
}

}  // namespace bleep::store
