// SPDX-License-Identifier: MIT
#include "BridgeServer.h"

#include <thread>

namespace bleep::bridge {

namespace {
constexpr int64_t kSlotAliveMs = 2000;  ///< plugins poll a few times per second, on Live's busy UI thread
}

BridgeServer::BridgeServer(engine::Engine& engine, ExtraPorts extra, AfterBlock after)
    : juce::Thread("Bleep Audio Bridge"), engine_(engine), extra_(std::move(extra)), after_(std::move(after)) {
    memory_.reset(SharedMemory::open(true));
    wake_.reset(WakeSignal::open(true));
    for (auto& p : proxies_) {
        for (int ch = 0; ch < 2; ++ch) {
            p.in[ch].assign(kMaxBlock, 0.0f);
            p.out[ch].assign(kMaxBlock, 0.0f);
            p.inPtrs[ch] = p.in[ch].data();
            p.outPtrs[ch] = p.out[ch].data();
        }
        p.io.audioIn = p.inPtrs;
        p.io.numAudioIn = 2;
        p.io.audioOut = p.outPtrs;
        p.io.numAudioOut = 2;
    }
    handles_.reserve(kMaxBridges + 64);
    used_.reserve(kMaxBridges);
    ios_.reserve(kMaxBridges + 64);
    if (ok()) startRealtimeThread(juce::Thread::RealtimeOptions{}.withPriority(10));
}

BridgeServer::~BridgeServer() {
    signalThreadShouldExit();
    if (wake_) wake_->post();
    stopThread(2000);
    for (int k = 0; k < kMaxBridges; ++k) detach(k);
    if (memory_) memory_->get()->appHeartbeatMs.store(0);  // bridges see "app gone" at once
}

int BridgeServer::connected() const noexcept {
    int n = 0;
    for (const auto& l : live_) n += l.load() ? 1 : 0;
    return n;
}

void BridgeServer::detach(int k) {
    Proxy& p = proxies_[k];
    if (p.handle == 0) return;
    live_[k].store(false);
    while (busy_.load()) std::this_thread::yield();  // the block in flight may still use it
    engine_.unregisterInstance(p.handle);
    p.handle = 0;
    p.id.clear();
}

void BridgeServer::poll() {
    if (!ok()) return;
    Shared& s = *memory_->get();
    s.appHeartbeatMs.store(nowMs());
    const int64_t now = nowMs();
    for (int k = 0; k < kMaxBridges; ++k) {
        Slot& slot = s.slots[k];
        const bool claimed = slot.state.load() == 1 && now - slot.ownerHeartbeatMs.load() < kSlotAliveMs &&
                             processAlive(slot.ownerPid.load());
        Proxy& p = proxies_[k];
        if (!claimed) {
            detach(k);
            continue;
        }
        const uint32_t gen = slot.generation.load();
        const std::string id(slot.id, strnlen(slot.id, sizeof slot.id));
        if (p.handle != 0 && p.id != id) detach(k);
        if (p.handle == 0) {
            // The bridge's ID makes it the same node across sessions (spec §11.3).
            p.handle = engine_.registerInstance(engine::PortKind::AudioBridge);
            if (p.handle == 0) continue;
            engine_.restoreInstanceId(p.handle, id.c_str());
            p.id = id;
            p.generation = gen - 1;
        }
        if (p.generation != gen) {
            p.generation = gen;
            engine_.setTrack(p.handle, std::string(slot.track, strnlen(slot.track, sizeof slot.track)).c_str(), 0);
        }
        const double rate = (double)slot.sampleRateMilli.load() / 1000.0;
        engine_.prepare(p.handle, rate > 0.0 ? rate : 48000.0, std::max(1, (int)slot.maxBlock.load()));
        live_[k].store(true);
    }
}

void BridgeServer::run() {
    Shared& s = *memory_->get();
    while (!threadShouldExit()) {
        wake_->wait();
        if (threadShouldExit()) break;
        const int64_t ready = s.readyBlock.load(std::memory_order_acquire);
        // Catch up block by block while the frames are still in the ring;
        // after a long gap (reconnect, stall) start again at the newest.
        if (ready - done_ > kRing - 2) done_ = ready - 1;
        while (done_ < ready && !threadShouldExit()) processBlock(done_ + 1);
    }
}

void BridgeServer::processBlock(int64_t block) {
    Shared& s = *memory_->get();
    busy_.store(true);
    handles_.clear();
    ios_.clear();
    used_.clear();
    engine::Transport transport;
    int n = 0;
    for (int k = 0; k < kMaxBridges; ++k) {
        if (!live_[k].load()) continue;
        Proxy& p = proxies_[k];
        int got = 0;
        Transport t;
        if (readFrame(s.slots[k].in[block % kRing], block, p.in[0].data(), p.in[1].data(), kMaxBlock, got, &t)) {
            if (n == 0) {
                transport.sampleRate = t.sampleRate;
                transport.bpm = t.bpm;
                transport.ppq = t.ppq;
                transport.ppqValid = t.ppqValid != 0;
                transport.playing = t.playing != 0;
                transport.samplePos = t.samplePos;
            }
            n = std::max(n, got);
            p.io.numSamples = got;
        } else {
            p.io.numSamples = 0;  // this bridge didn't hand over the block
        }
        handles_.push_back(p.handle);
        ios_.push_back(&p.io);
        used_.push_back(k);
    }
    if (n > 0) {
        for (auto* io : ios_) {
            if (io->numSamples == 0) {  // silence for a missing input, but keep the block length
                std::fill_n(const_cast<float*>(io->audioIn[0]), n, 0.0f);
                std::fill_n(const_cast<float*>(io->audioIn[1]), n, 0.0f);
            }
            io->numSamples = n;
            io->transport = transport;
        }
        if (extra_) extra_(transport, n, handles_, ios_);
        engine_.processAll(handles_.data(), ios_.data(), (int)handles_.size());
        for (const int k : used_) {
            Proxy& p = proxies_[k];
            Frame& o = s.slots[k].out[block % kRing];
            o.beginWrite(block);
            o.numSamples = n;
            o.numChannels = 2;
            for (int ch = 0; ch < 2; ++ch) {
                if (p.io.boardAudioValid) std::memcpy(o.audio[ch], p.out[ch].data(), sizeof(float) * (size_t)n);
                else std::fill_n(o.audio[ch], n, 0.0f);
            }
            o.endWrite();
        }
        if (after_) after_(handles_, ios_);
        lastDriveMs_.store(nowMs());
    }
    done_ = block;
    s.doneBlock.store(block, std::memory_order_release);
    busy_.store(false);
}

}  // namespace bleep::bridge
