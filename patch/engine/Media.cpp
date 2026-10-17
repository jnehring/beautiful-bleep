// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
#include "Media.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <mutex>

namespace bleep::engine::media {

namespace {

std::mutex g_lock;
std::string g_folder;
std::map<std::string, std::weak_ptr<const MediaClip>> g_cache;

std::string defaultFolder() {
#ifdef _WIN32
    const char* home = std::getenv("USERPROFILE");
#else
    const char* home = std::getenv("HOME");
#endif
    std::filesystem::path p = home ? home : ".";
    return (p / "Music" / "Beautiful Bleep" / "Media").string();
}

namespace fs = std::filesystem;

/// Moves `from` to `to` without overwriting: a folder is merged child by child.
void moveNoClobber(const fs::path& from, const fs::path& to) {
    std::error_code ec;
    if (!fs::exists(from, ec)) return;
    if (!fs::exists(to, ec)) {
        fs::create_directories(to.parent_path(), ec);
        fs::rename(from, to, ec);
        if (!ec) return;
    }
    if (fs::is_directory(from, ec) && fs::is_directory(to, ec)) {
        std::vector<fs::path> kids;
        for (const auto& e : fs::directory_iterator(from, ec)) kids.push_back(e.path());
        for (const auto& k : kids) moveNoClobber(k, to / k.filename());
        fs::remove(from, ec);  // only succeeds when empty
    }
}

fs::path homeDir() {
#ifdef _WIN32
    const char* home = std::getenv("USERPROFILE");
#else
    const char* home = std::getenv("HOME");
#endif
    return home ? fs::path(home) : fs::path(".");
}

fs::path appDataDir() {  // as juce::File::userApplicationDataDirectory
#if defined(_WIN32)
    const char* a = std::getenv("APPDATA");
    return a ? fs::path(a) : homeDir() / "AppData" / "Roaming";
#elif defined(__APPLE__)
    return homeDir() / "Library" / "Application Support";
#else
    return homeDir() / ".config";
#endif
}

uint32_t u16(const uint8_t* p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8); }
uint32_t u32(const uint8_t* p) { return u16(p) | (u16(p + 2) << 16); }

void put16(std::vector<uint8_t>& v, uint32_t x) {
    v.push_back((uint8_t)x);
    v.push_back((uint8_t)(x >> 8));
}
void put32(std::vector<uint8_t>& v, uint32_t x) {
    put16(v, x & 0xffff);
    put16(v, x >> 16);
}

/// FNV-1a over the encoded file: the id is a pure function of the audio.
std::string hashId(const std::vector<uint8_t>& bytes) {
    uint64_t h = 0xcbf29ce484222325ull;
    for (uint8_t b : bytes) h = (h ^ b) * 0x100000001b3ull;
    char buf[32];
    std::snprintf(buf, sizeof buf, "%016llx.wav", (unsigned long long)h);
    return buf;
}

}  // namespace

void migrateLegacyFolders() {
    static std::mutex lock;
    std::lock_guard<std::mutex> guard(lock);
    std::error_code ec;
    const fs::path oldData = appDataDir() / "Bleep Patch", newData = appDataDir() / "Beautiful Bleep";
    if (fs::exists(oldData, ec)) {
        // Whole boards: Patches/*.bleeppatch -> Boards/*.bleeppreset (the content is the same JSON).
        if (fs::is_directory(oldData / "Patches", ec)) {
            fs::create_directories(newData / "Boards", ec);
            std::vector<fs::path> files;
            for (const auto& e : fs::directory_iterator(oldData / "Patches", ec))
                if (e.path().extension() == ".bleeppatch") files.push_back(e.path());
            for (const auto& f : files) {
                fs::path to = newData / "Boards" / f.filename();
                to.replace_extension(".bleeppreset");
                if (!fs::exists(to, ec)) fs::rename(f, to, ec);
            }
            fs::remove(oldData / "Patches", ec);  // only when empty
        }
        // The app's settings file was named after the app.
        if (fs::exists(oldData / "Bleep Patch.settings", ec))
            moveNoClobber(oldData / "Bleep Patch.settings", oldData / "Bleep App.settings");
        moveNoClobber(oldData, newData);
    }
    moveNoClobber(homeDir() / "Music" / "Bleep Patch", homeDir() / "Music" / "Beautiful Bleep");
}

