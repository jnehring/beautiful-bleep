// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// WebHubSlots.cpp — Live slots (SlotRelay) and the audio and MIDI packets of a channel.
#include "WebHubInternal.h"

namespace bleep::hub {

// ---- Live slots (SlotRelay) --------------------------------------------------------------------------------

void WebHub::addSlotChannels(int slot, Peer& p) {
    SlotInfo& s = slots_[slot];
    using engine::PortKind;
    const auto kind = (PortKind)s.kind;
    const bool audioTo = kind == PortKind::AudioIn || kind == PortKind::AudioInsert || kind == PortKind::AudioBridge;
    const bool audioFrom = kind == PortKind::AudioOut || kind == PortKind::Instrument || kind == PortKind::AudioInsert ||
                           kind == PortKind::AudioBridge;
    const bool midiTo = kind == PortKind::MidiIn || kind == PortKind::Instrument;
    const bool midiFrom = kind == PortKind::MidiOut;
    const char* port = kind == PortKind::AudioIn ? "audio-in"
                       : kind == PortKind::AudioOut ? "audio-out"
                       : kind == PortKind::MidiIn ? "midi-in"
                       : kind == PortKind::MidiOut ? "midi-out"
                       : kind == PortKind::Instrument ? "instrument" : "audio-insert";
    // All channels of a plugin share its ID as their key; kind and direction tell them apart (§10.3).
    auto add = [&](Kind k, bool toWeb) {
        // The channel already exists for this peer (a rename, or the peer came back): update it.
        for (int n : s.channels) {
            Channel& e = *channels_[(size_t)n];
            if (e.active && e.connId == p.connId && e.kind == k && e.toWeb == toWeb) {
                e.name = "Live: " + s.track;
                announce(e, true);
                return;
            }
        }
        Channel* fresh = allocate();
        if (fresh == nullptr) return;
        Channel& ch = *fresh;
        const int n = ch.ch;
        ch.active = true;
        ch.kind = k;
        ch.toWeb = toWeb;
        ch.key = s.id;
        ch.name = "Live: " + s.track;
        ch.port = port;
        ch.source = "live";
        ch.connId = p.connId;
        ch.conn = p.conn;
        ch.slot = slot;
        ch.webRate = p.sampleRate;
        ch.lowLatency = p.low;
        if (k == Kind::Audio && !toWeb) ch.link.configure(p.sampleRate, s.sampleRate, p.low ? 16.0 : 64.0);
        s.channels.push_back(n);
        announce(ch, true);
    };
    if (audioTo) add(Kind::Audio, true);
    if (midiTo) add(Kind::Midi, true);
    if (audioFrom) add(Kind::Audio, false);
    if (midiFrom) add(Kind::Midi, false);
}

void WebHub::slotAttached(int slot, uint32_t portKind, const std::string& id, const std::string& track, double sampleRate) {
    std::lock_guard<std::mutex> lock(m_);
    SlotInfo& s = slots_[slot];
    if (s.attached && (s.kind != portKind || s.id != id)) {
        for (int n : s.channels) {
            Channel& ch = *channels_[(size_t)n];
            if (ch.conn) ch.conn->sendText(json(object({{"op", "channel-gone"}, {"ch", ch.ch}})));
            ch.active = false;
        }
        s.channels.clear();
    }
    s.attached = true;
    s.kind = portKind;
    s.id = id;
    s.track = track;
    s.sampleRate = sampleRate;
    sinkRate_ = sampleRate;
    for (auto& [cid, p] : peers_) addSlotChannels(slot, p);
}

void WebHub::slotDetached(int slot, const std::string&) {
    std::lock_guard<std::mutex> lock(m_);
    SlotInfo& s = slots_[slot];
    for (int n : s.channels) {
        Channel& ch = *channels_[(size_t)n];
        if (ch.conn) ch.conn->sendText(json(object({{"op", "channel-gone"}, {"ch", ch.ch}})));
        ch.active = false;
        ch.conn.reset();
        ch.queue.clear();
    }
    s = SlotInfo{};
}

int WebHub::slotLatency(int slot) noexcept {
    std::lock_guard<std::mutex> lock(m_);
    const SlotInfo& s = slots_[slot];
    double frames = 0.0;
    for (int n : s.channels) {
        const Channel& ch = *channels_[(size_t)n];
        if (!ch.active || ch.kind != Kind::Audio || ch.toWeb) continue;
        // The way back to Live is this channel's buffer; the way out was a buffer of the same size on the web
        // side; Bleep Play adds what it declared (§3.2: the round trip is reported by the returning port).
        frames = std::max(frames, (2.0 * ch.link.targetMs() + ch.webLatencyMs) * 0.001 * s.sampleRate);
    }
    return (int)std::lround(frames);
}

void WebHub::sendAudio(Channel& ch, const float* l, const float* r, int n, double) {
    if (!ch.conn || !ch.conn->isOpen()) return;
    std::string pkt((size_t)(16 + 8 * n), '\0');
    char* p = pkt.data();
    p[0] = 1;
    p[1] = (char)ch.ch;
    const uint16_t frames = (uint16_t)n;
    std::memcpy(p + 2, &frames, 2);
    std::memcpy(p + 4, &ch.seq, 4);
    ++ch.seq;
    std::memcpy(p + 8, &ch.sampleTime, 8);
    ch.sampleTime += n;
    std::memcpy(p + 16, l, 4 * (size_t)n);
    std::memcpy(p + 16 + 4 * (size_t)n, r, 4 * (size_t)n);
    ch.conn->sendBinary(pkt.data(), pkt.size());
}

void WebHub::sendMidi(Channel& ch, const Midi* ev, int count, const engine::Transport& t, int numSamples) {
    if (count <= 0 || !ch.conn || !ch.conn->isOpen()) return;
    std::string out;
    out.reserve(96 + (size_t)count * 28);
    char buf[96];
    std::snprintf(buf, sizeof buf, "{\"op\":\"midi\",\"ch\":%d,\"epoch\":%u,\"t\":%.3f,\"ev\":[", ch.ch, epoch_.load(), hubMs());
    out += buf;
    const double sr = t.sampleRate > 0.0 ? t.sampleRate : 48000.0;
    (void)numSamples;
    for (int i = 0; i < count; ++i) {
        const double beat = t.ppqValid ? t.ppq + (double)ev[i].offset * t.bpm / (60.0 * sr) : -1.0;
        std::snprintf(buf, sizeof buf, "%s[%.6f,%d,%d,%d]", i ? "," : "", beat, ev[i].bytes[0],
                      ev[i].size > 1 ? ev[i].bytes[1] : 0, ev[i].size > 2 ? ev[i].bytes[2] : 0);
        out += buf;
    }
    out += "]}";
    ch.conn->sendText(std::move(out));
}

/// Takes the events of a fromWeb MIDI channel that fall into this block. Beat-stamped events wait for their beat
/// (they were sent ahead); events stamped -1 play at once. [real time: the caller holds m_]
int WebHub::pullDue(Channel& ch, const engine::Transport& t, int n, Midi* out, int capacity) {
    int count = 0;
    const double sr = t.sampleRate > 0.0 ? t.sampleRate : 48000.0;
    const double perSample = t.bpm / (60.0 * sr);
    const bool timed = t.ppqValid && t.playing && perSample > 0.0;
    size_t keep = 0;
    for (size_t i = 0; i < ch.queue.size(); ++i) {
        const MidiEv& e = ch.queue[i];
        int offset = -1;
        if (e.beat < 0.0) {
            offset = 0;
        } else if (timed) {
            const double at = (e.beat - t.ppq) / perSample;
            if (at >= (double)n) {
                ch.queue[keep++] = e;  // not yet
                continue;
            }
            if (at < 0.0) lateEvents_.fetch_add(1, std::memory_order_relaxed);
            offset = std::max(0, (int)std::lround(at));
        } else {
            continue;  // stamped for a transport that isn't running: stale
        }
        if (count < capacity) {
            Midi& m = out[count++];
            m.offset = std::min(offset, n - 1);
            std::memcpy(m.bytes, e.bytes, 3);
            m.size = e.size;
        }
    }
    ch.queue.resize(keep);
    std::stable_sort(out, out + count, [](const Midi& a, const Midi& b) { return a.offset < b.offset; });
    return count;
}

void WebHub::slotBlock(int slot, Block& b) noexcept {
    const engine::Transport et = toEngine(b.transport);
    observe(et, b.numSamples, true);
    std::unique_lock<std::mutex> lock(m_);  // the bridge thread is the app's own, not Live's: it may wait the few µs
    SlotInfo& s = slots_[slot];
    lastBlock_ = b.numSamples;
    float tmpL[bridge::kMaxBlock], tmpR[bridge::kMaxBlock];
    for (int idx : s.channels) {
        Channel& ch = *channels_[(size_t)idx];
        if (!ch.active) continue;
        if (ch.toWeb) {
            if (ch.kind == Kind::Audio && b.in[0]) sendAudio(ch, b.in[0], b.in[1], b.numSamples, s.sampleRate);
            else if (ch.kind == Kind::Midi) sendMidi(ch, b.midiIn, b.numMidiIn, et, b.numSamples);
        } else if (ch.kind == Kind::Audio) {
            if (ch.link.pull(tmpL, tmpR, b.numSamples))
                for (int i = 0; i < b.numSamples; ++i) {
                    b.ret[0][i] += tmpL[i];
                    b.ret[1][i] += tmpR[i];
                }
        } else {
            // The bridge returns this block two blocks later: events are placed against the beat the plugin will be
            // at when it plays them, so a beat-stamped note sounds on its beat (§3.2, predictable sources).
            engine::Transport later = et;
            if (later.ppqValid) later.ppq += 2.0 * b.numSamples * later.bpm / (60.0 * (later.sampleRate > 0.0 ? later.sampleRate : 48000.0));
            b.numMidiOut += pullDue(ch, later, b.numSamples, b.midiOut + b.numMidiOut, bridge::kMaxMidi - b.numMidiOut);
        }
    }
}

}  // namespace bleep::hub
