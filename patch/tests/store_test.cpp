// SPDX-License-Identifier: MIT
//
// The store's checks in C++ (patch/store, developers/reference/signing.md): every package in patch/tests/store-fixtures must get the
// verdict the Python reference gave it (scripts/release/signing.py fixture), and the pieces underneath (content hash,
// canonical JSON) must give Python's exact bytes. patch/web/test/store-client-test.mjs runs the same cases in JavaScript.
#include "common/SafeJson.h"
#include "store/Account.h"
#include "store/Client.h"
#include "store/Verify.h"

#include <cstdio>
#include <cstring>
#if !JUCE_WINDOWS
#include <sys/stat.h>
#endif

using namespace bleep::store;

namespace {
int failures = 0, checks = 0;
#define CHECK(cond, ...)                                       \
    do {                                                       \
        ++checks;                                              \
        if (!(cond)) {                                         \
            std::printf("  FAIL %s:%d: ", __FILE__, __LINE__); \
            std::printf(__VA_ARGS__);                          \
            std::printf("\n");                                 \
            ++failures;                                        \
        }                                                      \
    } while (0)

std::vector<uint8_t> readFile(const juce::File& f) {
    juce::MemoryBlock block;
    f.loadFileAsData(block);
    return std::vector<uint8_t>((const uint8_t*)block.getData(), (const uint8_t*)block.getData() + block.getSize());
}

/// A one-entry zip whose directory claims `usize` bytes for `csize` stored bytes (method 8 = deflate, 0 = stored).
std::vector<uint8_t> craftedZip(uint16_t method, uint32_t csize, uint32_t usize, size_t realBytes) {
    std::vector<uint8_t> z;
    auto p16 = [&](uint32_t v) { z.push_back(v & 255); z.push_back((v >> 8) & 255); };
    auto p32 = [&](uint32_t v) { p16(v & 0xffff); p16(v >> 16); };
    const std::string name = "module.wasm";
    p32(0x04034b50); p16(20); p16(0); p16(method); p16(0); p16(0); p32(0); p32(csize); p32(usize); p16((uint32_t)name.size()); p16(0);
    z.insert(z.end(), name.begin(), name.end());
    z.insert(z.end(), realBytes, 0);
    const size_t dir = z.size();
    p32(0x02014b50); p16(20); p16(20); p16(0); p16(method); p16(0); p16(0); p32(0); p32(csize); p32(usize); p16((uint32_t)name.size());
    p16(0); p16(0); p16(0); p16(0); p32(0); p32(0);
    z.insert(z.end(), name.begin(), name.end());
    const size_t dirSize = z.size() - dir;
    p32(0x06054b50); p16(0); p16(0); p16(1); p16(1); p32((uint32_t)dirSize); p32((uint32_t)dir); p16(0);
    return z;
}

void testPackageLimits() {  // a zip's own sizes must not make us allocate
    Package pkg;
    std::string error;
    auto zip = craftedZip(8, 10, 0x7FFFFFF0u, 10);
    CHECK(!readPackage(zip.data(), zip.size(), pkg, error) && error.find("too large") != std::string::npos, "a 2 GB claim for 10 bytes is refused: %s", error.c_str());
    zip = craftedZip(8, 10, 100000, 10);
    CHECK(!readPackage(zip.data(), zip.size(), pkg, error), "a ratio deflate cannot reach is refused: %s", error.c_str());
    zip = craftedZip(0, 4, 4, 4);
    CHECK(readPackage(zip.data(), zip.size(), pkg, error) && pkg.files.count("module.wasm") == 1, "a small honest package still reads: %s", error.c_str());
}

void testVector() {  // signing.md section 14: the content hash of three fixed files
    Entries e;
    auto add = [&](const char* path, const std::string& content) { e[path] = FileInfo{sha256((const uint8_t*)content.data(), content.size()), false}; };
    add("module.json", "{\"name\":\"Fuzz\"}\n");
    add("module.wasm", std::string("\0asm\1\0\0\0", 8));
    add("ui/fuzz.js", "// view\n");
    Digest d;
    std::string error;
    CHECK(contentDigest(e, d, error), "%s", error.c_str());
    CHECK(toHex(d.data(), 32) == "39f61d45e3115066a934dabca6cf83c346420153e85d6d58841033d62d0c1f08", "digest %s", toHex(d.data(), 32).c_str());
    e["../x"] = FileInfo{};
    CHECK(!contentDigest(e, d, error), "an unsafe path must be refused");
}

void testCanonical() {
    const juce::var v = juce::JSON::parse(juce::String::fromUTF8(R"({"b":[1,{"z":"é€😀\n\"q\"\\","a":null,"t":true}],"a":0,"ü":"x","_":-3})"));
    const std::string expected = juce::String::fromUTF8(R"EXPECT({"_":-3,"a":0,"b":[1,{"a":null,"t":true,"z":"é€😀\n\"q\"\\"}],"ü":"x"})EXPECT").toStdString();
    CHECK(canonical(v) == expected, "canonical JSON differs:\n   got      %s\n   expected %s", canonical(v).c_str(), expected.c_str());
}

