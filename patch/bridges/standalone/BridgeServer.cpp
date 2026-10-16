// SPDX-License-Identifier: MIT
#include "BridgeServer.h"

#include <algorithm>
#include <cmath>
#include <thread>

namespace bleep::bridge {

namespace {
constexpr int64_t kSlotAliveMs = 2000;  ///< plugins poll a few times per second, on Live's busy UI thread

// The numbers in a slot's portKind are engine::PortKind values; they are part of the wire format (bridges.md §10.1).
static_assert((int)engine::PortKind::MidiIn == 2 && (int)engine::PortKind::MidiOut == 3 &&
              (int)engine::PortKind::AudioIn == 4 && (int)engine::PortKind::AudioOut == 5 &&
              (int)engine::PortKind::Instrument == 6 && (int)engine::PortKind::AudioInsert == 7 &&
              (int)engine::PortKind::AudioBridge == 8, "PortKind values are in the bridge protocol");

bool supportedKind(engine::PortKind k) {
    switch (k) {
        case engine::PortKind::MidiIn:
        case engine::PortKind::MidiOut:
        case engine::PortKind::AudioIn:
        case engine::PortKind::AudioOut:
        case engine::PortKind::Instrument:
        case engine::PortKind::AudioInsert:
        case engine::PortKind::AudioBridge: return true;
        case engine::PortKind::None:
        case engine::PortKind::Patch:
        case engine::PortKind::Link:
        case engine::PortKind::MidiDevice: return false;
    }
}

/// What a plugin of this kind exchanges with the board (mirrors PortProcessor::processBlock).
void usage(engine::PortKind k, bool& audioIn, bool& audioOut, bool& midiIn, bool& midiOut) {
    using engine::PortKind;
    audioIn = k == PortKind::AudioIn || k == PortKind::AudioInsert || k == PortKind::AudioBridge;
    audioOut = k == PortKind::AudioOut || k == PortKind::Instrument || k == PortKind::AudioInsert || k == PortKind::AudioBridge;
    midiIn = k == PortKind::MidiIn || k == PortKind::Instrument;
    midiOut = k == PortKind::MidiOut;
}
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
        p.midiIn.assign(kMaxMidi, Midi{});
        p.midiEvents.assign(kMaxMidi, engine::MidiEvent{});
        p.midiOut.assign(engine::kMaxMidiEvents, engine::MidiEvent{});
    }
    relayIn_.assign(kMaxMidi, Midi{});
    relayOut_.assign(kMaxMidi, Midi{});
    for (int ch = 0; ch < 2; ++ch) {
        relayAudioIn_[ch].assign(kMaxBlock, 0.0f);
        relayAudioOut_[ch].assign(kMaxBlock, 0.0f);
    }
    relayUsed_.reserve(kMaxBridges);
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
    if (relayed_[k].load()) {
        relayed_[k].store(false);
        while (busy_.load()) std::this_thread::yield();
        if (relay_) relay_->slotDetached(k, p.id);
        p.id.clear();
        return;
    }
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
        const bool attached = p.handle != 0 || relayed_[k].load();
        if (!claimed) {
            if (attached) detach(k);
            continue;
        }
        const uint32_t gen = slot.generation.load();
        const std::string id(slot.id, strnlen(slot.id, sizeof slot.id));
        // A plugin from before version 2 never says; Bleep Audio Bridge is the one that doesn't.
        uint32_t kindValue = slot.portKind.load();
        if (kindValue == 0) kindValue = (uint32_t)engine::PortKind::AudioBridge;
        const auto kind = (engine::PortKind)kindValue;
        const uint32_t board = slot.board.load() == (uint32_t)Board::Web ? (uint32_t)Board::Web : (uint32_t)Board::App;
        if (!supportedKind(kind)) {
            if (attached) detach(k);
            continue;
        }
        if (attached && (p.id != id || p.kind != kindValue || p.board != board)) detach(k);
        const std::string track(slot.track, strnlen(slot.track, sizeof slot.track));
        double rate = (double)slot.sampleRateMilli.load() / 1000.0;
        if (!std::isfinite(rate) || rate < 8000.0 || rate > 768000.0) rate = 0.0;  // untrusted: fall back to 48 kHz below
        const int maxBlock = std::clamp((int)slot.maxBlock.load(), 1, kMaxBlock);
        if (board == (uint32_t)Board::Web) {
            if (!relay_) continue;  // no hub: nothing to hand it to
            if (!relayed_[k].load()) {
                p.id = id;
                p.kind = kindValue;
                p.board = board;
                p.track = track;
                p.generation = gen;
                relay_->slotAttached(k, kindValue, id, track, rate > 0.0 ? rate : 48000.0);
                relayed_[k].store(true);
            } else if (p.generation != gen || p.track != track) {
                p.generation = gen;
                p.track = track;
                relay_->slotAttached(k, kindValue, id, track, rate > 0.0 ? rate : 48000.0);
            }
            slot.extraLatency.store(relay_->slotLatency(k));
            continue;
        }
        slot.extraLatency.store(0);
        if (p.handle == 0) {
            // The bridge's ID makes it the same node across sessions (spec §11.3).
            p.handle = engine_.registerRemoteInstance(kind);
            if (p.handle == 0) continue;
            engine_.restoreInstanceId(p.handle, id.c_str());
            p.id = id;
            p.kind = kindValue;
            p.board = board;
            p.generation = gen - 1;
            usage(kind, p.audioIn, p.audioOut, p.midiIn_, p.midiOut_);
            p.io = engine::BlockIO{};
            p.io.audioIn = p.audioIn ? p.inPtrs : nullptr;
            p.io.numAudioIn = p.audioIn ? 2 : 0;
            p.io.audioOut = p.audioOut ? p.outPtrs : nullptr;
            p.io.numAudioOut = p.audioOut ? 2 : 0;
            p.io.midiIn = p.midiIn_ ? p.midiEvents.data() : nullptr;
            p.io.midiOut = p.midiOut_ ? p.midiOut.data() : nullptr;
            p.io.midiOutCapacity = p.midiOut_ ? (int)p.midiOut.size() : 0;
        }
        if (p.generation != gen) {
            p.generation = gen;
            engine_.setTrack(p.handle, track.c_str(), 0);
        }
        engine_.prepare(p.handle, rate > 0.0 ? rate : 48000.0, maxBlock);
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
    relayUsed_.clear();
    engine::Transport transport;
    bool haveTransport = false;
    int n = 0;
    auto adopt = [&](const Transport& t) {
        if (haveTransport) return;
        haveTransport = true;
        transport.sampleRate = t.sampleRate;
        transport.bpm = t.bpm;
        transport.ppq = t.ppq;
        transport.ppqValid = t.ppqValid != 0;
        transport.playing = t.playing != 0;
        transport.samplePos = t.samplePos;
    };
    for (int k = 0; k < kMaxBridges; ++k) {
        if (relayed_[k].load()) {
            Proxy& p = proxies_[k];
            Transport t;
            int got = 0, numMidi = 0;
            p.relayGot = readFrame(s.slots[k].in[block % kRing], block, p.in[0].data(), p.in[1].data(), kMaxBlock, got, &t,
                                   p.midiIn.data(), &numMidi);
            p.relayMidi = p.relayGot ? numMidi : 0;
            p.relaySamples = p.relayGot ? got : 0;
            if (p.relayGot) {
                adopt(t);
                n = std::max(n, got);
                p.relayTransport = t;
            }
            relayUsed_.push_back(k);
            continue;
        }
        if (!live_[k].load()) continue;
        Proxy& p = proxies_[k];
        int got = 0, numMidi = 0;
        Transport t;
        if (readFrame(s.slots[k].in[block % kRing], block, p.in[0].data(), p.in[1].data(), kMaxBlock, got, &t,
                      p.midiIn.data(), &numMidi)) {
            adopt(t);
            n = std::max(n, got);
            p.io.numSamples = got;
            p.io.numMidiIn = p.midiIn_ ? numMidi : 0;
            for (int i = 0; i < p.io.numMidiIn; ++i) {
                p.midiEvents[(size_t)i].offset = p.midiIn[(size_t)i].offset;
                std::memcpy(p.midiEvents[(size_t)i].bytes, p.midiIn[(size_t)i].bytes, 3);
                p.midiEvents[(size_t)i].size = std::min<uint8_t>(p.midiIn[(size_t)i].size, 3);
            }
        } else {
            p.io.numSamples = 0;  // this bridge didn't hand over the block
            p.io.numMidiIn = 0;
        }
        handles_.push_back(p.handle);
        ios_.push_back(&p.io);
        used_.push_back(k);
    }
    if (n > 0) {
        for (auto* io : ios_) {
            if (io->numSamples == 0 && io->audioIn) {  // silence for a missing input, but keep the block length
                std::fill_n(const_cast<float*>(io->audioIn[0]), n, 0.0f);
                std::fill_n(const_cast<float*>(io->audioIn[1]), n, 0.0f);
            }
            io->numSamples = n;
            io->transport = transport;
        }
        if (extra_) extra_(transport, n, handles_, ios_);
        if (!handles_.empty()) engine_.processAll(handles_.data(), ios_.data(), (int)handles_.size());
        for (const int k : used_) {
            Proxy& p = proxies_[k];
            Frame& o = s.slots[k].out[block % kRing];
            o.beginWrite(block);
            o.numSamples = n;
            o.numChannels = 2;
            for (int ch = 0; ch < 2; ++ch) {
                if (p.audioOut && p.io.boardAudioValid) std::memcpy(o.audio[ch], p.out[ch].data(), sizeof(float) * (size_t)n);
                else std::fill_n(o.audio[ch], n, 0.0f);
            }
            o.numMidi = 0;
            if (p.midiOut_ && p.io.boardAudioValid)
                for (int i = 0; i < p.io.numMidiOut && o.numMidi < kMaxMidi; ++i) {
                    const engine::MidiEvent& e = p.midiOut[(size_t)i];
                    Midi& m = o.midi[o.numMidi++];
                    m.offset = e.offset;
                    std::memcpy(m.bytes, e.bytes, 3);
                    m.size = std::min<uint8_t>(e.size, 3);
                }
            o.endWrite();
        }
        // Slots whose board is the web: the hub reads their input and answers for the same block.
        for (const int k : relayUsed_) {
            Proxy& p = proxies_[k];
            SlotRelay::Block b;
            b.transport = p.relayTransport;
            b.numSamples = n;
            if (p.relayGot) {
                b.in[0] = p.in[0].data();
                b.in[1] = p.in[1].data();
                b.midiIn = p.midiIn.data();
                b.numMidiIn = p.relayMidi;
            }
            std::fill_n(relayAudioOut_[0].data(), n, 0.0f);
            std::fill_n(relayAudioOut_[1].data(), n, 0.0f);
            b.ret[0] = relayAudioOut_[0].data();
            b.ret[1] = relayAudioOut_[1].data();
            b.midiOut = relayOut_.data();
            if (relay_) relay_->slotBlock(k, b);
            Frame& o = s.slots[k].out[block % kRing];
            o.beginWrite(block);
            o.numSamples = n;
            o.numChannels = 2;
            for (int ch = 0; ch < 2; ++ch) std::memcpy(o.audio[ch], relayAudioOut_[(size_t)ch].data(), sizeof(float) * (size_t)n);
            o.numMidi = std::clamp(b.numMidiOut, 0, kMaxMidi);
            std::memcpy(o.midi, relayOut_.data(), sizeof(Midi) * (size_t)o.numMidi);
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
