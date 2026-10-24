// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// SeqNotes.h: gate timing, legato order, same-pitch ties, retriggers, note
// sets with common tones, and no hanging notes driven by SeqClock.
#include "dsp/SeqNotes.h"
#include "dsp/tests/TestUtil.h"

#include <map>
#include <random>
#include <vector>

using namespace bleep::dsp;

namespace {

struct Ev {
    int64_t at;
    bool on;
    int note;
    float pitch, velocity;
};

/// Checks balance: never two note-ons for one note, never an off without an on.
struct Tracker {
    std::map<int, int> held;
    bool bad = false;
    void operator()(bool on, int note) {
        if (on) {
            if (held[note]++ > 0) bad = true;
        } else if (--held[note] < 0) {
            bad = true;
        }
    }
    int sounding() const {
        int n = 0;
        for (const auto& [k, v] : held) n += v;
        return n;
    }
};

// Shaped like engine::NoteEvent / NoteBuffer (patch/engine/Module.h).
struct FakeEvent {
    enum Type : uint8_t { On, Off, Pressure };
    uint8_t type = On;
    uint8_t channel = 0;
    int16_t offset = 0;
    int32_t note = 60;
    float pitch = 0.0f;
    float value = 0.0f;
};
struct FakeBuffer {
    FakeEvent events[4];
    int count = 0;
    bool push(const FakeEvent& e) {
        if (count >= 4) return false;
        events[count++] = e;
        return true;
    }
};

}  // namespace

static void voiceTiming() {
    TEST("voice timing");
    SeqVoice v;
    v.reset();
    std::vector<Ev> ev;
    int64_t now = 0;
    auto emit = [&](bool on, int note, float pitch, float vel) { ev.push_back({now, on, note, pitch, vel}); };
    std::vector<bool> gate;
    for (now = 0; now < 400; ++now) {
        v.beginSample();
        if (now == 0) EXPECT(v.play(60, 0.0f, 0.8f, true, 50, emit) == SeqVoice::Fresh);           // tie
        if (now == 100) EXPECT(v.play(62, 2.0f / 12.0f, 0.7f, false, 50, emit) == SeqVoice::Legato);  // legato
        if (now == 200) EXPECT(v.play(64, 4.0f / 12.0f, 0.6f, false, 1000, emit) == SeqVoice::Fresh);
        if (now == 210) EXPECT(v.play(65, 5.0f / 12.0f, 0.6f, true, 10, emit) == SeqVoice::Fresh);  // retrigger
        if (now == 300) EXPECT(v.play(65, 5.0f / 12.0f, 0.5f, false, 20, emit) == SeqVoice::Continued);
        v.endSample(emit);
        gate.push_back(v.gate());
    }
    const std::vector<std::pair<int64_t, int>> want{{0, 60}, {100, 62}, {100, -60}, {150, -62}, {200, 64},
                                                    {210, -64}, {210, 65}, {320, -65}};
    EXPECT(ev.size() == want.size());
    for (size_t i = 0; i < std::min(ev.size(), want.size()); ++i) {
        EXPECT(ev[i].at == want[i].first);
        EXPECT(ev[i].on == (want[i].second > 0));
        EXPECT(ev[i].note == std::abs(want[i].second));
    }
    // Note-offs carry the note's pitch and velocity 0.
    EXPECT(ev[2].pitch == 0.0f && ev[2].velocity == 0.0f && ev[3].pitch == 2.0f / 12.0f);
    // Gate: high through the legato, low after the gate length, a one-sample dip at the retrigger.
    EXPECT(gate[99] && gate[100] && gate[149] && !gate[150] && !gate[199] && gate[200]);
    EXPECT(gate[209] && !gate[210] && gate[211] && gate[319] && !gate[320]);
    EXPECT(v.pitch() == 5.0f / 12.0f && v.velocity() == 0.5f && !v.sounding());  // held after the note
}

static void voiceRestAndRelease() {
    TEST("voice rest/release");
    SeqVoice v;
    v.reset();
    std::vector<Ev> ev;
    auto emit = [&](bool on, int note, float pitch, float vel) { ev.push_back({0, on, note, pitch, vel}); };
    v.beginSample();
    v.play(60, 0.0f, 1.0f, true, 10, emit);
    v.endSample(emit);
    v.beginSample();
    v.rest(emit);  // a tie into an Off step ends there
    v.endSample(emit);
    EXPECT(ev.size() == 2 && !ev[1].on && !v.sounding());
    v.beginSample();
    v.play(61, 0.0f, 1.0f, false, 100, emit);
    v.release(emit);
    v.release(emit);  // twice is harmless
    EXPECT(ev.size() == 4 && !ev[3].on && ev[3].note == 61);
}

