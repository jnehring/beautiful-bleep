// SPDX-License-Identifier: MIT
// grid_tests.cpp — Drum Grid (doc/specs/modules/drum-grid.md).

#include "dsp_test.h"

// ---- Drum Grid (doc/specs/modules/drum-grid.md) --------------------------------

/// Sets a track's row from a string: `.` Off, `x` On, `X` Accent.
static void gridRow(GridPattern& p, int track, const char* row) {
    for (int i = 0; row[i] && i < kGridSteps; ++i)
        p.cells[(size_t)track][(size_t)i] = row[i] == 'X' ? GridAccent : row[i] == 'x' ? GridOn : GridOff;
}

struct GridRun {
    std::vector<GridOutputs> outs;
    std::vector<int> stepAt;  ///< playing step per sample
    std::vector<int> slotAt;  ///< playing slot per sample
    /// Samples where output `track`'s gate rises.
    std::vector<int64_t> rises(int track) const {
        std::vector<int64_t> r;
        for (size_t i = 0; i < outs.size(); ++i)
            if (outs[i].gate[(size_t)track] > 0.5f && (i == 0 || outs[i - 1].gate[(size_t)track] < 0.5f)) r.push_back((int64_t)i);
        return r;
    }
    std::vector<int64_t> pulses(float GridOutputs::*m) const {
        std::vector<int64_t> r;
        for (size_t i = 0; i < outs.size(); ++i)
            if (outs[i].*m > 0.5f) r.push_back((int64_t)i);
        return r;
    }
};

/// Runs a grid for `n` samples at 48 kHz. `drive(i, inputs, time, params)` sets what changes.
template <class Drive>
static GridRun runGrid(DrumGridDsp& d, GridParams p, int64_t n, Drive&& drive) {
    GridRun r;
    for (int64_t i = 0; i < n; ++i) {
        GridInputs in;
        GridTime t;
        drive(i, in, t, p);
        GridOutputs o;
        d.tick(p, in, t, o);
        r.outs.push_back(o);
        r.stepAt.push_back(d.playingStep());
        r.slotAt.push_back(d.playingSlot());
    }
    return r;
}

static auto gridTransport(double bpm = 120.0) {
    return [bpm](int64_t i, GridInputs&, GridTime& t, GridParams&) {
        t.running = true;
        t.started = i == 0;
        t.bpm = bpm;
        t.ppq = (double)i * bpm / 60.0 / 48000.0;
    };
}

static DrumGridDsp makeGrid(const GridBank& b) {
    DrumGridDsp d;
    d.prepare(48000.0);
    d.reset();
    d.setBank(b);
    return d;
}

static void gridTransportTiming() {
    g_test = "grid-transport";
    GridBank b;
    b.patterns[0].length = 4;
    gridRow(b.patterns[0], 0, "xxxx");
    gridRow(b.patterns[0], 1, "X.x.");
    GridParams p;
    // At every rate, track 1 rises once per step (120 BPM: a quarter is 24000 samples).
    for (int rate = 0; rate < DrumGridDsp::kNumRates; ++rate) {
        auto d = makeGrid(b);
        p.rate = rate;
        const double step = DrumGridDsp::rateBeats(rate) * 24000.0;
        const auto r = runGrid(d, p, (int64_t)(step * 6.5), gridTransport());
        const auto rises = r.rises(0);
        EXPECT(rises.size() == 7);
        for (size_t k = 0; k < rises.size(); ++k) EXPECT(std::llabs(rises[k] - (int64_t)std::ceil(step * (double)k - 1e-6)) <= 1);
    }
    // Accent and velocity: step 1 accented, step 3 plain, at 1/16 (6000 samples).
    auto d = makeGrid(b);
    p = GridParams{};
    p.velocity = 0.6f;
    const auto r = runGrid(d, p, 24000, gridTransport());
    EXPECT(r.outs[10].gate[1] > 0.5f && r.outs[10].accent[1] > 0.5f && r.outs[10].accentAny > 0.5f);
    EXPECT_NEAR(r.outs[10].velocity[1], 1.0, 1e-6);
    EXPECT(r.outs[12010].gate[1] > 0.5f && r.outs[12010].accent[1] < 0.5f && r.outs[12010].accentAny < 0.5f);
    EXPECT_NEAR(r.outs[12010].velocity[1], 0.6, 1e-6);
    EXPECT_NEAR(r.outs[18010].velocity[1], 0.6, 1e-6);  // holds over an Off step
    EXPECT(r.outs[1499].gate[0] > 0.5f && r.outs[1500].gate[0] < 0.5f);  // 25 % of 6000
    EXPECT((r.pulses(&GridOutputs::stepClock) == std::vector<int64_t>{0, 6000, 12000, 18000}));
    EXPECT(r.pulses(&GridOutputs::end).empty());
    // Stopping the transport closes the gates.
    auto s = makeGrid(b);
    p.gateLength = 1.0f;
    const auto st = runGrid(s, p, 3000, [](int64_t i, GridInputs& in, GridTime& t, GridParams& pp) {
        gridTransport()(i, in, t, pp);
        t.running = i < 2000;
    });
    EXPECT(st.outs[1999].gate[0] > 0.5f && st.outs[2000].gate[0] < 0.5f && st.outs[2000].running < 0.5f);
}

