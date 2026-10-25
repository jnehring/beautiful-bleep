// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// The bleep_record_* imports of the wasm host (developers/modules/module-abi.md, section 5b): a hand-assembled module calls all seven
// in a row (a second one calls bleep_record_room); a fake handler checks every argument and result as they cross, and the real DiskRecorder writes the files.
// The module (scripts to rebuild it: the bytes below were made with a 60-line assembler; node's WebAssembly.validate accepts it):
//   go() { h = open(spec, 86, 48000.0, 1); take(h, 1); write(h, 0, 256, 512, 4); write(h, 1, 256, 512, 4); take(h, 0);
//          mem[1100] = status(h, 1024, 1032); mem[1104] = text(h, 1, 2048, 100); mem[1112] = free();
//          mem[1120] = text(0, 0, 3000, 10); close(h); return h; }
// The memory holds the spec JSON at 0 and the floats 0.1 0.2 0.3 0.4 -0.1 -0.2 -0.3 -0.4 at 256 (the right channel is at 512: zeros).
#include "Recording.h"
#include "WasmRecorder.h"
#include "WasmRuntime.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <thread>
#include <vector>

using namespace bleep::engine;
namespace fs = std::filesystem;

static int failures = 0;
#define CHECK(cond, ...)                                       \
    do {                                                       \
        if (!(cond)) {                                         \
            ++failures;                                        \
            std::printf("  FAIL line %d: ", __LINE__);         \
            std::printf(__VA_ARGS__);                          \
            std::printf("\n");                                 \
        }                                                      \
    } while (0)