static void noteSet() {
    TEST("note set");
    SeqNoteSet<8> s;
    std::vector<Ev> ev;
    auto emit = [&](bool on, int note, float pitch, float vel) { ev.push_back({0, on, note, pitch, vel}); };
    const SeqNote c[3] = {{60, 0.0f, 0.8f}, {64, 4.0f / 12.0f, 0.8f}, {67, 7.0f / 12.0f, 0.8f}};
    s.set(c, 3, emit);
    EXPECT(ev.size() == 3 && ev[0].on && ev[2].note == 67 && s.count() == 3);
    ev.clear();
    const SeqNote f[4] = {{60, 0.0f, 0.5f}, {65, 5.0f / 12.0f, 0.5f}, {69, 9.0f / 12.0f, 0.5f}, {65, 5.0f / 12.0f, 0.5f}};
    s.set(f, 4, emit);  // C stays; F, A on; E, G off; the duplicate F is skipped
    EXPECT(ev.size() == 4);
    EXPECT(ev.size() == 4 && ev[0].on && ev[0].note == 65 && ev[1].on && ev[1].note == 69);
    EXPECT(ev.size() == 4 && !ev[2].on && ev[2].note == 64 && !ev[3].on && ev[3].note == 67);
    EXPECT(s.count() == 3 && s.contains(60) && s.contains(65) && !s.contains(64));
    EXPECT(s[0].velocity == 0.8f);  // the held C keeps its velocity
    ev.clear();
    s.retrigger(f, 3, emit);  // offs first, then ons
    EXPECT(ev.size() == 6 && !ev[0].on && !ev[2].on && ev[3].on && ev[5].on);
    ev.clear();
    s.noteOn({65, 5.0f / 12.0f, 1.0f}, emit);  // already sounding: off, then on
    EXPECT(ev.size() == 2 && !ev[0].on && ev[1].on && s.count() == 3);
    s.noteOff(60, emit);
    s.noteOff(60, emit);
    EXPECT(ev.size() == 3 && s.count() == 2 && !s.contains(60));
    ev.clear();
    s.release(emit);
    EXPECT(ev.size() == 2 && !ev[0].on && !ev[1].on && s.count() == 0);
    // Capacity.
    SeqNoteSet<2> small;
    const SeqNote many[3] = {{60}, {61}, {62}};
    small.set(many, 3, emit);
    EXPECT(small.count() == 2 && !small.noteOn({70}, emit));
}

static void emitter() {
    TEST("note emitter");
    FakeBuffer b;
    auto emit = noteEmitter(b, 17, 3);
    emit(true, 64, 4.0f / 12.0f, 0.5f);
    emit(false, 64, 4.0f / 12.0f, 0.0f);
    EXPECT(b.count == 2 && b.events[0].type == FakeEvent::On && b.events[1].type == FakeEvent::Off);
    EXPECT(b.events[0].offset == 17 && b.events[0].channel == 3 && b.events[0].note == 64 && b.events[0].value == 0.5f);
    EXPECT(notePitch(72) == 1.0f && notePitch(60) == 0.0f);
}

/// SeqClock + SeqVoice with random patterns, rates, ties, swing, mode
/// switches, resets, transport stops and loop jumps: every note-on has its
/// note-off, and after release() nothing sounds.
static void noHangingNotes() {
    TEST("no hanging notes");
    std::mt19937 rng(11);
    for (int round = 0; round < 20; ++round) {
        SeqClock clock;
        clock.prepare(48000.0);
        clock.reset();
        SeqVoice voice;
        voice.reset();
        Tracker t;
        auto emit = [&](bool on, int note, float, float) { t(on, note); };
        double ppq = 0.0;
        int rate = 9;
        float gate = 0.5f, swing = 0.5f;
        bool clocked = false;
        for (int64_t i = 0; i < 150000; ++i) {
            if (i % 7000 == 0) {
                rate = (int)(rng() % kNumSequencerRates);
                gate = (float)(rng() % 101) / 100.0f;
                swing = 0.5f + (float)(rng() % 26) / 100.0f;
            }
            voice.beginSample();
            const bool nowClocked = (i / 40000) % 2 == 1;
            if (nowClocked != clocked) voice.release(emit);  // a mode change ends the note
            clocked = nowClocked;
            SeqClockInput in;
            in.clocked = clocked;
            in.clock = i % 1300 < 2 ? 1.0f : 0.0f;
            in.reset = i % 9100 == 0 ? 1.0f : 0.0f;
            in.running = (i / 21000) % 3 != 2;
            if (in.running) ppq += 135.0 / 60.0 / 48000.0;
            if (i % 50000 == 0) ppq = 0.0;
            in.ppq = ppq;
            in.bpm = 135.0;
            in.stepBeats = sequencerRateBeats(rate);
            in.swing = swing;
            clock.tick(in, [&](const SeqClockEvent& e) {
                if (e.type == SeqClockEvent::Release) {
                    voice.release(emit);
                    return;
                }
                const uint32_t r = (uint32_t)rng();
                if (r % 4 == 0) voice.rest(emit);
                else voice.play(48 + (int)(r % 24), 0.0f, 0.8f, r % 3 == 0, gateSamples(e.durationSamples, gate), emit);
            });
            voice.endSample(emit);
            EXPECT(t.sounding() == (voice.sounding() ? 1 : 0));
        }
        voice.release(emit);
        EXPECT(!t.bad && t.sounding() == 0);
    }
}

int main() {
    voiceTiming();
    voiceRestAndRelease();
    noteSet();
    emitter();
    noHangingNotes();
    return bleep::test::finish("seqnotes");
}
