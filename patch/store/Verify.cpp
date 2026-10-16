// SPDX-License-Identifier: MIT
#include "Verify.h"

#include "monocypher-ed25519.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace bleep::store {
namespace {

/// A 32-bit big-endian length, then the bytes. False (nothing written) if the length does not fit: a truncated prefix would sign other bytes.
bool lp(std::vector<uint8_t>& out, const uint8_t* data, size_t size) {
    if ((uint64_t)size > 0xFFFFFFFFull) return false;
    for (int s = 24; s >= 0; s -= 8) out.push_back((uint8_t)(size >> s));
    out.insert(out.end(), data, data + size);
    return true;
}
bool lp(std::vector<uint8_t>& out, const std::string& s) { return lp(out, reinterpret_cast<const uint8_t*>(s.data()), s.size()); }
void append(std::vector<uint8_t>& out, const std::string& s) { out.insert(out.end(), s.begin(), s.end()); }

std::string str(const juce::var& v) { return v.isString() ? v.toString().toStdString() : std::string(); }

bool b64(const juce::var& v, std::vector<uint8_t>& out) {
    if (!v.isString()) return false;
    juce::MemoryOutputStream stream;
    if (!juce::Base64::convertFromBase64(stream, v.toString())) return false;
    out.assign((const uint8_t*)stream.getData(), (const uint8_t*)stream.getData() + stream.getDataSize());
    return true;
}

bool hasScope(const juce::var& tbs, const std::string& scope) {
    if (auto* a = tbs["scopes"].getArray())
        for (const auto& s : *a)
            if (s.isString() && s.toString().toStdString() == scope) return true;
    return false;
}

bool check(const std::vector<uint8_t>& signature, const std::vector<uint8_t>& pub, const std::vector<uint8_t>& message) {
    return signature.size() == 64 && pub.size() == 32 && crypto_ed25519_check(signature.data(), pub.data(), message.data(), message.size()) == 0;
}

bool canonicalize(std::string& out, const juce::var& v);

bool checkCert(const juce::var& cert, const std::vector<uint8_t>& signerPub, std::string& reason) {
    std::vector<uint8_t> sig, message;
    append(message, "BLEEP-CERT-1\n");
    std::string text;
    if (!canonicalize(text, cert["tbs"])) { reason = "a certificate holds a value that cannot be signed (a fraction or a number that is too large)"; return false; }
    append(message, text);
    return b64(cert["signature"], sig) && check(sig, signerPub, message);
}

Result invalid(const std::string& reason) {
    Result r;
    r.status = "invalid";
    r.reason = reason;
    return r;
}

}  // namespace

std::string keyId(const uint8_t* publicKey32) {
    const Digest d = sha256(publicKey32, 32);
    return toHex(d.data(), 16);
}

// ---- canonical JSON (Python: json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)) ----------------

namespace {
void quote(std::string& out, const std::string& s) {
    out += '"';
    for (unsigned char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            default:
                if (c < 0x20) { char buf[8]; std::snprintf(buf, sizeof buf, "\\u%04x", c); out += buf; }
                else out += (char)c;  // UTF-8 bytes above 0x7f pass through
        }
    }
    out += '"';
}

bool emit(std::string& out, const juce::var& v) {
    if (v.isVoid()) out += "null";
    else if (v.isBool()) out += (bool)v ? "true" : "false";
    else if (v.isInt() || v.isInt64()) out += std::to_string((long long)(juce::int64)v);
    else if (v.isDouble()) {
        const double d = (double)v;
        // Signed objects hold whole numbers only; anything else would have to be written as something it is not.
        if (std::isfinite(d) && d == std::floor(d) && std::fabs(d) < 9e15) out += std::to_string((long long)d);
        else return false;
    }
    else if (v.isString()) quote(out, v.toString().toStdString());
    else if (auto* a = v.getArray()) {
        out += '[';
        for (int i = 0; i < a->size(); ++i) { if (i) out += ','; if (!emit(out, (*a)[i])) return false; }
        out += ']';
    } else if (auto* o = v.getDynamicObject()) {
        std::vector<std::pair<std::string, juce::var>> items;
        for (const auto& p : o->getProperties()) items.push_back({p.name.toString().toStdString(), p.value});
        std::sort(items.begin(), items.end(), [](const auto& a, const auto& b) { return a.first < b.first; });  // bytewise
        out += '{';
        for (size_t i = 0; i < items.size(); ++i) { if (i) out += ','; quote(out, items[i].first); out += ':'; if (!emit(out, items[i].second)) return false; }
        out += '}';
    } else return false;  // binary, a method: nothing a signature covers
    return true;
}
}  // namespace

