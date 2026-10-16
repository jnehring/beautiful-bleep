// SPDX-License-Identifier: MIT
//
// BridgeProtocol.h — how Bleep Audio Bridge plugins in Live and the Bleep
// Patch app exchange audio (spec §11.3).
//
// The app creates one named shared-memory segment and one named wake-up
// semaphore. Each bridge plugin claims a slot in the segment. While bridges
// are connected, Live's audio blocks drive the app:
//
//   host block N   every bridge writes its audio into in[N]   (tagged N)
//                  the first bridge of block N+1 marks N ready and wakes the app
//                  the app processes block N, writes out[N]
//   host block N+2 every bridge reads out[N]                   → two blocks of latency
//
// Frames are guarded by sequence locks (odd while written), so a frame is
// never used half-written. All fields are plain data or lock-free atomics,
// valid across processes. Versioned: a bridge refuses a segment with a
// different kMagic, kVersion or layout size.
//
// Version 2 (doc/specs/bridges.md §10.1): a slot says which port plugin it
// stands for (portKind) and which board is on the other side (board); frames
// carry MIDI next to the audio. The app makes every claimed slot an instance
// of its portKind, so "Bleep Audio In with Board = App" is the app's Audio In.
#pragma once

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <string>

namespace bleep::bridge {

constexpr uint32_t kMagic = 0x424c4252;  // "BLBR"
constexpr uint32_t kVersion = 2;
constexpr int kMaxBridges = 32;
constexpr int kMaxBlock = 2048;          ///< larger host blocks are processed in part
constexpr int kMaxMidi = 256;            ///< MIDI events per block and direction
constexpr int kRing = 4;
constexpr int64_t kAliveMs = 500;        ///< a heartbeat older than this means "gone"

static_assert(std::atomic<int64_t>::is_always_lock_free, "64-bit atomics must be lock-free across processes");

struct Transport {
    double sampleRate = 48000.0;
    double bpm = 120.0;
    double ppq = 0.0;
    int64_t samplePos = 0;
    uint8_t ppqValid = 0;
    uint8_t playing = 0;
    uint8_t pad[6] = {};
};

/// Same layout as engine::MidiEvent, so the protocol stays free of the engine's headers.
struct Midi {
    int32_t offset = 0;   ///< sample inside the block
    uint8_t bytes[3] = {0, 0, 0};
    uint8_t size = 0;
};

/// Which board a port plugin talks to (doc/specs/bridges.md §1).
enum class Board : uint32_t { ThisSet = 0, App = 1, Web = 2 };

struct Frame {
    std::atomic<uint32_t> seq;
    uint32_t pad;
    int64_t block;
    int32_t numSamples;
    int32_t numChannels;
    Transport transport;
    float audio[2][kMaxBlock];
    int32_t numMidi;
    int32_t pad2;
    Midi midi[kMaxMidi];