void testCanonicalRefuses() {
    auto obj = [](const juce::var& v) { auto* o = new juce::DynamicObject(); o->setProperty("n", v); return juce::var(o); };
    CHECK(canonical(obj(juce::var(1.5))).empty(), "a fraction is refused, not written as 0");
    CHECK(canonical(obj(juce::var(9.5e15))).empty(), "a number above 9e15 is refused");
    CHECK(canonical(obj(juce::var(std::nan("")))).empty(), "NaN is refused");
    CHECK(canonical(obj(juce::var(3.0))) == "{\"n\":3}", "a whole double still reads as an integer");
    CHECK(canonical(juce::var()) == "null", "null stays null");
    // a signed certificate with a fractional field is invalid, never verified as if the field were 0
    Digest d{};
    juce::var sig = juce::JSON::parse(R"({"format":1,"algorithm":"ed25519","keyId":"x","chain":[{"issuer":"x","tbs":{"n":1.5},"signature":""},{"issuer":"x","tbs":{"n":1},"signature":""}],"signature":""})");
    Context ctx;
    ctx.kind = "module"; ctx.id = "x";
    const Result r = verify(d, &sig, ctx);
    CHECK(r.status == "invalid", "an unusable certificate is invalid: %s", r.status.c_str());
}

void testStoreUrl() {
    std::string why;
    for (const char* ok : {"https://store.example", "http://localhost:8080", "http://127.0.0.1", "http://[::1]:8080/x", "http://a.localhost", "HTTP://LOCALHOST"})
        CHECK(storeUrlAllowed(ok, why), "allowed: %s", ok);
    for (const char* bad : {"http://store.example", "http://localhost.evil.com", "http://localhost@evil.com", "ftp://x", "store.example", ""})
        CHECK(!storeUrlAllowed(bad, why) && !why.empty(), "refused: %s", bad);
}

void testFixtures(const juce::File& dir) {
    const juce::var spec = juce::JSON::parse(dir.getChildFile("cases.json"));
    std::map<std::string, std::vector<std::vector<uint8_t>>> roots;
    roots["main"] = {fromHex(spec["roots"]["main"].toString().toStdString())};
    roots["other"] = {fromHex(spec["roots"]["other"].toString().toStdString())};
    roots["none"] = {};
    auto* cases = spec["cases"].getArray();
    CHECK(cases && cases->size() > 20, "no cases");
    int n = 0;
    for (const auto& c : *cases) {
        const std::string name = c["name"].toString().toStdString(), expect = c["expect"].toString().toStdString();
        const auto bytes = readFile(dir.getChildFile(c["file"].toString()));
        Package pkg;
        Digest digest;
        std::string error, got;
        if (!readPackage(bytes.data(), bytes.size(), pkg, error) || !contentDigest(pkg.entries, digest, error)) got = "refused";
        else {
            Context ctx;
            ctx.kind = c["kind"].toString().toStdString();
            ctx.id = c["id"].toString().toStdString();
            ctx.version = c["version"].toString().toStdString();
            ctx.platform = c["platform"].toString().toStdString();
            ctx.roots = roots[c["roots"].toString().toStdString()];
            ctx.now = (juce::int64)c["now"];
            Revocations crl;
            if (c["crl"].isObject()) { crl = Revocations::fromJson(c["crl"]); ctx.revocations = &crl; }
            const Result r = pkg.hasSignature ? verify(digest, &pkg.signature, ctx) : verify(digest, nullptr, ctx);
            got = r.status;
            if (c["publisher"].isString()) CHECK(r.publisher == c["publisher"].toString().toStdString(), "%s: publisher %s", name.c_str(), r.publisher.c_str());
        }
        CHECK(got == expect, "%s: got %s, expected %s", name.c_str(), got.c_str(), expect.c_str());
        ++n;
    }
    std::printf("  %d fixture packages checked\n", n);
}