static const uint8_t kModule[] = {
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x33, 0x08, 0x60, 0x04, 0x7f, 0x7f, 0x7c,
    0x7f, 0x01, 0x7f, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, 0x60, 0x05, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f,
    0x01, 0x7f, 0x60, 0x03, 0x7f, 0x7f, 0x7f, 0x01, 0x7f, 0x60, 0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x01,
    0x7f, 0x60, 0x00, 0x01, 0x7c, 0x60, 0x01, 0x7f, 0x00, 0x60, 0x00, 0x01, 0x7f, 0x02, 0xad, 0x01,
    0x07, 0x03, 0x65, 0x6e, 0x76, 0x11, 0x62, 0x6c, 0x65, 0x65, 0x70, 0x5f, 0x72, 0x65, 0x63, 0x6f,
    0x72, 0x64, 0x5f, 0x6f, 0x70, 0x65, 0x6e, 0x00, 0x00, 0x03, 0x65, 0x6e, 0x76, 0x11, 0x62, 0x6c,
    0x65, 0x65, 0x70, 0x5f, 0x72, 0x65, 0x63, 0x6f, 0x72, 0x64, 0x5f, 0x74, 0x61, 0x6b, 0x65, 0x00,
    0x01, 0x03, 0x65, 0x6e, 0x76, 0x12, 0x62, 0x6c, 0x65, 0x65, 0x70, 0x5f, 0x72, 0x65, 0x63, 0x6f,
    0x72, 0x64, 0x5f, 0x77, 0x72, 0x69, 0x74, 0x65, 0x00, 0x02, 0x03, 0x65, 0x6e, 0x76, 0x13, 0x62,
    0x6c, 0x65, 0x65, 0x70, 0x5f, 0x72, 0x65, 0x63, 0x6f, 0x72, 0x64, 0x5f, 0x73, 0x74, 0x61, 0x74,
    0x75, 0x73, 0x00, 0x03, 0x03, 0x65, 0x6e, 0x76, 0x11, 0x62, 0x6c, 0x65, 0x65, 0x70, 0x5f, 0x72,
    0x65, 0x63, 0x6f, 0x72, 0x64, 0x5f, 0x74, 0x65, 0x78, 0x74, 0x00, 0x04, 0x03, 0x65, 0x6e, 0x76,
    0x11, 0x62, 0x6c, 0x65, 0x65, 0x70, 0x5f, 0x72, 0x65, 0x63, 0x6f, 0x72, 0x64, 0x5f, 0x66, 0x72,
    0x65, 0x65, 0x00, 0x05, 0x03, 0x65, 0x6e, 0x76, 0x12, 0x62, 0x6c, 0x65, 0x65, 0x70, 0x5f, 0x72,
    0x65, 0x63, 0x6f, 0x72, 0x64, 0x5f, 0x63, 0x6c, 0x6f, 0x73, 0x65, 0x00, 0x06, 0x03, 0x02, 0x01,
    0x07, 0x05, 0x03, 0x01, 0x00, 0x01, 0x07, 0x0f, 0x02, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79,
    0x02, 0x00, 0x02, 0x67, 0x6f, 0x00, 0x07, 0x0a, 0x88, 0x01, 0x01, 0x85, 0x01, 0x01, 0x01, 0x7f,
    0x41, 0x00, 0x41, 0xd6, 0x00, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x70, 0xe7, 0x40, 0x41, 0x01,
    0x10, 0x00, 0x21, 0x00, 0x20, 0x00, 0x41, 0x01, 0x10, 0x01, 0x1a, 0x20, 0x00, 0x41, 0x00, 0x41,
    0x80, 0x02, 0x41, 0x80, 0x04, 0x41, 0x04, 0x10, 0x02, 0x1a, 0x20, 0x00, 0x41, 0x01, 0x41, 0x80,
    0x02, 0x41, 0x80, 0x04, 0x41, 0x04, 0x10, 0x02, 0x1a, 0x20, 0x00, 0x41, 0x00, 0x10, 0x01, 0x1a,
    0x41, 0xcc, 0x08, 0x20, 0x00, 0x41, 0x80, 0x08, 0x41, 0x88, 0x08, 0x10, 0x03, 0x36, 0x02, 0x00,
    0x41, 0xd0, 0x08, 0x20, 0x00, 0x41, 0x01, 0x41, 0x80, 0x10, 0x41, 0xe4, 0x00, 0x10, 0x04, 0x36,
    0x02, 0x00, 0x41, 0xd8, 0x08, 0x10, 0x05, 0x39, 0x03, 0x00, 0x41, 0xe0, 0x08, 0x41, 0x00, 0x41,
    0x00, 0x41, 0xb8, 0x17, 0x41, 0x0a, 0x10, 0x04, 0x36, 0x02, 0x00, 0x20, 0x00, 0x10, 0x06, 0x20,
    0x00, 0x0b, 0x0b, 0x82, 0x01, 0x02, 0x00, 0x41, 0x00, 0x0b, 0x56, 0x7b, 0x22, 0x6e, 0x61, 0x6d,
    0x65, 0x22, 0x3a, 0x22, 0x54, 0x65, 0x73, 0x74, 0x2f, 0x43, 0x6f, 0x6e, 0x73, 0x6f, 0x6c, 0x65,
    0x22, 0x2c, 0x22, 0x74, 0x72, 0x61, 0x63, 0x6b, 0x73, 0x22, 0x3a, 0x5b, 0x7b, 0x22, 0x6e, 0x61,
    0x6d, 0x65, 0x22, 0x3a, 0x22, 0x41, 0x22, 0x2c, 0x22, 0x63, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c,
    0x73, 0x22, 0x3a, 0x31, 0x7d, 0x2c, 0x7b, 0x22, 0x6e, 0x61, 0x6d, 0x65, 0x22, 0x3a, 0x22, 0x42,
    0x22, 0x2c, 0x22, 0x63, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x73, 0x22, 0x3a, 0x32, 0x7d, 0x5d,
    0x7d, 0x00, 0x41, 0x80, 0x02, 0x0b, 0x20, 0xcd, 0xcc, 0xcc, 0x3d, 0xcd, 0xcc, 0x4c, 0x3e, 0x9a,
    0x99, 0x99, 0x3e, 0xcd, 0xcc, 0xcc, 0x3e, 0xcd, 0xcc, 0xcc, 0xbd, 0xcd, 0xcc, 0x4c, 0xbe, 0x9a,
    0x99, 0x99, 0xbe, 0xcd, 0xcc, 0xcc, 0xbe,
};

