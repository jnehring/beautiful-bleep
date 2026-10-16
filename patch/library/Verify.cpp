// SPDX-License-Identifier: MIT
#include "Verify.h"

#include "monocypher-ed25519.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace bleep::library {
namespace {

void lp(std::vector<uint8_t>& out, const uint8_t* data, size_t size) {
    for (int s = 24; s >= 0; s -= 8) out.push_back((uint8_t)(size >> s));
    out.insert(out.end(), data, data + size);
}
void lp(std::vector<uint8_t>& out, const std::string& s) { lp(out, reinterpret_cast<const uint8_t*>(s.data()), s.size()); }
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

bool checkCert(const juce::var& cert, const std::vector<uint8_t>& signerPub) {
    std::vector<uint8_t> sig, message;
    append(message, "BLEEP-CERT-1\n");
    append(message, canonical(cert["tbs"]));
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

void emit(std::string& out, const juce::var& v) {
    if (v.isVoid()) out += "null";
    else if (v.isBool()) out += (bool)v ? "true" : "false";
    else if (v.isInt() || v.isInt64()) out += std::to_string((long long)(juce::int64)v);
    else if (v.isDouble()) {
        const double d = (double)v;
        if (d == std::floor(d) && std::fabs(d) < 9e15) out += std::to_string((long long)d);
        else out += "0";  // signed objects hold no fractions
    }
    else if (v.isString()) quote(out, v.toString().toStdString());
    else if (auto* a = v.getArray()) {
        out += '[';
        for (int i = 0; i < a->size(); ++i) { if (i) out += ','; emit(out, (*a)[i]); }
        out += ']';
    } else if (auto* o = v.getDynamicObject()) {
        std::vector<std::pair<std::string, juce::var>> items;
        for (const auto& p : o->getProperties()) items.push_back({p.name.toString().toStdString(), p.value});
        std::sort(items.begin(), items.end(), [](const auto& a, const auto& b) { return a.first < b.first; });  // bytewise
        out += '{';
        for (size_t i = 0; i < items.size(); ++i) { if (i) out += ','; quote(out, items[i].first); out += ':'; emit(out, items[i].second); }
        out += '}';
    }
}
}  // namespace

std::string canonical(const juce::var& value) {
    std::string out;
    emit(out, value);
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
    if (!root || !checkCert(cert, *root)) return bad("the issuer certificate is not signed by a trusted root");
    if (str(tbs["type"]) != "issuer" || str(tbs["keyId"]) != keyId(issuerPub.data()) || !hasScope(tbs, "issue")) return bad("bad issuer certificate");
    auto* body = new juce::DynamicObject();
    juce::var bodyVar(body);
    for (const char* k : {"format", "serial", "issued", "revokedKeys", "revokedArtifacts"}) body->setProperty(k, doc[k]);
    std::vector<uint8_t> message;
    append(message, "BLEEP-CRL-1\n");
    append(message, canonical(bodyVar));
    if (!b64(doc["signature"], sig) || !check(sig, issuerPub, message)) return bad("the signature does not match the list");
    out = Revocations::fromJson(doc);
    out.serial = (juce::int64)doc["serial"];
    return true;
}

Result verify(const Digest& digest, const juce::var* signature, const Context& c, const juce::var* receipt) {
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
    if (!root || !checkCert(issuerCert, *root)) return invalid("the issuer certificate is not signed by a trusted root");
    if (str(it["type"]) != "issuer" || str(it["keyId"]) != keyId(issuerPub.data()) || !hasScope(it, "issue")) return invalid("bad issuer certificate");
    if (str(devCert["issuer"]) != str(it["keyId"]) || !checkCert(devCert, issuerPub)) return invalid("the developer certificate is not signed by the issuer");
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
    lp(message, c.kind);
    lp(message, c.id);
    lp(message, c.version);
    lp(message, c.platform);
    lp(message, who.keyId);
    lp(message, digest.data(), digest.size());
    if (!b64(doc["signature"], sig) || !check(sig, devPub, message)) return invalid("the signature does not match the content");
    // validity comes last: an expired signer is not an attack, just old. A receipt moves the moment that counts from now to publishedAt.
    int64_t at = c.now;
    if (receipt) {
        const juce::var& rc = *receipt;
        const juce::var p = rc["publishedAt"];
        if (!rc.isObject() || (int)rc["format"] != 1 || str(rc["algorithm"]) != "ed25519" || str(rc["issuerKeyId"]) != str(it["keyId"]) ||
            !(p.isInt() || p.isInt64()) || (juce::int64)p < 0)
            return invalid("bad publication receipt");
        at = (juce::int64)p;
        std::vector<uint8_t> pubMessage, pubSig;
        append(pubMessage, "BLEEP-PUB-1\n");
        lp(pubMessage, c.kind);
        lp(pubMessage, c.id);
        lp(pubMessage, c.version);
        lp(pubMessage, c.platform);
        lp(pubMessage, who.keyId);
        lp(pubMessage, digest.data(), digest.size());
        for (int shift = 56; shift >= 0; shift -= 8) pubMessage.push_back((uint8_t)((uint64_t)at >> shift));  // u64, big endian
        if (!b64(rc["signature"], pubSig) || !check(pubSig, issuerPub, pubMessage)) return invalid("the publication receipt does not match the release");
        who.publishedAt = at;
    }
    for (const juce::var* t : {&it, &dt}) {
        const int64_t from = (juce::int64)(*t)["notBefore"], until = (juce::int64)(*t)["notAfter"];
        if (from <= at && at <= until) continue;
        if (receipt) return invalid("the publication receipt dates the release outside the certificate's validity period");
        return with("expired", "the certificate is outside its validity period");
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

}  // namespace bleep::library