static void gridTempoAndClock() {
    g_test = "grid-tempo-clock";
    GridBank b;
    gridRow(b.patterns[0], 0, "xxxxxxxxxxxxxxxx");
    GridParams p;
    p.source = GridTempo;
    p.tempo = 120.0f;
    {  // No transport needed; 1/16 at 120 BPM is 6000 samples.
        auto d = makeGrid(b);
        const auto r = runGrid(d, p, 30000, [](int64_t, GridInputs&, GridTime&, GridParams&) {});
        EXPECT((r.rises(0) == std::vector<int64_t>{0, 6000, 12000, 18000, 24000}));
    }
    {  // A tempo sweep never skips or doubles a step.
        auto d = makeGrid(b);
        const auto r = runGrid(d, p, 480000, [](int64_t i, GridInputs&, GridTime&, GridParams& pp) {
            pp.tempo = (float)(120.0 + 100.0 * std::sin((double)i / 30000.0));
        });
        int last = -1, bad = 0;
        for (size_t i = 0; i < r.stepAt.size(); ++i)
            if (r.stepAt[i] != last) {
                if (last >= 0 && r.stepAt[i] != (last + 1) % 16) ++bad;
                last = r.stepAt[i];
            }
        EXPECT(bad == 0);
    }
    // Clock: 24 PPQN at 1/16 is 6 pulses per step; "per step" ignores Rate.
    for (int ppqn : {0, 3}) {
        auto d = makeGrid(b);
        p.ppqn = ppqn;
        const auto r = runGrid(d, p, 12100, [](int64_t i, GridInputs& in, GridTime&, GridParams&) {
            in.clockPatched = true;
            in.clock = i % 500 == 0 ? 1.0f : 0.0f;
        });
        const auto want = ppqn == 0 ? std::vector<int64_t>{0, 500, 1000} : std::vector<int64_t>{0, 3000, 6000, 9000, 12000};
        auto got = r.pulses(&GridOutputs::stepClock);
        if (ppqn == 0) got.resize(3);
        EXPECT(got == want);
    }
    bool exact = false;
    EXPECT(DrumGridDsp::pulsesPerStep(2, 8, &exact) == 1 && !exact);  // 4 PPQN at 1/16T
    EXPECT(DrumGridDsp::pulsesPerStep(4, 7, &exact) == 12 && exact);  // 48 PPQN at 1/16
    // Swing 75 %: even steps (2, 4, …) start half a step late, in Tempo mode too.
    {
        auto d = makeGrid(b);
        p = GridParams{};
        p.source = GridTempo;
        p.swing = 0.75f;
        const auto r = runGrid(d, p, 25000, [](int64_t, GridInputs&, GridTime&, GridParams&) {});
        EXPECT((r.rises(0) == std::vector<int64_t>{0, 9000, 12000, 21000, 24000}));
    }
}

static void gridRunReset() {
    g_test = "grid-run-reset";
    GridBank b;
    gridRow(b.patterns[0], 0, "xxxxxxxxxxxxxxxx");
    GridParams p;
    p.source = GridTempo;
    // Run low: silent. Rising at 10000: step 1 at once. Falling at 22000: gates close.
    auto d = makeGrid(b);
    p.gateLength = 1.0f;
    auto r = runGrid(d, p, 30000, [](int64_t i, GridInputs& in, GridTime&, GridParams&) {
        in.runPatched = true;
        in.run = i >= 10000 && i < 22000 ? 1.0f : 0.0f;
    });
    EXPECT((r.rises(0) == std::vector<int64_t>{10000, 16001}));  // 100 %: the gate drops for a sample
    EXPECT(r.stepAt[10000] == 0 && r.stepAt[16000] == 1);
    EXPECT(r.outs[21999].gate[0] > 0.5f && r.outs[22000].gate[0] < 0.5f && r.outs[22000].running < 0.5f);
    // Clock: Reset with a pulse plays step 1.
    auto c = makeGrid(b);
    p = GridParams{};
    r = runGrid(c, p, 5100, [](int64_t i, GridInputs& in, GridTime&, GridParams&) {
        in.clockPatched = true;
        in.clock = i % 1000 == 0 ? 1.0f : 0.0f;
        in.reset = i == 3000 ? 1.0f : 0.0f;
    });
    std::vector<int> steps;
    for (int64_t at : r.pulses(&GridOutputs::stepClock)) steps.push_back(r.stepAt[(size_t)at]);
    EXPECT((steps == std::vector<int>{0, 1, 2, 0, 1, 2}));
    // Transport: Run's rising edge waits for the next boundary, which is step 1.
    auto t = makeGrid(b);
    r = runGrid(t, p, 20000, [](int64_t i, GridInputs& in, GridTime& tt, GridParams& pp) {
        gridTransport()(i, in, tt, pp);
        in.runPatched = true;
        in.run = i >= 7000 ? 1.0f : 0.0f;
    });
    EXPECT((r.rises(0) == std::vector<int64_t>{12000, 18000}));
    EXPECT(r.stepAt[12000] == 0);
}