namespace {
bool canonicalize(std::string& out, const juce::var& value) {
    out.clear();
    if (emit(out, value)) return true;
    out.clear();
    return false;
}
}  // namespace

std::string canonical(const juce::var& value) {
    std::string out;
    canonicalize(out, value);   // refused: empty (a signed text is never empty)
    return out;
}

// ---- verification ----------------------------------------------------------------------------------------------

Revocations Revocations::fromJson(const juce::var& json) {
    Revocations r;
    if (auto* keys = json["revokedKeys"].getArray())
        for (const auto& k : *keys) r.keys.push_back(str(k["keyId"]));
    if (auto* arts = json["revokedArtifacts"].getArray())
        for (const auto& a : *arts) r.artifacts.push_back({str(a["kind"]), str(a["id"]), str(a["version"]), str(a["digest"])});
    return r;
}

bool verifyRevocations(const juce::var& doc, const std::vector<std::vector<uint8_t>>& roots, Revocations& out, std::string& error) {
    auto bad = [&](const char* why) { error = std::string("the revocation list is not trusted: ") + why; return false; };
    if (!doc.isObject() || (int)doc["format"] != 1) return bad("unknown format");
    const juce::var cert = doc["issuer"], tbs = cert["tbs"];
    std::vector<uint8_t> issuerPub, sig;
    if (!tbs.isObject() || !b64(tbs["publicKey"], issuerPub) || issuerPub.size() != 32) return bad("malformed issuer certificate");
    const std::vector<uint8_t>* root = nullptr;
    for (const auto& r : roots)
        if (r.size() == 32 && keyId(r.data()) == str(cert["issuer"])) root = &r;
    std::string why;
    if (!root || !checkCert(cert, *root, why)) return bad(why.empty() ? "the issuer certificate is not signed by a trusted root" : why.c_str());
    if (str(tbs["type"]) != "issuer" || str(tbs["keyId"]) != keyId(issuerPub.data()) || !hasScope(tbs, "issue")) return bad("bad issuer certificate");
    auto* body = new juce::DynamicObject();
    juce::var bodyVar(body);
    for (const char* k : {"format", "serial", "issued", "revokedKeys", "revokedArtifacts"}) body->setProperty(k, doc[k]);
    std::vector<uint8_t> message;
    append(message, "BLEEP-CRL-1\n");
    std::string bodyText;
    if (!canonicalize(bodyText, bodyVar)) return bad("it holds a value that cannot be signed");
    append(message, bodyText);
    if (!b64(doc["signature"], sig) || !check(sig, issuerPub, message)) return bad("the signature does not match the list");
    out = Revocations::fromJson(doc);
    out.serial = (juce::int64)doc["serial"];
    return true;
}