void testClient(const juce::File& fixtures) {
    const juce::var spec = juce::JSON::parse(fixtures.getChildFile("cases.json"));
    const std::vector<std::vector<uint8_t>> roots = {fromHex(spec["roots"]["main"].toString().toStdString())};
    const int64_t now = (juce::int64)spec["siteNow"];
    const juce::File data = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("bleep-store-test-" + juce::String::toHexString(juce::Random::getSystemRandom().nextInt()));
    auto client = [&](const char* site, bool allowUnsigned = false) {
        Settings s;
        s.storeUrl = juce::URL(fixtures.getChildFile(site)).toString(false).toStdString();
        s.allowUnsigned.module = allowUnsigned;
        s.allowUnsigned.plugin = allowUnsigned;
        return Client(s, data, roots, now);
    };
    InstalledModule m;
    std::string error;

    {  // plugins: downloaded, checked against the same rules, unpacked into the plugin folder
        const juce::File vst3 = data.getChildFile("vst3");
        std::vector<std::string> names;
        CHECK(client("site").installPlugin("test-plugin", vst3, names, error) && names.size() == 1 && names[0] == "Test Plugin.vst3", "install a plugin: %s", error.c_str());
        CHECK(vst3.getChildFile("Test Plugin.vst3/Contents/Info.plist").existsAsFile(), "the bundle is unpacked");
        names.clear();
        CHECK(!client("site").installPlugin("test-plugin-unsigned", vst3, names, error) && error.find("Allow unsigned plugins") != std::string::npos, "an unsigned plugin is refused: %s", error.c_str());
        CHECK(!vst3.getChildFile("Unsigned Plugin.vst3").exists(), "and not unpacked");
        CHECK(!client("site", true).installPlugin("test-plugin-tampered", vst3, names, error) && error.find("invalid") != std::string::npos, "a tampered plugin is refused even if unsigned is allowed: %s", error.c_str());
        CHECK(!client("site").installPlugin("no-such-plugin", vst3, names, error), "an unknown plugin: %s", error.c_str());
        Index withPlugins;
        CHECK(client("site").fetchIndex(withPlugins, error) && withPlugins.plugins.size() == 3, "the index lists the plugins");
    }
    Index index;
    CHECK(client("site").fetchIndex(index, error), "index: %s", error.c_str());
    CHECK(index.modules.size() == 6 && index.find("good") && index.find("good")->version == "1.2.0", "the index lists six modules");
    CHECK(index.providing("acme/fuzz") && index.providing("acme/fuzz")->slug == "acme.fuzz" && !index.providing("nothing"), "a type finds its module");

    {  // the index is kept on disk, so the store still lists its modules when it can't be reached
        Index saved;
        int64_t at = 0;
        CHECK(client("site").loadCachedIndex(saved, at, error), "a fetched index is saved: %s", error.c_str());
        CHECK(saved.modules.size() == 6 && saved.find("good") && saved.find("good")->version == "1.2.0" && at == now, "the saved copy is the index, with the time");
        Settings gone;   // the same data folder, a store that does not answer
        gone.storeUrl = juce::URL(fixtures.getChildFile("no-such-site")).toString(false).toStdString();
        Client offline(gone, data, roots, now);
        Index none, fromDisk;
        CHECK(!offline.fetchIndex(none, error), "an unreachable store gives no index");
        CHECK(!offline.loadCachedIndex(fromDisk, at, error) && error.find("another store") != std::string::npos,
              "a copy saved for another store address is not used: %s", error.c_str());
        Settings beta;
        beta.storeUrl = client("site").settings().storeUrl;
        beta.channel = "beta";
        CHECK(!Client(beta, data, roots, now).loadCachedIndex(fromDisk, at, error), "nor one saved for another channel");
        CHECK(client("site").loadCachedIndex(fromDisk, at, error) && fromDisk.modules.size() == 6, "a new client of the same store reads it");
        Settings same;
        same.storeUrl = client("site").settings().storeUrl;
        CHECK(!Client(same, data.getChildFile("elsewhere"), roots, now).loadCachedIndex(fromDisk, at, error), "no copy, no index");
    }

    CHECK(client("site").install("good", m, error), "install good: %s", error.c_str());
    CHECK(m.result.status == "signed" && m.result.publisher == "bleep" && m.version == "1.2.0" && m.file.existsAsFile() && m.file.withFileExtension("sig.json").existsAsFile(),
          "good is installed with its signature kept beside it");
    CHECK(client("site").install("acme.fuzz", m, error) && m.result.publisher == "acme", "install acme.fuzz: %s", error.c_str());

    CHECK(!client("site").install("unsigned-one", m, error) && error.find("Allow unsigned modules") != std::string::npos, "unsigned is refused: %s", error.c_str());
    CHECK(client("site", true).install("unsigned-one", m, error) && m.result.status == "unsigned", "unsigned installs when the setting allows it: %s", error.c_str());
    CHECK(!client("site", true).install("bad-download", m, error) && error.find("not the file the store lists") != std::string::npos, "a corrupted download: %s", error.c_str());
    CHECK(!client("site", true).install("tampered", m, error) && error.find("invalid") != std::string::npos, "a package that is not what was signed is refused even if unsigned is allowed: %s", error.c_str());
    CHECK(!client("site", true).install("forged", m, error) && error.find("invalid") != std::string::npos, "a signature by another root: %s", error.c_str());
    CHECK(!client("site").install("missing", m, error) && error.find("no module") != std::string::npos, "an unknown module: %s", error.c_str());
    CHECK(!data.getChildFile("modules/registry/tampered").exists() && !data.getChildFile("modules/registry/forged").exists() && !data.getChildFile("modules/registry/bad-download").exists(),
          "nothing refused was written");

    {
        const auto list = client("site", true).installed();
        std::map<std::string, const InstalledModule*> by;
        for (const auto& i : list) by[i.slug] = &i;
        CHECK(list.size() == 3 && by["good"] && by["good"]->allowed && by["acme.fuzz"] && by["unsigned-one"] && by["unsigned-one"]->result.status == "unsigned", "installed() lists what is there");
        CHECK(!client("site", false).installed().empty() && [&] { for (const auto& i : client("site", false).installed()) if (i.slug == "unsigned-one") return !i.allowed; return false; }(),
              "the same module is not allowed to load once the setting is off again");
        std::vector<uint8_t> wasm;
        std::string spec;
        CHECK(client("site").contentOf(*by["good"], wasm, spec, error) && wasm.size() == 8 && wasm[1] == 'a', "the wasm of an installed module: %s", error.c_str());
        // a package changed on disk is caught when it is loaded
        juce::MemoryBlock block;
        by["good"]->file.loadFileAsData(block);
        ((uint8_t*)block.getData())[block.getSize() / 2] ^= 0x55;
        by["good"]->file.replaceWithData(block.getData(), block.getSize());
        CHECK(!client("site").contentOf(*by["good"], wasm, spec, error), "a package changed on disk is not loaded");

        // the same, but with the size and the modification time put back: installed() answers from its cache and still says
        // "allowed", so what serves the files of a package (ui/, doc/) must not rely on it
        const InstalledModule fuzz = *by["acme.fuzz"];
        Package files;
        CHECK(fuzz.allowed && client("site").filesOf(fuzz, files, error) && files.files.count("module.wasm"), "the files of an installed module: %s", error.c_str());
        const juce::Time stamp = fuzz.file.getLastModificationTime();
        juce::MemoryBlock fuzzBytes;
        fuzz.file.loadFileAsData(fuzzBytes);
        {   // rename ui/view.js to ui/view.jt in the local header and the central directory: same size, other content (the paths are signed)
            auto* data = (uint8_t*)fuzzBytes.getData();
            int renamed = 0;
            for (size_t at = 0; at + 7 <= fuzzBytes.getSize(); ++at)
                if (std::memcmp(data + at, "view.js", 7) == 0) { data[at + 6] = 't'; ++renamed; }
            CHECK(renamed == 2, "the file name is in the zip twice");
        }
        CHECK(fuzz.file.replaceWithData(fuzzBytes.getData(), fuzzBytes.getSize()) && fuzz.file.setLastModificationTime(stamp), "tamper with acme.fuzz");
        bool cachedAllowed = false;
        for (const auto& i : client("site").installed()) if (i.slug == "acme.fuzz") cachedAllowed = i.allowed;
        CHECK(cachedAllowed, "installed() still answers from its cache (the premise of this test)");
        Package tampered;
        CHECK(!client("site").filesOf(fuzz, tampered, error) && tampered.files.empty(), "a tampered package gives no files, whatever the cache says");
        CHECK(!client("site").contentOf(fuzz, wasm, spec, error), "nor wasm");
    }

    // a release later: the newest version stays, the old one goes
    CHECK(client("site2").install("good", m, error) && m.version == "1.3.0", "update: %s", error.c_str());
    CHECK(!data.getChildFile("modules/registry/good/1.2.0").exists() && data.getChildFile("modules/registry/good/1.3.0").isDirectory(), "the old version is removed");
    {
        int goods = 0;
        for (const auto& i : client("site").installed())
            if (i.slug == "good") { ++goods; CHECK(i.version == "1.3.0" && i.allowed && i.types.size() == 2, "installed() shows the new version with its types"); }
        CHECK(goods == 1, "one version of good");
    }

    CHECK(client("site").remove("good", error), "remove: %s", error.c_str());
    CHECK(!client("site").remove("good", error), "removing twice is an error");
    {   // a slug is a folder name, never a path
        const juce::File outside = data.getChildFile("outside");
        outside.createDirectory();
        outside.getChildFile("keep.txt").replaceWithText("x");
        CHECK(!client("site").remove("../../outside", error) && outside.getChildFile("keep.txt").existsAsFile(), "remove refuses a path: %s", error.c_str());
        CHECK(!client("site").remove("..", error) && !client("site").remove("a/b", error) && !client("site").remove("", error), "remove refuses .., a/b and nothing");
        outside.deleteRecursively();
    }

    // copied by hand: the file name says the version the signature is checked for
    const juce::File local = data.getChildFile("modules/local");
    local.createDirectory();
    fixtures.getChildFile("signed.bleepmod").copyFileTo(local.getChildFile("acme.fuzz-1.0.0.bleepmod"));
    fixtures.getChildFile("unsigned.bleepmod").copyFileTo(local.getChildFile("handmade-0.1.0.bleepmod"));
    fixtures.getChildFile("signed.bleepmod").copyFileTo(local.getChildFile("renamed.bleepmod"));  // no version in its name: cannot be checked
    {
        std::map<std::string, InstalledModule> by;
        for (const auto& i : client("site").installed())
            if (i.source == "local") by[i.slug] = i;
        CHECK(by["acme.fuzz"].allowed && by["acme.fuzz"].result.publisher == "acme", "a signed package copied into the local folder loads");
        CHECK(!by["handmade"].allowed, "an unsigned one does not, by default");
        CHECK(!by["renamed"].allowed, "one without its version in the name cannot be checked, so it is not loaded");
    }

    Settings s;
    s.storeUrl = "http://example.test";
    s.allowUnsigned.plugin = true;
    CHECK(s.save(data), "save settings");
    const Settings back = Settings::load(data);
    CHECK(back.storeUrl == s.storeUrl && back.allowUnsigned.plugin && !back.allowUnsigned.module && back.channel == "stable", "settings come back");
    CHECK(Settings::load(data.getChildFile("nowhere")).storeUrl == Settings().storeUrl, "defaults when there is no file");
    data.deleteRecursively();
}