static void gridGatesAndMutes() {
    g_test = "grid-gates";
    GridBank b;
    gridRow(b.patterns[0], 0, "xx..");
    gridRow(b.patterns[0], 1, "x...");
    gridRow(b.patterns[0], 2, "x...");
    b.patterns[0].length = 4;
    GridParams p;
    p.source = GridTempo;
    p.gateLength = 1.0f;
    // Back-to-back steps at 100 %: two rising edges.
    auto d = makeGrid(b);
    auto r = runGrid(d, p, 12000, [](int64_t, GridInputs&, GridTime&, GridParams&) {});
    EXPECT((r.rises(0) == std::vector<int64_t>{0, 6001}));
    // Mute closes a sounding gate at once; Solo plays only soloed tracks.
    auto m = makeGrid(b);
    GridBank muted = b;
    muted.mute = 1u << 1;
    r = runGrid(m, p, 6000, [&](int64_t i, GridInputs&, GridTime&, GridParams&) {
        if (i == 3000) m.setBank(muted);
    });
    EXPECT(r.outs[2999].gate[1] > 0.5f && r.outs[3000].gate[1] < 0.5f && r.outs[3000].gate[0] > 0.5f);
    GridBank solo = b;
    solo.solo = 1u << 2;
    solo.mute = 1u << 2;  // solo wins over mute
    auto s = makeGrid(solo);
    r = runGrid(s, p, 100, [](int64_t, GridInputs&, GridTime&, GridParams&) {});
    EXPECT(r.outs[10].gate[0] < 0.5f && r.outs[10].gate[1] < 0.5f && r.outs[10].gate[2] > 0.5f);
}

static void gridPatterns() {
    g_test = "grid-patterns";
    GridBank b;
    b.patterns[0].length = 4;
    gridRow(b.patterns[0], 0, "xxxx");
    b.patterns[1].length = 3;
    gridRow(b.patterns[1], 1, "xxx");
    GridParams p;
    p.source = GridTempo;
    {  // At End: chosen during step 2, switches when slot 1 wraps (step 5 = 24000).
        auto d = makeGrid(b);
        GridBank next = b;
        next.current = 1;
        const auto r = runGrid(d, p, 50000, [&](int64_t i, GridInputs&, GridTime&, GridParams&) {
            if (i == 7000) d.setBank(next);
        });
        EXPECT(r.slotAt[23999] == 0 && r.slotAt[24000] == 1 && r.stepAt[24000] == 0);
        EXPECT(r.stepAt[42000] == 0);  // slot 2 is 3 steps long
        EXPECT((r.pulses(&GridOutputs::end) == std::vector<int64_t>{24000, 42000}));
        EXPECT(r.rises(1).front() == 24000 && r.rises(0).back() == 18000);
    }
    {  // Immediate: the next step, keeping the position modulo the new length.
        auto d = makeGrid(b);
        p.switchMode = GridImmediate;
        GridBank next = b;
        next.current = 1;
        const auto r = runGrid(d, p, 20000, [&](int64_t i, GridInputs&, GridTime&, GridParams&) {
            if (i == 7000) d.setBank(next);
        });
        EXPECT(r.slotAt[11999] == 0 && r.slotAt[12000] == 1 && r.stepAt[12000] == 2);
        EXPECT(r.stepAt[18000] == 0);
    }
    {  // The Pattern input: 0..1 → slots 1..16, only read at the end; an empty slot is silent.
        EXPECT(DrumGridDsp::slotFor(0.0f) == 0 && DrumGridDsp::slotFor(0.07f) == 1 && DrumGridDsp::slotFor(1.0f) == 15);
        auto d = makeGrid(b);
        p.switchMode = GridAtEnd;
        const auto r = runGrid(d, p, 30000, [](int64_t i, GridInputs& in, GridTime&, GridParams&) {
            in.patternPatched = true;
            in.pattern = i < 5000 ? 0.0f : (i < 6000 ? 0.07f : 0.5f);  // a blip to slot 2, then slot 9
        });
        EXPECT(r.slotAt[24000] == 8);
        bool any = false;
        for (size_t i = 24000; i < r.outs.size(); ++i) any = any || r.outs[i].gate[0] > 0.5f || r.outs[i].gate[1] > 0.5f;
        EXPECT(!any);
    }
}


void runGridTests() {
    gridTransportTiming();
    gridTempoAndClock();
    gridRunReset();
    gridGatesAndMutes();
    gridPatterns();
}
