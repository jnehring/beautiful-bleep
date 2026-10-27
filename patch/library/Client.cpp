// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include <cctype>
#include <cstdlib>
#include "Account.h"
#include "Client.h"
#include "../common/SafeJson.h"

#include <algorithm>
#include <map>
#include <mutex>
#include <set>
#include <ctime>
#include <cstring>

namespace bleep::library {
namespace {

constexpr size_t kMaxJsonBytes = size_t(16) << 20;      // an index, an entry, a list
constexpr size_t kMaxPackageBytes = size_t(1024) << 20;  // a module or a plugin

bool fetchBytes(const juce::String& address, std::vector<uint8_t>& out, std::string& error, size_t maxBytes = kMaxPackageBytes, const std::string& bearer = {}) {
    int status = 0;
    const juce::URL url(address);
    // The dev channel is for signed-in accounts: the personal token goes in a header.
    const juce::String headers = bearer.empty() ? juce::String() : "Authorization: Bearer " + juce::String(bearer);
    auto stream = url.createInputStream(juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
                                            .withExtraHeaders(headers).withConnectionTimeoutMs(15000).withStatusCode(&status).withNumRedirectsToFollow(5));
    if (!stream) { error = "cannot reach " + address.toStdString(); return false; }
    if ((status == 401 || status == 403) && address.contains("/api/registry/dev/")) {
        error = "the dev channel needs a signed-in account with dev access (sign in under Account; ask for access)";
        return false;
    }
    if (status >= 400) { error = address.toStdString() + ": " + std::to_string(status); return false; }
    const auto announced = stream->getTotalLength();
    if (announced > 0 && (uint64_t)announced > maxBytes) { error = address.toStdString() + " is too large"; return false; }
    juce::MemoryBlock block;
    stream->readIntoMemoryBlock(block, (juce::int64)maxBytes + 1);  // one byte more than allowed shows an endless answer
    if (block.getSize() > maxBytes) { error = address.toStdString() + " is too large"; return false; }
    out.assign((const uint8_t*)block.getData(), (const uint8_t*)block.getData() + block.getSize());
    return true;
}

bool fetchJson(const juce::String& address, juce::var& out, std::string& error, const std::string& bearer = {}) {
    std::vector<uint8_t> bytes;
    if (!fetchBytes(address, bytes, error, kMaxJsonBytes, bearer)) return false;
    out = bleep::safejson::parse(juce::String::fromUTF8(reinterpret_cast<const char*>(bytes.data()), (int)bytes.size()));
    if (out.isVoid()) { error = address.toStdString() + " is not JSON"; return false; }
    return true;
}

std::string str(const juce::var& v) { return v.isString() ? v.toString().toStdString() : std::string(); }

/// A version as a comparable key. "1.2.3" is a release; "1.2.3-dev.202610271432" a development build, made at that time (YYYYMMDDHHMM);
/// a plain "1.2.3-dev" (bleep package on this machine) is one without a build time. A development build ranks above the release of
/// the same number, and development builds among themselves by their build time.
struct VersionKey {
    long long base = -1;    ///< major.minor.patch, then 1 for a development build; -1: not a version
    long long build = 0;    ///< the build time of a development build
    bool valid() const { return base >= 0; }
    bool operator<(const VersionKey& o) const { return base != o.base ? base < o.base : build < o.build; }
};

VersionKey versionKey(const std::string& v) {
    int a = 0, b = 0, c = 0, used = 0;
    if (std::sscanf(v.c_str(), "%d.%d.%d%n", &a, &b, &c, &used) != 3 || a < 0 || b < 0 || c < 0) return {};
    const std::string rest = v.substr((size_t)used);
    long long build = 0;
    bool dev = false;
    if (rest == "-dev") dev = true;
    else if (rest.size() == 17 && rest.compare(0, 5, "-dev.") == 0 && std::all_of(rest.begin() + 5, rest.end(), [](unsigned char ch) { return std::isdigit(ch); })) {
        dev = true;
        build = std::atoll(rest.c_str() + 5);
    } else if (!rest.empty()) return {};
    return { ((((long long)a << 40) | ((long long)b << 20) | c) << 1) | (dev ? 1 : 0), build };
}

/// A slug or version becomes a folder name: no separators, no "..", nothing that could leave the modules folder.
bool safeSlug(const std::string& s) {
    if (s.empty() || s.size() > 100 || !std::isalnum((unsigned char)s[0]) || s.find("..") != std::string::npos) return false;
    for (const char c : s)
        if (!(std::islower((unsigned char)c) || std::isdigit((unsigned char)c) || c == '.' || c == '-')) return false;
    return true;
}

bool safeVersion(const std::string& v) {  // exactly "1.2.3", or "1.2.3-dev.202610271432"
    const std::string number = v.substr(0, v.find("-dev."));
    if (number.size() != v.size() && (v.size() != number.size() + 17 || !versionKey(v).valid())) return false;
    int dots = 0;
    if (number.empty() || number.size() > 32 || number.front() == '.' || number.back() == '.') return false;
    for (const char c : number) {
        if (c == '.') { if (++dots > 2) return false; }
        else if (!std::isdigit((unsigned char)c)) return false;
    }
    return dots == 2 && number.find("..") == std::string::npos;
}

bool isInside(const juce::File& child, const juce::File& root) { return child != root && child.isAChildOf(root); }

std::vector<std::string> typesOf(const Package& p) {
    std::vector<std::string> out;
    auto it = p.files.find("module.json");
    if (it == p.files.end()) return out;
    const juce::var meta = bleep::safejson::parse(juce::String::fromUTF8(reinterpret_cast<const char*>(it->second.data()), (int)it->second.size()));
    if (auto* a = meta["types"].getArray())
        for (const auto& t : *a) out.push_back(str(t));
    return out;
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

bool libraryUrlAllowed(const std::string& url, std::string& why) {
    const juce::String u = juce::String(url).trim();
    if (u.startsWithIgnoreCase("https://") || u.startsWithIgnoreCase("file:")) return true;
    if (u.startsWithIgnoreCase("http://")) {
        juce::String rest = u.substring(7);
        const int end = rest.indexOfAnyOf("/?#");
        const juce::String authority = (end < 0 ? rest : rest.substring(0, end)).toLowerCase();
        juce::String host = authority;
        if (authority.containsChar('@')) { why = "the library address must not contain a user name"; return false; }
        if (authority.startsWithChar('[')) host = authority.upToFirstOccurrenceOf("]", true, false);
        else host = authority.upToFirstOccurrenceOf(":", false, false);
        if (host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host.endsWith(".localhost")) return true;
        why = "the library address must use https (plain http is only accepted for localhost): the sign-in would travel unprotected";
        return false;
    }
    why = "the library address must start with https://";
    return false;
}

Settings Settings::load(const juce::File& dataDir) {
    Settings s;
    const juce::var v = bleep::safejson::parse(dataDir.getChildFile("settings.json"));
    if (!v.isObject()) return s;
    if (v["libraryUrl"].isString()) s.libraryUrl = str(v["libraryUrl"]);
    if (v["channel"].isString()) s.channel = str(v["channel"]);
    s.firstRunDone = v["firstRunDone"].isBool() && (bool)v["firstRunDone"];
    if (v["updateCheck"].isBool()) s.updateCheck = (bool)v["updateCheck"];
    if (v["autoUpdate"].isBool()) s.autoUpdate = (bool)v["autoUpdate"];
    return s;
}

bool Settings::save(const juce::File& dataDir) const {
    auto* o = new juce::DynamicObject();
    o->setProperty("libraryUrl", juce::String(libraryUrl));
    o->setProperty("channel", juce::String(channel));
    o->setProperty("firstRunDone", firstRunDone);
    o->setProperty("updateCheck", updateCheck);
    o->setProperty("autoUpdate", autoUpdate);
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

Client::Client(Settings settings, juce::File dataDir, int64_t now)
    : settings_(std::move(settings)), dataDir_(std::move(dataDir)), now_(now ? now : (int64_t)std::time(nullptr)) {}

juce::String Client::url(const std::string& path) const {
    juce::String base(settings_.libraryUrl);
    if (!base.endsWithChar('/')) base << '/';
    // The dev channel is only served to accounts with dev access, by the library's API (/api/registry/dev/).
    return base + (settings_.channel == "dev" ? "api/registry/dev/v1/" : "registry/v1/") + juce::String(path);
}

std::string Client::bearer() const {
    if (settings_.channel != "dev") return {};
    std::string account = settings_.libraryUrl;
    while (!account.empty() && account.back() == '/') account.pop_back();
    return makeTokenStore(dataDir_)->load(account);   // the sign-in of the app and the plugins (Account)
}

juce::File Client::modulesFolder(const std::string& source) const { return dataDir_.getChildFile("modules").getChildFile(source); }

namespace {
/// The channel's modules and plugins out of the library's index.json.
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
    else { error = "the library's index has no modules for the channel " + channel; return false; }
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
    const VersionKey x = versionKey(a), y = versionKey(b);
    return x.valid() && y.valid() && y < x;
}

bool Client::fetchIndex(Index& out, std::string& error) const {
    juce::var json;
    if (!fetchJson(url("index.json"), json, error, bearer())) return false;
    if (!parseIndex(json, settings_.channel, out, error)) return false;
    // Keep what was fetched, so the next start (or no network) still knows the library. A failure to write is not the library's fault.
    const auto file = dataDir_.getChildFile("cache").getChildFile("index.json");
    if (file.getParentDirectory().createDirectory().wasOk()) {
        auto* o = new juce::DynamicObject();
        o->setProperty("libraryUrl", juce::String(settings_.libraryUrl));
        o->setProperty("channel", juce::String(settings_.channel));
        o->setProperty("fetchedAt", (juce::int64)now_);
        o->setProperty("index", json);
        file.replaceWithText(juce::JSON::toString(juce::var(o)));
    }
    return true;
}

bool Client::loadCachedIndex(Index& out, int64_t& fetchedAt, std::string& error) const {
    const auto file = dataDir_.getChildFile("cache").getChildFile("index.json");
    if (!file.existsAsFile()) { error = "no saved copy of the library's index"; return false; }
    const juce::var doc = bleep::safejson::parse(file);
    if (!doc.isObject() || str(doc["libraryUrl"]) != settings_.libraryUrl || str(doc["channel"]) != settings_.channel) {
        error = "the saved index is from another library or channel";   // the address was changed in the settings
        return false;
    }
    fetchedAt = (juce::int64)doc["fetchedAt"];   // int64_t is "long" on Linux, juce::var converts to "long long"
    return parseIndex(doc["index"], settings_.channel, out, error);
}

bool Client::check(const std::vector<uint8_t>& bytes, const std::string& slug, const std::string& version, bool uploaded, InstalledModule& out, std::string& error) const {
    Package pkg;
    if (!readPackage(bytes.data(), bytes.size(), pkg, error)) return false;
    out.slug = slug;
    out.version = version;
    out.types = typesOf(pkg);
    out.allowed = true;
    out.why.clear();
    // A module an account uploaded is data and a sandboxed .wasm, no page scripts; the library refuses the rest at upload, and a client checks again.
    std::string extra;
    if (uploaded && !communityFilesOk(pkg, extra)) {
        out.allowed = false;
        out.why = extra;
    }
    return true;
}

bool Client::install(const std::string& slug, InstalledModule& out, std::string& error) const {
    Index index;
    if (!fetchIndex(index, error)) return false;
    const IndexModule* m = index.find(slug);
    if (!m) { error = "the library has no module " + slug; return false; }
    return installEntry(slug, m->entry, "", true, out, error);
}

bool Client::installVersion(const std::string& slug, const std::string& version, InstalledModule& out, std::string& error) const {
    if (!safeSlug(slug)) { error = "a bad module name: " + slug; return false; }
    if (!safeVersion(version)) { error = "a bad version: " + version; return false; }
    // Every published version stays in the library (the index lists only the newest): its entry is at a fixed place.
    return installEntry(slug, "modules/" + slug + "/" + version + "/entry.json", version, false, out, error);
}

bool Client::installEntry(const std::string& slug, const std::string& entryPath, const std::string& expectVersion, bool pruneOlder, InstalledModule& out, std::string& error) const {
    juce::var entry;
    if (!fetchJson(url(entryPath), entry, error, bearer())) return false;
    juce::var file;
    if (auto* files = entry["files"].getArray())
        for (const auto& f : *files)
            if (str(f["platform"]) == "any") file = f;
    if (!file.isObject()) { error = "the entry of " + slug + " lists no package"; return false; }
    const std::string version = str(entry["version"]), path = str(file["path"]);
    if (!safeSlug(slug)) { error = "a bad module name: " + slug; return false; }
    if (!safeVersion(version)) { error = "a bad version in the entry of " + slug; return false; }
    if (!expectVersion.empty() && version != expectVersion) { error = "the library's entry for " + slug + " " + expectVersion + " is for version " + version; return false; }
    if (path.empty() || path.find('/') != std::string::npos || path.find("..") != std::string::npos) { error = "a bad file name in the entry"; return false; }
    const std::string dir = entryPath.substr(0, entryPath.rfind('/') + 1);
    std::vector<uint8_t> bytes;
    if (!fetchBytes(url(dir + path), bytes, error, kMaxPackageBytes, bearer())) return false;
    const Digest sha = sha256(bytes.data(), bytes.size());
    if (toHex(sha.data(), 32) != str(file["sha256"])) { error = "the download is not the file the library lists"; return false; }
    if (!check(bytes, slug, version, file["uploaded"].isBool() && (bool)file["uploaded"], out, error)) return false;
    out.source = "registry";
    if (!out.allowed) { error = slug + " " + version + " is not installed: " + out.why; return false; }

    const juce::File finalDir = modulesFolder("registry").getChildFile(juce::String(slug)).getChildFile(juce::String(version));
    if (!isInside(finalDir, modulesFolder("registry"))) { error = "a bad install path for " + slug; return false; }
    const juce::File temp = dataDir_.getChildFile("tmp").getChildFile(juce::String(slug) + "-" + juce::String(version) + "-" + juce::String::toHexString(juce::Random::getSystemRandom().nextInt()));
    if (!temp.createDirectory().wasOk()) { error = "cannot write to " + temp.getFullPathName().toStdString(); return false; }
    const juce::File tempFile = temp.getChildFile(juce::String(slug) + "-" + juce::String(version) + ".bleepmod");
    if (!tempFile.replaceWithData(bytes.data(), bytes.size())) { temp.deleteRecursively(); error = "cannot write the package"; return false; }
    finalDir.deleteRecursively();  // the same version again (a repair)
    finalDir.getParentDirectory().createDirectory();
    if (!temp.moveFileTo(finalDir)) { temp.deleteRecursively(); error = "cannot move the package into place"; return false; }
    out.file = finalDir.getChildFile(tempFile.getFileName());
    // the newest version is the only one that stays (an older one fetched for a board that pins it stays until a newer one is installed)
    if (pruneOlder)
        for (const auto& old : finalDir.getParentDirectory().findChildFiles(juce::File::findDirectories, false))
            if (old != finalDir && versionKey(old.getFileName().toStdString()) < versionKey(version)) old.deleteRecursively();
    return true;
}

bool Client::installPlugin(const std::string& slug, const juce::File& folder, std::vector<std::string>& names, std::string& error) const {
    Index index;
    if (!fetchIndex(index, error)) return false;
    const IndexPlugin* p = nullptr;
    for (const auto& x : index.plugins) if (x.slug == slug) p = &x;
    if (!p) { error = "the library has no plugin " + slug; return false; }
    juce::var entry;
    if (!fetchJson(url(p->entry), entry, error, bearer())) return false;
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
    if (!fetchBytes(url(p->entry.substr(0, p->entry.rfind('/') + 1) + path), bytes, error, kMaxPackageBytes, bearer())) return false;
    const Digest sha = sha256(bytes.data(), bytes.size());
    if (toHex(sha.data(), 32) != str(file["sha256"])) { error = "the download is not the file the library lists"; return false; }
    const juce::File temp = dataDir_.getChildFile("tmp").getChildFile(juce::String(slug) + "-" + juce::String::toHexString(juce::Random::getSystemRandom().nextInt()));
    if (!temp.createDirectory().wasOk()) { error = "cannot write to " + temp.getFullPathName().toStdString(); return false; }
    juce::MemoryInputStream in(bytes.data(), bytes.size(), false);
    juce::ZipFile zip(in);
    if (!zip.uncompressTo(temp, true).wasOk()) { temp.deleteRecursively(); error = "cannot unpack " + path; return false; }
    const auto bundles = temp.findChildFiles(juce::File::findFilesAndDirectories, false, "*.vst3");
    if (bundles.isEmpty()) { temp.deleteRecursively(); error = path + " holds no .vst3"; return false; }
#if JUCE_MAC || JUCE_LINUX
#if JUCE_MAC
    const char* binaries = "Contents/MacOS";
#else
    const char* binaries = "Contents";
#endif
    for (const auto& b : bundles)  // a zip may not carry the execute bit
        for (const auto& f : b.getChildFile(binaries).findChildFiles(juce::File::findFiles, true))
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

/// What installed() worked out about a package, kept so the Library view does not read and check every module again on each look.
/// Process-wide: a Client is made anew for every request. A hit needs the same file (size, modification time). An entry is served at
/// any age; when cacheStale() says one is old, a worker thread repeats the checks with installed(true). contentOf() never uses the
/// cache: loading a module is always checked in full.
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

std::vector<InstalledModule> Client::installed(bool recheck, bool allVersions) const {
    std::vector<InstalledModule> out;
    std::set<std::string> seen;
    auto consider = [&](const juce::File& file, const std::string& slug, const std::string& version, const std::string& source) {
        const std::string key = file.getFullPathName().toStdString() + "|" + slug + "|" + version + "|" + fileStamp(file);
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
        if (!readFile(file, bytes) || !check(bytes, slug, version, false, m, error)) {
            m.slug = slug;
            m.version = version;
            m.allowed = false;
            m.why = "invalid: " + (error.empty() ? std::string("unreadable") : error);
        }
        m.source = source;
        m.file = file;
        {
            std::lock_guard<std::mutex> l(cacheMutex);
            cache[key] = {m, juce::Time::getCurrentTime()};
        }
        out.push_back(std::move(m));
    };
    // from the library: <slug>/<version>/<slug>-<version>.bleepmod, the newest version of each (every version with `allVersions`:
    // an older one is there because a board pins it)
    for (const auto& slugDir : modulesFolder("registry").findChildFiles(juce::File::findDirectories, false)) {
        const std::string slug = slugDir.getFileName().toStdString();
        juce::File best;
        VersionKey bestKey;
        for (const auto& v : slugDir.findChildFiles(juce::File::findDirectories, false)) {
            const std::string version = v.getFileName().toStdString();
            if (allVersions && versionKey(version).valid()) consider(v.getChildFile(juce::String(slug) + "-" + juce::String(version) + ".bleepmod"), slug, version, "registry");
            else if (bestKey < versionKey(version)) { bestKey = versionKey(version); best = v; }
        }
        if (!best.isDirectory()) continue;
        const std::string version = best.getFileName().toStdString();
        consider(best.getChildFile(juce::String(slug) + "-" + juce::String(version) + ".bleepmod"), slug, version, "registry");
    }
    // copied by hand: <slug>-<version>.bleepmod (a file that does not say its version is taken as 0.0.0)
    for (const auto& f : modulesFolder("local").findChildFiles(juce::File::findFiles, false, "*.bleepmod")) {
        std::string name = f.getFileNameWithoutExtension().toStdString();
        std::string suffix;   // "-dev", or "-dev.202610271432": a development build
        const auto stamp = name.rfind("-dev.");
        if (stamp != std::string::npos && name.size() - stamp == 17) { suffix = name.substr(stamp); name.resize(stamp); }
        else if (name.size() > 4 && name.compare(name.size() - 4, 4, "-dev") == 0) { suffix = "-dev"; name.resize(name.size() - 4); }
        const auto dash = name.rfind('-');
        const std::string slug = dash == std::string::npos ? name : name.substr(0, dash), version = dash == std::string::npos ? "" : name.substr(dash + 1) + suffix;
        consider(f, slug, versionKey(version).valid() ? version : "0.0.0", "local");
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
    if (!check(bytes, module.slug, module.version, false, again, error)) return false;
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

}  // namespace bleep::library
