// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// sequencer_tests.cpp — Step Sequencer (doc/specs/modules/step-sequencer.md §8).

#include "dsp_test.h"

// ---- Step Sequencer (doc/specs/modules/step-sequencer.md §8) -------------------

struct SeqEvent {
    int64_t at;
    bool on;
    int note;
};

/// Runs a sequencer for `n` samples at 48 kHz. `drive(i, clock, reset, time)` sets the inputs.
template <class Drive>
static std::vector<SeqEvent> runSeq(StepSequencerDsp& d, const SeqParams& p, int64_t n, Drive&& drive,
                                    std::vector<SeqOutputs>* outs = nullptr, std::vector<int>* steps = nullptr) {
    std::vector<SeqEvent> ev;
    for (int64_t i = 0; i < n; ++i) {
        float clock = 0.0f, reset = 0.0f;
        bool clocked = false;
        SeqTime t;
        drive(i, clock, clocked, reset, t);
        SeqOutputs o;
        d.tick(p, clock, clocked, reset, 0.0f, t, o, [&](bool on, int note, float, float) { ev.push_back({i, on, note}); });
        if (outs) outs->push_back(o);
        if (steps && o.trigger > 0.0f) steps->push_back(d.playingStep());
    }
    return ev;
}

static auto transportAt(double bpm = 120.0) {
    return [bpm](int64_t i, float&, bool&, float&, SeqTime& t) {
        t.running = true;
        t.started = i == 0;
        t.bpm = bpm;
        t.ppq = (double)i * bpm / 60.0 / 48000.0;
    };
}

static void seqScales() {
    g_test = "seq-scales";
    const uint16_t major = dsp::scales()[1].mask, minorPent = dsp::scales()[12].mask, chroma = dsp::scales()[0].mask;
    EXPECT(dsp::scales().size() == 17);
    EXPECT(dsp::quantize(1.0f, major) == 0);   // tie between 0 and 2 goes down
    EXPECT(dsp::quantize(6.0f, major) == 5);   // tie between 5 and 7
    EXPECT(dsp::quantize(-1.0f, major) == -1); // B below C
    EXPECT(dsp::quantize(-2.0f, major) == -3); // tie between A and B goes down
    EXPECT(dsp::quantize(13.0f, major) == 12);
    EXPECT(dsp::quantize(1.0f, minorPent) == 0);
    EXPECT(dsp::quantize(2.0f, minorPent) == 3);
    EXPECT(dsp::quantize(0.5f, chroma) == 0);
    EXPECT(dsp::quantize(0.6f, chroma) == 1);
    for (const auto& sc : dsp::scales())
        for (int k = -30; k <= 40; ++k) EXPECT(dsp::inScale(sc.mask, dsp::quantize((float)k + 0.3f, sc.mask)));
    SeqParams p;
    p.root = 2;  // D major, quantized relative to the root: 3 above D ties E/F# and goes down to E
    EXPECT(StepSequencerDsp::pitchOf(p, 3.0f) == 4);
}

static void seqTransport() {
    g_test = "seq-transport";
    for (int rate = 0; rate < StepSequencerDsp::kNumRates; ++rate) {
        StepSequencerDsp d;
        d.prepare(48000.0);
        d.reset();
        SeqParams p;
        p.rate = rate;
        const double stepSamples = StepSequencerDsp::rateBeats(rate) * 24000.0;
        auto ev = runSeq(d, p, (int64_t)(stepSamples * 6.5), transportAt());
        int k = 0;
        for (const auto& e : ev)
            if (e.on) {
                EXPECT(std::llabs(e.at - (int64_t)std::ceil(stepSamples * k - 1e-6)) <= 1);
                ++k;
            }
        EXPECT(k == 7);
    }
    // A loop jump back to bar 1 plays step 1 again.
    StepSequencerDsp d;
    d.prepare(48000.0);
    d.reset();
    SeqParams p;
    std::vector<int> steps;
    runSeq(d, p, 30000, [](int64_t i, float&, bool&, float&, SeqTime& t) {
        t.running = true;
        t.bpm = 120.0;
        const int64_t j = i < 15000 ? i : i - 15000;  // jump back at 15000
        t.ppq = (double)j / 24000.0;
    }, nullptr, &steps);
    EXPECT(steps.size() >= 4 && steps[0] == 0 && steps[1] == 1 && steps[2] == 2 && steps[3] == 0);
    // Stopping the transport ends the note.
    StepSequencerDsp s;
    s.prepare(48000.0);
    s.reset();
    p.gateLength = 1.0f;
    auto ev = runSeq(s, p, 9000, [](int64_t i, float&, bool&, float&, SeqTime& t) {
        t.running = i < 3000;
        t.bpm = 120.0;
        t.ppq = (double)i / 24000.0;
    });
    EXPECT(ev.size() == 2 && ev[1].at == 3000 && !ev[1].on);
}

