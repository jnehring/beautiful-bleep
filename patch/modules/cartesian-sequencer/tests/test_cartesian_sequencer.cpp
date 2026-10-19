// SPDX-License-Identifier: GPL-3.0-or-later
// Cartesian Seq DSP: raster order and end pulses, independent axes and their
// period, loop jumps, skipped cells, Cartesian mode (Clock and Change), knob
// offsets, Mod slew, ties and no hanging notes, seeded random walks.
#include "CartesianSequencerDsp.h"
#include "dsp/tests/TestUtil.h"

#include <functional>
#include <map>
#include <vector>

using namespace bleep::patch;

namespace {

constexpr double kSr = 48000.0;
constexpr double kBpm = 120.0;
constexpr double kPpqPerSample = kBpm / 60.0 / kSr;
constexpr int64_t kSixteenth = 6000;  // samples at 120 BPM, 48 kHz

struct Note {
    int64_t at;
    bool on;
    int note;
    int cell;
};

struct Run {
    std::vector<Note> notes;
    std::vector<int64_t> rowEnds, gridEnds, triggers;
    std::vector<float> mod, gate;
    std::map<int, int> held;
    bool bad = false;
    int sounding() const {
        int n = 0;
        for (const auto& [k, v] : held) n += v;
        return n;
    }
    std::vector<int> onCells() const {
        std::vector<int> c;
        for (const auto& n : notes)
            if (n.on) c.push_back(n.cell);
        return c;
    }
};

CartGrid allOn(int cols = 8, int rows = 8) {
    CartGrid g{};
    for (int r = 0; r < rows; ++r)
        for (int c = 0; c < cols; ++c) {
            auto& cell = g[(size_t)(r * kCartSize + c)];
            cell.gate = CartOn;
            cell.pitch = (int8_t)(r * kCartSize + c - 24);  // distinct pitches (Chromatic)
        }
    return g;
}

struct Rig {
    CartesianSequencerDsp dsp;
    CartParams p;
    CartTime t;
    CartInputs in;
    int64_t sample = 0;
    double ppq = 0.0;
    Rig() {
        dsp.prepare(kSr);
        dsp.reset();
        p.scale = 0;  // Chromatic: pitch = cell
        t.running = true;
        t.bpm = kBpm;
    }
    /// Runs n samples with the transport; `each(i)` may change inputs.
    void run(int64_t n, Run& r, const std::function<void(int64_t)>& each = nullptr) {
        for (int64_t i = 0; i < n; ++i, ++sample) {
            if (each) each(sample);
            t.started = sample == 0;
            t.ppq = ppq;
            CartOutputs o;
            dsp.tick(p, in, t, o, [&](bool on, int note, float, float) {
                r.notes.push_back({sample, on, note, dsp.playingCell()});
                if (on) {
                    if (r.held[note]++ > 0) r.bad = true;
                } else if (--r.held[note] < 0) {
                    r.bad = true;
                }
            });
            if (o.rowEnd > 0.5f) r.rowEnds.push_back(sample);
            if (o.gridEnd > 0.5f) r.gridEnds.push_back(sample);
            if (o.trigger > 0.5f) r.triggers.push_back(sample);
            r.mod.push_back(o.mod);
            r.gate.push_back(o.gate);
            if (t.running) ppq += kPpqPerSample;
        }
    }
};

int cellOf(int c, int r) { return r * kCartSize + c; }

}  // namespace