Result verify(const Digest& digest, const juce::var* signature, const Context& c) {
    if (!signature) return Result{};
    const juce::var& doc = *signature;
    if (!doc.isObject() || (int)doc["format"] != 1 || str(doc["algorithm"]) != "ed25519") return invalid("unknown signature format");
    auto* chain = doc["chain"].getArray();
    if (!chain || chain->size() != 2) return invalid("malformed signature: chain");
    const juce::var issuerCert = (*chain)[0], devCert = (*chain)[1];
    const juce::var it = issuerCert["tbs"], dt = devCert["tbs"];
    if (!it.isObject() || !dt.isObject()) return invalid("malformed signature: certificate");
    std::vector<uint8_t> issuerPub, devPub;
    if (!b64(it["publicKey"], issuerPub) || !b64(dt["publicKey"], devPub) || issuerPub.size() != 32 || devPub.size() != 32)
        return invalid("malformed signature: public key");

    const std::vector<uint8_t>* root = nullptr;
    for (const auto& r : c.roots)
        if (r.size() == 32 && keyId(r.data()) == str(issuerCert["issuer"])) root = &r;
    std::string certWhy;
    if (!root || !checkCert(issuerCert, *root, certWhy)) return invalid(certWhy.empty() ? "the issuer certificate is not signed by a trusted root" : certWhy);
    if (str(it["type"]) != "issuer" || str(it["keyId"]) != keyId(issuerPub.data()) || !hasScope(it, "issue")) return invalid("bad issuer certificate");
    if (str(devCert["issuer"]) != str(it["keyId"]) || !checkCert(devCert, issuerPub, certWhy)) return invalid(certWhy.empty() ? "the developer certificate is not signed by the issuer" : certWhy);
    if (str(dt["type"]) != "developer" || str(dt["keyId"]) != keyId(devPub.data()) || str(doc["keyId"]) != str(dt["keyId"])) return invalid("bad developer certificate");

    Result who;
    who.status = "signed";
    who.publisher = str(dt["publisher"]);
    who.keyId = str(dt["keyId"]);
    who.root = keyId(root->data());
    auto with = [&](const char* status, const char* reason) { Result r = who; r.status = status; r.reason = reason; return r; };

    if (c.revocations) {
        for (const juce::var* t : {&it, &dt})
            for (const auto& k : c.revocations->keys)
                if (k == str((*t)["keyId"])) return with("revoked", "the signing key was revoked");
        const std::string hex = toHex(digest.data(), digest.size());
        for (const auto& a : c.revocations->artifacts)
            if (a.kind == c.kind && a.id == c.id && a.version == c.version && a.digest == hex) return with("revoked", "this release was revoked");
    }
    if ((c.kind != "module" && c.kind != "plugin") || !hasScope(dt, c.kind)) return invalid("the certificate does not allow signing a " + c.kind);
    const bool firstParty = dt["firstParty"].isBool() && (bool)dt["firstParty"];
    const bool bareOk = firstParty && c.id.find('/') == std::string::npos;
    const std::string prefix = who.publisher + "/";
    if (!bareOk && c.id.compare(0, prefix.size(), prefix) != 0) return invalid("'" + c.id + "' is not in the publisher's namespace");

    std::vector<uint8_t> message, sig;
    append(message, "BLEEP-SIG-1\n");
    if (!(lp(message, c.kind) && lp(message, c.id) && lp(message, c.version) && lp(message, c.platform) && lp(message, who.keyId)
          && lp(message, digest.data(), digest.size())))
        return invalid("a signed field is too long");
    if (!b64(doc["signature"], sig) || !check(sig, devPub, message)) return invalid("the signature does not match the content");
    for (const juce::var* t : {&it, &dt}) {
        const int64_t from = (juce::int64)(*t)["notBefore"], until = (juce::int64)(*t)["notAfter"];
        if (!(from <= c.now && c.now <= until)) return with("expired", "the certificate is outside its validity period");
    }
    return who;
}

bool decide(const Result& r, const std::string& kind, const AllowUnsigned& allow, std::string& why) {
    if (r.status == "signed") { why = "signed by " + r.publisher; return true; }
    if (r.status == "invalid" || r.status == "revoked") { why = r.status + ": " + r.reason; return false; }
    const bool allowed = kind == "module" ? allow.module : kind == "plugin" ? allow.plugin : false;
    if (allowed) { why = r.status == "unsigned" ? "unsigned (allowed in the settings)" : r.reason + " (unsigned loading allowed)"; return true; }
    why = r.status + ": enable 'Allow unsigned " + kind + "s' in the settings to load it";
    return false;
}

}  // namespace bleep::store