    void beginWrite(int64_t b) noexcept {
        seq.store(seq.load(std::memory_order_relaxed) | 1u, std::memory_order_relaxed);
        std::atomic_thread_fence(std::memory_order_release);
        block = b;
    }
    void endWrite() noexcept { seq.store((seq.load(std::memory_order_relaxed) | 1u) + 1u, std::memory_order_release); }
};

/// Copies frame `src` (if it holds block `b` and wasn't torn) into `left`/`right`. [RT]
/// With `midi` (room for kMaxMidi events) the frame's MIDI is copied too, and `numMidi` set.
inline bool readFrame(const Frame& src, int64_t b, float* left, float* right, int capacity, int& numSamples,
                      Transport* transport = nullptr, Midi* midi = nullptr, int* numMidi = nullptr) noexcept {
    const uint32_t s1 = src.seq.load(std::memory_order_acquire);
    if ((s1 & 1u) != 0 || src.block != b) return false;
    const int n = std::max(0, std::min(std::min(src.numSamples, kMaxBlock), capacity));
    if (left) std::memcpy(left, src.audio[0], sizeof(float) * (size_t)n);
    if (right) std::memcpy(right, src.audio[1], sizeof(float) * (size_t)n);
    if (transport) *transport = src.transport;
    int m = 0;
    if (midi) {
        // The peer is untrusted: clamp sizes to the 3 data bytes and drop events outside the block.
        const int total = std::max(0, std::min(src.numMidi, kMaxMidi));
        for (int i = 0; i < total; ++i) {
            Midi e = src.midi[i];
            if (e.offset < 0 || e.offset >= n) continue;
            if (e.size > 3) e.size = 3;
            midi[m++] = e;
        }
    }
    std::atomic_thread_fence(std::memory_order_acquire);
    if (src.seq.load(std::memory_order_relaxed) != s1) return false;
    numSamples = n;
    if (numMidi) *numMidi = m;
    return true;
}

struct Slot {
    std::atomic<uint32_t> state;        ///< 0 free, 1 claimed by a bridge
    std::atomic<uint32_t> generation;   ///< changes on claim and on renames
    std::atomic<int32_t> ownerPid;
    std::atomic<int64_t> ownerHeartbeatMs;
    std::atomic<int64_t> lastBlock;     ///< last host block this bridge handed over
    std::atomic<uint32_t> drops;        ///< blocks the app didn't deliver in time
    std::atomic<int32_t> maxBlock;
    std::atomic<int64_t> sampleRateMilli;
    std::atomic<uint32_t> portKind;     ///< engine::PortKind of the plugin (AudioBridge for the Bleep Audio Bridge)
    std::atomic<uint32_t> board;        ///< Board: where the plugin's other side is
    std::atomic<int32_t> extraLatency;  ///< app → plugin: samples to add to the two blocks (web round trip)
    char id[40];                        ///< stable bridge ID (UUID), NUL-terminated
    char track[64];                     ///< Live track name, NUL-terminated
    Frame in[kRing];                    ///< bridge → app
    Frame out[kRing];                   ///< app → bridge
};

struct Shared {
    uint32_t magic;
    uint32_t version;
    uint32_t layoutSize;
    uint32_t pad;
    std::atomic<int32_t> appPid;
    std::atomic<int64_t> appHeartbeatMs;
    std::atomic<int32_t> hostPid;       ///< the host process whose bridges drive the app
    std::atomic<int64_t> hostHeartbeatMs;
    std::atomic<int64_t> ticks;         ///< host block counter for claiming (spec §5.3)
    std::atomic<int64_t> readyBlock;    ///< every bridge has handed over this block
    std::atomic<int64_t> doneBlock;     ///< the app has processed this block
    Slot slots[kMaxBridges];
};

inline int64_t nowMs() noexcept {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

inline void copyString(char* dst, size_t capacity, const std::string& src) noexcept {
    const size_t n = std::min(src.size(), capacity - 1);
    std::memcpy(dst, src.data(), n);
    dst[n] = 0;
}

/// Names of the segment and the semaphore. Tests use their own suffix
/// (BLEEP_BRIDGE_NAMESPACE) so a running app isn't disturbed.
std::string segmentName();
std::string semaphoreName();

/// A named shared-memory segment holding one Shared.
class SharedMemory {
public:
    /// create = true (app): makes a fresh, zeroed, initialised segment.
    /// create = false (bridge): maps an existing one; null if absent or incompatible.
    static SharedMemory* open(bool create);
    /// The last open(false) on this thread failed because a segment exists but is of another version or layout.
    static bool lastOpenWasIncompatible() noexcept;
    ~SharedMemory();
    Shared* get() const noexcept { return shared_; }

private:
    SharedMemory() = default;
    Shared* shared_ = nullptr;
    [[maybe_unused]] void* handle_ = nullptr;  // Windows: the mapping handle
    bool owner_ = false;
};

/// A named counting semaphore (Windows: an auto-reset event).
class WakeSignal {
public:
    static WakeSignal* open(bool create);
    ~WakeSignal();
    void post() noexcept;   ///< [RT] safe
    void wait() noexcept;   ///< blocks until posted
private:
    WakeSignal() = default;
    void* handle_ = nullptr;
    bool owner_ = false;
};

int processId() noexcept;
bool processAlive(int pid) noexcept;

}  // namespace bleep::bridge