void setFolder(const std::string& path) {
    std::lock_guard<std::mutex> l(g_lock);
    g_folder = path;
}

std::string folder() {
    std::lock_guard<std::mutex> l(g_lock);
    if (g_folder.empty()) g_folder = defaultFolder();
    return g_folder;
}

bool validId(const std::string& id) {
    if (id.size() != 20 || id.compare(16, 4, ".wav") != 0) return false;
    for (size_t i = 0; i < 16; ++i)
        if (!std::isxdigit((unsigned char)id[i])) return false;
    return true;
}

std::shared_ptr<MediaClip> decodeWav(const uint8_t* data, size_t size, std::string* error) {
    auto fail = [&](const char* why) -> std::shared_ptr<MediaClip> {
        if (error) *error = why;
        return nullptr;
    };
    if (!data || size < 12 || std::memcmp(data, "RIFF", 4) != 0 || std::memcmp(data + 8, "WAVE", 4) != 0)
        return fail("not a WAV file");
    uint32_t format = 0, channels = 0, rate = 0, bits = 0;
    const uint8_t* pcm = nullptr;
    size_t pcmSize = 0;
    for (size_t pos = 12; pos + 8 <= size;) {
        const uint32_t len = u32(data + pos + 4);
        const uint8_t* body = data + pos + 8;
        const size_t avail = std::min<size_t>(len, size - pos - 8);
        if (std::memcmp(data + pos, "fmt ", 4) == 0 && avail >= 16) {
            format = u16(body);
            channels = u16(body + 2);
            rate = u32(body + 4);
            bits = u16(body + 14);
            if (format == 0xfffe && avail >= 26) format = u16(body + 24);  // WAVE_FORMAT_EXTENSIBLE: sub-format
        } else if (std::memcmp(data + pos, "data", 4) == 0) {
            pcm = body;
            pcmSize = avail;
        }
        pos += 8 + (size_t)len + (len & 1u);
    }
    if (!pcm || channels == 0 || channels > 64 || rate == 0) return fail("WAV file without audio");
    const bool isFloat = format == 3;
    if (!(format == 1 || isFloat)) return fail("compressed WAV files are not supported");
    if (!(isFloat ? (bits == 32 || bits == 64) : (bits == 8 || bits == 16 || bits == 24 || bits == 32)))
        return fail("unsupported sample format");
    const size_t frameBytes = (size_t)channels * bits / 8;
    const size_t frames = pcmSize / frameBytes;
    auto clip = std::make_shared<MediaClip>();
    clip->sampleRate = rate;
    clip->channels.assign(channels, std::vector<float>(frames));
    for (size_t f = 0; f < frames; ++f)
        for (uint32_t c = 0; c < channels; ++c) {
            const uint8_t* s = pcm + f * frameBytes + (size_t)c * bits / 8;
            float v = 0.0f;
            if (isFloat && bits == 32) std::memcpy(&v, s, 4);
            else if (isFloat) {
                double d;
                std::memcpy(&d, s, 8);
                v = (float)d;
            } else if (bits == 8) v = ((float)s[0] - 128.0f) / 128.0f;
            else if (bits == 16) v = (float)(int16_t)u16(s) / 32768.0f;
            else if (bits == 24) v = (float)((int32_t)(((uint32_t)s[0] << 8) | ((uint32_t)s[1] << 16) | ((uint32_t)s[2] << 24)) >> 8) / 8388608.0f;
            else v = (float)((double)(int32_t)u32(s) / 2147483648.0);
            clip->channels[c][f] = std::isfinite(v) ? v : 0.0f;
        }
    return clip;
}

