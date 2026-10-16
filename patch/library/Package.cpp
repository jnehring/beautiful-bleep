// SPDX-License-Identifier: MIT
#include "Verify.h"

#include <juce_cryptography/juce_cryptography.h>

#include <cstring>

namespace bleep::library {
namespace {

uint16_t u16(const uint8_t* p) { return (uint16_t)(p[0] | (p[1] << 8)); }
uint32_t u32(const uint8_t* p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

bool safePath(const std::string& p) {
    if (p.empty() || p[0] == '/' || p.find('\\') != std::string::npos || p.find('\0') != std::string::npos) return false;
    size_t start = 0;
    while (start <= p.size()) {
        const size_t end = p.find('/', start);
        const std::string part = p.substr(start, end == std::string::npos ? std::string::npos : end - start);
        if (part.empty() || part == "." || part == "..") return false;
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return true;
}

// What a package may unpack to. The sizes come from the zip's own directory, so they are checked before anything is allocated.
constexpr size_t kMaxEntries = 10000;
constexpr size_t kMaxEntryBytes = size_t(512) << 20;
constexpr size_t kMaxTotalBytes = size_t(1024) << 20;

}  // namespace

Digest sha256(const uint8_t* data, size_t size) {
    const juce::SHA256 h(data, size);
    Digest out{};
    std::memcpy(out.data(), h.getRawData().getData(), 32);
    return out;
}

std::string toHex(const uint8_t* data, size_t size) {
    static const char* digits = "0123456789abcdef";
    std::string out;
    for (size_t i = 0; i < size; ++i) { out += digits[data[i] >> 4]; out += digits[data[i] & 15]; }
    return out;
}

std::vector<uint8_t> fromHex(const std::string& hex) {
    std::vector<uint8_t> out;
    auto nibble = [](char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; };
    for (size_t i = 0; i + 1 < hex.size(); i += 2) {
        const int a = nibble(hex[i]), b = nibble(hex[i + 1]);
        if (a < 0 || b < 0) return {};
        out.push_back((uint8_t)(a * 16 + b));
    }
    return out;
}

Entries singleFile(const std::string& name, const Digest& sha) {
    Entries e;
    e[name] = FileInfo{sha, false};
    return e;
}

bool contentDigest(const Entries& entries, Digest& out, std::string& error) {
    std::vector<uint8_t> msg;
    const std::string domain = "BLEEP-CONTENT-1\n";
    msg.insert(msg.end(), domain.begin(), domain.end());
    auto put32 = [&](uint32_t n) { for (int s = 24; s >= 0; s -= 8) msg.push_back((uint8_t)(n >> s)); };
    put32((uint32_t)entries.size());
    for (const auto& [path, info] : entries) {  // std::map orders std::string bytewise
        if (!safePath(path)) { error = "bad path in package: " + path; return false; }
        put32((uint32_t)path.size());
        msg.insert(msg.end(), path.begin(), path.end());
        msg.insert(msg.end(), info.sha.begin(), info.sha.end());
        msg.push_back(info.executable ? 1 : 0);
    }
    out = sha256(msg.data(), msg.size());
    return true;
}

bool readPackage(const uint8_t* data, size_t size, Package& out, std::string& error) {
    out = Package{};
    if (size < 22) { error = "not a zip file"; return false; }
    long eocd = -1;
    for (long i = (long)size - 22; i >= 0 && i >= (long)size - 22 - 65535; --i)
        if (u32(data + i) == 0x06054b50) { eocd = i; break; }
    if (eocd < 0) { error = "not a zip file"; return false; }
    const int count = u16(data + eocd + 10);
    if ((size_t)count > kMaxEntries) { error = "too many files in the package"; return false; }
    size_t total = 0;
    size_t at = u32(data + eocd + 16);
    for (int n = 0; n < count; ++n) {
        if (at + 46 > size || u32(data + at) != 0x02014b50) { error = "bad zip directory"; return false; }
        const uint16_t madeBy = u16(data + at + 4), method = u16(data + at + 10);
        const uint32_t csize = u32(data + at + 20), usize = u32(data + at + 24), ext = u32(data + at + 38), local = u32(data + at + 42);
        const uint16_t nameLen = u16(data + at + 28), extraLen = u16(data + at + 30), commentLen = u16(data + at + 32);
        if (at + 46 + nameLen > size) { error = "bad zip directory"; return false; }
        const std::string name(reinterpret_cast<const char*>(data + at + 46), nameLen);
        at += 46u + nameLen + extraLen + commentLen;
        if (!name.empty() && name.back() == '/') continue;
        if (csize == 0xFFFFFFFFu || usize == 0xFFFFFFFFu) { error = "zip64 is not supported"; return false; }
        // Deflate cannot do better than about 1032:1, so a bigger claim is a lie meant to make us allocate.
        if (usize > kMaxEntryBytes || (method == 8 && (uint64_t)usize > (uint64_t)csize * 1100 + 1024)) { error = "file too large in package: " + name; return false; }
        if (method == 0 && usize != csize) { error = "size mismatch in " + name; return false; }
        total += usize;
        if (total > kMaxTotalBytes) { error = "the package unpacks to too much"; return false; }
        if ((madeBy >> 8) == 3 && (ext >> 28) == 0xA) { error = "symlink in package: " + name; return false; }
        if (out.files.count(name) || (name == "META/signature.json" && out.hasSignature)) { error = "duplicate file in package: " + name; return false; }
        if ((size_t)local + 30 > size || u32(data + local) != 0x04034b50) { error = "bad zip entry: " + name; return false; }
        const size_t start = (size_t)local + 30 + u16(data + local + 26) + u16(data + local + 28);
        if (start + csize > size) { error = "bad zip entry: " + name; return false; }
        std::vector<uint8_t> body;
        if (method == 0) {
            body.assign(data + start, data + start + csize);
        } else if (method == 8) {
            juce::MemoryInputStream raw(data + start, csize, false);
            juce::GZIPDecompressorInputStream inflate(&raw, false, juce::GZIPDecompressorInputStream::deflateFormat, (juce::int64)usize);
            body.resize(usize);
            const int got = inflate.read(body.data(), (int)usize);
            if (got != (int)usize) { error = "cannot inflate " + name; return false; }
        } else {
            error = "unsupported compression in " + name;
            return false;
        }
        if (body.size() != usize) { error = "size mismatch in " + name; return false; }
        if (name == "META/signature.json") {
            out.hasSignature = true;
            out.signature = juce::JSON::parse(juce::String::fromUTF8(reinterpret_cast<const char*>(body.data()), (int)body.size()));
            continue;
        }
        FileInfo info;
        info.sha = sha256(body.data(), body.size());
        info.executable = (madeBy >> 8) == 3 && ((ext >> 16) & 0111) != 0;
        out.entries[name] = info;
        out.files[name] = std::move(body);
    }
    return true;
}

}  // namespace bleep::library