static void seqClock() {
    g_test = "seq-clock";
    StepSequencerDsp d;
    d.prepare(48000.0);
    d.reset();
    SeqParams p;
    p.length = 4;
    std::vector<int> steps;
    // Pulses every 1000 samples; Reset with the 6th pulse.
    auto ev = runSeq(d, p, 8000, [](int64_t i, float& clock, bool& clocked, float& reset, SeqTime&) {
        clocked = true;
        clock = i % 1000 == 0 ? 1.0f : 0.0f;
        reset = i == 5000 ? 1.0f : 0.0f;
    }, nullptr, &steps);
    const std::vector<int> want{0, 1, 2, 3, 0, 0, 1, 2};
    EXPECT(steps == want);
    // Swing 75 %: every second step starts half a step late.
    StepSequencerDsp s;
    s.prepare(48000.0);
    s.reset();
    p.swing = 0.75f;
    ev = runSeq(s, p, 6000, [](int64_t i, float& clock, bool& clocked, float&, SeqTime&) {
        clocked = true;
        clock = i % 1000 == 0 ? 1.0f : 0.0f;
    });
    std::vector<int64_t> ons;
    for (const auto& e : ev)
        if (e.on) ons.push_back(e.at);
    // The first gap isn't known yet at the second pulse (default period); from then on 1000.
    EXPECT(ons.size() >= 5 && ons[0] == 0 && ons[2] == 2000 && ons[3] == 3500 && ons[4] == 4000);
}

static void seqDirections() {
    g_test = "seq-directions";
    auto order = [](int direction, int length, int count) {
        StepSequencerDsp d;
        d.prepare(48000.0);
        d.reset();
        SeqParams p;
        p.length = length;
        p.direction = direction;
        std::vector<int> steps;
        runSeq(d, p, (int64_t)count * 100, [](int64_t i, float& clock, bool& clocked, float&, SeqTime&) {
            clocked = true;
            clock = i % 100 == 0 ? 1.0f : 0.0f;
        }, nullptr, &steps);
        return steps;
    };
    EXPECT((order(SeqForward, 4, 6) == std::vector<int>{0, 1, 2, 3, 0, 1}));
    EXPECT((order(SeqBackward, 4, 6) == std::vector<int>{3, 2, 1, 0, 3, 2}));
    EXPECT((order(SeqPingPong, 4, 9) == std::vector<int>{0, 1, 2, 3, 2, 1, 0, 1, 2}));
    EXPECT((order(SeqPingPong, 1, 3) == std::vector<int>{0, 0, 0}));
    const auto r = order(SeqRandom, 5, 200);
    EXPECT(r.size() == 200);
    std::vector<int> seen(5, 0);
    for (size_t i = 0; i < r.size(); ++i) {
        EXPECT(r[i] >= 0 && r[i] < 5);
        if (i) EXPECT(r[i] != r[i - 1]);
        seen[(size_t)r[i]]++;
    }
    for (int c : seen) EXPECT(c > 10);
    EXPECT(order(SeqRandom, 5, 50) == order(SeqRandom, 5, 50));  // seeded
}

static void seqTies() {
    g_test = "seq-ties";
    StepSequencerDsp d;
    d.prepare(48000.0);
    d.reset();
    SeqPattern pat{};
    pat[0] = {SeqTie, 0, 100};
    pat[1] = {SeqOn, 2, 100};
    pat[2] = {SeqTie, 4, 100};
    pat[3] = {SeqTie, 4, 100};
    pat[4] = {SeqOff, 0, 100};
    d.setPattern(pat);
    SeqParams p;
    p.length = 5;
    std::vector<SeqOutputs> outs;
    auto ev = runSeq(d, p, 30000, transportAt(), &outs);
    std::vector<SeqEvent> want{{0, true, 60},     {6000, true, 62},  {6000, false, 60},
                               {9000, false, 62}, {12000, true, 64}, {24000, false, 64}};
    EXPECT(ev.size() == want.size());
    for (size_t i = 0; i < std::min(ev.size(), want.size()); ++i)
        EXPECT(ev[i].at == want[i].at && ev[i].on == want[i].on && ev[i].note == want[i].note);
    EXPECT(outs[5999].gate == 1.0f && outs[6000].gate == 1.0f && outs[8999].gate == 1.0f && outs[9000].gate == 0.0f);
    EXPECT(outs[23999].gate == 1.0f && outs[24000].gate == 0.0f);
    EXPECT(outs[13000].pitch == 4.0f / 12.0f && outs[25000].pitch == 4.0f / 12.0f);  // Off holds the pitch
    EXPECT(outs[0].trigger == 1.0f && outs[6000].trigger == 0.0f && outs[18000].trigger == 0.0f);
}

