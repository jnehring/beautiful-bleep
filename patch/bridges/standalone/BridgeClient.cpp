// SPDX-License-Identifier: MIT
#include "BridgeClient.h"

#include <algorithm>
#include <thread>

namespace bleep::bridge {

BridgeClient::BridgeClient() = default;

BridgeClient::~BridgeClient() { disconnect(); }

void BridgeClient::setIdentity(const std::string& id, const std::string& track) {
    if (id != id_) disconnect();  // a new identity claims a new slot
    trackChanged_ |= track != track_;
    id_ = id;
    track_ = track;
}

void BridgeClient::setPort(uint32_t portKind, Board board) {
    portChanged_ |= portKind != portKind_ || board != board_;
    portKind_ = portKind;
    board_ = board;
}

void BridgeClient::prepare(double sampleRate, int maxBlock) {
    sampleRate_ = sampleRate;
    maxBlock_ = std::max(1, std::min(maxBlock, kMaxBlock));
}

uint32_t BridgeClient::drops() const noexcept {
    Shared* s = shared_.load();
    const int k = slot_.load();
    return s && k >= 0 ? s->slots[k].drops.load() : 0;
}

int BridgeClient::extraLatency() const noexcept {
    Shared* s = shared_.load();
    const int k = slot_.load();
    return s && k >= 0 ? std::max(0, s->slots[k].extraLatency.load()) : 0;
}

void BridgeClient::disconnect() {
    Shared* s = shared_.exchange(nullptr);
    const int k = slot_.exchange(-1);
    if (s && k >= 0 && s->slots[k].ownerPid.load() == processId()) {
        s->slots[k].generation.fetch_add(1);
        s->slots[k].state.store(0);
    }
    if (memory_) retired_.push_back(std::move(memory_));  // the audio thread may still hold the old pointer
    wake_.reset();
}

bool BridgeClient::claimSlot() {
    Shared* s = memory_->get();
    idTaken_ = false;
    for (int k = 0; k < kMaxBridges; ++k) {
        const Slot& other = s->slots[k];
        if (other.state.load() == 1 && processAlive(other.ownerPid.load()) &&
            std::strncmp(other.id, id_.c_str(), sizeof other.id) == 0)
            idTaken_ = true;
    }
    for (int k = 0; k < kMaxBridges; ++k) {
        Slot& slot = s->slots[k];
        // A slot of a process that is gone can be reused.
        if (slot.state.load() == 1 && !processAlive(slot.ownerPid.load())) slot.state.store(0);
        uint32_t expected = 0;
        if (!slot.state.compare_exchange_strong(expected, 1)) continue;
        copyString(slot.id, sizeof slot.id, id_);
        copyString(slot.track, sizeof slot.track, track_);
        slot.ownerPid.store(processId());
        slot.ownerHeartbeatMs.store(nowMs());
        slot.lastBlock.store(-1);
        slot.drops.store(0);
        slot.maxBlock.store(maxBlock_);
        slot.sampleRateMilli.store((int64_t)(sampleRate_ * 1000.0));
        slot.portKind.store(portKind_);
        slot.board.store((uint32_t)board_);
        for (auto& f : slot.out) f.block = -1;
        slot.generation.fetch_add(1);
        slot_.store(k);
        return true;
    }
    return false;
}

BridgeClient::Status BridgeClient::poll() {
    Shared* s = shared_.load();
    // The app quit (or restarted with a fresh segment): start over.
    if (s && (nowMs() - s->appHeartbeatMs.load() > kAliveMs || !processAlive(s->appPid.load()))) {
        disconnect();
        s = nullptr;
    }
    if (!s) {
        if (id_.empty()) return status_ = Status::AppNotRunning;
        memory_.reset(SharedMemory::open(false));
        if (!memory_ && SharedMemory::lastOpenWasIncompatible()) return status_ = Status::VersionMismatch;
        if (!memory_ || nowMs() - memory_->get()->appHeartbeatMs.load() > kAliveMs) {
            memory_.reset();
            return status_ = Status::AppNotRunning;
        }
        wake_.reset(WakeSignal::open(false));
        if (!wake_) {
            memory_.reset();
            return status_ = Status::AppNotRunning;
        }
        s = memory_->get();
        if (!claimSlot()) {
            memory_.reset();
            wake_.reset();
            return status_ = Status::NoFreeSlot;
        }
        counter_ = -1;
        shared_.store(s);
    }
    // One host at a time (spec §11.5).
    const int me = processId();
    int host = s->hostPid.load();
    if (host != me && (host == 0 || !processAlive(host) || nowMs() - s->hostHeartbeatMs.load() > kAliveMs)) {
        s->hostPid.compare_exchange_strong(host, me);
        host = s->hostPid.load();
    }
    if (host != me) return status_ = Status::OtherHost;
    s->hostHeartbeatMs.store(nowMs());
    const int k = slot_.load();
    if (k >= 0) {
        Slot& slot = s->slots[k];
        slot.ownerHeartbeatMs.store(nowMs());
        slot.maxBlock.store(maxBlock_);
        slot.sampleRateMilli.store((int64_t)(sampleRate_ * 1000.0));
        if (trackChanged_ || portChanged_) {
            copyString(slot.track, sizeof slot.track, track_);
            slot.portKind.store(portKind_);
            slot.board.store((uint32_t)board_);
            slot.generation.fetch_add(1);
            trackChanged_ = portChanged_ = false;
        }
    }
    return status_ = Status::Connected;
}

bool BridgeClient::process(const float* const* in, float* const* ret, int numChannels, int numSamples,
                           const Transport& t, bool offline) noexcept {
    Block b;
    b.in = in;
    b.ret = ret;
    b.numChannels = numChannels;
    b.numSamples = numSamples;
    b.transport = t;
    b.offline = offline;
    return exchange(b);
}

bool BridgeClient::exchange(Block& b) noexcept {
    b.numMidiOut = 0;
    Shared* s = shared_.load(std::memory_order_acquire);
    const int k = slot_.load(std::memory_order_acquire);
    if (!s || k < 0 || status_.load() != Status::Connected) return false;
    Slot& slot = s->slots[k];
    const int n = std::min(b.numSamples, kMaxBlock);
    const int channels = std::max(1, std::min(b.numChannels, 2));

    // Which host block is this? Same claiming as inside Live (spec §5.3).
    const int64_t T = s->ticks.load(std::memory_order_acquire);
    int64_t c = counter_ < 0 ? T : counter_ + 1;
    bool claimed = false;
    if (c == T + 1) {
        int64_t expected = T;
        claimed = s->ticks.compare_exchange_strong(expected, c, std::memory_order_acq_rel);
        if (!claimed && expected != c) c = expected;
    } else if (c != T) {
        c = T;
    }
    counter_ = c;

    Frame& f = slot.in[c % kRing];
    f.beginWrite(c);
    f.numSamples = n;
    f.numChannels = b.in ? channels : 0;
    f.transport = b.transport;
    if (b.in)
        for (int ch = 0; ch < 2; ++ch) std::memcpy(f.audio[ch], b.in[std::min(ch, channels - 1)], sizeof(float) * (size_t)n);
    f.numMidi = 0;
    for (int i = 0; i < b.numMidiIn && f.numMidi < kMaxMidi; ++i)
        if (b.midiIn[i].offset >= 0 && b.midiIn[i].offset < n) f.midi[f.numMidi++] = b.midiIn[i];
    f.endWrite();
    slot.lastBlock.store(c, std::memory_order_release);

    // The first bridge of this block knows that every bridge finished the last one.
    if (claimed && c > 0) {
        s->readyBlock.store(c - 1, std::memory_order_release);
        if (wake_) wake_->post();
    }

    const int64_t want = c - 2;
    if (want < 0) return false;
    const Frame& o = slot.out[want % kRing];
    if (b.offline) {
        // Not real time: wait for the app, so exports include it.
        const int64_t until = nowMs() + 2000;
        while (s->doneBlock.load(std::memory_order_acquire) < want && nowMs() < until)
            std::this_thread::sleep_for(std::chrono::microseconds(100));
    }
    int got = 0, midi = 0;
    float* left = b.ret ? b.ret[0] : nullptr;
    float* right = b.ret ? (channels > 1 ? b.ret[1] : b.ret[0]) : nullptr;
    if (!readFrame(o, want, left, right, n, got, nullptr, b.midiOut, &midi)) {
        slot.drops.fetch_add(1, std::memory_order_relaxed);
        return false;
    }
    if (b.ret)
        for (int ch = 0; ch < channels; ++ch) std::fill(b.ret[ch] + got, b.ret[ch] + b.numSamples, 0.0f);
    b.numMidiOut = b.midiOut ? midi : 0;
    return true;
}

}  // namespace bleep::bridge
