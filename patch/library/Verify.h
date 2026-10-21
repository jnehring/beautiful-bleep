// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// Verify.h — what the apps and plugins check before they run or install a module or a plugin
// (developers/modules/signing.md). The same rules as scripts/release/signing.py and patch/web/js/library-client.js; the packages in
// patch/tests/library-fixtures give all three the same verdicts.
#pragma once

#include <juce_core/juce_core.h>

#include <array>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace bleep::library {

using Digest = std::array<uint8_t, 32>;

struct FileInfo {
    Digest sha{};
    bool executable = false;
};
/// Path → hash and mode, in the order the content hash takes them (the bytes of the path).
using Entries = std::map<std::string, FileInfo>;

/// The files of a package (a zip), without META/signature.json, which is read apart.
struct Package {
    std::map<std::string, std::vector<uint8_t>> files;
    Entries entries;
    bool hasSignature = false;
    juce::var signature;  ///< META/signature.json; void if it is not JSON (the package is then judged invalid, not unreadable)
};

/// Reads a zip: stored and deflate, no zip64. Refuses duplicates, symbolic links and anything that is not a zip.
bool readPackage(const uint8_t* data, size_t size, Package& out, std::string& error);

/// Is every file of a package one a community module may bring (signing.md section 2a)? Module data and the sandboxed .wasm, no scripts:
/// module.json, module.wasm, spec.json, LICENSE, doc/*.md and doc/*.png. The library refuses anything else at upload; a client checks
/// again, because a signature by the community key says nothing about files that key should never have signed. `why` names the first offender.
bool communityFilesOk(const Package& pkg, std::string& why);

/// signing.md section 4. False (with `error`) if a path is unsafe.
bool contentDigest(const Entries& entries, Digest& out, std::string& error);

/// The digest of a single file, as a package of one file (a plugin installer).
Entries singleFile(const std::string& name, const Digest& sha);

Digest sha256(const uint8_t* data, size_t size);
std::string toHex(const uint8_t* data, size_t size);
std::vector<uint8_t> fromHex(const std::string& hex);
/// The first 16 bytes of the SHA-256 of a public key, as 32 hex characters.
std::string keyId(const uint8_t* publicKey32);
/// The text a signed object is turned into: keys sorted, no whitespace, UTF-8 (Python: json.dumps(sort_keys, separators)).
std::string canonical(const juce::var& value);

struct Result {
    std::string status = "unsigned";  ///< signed | unsigned | expired | revoked | invalid
    std::string publisher, keyId, root, reason;
    std::string trust;  // official | community | developer (empty unless signed): whose key signed it
    int64_t publishedAt = 0;          ///< when the library published it, if a publication receipt dated the release (signing.md section 6a)
};

struct Revocations {
    struct Artifact { std::string kind, id, version, digest; };
    std::vector<std::string> keys;     ///< key ids
    std::vector<Artifact> artifacts;
    int64_t serial = 0;                ///< rises with every list the library signs; a client keeps the highest
    static Revocations fromJson(const juce::var& json);
};

/// signing.md section 8: the library's signed list. True if its issuer certificate is signed by one of the pinned roots and the issuer's
/// signature over the list holds; `out` is then the list. Validity dates are not looked at: a list can only take trust away.
bool verifyRevocations(const juce::var& doc, const std::vector<std::vector<uint8_t>>& roots, Revocations& out, std::string& error);

struct Context {
    std::string kind, id, version, platform = "any";
    std::vector<std::vector<uint8_t>> roots;   ///< the pinned root public keys
    int64_t now = 0;                           ///< unix seconds
    const Revocations* revocations = nullptr;
};

/// signing.md section 7. `signature` null: the package carries none. Never throws on bad input.
/// `receipt`: the library's publication receipt for the file (entry.json files[].publication, kept beside the installed file), or null.
/// With one the certificates must have been valid when the library published it (signing.md section 6a), and `context.now` plays no part.
Result verify(const Digest& digest, const juce::var* signature, const Context& context, const juce::var* receipt = nullptr);

struct AllowUnsigned {
    bool module = false, plugin = false;
};

/// May it load, given the settings? `why` says why not (or by whom it is signed).
bool decide(const Result& result, const std::string& kind, const AllowUnsigned& allow, std::string& why);

}  // namespace bleep::library
