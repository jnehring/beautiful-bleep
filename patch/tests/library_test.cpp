// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// The library client in C++ (patch/library): every package in patch/tests/library-fixtures must be read or refused the way
// patch/web/test/library-client-test.mjs reads it in JavaScript, and the client installs and lists modules from the fixture library.
#include "common/SafeJson.h"
#include "library/Account.h"
#include "library/Client.h"

#include <cstdio>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#if !JUCE_WINDOWS
#include <sys/stat.h>
#endif

using namespace bleep::library;

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

void testLibraryUrl() {
    std::string why;
    for (const char* ok : {"https://store.example", "http://localhost:8080", "http://127.0.0.1", "http://[::1]:8080/x", "http://a.localhost", "HTTP://LOCALHOST"})
        CHECK(libraryUrlAllowed(ok, why), "allowed: %s", ok);
    for (const char* bad : {"http://store.example", "http://localhost.evil.com", "http://localhost@evil.com", "ftp://x", "store.example", ""})
        CHECK(!libraryUrlAllowed(bad, why) && !why.empty(), "refused: %s", bad);
}

void testFixtures(const juce::File& dir) {
    const juce::var spec = juce::JSON::parse(dir.getChildFile("cases.json"));
    auto* cases = spec["cases"].getArray();
    CHECK(cases && cases->size() >= 6, "no cases");
    int n = 0;
    for (const auto& c : *cases) {
        const std::string name = c["name"].toString().toStdString(), expect = c["expect"].toString().toStdString();
        const auto bytes = readFile(dir.getChildFile(c["file"].toString()));
        Package pkg;
        std::string error;
        const std::string got = readPackage(bytes.data(), bytes.size(), pkg, error) ? "ok" : "refused";
        if (got == "ok") {
            CHECK(pkg.files.count("META/signature.json") == 0, "%s: a signature of an older package is left out", name.c_str());
            if (c.hasProperty("communityFiles")) {  // the file rule a client applies to a package an account uploaded
                std::string why;
                CHECK(communityFilesOk(pkg, why) == (bool)c["communityFiles"], "%s: community file rule (%s)", name.c_str(), why.c_str());
            }
        }
        CHECK(got == expect, "%s: got %s, expected %s", name.c_str(), got.c_str(), expect.c_str());
        ++n;
    }
    std::printf("  %d fixture packages checked\n", n);
}