static void rasterOrder() {
    TEST("raster 4x4 forward");
    Rig rig;
    rig.dsp.setGrid(allOn());
    Run r;
    rig.run(kSixteenth * 32, r);
    const auto cells = r.onCells();
    EXPECT(cells.size() == 32);
    for (size_t i = 0; i < cells.size(); ++i) EXPECT(cells[i] == cellOf((int)i % 4, ((int)i / 4) % 4));
    EXPECT(r.rowEnds.size() == 7);   // steps 4, 8, …, 28
    EXPECT(r.gridEnds.size() == 1);  // step 16
    if (!r.gridEnds.empty()) EXPECT(r.gridEnds[0] == 16 * kSixteenth);
    if (!r.rowEnds.empty()) EXPECT(r.rowEnds[0] == 4 * kSixteenth);
    EXPECT(!r.bad);

    TEST("raster directions");
    Rig b;
    b.dsp.setGrid(allOn());
    b.p.xDirection = CartBackward;
    b.p.yDirection = CartPingPong;
    b.p.rows = 3;
    Run rb;
    b.run(kSixteenth * 16, rb);
    const auto cb = rb.onCells();
    // Rows 0, 1, 2, 1 (ping-pong), each row 3, 2, 1, 0.
    const int rowsOrder[4] = {0, 1, 2, 1};
    EXPECT(cb.size() == 16);
    for (size_t i = 0; i < cb.size(); ++i) EXPECT(cb[i] == cellOf(3 - (int)i % 4, rowsOrder[i / 4]));
}

static void independentAxes() {
    TEST("independent axes repeat after 3 bars");
    Rig rig;
    rig.dsp.setGrid(allOn());
    rig.p.yRate = kCartYRates + 2;  // 1/4.
    Run r;
    const int64_t bar = kSixteenth * 16;
    rig.run(bar * 6 + 10, r);
    std::vector<std::pair<int64_t, int>> ons;
    for (const auto& n : r.notes)
        if (n.on) ons.push_back({n.at, n.cell});
    // Every X step plays exactly one note (Y steps fall on X steps here).
    EXPECT(ons.size() == 6 * 16 + 1);
    bool same = ons.size() == 97, earlier = false;
    for (size_t i = 0; i < 48 && same; ++i) {
        if (ons[i].second != ons[i + 48].second) same = false;
        if (i > 0 && ons[i].second != ons[i + 16].second) earlier = true;  // not periodic after 1 bar
    }
    EXPECT(same);
    EXPECT(earlier);
    // The first bar: Y moves every 6 sixteenths.
    EXPECT(ons[0].second == cellOf(0, 0));
    EXPECT(ons[6].second == cellOf(2, 1));
    EXPECT(ons[12].second == cellOf(0, 2));
    EXPECT(!r.bad);

    TEST("loop jump lands on the same cell");
    Rig j;
    j.dsp.setGrid(allOn());
    j.p.yRate = kCartYRates + 2;
    Run rj;
    j.run(bar * 2, rj);
    j.ppq = 4.0 * 1.0 + 0.0001;  // jump to bar 2 (1-based), just after the line
    Run rj2;
    j.run(kSixteenth * 8, rj2);
    const auto cj = rj2.onCells();
    // The jump plays step 16 at once, then the steps follow the song position.
    EXPECT(cj.size() >= 8);
    for (size_t i = 0; i < cj.size() && 16 + i < ons.size(); ++i) EXPECT(cj[i] == ons[16 + i].second);
}

static void bothAxesOnce() {
    TEST("both axes moving on one sample play one note");
    Rig rig;
    rig.dsp.setGrid(allOn());
    rig.p.yRate = kCartYRates + 3;  // 1/4: every 4th X step coincides
    Run r;
    rig.run(kSixteenth * 16, r);
    EXPECT(r.onCells().size() == 16);
    EXPECT(!r.bad);
}

