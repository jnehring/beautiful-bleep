// SPDX-License-Identifier: MIT
//
// The store's checks in C++ (patch/store, doc/specs/signing.md): every package in patch/tests/store-fixtures must get the
// verdict the Python reference gave it (scripts/release/signing.py fixture), and the pieces underneath (content hash,
// canonical JSON) must give Python's exact bytes. patch/web/test/store-client-test.mjs runs the same cases in JavaScript.
#include "store/Verify.h"

#include <cstdio>

using namespace bleep::store;

namespace {
int failures = 0;
#define CHECK(cond, ...)                                       \
    do {                                                       \
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
    testPolicy();
    std::printf("store test: %d failures\n", failures);
    return failures == 0 ? 0 : 1;
}
