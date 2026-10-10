// SPDX-License-Identifier: MIT
//
// The store's checks in C++ (patch/store, doc/specs/signing.md): every package in patch/tests/store-fixtures must get the
// verdict the Python reference gave it (scripts/release/signing.py fixture), and the pieces underneath (content hash,
// canonical JSON) must give Python's exact bytes. patch/web/test/store-client-test.mjs runs the same cases in JavaScript.
#include "store/Client.h"
#include "store/Verify.h"

#include <cstdio>

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
        return Client(s, data, roots, now);
    };
    InstalledModule m;
    std::string error;

    Index index;
    CHECK(client("site").fetchIndex(index, error), "index: %s", error.c_str());
    CHECK(index.modules.size() == 6 && index.find("good") && index.find("good")->version == "1.2.0", "the index lists six modules");
    CHECK(index.providing("acme/fuzz") && index.providing("acme/fuzz")->slug == "acme.fuzz" && !index.providing("nothing"), "a type finds its module");

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

int main() {
    const juce::File dir(BLEEP_STORE_FIXTURES);
    testVector();
    testCanonical();
    testFixtures(dir);
    testClient(dir);
    testPolicy();
    std::printf("store test: %d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