static void skipped() {
    TEST("raster skip shortens the path");
    CartGrid g = allOn();
    g[(size_t)cellOf(1, 0)].play = false;
    g[(size_t)cellOf(2, 2)].play = false;
    g[(size_t)cellOf(3, 3)].play = false;
    Rig rig;
    rig.dsp.setGrid(g);
    Run r;
    rig.run(kSixteenth * 26, r);
    const auto cells = r.onCells();
    EXPECT(cells.size() == 26);
    for (int c : cells) EXPECT(c != cellOf(1, 0) && c != cellOf(2, 2) && c != cellOf(3, 3));
    for (size_t i = 13; i < cells.size(); ++i) EXPECT(cells[i] == cells[i - 13]);
    EXPECT(r.gridEnds.size() == 1 && r.gridEnds[0] == 13 * kSixteenth);

    TEST("independent: borrow the next cell in the row");
    CartGrid h = allOn();
    h[(size_t)cellOf(1, 0)].play = false;
    for (int c = 0; c < 8; ++c) h[(size_t)cellOf(c, 1)].play = false;  // row 1 all skipped
    Rig b;
    b.dsp.setGrid(h);
    b.p.yRate = kCartYRates + 0;  // 1/1: row changes every bar
    Run rb;
    b.run(kSixteenth * 32, rb);
    const auto cb = rb.onCells();
    EXPECT(cb.size() == 16);  // the second bar (row 1) is silent
    if (cb.size() >= 2) EXPECT(cb[1] == cellOf(2, 0));
    EXPECT(rb.sounding() == 0 || rb.notes.back().at < 16 * kSixteenth + 10);

    TEST("all skipped: silent");
    CartGrid none = allOn();
    for (auto& c : none) c.play = false;
    Rig n;
    n.dsp.setGrid(none);
    Run rn;
    n.run(kSixteenth * 8, rn);
    EXPECT(rn.notes.empty());

    TEST("skipping the sounding cell ends its note");
    Rig s;
    CartGrid t = allOn();
    t[0].gate = CartTie;
    for (auto& c : t) c.gate = CartTie;
    s.dsp.setGrid(t);
    Run rs;
    s.run(kSixteenth / 2, rs);
    EXPECT(rs.sounding() == 1);
    t[0].play = false;
    s.dsp.setGrid(t);
    s.run(10, rs);
    EXPECT(rs.sounding() == 0);
    EXPECT(!rs.bad);
}

static void cartesian() {
    TEST("Cartesian Clock: an X ramp plays the columns in order");
    Rig rig;
    rig.dsp.setGrid(allOn());
    rig.p.mode = CartCartesian;
    Run r;
    const int64_t bar = kSixteenth * 16;
    rig.run(bar, r, [&](int64_t i) { rig.p.x = (float)i / (float)bar; });
    const auto cells = r.onCells();
    EXPECT(cells.size() == 16);
    for (size_t i = 0; i < cells.size(); ++i) EXPECT(cells[i] == cellOf((int)i / 4, 0));

    TEST("Cartesian Change: hysteresis stops chatter");
    Rig c;
    c.dsp.setGrid(allOn());
    c.p.mode = CartCartesian;
    c.p.sample = CartSampleChange;
    c.t.running = false;
    Run rc;
    c.p.x = 0.2f;
    c.run(100, rc);
    EXPECT(rc.notes.empty());  // the first position is taken silently
    // Dither around the border between columns 0 and 1 (x = 0.25).
    c.run(4800, rc, [&](int64_t i) { c.p.x = 0.25f + ((i & 1) ? 0.01f : -0.01f); });
    EXPECT(rc.onCells().size() <= 1);
    c.p.x = 0.6f;
    c.run(100, rc);
    const auto cc = rc.onCells();
    EXPECT(!cc.empty() && cc.back() == cellOf(2, 0));
    EXPECT(!rc.bad);
}

static void knobOffsets() {
    TEST("X/Y knobs rotate the playheads");
    Rig rig;
    rig.dsp.setGrid(allOn());
    rig.p.x = 0.5f;   // 2 columns
    rig.p.y = 0.25f;  // 1 row
    Run r;
    rig.run(kSixteenth * 4, r);
    const auto cells = r.onCells();
    EXPECT(cells.size() == 4);
    const int want[4] = {cellOf(2, 1), cellOf(3, 1), cellOf(0, 1), cellOf(1, 1)};
    for (size_t i = 0; i < cells.size(); ++i) EXPECT(cells[i] == want[i]);
}