// go() { mem[16] = bleep_record_room(0, 6); return 0; }, with "/tmp/x" at 0.
static const uint8_t kRoomModule[] = {
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x0b, 0x02, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7c, 0x60, 0x00, 0x01, 0x7f,
    0x02, 0x19, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x11, 'b', 'l', 'e', 'e', 'p', '_', 'r', 'e', 'c', 'o', 'r', 'd', '_', 'r', 'o', 'o', 'm', 0x00, 0x00,
    0x03, 0x02, 0x01, 0x01, 0x05, 0x03, 0x01, 0x00, 0x01,
    0x07, 0x0f, 0x02, 0x06, 'm', 'e', 'm', 'o', 'r', 'y', 0x02, 0x00, 0x02, 'g', 'o', 0x00, 0x01,
    0x0a, 0x11, 0x01, 0x0f, 0x00, 0x41, 0x10, 0x41, 0x00, 0x41, 0x06, 0x10, 0x00, 0x39, 0x03, 0x00, 0x41, 0x00, 0x0b,
    0x0b, 0x0c, 0x01, 0x00, 0x41, 0x00, 0x0b, 0x06, '/', 't', 'm', 'p', '/', 'x',
};

struct Fake final : wasm::RecordHandler {
    std::string spec;
    double rate = 0;
    int format = -1, opened = 0, closed = 0, begins = 0, ends = 0, writes = 0;
    std::vector<float> leftOf[2], rightOf[2];
    int32_t open(const std::string& s, double sr, int32_t f) override { spec = s; rate = sr; format = f; ++opened; return 5; }
    bool take(int32_t h, bool begin) override { if (h != 5) return false; (begin ? begins : ends)++; return true; }
    bool write(int32_t h, int32_t track, const float* l, const float* r, int32_t frames) override {
        if (h != 5 || track < 0 || track > 1) return false;
        leftOf[track].assign(l, l + frames);
        rightOf[track].assign(r, r + frames);
        ++writes;
        return true;
    }
    int32_t status(int32_t h, int64_t& frames, int32_t& take) override { if (h != 5) return 0; frames = 4; take = 1; return 3; }
    std::string text(int32_t h, int32_t what) override { return what == 1 && h == 5 ? "disk is slow" : what == 0 ? "/tmp/Recordings" : ""; }
    std::string roomFolder = "unset";
    double freeBytes(const std::string& folder) override { roomFolder = folder; return folder.empty() ? 1234.5 : 99.0; }
    void close(int32_t h) override { if (h == 5) ++closed; }
};

static std::unique_ptr<wasm::Instance> instance(wasm::RecordHandler* handler) {
    std::string error;
    auto compiled = wasm::Compiled::compile(kModule, sizeof kModule, error);
    CHECK(compiled != nullptr, "compile: %s", error.c_str());
    if (!compiled) return nullptr;
    auto inst = wasm::Instance::create(compiled, error);
    CHECK(inst != nullptr, "instantiate: %s", error.c_str());
    if (inst && handler) inst->setRecorder(handler);
    return inst;
}

template <class T>
static T at(wasm::Instance& inst, size_t off) {
    T v{};
    if (off + sizeof(T) <= inst.memorySize()) std::memcpy(&v, inst.memory() + off, sizeof(T));
    return v;
}

static void marshalling() {
    std::printf("every argument and result crosses the boundary intact\n");
    Fake fake;
    auto inst = instance(&fake);
    if (!inst) return;
    const int go = inst->find("go");
    const int32_t h = inst->call(go);
    CHECK(h == 5, "handle %d", h);
    CHECK(fake.opened == 1 && fake.rate == 48000.0 && fake.format == 1, "open: %d %f %d", fake.opened, fake.rate, fake.format);
    CHECK(fake.spec == R"({"name":"Test/Console","tracks":[{"name":"A","channels":1},{"name":"B","channels":2}]})", "spec: %s", fake.spec.c_str());
    CHECK(fake.begins == 1 && fake.ends == 1 && fake.writes == 2 && fake.closed == 1, "calls: %d %d %d %d", fake.begins, fake.ends, fake.writes, fake.closed);
    CHECK(fake.leftOf[0].size() == 4 && std::fabs(fake.leftOf[0][2] - 0.3f) < 1e-6f && std::fabs(fake.leftOf[1][3] - 0.4f) < 1e-6f, "left channel");
    CHECK(fake.rightOf[0].size() == 4 && fake.rightOf[0][0] == 0.0f, "right channel (zeros at 512)");
    CHECK(at<int32_t>(*inst, 1100) == 3, "status flags %d", at<int32_t>(*inst, 1100));
    CHECK(at<int64_t>(*inst, 1024) == 4 && at<int32_t>(*inst, 1032) == 1, "status frames %lld take %d", (long long)at<int64_t>(*inst, 1024), at<int32_t>(*inst, 1032));
    CHECK(at<int32_t>(*inst, 1104) == 12 && std::memcmp(inst->memory() + 2048, "disk is slow", 12) == 0, "message text");
    CHECK(at<double>(*inst, 1112) == 1234.5, "free %f", at<double>(*inst, 1112));
    CHECK(at<int32_t>(*inst, 1120) == 10 && std::memcmp(inst->memory() + 3000, "/tmp/Recor", 10) == 0, "folder text is cut to the capacity");
}

