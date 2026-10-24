// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// EngineAudio.cpp — the board window and the audio path (process, processAll, the tick).
#include "EngineInternal.h"

namespace bleep::engine {

// ---- the board window ------------------------------------------------------------

void Engine::editorOpened(int handle) noexcept { openBoard(handle); }

void Engine::openBoard(int handle) noexcept {
    if (!ui_) ui_ = createBoardUi(*this);
    if (!ui_) return;
    juce::String focus;
    if (auto s = slotShared(handle); s && hasBoard())
        if (auto* n = board::findNodeByPort(board_, juce::String(s->id))) focus = n->getProperty("id").toString();
    ui_->show(focus);
}

// ---- audio -------------------------------------------------------------------------

namespace {

void silence(BlockIO& io) noexcept {
    for (int ch = 0; ch < io.numAudioOut; ++ch)
        if (io.audioOut[ch]) std::fill_n(io.audioOut[ch], io.numSamples, 0.0f);
}

/// A plugin's host block as a frame. [RT]
void fillFrame(PortFrame& f, const BlockIO& io) noexcept {
    const int n = std::min(io.numSamples, kMaxHostBlock);
    f.numSamples = n;
    f.transport = io.transport;
    f.numChannels = std::min(io.numAudioIn, 2);
    for (int ch = 0; ch < f.numChannels; ++ch)
        if (io.audioIn[ch]) std::memcpy(f.audio[ch], io.audioIn[ch], sizeof(float) * (size_t)n);
    f.numMidi = 0;
    for (int i = 0; i < io.numMidiIn && f.numMidi < kMaxMidiEvents; ++i)
        if (io.midiIn[i].offset < n) f.midi[f.numMidi++] = io.midiIn[i];
    if (io.macros) std::memcpy(f.macros, io.macros, sizeof(f.macros));
}

/// Hands a plugin's host block `c` to the engine. [RT]
void writeIn(PortSlot& s, int64_t c, const BlockIO& io) noexcept {
    PortFrame& f = s.in[c % kRing];
    f.beginWrite(c);
    fillFrame(f, io);
    f.endWrite();
}

/// Copies the board's output for host block `want` to the plugin. [RT]
void readOut(PortSlot& s, int64_t want, BlockIO& io) noexcept {
    if (io.numAudioOut == 0 && io.midiOut == nullptr) return;
    if (s.kind == PortKind::Patch && !s.writesOut.load(std::memory_order_relaxed)) return;  // no Audio Out node: pass through
    const PortFrame& o = s.out[((want % kRing) + kRing) % kRing];
    const uint32_t s1 = o.seq.load(std::memory_order_acquire);
    if (want < 0 || (s1 & 1u) != 0 || o.block != want) {
        silence(io);
        return;
    }
    const int m = std::min(std::min(io.numSamples, kMaxHostBlock), o.numSamples);
    for (int ch = 0; ch < io.numAudioOut; ++ch) {
        if (!io.audioOut[ch]) continue;
        std::memcpy(io.audioOut[ch], o.audio[std::min(ch, 1)], sizeof(float) * (size_t)m);
        std::fill(io.audioOut[ch] + m, io.audioOut[ch] + io.numSamples, 0.0f);
    }
    int midi = 0;
    if (io.midiOut)
        for (int i = 0; i < o.numMidi && midi < io.midiOutCapacity; ++i)
            if (o.midi[i].offset < io.numSamples) io.midiOut[midi++] = o.midi[i];
    std::atomic_thread_fence(std::memory_order_acquire);
    if (o.seq.load(std::memory_order_relaxed) != s1) {  // overwritten while we copied
        s.drops.fetch_add(1, std::memory_order_relaxed);
        silence(io);
        return;
    }
    io.numMidiOut = midi;
    io.boardAudioValid = true;
}

}  // namespace

void Engine::process(int handle, BlockIO& io) noexcept {
    io.numMidiOut = 0;
    io.boardAudioValid = false;
    PortSlot* s = slot(handle);
    if (s == nullptr) {
        silence(io);
        return;
    }

    // Which host block is this? The first plugin of a block claims it (spec §5.3).
    int64_t T = ticks_.load(std::memory_order_acquire);
    int64_t c = s->counter < 0 ? T : s->counter + 1;
    bool claimed = false;
    if (c == T + 1) {
        int64_t expected = T;
        claimed = ticks_.compare_exchange_strong(expected, c, std::memory_order_acq_rel);
        if (!claimed && expected != c) {
            c = expected;
            s->resyncs.fetch_add(1, std::memory_order_relaxed);
        }
    } else if (c != T) {
        c = T;  // joined late, or Live skipped this plugin: follow the engine
        if (s->counter >= 0) s->resyncs.fetch_add(1, std::memory_order_relaxed);
    }
    s->counter = c;
    s->lastBlock.store(c, std::memory_order_relaxed);

    const int n = std::min(io.numSamples, kMaxHostBlock);
    int seen = seenBlock_.load(std::memory_order_relaxed);
    while (n > seen && !seenBlock_.compare_exchange_weak(seen, n, std::memory_order_relaxed)) {}

    // A cell plugin with nothing cabled to other plugins runs its cell right here, in its own block.
    const bool local = (s->kind == PortKind::Instrument || s->kind == PortKind::AudioInsert) && runLocal(*s, io);
    if (!local) writeIn(*s, c, io);
    if (claimed) runTick(c, io);
    if (!local) readOut(*s, c - 2, io);  // the tick in block c-1 processed block c-2
}

bool Engine::runLocal(PortSlot& s, BlockIO& io) noexcept {
    Program* p = nullptr;
    do {  // announce the program before using it, like runTick: the message thread deletes only what nobody runs
        p = program_.load(std::memory_order_seq_cst);
        s.hazard.store(p, std::memory_order_seq_cst);
    } while (p != program_.load(std::memory_order_seq_cst));
    const int g = p != nullptr ? p->localGroup(&s) : -1;
    if (g >= 0) {
        fillFrame(s.tickIn, io);
        s.tickIn.block = -1;
        const Transport t = io.transport;
        const bool started = t.playing && !s.localWasPlaying;
        s.localWasPlaying = t.playing;
        p->runLocal(g, t, started, s.tickIn, s.localOut);
        const int n = s.localOut.numSamples;
        for (int ch = 0; ch < io.numAudioOut; ++ch) {
            if (!io.audioOut[ch]) continue;
            const int m = std::min(n, io.numSamples);
            std::memcpy(io.audioOut[ch], s.localOut.audio[std::min(ch, 1)], sizeof(float) * (size_t)m);
            std::fill(io.audioOut[ch] + m, io.audioOut[ch] + io.numSamples, 0.0f);
        }
        io.boardAudioValid = true;
    }
    s.hazard.store(nullptr, std::memory_order_seq_cst);
    return g >= 0;
}

void Engine::processAll(const int* handles, BlockIO* const* ios, int count) noexcept {
    if (count <= 0) return;
    // One thread drives every port: no claiming, and no latency inside the engine.
    const int64_t c = ticks_.load(std::memory_order_relaxed) + 1;
    for (int k = 0; k < count; ++k) {
        ios[k]->numMidiOut = 0;
        ios[k]->boardAudioValid = false;
        if (PortSlot* s = slot(handles[k])) {
            s->counter = c;
            s->lastBlock.store(c, std::memory_order_relaxed);
            writeIn(*s, c, *ios[k]);
        }
    }
    ticks_.store(c, std::memory_order_release);
    runTick(c + 1, *ios[0]);  // processes block c
    for (int k = 0; k < count; ++k) {
        if (PortSlot* s = slot(handles[k])) readOut(*s, c, *ios[k]);
        else silence(*ios[k]);
    }
}

void Engine::runTick(int64_t block, const BlockIO& claimer) noexcept {
    Program* p = nullptr;
    do {
        p = program_.load(std::memory_order_seq_cst);
        inFlight_.store(p, std::memory_order_seq_cst);
    } while (p != program_.load(std::memory_order_seq_cst));

    if (p != nullptr) {
        // The tick in block N processes what the plugins handed over in block N-1.
        const int64_t b = block - 1;
        const int idx = (int)(b % kRing);
        Transport t = claimer.transport;
        int n = std::min(claimer.numSamples, kMaxHostBlock);
        bool found = false;
        for (const auto& slotPtr : p->slots()) {
            PortSlot& s = *slotPtr;
            s.tickInValid = false;
            if (p->localGroup(&s) >= 0) continue;  // runs in its own plugin's block
            s.tickInValid = readFrame(s.in[idx], b, s.tickIn);
            if (s.tickInValid && !found) {
                t = s.tickIn.transport;
                n = s.tickIn.numSamples;
                found = true;
            }
        }
        const bool started = t.playing && !wasPlaying_;
        wasPlaying_ = t.playing;
        uiBpm_.store(t.bpm, std::memory_order_relaxed);
        uiPlaying_.store(t.playing, std::memory_order_relaxed);
        for (auto& st : p->steps()) {
            if (!st.port || st.local >= 0) continue;
            st.io.in = st.port->tickInValid ? &st.port->tickIn : nullptr;
            st.io.out = nullptr;
            if (st.portWritesOut) {
                PortFrame& o = st.port->out[idx];
                o.beginWrite(b);
                o.numSamples = n;
                o.numChannels = 2;
                o.numMidi = 0;
                std::fill_n(o.audio[0], n, 0.0f);
                std::fill_n(o.audio[1], n, 0.0f);
                st.io.out = &o;
            }
        }
        p->run(t, n, started);
        for (auto& st : p->steps())
            if (st.local < 0 && st.io.out) st.io.out->endWrite();
    }
    inFlight_.store(nullptr, std::memory_order_seq_cst);
}

}  // namespace bleep::engine