std::vector<uint8_t> encodeWav(const MediaClip& clip) {
    const uint32_t ch = (uint32_t)std::max(1, clip.numChannels());
    const uint64_t frames = (uint64_t)clip.numFrames();
    const uint32_t dataBytes = (uint32_t)(frames * ch * 4);
    std::vector<uint8_t> v;
    v.reserve(44 + dataBytes);
    v.insert(v.end(), {'R', 'I', 'F', 'F'});
    put32(v, 36 + dataBytes);
    v.insert(v.end(), {'W', 'A', 'V', 'E', 'f', 'm', 't', ' '});
    put32(v, 16);
    put16(v, 3);  // IEEE float
    put16(v, ch);
    put32(v, (uint32_t)clip.sampleRate);
    put32(v, (uint32_t)clip.sampleRate * ch * 4);
    put16(v, ch * 4);
    put16(v, 32);
    v.insert(v.end(), {'d', 'a', 't', 'a'});
    put32(v, dataBytes);
    for (uint64_t f = 0; f < frames; ++f)
        for (uint32_t c = 0; c < ch; ++c) {
            const float x = c < clip.channels.size() ? clip.channels[c][f] : 0.0f;
            uint32_t bitsOf;
            std::memcpy(&bitsOf, &x, 4);
            put32(v, bitsOf);
        }
    return v;
}

std::string save(const MediaClip& clip) {
    const std::vector<uint8_t> bytes = encodeWav(clip);
    const std::string id = hashId(bytes);
    std::error_code ec;
    const std::filesystem::path dir = folder();
    std::filesystem::create_directories(dir, ec);
    const std::filesystem::path file = dir / id;
    if (!std::filesystem::exists(file, ec)) {
        const std::filesystem::path tmp = dir / (id + ".tmp");
        {
            std::ofstream out(tmp, std::ios::binary);
            if (!out) return {};
            out.write((const char*)bytes.data(), (std::streamsize)bytes.size());
            if (!out) return {};
        }
        std::filesystem::rename(tmp, file, ec);
        if (ec) return {};
    }
    return id;
}

std::shared_ptr<const MediaClip> import(const uint8_t* data, size_t size, const std::string& name, std::string* error) {
    auto clip = decodeWav(data, size, error);
    if (!clip) return nullptr;
    clip->name = name;
    clip->id = save(*clip);
    if (clip->id.empty()) {
        if (error) *error = "could not write to the media folder";
        return nullptr;
    }
    std::lock_guard<std::mutex> l(g_lock);
    g_cache[clip->id] = clip;
    return clip;
}

#ifdef __wasm__
// A module file has no disk. The host reads the media folder and hands the samples over through two imports
// (developers/modules/module-abi.md, "Media"); a clip it does not have yet is "missing", and the host sends the module's node data
// again when the clip has been read, so a module that loads in setData() simply loads again.
extern "C" {
__attribute__((import_module("env"), import_name("bleep_media_info")))
int64_t bleep_media_info(const char* id, int32_t idLength, double* sampleRate, int32_t* channels);
__attribute__((import_module("env"), import_name("bleep_media_read")))
int32_t bleep_media_read(const char* id, int32_t idLength, int32_t channel, float* dst, int64_t frames);
}

std::shared_ptr<const MediaClip> load(const std::string& id) {
    if (!validId(id)) return nullptr;
    double rate = 0.0;
    int32_t channels = 0;
    const int64_t frames = bleep_media_info(id.data(), (int32_t)id.size(), &rate, &channels);
    if (frames <= 0 || channels <= 0 || channels > 8 || rate <= 0.0) return nullptr;
    auto clip = std::make_shared<MediaClip>();
    clip->id = id;
    clip->sampleRate = rate;
    clip->channels.assign((size_t)channels, std::vector<float>((size_t)frames));
    for (int32_t ch = 0; ch < channels; ++ch)
        if (!bleep_media_read(id.data(), (int32_t)id.size(), ch, clip->channels[(size_t)ch].data(), frames)) return nullptr;
    return clip;
}
#else
std::shared_ptr<const MediaClip> load(const std::string& id) {
    if (!validId(id)) return nullptr;
    {
        std::lock_guard<std::mutex> l(g_lock);
        if (auto it = g_cache.find(id); it != g_cache.end())
            if (auto c = it->second.lock()) return c;
    }
    std::ifstream in(std::filesystem::path(folder()) / id, std::ios::binary);
    if (!in) return nullptr;
    std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    auto clip = decodeWav(bytes.data(), bytes.size());
    if (!clip) return nullptr;
    clip->id = id;
    std::lock_guard<std::mutex> l(g_lock);
    g_cache[id] = clip;
    return clip;
}
#endif  // __wasm__

}  // namespace bleep::engine::media