void testRevocations(const juce::File& fixtures) {  // signing.md section 8: the store's signed list reaches the client and is applied offline
    const juce::var spec = juce::JSON::parse(fixtures.getChildFile("cases.json"));
    const std::vector<std::vector<uint8_t>> roots = {fromHex(spec["roots"]["main"].toString().toStdString())};
    const int64_t now = (juce::int64)spec["siteNow"];
    const juce::File tmp = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("bleep-crl-test-" + juce::String::toHexString(juce::Random::getSystemRandom().nextInt()));
    const juce::File data = tmp.getChildFile("data"), served = tmp.getChildFile("site/registry/v1");
    served.createDirectory();
    auto client = [&](const juce::File& site) {
        Settings s;
        s.storeUrl = juce::URL(site).toString(false).toStdString();
        return Client(s, data, roots, now);
    };
    auto serve = [&](const char* list) { fixtures.getChildFile("crl").getChildFile(list).copyFileTo(served.getChildFile("revocations.json")); };
    auto acme = [&] {
        for (const auto& i : client(fixtures.getChildFile("site")).installed()) if (i.slug == "acme.fuzz") return i;
        return InstalledModule{};
    };
    InstalledModule m;
    std::string error;
    bool changed = false;
    CHECK(client(fixtures.getChildFile("site")).install("acme.fuzz", m, error) && acme().allowed, "acme.fuzz installs: %s", error.c_str());
    CHECK(client(fixtures.getChildFile("site")).revocationSerial() == 0, "no list yet");

    Client c = client(tmp.getChildFile("site"));
    CHECK(!c.fetchRevocations(changed, error) && !changed, "no list in the store is not a list");
    serve("forged.json");  // the highest serial, but an issuer of another root
    CHECK(!c.fetchRevocations(changed, error) && !changed && error.find("not trusted") != std::string::npos, "a list of another root is refused: %s", error.c_str());
    CHECK(c.revocationSerial() == 0 && acme().allowed, "and changes nothing");

    serve("revokes-acme.json");
    CHECK(c.fetchRevocations(changed, error) && changed && c.revocationSerial() == 7, "the list is taken: %s", error.c_str());
    const InstalledModule revoked = acme();
    CHECK(!revoked.allowed && revoked.result.status == "revoked", "a module signed with a revoked key is not allowed any more (the check cache does not hide it): %s", revoked.why.c_str());
    std::vector<uint8_t> wasm;
    std::string text;
    Package files;
    CHECK(!c.contentOf(m, wasm, text, error) && !c.filesOf(m, files, error), "and is not loaded or served");
    CHECK(client(fixtures.getChildFile("site")).revocationSerial() == 7 && !acme().allowed, "a new Client applies the kept list without any network");
    CHECK(!client(fixtures.getChildFile("site")).install("acme.fuzz", m, error) && error.find("revoked") != std::string::npos, "and does not install it again: %s", error.c_str());
    CHECK(client(fixtures.getChildFile("site")).install("good", m, error), "other publishers are not affected: %s", error.c_str());

    serve("older-empty.json");  // a mirror holding back an old list
    CHECK(c.fetchRevocations(changed, error) && !changed && c.revocationSerial() == 7 && !acme().allowed, "an older list does not take revocations back");
    // a local rollback: an older, validly signed list copied over the cache is not trusted either
    fixtures.getChildFile("crl").getChildFile("older-empty.json").copyFileTo(data.getChildFile("cache").getChildFile("revocations.json"));
    CHECK(client(fixtures.getChildFile("site")).revocationSerial() == 0, "a list put back over the cache with a lower serial is not loaded");
    serve("revokes-acme.json");
    Client c2 = client(tmp.getChildFile("site"));
    CHECK(c2.fetchRevocations(changed, error) && changed && c2.revocationSerial() == 7 && !acme().allowed, "the real list is taken again: %s", error.c_str());
    tmp.deleteRecursively();
}