void testClient(const juce::File& fixtures) {
    const juce::var spec = juce::JSON::parse(fixtures.getChildFile("cases.json"));
    const int64_t now = (juce::int64)spec["siteNow"];
    const juce::File data = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("bleep-library-test-" + juce::String::toHexString(juce::Random::getSystemRandom().nextInt()));
    auto client = [&](const char* site) {
        Settings s;
        s.libraryUrl = juce::URL(fixtures.getChildFile(site)).toString(false).toStdString();
        return Client(s, data, now);
    };
    InstalledModule m;
    std::string error;

    {  // plugins: downloaded, unpacked into the plugin folder
        const juce::File vst3 = data.getChildFile("vst3");
        std::vector<std::string> names;
        CHECK(client("site").installPlugin("test-plugin", vst3, names, error) && names.size() == 1 && names[0] == "Test Plugin.vst3", "install a plugin: %s", error.c_str());
        CHECK(vst3.getChildFile("Test Plugin.vst3/Contents/Info.plist").existsAsFile(), "the bundle is unpacked");
        names.clear();
        CHECK(!client("site").installPlugin("no-such-plugin", vst3, names, error), "an unknown plugin: %s", error.c_str());
        Index withPlugins;
        CHECK(client("site").fetchIndex(withPlugins, error) && withPlugins.plugins.size() == 1, "the index lists the plugin");
    }
    Index index;
    CHECK(client("site").fetchIndex(index, error), "index: %s", error.c_str());
    CHECK(index.modules.size() == 5 && index.find("good") && index.find("good")->version == "1.2.0", "the index lists five modules");
    CHECK(index.providing("acme/fuzz") && index.providing("acme/fuzz")->slug == "acme.fuzz" && !index.providing("nothing"), "a type finds its module");

    {  // the index is kept on disk, so the library still lists its modules when it can't be reached
        Index saved;
        int64_t at = 0;
        CHECK(client("site").loadCachedIndex(saved, at, error), "a fetched index is saved: %s", error.c_str());
        CHECK(saved.modules.size() == 5 && saved.find("good") && saved.find("good")->version == "1.2.0" && at == now, "the saved copy is the index, with the time");
        Settings gone;   // the same data folder, a library that does not answer
        gone.libraryUrl = juce::URL(fixtures.getChildFile("no-such-site")).toString(false).toStdString();
        Client offline(gone, data, now);
        Index none, fromDisk;
        CHECK(!offline.fetchIndex(none, error), "an unreachable library gives no index");
        CHECK(!offline.loadCachedIndex(fromDisk, at, error) && error.find("another library") != std::string::npos,
              "a copy saved for another library address is not used: %s", error.c_str());
        Settings beta;
        beta.libraryUrl = client("site").settings().libraryUrl;
        beta.channel = "beta";
        CHECK(!Client(beta, data, now).loadCachedIndex(fromDisk, at, error), "nor one saved for another channel");
        CHECK(client("site").loadCachedIndex(fromDisk, at, error) && fromDisk.modules.size() == 5, "a new client of the same library reads it");
        Settings same;
        same.libraryUrl = client("site").settings().libraryUrl;
        CHECK(!Client(same, data.getChildFile("elsewhere"), now).loadCachedIndex(fromDisk, at, error), "no copy, no index");
    }

    CHECK(client("site").install("good", m, error), "install good: %s", error.c_str());
    CHECK(m.allowed && m.version == "1.2.0" && m.file.existsAsFile(), "good is installed");
    CHECK(client("site").install("acme.fuzz", m, error), "install acme.fuzz: %s", error.c_str());
    CHECK(client("site").install("acme.clean", m, error), "a package an account uploaded and that holds only what is allowed installs: %s", error.c_str());
    CHECK(!client("site").install("acme.scripts", m, error) && error.find("not allowed in a community module") != std::string::npos, "one that brings a page script does not: %s", error.c_str());
    CHECK(!client("site").install("bad-download", m, error) && error.find("not the file the library lists") != std::string::npos, "a corrupted download: %s", error.c_str());
    CHECK(!client("site").install("missing", m, error) && error.find("no module") != std::string::npos, "an unknown module: %s", error.c_str());
    CHECK(!data.getChildFile("modules/registry/acme.scripts").exists() && !data.getChildFile("modules/registry/bad-download").exists(), "nothing refused was written");

    {
        const auto list = client("site").installed();
        std::map<std::string, const InstalledModule*> by;
        for (const auto& i : list) by[i.slug] = &i;
        CHECK(list.size() == 3 && by["good"] && by["good"]->allowed && by["acme.fuzz"] && by["acme.clean"], "installed() lists what is there");
        std::vector<uint8_t> wasm;
        std::string spec;
        CHECK(client("site").contentOf(*by["good"], wasm, spec, error) && wasm.size() == 8 && wasm[1] == 'a', "the wasm of an installed module: %s", error.c_str());

        // a package that stops being a zip on disk, with the size and the modification time put back: installed() answers from its cache
        // and still says "allowed", so what serves the files of a package (ui/, doc/) must not rely on it
        const InstalledModule fuzz = *by["acme.fuzz"];
        Package files;
        CHECK(fuzz.allowed && client("site").filesOf(fuzz, files, error) && files.files.count("module.wasm"), "the files of an installed module: %s", error.c_str());
        const juce::Time stamp = fuzz.file.getLastModificationTime();
        juce::MemoryBlock fuzzBytes;
        fuzz.file.loadFileAsData(fuzzBytes);
        ((uint8_t*)fuzzBytes.getData())[0] ^= 0x55;   // the signature of the first local file header
        CHECK(fuzz.file.replaceWithData(fuzzBytes.getData(), fuzzBytes.getSize()) && fuzz.file.setLastModificationTime(stamp), "damage acme.fuzz");
        bool cachedAllowed = false;
        for (const auto& i : client("site").installed()) if (i.slug == "acme.fuzz") cachedAllowed = i.allowed;
        CHECK(cachedAllowed, "installed() still answers from its cache (the premise of this test)");
        Package damaged;
        CHECK(!client("site").filesOf(fuzz, damaged, error) && damaged.files.empty(), "a damaged package gives no files, whatever the cache says");
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

    {   // a board pins the older version: it is fetched by its number and stays next to the newest, until a newer one is installed
        CHECK(client("site").installVersion("good", "1.2.0", m, error) && m.version == "1.2.0" && m.allowed, "install the older version: %s", error.c_str());
        CHECK(data.getChildFile("modules/registry/good/1.2.0").isDirectory() && data.getChildFile("modules/registry/good/1.3.0").isDirectory(), "both versions are on disk");
        int newest = 0, all = 0;
        for (const auto& i : client("site").installed()) if (i.slug == "good") { ++newest; CHECK(i.version == "1.3.0", "installed() still shows the newest only"); }
        for (const auto& i : client("site").installed(false, true)) if (i.slug == "good") ++all;
        CHECK(newest == 1 && all == 2, "installed(allVersions) lists both: %d %d", newest, all);
        CHECK(!client("site").installVersion("good", "9.9.9", m, error), "a version the library never published: %s", error.c_str());
        CHECK(!client("site").installVersion("good", "../1.2.0", m, error) && !client("site").installVersion("../good", "1.2.0", m, error), "a version and a name are never a path");
        CHECK(client("site2").install("good", m, error) && !data.getChildFile("modules/registry/good/1.2.0").exists(), "a newer install removes the older version again");
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

    // copied by hand: the file name says the version (none: 0.0.0)
    const juce::File local = data.getChildFile("modules/local");
    local.createDirectory();
    fixtures.getChildFile("valid.bleepmod").copyFileTo(local.getChildFile("acme.fuzz-1.0.0.bleepmod"));
    fixtures.getChildFile("valid.bleepmod").copyFileTo(local.getChildFile("handmade-0.1.0.bleepmod"));
    fixtures.getChildFile("valid.bleepmod").copyFileTo(local.getChildFile("renamed.bleepmod"));
    fixtures.getChildFile("valid.bleepmod").copyFileTo(local.getChildFile("hand-made-0.1.4-dev.bleepmod"));
    fixtures.getChildFile("valid.bleepmod").copyFileTo(local.getChildFile("stamped-0.2.0-dev.202610271432.bleepmod"));
    fixtures.getChildFile("symlink.bleepmod").copyFileTo(local.getChildFile("broken-0.1.0.bleepmod"));
    {
        std::map<std::string, InstalledModule> by;
        for (const auto& i : client("site").installed())
            if (i.source == "local") by[i.slug] = i;
        CHECK(by["acme.fuzz"].allowed && by["handmade"].allowed, "a package copied into the local folder loads");
        CHECK(by["hand-made"].allowed && by["hand-made"].version == "0.1.4-dev", "a -dev version in the name is read: a slug with a dash, version 0.1.4-dev");
        CHECK(versionNewer("0.1.4-dev", "0.1.3") && versionNewer("0.1.4-dev", "0.1.4") && !versionNewer("0.1.4", "0.1.4-dev") && !versionNewer("0.1.3", "0.1.4-dev") && versionNewer("0.1.5", "0.1.4-dev"),
              "a -dev version ranks above the release of the same number, and below the next one");
        CHECK(by["stamped"].allowed && by["stamped"].version == "0.2.0-dev.202610271432", "a dev version with a build time in the name is read: %s", by["stamped"].version.c_str());
        CHECK(versionNewer("0.2.0-dev.202610271500", "0.2.0-dev.202610271432") && !versionNewer("0.2.0-dev.202610271432", "0.2.0-dev.202610271500") &&
              versionNewer("0.2.0-dev.202610271432", "0.2.0") && versionNewer("0.2.0-dev.202610271432", "0.2.0-dev") && versionNewer("0.2.1", "0.2.0-dev.202610271432") &&
              !versionNewer("0.2.0-dev.20261027", "0.2.0") && !versionNewer("1.0", "0.2.0"),
              "development builds rank by their build time, above the release of their number and below the next one; malformed ones never rank");
        CHECK(by["renamed"].allowed && by["renamed"].version == "0.0.0", "one without its version in the name loads as 0.0.0");
        CHECK(!by["broken"].allowed && !by["broken"].why.empty(), "one that is not a safe package does not: %s", by["broken"].why.c_str());
    }

    Settings s;
    s.libraryUrl = "http://example.test";
    CHECK(s.save(data), "save settings");
    const Settings back = Settings::load(data);
    CHECK(back.libraryUrl == s.libraryUrl && back.channel == "stable", "settings come back");
    CHECK(Settings::load(data.getChildFile("nowhere")).libraryUrl == Settings().libraryUrl, "defaults when there is no file");
    CHECK(back.updateCheck && Settings::load(data.getChildFile("nowhere")).updateCheck, "the update check is on by default");
    s.updateCheck = false;
    CHECK(s.save(data) && !Settings::load(data).updateCheck, "the update check switch comes back");
    data.deleteRecursively();
}


/// The sign-in against a pretend library: the device flow, the token in the token store, authenticated calls, revocation of the sign-in.
void testAccount() {
    const juce::File dir = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("bleep-account-test-" + juce::String(juce::Time::currentTimeMillis()) + "-" + juce::String(juce::Random::getSystemRandom().nextInt(1 << 30)));   // one folder per run: two test runs at once must not share it
    dir.deleteRecursively();
    dir.createDirectory();
    Settings s;
    s.libraryUrl = "https://library.example/";
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
        const std::string path = r.url.substr(std::string("https://library.example").size());
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
    CHECK(!(bool)st["signedIn"] && st["libraryUrl"].toString() == "https://library.example", "starts signed out");
    CHECK(account.pollSignIn()["state"].toString() == "none", "no flow, nothing to poll");
    CHECK(account.call("GET", "/api/presets", juce::var())["status"].toString() == "401", "a call without a login is refused here, no network");
    CHECK(fake.seen.empty(), "nothing was sent");

    const juce::var start = account.startSignIn("Bleep Standalone");
    CHECK(start["userCode"].toString() == "ABCD-EFGH" && start["url"].toString() == "https://library.example/device/", "start: %s",
          juce::JSON::toString(start).toRawUTF8());
    CHECK(fake.seen.back().body.find("Bleep Standalone") != std::string::npos, "the app's name is sent");
    CHECK((bool)account.status()["pending"].isObject(), "pending shows in the status");
    CHECK(account.pollSignIn()["state"].toString() == "pending", "poll 1 pending");
    CHECK(account.pollSignIn()["state"].toString() == "pending", "poll 2 pending");
    const juce::var done = account.pollSignIn();
    CHECK(done["state"].toString() == "approved" && (bool)done["signedIn"] && done["name"].toString() == "Ann", "approved: %s", juce::JSON::toString(done).toRawUTF8());
    CHECK(!done["pending"].isObject(), "no longer pending");
    CHECK(!dir.getChildFile("settings.json").loadFileAsString().contains("blu_secret"), "the token is not in settings.json");
    CHECK(makeFileTokenStore(dir)->load("https://library.example") == "blu_secret", "the token is kept for the library address");
#if !JUCE_WINDOWS
    struct stat info;
    CHECK(::stat(dir.getChildFile("account.json").getFullPathName().toRawUTF8(), &info) == 0 && (info.st_mode & 077) == 0, "the token file is owner-only");
#endif

    // another Account of this machine (a plugin next to the app) finds the same login
    Account other(dir, transport, makeFileTokenStore(dir));
    CHECK((bool)other.status(true)["signedIn"] && other.status()["name"].toString() == "Ann", "a second instance is signed in too");

    const juce::var shared = account.call("POST", "/api/presets", juce::JSON::parse(R"({"title":"Warm Pad","type":"patch","preset":{"nodes":[{}]}})"));
    CHECK((int)shared["status"] == 201 && shared["body"]["address"].toString() == "ann/warm-pad", "shared: %s", juce::JSON::toString(shared).toRawUTF8());
    CHECK(fake.seen.back().bearer == "blu_secret" && fake.seen.back().url == "https://library.example/api/presets", "the token goes in the header");
    const juce::var bad = account.call("POST", "/api/presets", juce::JSON::parse(R"({"title":""})"));
    CHECK((int)bad["status"] == 422 && bad["error"].toString() == "title: String should have at least 1 character", "the library's reason: %s", bad["error"].toString().toRawUTF8());
    {   // the assistant's answer, piece by piece (Server-Sent Events): blocks arrive whole, a split multi-byte character is never cut
        // The stream threads are detached and may still run when this block is over (a cancelled stream): they own their state.
        struct Seen { std::mutex m; std::string bearer, url; };
        const auto seen = std::make_shared<Seen>();
        StreamTransport streaming = [seen](const HttpRequest& r, const StreamEvents& e) {
            {
                std::lock_guard<std::mutex> lock(seen->m);
                seen->bearer = r.bearer;
                seen->url = r.url;
            }
            if (r.body.find("limit") != std::string::npos) {
                e.head(429, 30);
                const std::string body = R"({"detail":"The daily AI budget is used up"})";
                e.data(body.data(), body.size());
                return;
            }
            if (r.body.find("down") != std::string::npos) return;   // never reached: no head
            e.head(200, 0);
            const std::string block = "event: text\ndata: {\"delta\":\"\xC3\xA9\"}\n\n";   // an e with an acute accent
            e.data(block.data(), block.size() - 6);                  // ends inside the character's JSON, before the blank line
            e.data(block.data() + block.size() - 6, 6);
            e.data("event: done\ndata: {}\n\n", 22);
        };
        Account streamer(dir, transport, makeFileTokenStore(dir), streaming);
        CHECK((int)streamer.streamStart("/api/presets", juce::var())["status"] == 0, "only the assistant's paths can be streamed");
        CHECK((int)streamer.streamStart("/api/agent/../tokens", juce::var())["status"] == 0, "no path tricks");
        const juce::var started = streamer.streamStart("/api/agent/chat", juce::JSON::parse(R"({"messages":[]})"));
        CHECK(started["id"].isString(), "stream started: %s", juce::JSON::toString(started).toRawUTF8());
        std::string text;
        bool done = false;
        int status = -1;
        for (int i = 0; i < 50 && !done; ++i) {
            const juce::var r = streamer.streamRead(started["id"].toString().toStdString(), 200);
            if (r["status"].isInt()) status = (int)r["status"];
            const std::string chunk = r["chunk"].toString().toStdString();
            if (!done && !chunk.empty()) CHECK(chunk.size() >= 2 && chunk.substr(chunk.size() - 2) == "\n\n", "a chunk ends at a block boundary");
            text += chunk;
            done = (bool)r["done"];
        }
        CHECK(status == 200 && done, "status %d, done %d", status, (int)done);
        CHECK(text == "event: text\ndata: {\"delta\":\"\xC3\xA9\"}\n\nevent: done\ndata: {}\n\n", "all of it, in order: %s", text.c_str());
        {
            std::lock_guard<std::mutex> lock(seen->m);
            CHECK(seen->bearer == "blu_secret" && seen->url == "https://library.example/api/agent/chat", "the login goes with it");
        }
        CHECK(!streamer.streamRead(started["id"].toString().toStdString(), 100)["error"].isVoid(), "a finished stream is forgotten");

        const juce::var refused = streamer.streamStart("/api/agent/chat", juce::JSON::parse(R"({"note":"limit"})"));
        juce::var first;
        for (int i = 0; i < 50 && !(bool)first["done"]; ++i) first = streamer.streamRead(refused["id"].toString().toStdString(), 200);
        CHECK((int)first["status"] == 429 && (int)first["retryAfter"] == 30 && first["chunk"].toString().contains("budget"), "an error answer comes whole: %s",
              juce::JSON::toString(first).toRawUTF8());

        const juce::var gone = streamer.streamStart("/api/agent/chat", juce::JSON::parse(R"({"note":"down"})"));
        juce::var r3;
        for (int i = 0; i < 50 && !(bool)r3["done"]; ++i) r3 = streamer.streamRead(gone["id"].toString().toStdString(), 200);
        CHECK((bool)r3["done"] && r3["error"].toString().contains("cannot reach"), "an unreachable library: %s", juce::JSON::toString(r3).toRawUTF8());

        const juce::var cancelled = streamer.streamStart("/api/agent/chat", juce::JSON::parse(R"({"messages":[]})"));
        streamer.streamCancel(cancelled["id"].toString().toStdString());
        juce::var r4;
        for (int i = 0; i < 50 && !(bool)r4["done"]; ++i) r4 = streamer.streamRead(cancelled["id"].toString().toStdString(), 200);
        CHECK((bool)r4["done"], "a cancelled stream ends");
    }
    {   // plain http to a host other than this machine: no token and no sign-in is sent
        Settings plain = Settings::load(dir);
        plain.libraryUrl = "http://library.example";
        plain.save(dir);
        makeFileTokenStore(dir)->save("http://library.example", "blu_secret");   // even with a token on file
        const size_t before = fake.seen.size();
        CHECK((int)account.call("GET", "/api/presets", juce::var())["status"] == 0 && account.startSignIn("Bleep")["error"].isString() && fake.seen.size() == before,
              "nothing is sent over plain http");
        Settings back = plain;
        back.libraryUrl = "https://library.example/";
        back.save(dir);
        makeFileTokenStore(dir)->clear("http://library.example");
    }
    const size_t sent = fake.seen.size();
    for (const char* path : {"https://evil.example/api/x", "/other", "/api/../x", "/api/a://b"})
        CHECK((int)account.call("GET", path, juce::var())["status"] == 0, "refused: %s", path);
    CHECK(account.call("TRACE", "/api/presets", juce::var())["error"].isString() && fake.seen.size() == sent, "only the library's API, only known methods");

    fake.down = true;   // the library is down: still signed in, shown as offline
    juce::var offline = account.status(true);
    CHECK((bool)offline["signedIn"] && (bool)offline["offline"], "offline keeps the token");
    fake.down = false;
    fake.revoked = true;   // revoked on the site's account page
    CHECK(!(bool)account.status(true)["signedIn"], "a revoked token signs this machine out");
    CHECK(makeFileTokenStore(dir)->load("https://library.example").empty(), "and is forgotten");

    // sign in again, then sign out: the token is revoked at the library
    fake.revoked = false;
    fake.polls = 0;
    account.startSignIn("Bleep");
    for (int i = 0; i < 3; ++i) account.pollSignIn();
    CHECK((bool)account.status()["signedIn"], "signed in again");
    CHECK(!(bool)account.signOut()["signedIn"] && fake.revoked, "sign out revokes the token at the library");
    CHECK(account.call("GET", "/api/presets", juce::var())["error"].toString() == "Not signed in", "signed out");

    // the flow can be cancelled and expires with the library's answer
    account.startSignIn("Bleep");
    account.cancelSignIn();
    CHECK(account.pollSignIn()["state"].toString() == "none", "cancelled");
    fake.down = true;
    CHECK(account.startSignIn("Bleep")["error"].toString().startsWith("cannot reach"), "no library, no code");
    dir.deleteRecursively();
}
}  // namespace

/// bleep_library_test --live URL: the client against a running library (not part of ctest): installs a module and a plugin into a temp folder.

/// Against a running library API: the real HTTP stack, a real device sign-in that someone confirms on the site. Prints
/// `CODE <user code>` and waits (up to 60 s) for the confirmation, then shares a preset, rates and comments, signs out.
/// scripts/check/account-live.py drives it.
int accountLive(const std::string& url, const std::string& dataDir) {
    const juce::File data(dataDir);
    data.createDirectory();
    Settings s;
    s.libraryUrl = url;
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

int live(const std::string& url) {
    const juce::File data = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("bleep-library-live-" + juce::String::toHexString(juce::Random::getSystemRandom().nextInt()));
    Settings s;
    s.libraryUrl = url;
    Client client(s, data);
    Index index;
    std::string error;
    CHECK(client.fetchIndex(index, error), "index: %s", error.c_str());
    std::printf("index: %zu modules, %zu plugins\n", index.modules.size(), index.plugins.size());
    InstalledModule m;
    for (const char* slug : {"oscillator", "filter", "wavetable-osc"}) {
        const bool ok = client.install(slug, m, error);
        CHECK(ok && m.allowed, "install %s: %s", slug, error.c_str());
        if (ok) std::printf("%s %s: %zu types\n", slug, m.version.c_str(), m.types.size());
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
    if (argc == 3 && std::string(argv[1]) == "--live") return live(argv[2]);
    if (argc == 4 && std::string(argv[1]) == "--account-live") return accountLive(argv[2], argv[3]);
    const juce::File dir(BLEEP_LIBRARY_FIXTURES);
    testSafeJson();
    testPackageLimits();
    testLibraryUrl();
    testFixtures(dir);
    testClient(dir);
    testAccount();
    std::printf("library test: %d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