static void seqRatchet() {
    g_test = "seq-ratchet";
    StepSequencerDsp d;
    d.prepare(48000.0);
    d.reset();
    SeqPattern pat{};
    pat[0] = {SeqOn, 0, 100, 50, 3};   // three notes, each gate 50 % x 50 % of a third of the step
    pat[1] = {SeqOn, 2, 100, 100, 1};  // a plain step
    d.setPattern(pat);
    SeqParams p;
    p.length = 2;
    std::vector<SeqOutputs> outs;
    auto ev = runSeq(d, p, 11000, transportAt(), &outs);
    // A 1/16 is 6000 samples: notes at 0, 2000, 4000, each 2000 * 0.25 = 500 long.
    std::vector<SeqEvent> want{{0, true, 60},    {500, false, 60},  {2000, true, 60}, {2500, false, 60},
                               {4000, true, 60}, {4500, false, 60}, {6000, true, 62}, {9000, false, 62}};
    EXPECT(ev.size() == want.size());
    for (size_t i = 0; i < std::min(ev.size(), want.size()); ++i)
        EXPECT(ev[i].at == want[i].at && ev[i].on == want[i].on && ev[i].note == want[i].note);
    EXPECT(outs[0].trigger == 1.0f && outs[2000].trigger == 1.0f && outs[4000].trigger == 1.0f && outs[1000].trigger == 0.0f);
    // A step that ends first drops the unplayed notes: a 16-fold ratchet in a short step still ends with it.
    d.reset();
    pat[0].ratchet = 16;
    pat[0].gateLen = 100;
    d.setPattern(pat);
    ev = runSeq(d, p, 12000, transportAt());
    int ons = 0;
    for (const auto& e : ev) ons += e.on && e.at < 6000;
    EXPECT(ons == 16);
}

static void seqVariation() {
    g_test = "seq-variation";
    SeqPattern pat{};
    for (int i = 0; i < kSeqSteps; ++i) pat[(size_t)i] = {(uint8_t)(i % 3 ? SeqOn : SeqOff), (int8_t)(i % 7), 90};
    auto run = [&](float variation, uint32_t seed) {
        StepSequencerDsp d;
        d.prepare(48000.0);
        d.reset();
        d.setPattern(pat);
        SeqParams p;
        p.variation = variation;
        p.seed = seed;
        p.scale = 0;
        return runSeq(d, p, 6000 * 64, transportAt());
    };
    const auto plain = run(0.0f, 1), a = run(0.7f, 1), b = run(0.7f, 1), c = run(0.7f, 2);
    auto notes = [](const std::vector<SeqEvent>& ev) {
        std::vector<int> n;
        for (const auto& e : ev)
            if (e.on) n.push_back(e.note);
        return n;
    };
    std::vector<int> stored;
    for (int k = 0; k < 64; ++k)
        if (k % 16 % 3) stored.push_back(60 + k % 16 % 7);
    EXPECT(notes(plain) == stored);
    EXPECT(notes(a) == notes(b));
    EXPECT(notes(a) != notes(plain));
    EXPECT(notes(a) != notes(c));
    EXPECT(notes(a).size() == notes(plain).size());  // Variation never adds or removes gates
}

static void seqNoHangingNotes() {
    g_test = "seq-hanging";
    std::mt19937 rng(7);
    for (int round = 0; round < 40; ++round) {
        StepSequencerDsp d;
        d.prepare(48000.0);
        d.reset();
        std::map<int, int> sounding;
        bool bad = false;
        auto emit = [&](bool on, int note, float, float) {
            if (on) {
                if (sounding[note]++ > 0) bad = true;
            } else if (--sounding[note] < 0) {
                bad = true;
            }
        };
        SeqParams p;
        SeqTime t;
        t.bpm = 140.0;
        double ppq = 0.0;
        for (int64_t i = 0; i < 200000; ++i) {
            if (i % 4000 == 0) {
                SeqPattern pat{};
                for (auto& s : pat) s = {(uint8_t)(rng() % 3), (int8_t)((int)(rng() % 25) - 12), (uint8_t)(1 + rng() % 127)};
                d.setPattern(pat);
                p.length = 1 + (int)(rng() % 32);
                p.direction = (int)(rng() % 4);
                p.gateLength = (float)(rng() % 100) / 100.0f;
                p.swing = 0.5f + (float)(rng() % 25) / 100.0f;
                p.variation = (float)(rng() % 2) * 0.5f;
                p.scale = (int)(rng() % 17);
            }
            const bool clocked = (i / 50000) % 2 == 1;
            t.running = (i / 23000) % 3 != 2;
            t.started = false;
            if (t.running) ppq += t.bpm / 60.0 / 48000.0;
            if (i % 70000 == 0) ppq = 0.0;  // loop jump
            t.ppq = ppq;
            SeqOutputs o;
            d.tick(p, i % 1500 < 3 ? 1.0f : 0.0f, clocked, i % 9000 == 0 ? 1.0f : 0.0f, 0.0f, t, o, emit);
        }
        // Stop: transport off, clock unpatched.
        t.running = false;
        SeqOutputs o;
        d.tick(p, 0.0f, false, 0.0f, 0.0f, t, o, emit);
        d.tick(p, 0.0f, false, 0.0f, 0.0f, t, o, emit);
        int left = 0;
        for (const auto& [note, count] : sounding) left += count;
        EXPECT(!bad);
        EXPECT(left == 0);
        if (g_failures) return;
    }
}

/// Steady-state gain of one algorithm for a sine at freq (after settling).

void runSequencerTests() {
    seqScales();
    seqTransport();
    seqClock();
    seqDirections();
    seqTies();
    seqRatchet();
    seqVariation();
    seqNoHangingNotes();
}