/// The sign-in against a pretend store: the device flow, the token in the token store, authenticated calls, revocation.
void testAccount() {
    const juce::File dir = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("bleep-account-test");
    dir.deleteRecursively();
    dir.createDirectory();
    Settings s;
    s.storeUrl = "https://store.example/";
    s.save(dir);

    struct Fake {
        int polls = 0;
        bool revoked = false, down = false;
        std::vector<HttpRequest> seen;
    } fake;
    auto json = [](const char* text) { return std::string(text); };
    Transport transport = [&](const HttpRequest& r) -> HttpResponse {
        fake.seen.push_back(r);
        if (fake.down) return {};
        const std::string path = r.url.substr(std::string("https://store.example").size());
        if (path == "/api/auth/device" && r.method == "POST")
            return {201, json(R"({"device_code":"dev-secret","user_code":"ABCD-EFGH","verification_url":"/device/","expires_in":600,"interval":5})")};
        if (path == "/api/auth/device/token") {
            if (r.body.find("dev-secret") == std::string::npos) return {410, json(R"({"detail":"expired"})")};
            if (++fake.polls < 3) return {200, json(R"({"status":"pending"})")};
            return {200, json(R"({"status":"approved","token":"blu_secret","user":{"display_name":"Ann","email":"a@example.com"}})")};
        }
        if (r.bearer != "blu_secret" || fake.revoked) return {401, json(R"({"detail":"Not signed in"})")};
        if (path == "/api/tokens/self" && r.method == "GET") return {200, json(R"({"display_name":"Ann","email":"a@example.com"})")};
        if (path == "/api/tokens/self" && r.method == "DELETE") { fake.revoked = true; return {204, ""}; }
        if (path == "/api/presets" && r.method == "POST") {
            std::string compact;   // JUCE writes `"title": ""`
            for (char c : r.body) if (c != ' ') compact += c;
            if (compact.find("\"title\":\"\"") != std::string::npos)
                return {422, json(R"({"detail":[{"loc":["body","title"],"msg":"String should have at least 1 character"}]})")};
            return {201, json(R"({"address":"ann/warm-pad","version":1})")};
        }
        return {404, json(R"({"detail":"No such thing"})")};
    };
    Account account(dir, transport, makeFileTokenStore(dir));

    juce::var st = account.status();
    CHECK(!(bool)st["signedIn"] && st["storeUrl"].toString() == "https://store.example", "starts signed out");
    CHECK(account.pollSignIn()["state"].toString() == "none", "no flow, nothing to poll");
    CHECK(account.call("GET", "/api/presets", juce::var())["status"].toString() == "401", "a call without a login is refused here, no network");
    CHECK(fake.seen.empty(), "nothing was sent");

    const juce::var start = account.startSignIn("Bleep Standalone");
    CHECK(start["userCode"].toString() == "ABCD-EFGH" && start["url"].toString() == "https://store.example/device/", "start: %s",
          juce::JSON::toString(start).toRawUTF8());
    CHECK(fake.seen.back().body.find("Bleep Standalone") != std::string::npos, "the app's name is sent");
    CHECK((bool)account.status()["pending"].isObject(), "pending shows in the status");
    CHECK(account.pollSignIn()["state"].toString() == "pending", "poll 1 pending");
    CHECK(account.pollSignIn()["state"].toString() == "pending", "poll 2 pending");
    const juce::var done = account.pollSignIn();
    CHECK(done["state"].toString() == "approved" && (bool)done["signedIn"] && done["name"].toString() == "Ann", "approved: %s", juce::JSON::toString(done).toRawUTF8());
    CHECK(!done["pending"].isObject(), "no longer pending");
    CHECK(!dir.getChildFile("settings.json").loadFileAsString().contains("blu_secret"), "the token is not in settings.json");
    CHECK(makeFileTokenStore(dir)->load("https://store.example") == "blu_secret", "the token is kept for the store address");
#if !JUCE_WINDOWS
    struct stat info;
    CHECK(::stat(dir.getChildFile("account.json").getFullPathName().toRawUTF8(), &info) == 0 && (info.st_mode & 077) == 0, "the token file is owner-only");
#endif

    // another Account of this machine (a plugin next to the app) finds the same login
    Account other(dir, transport, makeFileTokenStore(dir));
    CHECK((bool)other.status(true)["signedIn"] && other.status()["name"].toString() == "Ann", "a second instance is signed in too");

    const juce::var shared = account.call("POST", "/api/presets", juce::JSON::parse(R"({"title":"Warm Pad","type":"patch","preset":{"nodes":[{}]}})"));
    CHECK((int)shared["status"] == 201 && shared["body"]["address"].toString() == "ann/warm-pad", "shared: %s", juce::JSON::toString(shared).toRawUTF8());
    CHECK(fake.seen.back().bearer == "blu_secret" && fake.seen.back().url == "https://store.example/api/presets", "the token goes in the header");
    const juce::var bad = account.call("POST", "/api/presets", juce::JSON::parse(R"({"title":""})"));
    CHECK((int)bad["status"] == 422 && bad["error"].toString() == "title: String should have at least 1 character", "the store's reason: %s", bad["error"].toString().toRawUTF8());
    {   // plain http to a host other than this machine: no token and no sign-in is sent
        Settings plain = Settings::load(dir);
        plain.storeUrl = "http://store.example";
        plain.save(dir);
        makeFileTokenStore(dir)->save("http://store.example", "blu_secret");   // even with a token on file
        const size_t before = fake.seen.size();
        CHECK((int)account.call("GET", "/api/presets", juce::var())["status"] == 0 && account.startSignIn("Bleep")["error"].isString() && fake.seen.size() == before,
              "nothing is sent over plain http");
        Settings back = plain;
        back.storeUrl = "https://store.example/";
        back.save(dir);
        makeFileTokenStore(dir)->clear("http://store.example");
    }
    const size_t sent = fake.seen.size();
    for (const char* path : {"https://evil.example/api/x", "/other", "/api/../x", "/api/a://b"})
        CHECK((int)account.call("GET", path, juce::var())["status"] == 0, "refused: %s", path);
    CHECK(account.call("TRACE", "/api/presets", juce::var())["error"].isString() && fake.seen.size() == sent, "only the store's API, only known methods");

    fake.down = true;   // the store is down: still signed in, shown as offline
    juce::var offline = account.status(true);
    CHECK((bool)offline["signedIn"] && (bool)offline["offline"], "offline keeps the token");
    fake.down = false;
    fake.revoked = true;   // revoked on the site's account page
    CHECK(!(bool)account.status(true)["signedIn"], "a revoked token signs this machine out");
    CHECK(makeFileTokenStore(dir)->load("https://store.example").empty(), "and is forgotten");

    // sign in again, then sign out: the token is revoked at the store
    fake.revoked = false;
    fake.polls = 0;
    account.startSignIn("Bleep");
    for (int i = 0; i < 3; ++i) account.pollSignIn();
    CHECK((bool)account.status()["signedIn"], "signed in again");
    CHECK(!(bool)account.signOut()["signedIn"] && fake.revoked, "sign out revokes the token at the store");
    CHECK(account.call("GET", "/api/presets", juce::var())["error"].toString() == "Not signed in", "signed out");

    // the flow can be cancelled and expires with the store's answer
    account.startSignIn("Bleep");
    account.cancelSignIn();
    CHECK(account.pollSignIn()["state"].toString() == "none", "cancelled");
    fake.down = true;
    CHECK(account.startSignIn("Bleep")["error"].toString().startsWith("cannot reach"), "no store, no code");
    dir.deleteRecursively();
}