static void modSlew() {
    TEST("Mod reaches the cell's value after Mod Slew, also on Off cells");
    CartGrid g = allOn();
    g[0].mod = 100;
    g[1].mod = -50;
    g[1].gate = CartOff;
    Rig rig;
    rig.dsp.setGrid(g);
    rig.p.modSlew = 0.05f;  // 2400 samples
    Run r;
    rig.run(kSixteenth * 2, r);
    EXPECT_NEAR(r.mod[2400], 1.0, 1e-4);
    EXPECT(r.mod[1200] > 0.4f && r.mod[1200] < 0.6f);
    EXPECT_NEAR(r.mod[(size_t)kSixteenth + 2400], -0.5, 1e-4);
}

static void noHangingNotes() {
    TEST("ties are legato");
    CartGrid g = allOn();
    g[(size_t)cellOf(0, 0)].gate = CartTie;
    Rig rig;
    rig.dsp.setGrid(g);
    Run r;
    rig.run(kSixteenth + 10, r);
    // At the second step: the new note-on comes before the old note-off.
    std::vector<Note> at;
    for (const auto& n : r.notes)
        if (n.at > 0 && (at.empty() || n.at == at[0].at)) at.push_back(n);
    EXPECT(at.size() == 2 && at[0].on && !at[1].on);
    if (!at.empty()) EXPECT(r.gate[(size_t)at[0].at] > 0.5f);

    TEST("no hanging notes: stop, reset, resize, mode");
    for (auto& c : g) c.gate = CartTie;
    Rig h;
    h.dsp.setGrid(g);
    Run rh;
    h.run(kSixteenth * 3 + 5, rh);
    EXPECT(rh.sounding() == 1);
    h.t.running = false;
    h.run(10, rh);
    EXPECT(rh.sounding() == 0);
    h.t.running = true;
    h.run(kSixteenth * 2, rh);
    EXPECT(rh.sounding() == 1);
    h.in.reset = 1.0f;
    h.run(1, rh);
    h.in.reset = 0.0f;
    EXPECT(rh.sounding() == 0);
    h.run(kSixteenth * 2, rh);
    EXPECT(rh.sounding() == 1);
    h.p.columns = 3;
    h.run(1, rh);
    EXPECT(rh.sounding() == 0);
    h.run(kSixteenth * 2, rh);
    h.p.mode = CartCartesian;
    h.run(1, rh);
    EXPECT(rh.sounding() == 0);
    EXPECT(!rh.bad);
}

static void seededRandom() {
    TEST("same Seed, same random walk; never the same cell twice in a row");
    auto render = [](uint32_t seed) {
        Rig rig;
        rig.dsp.setGrid(allOn());
        rig.p.xDirection = CartRandom;
        rig.p.yRate = kCartYRates + 3;
        rig.p.yDirection = CartRandom;
        rig.p.seed = seed;
        Run r;
        rig.run(kSixteenth * 64, r);
        return r.onCells();
    };
    const auto a = render(5), b = render(5), c = render(6);
    EXPECT(a == b);
    EXPECT(a != c);
    EXPECT(a.size() == 64);

    TEST("raster random");
    Rig rig;
    rig.dsp.setGrid(allOn());
    rig.p.xDirection = CartRandom;
    Run r;
    rig.run(kSixteenth * 64, r);
    const auto cells = r.onCells();
    for (size_t i = 1; i < cells.size(); ++i) EXPECT(cells[i] != cells[i - 1]);
    for (int cell : cells) EXPECT(cell % kCartSize < 4 && cell / kCartSize < 4);
}

int main() {
    rasterOrder();
    independentAxes();
    bothAxesOnce();
    skipped();
    cartesian();
    knobOffsets();
    modSlew();
    noHangingNotes();
    seededRandom();
    return bleep::test::finish("cartesian-sequencer");
}
