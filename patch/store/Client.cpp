// SPDX-License-Identifier: MIT
#include <cstdlib>
#include "Client.h"

#include <algorithm>
#include <ctime>
#include <cstring>

namespace bleep::store {
namespace {

bool fetchBytes(const juce::String& address, std::vector<uint8_t>& out, std::string& error) {
    int status = 0;
    const juce::URL url(address);
    auto stream = url.createInputStream(juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
                                            .withConnectionTimeoutMs(15000).withStatusCode(&status).withNumRedirectsToFollow(5));
    if (!stream) { error = "cannot reach " + address.toStdString(); return false; }
    if (status >= 400) { error = address.toStdString() + ": " + std::to_string(status); return false; }
    juce::MemoryBlock block;
    stream->readIntoMemoryBlock(block);
    out.assign((const uint8_t*)block.getData(), (const uint8_t*)block.getData() + block.getSize());
    return true;
}

bool fetchJson(const juce::String& address, juce::var& out, std::string& error) {
    std::vector<uint8_t> bytes;
    if (!fetchBytes(address, bytes, error)) return false;
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
      now_(now ? now : (int64_t)std::time(nullptr)) {}

juce::String Client::url(const std::string& path) const {
    juce::String base(settings_.storeUrl);
    if (!base.endsWithChar('/')) base << '/';
    return base + "registry/v1/" + juce::String(path);
}

juce::File Client::modulesFolder(const std::string& source) const { return dataDir_.getChildFile("modules").getChildFile(source); }

bool Client::fetchIndex(Index& out, std::string& error) const {
    juce::var json;
    if (!fetchJson(url("index.json"), json, error)) return false;
    out = Index{};
    const juce::var modules = json["channels"][juce::Identifier(juce::String(settings_.channel))]["modules"];
    if (auto* o = modules.getDynamicObject())
        for (const auto& p : o->getProperties()) {
            IndexModule m;
            m.slug = p.name.toString().toStdString();
            m.version = str(p.value["version"]);
            m.entry = str(p.value["entry"]);
            if (auto* t = p.value["types"].getArray())
                for (const auto& x : *t) m.types.push_back(str(x));
            out.modules.push_back(std::move(m));
        }
    else { error = "the store's index has no modules for the channel " + settings_.channel; return false; }
    return true;
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

bool Client::remove(const std::string& slug, std::string& error) const {
    const juce::File dir = modulesFolder("registry").getChildFile(juce::String(slug));
    if (!dir.isDirectory()) { error = slug + " is not installed"; return false; }
    if (!dir.deleteRecursively()) { error = "cannot remove " + slug; return false; }
    return true;
}

std::vector<InstalledModule> Client::installed() const {
    std::vector<InstalledModule> out;
    auto consider = [&](const juce::File& file, const std::string& slug, const std::string& version, const std::string& source) {
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
    return out;
}

bool Client::contentOf(const InstalledModule& module, std::vector<uint8_t>& wasm, std::string& spec, std::string& error) const {
    std::vector<uint8_t> bytes;
    if (!readFile(module.file, bytes)) { error = "cannot read " + module.file.getFullPathName().toStdString(); return false; }
    InstalledModule again;
    const juce::var sig = sidecarSignature(module.file);
    if (!check(bytes, module.slug, module.version, &sig, again, error)) return false;
    if (!again.allowed) { error = again.why; return false; }
    Package pkg;
    if (!readPackage(bytes.data(), bytes.size(), pkg, error)) return false;
    auto it = pkg.files.find("module.wasm");
    if (it == pkg.files.end()) { error = "the package has no module.wasm"; return false; }
    wasm = it->second;
    auto sj = pkg.files.find("spec.json");
    spec = sj == pkg.files.end() ? std::string() : std::string(sj->second.begin(), sj->second.end());
    return true;
}

}  // namespace bleep::store