static void roomOfAFolder() {
    std::printf("bleep_record_room hands the module's folder to the host and returns the room there\n");
    std::string error;
    auto compiled = wasm::Compiled::compile(kRoomModule, sizeof kRoomModule, error);
    CHECK(compiled != nullptr, "compile: %s", error.c_str());
    if (!compiled) return;
    auto inst = wasm::Instance::create(compiled, error);
    CHECK(inst != nullptr, "instantiate: %s", error.c_str());
    if (!inst) return;
    Fake fake;
    inst->setRecorder(&fake);
    inst->call(inst->find("go"));
    CHECK(fake.roomFolder == "/tmp/x" && at<double>(*inst, 16) == 99.0, "room: '%s' %f", fake.roomFolder.c_str(), at<double>(*inst, 16));
}

static void noRecorder() {
    std::printf("a host without a recorder answers 0 and nothing breaks\n");
    auto inst = instance(nullptr);
    if (!inst) return;
    CHECK(inst->call(inst->find("go")) == 0, "open should return 0");
    CHECK(at<double>(*inst, 1112) == 0.0, "free should be 0");
}

static void realFiles() {
    std::printf("the disk recorder writes one file per track\n");
    const fs::path root = fs::temp_directory_path() / "bleep-wasm-record-test";
    fs::remove_all(root);
    recording::setFolder(root.string());
    wasm::DiskRecorder recorder;
    auto inst = instance(&recorder);
    if (!inst) return;
    CHECK(inst->call(inst->find("go")) == 1, "handle");
    fs::path dir;
    for (int i = 0; i < 400 && dir.empty(); ++i) {  // close() finishes the files on another thread
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        if (fs::exists(root))
            for (const auto& e : fs::directory_iterator(root))
                if (e.is_directory() && fs::exists(e.path() / "B.wav") && fs::file_size(e.path() / "B.wav") == 44 + 4 * 2 * 3) dir = e.path();
    }
    CHECK(!dir.empty(), "files were not finished");
    if (dir.empty()) return;
    CHECK(dir.filename().string().find("Test-Console") != std::string::npos, "session folder %s", dir.filename().string().c_str());
    auto read = [&](const char* name) {
        std::ifstream in(dir / name, std::ios::binary);
        return std::vector<uint8_t>((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    };
    const auto a = read("A.wav"), b = read("B.wav");
    CHECK(a.size() == 44 + 4 * 1 * 3 && b.size() == 44 + 4 * 2 * 3, "sizes %zu %zu", a.size(), b.size());
    auto s24 = [](const std::vector<uint8_t>& w, size_t i) {
        int32_t v = w[44 + i * 3] | w[45 + i * 3] << 8 | w[46 + i * 3] << 16;
        if (v & 0x800000) v |= ~0xFFFFFF;
        return v / 8388607.0;
    };
    CHECK(a[22] == 1 && b[22] == 2 && a[34] == 24, "format fields");
    CHECK(std::fabs(s24(a, 2) - 0.3) < 1e-6 && std::fabs(s24(a, 3) - 0.4) < 1e-6, "mono samples %f %f", s24(a, 2), s24(a, 3));
    CHECK(std::fabs(s24(b, 4) - 0.3) < 1e-6 && s24(b, 5) == 0.0, "stereo samples");
}

int main() {
    marshalling();
    roomOfAFolder();
    noRecorder();
    realFiles();
    std::printf("wasm record: %d failures\n", failures);
    return failures == 0 ? 0 : 1;
}