void testPolicy() {
    std::string why;
    Result signedBy, unsignedR, bad, expired;
    signedBy.status = "signed"; signedBy.publisher = "acme";
    bad.status = "invalid"; bad.reason = "x";
    expired.status = "expired"; expired.reason = "old";
    AllowUnsigned off, modules;
    modules.module = true;
    CHECK(decide(signedBy, "module", off, why), "signed loads");
    CHECK(!decide(unsignedR, "module", off, why) && why.find("Allow unsigned modules") != std::string::npos, "unsigned refused: %s", why.c_str());
    CHECK(decide(unsignedR, "module", modules, why), "unsigned loads when allowed");
    CHECK(!decide(unsignedR, "plugin", modules, why), "the two settings are separate");
    CHECK(!decide(bad, "module", modules, why), "invalid never loads");
    CHECK(!decide(expired, "module", off, why) && decide(expired, "module", modules, why), "expired needs the setting");
}
}  // namespace

/// bleep_store_test --live URL ROOT_HEX: the client against a running store (not part of ctest): installs a module and a plugin into a temp folder.

/// Against a running store API: the real HTTP stack, a real device sign-in that someone confirms on the site. Prints
/// `CODE <user code>` and waits (up to 60 s) for the confirmation, then shares a preset, rates and comments, signs out.
/// scripts/check/account-live.py drives it.
int accountLive(const std::string& url, const std::string& dataDir) {
    const juce::File data(dataDir);
    data.createDirectory();
    Settings s;
    s.storeUrl = url;
    s.save(data);
    Account account(data);   // real transport; the token store is the file one because the driver sets BLEEP_DATA_DIR
    const juce::var start = account.startSignIn("Account live test");
    CHECK(start["userCode"].toString().isNotEmpty(), "start: %s", juce::JSON::toString(start).toRawUTF8());
    std::printf("CODE %s\n", start["userCode"].toString().toRawUTF8());
    std::fflush(stdout);
    juce::var r;
    for (int i = 0; i < 60; ++i) {
        r = account.pollSignIn();
        if (r["state"].toString() != "pending" && r["state"].toString() != "error") break;
        juce::Thread::sleep(1000);
    }
    CHECK(r["state"].toString() == "approved" && (bool)r["signedIn"], "sign-in: %s", juce::JSON::toString(r).toRawUTF8());
    CHECK((bool)account.status(true)["signedIn"], "the token works");
    const juce::var shared = account.call("POST", "/api/presets", juce::JSON::parse(R"({"title":"Live Pad","type":"patch","tags":["live"],"preset":{"nodes":[{"id":"a"}],"cables":[]}})"));
    CHECK((int)shared["status"] == 201, "share: %s", juce::JSON::toString(shared).toRawUTF8());
    const juce::var again = account.call("POST", "/api/presets", juce::JSON::parse(R"({"title":"Live Pad","slug":"live-pad","type":"patch","preset":{"nodes":[{"id":"b"}]}})"));
    CHECK((int)again["status"] == 201 && (int)again["body"]["version"] == 2, "new version: %s", juce::JSON::toString(again).toRawUTF8());
    const juce::var bad = account.call("POST", "/api/presets", juce::JSON::parse(R"({"title":"x","type":"patch","preset":{"nodes":[]}})"));
    CHECK((int)bad["status"] == 422 && bad["error"].toString().isNotEmpty(), "refused: %s", juce::JSON::toString(bad).toRawUTF8());
    const juce::var comment = account.call("POST", "/api/social/preset/" + shared["body"]["address"].toString().toStdString() + "/comments", juce::JSON::parse(R"({"body":"first"})"));
    CHECK((int)comment["status"] == 201, "comment: %s", juce::JSON::toString(comment).toRawUTF8());
    const juce::var own = account.call("PUT", "/api/social/preset/" + shared["body"]["address"].toString().toStdString() + "/rating", juce::JSON::parse(R"({"stars":5})"));
    CHECK((int)own["status"] == 403, "no rating of your own preset (PUT): %s", juce::JSON::toString(own).toRawUTF8());
    const juce::var del = account.call("DELETE", "/api/social/comments/" + juce::String((int)comment["body"]["id"]).toStdString(), juce::var());
    CHECK((int)del["status"] == 204, "DELETE: %s", juce::JSON::toString(del).toRawUTF8());
    CHECK(!(bool)account.signOut()["signedIn"], "signed out");
    CHECK((int)account.call("GET", "/api/presets", juce::var())["status"] == 401, "nothing is sent without a login");
    std::printf("account live: %d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}

int live(const std::string& url, const std::string& rootHex) {
    const juce::File data = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("bleep-store-live-" + juce::String::toHexString(juce::Random::getSystemRandom().nextInt()));
    Settings s;
    s.storeUrl = url;
    Client client(s, data, {fromHex(rootHex)}, (juce::int64)std::time(nullptr));
    Index index;
    std::string error;
    CHECK(client.fetchIndex(index, error), "index: %s", error.c_str());
    std::printf("index: %zu modules, %zu plugins\n", index.modules.size(), index.plugins.size());
    InstalledModule m;
    for (const char* slug : {"oscillator", "filter", "wavetable-osc"}) {
        const bool ok = client.install(slug, m, error);
        CHECK(ok && m.allowed && m.result.status == "signed", "install %s: %s (%s)", slug, error.c_str(), m.result.status.c_str());
        if (ok) std::printf("%s %s: %s by %s, %zu types\n", slug, m.version.c_str(), m.result.status.c_str(), m.result.publisher.c_str(), m.types.size());
    }
    std::vector<std::string> names;
    const juce::File vst3 = data.getChildFile("vst3");
    const bool ok = client.installPlugin("bleep-midi-in", vst3, names, error);
    CHECK(ok, "install plugin: %s", error.c_str());
    if (ok) std::printf("plugin: %s -> %s\n", names.empty() ? "?" : names[0].c_str(), vst3.getFullPathName().toRawUTF8());
    CHECK(ok && vst3.getChildFile("Bleep MIDI In.vst3/Contents/MacOS/Bleep MIDI In").existsAsFile(), "the plugin binary is there");
    std::printf("live test: %d failures (data in %s)\n", failures, data.getFullPathName().toRawUTF8());
    return failures == 0 ? 0 : 1;
}

/// The nesting guard in front of juce::JSON::parse (patch/common/SafeJson.h).
void testSafeJson() {
    namespace sj = bleep::safejson;
    const auto rep = [](const char* s, int n) { std::string r; for (int i = 0; i < n; ++i) r += s; return r; };
    const auto deepArray = [&](int n) { return rep("[", n) + rep("]", n); };
    const auto deepObject = [&](int n) { return rep("{\"a\":", n) + "1" + rep("}", n); };
    const auto over = [](const std::string& s, int limit = sj::kDefaultMaxDepth) { return sj::exceedsDepth(s.data(), s.size(), limit); };

    CHECK(!over(deepArray(64)) && over(deepArray(65)), "array limit is exact");
    CHECK(!over(deepObject(64)) && over(deepObject(65)), "object limit is exact");
    CHECK(over(rep("[", 100000)) && over(rep("{\"a\":", 100000)), "unclosed deep input is refused");
    CHECK(!over(deepArray(128), sj::kProjectMaxDepth) && over(deepArray(129), sj::kProjectMaxDepth), "project limit");
    CHECK(!over("[\"" + rep("[", 500) + "\"]"), "brackets inside a string do not count");
    CHECK(!over("[\"\\\"" + rep("[", 500) + "\"]"), "an escaped quote does not end the string");
    CHECK(!over("['" + rep("[", 500) + "']"), "single-quoted strings are strings too");
    CHECK(over("['\"', " + rep("[", 70) + "]"), "a double quote inside single quotes does not hide what follows");
    CHECK(over("[\"'\", " + rep("[", 70) + "]"), "a single quote inside double quotes does not hide what follows");
    CHECK(!over("/* " + rep("[", 500) + " */ [1]") && !over("// " + rep("[", 500) + "\n[1]"), "comments do not count");
    CHECK(over("/* \" */ " + rep("[", 70)), "a quote in a comment does not open a string");
    CHECK(!over("{\"a\":[{\"b\":[1,2,{\"c\":[[]]}]},{\"d\":{}}],\"e\":\"]]]]\"}"), "legit nested data passes");
    CHECK(!over("]]]]]" + deepArray(60)), "stray closers do not go negative");

    CHECK(sj::parse(juce::String(deepArray(10))).isArray(), "parse passes shallow data");
    CHECK(sj::parse(juce::String("{\"a\":[1,2,{\"b\":\"x\"}]}"))["a"][2]["b"].toString() == "x", "parse keeps content");
    CHECK(sj::parse(juce::String(rep("[", 100000))).isVoid(), "parse refuses 100000 deep arrays");
    CHECK(sj::parse(juce::String(deepObject(5000))).isVoid(), "parse refuses 5000 deep objects");
    const std::string deep = rep("[", 100000);
    CHECK(sj::parseUtf8(deep.data(), deep.size()).isVoid(), "parseUtf8 refuses too");
    const auto tmp = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("bleep-safejson-test.json");
    tmp.replaceWithText(juce::String(deep));
    CHECK(sj::parse(tmp).isVoid(), "parse(File) refuses too");
    tmp.deleteFile();
}

int main(int argc, char** argv) {
    if (argc == 4 && std::string(argv[1]) == "--live") return live(argv[2], argv[3]);
    if (argc == 4 && std::string(argv[1]) == "--account-live") return accountLive(argv[2], argv[3]);
    const juce::File dir(BLEEP_STORE_FIXTURES);
    testSafeJson();
    testVector();
    testPackageLimits();
    testCanonical();
    testCanonicalRefuses();
    testStoreUrl();
    testFixtures(dir);
    testClient(dir);
    testRevocations(dir);
    testPolicy();
    testAccount();
    std::printf("store test: %d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
